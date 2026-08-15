export type SessionEmotionState={emotion:string;line:string;statusLine:string;lineKey?:string;statusKey?:string;outfit:string;source?:string;sessionId?:string;taskId?:string};
export type EmotionAssetEntry={emotion:string;file:string};

export function emotionAssetFile(catalog:Record<string,EmotionAssetEntry[]>,outfit:string,emotion:string,fallback:string){
  return catalog[outfit]?.find(asset=>asset.emotion===emotion)?.file??fallback;
}

export function mergeEmotionState<T extends SessionEmotionState>(current:T,value:unknown):T{
  if(!value||typeof value!=="object")return current;
  const incoming=value as Partial<T>;
  return{...current,...incoming,lineKey:incoming.lineKey,statusKey:incoming.statusKey} as T;
}

export function localizedEmotionCopy(translate:(key:string)=>string,key:string|undefined,literal:string){
  if(!key)return literal;
  const value=translate(key);
  return value===key||value.startsWith("[missing:")?literal:value;
}

export function emotionStateMatchesSession(state:SessionEmotionState,sessionId:string|null|undefined,taskId?:string|null){
  // A task id is globally unique inside Workhouse and is therefore the primary
  // scope. Native providers can announce their session id after the first
  // emotion update, and requiring both ids made a correctly task-scoped update
  // disappear until that handshake completed.
  if(taskId)return state.taskId===taskId;
  return Boolean(sessionId&&state.sessionId===sessionId);
}

const activeTaskStatuses=new Set(["pending","queued","running","reasoning","acting","waiting","waiting-user","waiting-approval"]);
const terminalWorkerEmotions=new Set(["happy","proud","disappointed"]);
// Only these sources speak for the model itself. Everything else -- workers,
// lifecycle hooks, outfit writes that carry the previous emotion forward -- is
// bookkeeping, and its "완료" must never survive into an active run.
export const expressiveEmotionSource=(source:string|undefined)=>{
  const value=String(source??"");
  return value==="mcp"||value.startsWith("mcp-")||value.endsWith("-catch");
};
export function emotionStateMatchesContext(state:SessionEmotionState,sessionId:string|null|undefined,taskId:string|null|undefined,status:string|undefined){
  if(!emotionStateMatchesSession(state,sessionId,taskId))return false;
  // A native thread snapshot can announce the next turn as active before it
  // exposes that turn's new Workhouse task id. During that gap, the context
  // still names the preceding task. Never let its outcome override the
  // authoritative active status. Explicit MCP expressions remain eligible.
  return !(status&&activeTaskStatuses.has(status)&&terminalWorkerEmotions.has(state.emotion)&&!expressiveEmotionSource(state.source));
}

export function statusEmotion(status:string|undefined){
  return status&&["pending","queued","running","reasoning","acting"].includes(status)?"coding"
    :status&&["waiting","waiting-user","waiting-approval","stale"].includes(status)?"confused"
    :status==="completed"?"happy"
    :status&&["failed","stopped"].includes(status)?"sad"
    :"neutral";
}
