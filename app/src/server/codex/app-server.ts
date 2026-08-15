import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";
import fs from "node:fs";
import path from "node:path";
import { redactSensitiveText } from "../events.js";
import {EXTERNAL_MCP_BUNDLE_ENV,externalMcpForCodex,readExternalMcpBundle} from "../external-mcp-bundle.js";
import{EMOTION_MCP_PROFILE_HEADER,EMOTION_MCP_SERVER_ID,EMOTION_MCP_TASK_HEADER,validEmotionTaskId,validatedEmotionMcpUrl}from"../emotion-mcp-policy.js";
import{managedCodexBinary,managedCodexRuntimeState}from"../codex-runtime.js";

type Pending = { resolve(value: any): void; reject(error: Error): void; timer: NodeJS.Timeout };
export type AppServerNotification = { method: string; params?: any };
export type AppServerRequest = { id: string | number; method: string; params?: any };
export type CodexRuntimeSelection = { binary:string|null; source:"configured"|"managed"|"global"|"unavailable"|"corrupt"; reason?:string };

export class AppServerError extends Error {
  constructor(message: string, readonly rpcCode?: number, readonly data?: unknown) { super(message); }
}

export function codexRuntimeSelection(root:string|undefined=undefined,env:NodeJS.ProcessEnv=process.env,platform:NodeJS.Platform=process.platform):CodexRuntimeSelection{
  root??=env.CLAUDEX_WORKHOUSE_APP_ROOT?.trim()||env.CLAUDEX_WORKHOUSE_ROOT?.trim()||(platform==="win32"?(env.LOCALAPPDATA?.trim()||"C:\\Claudex Workhouse"):"/opt/claudex-workhouse");
  const configured=env.CLAUDEX_WORKHOUSE_CODEX_BIN?.trim();
  if(configured)return{binary:configured,source:"configured"};
  const dataRoot=env.CLAUDEX_WORKHOUSE_DATA_ROOT?.trim()||root,state=managedCodexRuntimeState(dataRoot,platform);
  // A recorded-but-broken managed runtime is an error, never a reason to run a
  // different Codex. Falling through to PATH here is how an updated managed
  // runtime could be replaced at launch by an older global npm install.
  if(state.status==="corrupt")return{binary:null,source:"corrupt",reason:state.reason};
  const managed=managedCodexBinary(dataRoot,platform);
  // Existence, not the stricter state probe, remains the selection test here:
  // the legacy `runtime/codex-bin` runtime is selected exactly as before, and
  // only the newly distinguished `corrupt` case changes behaviour.
  if(fs.existsSync(managed))return{binary:managed,source:"managed"};
  return platform==="win32"
    ?{binary:null,source:"unavailable"}
    :{binary:"/usr/local/bin/codex",source:"global"};
}

// Serializes `codex app-server` cold starts across processes. Every app-server
// shares one CODEX_HOME whose sqlite state runtime is exclusive during
// initialize, so overlapping starts make the loser exit(1) -- see the
// contention note further down. mkdir is the atomic acquire; a pid file plus a
// stale window recovers the lock when a holder crashes without releasing.
const START_LOCK_STALE_MS = 180000;
function startLockDir() {
  return path.join(process.env.CLAUDEX_WORKHOUSE_DATA_ROOT??process.env.CLAUDEX_WORKHOUSE_ROOT??"/opt/claudex-workhouse", "data", "codex-app-server-start.lock");
}
async function acquireStartLock(timeoutMs: number): Promise<boolean> {
  const dir = startLockDir();
  fs.mkdirSync(path.dirname(dir),{recursive:true,mode:0o700});
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try { fs.mkdirSync(dir); fs.writeFileSync(path.join(dir, "pid"), String(process.pid)); return true; }
    catch {
      try {
        const stat = fs.statSync(dir);
        let alive = false;
        try { const pid = Number(fs.readFileSync(path.join(dir, "pid"), "utf8")); if (pid > 0) { process.kill(pid, 0); alive = true; } } catch { /* holder gone or pid unreadable */ }
        if (!alive || Date.now() - stat.mtimeMs > START_LOCK_STALE_MS) { fs.rmSync(dir, { recursive: true, force: true }); continue; }
      } catch { /* lost a race with another acquire/release; just poll again */ }
      // Waiting out the lock is best-effort: past the deadline it is better to
      // attempt the start (old contention odds + retry) than to deadlock here.
      if (Date.now() >= deadline) return false;
      await new Promise((resolve) => setTimeout(resolve, 1000 + Math.floor(Math.random() * 500)));
    }
  }
}
function releaseStartLock() {
  const dir = startLockDir();
  try { if (Number(fs.readFileSync(path.join(dir, "pid"), "utf8")) === process.pid) fs.rmSync(dir, { recursive: true, force: true }); } catch { /* already released or taken over as stale */ }
}

