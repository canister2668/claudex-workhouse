import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type { AppConfig } from "../config.js";
import { codexAppServerPoolWarm, codexRuntimeSelection, withCodexAppServer } from "../codex/app-server.js";
import { CodexCatalog } from "../codex/catalog.js";
import { DeckDatabase } from "../db/client.js";
import { runCommand, stripAnsi } from "../process.js";
import type { AgentProvider, CreateTaskInput, DeckTask, ProjectConfig, UnifiedStatus } from "../types.js";
import { listPendingApprovals, submitApprovalDecision, type ApprovalDecision } from "../approval-bridge.js";
import { listPendingUserInputs, submitUserInput, type UserInputAnswers } from "../user-input-bridge.js";
import { automationLevel, newestExecutionSettings, permissionForAutomation } from "../automation-level.js";
import { normalizeDelegationSettings } from "../delegation-settings.js";
import {executionPolicyErrorCode,osExecutionIdentity,probeNativeSandbox,resolveExecutionPolicy,sandboxEnvironmentIdentity,trustedHostOptInValid,trustedHostSettingKey,type ExecutionPolicy,type SandboxCapability} from "../execution-policy.js";
import {localizedTaskSuffix,normalizeStoredLocale} from "../ui-locale.js";
import { ProviderTaskSnapshotCache } from "../provider-task-snapshot.js";
import { ensureTaskTempDirectory } from "../workspace-temp.js";
import {mergePersistedImageOutputs} from "../image-outputs.js";
import {conversationAttachmentPaths} from "../conversation-attachments.js";
import{workspaceInstructionFollowUpMetadata}from"../workspace-instructions.js";
import {seedTaskEmotion} from "../task-emotion-seed.js";
import {prepareExternalMcpEnvironment} from "../external-mcp-runtime.js";
import{emotionMcpEnvironment}from"../emotion-mcp-policy.js";

const CX = "/usr/local/bin/cx";

// Budgets for the native thread list. The connect/request pair has to be able
// to absorb a cold app-server start; the soft deadline is what the browser
// actually waits for and stays well inside the 60s thread-list budget in
// web/api-client.ts.
const LIST_CONNECT_TIMEOUT_MS = 150000;
const LIST_REQUEST_TIMEOUT_MS = 90000;
const LIST_SOFT_DEADLINE_MS = 8000;

// How often the in-memory task snapshot is rebuilt from scratch instead of
// being advanced by an updated_at delta. A full rebuild is what notices rows
// deleted behind the snapshot's back.
const TASK_SNAPSHOT_RESYNC_MS = 300000;
const TERMINAL_TASK_STATUS = new Set(["completed","failed","stopped"]);
type ThreadSnapshot={threads:Map<string,any>;loadedAt:number;syncedAt:string|null};
type CacheCursorState={fingerprint:string;expires:number;afterUpdatedAt:string;afterId:string};

function now() { return new Date().toISOString(); }
function withoutLegacyWorkspaceApprovalMetadata(metadata:Record<string,unknown>|null|undefined){const{accessContract:_accessContract,nextAccessContract:_nextAccessContract,primaryWorkspaceId:_primaryWorkspaceId,primaryWorkspacePath:_primaryWorkspacePath,workspaceAccessMode:_workspaceAccessMode,approvedExternalPaths:_approvedExternalPaths,externalPathScopes:_externalPathScopes,externalWorkspaceModification:_externalWorkspaceModification,executionPolicyResolvedAt:_executionPolicyResolvedAt,...remaining}=metadata??{};return remaining;}
const THREAD_CACHE_FIELDS=["threadId","sessionId","projectId","cwd","title","preview","source","ownership","status","archived","parentThreadId","forkedFromId","modelProvider","requestedModel","effectiveModel","requestedReasoningEffort","effectiveReasoningEffort","requestedServiceTier","effectiveServiceTier","permissionProfile","settingsUpdatedAt","createdAt","updatedAt","executionHostId","workspaceId","workChainId","metadata"] as const;
function threadCacheNeedsWrite(previous:any,next:any){if(!previous)return true;for(const field of THREAD_CACHE_FIELDS)if(field==="metadata"?JSON.stringify(previous[field]??{})!==JSON.stringify(next[field]??{}):previous[field]!==next[field])return true;return Date.now()-Date.parse(previous.lastSeenAt??previous.updatedAt??0)>=60_000;}
export function resolveCodexThreadLocation(native:any,cached:any,owned:any){
  const savedLocation=Boolean(cached?.ownership==="claudex-workhouse"&&cached?.metadata?.workspaceChangedAt);
  const cwd=savedLocation
    ? cached?.cwd??owned?.cwd??native?.cwd??null
    : native?.cwd??owned?.cwd??cached?.cwd??null;
  const projectId=savedLocation
    ? cached?.projectId??owned?.projectId??null
    : owned?.projectId??cached?.projectId??null;
  const executionHostId=savedLocation
    ? cached?.metadata?.executionHostId??cached?.executionHostId??owned?.executionHostId??"local"
    : owned?.executionHostId??cached?.executionHostId??cached?.metadata?.executionHostId??"local";
  const workspaceId=savedLocation
    ? cached?.metadata?.workspaceId??cached?.workspaceId??owned?.workspaceId??null
    : owned?.workspaceId??cached?.workspaceId??cached?.metadata?.workspaceId??null;
  return{cwd,projectId,executionHostId,workspaceId,canMutate:Boolean(cwd||workspaceId)};
}
export function codexThreadPreview(activeTask:Pick<DeckTask,"prompt">|null|undefined,cached:any,native:any){
  for(const value of [activeTask?.prompt,cached?.preview,native?.preview]){
    if(typeof value==="string"&&value.trim())return value;
  }
  return"";
}
export function newestActiveCodexTask(tasks:DeckTask[]){
  return tasks.filter((task)=>["pending","queued","running","waiting"].includes(task.status)).sort((left,right)=>right.createdAt.localeCompare(left.createdAt))[0];
}
export function newestCodexThreadSettings(cached:any,ownedTasks:DeckTask[]){
  let settings:any=cached??null;
  for(const task of ownedTasks)settings=newestExecutionSettings(settings,task);
  return settings;
}
function mapStatus(value: string): UnifiedStatus {
  if (value === "cancelled" || value === "stopped") return "stopped";
  if (["queued", "running", "completed", "failed", "waiting", "pending", "unknown"].includes(value)) return value as UnifiedStatus;
  return "unknown";
}
export class CodexProvider implements AgentProvider {
  readonly id = "codex" as const;
  readonly capabilities = { supportsMcpEvents: true, supportsEmotionRendering: false } as const;
  private catalog: CodexCatalog;
  private stateDir: string;
  private cursors = new Map<string, { native:string|null; expires:number; fingerprint:string }>();
  private deleteVerified = true;
  private appFailures = 0;
  private appBlockedUntil = 0;
  private threadTaskSnapshot:DeckTask[]=[];
  private threadTasksInitialized=false;
  private threadSnapshots=new Map<boolean,ThreadSnapshot>();
  private threadSnapshotLoads=new Map<boolean,Promise<ThreadSnapshot>>();
  private threadSnapshotRefreshes=new Map<boolean,Promise<void>>();
  private threadTaskRefresh:Promise<void>|null=null;
  private pendingThreadCacheRows=new Map<string,any>();
  private optimisticThreadRows=new Map<string,any>();
  private recentThreadCacheRows=new Map<string,{row:any;expires:number}>();
  private pendingNativeList=new Map<string,Promise<any>>();
  private cacheCursors=new Map<string,CacheCursorState>();
  private nativeListFallbackCursors=new Map<string,CacheCursorState>();
  private taskSnapshot:ProviderTaskSnapshotCache;
  private threadCacheFlush:Promise<void>|null=null;
  private taskListRefresh:Promise<void>|null=null;
  private taskListRefreshStartedAt=0;
  private workerStateSignatures=new Map<string,{dev:number;ino:number;size:number;mtimeMs:number}>();
  private nativeCapability:SandboxCapability|null=null;
  constructor(private config: AppConfig, private db: DeckDatabase) {
    this.catalog = new CodexCatalog(config, db);
    this.stateDir = path.join(config.dataDir, "codex-jobs");
    this.taskSnapshot = new ProviderTaskSnapshotCache(db, "codex", TASK_SNAPSHOT_RESYNC_MS);
    fs.mkdirSync(this.stateDir, { recursive: true });
  }

  private stateFile(id: string) { return path.join(this.stateDir, `${id.replaceAll(":", "_")}.json`); }
  async probeNativeExecution(workspace=this.config.root,force=false){
    const binary=codexRuntimeSelection(this.config.appRoot).binary??"",identity=sandboxEnvironmentIdentity(binary,"local","local"),host=await this.db.getHost("local").catch(()=>null),persisted=host?.capabilities?.nativeSandbox as SandboxCapability|undefined;
    if(force)this.nativeCapability=null;
    if(!force&&!this.nativeCapability&&persisted?.cacheKey===identity.cacheKey)this.nativeCapability=persisted;
    const capability=this.nativeCapability??=probeNativeSandbox(workspace,binary,"local",10000,"local");
    if(host&&JSON.stringify(host.capabilities?.nativeSandbox)!==JSON.stringify(capability))await this.db.upsertHost({...host,capabilities:{...host.capabilities,nativeSandbox:capability},updatedAt:now()});
    return capability;
  }

