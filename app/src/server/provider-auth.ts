import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { AppConfig } from "./config.js";
import { runCommand } from "./process.js";
import { CodexAppServerClient, AppServerError, withCodexAppServer } from "./codex/app-server.js";
import {antigravityBinary,antigravityEnvironment,antigravityHome} from "./antigravity-environment.js";
import {DEFAULT_ANTIGRAVITY_EXECUTION,usesVertexCredentials,type AntigravityExecutionSettings} from "./antigravity-execution-settings.js";
import {vertexCredentialInfo} from "./vertex-ai.js";

export type AuthProvider = "codex" | "claude" | "antigravity"|"grok";
export type AccountState = "unavailable" | "disconnected" | "unknown" | "connected";
export type LoginMethod = "device" | "browser" | "subscription" | "console" | "sso" | "google-oauth" | "google-cloud";
export type AttemptState = "starting" | "waiting" | "code_required" | "verifying" | "completed" | "failed" | "cancelled" | "timeout";

export type ProviderAccount = {
  provider: AuthProvider;
  state: AccountState;
  accountType: string | null;
  planType: string | null;
  emailMasked: string | null;
  errorCategory: string | null;
  checkedAt: string;
};

export type AuthEvent = {
  type: `auth/${string}`;
  provider: AuthProvider;
  attemptId: string;
  state: AttemptState;
  at: string;
  url?: string;
  userCode?: string;
  errorCategory?: string;
};

export type PublicAttempt = {
  provider: AuthProvider;
  attemptId: string;
  method: LoginMethod;
  state: AttemptState;
  createdAt: string;
  expiresAt: string;
  url: string | null;
  userCode: string | null;
  codeRequired: boolean;
  errorCategory: string | null;
  inputNonce?: string;
};

type AuditRecord = { actor:string; provider:AuthProvider; method:LoginMethod; outcome:string; category:string|null; startedAt:string; finishedAt:string|null };
type InternalAttempt = {
  provider: AuthProvider;
  id: string;
  method: LoginMethod;
  actor: string;
  state: AttemptState;
  createdAt: string;
  expiresAt: string;
  url: string | null;
  userCode: string | null;
  codeRequired: boolean;
  errorCategory: string | null;
  inputNonce: string | null;
  listeners: Set<(event:AuthEvent)=>void>;
  lastEvent: AuthEvent;
  timeout: NodeJS.Timeout;
  cleanup: NodeJS.Timeout | null;
  codexClient?: CodexAppServerClient;
  loginId?: string;
  child?: ChildProcessWithoutNullStreams;
  windowsChild?:ChildProcess;
  windowsPoll?:NodeJS.Timeout;
  pid?: number;
  pgid?: number;
  processStart?: string | null;
  marker?: string;
  helperReady?: boolean;
  environmentMatch?: boolean;
  codeSubmitted?: boolean;
  verificationStarted?: boolean;
  workDir?: string;
};

const TERMINAL = new Set<AttemptState>(["completed","failed","cancelled","timeout"]);
const CLAUDE_AUTH_HOSTS = new Set(["claude.com", "platform.claude.com"]);
const OPENAI_AUTH_HOSTS = new Set(["auth.openai.com", "chatgpt.com", "platform.openai.com"]);
const ANTIGRAVITY_AUTH_HOSTS = new Set(["accounts.google.com"]);
const GROK_AUTH_HOSTS=new Set(["grok.com","auth.x.ai","accounts.x.ai"]);
const AUTH_TIMEOUT_MS = 5 * 60_000;
const ATTEMPT_RETENTION_MS = 60_000;
const STATUS_TIMEOUT_MS = 15_000;
const OUTPUT_LIMIT = 64 * 1024;

export const providerAuthLimits = { timeoutMs:AUTH_TIMEOUT_MS, statusTimeoutMs:STATUS_TIMEOUT_MS, maxProviderAttempts:1, maxTotalAttempts:2, outputLimit:OUTPUT_LIMIT } as const;
export const claudeAuthHosts = [...CLAUDE_AUTH_HOSTS] as const;
export const antigravityAuthHosts = [...ANTIGRAVITY_AUTH_HOSTS] as const;
export const grokAuthHosts=[...GROK_AUTH_HOSTS]as const;

export class ProviderAuthError extends Error {
  constructor(message:string, readonly code:string, readonly statusCode=400) { super(message); }
}

function now(){ return new Date().toISOString(); }
function active(attempt:InternalAttempt){ return !TERMINAL.has(attempt.state); }

export function maskEmail(value:unknown){
  if(typeof value!=="string"||!value.includes("@"))return null;
  const [local,domain]=value.split("@",2);if(!local||!domain)return null;
  return `${local.slice(0,1)}***@${domain}`;
}

function safeUrl(value:unknown, hosts:Set<string>){
  if(typeof value!=="string"||value.length<10||value.length>2048)return null;
  try{
    const url=new URL(value);
    if(url.protocol!=="https:"||url.username||url.password||url.port||!hosts.has(url.hostname.toLowerCase()))return null;
    return url.toString();
  }catch{return null;}
}

export function validateClaudeAuthUrl(value:unknown){ return safeUrl(value,CLAUDE_AUTH_HOSTS); }
export function validateCodexAuthUrl(value:unknown){ return safeUrl(value,OPENAI_AUTH_HOSTS); }
export function validateAntigravityAuthUrl(value:unknown){ return safeUrl(value,ANTIGRAVITY_AUTH_HOSTS); }
export function validateGrokAuthUrl(value:unknown){return safeUrl(value,GROK_AUTH_HOSTS);}
export function windowsClaudeLoginCommand(binary:string,method:LoginMethod){
  const escaped=binary.replaceAll("'","''"),flag=method==="console"?"--console":method==="sso"?"--sso":"--claudeai";
  return`& '${escaped}' auth login ${flag}`;
}