export class CodexAppServerClient {
  private child: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private closed = false;
  private stderr = "";
  onNotification: ((message: AppServerNotification) => void) | null = null;
  onServerRequest: ((message: AppServerRequest) => Promise<unknown> | unknown) | null = null;
  onClose: ((error:Error) => void) | null = null;

  private constructor(cwd: string, private timeoutMs: number) {
    const {binary}=codexRuntimeSelection();
    if(!binary)throw Object.assign(new Error("Managed Codex runtime is not installed."),{code:"ENOENT"});
    this.child = spawn(binary, codexAppServerArgs(), {
      cwd, shell: false, windowsHide:true, stdio: ["pipe", "pipe", "pipe"]
    });
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk) => { this.stderr = `${this.stderr}${chunk}`.slice(-16000); });
    // Without a listener, an EPIPE on this pipe is an unhandled stream error
    // that takes down whatever is running. The request that provoked it is
    // rejected by `send`, and the child's own `exit` handler fails the rest, so
    // there is nothing further to do here beyond not crashing.
    this.child.stdin.on("error", () => {});
    const lines = readline.createInterface({ input: this.child.stdout });
    lines.on("line", (line) => this.handleLine(line));
    this.child.once("exit", (code, signal) => {
      const diagnostic=this.diagnostic();
      this.failAll(new Error(`Codex app-server exited (${signal ?? code ?? "unknown"}).${diagnostic?` ${diagnostic}`:""}`));
    });
    this.child.once("error", (error) => this.failAll(error));
  }

  static async connect(cwd: string, timeoutMs = 15000, clientInfo: {title:string;name:string;version:string} = { title: "Claudex Workhouse", name: "claudex-workhouse", version: "0.2.0" }) {
    // The retry loop below this cannot prevent two cold starts from
    // overlapping in the first place: the main server's pooled client and each
    // codex-worker are separate processes, and with a 38-81s initialize window
    // a sub-second backoff practically guarantees they collide again. Hold a
    // cross-process lock for the whole initialize so starts run one at a time.
    // The wait budget must exceed both a worst-case initialize (~150s attempt)
    // and the stale-lock window, otherwise a slow neighbor start makes this
    // caller give up mid-initialize and collide with it -- observed exactly
    // that with a 120s cap. Past this budget the stale sweep has already had
    // its chance, so proceeding is a genuine last resort.
    const selection=codexRuntimeSelection();
    if(selection.source==="corrupt")throw Object.assign(new Error(`${selection.reason??"The managed Codex runtime is damaged."} Repair it with the runtime updater; Workhouse will not run a different Codex in its place.`),{code:"CODEX_MANAGED_RUNTIME_CORRUPT"});
    if(!selection.binary)throw Object.assign(new Error("Managed Codex runtime is not installed."),{code:"ENOENT"});
    const locked = await acquireStartLock(START_LOCK_STALE_MS + 60000);
    const client = new CodexAppServerClient(cwd, timeoutMs);
    try {
      await client.request("initialize", {
        clientInfo,
        capabilities: {
          experimentalApi: true,
          optOutNotificationMethods: []
        }
      });
      client.notify("initialized", {});
      return client;
    } catch (error) {
      // A timed-out initialize still owns a live child unless it is explicitly
      // closed. Clean it up before callers retry so cold starts cannot pile up.
      await client.close().catch(() => {});
      throw error;
    } finally {
      if (locked) releaseStartLock();
    }
  }

  request(method: string, params: Record<string, unknown>, timeoutMs = this.timeoutMs): Promise<any> {
    if (this.closed) return Promise.reject(new Error("Codex app-server client is closed."));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Object.assign(new Error(`Codex app-server ${method} timed out.`), { code: "APP_SERVER_TIMEOUT" }));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      this.send({ id, method, params });
    });
  }

  notify(method: string, params: Record<string, unknown>) { if (!this.closed) this.send({ method, params }); }

  /**
   * Writes one framed message, failing the request rather than the process
   * when the app-server is already gone.
   *
   * An unguarded `stdin.write` to an exited child emits EPIPE on a stream with
   * no error listener, which surfaces as an unhandled exception in whatever
   * happened to be running — and the caller still waited out its full timeout,
   * because nothing rejected the pending entry. Both are the same underlying
   * event: the runtime died mid-request. Report it once, immediately, against
   * the request it belongs to.
   */
  private send(value: unknown) {
    const id = (value as { id?: number }).id;
    const fail = (error: Error) => {
      if (typeof id !== "number") return;
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      clearTimeout(pending.timer);
      pending.reject(Object.assign(new Error("Codex app-server connection closed before the request completed."), { code: "APP_SERVER_CLOSED", cause: error }));
    };
    if (this.child.stdin.destroyed || !this.child.stdin.writable) { fail(new Error("app-server stdin is closed")); return; }
    // A pipe to an already-exited child can raise EPIPE synchronously rather
    // than through the write callback, so both paths have to be handled.
    try { this.child.stdin.write(`${JSON.stringify(value)}\n`, error => { if (error) fail(error); }); }
    catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
  }
  private handleLine(line: string) {
    let message: any;
    try { message = JSON.parse(line); } catch { return this.failAll(new Error("Invalid JSON from Codex app-server.")); }
    if (message.id !== undefined && message.method) {
      if (!this.onServerRequest) {
        this.send({ id: message.id, error: { code: -32601, message: `Unsupported server request: ${message.method}` } });
        return;
      }
      Promise.resolve(this.onServerRequest(message)).then(
        (result) => this.send({ id:message.id, result:result ?? {} }),
        (error) => this.send({ id:message.id, error:{ code:-32001, message:error instanceof Error ? error.message : "Server request failed." } })
      );
      return;
    }
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id); clearTimeout(pending.timer);
      if (message.error) pending.reject(new AppServerError(message.error.message ?? "App-server request failed.", message.error.code, message.error.data));
      else pending.resolve(message.result ?? {});
      return;
    }
    if (message.method) this.onNotification?.(message);
  }

  private failAll(error: Error) {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
    const listener=this.onClose;this.onClose=null;listener?.(error);
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    this.child.stdin.end();
    const exited = new Promise<void>((resolve) => this.child.once("exit", () => resolve()));
    const termTimer = setTimeout(() => this.child.kill("SIGTERM"), 500); termTimer.unref?.();
    const killTimer = setTimeout(() => this.child.kill("SIGKILL"), 1250); killTimer.unref?.();
    await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 1500))]);
    clearTimeout(termTimer);clearTimeout(killTimer);
  }

  diagnostic() { return redactSensitiveText(this.stderr).slice(-2000); }

  get alive() { return !this.closed && this.child.exitCode === null && !this.child.killed; }
}

