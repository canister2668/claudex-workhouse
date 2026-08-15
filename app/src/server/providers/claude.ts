import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {conversationAttachmentPaths} from "../conversation-attachments.js";
import { spawn } from "node:child_process";
import type { AppConfig } from "../config.js";
import { DeckDatabase } from "../db/client.js";
import { runCommand, stripAnsi } from "../process.js";
import type { AgentProvider, CreateTaskInput, DeckTask, ProjectConfig, UnifiedStatus } from "../types.js";
import { automationLevel } from "../automation-level.js";
import { normalizeDelegationSettings } from "../delegation-settings.js";
import { localizedTaskSuffix, normalizeStoredLocale } from "../ui-locale.js";
import {resolveExecutionPolicy} from "../execution-policy.js";
import { resolveTranscriptFile } from "../claude-transcript.js";
import { streamFile } from "../stream-events.js";
import {CLAUDE_FALLBACK_MODELS} from "../claude-model-catalog.js";
import {normalizeClaudeExecutionSettings} from "../claude-execution-settings.js";
import { ProviderTaskSnapshotCache } from "../provider-task-snapshot.js";
import { hideOwnedProviderSessionMirrors } from "../provider-session-mirrors.js";
import { ensureTaskTempDirectory } from "../workspace-temp.js";
import { sanitizeSensitiveValue } from "../sensitive-data.js";
import { seedTaskEmotion } from "../task-emotion-seed.js";
import {prepareExternalMcpEnvironment} from "../external-mcp-runtime.js";
import{workspaceInstructionFollowUpMetadata}from"../workspace-instructions.js";
import{emotionMcpEnvironment}from"../emotion-mcp-policy.js";

function now() { return new Date().toISOString(); }

const EXTERNAL_ACTIVITY_GRACE_MS=120_000;
const EXTERNAL_ACTIVE_STATUSES=new Set(["pending","queued","running","waiting"]);
const EXTERNAL_KNOWN_STATUSES=new Set(["pending","queued","running","waiting","completed","failed","stopped","unknown"]);

export function inferExternalClaudeStatus(input:{agentKind:string|null;transcriptMtimeMs:number;previousStatus?:string|null;agentsListingOk:boolean;nowMs?:number}):UnifiedStatus{
  const nowMs=input.nowMs??Date.now(),recent=Number.isFinite(input.transcriptMtimeMs)&&nowMs-input.transcriptMtimeMs<=EXTERNAL_ACTIVITY_GRACE_MS;
  if(input.agentKind)return input.agentKind==="interactive"&&nowMs-input.transcriptMtimeMs>15_000?"waiting" as const:"running" as const;
  if(!input.agentsListingOk)return EXTERNAL_KNOWN_STATUSES.has(input.previousStatus??"")?input.previousStatus as UnifiedStatus:"completed";
  // `claude agents` can briefly omit the main interactive process while its
  // transcript is still being written. Absence alone is not terminal proof.
  if(recent)return EXTERNAL_ACTIVE_STATUSES.has(input.previousStatus??"")?input.previousStatus as "pending"|"queued"|"running"|"waiting":"running" as const;
  return "completed" as const;
}

function claudeSessionId(task:DeckTask){
  return task.providerSessionId??task.threadId;
}

// Kept as the Claude-facing name for the provider-wide mirror rule.
export const hideOwnedClaudeSessionMirrors=hideOwnedProviderSessionMirrors;