export function parseClaudeAuthStatus(stdout:string, exitCode=0):ProviderAccount{
  const checkedAt=now();
  if(exitCode!==0)return{provider:"claude",state:"unknown",accountType:null,planType:null,emailMasked:null,errorCategory:"status_failed",checkedAt};
  let value:any;try{value=JSON.parse(stdout);}catch{return{provider:"claude",state:"unknown",accountType:null,planType:null,emailMasked:null,errorCategory:"unsupported_output",checkedAt};}
  if(typeof value?.loggedIn!=="boolean")return{provider:"claude",state:"unknown",accountType:null,planType:null,emailMasked:null,errorCategory:"unsupported_output",checkedAt};
  if(!value.loggedIn)return{provider:"claude",state:"disconnected",accountType:null,planType:null,emailMasked:null,errorCategory:null,checkedAt};
  return{provider:"claude",state:"connected",accountType:typeof value.authMethod==="string"?value.authMethod:typeof value.apiProvider==="string"?value.apiProvider:null,planType:typeof value.subscriptionType==="string"?value.subscriptionType:null,emailMasked:maskEmail(value.email),errorCategory:null,checkedAt};
}

export function parseCodexAccount(value:any):ProviderAccount{
  const checkedAt=now(),account=value?.account;
  if(account&&typeof account.type==="string")return{provider:"codex",state:"connected",accountType:account.type,planType:typeof account.planType==="string"&&account.planType!=="unknown"?account.planType:null,emailMasked:maskEmail(account.email),errorCategory:null,checkedAt};
  if(value?.requiresOpenaiAuth===true)return{provider:"codex",state:"disconnected",accountType:null,planType:null,emailMasked:null,errorCategory:null,checkedAt};
  if(typeof value?.requiresOpenaiAuth==="boolean")return{provider:"codex",state:"unknown",accountType:null,planType:null,emailMasked:null,errorCategory:"status_ambiguous",checkedAt};
  return{provider:"codex",state:"unknown",accountType:null,planType:null,emailMasked:null,errorCategory:"unsupported_output",checkedAt};
}

function errorCategory(error:unknown){
  const message=error instanceof Error?error.message.toLowerCase():"";
  if(error instanceof AppServerError&&(/device|unsupported|not allowed|policy/.test(message)))return"device_code_unsupported";
  if(/timed out|timeout/.test(message))return"provider_timeout";
  if(/enoent|not found|executable/.test(message))return"runtime_unavailable";
  if(/cancel/.test(message))return"cancelled";
  return"provider_unavailable";
}

function procIdentity(pid:number){
  try{const stat=fs.readFileSync(`/proc/${pid}/stat`,"utf8").split(" ");return{start:stat[21]??null,pgid:Number(stat[4])};}catch{return{start:null,pgid:pid};}
}

function processMatches(attempt:InternalAttempt){
  if(!attempt.pid||!attempt.pgid||!attempt.marker)return false;
  try{
    const stat=fs.readFileSync(`/proc/${attempt.pid}/stat`,"utf8").split(" ");
    const cmd=fs.readFileSync(`/proc/${attempt.pid}/cmdline`,"utf8").replaceAll("\0"," ");
    const helper=attempt.provider==="antigravity"?"antigravity-auth-pty.py":"claude-auth-pty.py",commandMatch=attempt.provider==="grok"?cmd.includes(" login ")&&cmd.includes(attempt.id):cmd.includes(helper)&&cmd.includes(attempt.marker);
    return (!attempt.processStart||stat[21]===attempt.processStart)&&Number(stat[4])===attempt.pgid&&commandMatch;
  }catch{return false;}
}

export class ProviderAuthManager {
  private attempts=new Map<string,InternalAttempt>();
  private accounts=new Map<AuthProvider,ProviderAccount>();
  private statusPending:Promise<ProviderAccount[]>|null=null;
  constructor(private config:AppConfig,private record:(entry:AuditRecord)=>Promise<void>|void=()=>{},private options:{timeoutMs?:number;antigravityExecution?:()=>Promise<AntigravityExecutionSettings>}={}){}
  private async antigravityExecution(){return this.options.antigravityExecution?this.options.antigravityExecution():DEFAULT_ANTIGRAVITY_EXECUTION;}
  private appRoot(){return this.config.appRoot??this.config.root;}

  private emit(attempt:InternalAttempt,type:AuthEvent["type"],extra:Partial<AuthEvent>={}){
    const event:AuthEvent={type,provider:attempt.provider,attemptId:attempt.id,state:attempt.state,at:now(),...extra};
    attempt.lastEvent=event;for(const listener of attempt.listeners)listener(event);
  }

  private toPublic(attempt:InternalAttempt,includeNonce=false):PublicAttempt{
    return{provider:attempt.provider,attemptId:attempt.id,method:attempt.method,state:attempt.state,createdAt:attempt.createdAt,expiresAt:attempt.expiresAt,url:active(attempt)?attempt.url:null,userCode:active(attempt)?attempt.userCode:null,codeRequired:attempt.codeRequired,errorCategory:attempt.errorCategory,...(includeNonce&&attempt.inputNonce?{inputNonce:attempt.inputNonce}:{})};
  }