export function codexAppServerArgs(env:NodeJS.ProcessEnv=process.env){
  const args=["app-server","--stdio"];
  const runtimeProfile=env.CLAUDEX_WORKHOUSE_RUNTIME_PROFILE==="conversation"||env.CLAUDEX_WORKHOUSE_RUNTIME_PROFILE==="browser"?env.CLAUDEX_WORKHOUSE_RUNTIME_PROFILE:"default";
  if(runtimeProfile!=="browser"){
    const taskId=validEmotionTaskId("codex",env.CLAUDEX_WORKHOUSE_CURRENT_TASK_ID),emotionUrl=validatedEmotionMcpUrl("codex",env.CLAUDEX_WORKHOUSE_EMOTION_MCP_URL);
    if(taskId&&emotionUrl){
      const prefix=`mcp_servers.${EMOTION_MCP_SERVER_ID}`;
      args.unshift("-c",`${prefix}.tool_timeout_sec=30`);
      args.unshift("-c",`${prefix}.env_http_headers={${JSON.stringify(EMOTION_MCP_TASK_HEADER)}="CLAUDEX_WORKHOUSE_CURRENT_TASK_ID",${JSON.stringify(EMOTION_MCP_PROFILE_HEADER)}="CLAUDEX_WORKHOUSE_RUNTIME_PROFILE"}`);
      args.unshift("-c",`${prefix}.url=${JSON.stringify(emotionUrl)}`);
    }
  }
  if(runtimeProfile==="default"){
    if(env.CLAUDEX_WORKHOUSE_CURRENT_TASK_ID&&env.CLAUDEX_WORKHOUSE_MANAGED_PROVIDER_TOKEN){
      args.unshift("-c","mcp_servers.claudex_workhouse.tool_timeout_sec=130");
      args.unshift("-c",'mcp_servers.claudex_workhouse.env_http_headers={"X-Claudex-Workhouse-Task-Id"="CLAUDEX_WORKHOUSE_CURRENT_TASK_ID"}');
      args.unshift("-c",'mcp_servers.claudex_workhouse.bearer_token_env_var="CLAUDEX_WORKHOUSE_MANAGED_PROVIDER_TOKEN"');
      const managedProviderUrl=env.CLAUDEX_WORKHOUSE_MANAGED_PROVIDER_MCP_URL?.trim();
      if(!managedProviderUrl)throw new Error("CLAUDEX_WORKHOUSE_MANAGED_PROVIDER_MCP_URL is required for managed provider tools.");
      args.unshift("-c",`mcp_servers.claudex_workhouse.url=${JSON.stringify(managedProviderUrl)}`);
    }
    const taskId=env.CLAUDEX_WORKHOUSE_CURRENT_TASK_ID,bundle=taskId?readExternalMcpBundle(env[EXTERNAL_MCP_BUNDLE_ENV],taskId):null;
    if(bundle){const external=externalMcpForCodex(bundle);Object.assign(env,external.environment);args.unshift(...external.args);}
  }
  else{args.unshift("-c","mcp_servers={}");args.unshift("-c","project_doc_max_bytes=0");}
  return args;
}