  private async executionPolicy(input:CreateTaskInput,level:ReturnType<typeof automationLevel>):Promise<{policy:ExecutionPolicy;capability:SandboxCapability|null}>{
    const hostId=input.executionHostId??"local",workspaceId=input.workspaceId??input.project.id;
    let capability:SandboxCapability|null=null;if(level!=="full")capability=await this.probeNativeExecution(input.project.realPath);
    const setting=(await this.db.getSystemSetting(trustedHostSettingKey(hostId,"codex")).catch(()=>null))?.value,host=await this.db.getHost(hostId).catch(()=>null),trustedHost=trustedHostOptInValid(setting,{hostId,provider:"codex",osIdentity:osExecutionIdentity(),version:1});
    const policy=resolveExecutionPolicy({provider:"codex",requestedAutomation:level,hostId,workspaceId,sandboxCapability:capability,hostFallbackPolicy:{trustedHost,isolatedWorker:host?.capabilities?.isolatedExecution===true},providerCapabilities:{automatic:true,confirm:true,fullAccess:true,readOnly:true},runtimeVersion:capability?.codexVersion??null});
    if(!policy.allowed)throw Object.assign(new Error(`Execution blocked before the first command: ${policy.reason??"policy-denied"}${capability?` (${capability.status}: ${capability.reason??"unknown"})`:""}. The prompt and attachments were not consumed.`),{statusCode:409,code:executionPolicyErrorCode(policy,capability),policy,capability});
    return{policy,capability};
  }
  listApprovals(task:DeckTask){if(!task.commandMarker?.startsWith("claudex-workhouse-codex:"))return[];return listPendingApprovals(this.stateFile(task.id));}
  respondApproval(task:DeckTask,approvalId:string,decision:ApprovalDecision){if(!task.commandMarker?.startsWith("claudex-workhouse-codex:"))throw Object.assign(new Error("Only an Claudex Workhouse Codex worker can receive approvals."),{statusCode:403});return submitApprovalDecision(this.stateFile(task.id),approvalId,decision);}
  listUserInputs(task:DeckTask){if(!task.commandMarker?.startsWith("claudex-workhouse-codex:"))return[];return listPendingUserInputs(this.stateFile(task.id));}
  respondUserInput(task:DeckTask,requestId:string,answers:UserInputAnswers){if(!task.commandMarker?.startsWith("claudex-workhouse-codex:"))throw Object.assign(new Error("Only an Claudex Workhouse Codex worker can receive user input."),{statusCode:403});return submitUserInput(this.stateFile(task.id),requestId,answers);}
  private projectForCwd(cwd: string | null | undefined) { return this.config.projects.find((item) => item.realPath === cwd) ?? null; }
  // Same policy as Claude sessions: an unregistered workspace is still usable
  // when the thread's own cwd exists on disk (Codex already ran there).
  private projectForThread(cwd: string | null | undefined): ProjectConfig {
    const project = this.projectForCwd(cwd);
    if (project?.enabled) return project;
    if (cwd) {
      try { if (fs.statSync(cwd).isDirectory()) return { id: `dir:${cwd.replaceAll("/", "-")}`, name: cwd, path: cwd, realPath: cwd, enabled: true, error: null }; } catch { /* fall through */ }
    }
    throw Object.assign(new Error("Thread workspace directory is unavailable."), { statusCode: 404 });
  }
  private async restoreLocalIdentity(task:DeckTask|null,thread:any,project:ProjectConfig){
    const hostId=task?.executionHostId??thread?.executionHostId??thread?.metadata?.executionHostId??"local";
    if(hostId!=="local")return{executionHostId:hostId,workspaceId:task?.workspaceId??thread?.workspaceId??thread?.metadata?.workspaceId??null};
    const workspaceId=task?.workspaceId??thread?.workspaceId??thread?.metadata?.workspaceId??null;
    return{executionHostId:"local",workspaceId};
  }
  private fromCx(item: any, project: ProjectConfig, ownership: "claudex-workhouse"|"external-cx" = "external-cx"): DeckTask {
    const createdAt = item.createdAt ?? now();
    return {
      id: `codex:${item.jobId}`,
      provider: "codex",
      nativeId: item.jobId,
      threadId: item.threadId ?? null,
      projectId: project.id,
      title: item.summary || item.title || "Codex Task",
      prompt: item.prompt || item.summary || "",
      status: mapStatus(item.status),
      createdAt,
      updatedAt: item.updatedAt ?? item.completedAt ?? createdAt,
      result: item.result ?? null,
      error: item.error ?? null,
      log: stripAnsi(item.log ?? ""),
      owned: ownership === "claudex-workhouse",
      pid: item.pid ?? null,
      pgid: null,
      processStart: null,
      commandMarker: null,
      parentThreadId: null,
      ownership,
      source: ownership === "claudex-workhouse" ? "claudex-workhouse" : "cx",
      jobId: item.jobId,
      cwd: project.realPath,
      lastSeenAt: now()
    };
  }

  private async cx(args: string[], cwd: string, timeoutMs = this.config.commandTimeoutMs) {
    const result = await runCommand(CX, args, { cwd, timeoutMs, outputLimit: this.config.commandOutputLimit });
    if (result.overflow) throw new Error("cx output exceeded the configured limit.");
    return result;
  }

  async listTasks(): Promise<DeckTask[]> {
    // The main task list polls this every 8s; a full listProviderTasks scan
    // here was the single largest load on the serialized database worker.
    const stored = await this.loadTaskSnapshot().catch(() => this.taskSnapshot.current());
    this.scheduleTaskListRefresh(stored);
    return stored;
  }

  private scheduleTaskListRefresh(stored:DeckTask[]){
    if(this.taskListRefresh||Date.now()-this.taskListRefreshStartedAt<5000)return;
    this.taskListRefreshStartedAt=Date.now();
    this.taskListRefresh=this.refreshTaskList(stored).catch(()=>{}).finally(()=>{this.taskListRefresh=null;});
  }

  private async refreshTaskList(stored:DeckTask[]) {
    const tasks = new Map(stored.map((task) => [task.id, task]));
    const knownRows=await(this.db.listProviderTaskRefreshRows?.(this.id)??Promise.resolve(stored)).catch(()=>stored),known=new Map(knownRows.map(task=>[task.id,task]));
    const proven=new Set(await this.db.provenTaskIds().catch(()=>[]));
    for (const project of this.config.projects.filter((item) => item.enabled)) {
      const result = await this.cx(["ls", project.realPath, "--json"], project.realPath).catch(()=>null);
      if(!result)continue;
      if (result.exitCode !== 0) continue;
      const payload = JSON.parse(result.stdout);
      for (const item of payload.result ?? []) {
        const taskId = `codex:${item.jobId}`;
        const task = this.fromCx(item, project, proven.has(taskId)?"claudex-workhouse":"external-cx"),visible=tasks.get(taskId),existing=visible??known.get(taskId);
        if(existing&&existing.threadId===task.threadId&&existing.status===task.status&&existing.updatedAt===task.updatedAt&&existing.title===task.title){if(visible)tasks.set(task.id,visible);}
        else{const upserted=await this.db.upsertTask({...task,lastSeenAt:now()});tasks.set(task.id,upserted);this.taskSnapshot.applyAll([upserted]);}
      }
    }
    for (const [id, task] of tasks) {
      if (task.commandMarker?.startsWith("claudex-workhouse-codex:")) tasks.set(id, await this.refreshWorker(task));
    }
  }