  private create(provider:AuthProvider,method:LoginMethod,actor:string){
    const activeAttempts=[...this.attempts.values()].filter(active);
    if(activeAttempts.some(item=>item.provider===provider))throw new ProviderAuthError("A login for this provider is already in progress.","AUTH_ALREADY_RUNNING",409);
    if(activeAttempts.length>=providerAuthLimits.maxTotalAttempts)throw new ProviderAuthError("The number of concurrent authentications was exceeded.","AUTH_LIMIT",429);
    const id=crypto.randomUUID(),createdAt=now();
    const attempt={} as InternalAttempt;
    const timeoutMs=this.options.timeoutMs??AUTH_TIMEOUT_MS;
    Object.assign(attempt,{provider,id,method,actor,state:"starting",createdAt,expiresAt:new Date(Date.now()+timeoutMs).toISOString(),url:null,userCode:null,codeRequired:false,errorCategory:null,inputNonce:provider!=="codex"?crypto.randomBytes(24).toString("base64url"):null,listeners:new Set(),cleanup:null,lastEvent:{type:"auth/start",provider,attemptId:id,state:"starting",at:createdAt}});
    attempt.timeout=setTimeout(()=>this.timeout(attempt),timeoutMs);attempt.timeout.unref?.();this.attempts.set(id,attempt);
    void this.record({actor,provider,method,outcome:"started",category:null,startedAt:createdAt,finishedAt:null});
    return attempt;
  }

  private finish(attempt:InternalAttempt,state:Extract<AttemptState,"completed"|"failed"|"cancelled"|"timeout">,category:string|null){
    if(!active(attempt))return;
    attempt.state=state;attempt.errorCategory=category;attempt.url=null;attempt.userCode=null;attempt.inputNonce=null;clearTimeout(attempt.timeout);
    const eventType=state==="completed"?"auth/completed":state==="cancelled"?"auth/cancelled":state==="timeout"?"auth/timeout":"auth/failed";
    this.emit(attempt,eventType,{...(category?{errorCategory:category}:{})});
    void attempt.codexClient?.close().catch(()=>{});attempt.codexClient=undefined;
    if(attempt.windowsPoll)clearInterval(attempt.windowsPoll);
    if(attempt.windowsChild&&!attempt.windowsChild.killed)attempt.windowsChild.kill();
    if(attempt.child&&!attempt.child.killed&&!attempt.child.stdin.destroyed&&!attempt.child.stdin.writableEnded){try{attempt.child.stdin.write(`${JSON.stringify({type:"cancel"})}\n`);}catch{}}
    if(attempt.workDir)setTimeout(()=>{try{fs.rmSync(attempt.workDir!,{recursive:true,force:true});}catch{}},2000).unref?.();
    void this.record({actor:attempt.actor,provider:attempt.provider,method:attempt.method,outcome:state,category,startedAt:attempt.createdAt,finishedAt:now()});
    attempt.cleanup=setTimeout(()=>this.attempts.delete(attempt.id),ATTEMPT_RETENTION_MS);attempt.cleanup.unref?.();
  }

  private timeout(attempt:InternalAttempt){
    if(attempt.provider==="codex"&&attempt.loginId&&attempt.codexClient)void attempt.codexClient.request("account/login/cancel",{loginId:attempt.loginId},5000).catch(()=>{});
    if(attempt.provider!=="codex")this.stopAuthProcess(attempt);
    this.finish(attempt,"timeout","auth_timeout");
  }

  private async readCodex(client?:CodexAppServerClient){
    try{const result=client?await client.request("account/read",{refreshToken:false},STATUS_TIMEOUT_MS):await withCodexAppServer(this.appRoot(),20000,c=>c.request("account/read",{refreshToken:false},STATUS_TIMEOUT_MS));return parseCodexAccount(result);}
    catch(error){return{provider:"codex",state:errorCategory(error)==="runtime_unavailable"?"unavailable":"unknown",accountType:null,planType:null,emailMasked:null,errorCategory:errorCategory(error),checkedAt:now()} as ProviderAccount;}
  }

  private async readClaude(){
    try{const result=await runCommand(this.config.claudeBinary,["auth","status"],{cwd:this.authDir(),timeoutMs:STATUS_TIMEOUT_MS,outputLimit:OUTPUT_LIMIT});if(result.timedOut)return{provider:"claude",state:"unknown",accountType:null,planType:null,emailMasked:null,errorCategory:"status_timeout",checkedAt:now()} as ProviderAccount;return parseClaudeAuthStatus(result.stdout,result.exitCode);}
    catch(error){return{provider:"claude",state:errorCategory(error)==="runtime_unavailable"?"unavailable":"unknown",accountType:null,planType:null,emailMasked:null,errorCategory:errorCategory(error),checkedAt:now()} as ProviderAccount;}
  }