// Every app-server shares one CODEX_HOME, and its sqlite state runtime takes an
// exclusive lock while it opens/migrates. Two cold starts that overlap on this
// NAS lose that race and the loser exits(1) before it ever speaks JSON-RPC.
// Reproduced 2026-07-26: six concurrent `codex app-server --stdio` starts, all
// six failed; the same start run serially succeeded every time. The contention
// clears on its own, so treat it like the initialize timeout and retry.
const STATE_RUNTIME_CONTENTION=/failed to initialize (?:sqlite )?state runtime/i;
export function isRetryableAppServerStartError(error:unknown){
  const message=error instanceof Error?error.message:String(error);
  if(STATE_RUNTIME_CONTENTION.test(message))return true;
  return (error as any)?.code==="APP_SERVER_TIMEOUT"&&/initialize timed out/i.test(message);
}

export async function connectCodexAppServerWithRetry(cwd:string,options:{timeoutMs?:number;secondTimeoutMs?:number;maxAttempts?:number;retryDelayMs?:number;onRetry?:(error:Error,attempt:number)=>void}={}){
  // Defaults must cover a real cold start: initialize alone measures 38-81s on
  // this NAS, so the old 30s/45s budgets timed out even without contention.
  const timeoutMs=options.timeoutMs??90000,secondTimeoutMs=options.secondTimeoutMs??150000,maxAttempts=Math.max(1,options.maxAttempts??3),retryDelayMs=Math.max(0,options.retryDelayMs??500);
  let lastError:unknown;
  for(let attempt=1;attempt<=maxAttempts;attempt++){
    try{return await CodexAppServerClient.connect(cwd,attempt===1?timeoutMs:secondTimeoutMs);}
    catch(error){
      lastError=error;
      if(!isRetryableAppServerStartError(error)||attempt>=maxAttempts)throw error;
      options.onRetry?.(error instanceof Error?error:new Error(String(error)),attempt);
      // Back off with jitter so two racing starts do not collide again in lockstep.
      const delay=retryDelayMs*attempt;
      if(delay)await new Promise(resolve=>setTimeout(resolve,delay+Math.floor(Math.random()*delay)));
    }
  }
  throw lastError instanceof Error?lastError:new Error("Codex app-server initialize retry exhausted.");
}