  private async refreshWorker(task: DeckTask) {
    try {
      const stateFile=this.stateFile(task.id),stat=fs.statSync(stateFile),signature={dev:stat.dev,ino:stat.ino,size:stat.size,mtimeMs:stat.mtimeMs},previous=this.workerStateSignatures.get(task.id);
      const same=Boolean(previous&&previous.dev===signature.dev&&previous.ino===signature.ino&&previous.size===signature.size&&previous.mtimeMs===signature.mtimeMs),taskActive=["pending","queued","running","waiting","unknown"].includes(task.status);
      if(same&&(!taskActive||this.processMatchesWorker(task)))return task;
      const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      this.workerStateSignatures.set(task.id,signature);
      const identity={...task,pid:state.pid??task.pid,pgid:state.pgid??task.pgid,processStart:state.processStart??task.processStart,commandMarker:state.marker??task.commandMarker},active=["pending","queued","running","waiting","unknown"].includes(state.status??task.status);
      if(active&&!this.processMatchesWorker(identity)){
        state.status="stopped";state.updatedAt=new Date().toISOString();state.error=state.error??"Worker process is no longer running.";state.interruptionCause="worker-process-lost";state.interruptionDetectedAt=state.updatedAt;
        try{const temporary=`${stateFile}.${process.pid}.${crypto.randomUUID()}.tmp`;fs.writeFileSync(temporary,JSON.stringify(state));fs.renameSync(temporary,stateFile);}catch{}
      }
      const imageOutputs=mergePersistedImageOutputs(task.metadata?.imageOutputs,state.imageOutputs);
      const metadata={...withoutLegacyWorkspaceApprovalMetadata(task.metadata),activity:state.activity ?? task.metadata?.activity,errorCategory:state.errorCategory??task.metadata?.errorCategory,modelTurnStarted:state.modelTurnStarted??task.metadata?.modelTurnStarted,contextUsage:state.contextUsage??task.metadata?.contextUsage,outputUsage:state.outputUsage??task.metadata?.outputUsage,finalMessageId:state.finalMessageId??task.metadata?.finalMessageId,parallelAgents:state.parallelAgents??task.metadata?.parallelAgents,...(imageOutputs.length?{imageOutputs}:{}),requestedAutomation:state.requestedAutomation??task.metadata?.requestedAutomation,effectiveSandbox:state.effectiveSandbox??task.metadata?.effectiveSandbox,effectiveApprovalPolicy:state.effectiveApprovalPolicy??task.metadata?.effectiveApprovalPolicy,executionBackend:state.executionBackend??task.metadata?.executionBackend,approvalLoop:state.approvalLoop??task.metadata?.approvalLoop,interruptionCause:state.interruptionCause??task.metadata?.interruptionCause,interruptionDetectedAt:state.interruptionDetectedAt??task.metadata?.interruptionDetectedAt},heartbeatDue=active&&state.status!=="stopped"&&Date.now()-Date.parse(task.lastSeenAt??task.updatedAt)>60_000;
      const changed=task.threadId!==(state.threadId??task.threadId)||task.status!==(state.status??task.status)||task.updatedAt!==(state.updatedAt??task.updatedAt)||task.result!==(state.result??task.result)||task.error!==(state.error??null)||task.log!==(state.log??task.log)||task.pid!==(state.pid??task.pid)||task.pgid!==(state.pgid??task.pgid)||task.processStart!==(state.processStart??task.processStart)||JSON.stringify(task.metadata??{})!==JSON.stringify(metadata)||heartbeatDue;
      if(!changed)return task;
      const refreshed=await this.db.upsertTask({ ...task, threadId: state.threadId ?? task.threadId, status: state.status ?? task.status, updatedAt: state.updatedAt ?? task.updatedAt, result: state.result ?? task.result, error: state.error ?? null, log: state.log ?? task.log, pid: state.pid ?? task.pid, pgid: state.pgid ?? task.pgid, processStart: state.processStart ?? task.processStart, lastSeenAt: now(), metadata });
      // State-file timestamps can sit behind the snapshot watermark, so a
      // delta pass would never re-read this row -- keep the cache in step.
      this.taskSnapshot.applyAll([refreshed]);
      if(refreshed.threadId){
        const stored=await this.db.getCodexThread(refreshed.threadId).catch(()=>null),settings=newestExecutionSettings(stored,refreshed);
        const storedWorkspaceId=stored?.metadata?.workspaceId??stored?.workspaceId??null,workerMatchesStoredLocation=stored?.projectId===refreshed.projectId&&stored?.cwd===refreshed.cwd&&(!storedWorkspaceId||storedWorkspaceId===refreshed.workspaceId),preserveStoredLocation=Boolean(stored?.metadata?.workspaceChangedAt)&&!workerMatchesStoredLocation;
        const projectId=preserveStoredLocation?stored.projectId:refreshed.projectId,cwd=preserveStoredLocation?stored.cwd:refreshed.cwd;
        const executionHostId=preserveStoredLocation?(stored?.metadata?.executionHostId??stored?.executionHostId??"local"):(refreshed.executionHostId??stored?.executionHostId??stored?.metadata?.executionHostId??"local"),workspaceId=preserveStoredLocation?storedWorkspaceId:(refreshed.workspaceId??stored?.workspaceId??stored?.metadata?.workspaceId??null);
        const executionMetadata=preserveStoredLocation?{}:{requestedAutomation:refreshed.metadata?.requestedAutomation,effectiveSandbox:refreshed.metadata?.effectiveSandbox,effectiveApprovalPolicy:refreshed.metadata?.effectiveApprovalPolicy,executionBackend:refreshed.metadata?.executionBackend};
        await this.db.upsertCodexThread({threadId:refreshed.threadId,sessionId:refreshed.threadId,projectId,cwd,title:refreshed.title,preview:refreshed.prompt,source:"claudex-workhouse",ownership:"claudex-workhouse",status:refreshed.status,archived:stored?.archived??false,parentThreadId:refreshed.parentThreadId,forkedFromId:refreshed.parentThreadId,modelProvider:stored?.modelProvider??null,requestedModel:settings.requestedModel??null,effectiveModel:stored?.effectiveModel??null,requestedReasoningEffort:settings.requestedReasoningEffort??null,effectiveReasoningEffort:stored?.effectiveReasoningEffort??null,requestedServiceTier:settings.requestedServiceTier??null,effectiveServiceTier:stored?.effectiveServiceTier??null,permissionProfile:settings.permissionProfile??null,settingsUpdatedAt:settings.settingsUpdatedAt??null,createdAt:stored?.createdAt??refreshed.createdAt,updatedAt:refreshed.updatedAt,lastSeenAt:now(),executionHostId,workspaceId,workChainId:refreshed.workChainId??stored?.workChainId??null,metadata:{...withoutLegacyWorkspaceApprovalMetadata(stored?.metadata),workerTaskId:refreshed.id,executionHostId,workspaceId,workMode:settings.metadata?.workMode??"default",automationLevel:automationLevel(settings.metadata?.automationLevel,settings.permissionProfile),...executionMetadata,imageOutputs:mergePersistedImageOutputs(stored?.metadata?.imageOutputs,refreshed.metadata?.imageOutputs),approvalLoop:refreshed.metadata?.approvalLoop,collaborationSessionId:refreshed.metadata?.collaborationSessionId,collaborationParticipantId:refreshed.metadata?.collaborationParticipantId}}).catch(()=>null);
      }
      return refreshed;
    } catch { return task; }
  }

  private cursor(fingerprint: string, token?: string | null) {
    if (!token) return null;
    const value = this.cursors.get(token);
    if (!value || value.expires < Date.now() || value.fingerprint !== fingerprint) throw Object.assign(new Error("Invalid or expired cursor."), { statusCode: 400 });
    return value.native;
  }
  private wrapCursor(fingerprint: string, native: string | null) {
    if (!native) return null;
    const token = crypto.randomUUID();
    this.cursors.set(token, { native, fingerprint, expires: Date.now()+900000 });
    if (this.cursors.size > 1000) for (const [key,value] of this.cursors) if (value.expires < Date.now()) this.cursors.delete(key);
    return token;
  }

  // Reconciling a worker costs a statSync per task, and a task that already
  // reached a terminal status can never be changed by its state file again --
  // the worker process is gone and the file is final. Skipping those turns a
  // per-poll storm over every stored task into work proportional to the number
  // of live ones.
  private async reconcileWorkers(storedTasks:DeckTask[]) {
    const stale=storedTasks.filter(task=>task.commandMarker?.startsWith("claudex-workhouse-codex:")&&!TERMINAL_TASK_STATUS.has(task.status));
    if(!stale.length)return storedTasks;
    const refreshed=new Map<string,DeckTask>();
    for(let offset=0;offset<stale.length;offset+=4){
      const batch=await Promise.all(stale.slice(offset,offset+4).map(task=>this.refreshWorker(task)));
      for(const task of batch)refreshed.set(task.id,task);
    }
    return storedTasks.map(task=>refreshed.get(task.id)??task);
  }

  // Refetching every stored task costs ~2s and ~5MB of JSON on a mature table,
  // and the poll that drives it runs every 8s against a single serialized
  // database worker -- that alone was enough to saturate it. The shared cache
  // holds the rows in memory and pulls only an updated_at delta; a delta can
  // only add or update rows, so anything that removes them must invalidate.
  private invalidateTaskSnapshot(){this.taskSnapshot.invalidate();}

  private loadTaskSnapshot() { return this.taskSnapshot.load(); }

  private async refreshThreadSnapshots(archived:boolean) {
    const tasks=await this.reconcileWorkers(await this.loadTaskSnapshot());
    // Worker reconciliation rewrites rows with timestamps from their state
    // files, which can sit behind the cache watermark -- push them back in so
    // the next delta pass does not silently revert them.
    this.taskSnapshot.applyAll(tasks);
    const cached=await this.db.listCodexThreads(archived,5000),threads=new Map(cached.map((item:any)=>[item.threadId,item]));
    // Preserve writes that began after the database read was queued. Replacing
    // the whole snapshot without these overlays can roll a just-saved setting
    // back to the older row returned by the serialized SQLite worker.
    for(const[key,value]of this.recentThreadCacheRows){if(value.expires<Date.now())this.recentThreadCacheRows.delete(key);else if(Boolean(value.row.archived)===archived)threads.set(key,value.row);}
    for(const row of [...this.pendingThreadCacheRows.values(),...this.optimisticThreadRows.values()])if(Boolean(row.archived)===archived)threads.set(row.threadId,row);
    this.threadTaskSnapshot=tasks;
    this.threadTasksInitialized=true;
    const previous=this.threadSnapshots.get(archived);
    this.threadSnapshots.set(archived,{threads,loadedAt:Date.now(),syncedAt:previous?.syncedAt??null});
  }