  private async readAntigravity(){
    const checkedAt=now(),file=antigravityBinary(this.config),execution=await this.antigravityExecution(),accountType=usesVertexCredentials(execution.backend)?"google-cloud":"google-oauth";
    // Both Vertex backends authenticate with the same service-account key, so
    // account state is read from the credential rather than from a CLI session.
    if(usesVertexCredentials(execution.backend))try{
      const info=vertexCredentialInfo(execution);
      return{provider:"antigravity",state:"connected",accountType:"vertex-service-account",planType:null,emailMasked:maskEmail(info.clientEmail),errorCategory:null,checkedAt} as ProviderAccount;
    }catch(error){return{provider:"antigravity",state:"disconnected",accountType:"vertex-service-account",planType:null,emailMasked:null,errorCategory:errorCategory(error),checkedAt} as ProviderAccount;}
    try{
      const result=await runCommand(file,["models"],{cwd:this.authDir(),timeoutMs:STATUS_TIMEOUT_MS,outputLimit:OUTPUT_LIMIT,env:antigravityEnvironment(this.config,execution)});
      if(result.timedOut)return{provider:"antigravity",state:"unknown",accountType,planType:null,emailMasked:null,errorCategory:"status_timeout",checkedAt} as ProviderAccount;
      if(result.exitCode===0&&result.stdout.trim())return{provider:"antigravity",state:"connected",accountType,planType:null,emailMasked:null,errorCategory:null,checkedAt} as ProviderAccount;
      const output=`${result.stdout}\n${result.stderr}`.toLowerCase(),disconnected=/sign in|authentication required|not signed in/.test(output);
      return{provider:"antigravity",state:disconnected?"disconnected":"unknown",accountType,planType:null,emailMasked:null,errorCategory:disconnected?null:"status_failed",checkedAt} as ProviderAccount;
    }catch(error){return{provider:"antigravity",state:errorCategory(error)==="runtime_unavailable"?"unavailable":"unknown",accountType,planType:null,emailMasked:null,errorCategory:errorCategory(error),checkedAt} as ProviderAccount;}
  }

  private async readGrok(){
    const checkedAt=now();
    try{
      const result=await runCommand(this.config.grokBinary,["models"],{cwd:this.authDir(),timeoutMs:STATUS_TIMEOUT_MS,outputLimit:OUTPUT_LIMIT});
      const output=`${result.stdout}\n${result.stderr}`.toLowerCase(),disconnected=/not authenticated|login|required|sign in/.test(output);
      if(result.timedOut)return{provider:"grok",state:"unknown",accountType:"grok-oauth",planType:null,emailMasked:null,errorCategory:"status_timeout",checkedAt}as ProviderAccount;
      if(disconnected)return{provider:"grok",state:"disconnected",accountType:"grok-oauth",planType:null,emailMasked:null,errorCategory:null,checkedAt}as ProviderAccount;
      if(result.exitCode===0&&result.stdout.trim())return{provider:"grok",state:"connected",accountType:"grok-oauth",planType:null,emailMasked:null,errorCategory:null,checkedAt}as ProviderAccount;
      return{provider:"grok",state:disconnected?"disconnected":"unknown",accountType:"grok-oauth",planType:null,emailMasked:null,errorCategory:disconnected?null:"status_failed",checkedAt}as ProviderAccount;
    }catch(error){return{provider:"grok",state:errorCategory(error)==="runtime_unavailable"?"unavailable":"unknown",accountType:"grok-oauth",planType:null,emailMasked:null,errorCategory:errorCategory(error),checkedAt}as ProviderAccount;}
  }

  private authDir(){const dir=path.join(this.config.dataDir,"provider-auth");fs.mkdirSync(dir,{recursive:true,mode:0o700});try{fs.chmodSync(dir,0o700);}catch{}return dir;}
  private attemptDir(id:string){const dir=path.join(this.authDir(),id);fs.mkdirSync(dir,{recursive:false,mode:0o700});try{fs.chmodSync(dir,0o700);}catch{}return dir;}

  async refreshAll(){
    if(this.statusPending)return this.statusPending;
    this.statusPending=Promise.all([this.readCodex(),this.readClaude(),this.readAntigravity(),this.readGrok()]).then(items=>{for(const item of items)this.accounts.set(item.provider,item);return items;}).finally(()=>{this.statusPending=null;});
    return this.statusPending;
  }

  getCached(){return(["codex","claude","antigravity","grok"] as const).map(provider=>this.accounts.get(provider)??{provider,state:"unknown",accountType:null,planType:null,emailMasked:null,errorCategory:"not_checked",checkedAt:now()});}

  listActive(actor:string){
    return[...this.attempts.values()].filter(active).map(attempt=>this.toPublic(attempt,attempt.actor===actor));
  }

  listRecent(actor:string){
    const latest=new Map<AuthProvider,InternalAttempt>();for(const attempt of this.attempts.values())latest.set(attempt.provider,attempt);
    return[...latest.values()].map(attempt=>this.toPublic(attempt,active(attempt)&&attempt.actor===actor));
  }

  async start(provider:AuthProvider,method:LoginMethod,actor:string){
    if(provider==="codex")return this.startCodex(method,actor);
    if(provider==="claude")return this.startClaude(method,actor);
    if(provider==="grok")return this.startGrok(method,actor);
    return this.startAntigravity(method,actor);
  }

  private async startCodex(method:LoginMethod,actor:string){
    if(method!=="device"&&method!=="browser")throw new ProviderAuthError("This Codex login method is not supported.","CODEX_LOGIN_METHOD_UNSUPPORTED");
    const attempt=this.create("codex",method,actor);
    try{
      const client=await CodexAppServerClient.connect(this.appRoot(),20000);attempt.codexClient=client;
      client.onNotification=(message)=>{
        if(!active(attempt))return;
        if(message.method==="account/login/completed"&&(!message.params?.loginId||message.params.loginId===attempt.loginId))void this.completeCodex(attempt,message.params?.success===true,message.params?.error);
      };
      const result=await client.request("account/login/start",method==="device"?{type:"chatgptDeviceCode"}:{type:"chatgpt",codexStreamlinedLogin:false,useHostedLoginSuccessPage:true},20000);
      if(!active(attempt))return this.toPublic(attempt);
      attempt.loginId=typeof result?.loginId==="string"?result.loginId:undefined;
      const rawUrl=method==="device"?result?.verificationUrl:result?.authUrl;
      const url=validateCodexAuthUrl(rawUrl);
      if(!attempt.loginId||!url)throw new ProviderAuthError("The official login page could not be confirmed.","AUTH_URL_INVALID",502);
      attempt.url=url;attempt.userCode=method==="device"&&typeof result?.userCode==="string"&&result.userCode.length<=128?result.userCode:null;attempt.state="waiting";
      this.emit(attempt,"auth/url",{url,...(attempt.userCode?{userCode:attempt.userCode}:{})});return this.toPublic(attempt);
    }catch(error){const category=error instanceof ProviderAuthError?error.code.toLowerCase():errorCategory(error);this.finish(attempt,"failed",category);return this.toPublic(attempt);}
  }

