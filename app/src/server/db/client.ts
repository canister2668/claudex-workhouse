import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import readline from "node:readline";
import { AsyncLocalStorage } from "node:async_hooks";
import type { DeckTask } from "../types.js";
import type { ExecutionHost, LogicalProject, WorkChain, WorkChainEvent, Workspace, WorkspaceRoot } from "../types.js";
import { sanitizeSensitiveObject, sanitizeSensitiveText, sanitizeSensitiveValue } from "../sensitive-data.js";

export function sanitizeTaskForPersistence(task: DeckTask): DeckTask {
  const sourceOutput={preserveSourceIdentifiers:true} as const;
  return {
    ...task,
    result: task.result === null ? null : sanitizeSensitiveText(task.result,sourceOutput),
    error: task.error === null ? null : sanitizeSensitiveText(task.error),
    log: sanitizeSensitiveText(task.log,sourceOutput),
    metadata: task.metadata ? sanitizeSensitiveObject(task.metadata,sourceOutput) : task.metadata,
    events: task.events ? sanitizeSensitiveObject(task.events,sourceOutput) : task.events
  };
}

export type DatabaseErrorKind = "timeout" | "overload" | "worker_unavailable";

export class DatabaseRequestError extends Error {
  readonly statusCode = 503;
  readonly code = "database_busy";
  constructor(readonly kind: DatabaseErrorKind, readonly operation: string, message: string) {
    super(message);
    this.name = "DatabaseRequestError";
  }
}

type PendingRequest = {
  operation:string;
  params:Record<string,unknown>;
  enqueuedAt:number;
  startedAt:number|null;
  deadline:number|null;
  timeoutMs:number|undefined;
  timer:NodeJS.Timeout|null;
  trace?:DatabaseRequestTrace;
  resolve(value:unknown):void;
  reject(error:Error):void;
};

export type DatabaseOperationTrace={operation:string;elapsedMs:number;outcome:"ok"|"error"|"timeout"|"worker_unavailable"};
export type DatabaseRequestTrace={operations:DatabaseOperationTrace[];totalMs:number};
const databaseTraceStorage=new AsyncLocalStorage<DatabaseRequestTrace>();
export function runWithDatabaseRequestTrace<T>(trace:DatabaseRequestTrace,callback:()=>T):T{return databaseTraceStorage.run(trace,callback);}

export type DatabaseDiagnostics = {
  available:boolean;
  recovering:boolean;
  restartCount:number;
  consecutiveRestarts:number;
  lastRestartReason:string|null;
  lastRestartAt:string|null;
  queueDepth:number;
  waitingDepth:number;
  maxPending:number;
  defaultTimeoutMs:number;
  currentOperation:string|null;
  currentElapsedMs:number|null;
};

export type DatabaseWorkerLaunch={command:string;args:string[];kind:"python"|"node"};
export function databaseWorkerLaunch(workerPath:string,dbPath:string,options:{platform?:NodeJS.Platform;nodeBinary?:string;nodeWorkerPath?:string;pythonBinary?:string}={}):DatabaseWorkerLaunch{
  const platform=options.platform??process.platform;
  if(platform==="win32"){
    const nodeWorkerPath=options.nodeWorkerPath??workerPath.replace(/\.py$/i,".mjs");
    if(!path.win32.isAbsolute(nodeWorkerPath)&&!path.isAbsolute(nodeWorkerPath))throw new Error("Windows SQLite worker path must be absolute.");
    return{command:options.nodeBinary??process.execPath,args:[nodeWorkerPath,dbPath],kind:"node"};
  }
  // `/bin/python3` only exists where /bin is merged into /usr/bin. A Node
  // install put the server on hosts without that symlink, where the hardcoded
  // path failed before the interpreter was ever consulted. Resolve through
  // PATH, and keep PYTHON_BIN as the explicit override, matching how
  // sqliteMaintenanceInvocation already picks its interpreter.
  return{command:options.pythonBinary??process.env.PYTHON_BIN??"python3",args:[workerPath,dbPath],kind:"python"};
}

export class DeckDatabase {
  private child!: ChildProcessWithoutNullStreams;
  private readonly workerPath:string;
  private readonly dbPath:string;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private outstanding = new Map<number, {operation:string;startedAt:number}>();
  private queue:number[]=[];
  private activeId:number|null=null;
  private available = false;
  private recovering=false;
  private restartCount=0;
  private consecutiveRestarts=0;
  private lastRestartReason:string|null=null;
  private lastRestartAt:string|null=null;
  private workerFirstRequest=true;
  private closed=false;
  private closing:Promise<void>|null=null;