  private async initializeThreadSnapshots(archived:boolean):Promise<ThreadSnapshot> {
    const existing=this.threadSnapshots.get(archived);if(existing)return existing;
    const pending=this.threadSnapshotLoads.get(archived);if(pending)return pending;
    const load=(async()=>{
      const[tasks,cached]=await Promise.all([this.threadTasksInitialized?Promise.resolve(this.threadTaskSnapshot):this.loadTaskSnapshot(),this.db.listCodexThreads(archived,5000)]);
      this.threadTaskSnapshot=tasks;this.threadTasksInitialized=true;
      const snapshot={threads:new Map(cached.map((item:any)=>[item.threadId,item])),loadedAt:Date.now(),syncedAt:null};
      this.threadSnapshots.set(archived,snapshot);return snapshot;
    })().finally(()=>{if(this.threadSnapshotLoads.get(archived)===load)this.threadSnapshotLoads.delete(archived);});
    this.threadSnapshotLoads.set(archived,load);return load;
  }

  private async threadSnapshotOrEmpty(archived:boolean):Promise<ThreadSnapshot>{
    try{return await this.initializeThreadSnapshots(archived);}
    catch{return this.threadSnapshots.get(archived)??{threads:new Map(),loadedAt:Date.now(),syncedAt:null};}
  }

  async warmThreadSnapshots(startupTasks:DeckTask[]){
    const tasks=startupTasks.filter(task=>task.provider==="codex");
    this.threadTaskSnapshot=tasks;this.threadTasksInitialized=true;this.taskSnapshot.prime(tasks);
    await this.initializeThreadSnapshots(false);
  }

  private scheduleThreadTaskRefresh(){
    if(this.threadTaskRefresh)return;
    this.threadTaskRefresh=(async()=>{const tasks=await this.reconcileWorkers(await this.loadTaskSnapshot());this.taskSnapshot.applyAll(tasks);this.threadTaskSnapshot=tasks;this.threadTasksInitialized=true;})().catch(()=>{}).finally(()=>{this.threadTaskRefresh=null;});
  }

  private scheduleThreadSnapshotRefresh(archived:boolean){
    if(this.threadSnapshotRefreshes.has(archived))return;
    const refresh=this.refreshThreadSnapshots(archived).catch(()=>{}).finally(()=>{if(this.threadSnapshotRefreshes.get(archived)===refresh)this.threadSnapshotRefreshes.delete(archived);});
    this.threadSnapshotRefreshes.set(archived,refresh);
  }

  private publishThreadCacheRow(row:any){
    const archived=Boolean(row.archived),snapshot=this.threadSnapshots.get(archived);if(snapshot?.threads&&row?.threadId)snapshot.threads.set(row.threadId,row);
  }

  private queueThreadCache(rows:any[]){
    for(const row of rows)if(typeof row?.threadId==="string"){this.pendingThreadCacheRows.set(row.threadId,row);this.publishThreadCacheRow(row);}
    if(this.threadCacheFlush)return;
    this.threadCacheFlush=(async()=>{
      while(this.pendingThreadCacheRows.size){
        const batch=[...this.pendingThreadCacheRows.entries()].slice(0,4);
        // Remove the selected generation before I/O. A rejected DB write must
        // not spin on the same row in a microtask-only loop and starve Node's
        // event loop; a later native poll will naturally enqueue it again.
        for(const[key,row]of batch)if(this.pendingThreadCacheRows.get(key)===row)this.pendingThreadCacheRows.delete(key);
        await Promise.allSettled(batch.map(async([,row])=>{const stored=await this.db.upsertCodexThread(row);if(stored?.threadId){this.recentThreadCacheRows.set(stored.threadId,{row:stored,expires:Date.now()+60_000});if(!this.optimisticThreadRows.has(stored.threadId)){const newest=this.pendingThreadCacheRows.get(stored.threadId)??stored;this.publishThreadCacheRow(newest);}}}));
      }
    })().finally(()=>{this.threadCacheFlush=null;if(this.pendingThreadCacheRows.size)this.queueThreadCache([]);});
  }

  // Cold `codex app-server` work measures 38-81s to initialize plus 23-46s for
// the first thread/list on this host, while every subsequent list is ~0.3s.
// A cold request is collected entirely in the background; a warm request gets
// the short UI budget below. One processed in-flight promise per query keeps
// polls from stacking work or ingesting the same native result twice.
  private nativeThreadList(fingerprint:string,params:any,options:{cursor?:string|null;limit?:number;archived?:boolean;projectId?:string;source?:string;ownership?:string;status?:string;model?:string;search?:string},limit:number,nativeCursor:string|null):Promise<any>{
    const key=`${fingerprint}:${params.cursor??""}`;
    let inFlight=this.pendingNativeList.get(key);
    if(!inFlight){
      inFlight=withCodexAppServer(this.config.root,LIST_CONNECT_TIMEOUT_MS,(client)=>client.request("thread/list",params,LIST_REQUEST_TIMEOUT_MS))
        .then(response=>this.materializeNativeThreads(response,options,limit,fingerprint,nativeCursor))
        .catch(error=>{this.recordNativeListFailure(error);throw error;})
        .finally(()=>{if(this.pendingNativeList.get(key)===inFlight)this.pendingNativeList.delete(key);});
      this.pendingNativeList.set(key,inFlight);
    }
    inFlight.catch(()=>{});
    return inFlight;
  }

  private async materializeNativeThreads(response:any,options:{cursor?:string|null;limit?:number;archived?:boolean;projectId?:string;source?:string;ownership?:string;status?:string;model?:string;search?:string},limit:number,fingerprint:string,nativeCursor:string|null){
    const archived=Boolean(options.archived),snapshot=await this.threadSnapshotOrEmpty(archived),tasks=this.threadTaskSnapshot,cachedByThread=snapshot.threads;
    this.scheduleThreadSnapshotRefresh(archived);
    const byThread = new Map<string, DeckTask[]>();
    for (const task of tasks) if (task.threadId) byThread.set(task.threadId, [...(byThread.get(task.threadId) ?? []), task]);
    const sessions: any[] = [],cacheRows:any[]=[];
    for (const item of response.data ?? []) {
      const linked = byThread.get(item.id) ?? [],cached=cachedByThread.get(item.id);
      const ownedTasks=linked.filter((task) => task.ownership === "claudex-workhouse" || task.owned || task.commandMarker?.startsWith("claudex-workhouse-codex:"));
      const owned=ownedTasks[0],settings=newestCodexThreadSettings(cached,ownedTasks),cachedOwned=cached?.ownership==="claudex-workhouse";
      const cx = linked.find((task) => task.jobId && task.source === "cx"),ownership = owned||cachedOwned ? "claudex-workhouse" : cx ? "external-cx" : "external";
      const location=resolveCodexThreadLocation(item,cached,owned),effectiveCwd=location.cwd;
      const projectMatch = this.projectForCwd(effectiveCwd)??(location.projectId?this.config.projects.find(project=>project.id===location.projectId)??null:null),activeTask = newestActiveCodexTask(linked);
      const session = {
        threadId:item.id, sessionId:item.sessionId ?? item.id, projectId:projectMatch?.id ?? location.projectId ?? null, cwd:effectiveCwd ?? null,
        title:owned?.title || cached?.title || item.name || item.preview || "Untitled Codex session", preview:codexThreadPreview(activeTask,cached,item),
        source:ownership === "claudex-workhouse" ? "claudex-workhouse" : cx ? "cx" : item.source ?? "unknown", nativeSource:item.source ?? "unknown",
        ownership, status:activeTask?.status ?? (item.status?.type === "active" ? "running" : "unknown"), archived,
        parentThreadId:item.parentThreadId ?? null, forkedFromId:item.forkedFromId ?? null, modelProvider:item.modelProvider ?? null,
        requestedModel:settings?.requestedModel ?? null, effectiveModel:owned?.effectiveModel ?? cached?.effectiveModel ?? null,
        requestedReasoningEffort:settings?.requestedReasoningEffort ?? null, effectiveReasoningEffort:owned?.effectiveReasoningEffort ?? cached?.effectiveReasoningEffort ?? null,
        requestedServiceTier:settings?.requestedServiceTier ?? null, effectiveServiceTier:owned?.effectiveServiceTier ?? cached?.effectiveServiceTier ?? null,
        permissionProfile:settings?.permissionProfile ?? null, settingsUpdatedAt:settings?.settingsUpdatedAt ?? null,
        createdAt:new Date((item.createdAt ?? 0)*1000).toISOString(), updatedAt:new Date((item.updatedAt ?? 0)*1000).toISOString(), lastSeenAt:cached?.lastSeenAt??now(),
        jobId:activeTask?.jobId ?? cx?.jobId ?? null, taskId:activeTask?.id ?? owned?.id ?? cached?.metadata?.workerTaskId ?? cx?.id ?? null,
        canStop:Boolean(activeTask && (activeTask.commandMarker?.startsWith("claudex-workhouse-codex:") || activeTask.jobId)), canMutate:Boolean(projectMatch || location.canMutate),
        executionHostId:location.executionHostId,workspaceId:location.workspaceId,
        stale:false, activity:activeTask?.metadata?.activity ?? null, metadata:{...(cached?.metadata??{}),...(settings?{workMode:settings.metadata?.workMode??cached?.metadata?.workMode??"default",automationLevel:automationLevel(settings.metadata?.automationLevel,settings.permissionProfile)}:{}),collaborationSessionId:owned?.metadata?.collaborationSessionId??cached?.metadata?.collaborationSessionId,collaborationParticipantId:owned?.metadata?.collaborationParticipantId??cached?.metadata?.collaborationParticipantId,nativeStatus:item.status,cliVersion:item.cliVersion,gitInfo:item.gitInfo}
      };
      if(threadCacheNeedsWrite(cached,session)){session.lastSeenAt=now();cacheRows.push(session);}
      if ((!options.source || session.source === options.source || session.nativeSource === options.source) && (!options.ownership || session.ownership === options.ownership) && (!options.status || session.status === options.status) && (!options.model || session.requestedModel === options.model)) sessions.push(session);
    }
    if (!nativeCursor) for (const task of tasks.filter((item) => !item.threadId && (!options.source || item.source === options.source) && (!options.ownership || item.ownership === options.ownership) && (!options.status || item.status === options.status))) sessions.push({ threadId:null, jobId:task.jobId ?? task.nativeId, taskId:task.id, projectId:task.projectId, cwd:task.cwd, title:task.title, preview:task.result ?? task.error ?? task.log, source:task.source, ownership:task.ownership, status:task.status, archived:false, createdAt:task.createdAt, updatedAt:task.updatedAt, canStop:["pending","queued","running","waiting"].includes(task.status), canMutate:false, stale:false });
    this.queueThreadCache(cacheRows);snapshot.syncedAt=now();this.appFailures=0;this.appBlockedUntil=0;
    const nextCursor=this.wrapCursor(fingerprint,response.nextCursor ?? null),last=sessions.at(-1);
    if(nextCursor&&last)this.nativeListFallbackCursors.set(nextCursor,{fingerprint,expires:Date.now()+900000,afterUpdatedAt:String(last.updatedAt??""),afterId:String(last.threadId??last.taskId??"")});
    return { sessions, nextCursor, stale:false, syncedAt:snapshot.syncedAt, capabilities:{ search:true, turns:true, settings:true, delete:this.deleteVerified } };
  }