  private async completeCodex(attempt:InternalAttempt,success:boolean,_providerError:unknown){
    if(!active(attempt))return;if(!success){this.finish(attempt,"failed","provider_rejected");return;}
    attempt.state="verifying";this.emit(attempt,"auth/verifying");
    const status=await this.readCodex(attempt.codexClient);this.accounts.set("codex",status);
    if(status.state==="connected")this.finish(attempt,"completed",null);else this.finish(attempt,"failed","final_verification_failed");
  }

  private async startClaude(method:LoginMethod,actor:string){
    if(!["subscription","console","sso"].includes(method))throw new ProviderAuthError("This Claude login method is not supported.","CLAUDE_LOGIN_METHOD_UNSUPPORTED");
    const attempt=this.create("claude",method,actor);const marker=`claudex-workhouse-auth:${attempt.id}`;attempt.marker=marker;attempt.workDir=this.attemptDir(attempt.id);
    if(process.platform==="win32"){
      const child=spawn("powershell.exe",["-NoLogo","-ExecutionPolicy","Bypass","-Command",windowsClaudeLoginCommand(this.config.claudeBinary,method)],{cwd:attempt.workDir,shell:false,detached:false,windowsHide:false,env:{...process.env,DISABLE_AUTOUPDATER:"1"},stdio:"ignore"});
      attempt.windowsChild=child;attempt.pid=child.pid;attempt.state="waiting";this.emit(attempt,"auth/start");
      const verify=async()=>{if(!active(attempt))return;const status=await this.readClaude();if(status.state==="connected"){this.accounts.set("claude",status);this.finish(attempt,"completed",null);}};
      attempt.windowsPoll=setInterval(()=>void verify(),2000);attempt.windowsPoll.unref?.();child.once("error",()=>this.finish(attempt,"failed","runtime_unavailable"));child.once("exit",()=>setTimeout(()=>void this.verifyClaude(attempt,"login_process_exited"),200).unref?.());
      return this.toPublic(attempt);
    }
    const appRoot=this.appRoot(),helper=path.join(appRoot,"bin","claude-auth-pty.py");
    const child=spawn("python3",[helper,this.config.claudeBinary,attempt.workDir,method,attempt.id,marker],{cwd:appRoot,shell:false,windowsHide:true,detached:true,env:process.env,stdio:["pipe","pipe","pipe"]});
    attempt.child=child;attempt.pid=child.pid;const identity=child.pid?procIdentity(child.pid):{start:null,pgid:0};attempt.processStart=identity.start;attempt.pgid=identity.pgid;
    child.stdin.on("error",()=>{/* a terminal helper may close before cleanup writes */});
    child.stderr.on("data",()=>{/* deliberately discarded: PTY helper diagnostics may contain auth material */});
    const lines=readline.createInterface({input:child.stdout});
    lines.on("line",line=>{if(line.length>8192){this.stopAuthProcess(attempt);this.finish(attempt,"failed","helper_protocol_error");return;}let message:any;try{message=JSON.parse(line);}catch{this.stopAuthProcess(attempt);this.finish(attempt,"failed","helper_protocol_error");return;}void this.handleClaudeHelper(attempt,message);});
    child.once("error",()=>this.finish(attempt,"failed","runtime_unavailable"));
    child.once("exit",()=>{setTimeout(()=>{if(active(attempt))void this.verifyClaude(attempt,"login_process_exited");},25).unref?.();});
    await new Promise<void>(resolve=>{if(attempt.codeRequired||TERMINAL.has(attempt.state)){resolve();return;}const timer=setTimeout(done,5000);function done(){clearTimeout(timer);attempt.listeners.delete(listener);resolve();}const listener=(event:AuthEvent)=>{if(event.type==="auth/code-required"||TERMINAL.has(event.state))done();};attempt.listeners.add(listener);});
    return this.toPublic(attempt,true);
  }