  constructor(workerPath: string, dbPath: string, private options: {defaultTimeoutMs?:number;maxPending?:number;platform?:NodeJS.Platform;nodeBinary?:string;nodeWorkerPath?:string;pythonBinary?:string} = {}) {
    this.workerPath=workerPath;this.dbPath=dbPath;this.startWorker();
  }

  private record(item:PendingRequest,outcome:DatabaseOperationTrace["outcome"]){
    if(!item.trace||item.trace.operations.length>=100)return;
    const elapsedMs=Math.max(0,Date.now()-item.enqueuedAt);
    item.trace.operations.push({operation:item.operation,elapsedMs,outcome});
    item.trace.totalMs+=elapsedMs;
  }

  private startWorker(){
    const forcedNode=process.env.CLAUDEX_WORKHOUSE_DB_WORKER==="node";
    const launch=databaseWorkerLaunch(this.workerPath,this.dbPath,{...this.options,platform:this.options.platform??(forcedNode?"win32":process.platform),nodeWorkerPath:this.options.nodeWorkerPath??process.env.CLAUDEX_WORKHOUSE_NODE_DB_WORKER});
    const child=spawn(launch.command,launch.args,{cwd:path.dirname(this.dbPath),shell:false,windowsHide:true,stdio:["pipe","pipe","pipe"]});
    this.child=child;this.available=true;this.workerFirstRequest=true;
    const lines = readline.createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      let response:{id:number;ok:boolean;result?:unknown;error?:string};
      try{response=JSON.parse(line);}catch{this.recoverWorker("Database worker returned an invalid response.");return;}
      this.outstanding.delete(response.id);
      if(this.activeId===response.id)this.activeId=null;
      const item = this.pending.get(response.id);
      if (!item){this.dispatchNext();return;}
      this.pending.delete(response.id);
      if(item.timer)clearTimeout(item.timer);
      this.record(item,response.ok?"ok":"error");
      this.consecutiveRestarts=0;
      if (response.ok) item.resolve(response.result);
      // Name the operation: a worker-side failure otherwise surfaces as a bare
      // SQL message with no application frames, which says nothing about which
      // call produced it.
      else item.reject(Object.assign(new Error(`${sanitizeSensitiveText(response.error ?? "Database worker error")} (${item.operation})`),{operation:item.operation}));
      this.dispatchNext();
    });
    child.once("exit", (code) => {
      if(child!==this.child||this.recovering||this.closed)return;
      this.recoverWorker(`Database worker exited (${code})`);
    });
    child.once("error",()=>{if(child===this.child&&!this.closed)this.recoverWorker("Database worker could not be started.");});
    child.stdin.on("error",()=>{if(child===this.child&&!this.closed)this.recoverWorker("Database worker input is unavailable.");});
  }

  private failUnavailable(message:string) {
    this.available=false;
    for(const item of this.pending.values()){if(item.timer)clearTimeout(item.timer);this.record(item,"worker_unavailable");item.reject(new DatabaseRequestError("worker_unavailable",item.operation,message));}
    this.pending.clear();this.outstanding.clear();this.queue=[];this.activeId=null;
  }

  private dispatchNext(){
    if(!this.available||this.recovering||this.closed||this.activeId!==null)return;
    let id:number|undefined,item:PendingRequest|undefined;
    while((id=this.queue.shift())!==undefined){item=this.pending.get(id);if(item)break;}
    if(id===undefined||!item)return;
    const requestTimeoutMs=item.timeoutMs??this.options.defaultTimeoutMs??(this.workerFirstRequest?60_000:8_000);
    this.workerFirstRequest=false;item.startedAt=Date.now();item.deadline=item.startedAt+requestTimeoutMs;this.activeId=id;
    this.outstanding.set(id,{operation:item.operation,startedAt:item.startedAt});
    item.timer=setTimeout(()=>{
      const active=this.pending.get(id!);if(!active||this.activeId!==id)return;
      this.pending.delete(id!);this.outstanding.delete(id!);this.activeId=null;this.record(active,"timeout");
      active.reject(new DatabaseRequestError("timeout",active.operation,`Database operation ${active.operation} timed out.`));
      this.recoverWorker(`Database operation ${active.operation} exceeded its ${requestTimeoutMs}ms watchdog.`);
    },requestTimeoutMs);item.timer.unref?.();
    this.child.stdin.write(`${JSON.stringify({id,op:item.operation,params:item.params})}\n`,error=>{
      if(!error)return;const active=this.pending.get(id!);if(!active)return;
      if(active.timer)clearTimeout(active.timer);this.pending.delete(id!);this.outstanding.delete(id!);this.activeId=null;
      this.record(active,"worker_unavailable");active.reject(new DatabaseRequestError("worker_unavailable",active.operation,"Database worker input is unavailable."));
      this.recoverWorker("Database worker input is unavailable.");
    });
  }

  private recoverWorker(reason:string){
    if(this.recovering||this.closed)return;
    if(this.consecutiveRestarts>=3){this.failUnavailable(`${reason} Database worker recovery limit reached.`);return;}
    this.recovering=true;this.available=false;this.restartCount++;this.consecutiveRestarts++;this.lastRestartReason=reason;this.lastRestartAt=new Date().toISOString();
    const old=this.child;this.failUnavailable(`${reason} Restarting the database worker.`);
    if(old.exitCode!==null){this.startWorker();this.recovering=false;return;}
    let finished=false,killTimer:NodeJS.Timeout|undefined,fallbackTimer:NodeJS.Timeout|undefined;
    const finish=()=>{
      if(finished)return;finished=true;if(killTimer)clearTimeout(killTimer);if(fallbackTimer)clearTimeout(fallbackTimer);
      if(this.closed)return;
      this.startWorker();this.recovering=false;
    };
    old.once("exit",finish);
    try{old.kill("SIGTERM");}catch{finish();return;}
    killTimer=setTimeout(()=>{try{old.kill("SIGKILL");}catch{}},1000);killTimer.unref?.();
    fallbackTimer=setTimeout(finish,1500);fallbackTimer.unref?.();
  }

  request<T>(op: string, params: Record<string, unknown> = {}, timeoutMs?:number): Promise<T> {
    if(!this.available)return Promise.reject(new DatabaseRequestError("worker_unavailable",op,"Database worker is unavailable."));
    const maxPending=this.options.maxPending??256;
    if(this.pending.size>=maxPending)return Promise.reject(new DatabaseRequestError("overload",op,"Database request queue is full."));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id,{operation:op,params,enqueuedAt:Date.now(),startedAt:null,deadline:null,timeoutMs,timer:null,trace:databaseTraceStorage.getStore(),resolve:resolve as (value:unknown)=>void,reject});
      this.queue.push(id);this.dispatchNext();
    });
  }

  diagnostics(now=Date.now()):DatabaseDiagnostics {
    const current=this.outstanding.values().next().value as {operation:string;startedAt:number}|undefined;
    return {available:this.available,recovering:this.recovering,restartCount:this.restartCount,consecutiveRestarts:this.consecutiveRestarts,lastRestartReason:this.lastRestartReason,lastRestartAt:this.lastRestartAt,queueDepth:this.pending.size,waitingDepth:Math.max(0,this.pending.size-this.outstanding.size),maxPending:this.options.maxPending??256,defaultTimeoutMs:this.options.defaultTimeoutMs??8000,currentOperation:current?.operation??null,currentElapsedMs:current?Math.max(0,now-current.startedAt):null};
  }

  ping(timeoutMs?:number) {
    return timeoutMs===undefined
      ? this.request<{ journalMode: string; synchronous:number; walAutocheckpoint:number }>("ping")
      : this.request<{ journalMode: string; synchronous:number; walAutocheckpoint:number }>("ping",{},timeoutMs);
  }
  listTasks() { return this.request<DeckTask[]>("list_tasks"); }
  listTasksByWorkChainIds(chainIds:string[]) { return this.request<DeckTask[]>("list_tasks_by_work_chain_ids",{chainIds:chainIds.slice(0,200)}); }
  searchHistoryTasks(params:{query:string;provider?:string;workspaceId?:string;status?:string;from?:string;to?:string;cursorUpdatedAt?:string;cursorId?:string;limit?:number;maxScan?:number}){
    return this.request<{results:Array<Record<string,unknown>>;nextCursor:{updatedAt:string;id:string}|null;scanned:number;exhausted:boolean}>("search_history_tasks",params);
  }
  searchHistoryLocal(params:{query:string;provider?:string;workspaceId?:string;status?:string;from?:string;to?:string;cursorUpdatedAt?:string;cursorKey?:string;limit?:number}){
    return this.request<{results:Array<Record<string,unknown>>;nextCursor:{updatedAt:string;id:string}|null}>("search_history_local",params);
  }
  listPushTasks(taskIds:string[]=[]){return this.request<Array<Pick<DeckTask,"id"|"provider"|"status"|"executionHostId"|"updatedAt">>>("list_push_tasks",{taskIds:taskIds.slice(0,1000)});}
  listProviderTasks(provider: string, limit = 5000) { return this.request<DeckTask[]>("list_provider_tasks", { provider, limit }); }
  listProviderTaskLinksByThreads(provider:string,threadIds:string[]){return this.request<any[]>("list_provider_task_links_by_threads",{provider,threadIds:threadIds.slice(0,100)});}
  // Rows updated after `since`, for callers that keep their own snapshot and
  // only need the delta. Pair with listProviderTaskIds to notice deletions.
  listProviderTasksSince(provider: string, since: string, limit = 5000) { return this.request<DeckTask[]>("list_provider_tasks", { provider, since, limit }); }
  listProviderTaskIds(provider: string) { return this.request<string[]>("list_provider_task_ids", { provider }); }
  listProviderTaskRefreshRows(provider:string){return this.request<DeckTask[]>("list_provider_task_refresh_rows",{provider});}
  listActiveTasks() { return this.request<DeckTask[]>("list_active_tasks"); }
  getTask(id: string) { return this.request<DeckTask | null>("get_task", { id }); }
  getNativeTask(provider: string, nativeId: string) { return this.request<DeckTask | null>("get_native_task", { provider, nativeId }); }
  upsertTask(task: DeckTask) { return this.request<DeckTask>("upsert_task", { task:sanitizeTaskForPersistence(task) }); }
  deleteExternalTaskMirror(provider:string,id:string,threadId:string){return this.request<boolean>("delete_external_task_mirror",{provider,id,threadId});}
  deleteTaskSession(provider:string,threadId:string){return this.request<number>("delete_task_session",{provider,threadId});}
  enqueueSessionMessage(item:Record<string,unknown>){return this.request<any>("enqueue_session_message",{item});}
  updateSessionMessage(id:string,prompt:string,updatedAt:string){return this.request<any|null>("update_session_message",{id,prompt,updatedAt});}
  listSessionMessages(provider:string,threadId:string){return this.request<any[]>("list_session_messages",{provider,threadId});}
  listQueuedSessionMessages(limit=100){return this.request<any[]>("list_queued_session_messages",{limit});}
  listCreditWaitingSessionMessages(limit=100){return this.request<any[]>("list_credit_waiting_session_messages",{limit});}
  deferSessionMessageCredit(id:string,error:string,updatedAt:string){return this.request<any>("defer_session_message_credit",{id,error:sanitizeSensitiveText(error),updatedAt});}
  clearSessionMessageCreditWait(id:string,updatedAt:string){return this.request<any>("clear_session_message_credit_wait",{id,updatedAt});}
  getSessionMessage(id:string){return this.request<any|null>("get_session_message",{id});}
  claimSessionMessage(id:string,updatedAt:string){return this.request<any|null>("claim_session_message",{id,updatedAt});}
  finishSessionMessage(id:string,status:"queued"|"delivery-uncertain"|"sent"|"failed",updatedAt:string,dispatchedTaskId?:string|null,error?:string|null){return this.request<any>("finish_session_message",{id,status,updatedAt,dispatchedTaskId,error:error==null?error:sanitizeSensitiveText(error)});}
  retrySessionMessage(id:string,updatedAt:string){return this.request<any>("retry_session_message",{id,updatedAt});}
  resolveSessionMessageSent(id:string,updatedAt:string){return this.request<any>("resolve_session_message_sent",{id,updatedAt});}
  deleteSessionMessage(id:string){return this.request<boolean>("delete_session_message",{id});}
  recoverSessionMessages(updatedAt:string){return this.request<number>("recover_session_messages",{updatedAt});}
  createQuotaTaskReservation(item:Record<string,unknown>){return this.request<any>("create_quota_task_reservation",{item});}
  getQuotaTaskReservation(id:string){return this.request<any|null>("get_quota_task_reservation",{id});}
  listQuotaTaskReservations(params:{includeTerminal?:boolean;includeFailed?:boolean;provider?:string;limit?:number}={}){return this.request<any[]>("list_quota_task_reservations",params);}
  listDueQuotaTaskReservations(now:string,limit=100){return this.request<any[]>("list_due_quota_task_reservations",{now,limit});}
  claimQuotaTaskReservation(id:string,now:string,quotaStatus:string){return this.request<any|null>("claim_quota_task_reservation",{id,now,quotaStatus});}
  rescheduleQuotaTaskReservation(id:string,now:string,fields:Record<string,unknown>){return this.request<any|null>("reschedule_quota_task_reservation",{id,now,...fields});}
  markQuotaTaskReservationStarting(id:string,now:string,taskId:string){return this.request<any|null>("mark_quota_task_reservation_starting",{id,now,taskId});}
  markQuotaTaskReservationStarted(id:string,now:string,taskId:string){return this.request<any|null>("mark_quota_task_reservation_started",{id,now,taskId});}
  failQuotaTaskReservation(id:string,now:string,error:string){return this.request<any|null>("fail_quota_task_reservation",{id,now,error});}
  retryQuotaTaskReservation(id:string,now:string){return this.request<any|null>("retry_quota_task_reservation",{id,now});}
  cancelQuotaTaskReservation(id:string,now:string){return this.request<any|null>("cancel_quota_task_reservation",{id,now});}
  recoverQuotaTaskReservations(now:string,staleBefore?:string){return this.request<any[]>("recover_quota_task_reservations",{now,staleBefore});}
  getTaskRecoveryAttempt(sourceTaskId:string){return this.request<any|null>("get_task_recovery_attempt",{sourceTaskId});}
  claimTaskRecovery(params:{sourceTaskId:string;attemptId:string;promptHash:string;now:string}){return this.request<{claimed:boolean;attempt:any}>("claim_task_recovery",params);}
  finishTaskRecovery(params:{sourceTaskId:string;attemptId:string;status:"started"|"failed";now:string;resumedTaskId?:string|null;error?:string|null}){return this.request<any|null>("finish_task_recovery",params);}
  releaseTaskRecoveryClaim(params:{sourceTaskId:string;attemptId:string}){return this.request<boolean>("release_task_recovery_claim",params);}
  recoverTaskRecoveryAttempts(now:string){return this.request<any[]>("recover_task_recovery_attempts",{now});}
  latestThreadTask(provider:string,threadId:string){return this.request<DeckTask|null>("latest_thread_task",{provider,threadId});}
  claimIdempotency(params: Record<string, unknown>) { return this.request<{ claimed: boolean; state: string; requestHash: string; response: unknown }>("claim_idempotency", params); }
  finishIdempotency(params: Record<string, unknown>) { return this.request<boolean>("finish_idempotency", params); }
  async appendAudit(params: Record<string, unknown>) {
    const safeParams=sanitizeSensitiveObject(params);
    try{return await this.request<boolean>("append_audit",safeParams);}
    catch(error){if(!(error instanceof DatabaseRequestError))throw error;const retry=setTimeout(()=>{void this.request<boolean>("append_audit",safeParams).catch(()=>{});},1000);retry.unref?.();return true;}
  }
  provenTaskIds() { return this.request<string[]>("proven_task_ids"); }
  upsertCodexThread(thread: Record<string, unknown>) { return this.request<any>("upsert_codex_thread", { thread:sanitizeSensitiveObject(thread,{preserveSourceIdentifiers:true}) }); }
  applyTaskThreadSettings(tasks:DeckTask[],thread:Record<string,unknown>){return this.request<{tasks:DeckTask[];thread:any}>("apply_task_thread_settings",{tasks:tasks.map(sanitizeTaskForPersistence),thread:sanitizeSensitiveObject(thread,{preserveSourceIdentifiers:true})});}
  getCodexThread(threadId: string) { return this.request<any | null>("get_codex_thread", { threadId }); }
  listCodexThreads(archived = false, limit = 100) { return this.request<any[]>("list_codex_threads", { archived, limit }); }
  listCodexThreadsByIds(threadIds:string[]){return this.request<any[]>("list_codex_threads_by_ids",{threadIds:threadIds.slice(0,100)});}
  deleteCodexThread(threadId: string) { return this.request<boolean>("delete_codex_thread", { threadId }); }
  putCache(key: string, value: unknown, fetchedAt: string, expiresAt: string, version?: string) { return this.request<boolean>("put_cache", { key, value:sanitizeSensitiveValue(value), fetchedAt, expiresAt, version }); }
  getCache(key: string) { return this.request<{value:unknown;fetchedAt:string;expiresAt:string;version?:string} | null>("get_cache", { key }); }
  listPushSubscriptions(){return this.request<any[]>("list_push_subscriptions");}
  upsertPushSubscription(subscription:Record<string,unknown>){return this.request<boolean>("upsert_push_subscription",{subscription});}
  disablePushSubscription(params:Record<string,unknown>){return this.request<boolean>("disable_push_subscription",params);}
  disableAllPushSubscriptions(disabledAt:string){return this.request<boolean>("disable_all_push_subscriptions",{disabledAt});}
  putSystemSetting(key:string,value:unknown,updatedAt:string){return this.request<boolean>("put_system_setting",{key,value,updatedAt});}
  putSystemSettingIfUpdated(key:string,value:unknown,updatedAt:string,expectedUpdatedAt:string|null){return this.request<{updated:boolean;current:{value:any;updatedAt:string}|null}>("put_system_setting_if_updated",{key,value,updatedAt,expectedUpdatedAt});}
  getSystemSetting(key:string){return this.request<{value:any;updatedAt:string}|null>("get_system_setting",{key});}
  listExternalAccessProfiles(){return this.request<any[]>("list_external_access_profiles");}
  getExternalAccessProfile(id:string){return this.request<any|null>("get_external_access_profile",{id});}
  upsertExternalAccessProfile(profile:Record<string,unknown>,expectedRevision?:number){return this.request<{updated:boolean;current:any}>("upsert_external_access_profile",{profile,expectedRevision});}
  deleteExternalAccessProfile(id:string,revision:number){return this.request<boolean>("delete_external_access_profile",{id,revision});}
  createExternalAccessOperation(operation:Record<string,unknown>){return this.request<any>("create_external_access_operation",{operation});}
  updateExternalAccessOperation(operation:Record<string,unknown>){return this.request<any>("update_external_access_operation",{operation});}
  getExternalAccessOperation(id:string){return this.request<any|null>("get_external_access_operation",{id});}
  listExternalAccessChecks(operationId:string){return this.request<any[]>("list_external_access_checks",{operationId});}
  appendExternalAccessCheck(check:Record<string,unknown>){return this.request<boolean>("append_external_access_check",{check});}
  reconcileExternalAccessOperations(now:string){return this.request<number>("reconcile_external_access_operations",{now});}
  createProtonUploadOperation(operation:Record<string,unknown>){return this.request<any>("create_proton_upload_operation",{operation:sanitizeSensitiveObject(operation,{preserveSourceIdentifiers:true})});}
  updateProtonUploadOperation(operation:Record<string,unknown>){return this.request<any>("update_proton_upload_operation",{operation:sanitizeSensitiveObject(operation,{preserveSourceIdentifiers:true})});}
  getProtonUploadOperation(id:string){return this.request<any|null>("get_proton_upload_operation",{id});}
  listProtonUploadOperations(limit=50){return this.request<any[]>("list_proton_upload_operations",{limit});}
  reconcileProtonUploadOperations(now:string){return this.request<number>("reconcile_proton_upload_operations",{now});}
  createApplicationUpdateAttempt(attempt:any){return this.request<any>("create_application_update_attempt",{attempt:sanitizeSensitiveObject(attempt)});}
  updateApplicationUpdateAttempt(attempt:any){return this.request<any>("update_application_update_attempt",{attempt:sanitizeSensitiveObject(attempt)});}
  getActiveApplicationUpdateAttempt(){return this.request<any|null>("get_active_application_update_attempt",{});}
  getApplicationUpdateAttempt(id:string){return this.request<any|null>("get_application_update_attempt",{id});}
  listApplicationUpdateAttempts(limit=10){return this.request<any[]>("list_application_update_attempts",{limit});}
  acceptReleaseState(state:object,updatedAt:string){return this.request<{accepted:boolean;reused?:boolean;reason?:"downgrade"|"equivocation"|"channel-mismatch"|"invalid-state";current:any|null}>("accept_release_state",{state,updatedAt});}
  upsertSnapshot(snapshot:Record<string,unknown>){return this.request<any>("upsert_snapshot",{snapshot:sanitizeSensitiveObject(snapshot)});}
  getSnapshot(id:string){return this.request<any|null>("get_snapshot",{id});}
  listSnapshots(){return this.request<any[]>("list_snapshots");}
  listHosts() { return this.request<ExecutionHost[]>("list_hosts"); }
  getHost(id: string) { return this.request<ExecutionHost | null>("get_host", { id }); }
  upsertHost(host: Partial<ExecutionHost> & { id:string }) { return this.request<ExecutionHost>("upsert_host", { host:sanitizeSensitiveObject(host) }); }
  putWorkerCredential(params: Record<string,unknown>) { return this.request<boolean>("put_worker_credential", params); }
  getWorkerCredential(hostId: string) { return this.request<any | null>("get_worker_credential", { hostId }); }
  revokeWorkerCredential(hostId: string, revokedAt: string) { return this.request<boolean>("revoke_worker_credential", { hostId, revokedAt }); }
  createBootstrapEnrollment(enrollment:Record<string,unknown>){return this.request<any>("create_bootstrap_enrollment",{enrollment});}
  replaceBootstrapEnrollment(enrollment:Record<string,unknown>){return this.request<any>("replace_bootstrap_enrollment",{enrollment});}
  getBootstrapEnrollment(id:string){return this.request<any|null>("get_bootstrap_enrollment",{id});}
  getActiveBootstrapEnrollment(scope:"server-owner"|"worker",now:string){return this.request<any|null>("get_active_bootstrap_enrollment",{scope,now});}
  consumeOwnerBootstrapEnrollment(params:{id:string;tokenHash:string;now:string;owner:Record<string,unknown>}){return this.request<any|null>("consume_owner_bootstrap_enrollment",params);}
  recoverOwnerBootstrapEnrollment(params:{enrollment:Record<string,unknown>;recovery:Record<string,unknown>}){return this.request<any>("recover_owner_bootstrap_enrollment",params);}
  listWorkspaceRoots(hostId?: string) { return this.request<WorkspaceRoot[]>("list_workspace_roots", { hostId }); }
  upsertWorkspaceRoot(root: Partial<WorkspaceRoot> & {id:string}) { return this.request<WorkspaceRoot>("upsert_workspace_root", { root }); }
  listProjects() { return this.request<LogicalProject[]>("list_projects"); }
  upsertProject(project: Partial<LogicalProject> & {id:string}) { return this.request<LogicalProject>("upsert_project", { project }); }
  listWorkspaces(params: {hostId?:string;projectId?:string;includeArchived?:boolean} = {}) { return this.request<Workspace[]>("list_workspaces", params); }
  getWorkspace(id: string) { return this.request<Workspace | null>("get_workspace", { id }); }
  upsertWorkspace(workspace: Partial<Workspace> & {id:string}) { return this.request<Workspace>("upsert_workspace", { workspace }); }
  archiveWorkspace(id: string, archivedAt: string) { return this.request<boolean>("archive_workspace", { id, archivedAt }); }
  createWorkChain(chain: Partial<WorkChain> & Pick<WorkChain,"id"|"projectId"|"title"|"createdAt"|"updatedAt">) { return this.request<WorkChain>("upsert_work_chain", { chain }); }
  getWorkChain(id: string) { return this.request<WorkChain | null>("get_work_chain", { id }); }
  listBoardCards(filters:{projectId?:string;workspaceId?:string;includeArchived?:boolean}={}) { return this.request<WorkChain[]>("list_board_cards",filters); }
  updateBoardCard(card:Partial<WorkChain>&Pick<WorkChain,"id"|"title"|"description"|"boardStatus"|"priority"|"roles"|"updatedAt">,expectedRevision:number) { return this.request<{updated:boolean;current:WorkChain|null}>("update_board_card",{card,expectedRevision}); }
  appendWorkChainEvent(event:WorkChainEvent) { return this.request<{inserted:boolean;event:WorkChainEvent}>("append_work_chain_event",{event}); }
  listWorkChainEvents(chainId:string,limit=200) { return this.request<WorkChainEvent[]>("list_work_chain_events",{chainId,limit}); }
  attachBoardSession(input:{chainId:string;taskId?:string;collaborationSessionId?:string;event?:WorkChainEvent}) { return this.request<{attached:boolean;reason?:"not-found"|"conflict";chain:WorkChain|null;event?:WorkChainEvent}>("attach_board_session",input); }
  listChainLinks(chainId: string) { return this.request<any[]>("list_session_links", { chainId }); }
  upsertSessionLink(link: Record<string,unknown>) { return this.request<any>("upsert_session_link", { link }); }
  upsertHandoffArtifact(artifact: Record<string,unknown>) { return this.request<any>("upsert_handoff_artifact", { artifact }); }
  getHandoffArtifact(id: string) { return this.request<any | null>("get_handoff_artifact", { id }); }
  upsertManagedArtifact(artifact:Record<string,unknown>){return this.request<any>("upsert_managed_artifact",{artifact});}
  upsertManagedArtifacts(artifacts:Array<Record<string,unknown>>){return this.request<number>("upsert_managed_artifacts",{artifacts:artifacts.slice(0,10000)});}
  listManagedArtifacts(limit=5000){return this.request<any[]>("list_managed_artifacts",{limit});}
  listWorkspaceLeases(workspaceId: string) { return this.request<any[]>("list_workspace_leases", { workspaceId }); }
  upsertWorkspaceLease(lease: Record<string,unknown>) { return this.request<any>("upsert_workspace_lease", { lease }); }
  releaseWorkspaceLease(id: string, releasedAt: string) { return this.request<boolean>("release_workspace_lease", { id, releasedAt }); }
  upsertCollaborationSession(session: Record<string,unknown>) { return this.request<any>("upsert_collaboration_session", { session:sanitizeSensitiveObject(session,{preserveSourceIdentifiers:true}) }); }
  getCollaborationSession(id: string) { return this.request<any | null>("get_collaboration_session", { id }); }
  getCollaborationDetailSnapshot(id:string){return this.request<{session:any|null;participants:any[];runs:any[];messages:any[];avatarStates:any[]}>("get_collaboration_detail_snapshot",{id});}
  listCollaborationSessions(includeArchived = false) { return this.request<any[]>("list_collaboration_sessions", { includeArchived }); }
  listCollaborationSessionsByWorkChainIds(chainIds:string[],includeArchived=false) { return this.request<any[]>("list_collaboration_sessions_by_work_chain_ids",{chainIds:chainIds.slice(0,200),includeArchived}); }
  deleteCollaborationSession(id: string) { return this.request<{deleted:boolean;artifactPaths:string[]}>("delete_collaboration_session", { id }); }
  upsertCollaborationParticipant(participant: Record<string,unknown>) { return this.request<any>("upsert_collaboration_participant", { participant }); }
  listCollaborationParticipants(collaborationSessionId: string) { return this.request<any[]>("list_collaboration_participants", { collaborationSessionId }); }
  upsertCollaborationRun(run: Record<string,unknown>) { return this.request<any>("upsert_collaboration_run", { run:sanitizeSensitiveObject(run,{preserveSourceIdentifiers:true}) }); }
  createCollaborationRun(run: Record<string,unknown>) { return this.request<any>("create_collaboration_run", { run:sanitizeSensitiveObject(run,{preserveSourceIdentifiers:true}) }); }
  getCollaborationRun(id: string) { return this.request<any | null>("get_collaboration_run", { id }); }
  listCollaborationRuns(collaborationSessionId: string) { return this.request<any[]>("list_collaboration_runs", { collaborationSessionId }); }
  insertCollaborationMessage(message: object) { return this.request<any>("insert_collaboration_message", { message }); }
  listCollaborationMessages(collaborationSessionId: string) { return this.request<any[]>("list_collaboration_messages", { collaborationSessionId }); }
  insertRelayArtifact(artifact: Record<string,unknown>) { return this.request<any>("insert_relay_artifact", { artifact }); }
  getRelayArtifact(id: string) { return this.request<any | null>("get_relay_artifact", { id }); }
  updateRelayArtifactStatus(id: string, status: string, deliveredAt?: string | null) { return this.request<any>("update_relay_artifact_status", { id, status, deliveredAt }); }
  upsertCollaborationAvatarState(state: object) { return this.request<any>("upsert_collaboration_avatar_state", { state }); }
  listCollaborationAvatarStates(collaborationSessionId: string) { return this.request<any[]>("list_collaboration_avatar_states", { collaborationSessionId }); }
  acquireCollaborationLease(lease: Record<string,unknown>) { return this.request<any>("acquire_collaboration_lease", { lease }); }
  heartbeatCollaborationLease(params: Record<string,unknown>) { return this.request<boolean>("heartbeat_collaboration_lease", params); }
  releaseCollaborationLeases(params: Record<string,unknown>) { return this.request<number>("release_collaboration_leases", params); }
  listCollaborationLeases(workspaceId?: string) { return this.request<any[]>("list_collaboration_leases", { workspaceId }); }
  backfillLocalAssignments(params: Record<string,unknown>) { return this.request<Record<string,number>>("backfill_local_assignments", params); }
  listUnassignedLocations() { return this.request<Array<{projectId:string|null;cwd:string|null}>>("list_unassigned_locations"); }
  backfillLocalLocations(params: Record<string,unknown>) { return this.request<Record<string,number>>("backfill_local_locations", params); }

  async close() {
    if(this.closing)return this.closing;
    this.closing=(async()=>{
      this.closed=true;this.available=false;
      if(this.child.exitCode!==null)return;
      this.child.stdin.end();
      await Promise.race([new Promise<void>(resolve=>this.child.once("exit",()=>resolve())),new Promise<void>(resolve=>{const timer=setTimeout(()=>{this.child.kill("SIGTERM");resolve();},2000);timer.unref?.();})]);
    })();
    return this.closing;
  }
}