  async listThreads(options: {cursor?:string|null;limit?:number;archived?:boolean;projectId?:string;source?:string;ownership?:string;status?:string;model?:string;search?:string}) {
    const limit = Math.max(10, Math.min(100, options.limit ?? 50));
    const fingerprint = JSON.stringify({ ...options, cursor: undefined, limit });
    const cacheCursor=options.cursor?this.cacheCursors.get(options.cursor):null;
    if(cacheCursor){
      if(cacheCursor.expires<Date.now()||cacheCursor.fingerprint!==fingerprint){this.cacheCursors.delete(options.cursor!);throw Object.assign(new Error("Codex cache cursor is invalid or expired."),{statusCode:400});}
      return this.cachedThreads(options,limit,null,cacheCursor);
    }
    const savedNativeFallback=options.cursor?this.nativeListFallbackCursors.get(options.cursor):null;
    const nativeFallback=savedNativeFallback&&savedNativeFallback.expires>=Date.now()&&savedNativeFallback.fingerprint===fingerprint?savedNativeFallback:null;
    if(options.cursor&&savedNativeFallback&&!nativeFallback)this.nativeListFallbackCursors.delete(options.cursor);
    const nativeCursor = this.cursor(fingerprint, options.cursor);
    const project = options.projectId ? this.config.projects.find((item) => item.id === options.projectId) : null;
    const params: any = { limit, sortKey: "updated_at", archived: Boolean(options.archived) };
    if (nativeCursor) params.cursor = nativeCursor;
    if (project?.enabled) params.cwd = project.realPath;
    if (options.source && ["cli","vscode","exec","appServer","unknown"].includes(options.source)) params.sourceKinds = [options.source];
    if (options.search) params.searchTerm = options.search;
    await this.threadSnapshotOrEmpty(Boolean(options.archived));
    try {
      if(Date.now()<this.appBlockedUntil)return this.cachedThreads(options,limit,"Codex app-server metadata circuit is cooling down after repeated failures.",nativeFallback);
      const native=this.nativeThreadList(fingerprint,params,options,limit,nativeCursor);
      if(!codexAppServerPoolWarm(this.config.root)){
        // A cold app-server can take well over a minute on this host. Persisted
        // rows are already loaded, so return them now while the shared native
        // request warms the pool and ingests its result exactly once.
        void native.catch(()=>{});
        return this.cachedThreads(options,limit,null,nativeFallback);
      }
      const response=await Promise.race([native,new Promise<null>(resolve=>{const timer=setTimeout(()=>resolve(null),LIST_SOFT_DEADLINE_MS);timer.unref?.();})]);
      if(!response)return this.cachedThreads(options,limit,null,nativeFallback);
      return response;
    } catch (error) {
      return this.cachedThreads(options,limit,error instanceof Error ? error.message : String(error),nativeFallback);
    }
  }

  private recordNativeListFailure(error:unknown){
    this.appFailures=Math.min(6,this.appFailures+1);this.appBlockedUntil=Date.now()+Math.min(60000,1000*(2**(this.appFailures-1)));
    return error;
  }

  // Opaque cache cursors keep pagination stable without leaking offsets into
  // the API or confusing them with native app-server cursors.
  private cacheCursor(fingerprint:string,last:any){
    const token=crypto.randomUUID(),state={fingerprint,expires:Date.now()+900000,afterUpdatedAt:String(last.updatedAt??""),afterId:String(last.threadId??last.taskId??"")};this.cacheCursors.set(token,state);
    if(this.cacheCursors.size>1000)for(const[key,value]of this.cacheCursors)if(value.expires<Date.now())this.cacheCursors.delete(key);
    if(this.nativeListFallbackCursors.size>1000)for(const[key,value]of this.nativeListFallbackCursors)if(value.expires<Date.now())this.nativeListFallbackCursors.delete(key);
    return token;
  }

  // Persisted Codex threads are the first-class initial view. Native metadata
  // refreshes this snapshot in the background instead of gating first paint.
  private async cachedThreads(options:{cursor?:string|null;archived?:boolean;projectId?:string;source?:string;ownership?:string;status?:string;model?:string;search?:string},limit:number,error:string|null,after:CacheCursorState|null=null) {
    const archived=Boolean(options.archived),snapshot=await this.threadSnapshotOrEmpty(archived),tasks=this.threadTaskSnapshot;this.scheduleThreadTaskRefresh();
    const activeByThread=new Map<string,DeckTask>();
    for(const task of tasks){
      if(!task.threadId)continue;
      const current=activeByThread.get(task.threadId),newest=newestActiveCodexTask(current?[current,task]:[task]);
      if(newest)activeByThread.set(task.threadId,newest);
    }
    const search=options.search?.trim().toLowerCase();
    const rows=[...snapshot.threads.values()].map((item:any)=>{
      const location=resolveCodexThreadLocation(null,item,null),activeTask=activeByThread.get(item.threadId),status=activeTask?.status??item.status;
      return{...item,...location,preview:codexThreadPreview(activeTask,item,null),status,taskId:activeTask?.id??item.metadata?.workerTaskId??null,stale:true,canStop:Boolean(activeTask&&(activeTask.commandMarker?.startsWith("claudex-workhouse-codex:")||activeTask.jobId)),canMutate:Boolean(this.projectForCwd(location.cwd)||location.canMutate)};
    }).filter((item:any)=>(!options.projectId||item.projectId===options.projectId)
      &&(!options.source||item.source===options.source||item.nativeSource===options.source)
      &&(!options.ownership||item.ownership===options.ownership)
      &&(!options.status||item.status===options.status)
      &&(!options.model||item.requestedModel===options.model)
      &&(!search||`${item.title??""} ${item.preview??""} ${item.threadId??""}`.toLowerCase().includes(search)))
      .sort((left:any,right:any)=>String(right.updatedAt??"").localeCompare(String(left.updatedAt??"")));
    const eligible=after?rows.filter((item:any)=>{const updatedAt=String(item.updatedAt??""),id=String(item.threadId??item.taskId??"");return updatedAt<after.afterUpdatedAt||(updatedAt===after.afterUpdatedAt&&id<after.afterId);}):rows;
    const sessions=eligible.slice(0,limit),last=sessions.at(-1);
    return { sessions, nextCursor:last&&eligible.length>sessions.length?this.cacheCursor(JSON.stringify({...options,cursor:undefined,limit}),last):null, stale:true, syncedAt:snapshot.syncedAt, ...(error?{error}:{}), capabilities:{search:true,turns:true,settings:true,delete:this.deleteVerified} };
  }