  private async handleClaudeHelper(attempt:InternalAttempt,message:any){
    if(!active(attempt)||message?.attemptId&&message.attemptId!==attempt.id)return;
    if(message.event==="helper/start"){
      attempt.helperReady=true;attempt.environmentMatch=message.uid===process.getuid?.()&&message.gid===process.getgid?.()&&message.home===(process.env.HOME??"")&&message.marker===attempt.marker;
      if(!attempt.environmentMatch||!processMatches(attempt)){this.stopAuthProcess(attempt);this.finish(attempt,"failed","process_identity_mismatch");return;}
      attempt.state="waiting";this.emit(attempt,"auth/start");return;
    }
    if(message.event==="helper/url"){
      const url=validateClaudeAuthUrl(message.url);if(!url){this.stopAuthProcess(attempt);this.finish(attempt,"failed","auth_url_rejected");return;}
      attempt.url=url;attempt.state=attempt.codeRequired?"code_required":"waiting";this.emit(attempt,"auth/url",{url});return;
    }
    if(message.event==="helper/code-required"){
      attempt.codeRequired=true;attempt.state="code_required";this.emit(attempt,"auth/code-required");return;
    }
    if(message.event==="helper/verifying"){attempt.state="verifying";this.emit(attempt,"auth/verifying");return;}
    if(message.event==="helper/timeout"){this.finish(attempt,"timeout","auth_timeout");return;}
    if(message.event==="helper/cancelled"){this.finish(attempt,"cancelled",null);return;}
    if(message.event==="helper/failed"){this.finish(attempt,"failed",typeof message.category==="string"?message.category:"login_process_failed");return;}
    if(message.event==="helper/exit")void this.verifyClaude(attempt,Number(message.exitCode)===0?null:"login_process_failed");
  }

  private async verifyClaude(attempt:InternalAttempt,failureCategory:string|null){
    if(!active(attempt)||attempt.verificationStarted)return;attempt.verificationStarted=true;attempt.state="verifying";this.emit(attempt,"auth/verifying");const status=await this.readClaude();this.accounts.set("claude",status);
    if(status.state==="connected")this.finish(attempt,"completed",null);else this.finish(attempt,"failed",failureCategory??"final_verification_failed");
  }

  private async startAntigravity(method:LoginMethod,actor:string){
    if(method!=="google-oauth"&&method!=="google-cloud")throw new ProviderAuthError("This Gemini login method is not supported.","ANTIGRAVITY_LOGIN_METHOD_UNSUPPORTED");
    const execution=await this.antigravityExecution();
    if(usesVertexCredentials(execution.backend))throw new ProviderAuthError("The Vertex backends use the uploaded service-account key and do not require an interactive login.","VERTEX_SERVICE_ACCOUNT_LOGIN",409);
    const runtime=antigravityBinary(this.config);
    if(!path.isAbsolute(runtime))throw new ProviderAuthError("The managed Gemini runtime is not installed.","RUNTIME_UNAVAILABLE",503);
    if(method==="google-cloud")throw new ProviderAuthError("Google Cloud interactive login is not used by Antigravity mode.","ANTIGRAVITY_CLOUD_PROFILE_REQUIRED");
    const attempt=this.create("antigravity",method,actor),marker=`claudex-workhouse-auth:${attempt.id}`;attempt.marker=marker;attempt.workDir=this.attemptDir(attempt.id);
    const appRoot=this.appRoot(),helper=path.join(appRoot,"bin","antigravity-auth-pty.py"),home=antigravityHome(this.config,"consumer");
    const child=spawn("python3",[helper,runtime,attempt.workDir,home,attempt.id,marker,method,"",""],{cwd:appRoot,shell:false,windowsHide:true,detached:true,env:antigravityEnvironment(this.config,DEFAULT_ANTIGRAVITY_EXECUTION),stdio:["pipe","pipe","pipe"]});
    attempt.child=child;attempt.pid=child.pid;const identity=child.pid?procIdentity(child.pid):{start:null,pgid:0};attempt.processStart=identity.start;attempt.pgid=identity.pgid;
    child.stdin.on("error",()=>{/* the PTY helper may close before cleanup */});child.stderr.on("data",()=>{/* deliberately discarded: may contain OAuth material */});
    const lines=readline.createInterface({input:child.stdout});
    lines.on("line",line=>{if(line.length>8192){this.stopAuthProcess(attempt);this.finish(attempt,"failed","helper_protocol_error");return;}let message:any;try{message=JSON.parse(line);}catch{this.stopAuthProcess(attempt);this.finish(attempt,"failed","helper_protocol_error");return;}void this.handleAntigravityHelper(attempt,message);});
    child.once("error",()=>this.finish(attempt,"failed","runtime_unavailable"));
    child.once("exit",()=>{setTimeout(()=>{if(active(attempt))void this.verifyAntigravity(attempt,"login_process_exited");},25).unref?.();});
    await new Promise<void>(resolve=>{if(attempt.codeRequired||TERMINAL.has(attempt.state)){resolve();return;}const timer=setTimeout(done,5000);function done(){clearTimeout(timer);attempt.listeners.delete(listener);resolve();}const listener=(event:AuthEvent)=>{if(event.type==="auth/code-required"||TERMINAL.has(event.state))done();};attempt.listeners.add(listener);});
    return this.toPublic(attempt,true);
  }

