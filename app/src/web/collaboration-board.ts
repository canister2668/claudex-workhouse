export const COLLABORATION_BOARD_STATUSES = ["queued","in_progress","review","approval","completed"] as const;
export const COLLABORATION_BOARD_PRIORITIES = ["low","normal","high","urgent"] as const;

export type CollaborationBoardStatus = typeof COLLABORATION_BOARD_STATUSES[number];
export type CollaborationBoardPriority = typeof COLLABORATION_BOARD_PRIORITIES[number];
export type CollaborationBoardProvider = "codex"|"claude"|"grok"|"antigravity"|"deepseek"|"ollama";
export type CollaborationBoardAutomation = "full"|"auto"|"confirm"|"read";
export type CollaborationBoardWorkMode = "default"|"plan";
export type CollaborationBoardModel = {id:string;displayName:string;hidden?:boolean;supportedReasoningEfforts?:Array<{reasoningEffort:string}>;defaultReasoningEffort?:string;serviceTiers?:Array<{id:string}>};
export type CollaborationBoardProviderExecution = {
  provider:CollaborationBoardProvider; models:CollaborationBoardModel[]; efforts:Array<{id:string}>;
  defaultModel:string; defaultReasoningEffort:string; defaultServiceTier:string|null;
  defaultWorkMode:CollaborationBoardWorkMode; defaultAutomationLevel:CollaborationBoardAutomation; defaultPermissionProfile:string;
  defaultGoogleSearchMode?:"off"|"auto"|"always";
};
export type CollaborationBoardExecutionConfig = {defaultProvider:CollaborationBoardProvider;providers:CollaborationBoardProviderExecution[];fullAccessAcknowledged:boolean};
export type CollaborationBoardRole = {
  provider:CollaborationBoardProvider; model?:string|null; reasoningEffort?:string|null; serviceTier?:string|null;
  permissionProfile?:string|null; workMode?:CollaborationBoardWorkMode; automationLevel?:CollaborationBoardAutomation;
  googleSearchMode?:"off"|"auto"|"always";
};
export type CollaborationBoardRoles = { implementer?:CollaborationBoardRole|null; reviewer?:CollaborationBoardRole|null; secondaryReviewer?:CollaborationBoardRole|null };
export type CollaborationBoardWorkflowAutomation = {mode:"manual"|"auto";state:"idle"|"running"|"stopping"|"paused"|"blocked";stage:"work"|"review"|"revision"|"approval"|null;stopAfter:"work"|"review"|null;round:number;pauseReason:string|null};
export type CollaborationBoardSession = {
  id:string; kind:"task"|"collaboration"; title:string; provider?:CollaborationBoardProvider|null; role?:string|null;
  status:string; executionHostId?:string|null; permissionProfile?:string|null; createdAt?:string|null; updatedAt?:string|null;
  result?:string|null; error?:string|null;
};
export type CollaborationBoardAttachCandidate = {id:string;kind:"task"|"collaboration";title:string;provider?:CollaborationBoardProvider|null;status:string};
export type CollaborationBoardEvent = {
  id:string; chainId:string; eventType:string; taskId?:string|null; collaborationSessionId?:string|null;
  actorType?:string|null; actorId?:string|null; payload?:Record<string,unknown>; payloadJson?:string|null; createdAt:string;
};
export type CollaborationBoardCard = {
  id:string; title:string; description:string; boardStatus:CollaborationBoardStatus; priority:CollaborationBoardPriority;
  boardVisible:boolean; workspaceId?:string|null; targetBranch?:string|null; roles:CollaborationBoardRoles;
  automation:CollaborationBoardWorkflowAutomation;
  lastActivityAt?:string|null; completedAt?:string|null; archivedAt?:string|null; revision:number;
  sessions:CollaborationBoardSession[]; activeSessionCount:number;
};
export type CollaborationBoardDraft = {
  title:string; description:string; boardStatus:CollaborationBoardStatus; priority:CollaborationBoardPriority;
  workspaceId:string|null; targetBranch:string; roles:CollaborationBoardRoles;
  sourceTaskId?:string;
};
export type BoardApi = (path:string,options?:{method?:string;headers?:Record<string,string>;body?:string})=>Promise<any>;