  async searchThreads(searchTerm: string, cursor?: string | null, limit = 50) {
    const fingerprint = JSON.stringify({ searchTerm, limit, kind:"search" });
    const native = this.cursor(fingerprint, cursor);
    try {
      if(!codexAppServerPoolWarm(this.config.root))throw new Error("Codex native search pool is cold.");
      const response = await withCodexAppServer(this.config.root, this.config.commandTimeoutMs, (client) => client.request("thread/search", { searchTerm, limit:Math.min(100,limit), ...(native?{cursor:native}:{}) },5000));
      const threadIds=(response.data??[]).map((item:any)=>item.thread?.id).filter((value:unknown):value is string=>typeof value==="string").slice(0,100);
      const [tasks,cachedRows]=await Promise.all([this.db.listProviderTaskLinksByThreads("codex",threadIds).catch(()=>[]),this.db.listCodexThreadsByIds(threadIds).catch(()=>[])]);
      const byThread=new Map<string,DeckTask[]>();for(const task of tasks)if(task.threadId)byThread.set(task.threadId,[...(byThread.get(task.threadId)??[]),task]);
      const cached=new Map(cachedRows.map((row:any)=>[row.threadId,row]));
      return { results:(response.data ?? []).map((item:any) => {const t=item.thread;const linked=byThread.get(t.id)??[],ownedTask=linked.find(x=>x.ownership==="claudex-workhouse"||x.owned||x.commandMarker?.startsWith("claudex-workhouse-codex:")),cache:any=cached.get(t.id);const owned=Boolean(ownedTask)||cache?.ownership==="claudex-workhouse";const cx=linked.some(x=>x.jobId&&x.source==="cx"),location=resolveCodexThreadLocation(t,cache,ownedTask),project=this.projectForCwd(location.cwd)??(location.projectId?this.config.projects.find(item=>item.id===location.projectId)??null:null);return{threadId:t.id,sessionId:t.sessionId,projectId:project?.id??location.projectId??null,cwd:location.cwd,title:t.name||t.preview||"Untitled Codex session",preview:item.snippet||t.preview||"",source:owned?"claudex-workhouse":cx?"cx":t.source??"unknown",nativeSource:t.source??"unknown",ownership:owned?"claudex-workhouse":cx?"external-cx":"external",status:t.status?.type==="active"?"running":"unknown",archived:false,createdAt:new Date(t.createdAt*1000).toISOString(),updatedAt:new Date(t.updatedAt*1000).toISOString(),canMutate:Boolean(project||location.canMutate),canStop:false,stale:false,executionHostId:location.executionHostId,workspaceId:location.workspaceId,metadata:cache?.metadata??{}};}), nextCursor:this.wrapCursor(fingerprint,response.nextCursor ?? null), fallback:false };
    } catch {
      const cached = await this.db.listCodexThreads(false, 500).catch(() => []);
      const q = searchTerm.toLowerCase();
      return { results:cached.filter((item) => `${item.title} ${item.preview} ${item.threadId}`.toLowerCase().includes(q)).slice(0,limit), nextCursor:null, fallback:true };
    }
  }

  async listTurns(threadId: string, cursor?: string | null, limit = 10) {
    const fingerprint = JSON.stringify({kind:"turns",threadId,limit});
    const native = this.cursor(fingerprint,cursor);
    return withCodexAppServer(this.config.root, 30000, async (client) => {
      const response = await client.request("thread/turns/list", { threadId, limit:Math.max(1,Math.min(20,limit)), ...(native?{cursor:native}:{}) }, 30000);
      return { turns:response.data ?? [], nextCursor:this.wrapCursor(fingerprint,response.nextCursor ?? null), backwardsCursor:null };
    });
  }

  async getThread(threadId: string) {
    const result = await withCodexAppServer(this.config.root, this.config.commandTimeoutMs, (client) => client.request("thread/read", { threadId, includeTurns:false }));
    return result.thread;
  }

  getModels(force = false) { return this.catalog.get(force); }
  validateSettings(settings:any){const level=automationLevel(settings.automationLevel,settings.permissionProfile);return this.catalog.validate({...settings,permissionProfile:settings.automationLevel?permissionForAutomation("codex",level):settings.permissionProfile});}

  async updateThreadSettings(threadId: string, settings: any, persist=true) {
    const stored = await this.db.getCodexThread(threadId);
    if (!stored) throw Object.assign(new Error("Codex thread not found."), { statusCode:404 });
    const requestedPermission=settings.permissionProfile??stored.permissionProfile;
    const level=automationLevel(settings.automationLevel,requestedPermission),valid=await this.catalog.validate({...settings,permissionProfile:settings.automationLevel?permissionForAutomation("codex",level):requestedPermission});
    const deferredLocation=Boolean(settings.deferWorkspaceChange&&settings.workspaceId),locationChanged=Boolean(settings.workspaceId&&!deferredLocation),metadata=withoutLegacyWorkspaceApprovalMetadata(stored.metadata);
    const updated = { ...stored, projectId:locationChanged?(settings.projectId??stored.projectId):stored.projectId,cwd:locationChanged?(settings.cwd??stored.cwd):stored.cwd,executionHostId:locationChanged?(settings.executionHostId??stored.executionHostId??"local"):stored.executionHostId,workspaceId:locationChanged?(settings.workspaceId??stored.workspaceId):stored.workspaceId,requestedModel:valid.model, requestedReasoningEffort:valid.reasoningEffort, requestedServiceTier:valid.serviceTier, permissionProfile:valid.permissionProfile, metadata:{...metadata,...(settings.workMode?{workMode:settings.workMode}:{}),automationLevel:level,...(locationChanged?{workspaceId:settings.workspaceId,executionHostId:settings.executionHostId??"local",workspaceChangedAt:settings.workspaceChangedAt??now()}:{}),...(deferredLocation?{nextProjectId:settings.projectId,nextWorkspaceId:settings.workspaceId,nextCanonicalWorkspacePath:settings.cwd,nextWorkspaceChangedAt:settings.workspaceChangedAt??now()}:{})}, settingsUpdatedAt:now(), updatedAt:stored.updatedAt ?? now() };
    // A thread-list poll can run while the settings write is awaiting SQLite.
    // Publish the validated snapshot first and discard a not-yet-flushed list
    // row, otherwise that poll can put the previous effort back after this
    // request succeeds.
    const archived=Boolean(stored.archived),snapshot=this.threadSnapshots.get(archived)??{threads:new Map<string,any>([[threadId,stored]]),loadedAt:Date.now(),syncedAt:null};
    if(!this.threadSnapshots.has(archived))this.threadSnapshots.set(archived,snapshot);
    const previousSnapshot=snapshot.threads.get(threadId);
    this.optimisticThreadRows.set(threadId,updated);snapshot.threads.set(threadId,updated);
    this.pendingThreadCacheRows.delete(threadId);
    if(persist)try{
      const saved=await this.db.upsertCodexThread(updated);
      if(this.optimisticThreadRows.get(threadId)===updated){const row=saved??updated;this.optimisticThreadRows.delete(threadId);this.recentThreadCacheRows.set(threadId,{row,expires:Date.now()+60_000});snapshot.threads.set(threadId,row);}
    }catch(error){
      if(this.optimisticThreadRows.get(threadId)===updated){
        this.optimisticThreadRows.delete(threadId);
        if(previousSnapshot)snapshot.threads.set(threadId,previousSnapshot);
        else snapshot.threads.delete(threadId);
      }
      throw error;
    }
    return updated;
  }

  async archiveThread(threadId: string, archived: boolean) {
    await withCodexAppServer(this.config.root, 30000, (client) => client.request(archived ? "thread/archive" : "thread/unarchive", { threadId }, 30000));
    const stored = await this.db.getCodexThread(threadId);
    if (stored) {
      const updated=await this.db.upsertCodexThread({ ...stored, archived, lastSeenAt:now() });
      this.threadSnapshots.get(!archived)?.threads.delete(threadId);
      const row=updated??{...stored,archived};this.recentThreadCacheRows.set(threadId,{row,expires:Date.now()+60_000});
      const target=await this.initializeThreadSnapshots(archived);target.threads.set(threadId,row);
    }
    return { threadId, archived };
  }

  async deleteThread(threadId: string) {
    if (!this.deleteVerified) throw Object.assign(new Error("Permanent deletion is disabled until fixture impact verification completes."), { statusCode:503 });
    const linked:DeckTask[]=[];
    for(const task of await this.db.listProviderTasks("codex")) if(task.threadId===threadId) linked.push(task.commandMarker?.startsWith("claudex-workhouse-codex:")?await this.refreshWorker(task):task);
    const active = linked.find((task) => ["pending","queued","running","waiting"].includes(task.status));
    if (active) throw Object.assign(new Error("Stop the verified worker before deleting its session record."), { statusCode:409 });
    await withCodexAppServer(this.config.root, 30000, (client) => client.request("thread/delete", { threadId }, 30000));
    await this.db.deleteCodexThread(threadId);
    const deletedTasks=await this.db.deleteTaskSession("codex",threadId);
    for(const snapshot of this.threadSnapshots.values())snapshot.threads.delete(threadId);
    this.pendingThreadCacheRows.delete(threadId);this.optimisticThreadRows.delete(threadId);this.recentThreadCacheRows.delete(threadId);
    this.invalidateTaskSnapshot();
    return { threadId, deleted:true,deletedTasks };
  }

  async deleteSession(task:DeckTask){
    if(task.executionHostId&&task.executionHostId!=="local")throw Object.assign(new Error("Remote Codex sessions cannot be deleted from this host."),{statusCode:409});
    if(!task.threadId)throw Object.assign(new Error("Codex thread ID is unavailable."),{statusCode:409});
    return this.deleteThread(task.threadId);
  }