export class ClaudeProvider implements AgentProvider {
  readonly id = "claude" as const;
  readonly capabilities = { supportsMcpEvents: false, supportsEmotionRendering: false } as const;
  static readonly permissions = [
    { id: ":read-only", description: "Read only", allowed: true },
    { id: ":workspace-write", description: "Workspace edit (acceptEdits)", allowed: true },
    { id: ":danger-full-access", description: "Full access · edits + Bash (bypass)", allowed: true }
  ];
  static readonly validProfiles = new Set(ClaudeProvider.permissions.map((item) => item.id));
  // Full model IDs on purpose — aliases are remapped on this install (the
  // user's "haiku" alias is deliberately rerouted to Opus 4.6 1M), so explicit
  // IDs are the only unambiguous way to pick a model.
  static readonly models = CLAUDE_FALLBACK_MODELS.map(({id,displayName})=>({id,displayName}));
  // Reasoning effort maps to the official CLI `--effort` flag (low..max). "default"
  // means "omit the flag" so the runtime's own default (settings.json) applies.
  static readonly efforts = [
    { id: "default", displayName: "Default (CLI setting)" },
    { id: "low", displayName: "Low" },
    { id: "medium", displayName: "Medium" },
    { id: "high", displayName: "High" },
    { id: "xhigh", displayName: "Extra high" },
    { id: "max", displayName: "Maximum" }
  ];
  static readonly validEfforts = new Set(["low", "medium", "high", "xhigh", "max"]);
  private stateDir: string;
  private taskListRefresh:Promise<void>|null=null;
  private taskListRefreshStartedAt=0;
  private workerStateSignatures=new Map<string,{dev:number;ino:number;size:number;mtimeMs:number}>();
  private reservedOwnedSessions=new Set<string>();
  private taskSnapshot:ProviderTaskSnapshotCache;
  constructor(private config: AppConfig, private db: DeckDatabase) {
    this.stateDir = path.join(config.dataDir, "claude-jobs");
    this.taskSnapshot = new ProviderTaskSnapshotCache(db, "claude");
    fs.mkdirSync(this.stateDir, { recursive: true });
  }

  private stateFile(id: string) { return path.join(this.stateDir, `${id.replaceAll(":", "_")}.json`); }
  warmTaskSnapshot(startupTasks:DeckTask[]){this.taskSnapshot.prime(startupTasks.filter(task=>task.provider==="claude"));}
  private async refresh(task: DeckTask): Promise<DeckTask> {
    const stateFile=this.stateFile(task.id);let stat:fs.Stats;
    try{stat=fs.statSync(stateFile);}catch{return task;}
    const signature={dev:stat.dev,ino:stat.ino,size:stat.size,mtimeMs:stat.mtimeMs},previous=this.workerStateSignatures.get(task.id),same=Boolean(previous&&previous.dev===signature.dev&&previous.ino===signature.ino&&previous.size===signature.size&&previous.mtimeMs===signature.mtimeMs),active=["pending","queued","running","waiting","unknown"].includes(task.status);
    if(same&&(!active||this.processMatches(task)))return task;
    this.workerStateSignatures.set(task.id,signature);
    let state:any;try{state=JSON.parse(fs.readFileSync(stateFile,"utf8"));}catch{return task;}
    const merged:DeckTask={ ...task, threadId: state.sessionId ?? task.threadId, providerSessionId:state.sessionId??task.providerSessionId??task.threadId, status: state.status as UnifiedStatus, updatedAt: state.updatedAt ?? task.updatedAt, result: state.result ?? task.result, error: state.error ?? null, log: stripAnsi(state.log ?? task.log), pid: state.pid ?? task.pid, pgid: state.pgid ?? task.pgid, processStart: state.processStart ?? task.processStart, metadata:{...task.metadata,activity:state.activity ?? task.metadata?.activity,contextUsage:state.contextUsage??task.metadata?.contextUsage,outputUsage:state.outputUsage??task.metadata?.outputUsage,contextCapabilities:state.contextCapabilities??task.metadata?.contextCapabilities} };
    if(["pending","queued","running","waiting"].includes(merged.status)&&!this.processMatches(merged)){
      const updatedAt=state.startedAt??state.updatedAt??task.updatedAt;merged.status="stopped";merged.updatedAt=updatedAt;
      merged.metadata={...merged.metadata,interruptionCause:"worker-process-lost",interruptionDetectedAt:new Date().toISOString()};
      try{fs.writeFileSync(this.stateFile(task.id),`${JSON.stringify({...state,status:"stopped",updatedAt,error:state.error??"Worker process is no longer running."})}\n`,"utf8");}catch{/* DB state still self-heals */}
    }
    if(task.threadId===merged.threadId&&task.providerSessionId===merged.providerSessionId&&task.status===merged.status&&task.updatedAt===merged.updatedAt&&task.result===merged.result&&task.error===merged.error&&task.log===merged.log&&task.pid===merged.pid&&task.pgid===merged.pgid&&task.processStart===merged.processStart&&JSON.stringify(task.metadata??{})===JSON.stringify(merged.metadata??{}))return task;
    // State-file timestamps can sit behind the snapshot watermark; keep the
    // cache in step or a delta pass would silently revert this row.
    const upserted=await this.db.upsertTask(merged);
    this.taskSnapshot.applyAll([upserted]);
    return upserted;
  }