// Spawning `codex app-server` is expensive on this NAS. Measured 2026-07-26:
// initialize alone takes 38-81s, the first thread/list on a fresh process adds
// another 23-46s, and every list after that is ~0.3s. So metadata reads (thread
// list/search/turns/read, model catalog) share one pooled client instead of
// paying that per request. The pool holds a single client for the deck root
// cwd, reconnects on failure, and an idle reaper shuts the child down.
//
// The idle window has to be much longer than the cost of a restart, otherwise a
// short pause in UI polling throws away a warm process and the next request
// pays the full minute again. Twenty minutes keeps a browsing session warm.
const POOL_IDLE_MS = 1200000;
let pooled: { client: CodexAppServerClient; cwd: string; lastUsed: number } | null = null;
let connecting: Promise<CodexAppServerClient> | null = null;
let reaper: NodeJS.Timeout | null = null;

function dropPool(client?: CodexAppServerClient) {
  if (client && pooled?.client !== client) return;
  const dying = pooled?.client;
  pooled = null;
  dying?.close().catch(() => {});
}

export function resetCodexAppServerPool(){dropPool();}
export function codexAppServerPoolWarm(cwd:string){return Boolean(pooled&&pooled.cwd===cwd&&pooled.client.alive);}

async function acquirePooled(cwd: string, timeoutMs: number): Promise<CodexAppServerClient> {
  if (pooled && pooled.cwd === cwd && pooled.client.alive) { pooled.lastUsed = Date.now(); return pooled.client; }
  if (pooled) dropPool();
  if (!connecting) {
    connecting = connectCodexAppServerWithRetry(cwd, { timeoutMs, secondTimeoutMs: timeoutMs }).then((client) => {
      pooled = { client, cwd, lastUsed: Date.now() };
      if (!reaper) {
        reaper = setInterval(() => { if (pooled && Date.now() - pooled.lastUsed > POOL_IDLE_MS) dropPool(); }, 30000);
        reaper.unref?.();
      }
      return client;
    }).finally(() => { connecting = null; });
  }
  return connecting;
}

/**
 * Executes a Codex app-server request somewhere other than this process.
 *
 * When the managed local Worker owns the Codex runtime — which is the case on
 * Windows — there is no app-server here to connect to. Installing a delegate
 * redirects the transport while leaving every caller's own logic intact, so
 * thread listing keeps its cursor cache, its database merge and its filters
 * instead of being replaced by a thinner remote endpoint.
 */
export type CodexAppServerDelegate = (method: string, params: any, timeoutMs?: number) => Promise<any>;
let appServerDelegate: CodexAppServerDelegate | null = null;
export function setCodexAppServerDelegate(next: CodexAppServerDelegate | null) { appServerDelegate = next; }
export function codexAppServerDelegated() { return appServerDelegate !== null; }

export async function withCodexAppServer<T>(cwd: string, timeoutMs: number, run: (client: CodexAppServerClient) => Promise<T>): Promise<T> {
  if (appServerDelegate) {
    // Only `request` is reachable from these callbacks; the delegate refuses
    // anything outside its allowlist rather than silently doing nothing.
    const remote = { alive: true, request: (method: string, params: any, requestTimeoutMs?: number) => appServerDelegate!(method, params, requestTimeoutMs) };
    return run(remote as unknown as CodexAppServerClient);
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const client = await acquirePooled(cwd, timeoutMs);
    try {
      const result = await run(client);
      if (pooled?.client === client) pooled.lastUsed = Date.now();
      return result;
    } catch (error) {
      const dead = !client.alive || /exited|closed/i.test(error instanceof Error ? error.message : "");
      if (dead) { dropPool(client); if (attempt === 0) continue; }
      throw error;
    }
  }
  throw new Error("Codex app-server pool retry exhausted.");
}