  async getTask(task: DeckTask): Promise<DeckTask> {
    if (task.commandMarker?.startsWith("claudex-workhouse-codex:")) return this.refreshWorker(task);
    if (task.nativeId.startsWith("thread:")) return task;
    const result = await this.cx(["show", task.nativeId, "--json"], this.config.projects.find((p) => p.id === task.projectId)?.realPath ?? process.cwd());
    if (result.exitCode !== 0) {
      const age = Date.now() - new Date(task.createdAt).getTime();
      if (age < 20000 && task.status === "pending") return task;
      return this.db.upsertTask({ ...task, status: "unknown", updatedAt: now(), error: JSON.parse(result.stdout || "{}").error ?? result.stderr.trim() });
    }
    const discovered=this.fromCx(JSON.parse(result.stdout), this.config.projects.find((p) => p.id === task.projectId)!, task.ownership === "claudex-workhouse" ? "claudex-workhouse" : "external-cx");
    const customTitle=typeof task.metadata?.customTitle==="string"?task.metadata.customTitle:null;
    const next=customTitle?{...discovered,title:customTitle,metadata:{...discovered.metadata,customTitle}}:discovered;
    if(task.threadId===next.threadId&&task.status===next.status&&task.updatedAt===next.updatedAt&&task.result===next.result&&task.error===next.error&&task.log===next.log&&task.title===next.title)return task;
    return this.db.upsertTask(next);
  }

  private async launchWorker(input: CreateTaskInput, resumeThreadId: string | null, mode:"new"|"resume"|"compact"=resumeThreadId?"resume":"new"): Promise<DeckTask> {
    const level=automationLevel(input.automationLevel,input.permissionProfile),valid = await this.catalog.validate({...input,permissionProfile:input.automationLevel?permissionForAutomation("codex",level):input.permissionProfile});
    const{policy,capability}=await this.executionPolicy(input,level);
    const nativeId = input.requestedNativeId ?? crypto.randomUUID();
    const id = `codex:deck:${nativeId}`;
    const managedProviderToken=crypto.randomBytes(32).toString("base64url"),managedProviderCapabilityHash=crypto.createHash("sha256").update(managedProviderToken).digest("hex");
    const marker = `claudex-workhouse-codex:${nativeId}`;
    const workerPath = path.join(this.config.appRoot, "app", "dist-server", "codex-worker.js");
    const workspaceId=input.workspaceId??input.project.id;
    const taskTempDir=ensureTaskTempDirectory(this.config.tempDir,workspaceId,"codex",id);
    const workMode=input.workMode==="plan"?"plan":"default";
    const runtimeProfile=input.runtimeProfile??"default";
    const settings = { model:valid.model, reasoningEffort:valid.reasoningEffort, serviceTier:valid.serviceTier, permissionProfile:valid.permissionProfile, workMode, runtimeProfile, automationLevel:level, executionPolicy:policy, sandboxCapability:capability, executionHostId:input.executionHostId??"local", workspaceId:input.workspaceId??null, taskTempDir };
    const delegationSettings=normalizeDelegationSettings((await this.db.getSystemSetting("delegation.launch-modes").catch(()=>null))?.value);
    const serializedDelegation=JSON.stringify(delegationSettings);
    const externalMcp=await prepareExternalMcpEnvironment({db:this.db,taskTempDir,taskId:id,provider:"codex",runtimeProfile,port:this.config.port});
    const providerPrompt=[input.prompt,externalMcp.promptSuffix].filter(Boolean).join("\n\n");
    seedTaskEmotion(this.config.dataRoot,"codex",id,resumeThreadId);
    const child = spawn(process.execPath, [workerPath, this.stateFile(id), id, mode, input.project.realPath, marker, resumeThreadId ?? "", providerPrompt, JSON.stringify(settings)], {
      cwd:input.project.realPath, detached:true, shell:false, windowsHide:true, stdio:"ignore",env:{...process.env,
        CLAUDEX_WORKHOUSE_ROOT:this.config.appRoot,CLAUDEX_WORKHOUSE_APP_ROOT:this.config.appRoot,CLAUDEX_WORKHOUSE_DATA_ROOT:this.config.dataRoot,TMPDIR:taskTempDir,TMP:taskTempDir,TEMP:taskTempDir,CLAUDEX_WORKHOUSE_RUNTIME_PROFILE:runtimeProfile,CLAUDEX_WORKHOUSE_CONVERSATION_ATTACHMENTS:JSON.stringify(runtimeProfile==="conversation"?conversationAttachmentPaths(input.prompt,path.join(this.config.dataDir,"uploads")):[]),CLAUDEX_WORKHOUSE_DELEGATION_SETTINGS:serializedDelegation,...emotionMcpEnvironment("codex",this.config.port,id,undefined,runtimeProfile),CLAUDEX_WORKHOUSE_MANAGED_PROVIDER_MCP_URL:`http://127.0.0.1:${this.config.port}/mcp/claudex-workhouse`,CLAUDEX_WORKHOUSE_CURRENT_TASK_ID:id,CLAUDEX_WORKHOUSE_MANAGED_PROVIDER_TOKEN:managedProviderToken,...externalMcp.environment}
    });
    child.unref();
    const createdAt = now();
    return this.db.upsertTask({
      id, provider:"codex", nativeId, threadId:resumeThreadId, projectId:input.project.id, title:input.title ?? input.prompt.replace(/\s+/g," ").slice(0,80), prompt:input.prompt,
      status:"pending", createdAt, updatedAt:createdAt, result:null, error:null, log:"Claudex Workhouse Codex worker launched.", owned:true,
      pid:child.pid ?? null, pgid:child.pid ?? null, processStart:null, commandMarker:marker, parentThreadId:resumeThreadId,
      ownership:"claudex-workhouse", source:"claudex-workhouse", jobId:nativeId, cwd:input.project.realPath, lastSeenAt:createdAt,
      requestedModel:valid.model, effectiveModel:null, requestedReasoningEffort:valid.reasoningEffort, effectiveReasoningEffort:null,
      requestedServiceTier:valid.serviceTier, effectiveServiceTier:null, permissionProfile:valid.permissionProfile, settingsUpdatedAt:createdAt,
      executionHostId:input.executionHostId??"local",workspaceId:input.workspaceId??null,workChainId:input.workChainId??null,
      metadata:{...(input.boardRole?{boardRole:input.boardRole}:{}),worker:"codex-app-server", effectiveSettingsConfirmed:false, workMode, runtimeProfile, automationLevel:level,...(runtimeProfile!=="conversation"?{managedProviderCapabilityHash}:{}),...externalMcp.metadata,tempDirectory:taskTempDir,requestedAutomation:policy.requestedAutomation,effectiveSandbox:policy.effectiveSandbox,effectiveApprovalPolicy:policy.effectiveApprovalPolicy,executionBackend:policy.executionBackend,executionPolicyReason:policy.reason,executionUiLabel:policy.uiLabel,sandboxCapability:capability }
    });
  }