  private sessionMeta(file: string): { title: string; cwd: string | null } {
    let title = "Claude session";
    let cwd: string | null = null;
    try {
      const fd = fs.openSync(file, "r");
      const buffer = Buffer.alloc(16384);
      const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
      fs.closeSync(fd);
      let found = false;
      for (const line of buffer.subarray(0, bytes).toString("utf8").split("\n")) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          if (!cwd && typeof entry.cwd === "string" && entry.cwd.startsWith("/")) cwd = entry.cwd;
          if (!found && entry.type === "summary" && entry.summary) { title = String(entry.summary).replace(/\s+/g, " ").slice(0, 80); found = true; }
          if (!found && entry.type === "user") {
            const content = entry.message?.content;
            const text = typeof content === "string" ? content : Array.isArray(content) ? content.find((p: any) => p.type === "text")?.text ?? "" : "";
            if (text.trim() && !text.startsWith("<")) { title = text.replace(/\s+/g, " ").slice(0, 80); found = true; }
          }
          if (found && cwd) break;
        } catch { /* partial line */ }
      }
    } catch { /* unreadable */ }
    return { title, cwd };
  }

  // Every local Claude Code session (VSCode, CLI, Claudex Workhouse) lives in
  // ~/.claude/projects/<cwd-slug>/<sessionId>.jsonl. Listing that store per
  // configured project makes Claudex Workhouse show the same sessions "여기" does.
  async listTasks(scope?: "all"): Promise<DeckTask[]> {
    // Polled every 8s by the main task list; the full listProviderTasks scan
    // this used to run was a steady load on the serialized database worker.
    const stored=await this.taskSnapshot.load().catch(()=>this.taskSnapshot.current());
    this.scheduleTaskListRefresh(stored,scope);
    return hideOwnedClaudeSessionMirrors(stored);
  }

  private scheduleTaskListRefresh(stored:DeckTask[],scope?:"all"){
    if(this.taskListRefresh||Date.now()-this.taskListRefreshStartedAt<5000)return;
    this.taskListRefreshStartedAt=Date.now();
    this.taskListRefresh=this.refreshTaskList(stored,scope).catch(()=>{}).finally(()=>{this.taskListRefresh=null;});
  }

  private ownsSession(sessionId:string){
    return this.reservedOwnedSessions.has(sessionId)||this.taskSnapshot.current().some(task=>task.owned&&claudeSessionId(task)===sessionId);
  }

  async excludeExternalSession(sessionId:string){
    if(!sessionId)return;
    this.reservedOwnedSessions.add(sessionId);
    await this.deleteSessionMirror(sessionId);
  }

  async excludeOwnedProviderSessions(tasks:DeckTask[]){
    const sessions=new Set(tasks.filter(task=>task.owned&&(task.provider==="deepseek"||task.provider==="ollama")).map(claudeSessionId).filter((sessionId):sessionId is string=>Boolean(sessionId)));
    await Promise.all([...sessions].map(sessionId=>this.excludeExternalSession(sessionId)));
  }

  private async deleteSessionMirror(sessionId:string){
    const id=`claude:external:${sessionId}`;
    if(await this.db.deleteExternalTaskMirror("claude",id,sessionId))this.taskSnapshot.remove(id);
  }

  private async refreshTaskList(stored:DeckTask[],scope?:"all") {
    const refreshed = await Promise.all(stored.filter((task) => task.owned).map((task) => this.refresh(task)));
    const ownedThreads = new Set(refreshed.map(claudeSessionId).filter(Boolean));
    const mirrorCandidates=new Set(stored.filter(task=>!task.owned&&claudeSessionId(task)).map(task=>claudeSessionId(task) as string));
    await Promise.all([...ownedThreads].filter(sessionId=>mirrorCandidates.has(sessionId as string)).map(sessionId=>this.deleteSessionMirror(sessionId as string)));
    const visibleExternal=new Set(stored.filter(task=>!task.owned&&claudeSessionId(task)).map(task=>claudeSessionId(task) as string));
    const knownExternal=await(this.db.listProviderTaskRefreshRows?.(this.id)??Promise.resolve(stored)).catch(()=>stored);
    const externalStored = new Map([...knownExternal,...stored].filter((task) => !task.owned && claudeSessionId(task) && !ownedThreads.has(claudeSessionId(task))).map((task) => [claudeSessionId(task) as string, task]));
    const running = new Map<string,{kind:string|null}>();
    const agents = await runCommand(this.config.claudeBinary, ["agents", "--json", "--all"], { cwd: this.config.root, timeoutMs: this.config.commandTimeoutMs, outputLimit: this.config.commandOutputLimit }).catch(() => null);
    let agentsListingOk=false;
    if (agents?.exitCode === 0) {
      try { for (const item of JSON.parse(agents.stdout)) if (item.sessionId) running.set(item.sessionId,{kind:typeof item.kind==="string"?item.kind:null});agentsListingOk=true; } catch { /* preserve previous states */ }
    }
    // Stored external sessions can outlive Claude's agents list. Do not let an
    // old DB row keep the global avatar in "running" forever when Claude
    // confirms that session is no longer active.
    for(const task of agentsListingOk?externalStored.values():[]){
      const inferred=inferExternalClaudeStatus({agentKind:running.get(task.threadId??"")?.kind??null,transcriptMtimeMs:Date.parse(task.updatedAt),previousStatus:task.status,agentsListingOk});
      if(task.threadId&&EXTERNAL_ACTIVE_STATUSES.has(task.status)&&inferred==="completed"){
        const completed=await this.db.upsertTask({...task,status:"completed",updatedAt:task.updatedAt});
        refreshed.push(completed);externalStored.set(task.threadId,completed);
      }
    }
    const home = process.env.HOME || os.homedir();
    const store = path.join(home, ".claude", "projects");
    const slugToProject = new Map(this.config.projects.filter((item) => item.enabled).map((item) => [item.realPath.replaceAll("/", "-"), item]));
    // Default scope: only configured project folders. scope=all: every local
    // session folder — unconfigured ones get a "dir:<slug>" pseudo project and
    // their real cwd recovered from the transcript itself.
    let slugs: string[] = [...slugToProject.keys()];
    if (scope === "all") { try { slugs = fs.readdirSync(store).filter((name) => { try { return fs.statSync(path.join(store, name)).isDirectory(); } catch { return false; } }); } catch { /* keep configured */ } }
    for (const slug of slugs) {
      const project = slugToProject.get(slug) ?? null;
      const dir = path.join(store, slug);
      let files: string[] = [];
      try { files = fs.readdirSync(dir).filter((name) => name.endsWith(".jsonl")); } catch { continue; }
      for (const name of files) {
        const sessionId = name.slice(0, -6);
        if (ownedThreads.has(sessionId)||this.ownsSession(sessionId)) continue; // an owned task already represents this session
        let stat: fs.Stats;
        try { stat = fs.statSync(path.join(dir, name)); } catch { continue; }
        const updatedAt = new Date(stat.mtimeMs).toISOString();
        const agent=running.get(sessionId);
        const previous = externalStored.get(sessionId);
        const status=inferExternalClaudeStatus({agentKind:agent?.kind??null,transcriptMtimeMs:stat.mtimeMs,previousStatus:previous?.status,agentsListingOk});
        if (previous && previous.updatedAt === updatedAt && previous.status === status) {
          if(this.ownsSession(sessionId))await this.deleteSessionMirror(sessionId);else if(visibleExternal.has(sessionId))refreshed.push(previous);
          continue;
        }
        const meta = previous && previous.updatedAt === updatedAt ? { title: previous.title, cwd: previous.cwd ?? null } : this.sessionMeta(path.join(dir, name));
        if(this.ownsSession(sessionId))continue;
        mirrorCandidates.add(sessionId);
        const imported=await this.db.upsertTask({
          id: `claude:external:${sessionId}`, provider: "claude", nativeId: sessionId, threadId: sessionId,
          projectId: project?.id ?? `dir:${slug}`, cwd: meta.cwd ?? project?.realPath ?? null,
          title: typeof previous?.metadata?.customTitle==="string"?previous.metadata.customTitle:meta.title, prompt: "", status,
          createdAt: previous?.createdAt ?? new Date(stat.birthtimeMs || stat.mtimeMs).toISOString(), updatedAt,
          result: null, error: null, log: "Local Claude session.", owned: false, pid: null, pgid: null, processStart: null,
          commandMarker: null, parentThreadId: null, ownership: "external", source: "cli", providerSessionId:sessionId, metadata:{...previous?.metadata,externalAgentKind:agentsListingOk?agent?.kind??null:previous?.metadata?.externalAgentKind??null}
        });
        // A launch can reserve and persist this session while the serialized DB
        // worker is completing the import. Remove only the raced external row.
        if(this.ownsSession(sessionId)){await this.deleteSessionMirror(sessionId);continue;}
        refreshed.push(imported);
      }
    }
    const liveOwnedMirrors=[...mirrorCandidates].filter(sessionId=>this.ownsSession(sessionId));
    await Promise.all(liveOwnedMirrors.map(sessionId=>this.deleteSessionMirror(sessionId)));
    // Imported external sessions carry transcript mtimes as updatedAt, which
    // can predate the snapshot watermark -- a delta pass would never see them.
    this.taskSnapshot.applyAll(refreshed.filter(task=>task.owned||!claudeSessionId(task)||!this.ownsSession(claudeSessionId(task)!)));
  }

  getTask(task: DeckTask) { return task.owned ? this.refresh(task) : Promise.resolve(task); }

  private resolveProfile(value: string | null | undefined): string {
    return value && ClaudeProvider.validProfiles.has(value) ? value : ":read-only";
  }
  private resolveModel(value: string | null | undefined): string {
    return value&&(value==="default"||/^claude-[a-z0-9][a-z0-9._-]{1,90}(?:\[1m\])?$/i.test(value)) ? value : "default";
  }
  private resolveEffort(value: string | null | undefined): string {
    return value && ClaudeProvider.validEfforts.has(value) ? value : "default";
  }

  private async launch(input: CreateTaskInput, mode: "new" | "resume" | "fork", sessionId: string | null, parentThreadId: string | null, profile: string, model: string, effort: string): Promise<DeckTask> {
    const workMode=input.workMode==="plan"?"plan":input.workMode==="default"?"default":profile===":read-only"?"plan":"default",runtimeProfile=input.runtimeProfile??"default",level=automationLevel(input.automationLevel,profile),workspaceId=input.workspaceId??input.project.id;
    const executionPolicy=resolveExecutionPolicy({provider:"claude",requestedAutomation:level,hostId:input.executionHostId??"local",workspaceId,sandboxCapability:null,hostFallbackPolicy:{trustedHost:false,isolatedWorker:false},providerCapabilities:{automatic:true,confirm:false,fullAccess:true,readOnly:true},runtimeVersion:null});
    if(!executionPolicy.allowed)throw Object.assign(new Error(`Claude execution blocked before launch: ${executionPolicy.reason}. The prompt and attachments were not consumed.`),{statusCode:409,code:"AUTOMATIC_EXECUTION_BLOCKED",policy:executionPolicy});
    const nativeId = input.requestedNativeId ?? crypto.randomUUID();
    const id = `claude:${nativeId}`;
    const assignedSessionId=mode==="resume"?sessionId:crypto.randomUUID();
    if(!assignedSessionId)throw new Error("Claude session ID is unavailable.");
    const managedProviderToken=crypto.randomBytes(32).toString("base64url"),managedProviderCapabilityHash=crypto.createHash("sha256").update(managedProviderToken).digest("hex");
    const marker = `claudex-workhouse:${nativeId}`;
    const appRoot=this.config.appRoot??this.config.root,dataRoot=this.config.dataRoot??this.config.root;
    const workerPath = path.join(appRoot, "app", "dist-server", "claude-worker.js");
    const taskTempDir=ensureTaskTempDirectory(this.config.tempDir,workspaceId,"claude",id);
    const[delegationStored,executionStored]=await Promise.all([
      this.db.getSystemSetting("delegation.launch-modes").catch(()=>null),
      this.db.getSystemSetting("claude.execution").catch(()=>null)
    ]);
    const delegationSettings=normalizeDelegationSettings(delegationStored?.value);
    const claudeExecutionSettings=normalizeClaudeExecutionSettings(executionStored?.value);
    const workerEnvironment={CLAUDEX_WORKHOUSE_RUNTIME_PROFILE:runtimeProfile,CLAUDEX_WORKHOUSE_CONVERSATION_ATTACHMENTS:JSON.stringify(runtimeProfile==="conversation"?conversationAttachmentPaths(input.prompt,path.join(this.config.dataDir,"uploads")):[]),CLAUDEX_WORKHOUSE_DELEGATION_SETTINGS:JSON.stringify(delegationSettings),...emotionMcpEnvironment("claude",this.config.port,id,assignedSessionId,runtimeProfile),CLAUDEX_WORKHOUSE_MANAGED_PROVIDER_MCP_URL:`http://127.0.0.1:${this.config.port}/mcp/claudex-workhouse`,CLAUDEX_WORKHOUSE_CURRENT_TASK_ID:id,CLAUDEX_WORKHOUSE_CURRENT_SESSION_ID:assignedSessionId,CLAUDEX_WORKHOUSE_MANAGED_PROVIDER_TOKEN:managedProviderToken,CLAUDEX_WORKHOUSE_CLAUDE_SWITCH_MODELS_ON_FLAG:String(claudeExecutionSettings.switchModelsOnFlag),...(mode!=="resume"?{CLAUDEX_WORKHOUSE_CLAUDE_SESSION_ID:assignedSessionId}:{})};
    const externalMcp=await prepareExternalMcpEnvironment({db:this.db,taskTempDir,taskId:id,provider:"claude",runtimeProfile,port:this.config.port});
    const providerPrompt=[input.prompt,externalMcp.promptSuffix].filter(Boolean).join("\n\n");
    const createdAt = now();
    let task: DeckTask = { id, provider: "claude", nativeId, threadId: assignedSessionId,providerSessionId:assignedSessionId, projectId: input.project.id, cwd: input.project.realPath, title: input.title ?? input.prompt.replace(/\s+/g, " ").slice(0, 80), prompt: input.prompt, status: "pending", createdAt, updatedAt: createdAt, result: null, error: null, log: "Claude worker starting.", owned: true, pid: null, pgid: null, processStart: null, commandMarker: marker, parentThreadId, permissionProfile: profile, requestedModel: model === "default" ? null : model, requestedReasoningEffort: effort === "default" ? null : effort, settingsUpdatedAt: createdAt, executionHostId:input.executionHostId??"local",workspaceId:input.workspaceId??null,workChainId:input.workChainId??null,metadata:{...(input.boardRole?{boardRole:input.boardRole}:{}),workMode,runtimeProfile,automationLevel:level,switchModelsOnFlag:claudeExecutionSettings.switchModelsOnFlag,managedProviderCapabilityHash,...externalMcp.metadata,tempDirectory:taskTempDir,requestedAutomation:executionPolicy.requestedAutomation,effectiveSandbox:executionPolicy.effectiveSandbox,effectiveApprovalPolicy:executionPolicy.effectiveApprovalPolicy,executionBackend:executionPolicy.executionBackend,executionUiLabel:executionPolicy.uiLabel} };
    if(mode!=="resume")this.reservedOwnedSessions.add(assignedSessionId);
    try{
      task=await this.db.upsertTask(task);this.taskSnapshot.applyAll([task]);await this.deleteSessionMirror(assignedSessionId).catch(()=>{});
      seedTaskEmotion(dataRoot,"claude",id,assignedSessionId);
      const child = spawn(process.execPath, [workerPath, this.stateFile(id), id, this.config.claudeBinary, mode, input.project.realPath, marker, profile, model, effort, workMode, sessionId ?? "", providerPrompt], { cwd: input.project.realPath, detached: true, shell: false, windowsHide: true, stdio: "ignore",env:{...process.env,
        CLAUDEX_WORKHOUSE_ROOT:appRoot,CLAUDEX_WORKHOUSE_APP_ROOT:appRoot,CLAUDEX_WORKHOUSE_DATA_ROOT:dataRoot,TMPDIR:taskTempDir,TMP:taskTempDir,TEMP:taskTempDir,...workerEnvironment,...externalMcp.environment} });
      child.unref();
      task=await this.db.upsertTask({...task,log:"Claude worker started.",pid:child.pid??null,pgid:child.pid??null});this.taskSnapshot.applyAll([task]);
      return task;
    }finally{if(mode!=="resume")this.reservedOwnedSessions.delete(assignedSessionId);}
  }

  // Any local session with a confirmed ID can be resumed/forked — the same
  // `claude --resume` the CLI itself would run, so external sessions are no
  // longer read-only in Claudex Workhouse.
  createTask(input: CreateTaskInput) { const profile=input.workMode==="plan"?":read-only":this.resolveProfile(input.permissionProfile);return this.launch(input, "new", null, null, profile, this.resolveModel(input.model), this.resolveEffort(input.reasoningEffort)); }
  // Resolves the working directory for a session: a configured project, or —
  // for scope=all sessions in unconfigured folders — the cwd recovered from
  // the transcript (Claude already ran there, so it is a known-good path).
  private sessionProject(task: DeckTask): ProjectConfig {
    const project = this.config.projects.find((item) => item.id === task.projectId);
    if (project) return project;
    if (task.cwd) {
      try { if (fs.statSync(task.cwd).isDirectory()) return { id: task.projectId, name: task.cwd, path: task.cwd, realPath: task.cwd, enabled: true, error: null }; } catch { /* fall through */ }
    }
    throw Object.assign(new Error("Session working directory is unavailable."), { statusCode: 404 });
  }
  async sendMessage(task: DeckTask, prompt: string) {
    if (!task.threadId) throw new Error("Claude sessions need a confirmed session ID before they can be resumed.");
    const customTitle=typeof task.metadata?.customTitle==="string"?task.metadata.customTitle:null;
    const next=await this.launch({ project: this.sessionProject(task), prompt,title:customTitle??task.title, workMode:task.metadata?.workMode==="plan"?"plan":"default",runtimeProfile:task.metadata?.runtimeProfile==="conversation"||task.metadata?.runtimeProfile==="browser"?task.metadata.runtimeProfile:"default",automationLevel:automationLevel(task.metadata?.automationLevel,task.permissionProfile),executionHostId:task.executionHostId??"local",workspaceId:task.workspaceId??null }, "resume", task.threadId, task.threadId, this.resolveProfile(task.permissionProfile), this.resolveModel(task.requestedModel), this.resolveEffort(task.requestedReasoningEffort));
    return this.db.upsertTask({...next,...(customTitle?{title:customTitle}:{}),metadata:{...workspaceInstructionFollowUpMetadata(task.metadata,next.metadata),...(customTitle?{customTitle}:{})}});
  }
  async compactThread(task: DeckTask) {
    if (!task.threadId) throw new Error("Claude sessions need a confirmed session ID before context compaction.");
    const customTitle=typeof task.metadata?.customTitle==="string"?task.metadata.customTitle:null;
    const locale=normalizeStoredLocale((await this.db.getSystemSetting("ui.locale").catch(()=>null))?.value)??"ko",next=await this.launch({ project:this.sessionProject(task),prompt:"/compact",title:customTitle??`${task.title} · ${localizedTaskSuffix(locale,"compact")}`,workMode:task.metadata?.workMode==="plan"?"plan":"default",runtimeProfile:task.metadata?.runtimeProfile==="conversation"||task.metadata?.runtimeProfile==="browser"?task.metadata.runtimeProfile:"default",executionHostId:task.executionHostId??"local",workspaceId:task.workspaceId??null },"resume",task.threadId,task.threadId,this.resolveProfile(task.permissionProfile),this.resolveModel(task.requestedModel),this.resolveEffort(task.requestedReasoningEffort));
    return customTitle?this.db.upsertTask({...next,title:customTitle,metadata:{...next.metadata,customTitle}}):next;
  }
  async forkThread(task: DeckTask) {
    if (!task.threadId) throw new Error("Claude sessions need a confirmed session ID before they can be forked.");
    return this.launch({ project: this.sessionProject(task), prompt: "Continue this branch from the inherited context.",workMode:task.metadata?.workMode==="plan"?"plan":"default",runtimeProfile:task.metadata?.runtimeProfile==="conversation"||task.metadata?.runtimeProfile==="browser"?task.metadata.runtimeProfile:"default",executionHostId:task.executionHostId??"local",workspaceId:task.workspaceId??null }, "fork", task.threadId, task.threadId, this.resolveProfile(task.permissionProfile), this.resolveModel(task.requestedModel), this.resolveEffort(task.requestedReasoningEffort));
  }

  async deleteSession(task:DeckTask){
    if(task.executionHostId&&task.executionHostId!=="local")throw Object.assign(new Error("Remote Claude sessions cannot be deleted from this host."),{statusCode:409});
    if(!task.threadId||!/^[0-9a-f-]{36}$/i.test(task.threadId))throw Object.assign(new Error("Claude session ID is unavailable."),{statusCode:409});
    const linked=await this.db.listProviderTasks("claude"),members:DeckTask[]=[];
    for(const item of linked)if(item.threadId===task.threadId)members.push(item.owned?await this.refresh(item):item);
    if(members.some(item=>["pending","queued","running","waiting","unknown"].includes(item.status)))throw Object.assign(new Error("Stop the Claude session before deleting its record."),{statusCode:409});
    const cwd=task.cwd??members.find(item=>item.cwd)?.cwd;
    if(!cwd||!path.isAbsolute(cwd))throw Object.assign(new Error("Claude session working directory is unavailable."),{statusCode:409});
    const transcript=resolveTranscriptFile(cwd,task.threadId);
    const projectsRoot=path.resolve(process.env.HOME||os.homedir(),".claude","projects"),transcriptParent=path.dirname(transcript);
    if(transcriptParent!==projectsRoot&&!transcriptParent.startsWith(`${projectsRoot}${path.sep}`))throw Object.assign(new Error("Claude session transcript path is invalid."),{statusCode:409});
    if(fs.existsSync(transcriptParent)&&fs.existsSync(projectsRoot)){const realRoot=fs.realpathSync(projectsRoot),realParent=fs.realpathSync(transcriptParent);if(realParent!==realRoot&&!realParent.startsWith(`${realRoot}${path.sep}`))throw Object.assign(new Error("Claude session transcript path leaves the Claude store."),{statusCode:409});}
    let stat:fs.Stats|null=null;try{stat=fs.lstatSync(transcript);}catch(error:any){if(error?.code!=="ENOENT")throw error;}
    if(stat&&!stat.isFile())throw Object.assign(new Error("Claude session transcript is not a regular file."),{statusCode:409});
    fs.rmSync(transcript,{force:true});
    for(const item of members){
      const state=this.stateFile(item.id),spool=streamFile(this.config.dataRoot??this.config.root,item.id);
      fs.rmSync(state,{force:true});fs.rmSync(`${state}.approvals`,{recursive:true,force:true});fs.rmSync(`${state}.user-input`,{recursive:true,force:true});
      fs.rmSync(spool,{force:true});fs.rmSync(`${spool}.1`,{force:true});this.workerStateSignatures.delete(item.id);
    }
    const deletedTasks=await this.db.deleteTaskSession("claude",task.threadId);
    this.taskSnapshot.invalidate();
    return{threadId:task.threadId,deleted:true,deletedTasks};
  }

  private processMatches(task: DeckTask) {
    if (!task.pid || !task.pgid || !task.commandMarker || !task.processStart) return false;
    try {
      const stat = fs.readFileSync(`/proc/${task.pid}/stat`, "utf8").split(" ");
      const start = stat[21];
      const pgid = Number(stat[4]);
      const cmd = fs.readFileSync(`/proc/${task.pid}/cmdline`, "utf8").replaceAll("\0", " ");
      return start === task.processStart && pgid === task.pgid && cmd.includes("claude-worker.js") && cmd.includes(task.commandMarker);
    } catch { return false; }
  }

  async stopTask(task: DeckTask): Promise<DeckTask> {
    task = await this.refresh(task);
    if (!task.owned) throw Object.assign(new Error("External Claude sessions cannot be stopped by Claudex Workhouse."), { statusCode: 403 });
    if (!this.processMatches(task)) throw Object.assign(new Error("Claude process identity no longer matches the recorded worker."), { statusCode: 409 });
    process.kill(-task.pgid!, "SIGTERM");
    for (let i = 0; i < 20; i++) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (!this.processMatches(task)) return this.db.upsertTask({ ...task, status: "stopped", updatedAt: now() });
    }
    if (this.processMatches(task)) process.kill(-task.pgid!, "SIGKILL");
    return this.db.upsertTask({ ...task, status: "stopped", updatedAt: now() });
  }

  async healthCheck() {
    const result = await runCommand(this.config.claudeBinary, ["agents", "--json"], { cwd: this.config.root, timeoutMs: this.config.commandTimeoutMs, outputLimit: this.config.commandOutputLimit });
    return { ok: result.exitCode === 0, detail: sanitizeSensitiveValue(result.exitCode === 0 ? JSON.parse(result.stdout) : result.stderr) };
  }
}