  private async startGrok(method:LoginMethod,actor:string){
    if(method!=="device"&&method!=="google-oauth")throw new ProviderAuthError("This Grok login method is not supported.","GROK_LOGIN_METHOD_UNSUPPORTED");
    const runtime=this.config.grokBinary;if(!path.isAbsolute(runtime))throw new ProviderAuthError("The Grok runtime is not installed.","RUNTIME_UNAVAILABLE",503);
    const attempt=this.create("grok",method,actor);attempt.marker=`claudex-workhouse-auth:${attempt.id}`;attempt.workDir=this.attemptDir(attempt.id);
    const leaderSocket=path.join(attempt.workDir,`grok-auth-${attempt.id}.sock`),child=spawn(runtime,["login","--device-auth","--leader-socket",leaderSocket],{cwd:attempt.workDir,shell:false,windowsHide:true,detached:true,env:{...process.env,GROK_DISABLE_AUTOUPDATER:"1"},stdio:["pipe","pipe","pipe"]});
    attempt.child=child;attempt.pid=child.pid;const identity=child.pid?procIdentity(child.pid):{start:null,pgid:0};attempt.processStart=identity.start;attempt.pgid=identity.pgid;attempt.state="waiting";this.emit(attempt,"auth/start");
    let buffered="";const consume=(chunk:unknown)=>{if(!active(attempt))return;buffered=`${buffered}${String(chunk)}`.slice(-16_384);const urlMatch=buffered.match(/https:\/\/[^\s<>'"]+/i),url=validateGrokAuthUrl(urlMatch?.[0]?.replace(/[),.;]+$/,""));if(!url)return;const around=buffered.slice(Math.max(0,(urlMatch?.index??0)-300),Math.min(buffered.length,(urlMatch?.index??0)+(urlMatch?.[0].length??0)+500)),codeMatch=around.match(/(?:code|코드)\s*(?:is|:)?\s*([A-Z0-9]{4,}(?:-[A-Z0-9]{2,})*)/i);attempt.url=url;attempt.userCode=codeMatch?.[1]?.toUpperCase().slice(0,128)??null;attempt.state="waiting";this.emit(attempt,"auth/url",{url,...(attempt.userCode?{userCode:attempt.userCode}:{})});};
    child.stdout.on("data",consume);child.stderr.on("data",consume);child.once("error",()=>this.finish(attempt,"failed","runtime_unavailable"));child.once("exit",code=>{buffered="";setTimeout(()=>{if(active(attempt))void this.verifyGrok(attempt,code===0?null:"login_process_failed");},25).unref?.();});
    await new Promise<void>(resolve=>{if(attempt.url&&attempt.userCode||TERMINAL.has(attempt.state)){resolve();return;}const timer=setTimeout(done,5000);function done(){clearTimeout(timer);attempt.listeners.delete(listener);resolve();}const listener=(event:AuthEvent)=>{if(event.type==="auth/url"&&Boolean(attempt.userCode)||TERMINAL.has(event.state))done();};attempt.listeners.add(listener);});
    return this.toPublic(attempt);
  }

  private async verifyGrok(attempt:InternalAttempt,failureCategory:string|null){
    if(!active(attempt)||attempt.verificationStarted)return;attempt.verificationStarted=true;attempt.state="verifying";this.emit(attempt,"auth/verifying");const status=await this.readGrok();this.accounts.set("grok",status);if(status.state==="connected")this.finish(attempt,"completed",null);else this.finish(attempt,"failed",failureCategory??"final_verification_failed");
  }

  private async handleAntigravityHelper(attempt:InternalAttempt,message:any){
    if(!active(attempt)||message?.attemptId&&message.attemptId!==attempt.id)return;
    if(message.event==="helper/start"){
      const home=antigravityHome(this.config,attempt.method==="google-cloud"?"vertex":"consumer");attempt.helperReady=true;attempt.environmentMatch=message.uid===process.getuid?.()&&message.gid===process.getgid?.()&&message.home===home&&message.marker===attempt.marker;
      if(!attempt.environmentMatch||!processMatches(attempt)){this.stopAuthProcess(attempt);this.finish(attempt,"failed","process_identity_mismatch");return;}
      attempt.state="waiting";this.emit(attempt,"auth/start");return;
    }
    if(message.event==="helper/url"){
      const url=validateAntigravityAuthUrl(message.url);if(!url){this.stopAuthProcess(attempt);this.finish(attempt,"failed","auth_url_rejected");return;}
      attempt.url=url;attempt.state=attempt.codeRequired?"code_required":"waiting";this.emit(attempt,"auth/url",{url});return;
    }
    if(message.event==="helper/code-required"){attempt.codeRequired=true;attempt.state="code_required";this.emit(attempt,"auth/code-required");return;}
    if(message.event==="helper/verifying"){attempt.state="verifying";this.emit(attempt,"auth/verifying");return;}
    if(message.event==="helper/timeout"){this.finish(attempt,"timeout","auth_timeout");return;}
    if(message.event==="helper/cancelled"){this.finish(attempt,"cancelled",null);return;}
    if(message.event==="helper/failed"){this.finish(attempt,"failed",typeof message.category==="string"?message.category:"login_process_failed");return;}
    if(message.event==="helper/exit")void this.verifyAntigravity(attempt,Number(message.exitCode)===0?null:"login_process_failed");
  }

  private async verifyAntigravity(attempt:InternalAttempt,failureCategory:string|null){
    if(!active(attempt)||attempt.verificationStarted)return;attempt.verificationStarted=true;attempt.state="verifying";this.emit(attempt,"auth/verifying");const status=await this.readAntigravity();this.accounts.set("antigravity",status);
    if(status.state==="connected")this.finish(attempt,"completed",null);else this.finish(attempt,"failed",failureCategory??"final_verification_failed");
  }

  async submitCode(provider:AuthProvider,id:string,nonce:string,code:string){
    const attempt=this.requireAttempt(provider,id);if(provider==="codex"||!attempt.child||!attempt.codeRequired||attempt.codeSubmitted)throw new ProviderAuthError("This attempt is not in a state that accepts an authentication code.","AUTH_CODE_NOT_EXPECTED",409);
    if(!attempt.inputNonce||nonce.length!==attempt.inputNonce.length||!crypto.timingSafeEqual(Buffer.from(nonce),Buffer.from(attempt.inputNonce)))throw new ProviderAuthError("The authentication input nonce is not valid.","AUTH_NONCE_INVALID",403);
    if(code.length<1||code.length>512||!/^[A-Za-z0-9._~+/=:#-]+$/.test(code))throw new ProviderAuthError("The authentication code format is not valid.","AUTH_CODE_INVALID");
    if(attempt.child.stdin.destroyed||attempt.child.stdin.writableEnded)throw new ProviderAuthError("The authentication process has exited.","AUTH_PROCESS_EXITED",409);attempt.codeSubmitted=true;attempt.inputNonce=null;attempt.state="verifying";attempt.child.stdin.write(`${JSON.stringify({type:"code",value:code})}\n`);code="";this.emit(attempt,"auth/verifying");return this.toPublic(attempt);
  }

  private requireAttempt(provider:AuthProvider,id:string){const attempt=this.attempts.get(id);if(!attempt||attempt.provider!==provider)throw new ProviderAuthError("The authentication attempt could not be found.","AUTH_ATTEMPT_NOT_FOUND",404);if(!active(attempt))throw new ProviderAuthError("This authentication attempt has already finished.","AUTH_ATTEMPT_FINISHED",409);return attempt;}

  async cancel(provider:AuthProvider,id:string){
    const attempt=this.requireAttempt(provider,id);
    if(provider==="codex"&&attempt.codexClient&&attempt.loginId)await attempt.codexClient.request("account/login/cancel",{loginId:attempt.loginId},5000).catch(()=>{});
    if(provider!=="codex")this.stopAuthProcess(attempt);
    this.finish(attempt,"cancelled",null);return this.toPublic(attempt);
  }

  private stopAuthProcess(attempt:InternalAttempt){
    if(attempt.child&&!attempt.child.killed&&!attempt.child.stdin.destroyed&&!attempt.child.stdin.writableEnded){try{attempt.child.stdin.write(`${JSON.stringify({type:"cancel"})}\n`);}catch{}}
    setTimeout(()=>{if(processMatches(attempt)&&attempt.pgid){try{process.kill(-attempt.pgid,"SIGTERM");}catch{}}},500).unref?.();
  }

  async logout(provider:AuthProvider){
    if([...this.attempts.values()].some(item=>item.provider===provider&&active(item)))throw new ProviderAuthError("You cannot sign out while a login is in progress.","AUTH_LOGOUT_WHILE_RUNNING",409);
    if(provider==="codex"){
      try{await withCodexAppServer(this.appRoot(),20000,c=>c.request("account/logout",{},15000));}catch{throw new ProviderAuthError("The Codex runtime could not be reached.","RUNTIME_UNAVAILABLE",503);}
      const status=await this.readCodex();this.accounts.set(provider,status);return status;
    }
    if(provider==="claude"){
      const result=await runCommand(this.config.claudeBinary,["auth","logout"],{cwd:this.authDir(),timeoutMs:30000,outputLimit:OUTPUT_LIMIT});
      if(result.timedOut||result.exitCode!==0)throw new ProviderAuthError("Claude sign-out could not be completed.",result.timedOut?"AUTH_TIMEOUT":"LOGOUT_FAILED",502);
      const status=await this.readClaude();this.accounts.set(provider,status);return status;
    }
    if(provider==="grok"){
      const result=await runCommand(this.config.grokBinary,["logout"],{cwd:this.authDir(),timeoutMs:30_000,outputLimit:OUTPUT_LIMIT});
      if(result.timedOut||result.exitCode!==0)throw new ProviderAuthError("Grok sign-out could not be completed.",result.timedOut?"AUTH_TIMEOUT":"LOGOUT_FAILED",502);
      const status=await this.readGrok();this.accounts.set(provider,status);return status;
    }
    const execution=await this.antigravityExecution();if(usesVertexCredentials(execution.backend))throw new ProviderAuthError("Replace or remove the stored service-account key in execution settings.","VERTEX_SERVICE_ACCOUNT_MANAGED",409);
    const result=await runCommand(antigravityBinary(this.config),["--print","/logout","--output-format","json","--print-timeout","30s","--log-file",process.platform==="win32"?"NUL":"/dev/null"],{cwd:this.authDir(),timeoutMs:45000,outputLimit:OUTPUT_LIMIT,env:antigravityEnvironment(this.config,execution)});
    if(result.timedOut||result.exitCode!==0)throw new ProviderAuthError("Gemini sign-out could not be completed.",result.timedOut?"AUTH_TIMEOUT":"LOGOUT_FAILED",502);
    const status=await this.readAntigravity();this.accounts.set(provider,status);if(status.state==="connected")throw new ProviderAuthError("Gemini remained connected after the official logout command.","LOGOUT_FAILED",502);return status;
  }

  subscribe(provider:AuthProvider,id:string,listener:(event:AuthEvent)=>void){
    const attempt=this.attempts.get(id);if(!attempt||attempt.provider!==provider)throw new ProviderAuthError("The authentication attempt could not be found.","AUTH_ATTEMPT_NOT_FOUND",404);
    attempt.listeners.add(listener);listener(attempt.lastEvent);return()=>attempt.listeners.delete(listener);
  }

  view(provider:AuthProvider,id:string){const attempt=this.attempts.get(id);if(!attempt||attempt.provider!==provider)throw new ProviderAuthError("The authentication attempt could not be found.","AUTH_ATTEMPT_NOT_FOUND",404);return this.toPublic(attempt);}

  shutdown(){for(const attempt of this.attempts.values()){if(active(attempt)){if(attempt.provider!=="codex")this.stopAuthProcess(attempt);this.finish(attempt,"cancelled","server_shutdown");}if(attempt.cleanup)clearTimeout(attempt.cleanup);}}
}
