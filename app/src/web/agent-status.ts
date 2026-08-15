import {latestThreadRows} from "./provider-session-grouping";
import {INDEPENDENT_CLASSIFICATIONS,classifyProviderSession,type ClassifiableSession,type SessionClassificationContext} from "./session-classification";

export type AgentProvider = "codex" | "claude" | "deepseek" | "ollama" | "antigravity" | "grok";

export type AgentRecentStatus = {
  provider: AgentProvider;
  taskId?: string | null;
  status: string;
  title: string;
  updatedAt: string;
  threadId?: string | null;
};

export type AgentRecentSession = AgentRecentStatus & { projectId?: string | null };
export type CollaborationRecentStatuses = Partial<Record<AgentProvider,AgentRecentStatus|null>>;

type SessionRow = { id:string; provider:AgentProvider; status:string; title:string; createdAt?:string|null; updatedAt:string; threadId?:string|null; projectId?:string|null };

const activeStatuses=new Set(["pending","queued","running","waiting"]);
const collaborationProviders:AgentProvider[]=["codex","claude","grok","antigravity","deepseek","ollama"];

export function activeAgentStatus(recent:AgentRecentStatus|null|undefined){return Boolean(recent&&activeStatuses.has(recent.status));}
export function prioritizeCollaborationStatus(collaboration:AgentRecentStatus|null|undefined,fallback:AgentRecentStatus|null){
  if(activeAgentStatus(collaboration))return collaboration??null;
  if(activeAgentStatus(fallback))return fallback;
  return collaboration??fallback;
}
export function chooseProviderRecent(task:AgentRecentStatus|null,session:AgentRecentStatus|null){
  if(!task)return session;if(!session)return task;
  const taskActive=activeStatuses.has(task.status),sessionActive=activeStatuses.has(session.status);
  // A resumed native thread announces the new turn as active before the
  // Workhouse task id in that snapshot advances. If the DB row with that old
  // id is already terminal, the active thread status is the only fresh part
  // of the snapshot and must win until the new task row arrives.
  if(task.taskId&&session.taskId&&task.taskId===session.taskId){
    if(sessionActive&&!taskActive)return session;
    return task;
  }
  // The task endpoint is authoritative for a Workhouse-owned active run. A
  // native thread snapshot can still describe the preceding turn as running
  // while its completion hook arrives, and must not steal the provider avatar
  // from a newer task in that same thread.
  if(taskActive)return task;
  if(sessionActive)return session;
  return task.updatedAt>=session.updatedAt?task:session;
}
export function avatarTaskStreamKey(recent:AgentRecentStatus|null,suspended=false){return !suspended&&recent?.taskId&&activeStatuses.has(recent.status)?`${recent.taskId}:${recent.status}`:"";}
// The avatar dock follows independent work: managed, Assist and ordinary
// provider tasks, plus the browser runtime it has always tracked. Board rows
// join only while their card is on screen.
export function avatarSessionRows<T extends ClassifiableSession>(rows:T[],visibleBoardChainIds?:ReadonlySet<string>,context:SessionClassificationContext={}){
  return rows.filter(row=>{
    const classification=classifyProviderSession(row,{...context,boardChainIds:visibleBoardChainIds});
    if(INDEPENDENT_CLASSIFICATIONS.has(classification)||classification==="browser-task")return true;
    return classification==="board-participant"&&Boolean(row.workChainId&&visibleBoardChainIds?.has(row.workChainId));
  });
}

function collaborationStatus(run:any,task:any){
  const taskStatus=String(task?.status??"");
  if(activeStatuses.has(taskStatus))return taskStatus;
  const status=String(run?.status??"");
  if(status==="queued")return"queued";
  if(status==="starting"||status==="running")return"running";
  if(status==="waiting-user"||status==="waiting-approval")return"waiting";
  if(status==="completed")return"completed";
  if(status==="cancelled"||status==="stop-unconfirmed")return"stopped";
  if(status==="failed"||status==="timed-out")return"failed";
  return taskStatus||"unknown";
}

export function collaborationRecentStatuses(detail:any):CollaborationRecentStatuses{
  const result:CollaborationRecentStatuses={},participants=Array.isArray(detail?.participants)?detail.participants:[],runs=Array.isArray(detail?.runs)?detail.runs:[],tasks=detail?.tasks??{};
  const enabled=new Set(Array.isArray(detail?.session?.metadata?.enabledProviders)?detail.session.metadata.enabledProviders:participants.filter((item:any)=>!item?.archivedAt).map((item:any)=>item.provider));
  for(const provider of collaborationProviders){
    const people=participants.filter((item:any)=>item?.provider===provider&&!item?.archivedAt&&enabled.has(provider));
    const personIds=new Set(people.map((item:any)=>item.id)),candidates=runs.filter((run:any)=>personIds.has(run?.participantId));
    const run=[...candidates].sort((left:any,right:any)=>Number(right?.sequence??0)-Number(left?.sequence??0)||Number(right?.generation??0)-Number(left?.generation??0)||String(right?.updatedAt??right?.startedAt??"").localeCompare(String(left?.updatedAt??left?.startedAt??"")))[0];
    if(!run)continue;
    const task=run.providerTaskId?tasks[run.providerTaskId]:null,person=people.find((item:any)=>item.id===run.participantId);
    result[provider]={provider,taskId:run.providerTaskId??null,status:collaborationStatus(run,task),title:task?.title??detail?.session?.title??`${provider} conversation`,updatedAt:task?.updatedAt??run.updatedAt??run.startedAt??detail?.session?.updatedAt??"",threadId:task?.threadId??person?.providerSessionId??null};
  }
  return result;
}

function latestSessions(rows:SessionRow[],provider:AgentProvider,accept:(status:string)=>boolean,limit:number):AgentRecentSession[]{
  const result:AgentRecentSession[]=[];
  for(const row of latestThreadRows(rows.filter(item=>item.provider===provider)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))){
    if(!accept(row.status))continue;
    result.push({provider,taskId:row.id,status:row.status,title:row.title,updatedAt:row.updatedAt,threadId:row.threadId??null,projectId:row.projectId??null});
    if(result.length>=limit)break;
  }
  return result;
}

export function activeSessions(rows:SessionRow[],provider:AgentProvider,limit=4){return latestSessions(rows,provider,status=>activeStatuses.has(status),limit);}

export function recentCompletedSessions(rows: SessionRow[], provider: AgentProvider, limit = 4): AgentRecentSession[] {
  return latestSessions(rows,provider,status=>status==="completed",limit);
}

export function taskForRecentSession<T extends SessionRow>(rows:T[],session:AgentRecentSession):T|null{
  const providerRows=rows.filter(row=>row.provider===session.provider);
  if(session.taskId){const exact=providerRows.find(row=>row.id===session.taskId);if(exact)return exact;}
  return providerRows.filter(row=>session.threadId&&row.threadId===session.threadId).sort((left,right)=>(right.createdAt??right.updatedAt).localeCompare(left.createdAt??left.updatedAt)||right.updatedAt.localeCompare(left.updatedAt))[0]??null;
}