const permissionForAutomation=(provider:CollaborationBoardProvider,level:CollaborationBoardAutomation)=>level==="full"?":danger-full-access":level==="read"?":read-only":provider==="codex"?":workspace":":workspace-write";
export function boardProviderExecution(config:CollaborationBoardExecutionConfig,provider:CollaborationBoardProvider){return config.providers.find(item=>item.provider===provider);}
export function boardDefaultRole(config:CollaborationBoardExecutionConfig,provider:CollaborationBoardProvider):CollaborationBoardRole{
  const value=boardProviderExecution(config,provider);
  if(!value)return{provider,model:null,permissionProfile:permissionForAutomation(provider,"auto"),workMode:"default",automationLevel:"auto"};
  return{provider,model:value.defaultModel||null,reasoningEffort:value.defaultReasoningEffort||null,serviceTier:value.defaultServiceTier,permissionProfile:value.defaultPermissionProfile,workMode:value.defaultWorkMode,automationLevel:value.defaultAutomationLevel,...(provider==="antigravity"?{googleSearchMode:value.defaultGoogleSearchMode??"off" as const}:{})};
}
export function boardDefaultRoles(config:CollaborationBoardExecutionConfig):CollaborationBoardRoles{
  const available=config.providers.filter(item=>item.models.length),implementer=available.some(item=>item.provider===config.defaultProvider)?config.defaultProvider:(available[0]?.provider??config.defaultProvider);
  return{implementer:boardDefaultRole(config,implementer)};
}
export function normalizeBoardRole(config:CollaborationBoardExecutionConfig,value:CollaborationBoardRole):CollaborationBoardRole{
  const defaults=boardDefaultRole(config,value.provider),execution=boardProviderExecution(config,value.provider),model=execution?.models.some(item=>item.id===value.model)?value.model:defaults.model,automationLevel=value.automationLevel??defaults.automationLevel??"auto",validPermission=typeof value.permissionProfile==="string"&&value.permissionProfile.startsWith(":");
  return{...defaults,...value,model,reasoningEffort:value.reasoningEffort??defaults.reasoningEffort,serviceTier:value.serviceTier??defaults.serviceTier,workMode:value.workMode??defaults.workMode,automationLevel,permissionProfile:validPermission?value.permissionProfile:permissionForAutomation(value.provider,automationLevel)};
}

const activeStatuses = new Set(["pending","queued","starting","running","waiting","waiting-user","cancel-requested"]);
export function isBoardSessionActive(session:CollaborationBoardSession){return activeStatuses.has(session.status);}
export function cardNeedsAttention(card:CollaborationBoardCard){return card.sessions.some(item=>["failed","partial","waiting","waiting-user","stop-unconfirmed"].includes(item.status));}
export function cardSearchText(card:CollaborationBoardCard,workspaceName=""){return [card.title,card.description,workspaceName,card.targetBranch,...card.sessions.map(item=>item.title)].filter(Boolean).join(" ").toLocaleLowerCase();}

