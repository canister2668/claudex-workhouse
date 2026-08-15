export type WindowsUpdatePhase="stable"|"pending-health"|"rollback-required"|"blocked-schema";
export type WindowsPendingUpdate={
  version:string;
  previousVersion:string;
  databaseSnapshot:string;
  fromSchema:number;
  toSchema:number;
  schemaReversible:boolean;
  activatedAt:string;
  healthDeadline:string;
};
export type WindowsUpdateState={
  schemaVersion:1;
  phase:WindowsUpdatePhase;
  currentVersion:string;
  previousVersion:string|null;
  pending:WindowsPendingUpdate|null;
  lastMigration:WindowsPendingUpdate|null;
  pendingCleanup:string[];
  lastFailure:string|null;
  updatedAt:string;
};

const VERSION=/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
function version(value:string,label:string){if(!VERSION.test(value))throw new Error(`${label} is invalid.`);return value;}
function schema(value:number,label:string){if(!Number.isSafeInteger(value)||value<0)throw new Error(`${label} is invalid.`);return value;}
function distinct(values:(string|null|undefined)[]){return[...new Set(values.filter((value):value is string=>Boolean(value)))];}
function date(value:string,label:string){const parsed=Date.parse(value);if(!Number.isFinite(parsed))throw new Error(`${label} is invalid.`);return parsed;}
export function parseWindowsUpdateState(value:unknown):WindowsUpdateState{
  if(!value||typeof value!=="object")throw new Error("Windows update state is invalid.");
  const state=value as WindowsUpdateState,phases:WindowsUpdatePhase[]=["stable","pending-health","rollback-required","blocked-schema"];
  if(state.schemaVersion!==1||!phases.includes(state.phase)||!VERSION.test(state.currentVersion)||(state.previousVersion!==null&&!VERSION.test(state.previousVersion))||!Array.isArray(state.pendingCleanup)||state.pendingCleanup.some(item=>typeof item!=="string"||!VERSION.test(item))||new Set(state.pendingCleanup).size!==state.pendingCleanup.length||typeof state.updatedAt!=="string"||!Number.isFinite(Date.parse(state.updatedAt))||(state.lastFailure!==null&&(typeof state.lastFailure!=="string"||state.lastFailure.length>500)))throw new Error("Windows update state fields are invalid.");
  if(state.lastMigration!==null&&state.lastMigration!==undefined)validatePending(state.lastMigration);
  if(state.phase==="stable"){if(state.pending!==null)throw new Error("Stable Windows update state cannot have a pending decision.");if(state.lastMigration&&(state.lastMigration.version!==state.currentVersion||state.lastMigration.previousVersion!==state.previousVersion))throw new Error("Stable Windows migration history is inconsistent.");return{...state,lastMigration:state.lastMigration??null};}
  const pending=state.pending;if(!pending||!VERSION.test(pending.version)||!VERSION.test(pending.previousVersion)||typeof pending.databaseSnapshot!=="string"||!pending.databaseSnapshot.trim()||typeof pending.schemaReversible!=="boolean")throw new Error("Windows pending update is invalid.");
  const{from,to,activated,deadline}=validatePending(pending);
  if(to<from||deadline<=activated||state.currentVersion!==pending.version||state.previousVersion!==pending.previousVersion)throw new Error("Windows pending update invariants are invalid.");
  const irreversible=to>from&&!pending.schemaReversible;
  if((state.phase==="blocked-schema")!==irreversible&&state.phase!=="pending-health")throw new Error("Windows update failure phase is inconsistent with its schema transition.");
  if(state.lastMigration!==null&&state.lastMigration!==undefined)throw new Error("Pending Windows update state cannot retain a confirmed migration.");
  return{...state,lastMigration:null};
}
function validatePending(pending:WindowsPendingUpdate){
  if(!VERSION.test(pending.version)||!VERSION.test(pending.previousVersion)||typeof pending.databaseSnapshot!=="string"||!pending.databaseSnapshot.trim()||typeof pending.schemaReversible!=="boolean")throw new Error("Windows update migration record is invalid.");
  const from=schema(pending.fromSchema,"Source schema"),to=schema(pending.toSchema,"Target schema"),activated=date(pending.activatedAt,"Activation time"),deadline=date(pending.healthDeadline,"Health deadline");if(to<from||deadline<=activated)throw new Error("Windows update migration invariants are invalid.");return{from,to,activated,deadline};
}
export function createWindowsUpdateState(currentVersion:string,now=new Date().toISOString()):WindowsUpdateState{
  return{schemaVersion:1,phase:"stable",currentVersion:version(currentVersion,"Current version"),previousVersion:null,pending:null,lastMigration:null,pendingCleanup:[],lastFailure:null,updatedAt:now};
}
export function beginWindowsUpdate(state:WindowsUpdateState,input:{version:string;databaseSnapshot:string;fromSchema:number;toSchema:number;schemaReversible:boolean;activatedAt?:string;healthDeadline:string}):WindowsUpdateState{
  parseWindowsUpdateState(state);
  if(state.phase!=="stable"||state.pending)throw new Error("A Windows update decision is already pending.");
  const next=version(input.version,"Update version");if(next===state.currentVersion)throw new Error("The requested Windows version is already active.");
  if(!input.databaseSnapshot.trim())throw new Error("A verified database snapshot is required before activation.");
  const activatedAt=input.activatedAt??new Date().toISOString(),fromSchema=schema(input.fromSchema,"Source schema"),toSchema=schema(input.toSchema,"Target schema"),deadline=date(input.healthDeadline,"Health deadline");
  if(toSchema<fromSchema)throw new Error("A Windows update cannot lower the database schema.");if(deadline<=date(activatedAt,"Activation time"))throw new Error("The Windows update health deadline is invalid.");
  const pending:WindowsPendingUpdate={version:next,previousVersion:state.currentVersion,databaseSnapshot:input.databaseSnapshot,fromSchema,toSchema,schemaReversible:input.schemaReversible,activatedAt,healthDeadline:input.healthDeadline};
  const retired=state.previousVersion&&state.previousVersion!==state.currentVersion&&state.previousVersion!==next?[state.previousVersion]:[];
  return{...state,phase:"pending-health",currentVersion:next,previousVersion:state.currentVersion,pending,lastMigration:null,pendingCleanup:distinct([...state.pendingCleanup,...retired]),lastFailure:null,updatedAt:activatedAt};
}
export function confirmWindowsUpdateHealth(state:WindowsUpdateState,now=new Date().toISOString()):WindowsUpdateState{
  parseWindowsUpdateState(state);
  if(state.phase!=="pending-health"||!state.pending)throw new Error("No Windows update is awaiting health confirmation.");
  if(date(now,"Health confirmation time")>date(state.pending.healthDeadline,"Health deadline"))throw new Error("The Windows update health deadline has expired.");
  return{...state,phase:"stable",previousVersion:state.pending.previousVersion,lastMigration:state.pending,pending:null,pendingCleanup:state.pendingCleanup.filter(item=>item!==state.currentVersion&&item!==state.pending?.previousVersion),lastFailure:null,updatedAt:now};
}
export function failWindowsUpdateHealth(state:WindowsUpdateState,reason:string,now=new Date().toISOString()):WindowsUpdateState{
  parseWindowsUpdateState(state);
  if(state.phase!=="pending-health"||!state.pending)throw new Error("No Windows update is awaiting health confirmation.");
  const irreversible=state.pending.toSchema>state.pending.fromSchema&&!state.pending.schemaReversible;
  if(irreversible)return{...state,phase:"blocked-schema",pending:{...state.pending},pendingCleanup:[...state.pendingCleanup],lastFailure:reason.slice(0,500),updatedAt:now};
  return{...state,phase:"rollback-required",pending:{...state.pending},pendingCleanup:[...state.pendingCleanup],lastFailure:reason.slice(0,500),updatedAt:now};
}
export function expireWindowsUpdateHealth(state:WindowsUpdateState,now=new Date().toISOString()):WindowsUpdateState{
  parseWindowsUpdateState(state);if(state.phase!=="pending-health"||!state.pending)throw new Error("No Windows update is awaiting health confirmation.");
  if(date(now,"Health expiration time")<=date(state.pending.healthDeadline,"Health deadline"))return state;
  return failWindowsUpdateHealth(state,"health deadline expired",now);
}
export function acceptWindowsUpdateAfterFailure(state:WindowsUpdateState,input:{operatorConfirmed:boolean;now?:string}):WindowsUpdateState{
  parseWindowsUpdateState(state);if((state.phase!=="rollback-required"&&state.phase!=="blocked-schema")||!state.pending)throw new Error("No failed Windows update is awaiting a decision.");
  if(!input.operatorConfirmed)throw new Error("Explicit operator confirmation is required to keep the failed Windows update.");
  const now=input.now??new Date().toISOString();date(now,"Decision time");
  return{...state,phase:"stable",previousVersion:state.pending.previousVersion,lastMigration:state.pending,pending:null,pendingCleanup:state.pendingCleanup.filter(item=>item!==state.currentVersion&&item!==state.pending?.previousVersion),lastFailure:null,updatedAt:now};
}
export function completeWindowsRollback(state:WindowsUpdateState,input:{snapshotRestored:boolean;now?:string}):WindowsUpdateState{
  parseWindowsUpdateState(state);
  if((state.phase!=="rollback-required"&&state.phase!=="blocked-schema")||!state.pending)throw new Error("No Windows rollback is required.");
  const requiresSnapshot=state.pending.toSchema>state.pending.fromSchema&&!state.pending.schemaReversible;
  if(requiresSnapshot&&!input.snapshotRestored)throw new Error("The database snapshot must be restored before binary rollback.");
  const failed=state.currentVersion,restored=state.pending.previousVersion,now=input.now??new Date().toISOString();
  return{...state,phase:"stable",currentVersion:restored,previousVersion:null,pending:null,lastMigration:null,pendingCleanup:distinct([...state.pendingCleanup,failed]).filter(item=>item!==restored),lastFailure:null,updatedAt:now};
}
export function rollbackConfirmedWindowsUpdate(state:WindowsUpdateState,input:{snapshotRestored:boolean;now?:string}):WindowsUpdateState{
  const parsed=parseWindowsUpdateState(state);if(parsed.phase!=="stable"||!parsed.previousVersion||!parsed.lastMigration)throw new Error("No confirmed N-1 Windows rollback is available.");
  const irreversible=parsed.lastMigration.toSchema>parsed.lastMigration.fromSchema&&!parsed.lastMigration.schemaReversible;
  if(irreversible&&!input.snapshotRestored)throw new Error("The database snapshot must be restored before confirmed binary rollback.");
  const failed=parsed.currentVersion,restored=parsed.previousVersion,now=input.now??new Date().toISOString();date(now,"Rollback time");
  return{...parsed,currentVersion:restored,previousVersion:null,lastMigration:null,pendingCleanup:distinct([...parsed.pendingCleanup,failed]).filter(item=>item!==restored),lastFailure:null,updatedAt:now};
}
export function windowsPendingCleanupPlan(state:WindowsUpdateState,installedVersions:string[]){
  parseWindowsUpdateState(state);
  const protectedVersions=new Set(distinct([state.currentVersion,state.previousVersion,state.pending?.version,state.pending?.previousVersion,state.lastMigration?.previousVersion]));
  return distinct([...state.pendingCleanup,...installedVersions]).filter(item=>VERSION.test(item)&&!protectedVersions.has(item)).sort();
}