  private async reconcile(id: string) {
    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, attempt ? 1500 : 500));
      const task = await this.db.getTask(id);
      if (!task) return;
      const current = await this.getTask(task);
      if (current.status !== "pending" && current.status !== "unknown") return;
    }
  }

  createTask(input: CreateTaskInput) { return this.launchWorker(input, null); }

  async sendMessage(task: DeckTask, prompt: string) {
    if (!task.threadId) throw new Error("A confirmed thread ID is required for follow-up requests.");
    const thread = await this.db.getCodexThread(task.threadId).catch(() => null);
    const project = this.config.projects.find((item) => item.id === task.projectId && item.enabled) ?? this.projectForThread(task.cwd ?? thread?.cwd);
    const identity=await this.restoreLocalIdentity(task,thread,project);
    const settings=newestExecutionSettings(thread,task);
    const customTitle=typeof thread?.metadata?.customTitle==="string"?thread.metadata.customTitle:typeof task.metadata?.customTitle==="string"?task.metadata.customTitle:null;
    const next=await this.launchWorker({ project, prompt,title:customTitle??task.title, model:settings.requestedModel, reasoningEffort:settings.requestedReasoningEffort, serviceTier:settings.requestedServiceTier, permissionProfile:settings.permissionProfile, workMode:settings.metadata?.workMode==="plan"?"plan":"default", runtimeProfile:settings.metadata?.runtimeProfile==="conversation"||settings.metadata?.runtimeProfile==="browser"?settings.metadata.runtimeProfile:"default", automationLevel:automationLevel(settings.metadata?.automationLevel,settings.permissionProfile),...identity }, task.threadId);
    return this.db.upsertTask({...next,...(customTitle?{title:customTitle}:{}),metadata:{...workspaceInstructionFollowUpMetadata(task.metadata,next.metadata),...(customTitle?{customTitle}:{})}});
  }
  async compactThread(task: DeckTask) {
    if (!task.threadId) throw new Error("A confirmed thread ID is required for context compaction.");
    const thread=await this.db.getCodexThread(task.threadId).catch(()=>null);
    const project=this.config.projects.find(item=>item.id===task.projectId&&item.enabled)??this.projectForThread(task.cwd??thread?.cwd);
    const identity=await this.restoreLocalIdentity(task,thread,project);
    const settings=newestExecutionSettings(thread,task);
    const customTitle=typeof thread?.metadata?.customTitle==="string"?thread.metadata.customTitle:typeof task.metadata?.customTitle==="string"?task.metadata.customTitle:null;
    const locale=normalizeStoredLocale((await this.db.getSystemSetting("ui.locale").catch(()=>null))?.value)??"ko",next=await this.launchWorker({project,prompt:"/compact",title:customTitle??`${task.title} · ${localizedTaskSuffix(locale,"compact")}`,model:settings.requestedModel,reasoningEffort:settings.requestedReasoningEffort,serviceTier:settings.requestedServiceTier,permissionProfile:settings.permissionProfile,workMode:settings.metadata?.workMode==="plan"?"plan":"default",runtimeProfile:settings.metadata?.runtimeProfile==="conversation"||settings.metadata?.runtimeProfile==="browser"?settings.metadata.runtimeProfile:"default",automationLevel:automationLevel(settings.metadata?.automationLevel,settings.permissionProfile),...identity},task.threadId,"compact");
    return customTitle?this.db.upsertTask({...next,title:customTitle,metadata:{...next.metadata,customTitle}}):next;
  }

  async sendThreadMessage(threadId: string, prompt: string, settings: any = {}) {
    const thread = await this.db.getCodexThread(threadId);
    if (!thread) throw Object.assign(new Error("Codex thread not found."), { statusCode:404 });
    const project = this.projectForThread(thread.cwd);
    const identity=await this.restoreLocalIdentity(null,thread,project);
    const customTitle=typeof thread.metadata?.customTitle==="string"?thread.metadata.customTitle:null;
    const next=await this.launchWorker({ project, prompt,title:customTitle??thread.title, model:settings.model ?? thread.requestedModel, reasoningEffort:settings.reasoningEffort ?? thread.requestedReasoningEffort, serviceTier:settings.serviceTier ?? thread.requestedServiceTier, permissionProfile:settings.permissionProfile ?? thread.permissionProfile, workMode:(settings.workMode??thread.metadata?.workMode)==="plan"?"plan":"default",automationLevel:automationLevel(settings.automationLevel??thread.metadata?.automationLevel,settings.permissionProfile??thread.permissionProfile),...identity }, threadId);
    return customTitle?this.db.upsertTask({...next,title:customTitle,metadata:{...next.metadata,customTitle}}):next;
  }

  async forkThread(task: DeckTask): Promise<DeckTask> {
    if (!task.threadId) throw new Error("A confirmed thread ID is required for fork.");
    return this.forkByThread(task.threadId, task.projectId, task.title);
  }

  async forkByThread(threadId: string, projectId?: string | null, title = "Codex session") {
    const sourceThread=await this.db.getCodexThread(threadId).catch(()=>null),project = projectId ? this.config.projects.find((item) => item.id === projectId) : this.projectForCwd(sourceThread?.cwd);
    const identity=sourceThread?await this.restoreLocalIdentity(null,sourceThread,project??this.projectForThread(sourceThread.cwd)):{executionHostId:"local",workspaceId:null};
    // Forking on the project cwd would evict the pooled root client and make
    // the next thread list pay a full cold start. thread/fork is identified by
    // threadId rather than by cwd, so keep it on the shared root client.
    const result = await withCodexAppServer(this.config.root, LIST_CONNECT_TIMEOUT_MS, (client) => client.request("thread/fork", { threadId }, 30000));
    const forkedId = result.thread?.id;
    if (!forkedId) throw Object.assign(new Error("Fork result did not include a thread ID; the request was not repeated."), { code:"FORK_UNCERTAIN" });
    const createdAt = now();
    const task = await this.db.upsertTask({
      id: `codex:thread:${forkedId}`,
      provider: "codex",
      nativeId: `thread:${forkedId}`,
      threadId: forkedId,
      projectId: project?.id ?? sourceThread?.projectId ?? "external",
      title: `Branch of ${title}`,
      prompt: "",
      status: "completed",
      createdAt,
      updatedAt: createdAt,
      result: "Thread forked and ready for a follow-up request.",
      error: null,
      log: `Forked from ${threadId}`,
      owned: true,
      pid: null,
      pgid: null,
      processStart: null,
      commandMarker: null,
      parentThreadId: threadId,
      ownership:"claudex-workhouse", source:"claudex-workhouse", jobId:null, cwd:result.thread?.cwd ?? project?.realPath ?? null, lastSeenAt:createdAt,executionHostId:identity.executionHostId,workspaceId:identity.workspaceId,
      requestedModel:sourceThread?.requestedModel??null,effectiveModel:null,requestedReasoningEffort:sourceThread?.requestedReasoningEffort??null,effectiveReasoningEffort:null,requestedServiceTier:sourceThread?.requestedServiceTier??null,effectiveServiceTier:null,permissionProfile:sourceThread?.permissionProfile??null,settingsUpdatedAt:null,metadata:{...withoutLegacyWorkspaceApprovalMetadata(sourceThread?.metadata),fork:true}
    });
    const cachedFork=await this.db.upsertCodexThread({ threadId:forkedId,sessionId:forkedId,projectId:project?.id ?? sourceThread?.projectId??null,cwd:result.thread?.cwd ?? project?.realPath ?? sourceThread?.cwd??null,title:`Branch of ${title}`,preview:"",source:"claudex-workhouse",ownership:"claudex-workhouse",status:"unknown",archived:false,parentThreadId:threadId,forkedFromId:threadId,modelProvider:result.thread?.modelProvider ?? null,requestedModel:sourceThread?.requestedModel??null,requestedReasoningEffort:sourceThread?.requestedReasoningEffort??null,requestedServiceTier:sourceThread?.requestedServiceTier??null,permissionProfile:sourceThread?.permissionProfile??null,createdAt:createdAt,updatedAt:createdAt,lastSeenAt:createdAt,executionHostId:identity.executionHostId,workspaceId:identity.workspaceId,workChainId:sourceThread?.workChainId??null,metadata:{...withoutLegacyWorkspaceApprovalMetadata(sourceThread?.metadata),executionHostId:identity.executionHostId,workspaceId:identity.workspaceId,fork:true} });
    if(cachedFork?.threadId)this.recentThreadCacheRows.set(cachedFork.threadId,{row:cachedFork,expires:Date.now()+60_000});
    this.publishThreadCacheRow(cachedFork);
    return task;
  }

  async stopTask(task: DeckTask): Promise<DeckTask> {
    if (!["pending", "queued", "running", "waiting", "unknown"].includes(task.status)) throw Object.assign(new Error("Only active tasks can be stopped."), { statusCode:409 });
    if (task.commandMarker?.startsWith("claudex-workhouse-codex:")) {
      task = await this.refreshWorker(task);
      if (!this.processMatchesWorker(task)) throw Object.assign(new Error("Codex worker identity no longer matches the recorded process."), { statusCode:409 });
      process.kill(-task.pgid!, "SIGTERM");
      for(let i=0;i<20;i++){await new Promise(resolve=>setTimeout(resolve,250));const current=await this.refreshWorker(task);if(!this.processMatchesWorker(current))return this.db.upsertTask({...current,status:"stopped",updatedAt:now()});}
      if(this.processMatchesWorker(task))process.kill(-task.pgid!,"SIGKILL");
      return this.db.upsertTask({ ...task, status:"stopped", updatedAt:now() });
    }
    if (!task.jobId) throw Object.assign(new Error("No verified cx job is linked to this session."), { statusCode:403 });
    const project = this.config.projects.find((item) => item.id === task.projectId)!;
    const result = await this.cx(["stop", task.nativeId], project.realPath);
    if (result.exitCode !== 0) throw new Error(result.stderr.trim() || "Stop failed");
    return this.db.upsertTask({ ...task, status: "stopped", updatedAt: now(), log: `${task.log}\n${stripAnsi(result.stdout)}`.trim() });
  }

  private processMatchesWorker(task: DeckTask) {
    if (!task.pid || !task.pgid || !task.processStart || !task.commandMarker) return false;
    try {
      const stat = fs.readFileSync(`/proc/${task.pid}/stat`, "utf8").split(" ");
      const cmd = fs.readFileSync(`/proc/${task.pid}/cmdline`, "utf8").replaceAll("\0", " ");
      return stat[21] === task.processStart && Number(stat[4]) === task.pgid && cmd.includes("codex-worker.js") && cmd.includes(task.commandMarker);
    } catch { return false; }
  }

  async healthCheck() {
    const runtime=codexRuntimeSelection(this.config.root);
    if(!runtime.binary)return{ok:false,detail:{category:"runtime_not_found",source:runtime.source,version:null,code:"ENOENT"}};
    try{
      const result=await runCommand(runtime.binary,["--version"],{cwd:this.config.root,timeoutMs:15000,outputLimit:65536});
      const version=stripAnsi(result.stdout||result.stderr).trim().slice(0,200)||null;
      if(result.timedOut)return{ok:false,detail:{category:"runtime_timeout",source:runtime.source,version:null}};
      if(result.overflow)return{ok:false,detail:{category:"runtime_invalid_output",source:runtime.source,version:null}};
      if(result.exitCode!==0)return{ok:false,detail:{category:"runtime_rejected",source:runtime.source,version}};
      return{ok:true,detail:{category:"ready",source:runtime.source,version}};
    }catch(error){
      const code=typeof (error as NodeJS.ErrnoException)?.code==="string"?(error as NodeJS.ErrnoException).code:null;
      return{ok:false,detail:{category:code==="ENOENT"?"runtime_not_found":"runtime_unavailable",source:runtime.source,version:null,code}};
    }
  }
}