function parseRoles(value:unknown):CollaborationBoardRoles{
  if(value&&typeof value==="object")return value as CollaborationBoardRoles;
  if(typeof value==="string")try{return JSON.parse(value) as CollaborationBoardRoles;}catch{}
  return {};
}
function normalizeSession(value:any):CollaborationBoardSession{
  return {id:String(value?.id??value?.taskId??value?.collaborationSessionId??""),kind:value?.kind==="collaboration"||value?.collaborationSessionId?"collaboration":"task",title:String(value?.title??""),provider:value?.provider??null,role:value?.role??null,status:String(value?.status??"unknown"),executionHostId:value?.executionHostId??null,permissionProfile:value?.permissionProfile??null,createdAt:value?.createdAt??null,updatedAt:value?.updatedAt??null,result:value?.result??null,error:value?.error??null};
}
export function normalizeBoardCard(value:any):CollaborationBoardCard{
  const sessions=Array.isArray(value?.sessions)?value.sessions.map(normalizeSession):[];
  const stored=value?.automation&&typeof value.automation==="object"?value.automation:{};
  return {id:String(value?.id??value?.chainId??""),title:String(value?.title??""),description:String(value?.description??""),boardStatus:COLLABORATION_BOARD_STATUSES.includes(value?.boardStatus)?value.boardStatus:"queued",priority:COLLABORATION_BOARD_PRIORITIES.includes(value?.priority)?value.priority:"normal",boardVisible:value?.boardVisible!==false,workspaceId:value?.workspaceId??null,targetBranch:value?.targetBranch??null,roles:parseRoles(value?.roles??value?.rolesJson),automation:{mode:stored.mode==="auto"?"auto":"manual",state:["running","stopping","paused","blocked"].includes(stored.state)?stored.state:"idle",stage:["work","review","revision","approval"].includes(stored.stage)?stored.stage:null,stopAfter:["work","review"].includes(stored.stopAfter)?stored.stopAfter:null,round:Number(stored.round??0),pauseReason:stored.pauseReason??null},lastActivityAt:value?.lastActivityAt??value?.updatedAt??null,completedAt:value?.completedAt??null,archivedAt:value?.archivedAt??null,revision:Number(value?.revision??1),sessions,activeSessionCount:Number(value?.activeSessionCount??sessions.filter(isBoardSessionActive).length)};
}
const unwrapCard=(value:any)=>normalizeBoardCard(value?.card??value?.workChain??value);
export async function listBoardCards(api:BoardApi,includeArchived=false){const value=await api(`/api/collaboration-board/cards${includeArchived?"?archived=1":""}`);return (value?.cards??value?.items??[]).map(normalizeBoardCard) as CollaborationBoardCard[];}
export async function getBoardCard(api:BoardApi,id:string){return unwrapCard(await api(`/api/collaboration-board/cards/${encodeURIComponent(id)}`));}
export async function createBoardCard(api:BoardApi,draft:CollaborationBoardDraft){return unwrapCard(await api("/api/collaboration-board/cards",{method:"POST",headers:{"Idempotency-Key":crypto.randomUUID()},body:JSON.stringify(draft)}));}
export async function updateBoardCard(api:BoardApi,card:CollaborationBoardCard,patch:Partial<CollaborationBoardDraft>){return unwrapCard(await api(`/api/collaboration-board/cards/${encodeURIComponent(card.id)}`,{method:"PATCH",headers:{"Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({...patch,revision:card.revision})}));}
export async function archiveBoardCard(api:BoardApi,card:CollaborationBoardCard){return unwrapCard(await api(`/api/collaboration-board/cards/${encodeURIComponent(card.id)}/archive`,{method:"POST",headers:{"Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({revision:card.revision})}));}
export async function reopenBoardCard(api:BoardApi,card:CollaborationBoardCard){return unwrapCard(await api(`/api/collaboration-board/cards/${encodeURIComponent(card.id)}/reopen`,{method:"POST",headers:{"Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({revision:card.revision})}));}
export async function boardAction(api:BoardApi,card:CollaborationBoardCard,action:"start-work"|"request-review"|"start-revision"|"resume",body:Record<string,unknown>={}){return api(`/api/collaboration-board/cards/${encodeURIComponent(card.id)}/actions/${action}`,{method:"POST",headers:{"Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({...body,revision:card.revision})});}
export async function boardAutomationAction(api:BoardApi,card:CollaborationBoardCard,action:"start"|"pause"|"resume"|"decision",body:Record<string,unknown>={}){return api(`/api/collaboration-board/cards/${encodeURIComponent(card.id)}/automation/${action}`,{method:"POST",headers:{"Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({...body,revision:card.revision})});}
export async function attachBoardSession(api:BoardApi,card:CollaborationBoardCard,body:{taskId?:string;collaborationSessionId?:string}){return unwrapCard(await api(`/api/collaboration-board/cards/${encodeURIComponent(card.id)}/sessions/attach`,{method:"POST",headers:{"Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({...body,revision:card.revision})}));}
export async function listBoardEvents(api:BoardApi,id:string){const value=await api(`/api/collaboration-board/cards/${encodeURIComponent(id)}/events`);return (value?.events??value?.items??[]) as CollaborationBoardEvent[];}
