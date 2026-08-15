// Provider sessions are classified by where they came from, never by title,
// prompt text or provider name. A collaboration wrapper alone says nothing:
// managed provider tasks and ordinary Assist targets are work the user handed
// to a model and must stay in the provider lists, while conversation turns,
// review/parallel participants and board executions belong to their own
// surfaces.
export type SessionClassification=
  |"regular-task"
  |"managed-task"
  |"assist-task"
  |"conversation-participant"
  |"collaboration-work-participant"
  |"board-participant"
  |"browser-task";

export type CollaborationProvenance={mode?:string|null;workChainId?:string|null;boardVisible?:boolean|null};
export type SessionClassificationContext={
  collaborations?:ReadonlyMap<string,CollaborationProvenance>;
  boardChainIds?:ReadonlySet<string>;
};

export type ClassifiableSession={
  id?:string;
  provider?:string|null;
  threadId?:string|null;
  providerSessionId?:string|null;
  workChainId?:string|null;
  metadata?:Record<string,unknown>|null;
};

export const INDEPENDENT_CLASSIFICATIONS:ReadonlySet<SessionClassification>=new Set(["regular-task","managed-task","assist-task"]);
export const CONVERSATION_LINKED_CLASSIFICATIONS:ReadonlySet<SessionClassification>=new Set(["conversation-participant","browser-task"]);

function text(value:unknown){return typeof value==="string"&&value?value:null;}

export function collaborationLink(value:ClassifiableSession|null|undefined){
  const collaborationSessionId=text(value?.metadata?.collaborationSessionId),participantId=text(value?.metadata?.collaborationParticipantId);
  return collaborationSessionId&&participantId?{collaborationSessionId,participantId}:null;
}

// The participant id is what marks a row as produced inside a collaboration.
// The session id is only the key used to resolve that collaboration's mode, and
// an older row can carry the participant without it.
function participantLink(value:ClassifiableSession){
  const participantId=text(value.metadata?.collaborationParticipantId);
  return participantId?{collaborationSessionId:text(value.metadata?.collaborationSessionId),participantId}:null;
}

function extensionSession(value:ClassifiableSession){
  let linked=false;
  return linked;
}

// The chain id is persisted on the provider task itself; the collaboration
// record is only consulted for rows created before that column was written.
function chainOf(value:ClassifiableSession,provenance:CollaborationProvenance|undefined){
  return text(value.workChainId)??text(provenance?.workChainId);
}

export function classifyProviderSession(value:ClassifiableSession,context:SessionClassificationContext={}):SessionClassification{
  if(extensionSession(value))return"browser-task";
  if(text(value.metadata?.managedProviderSourceTaskId))return"managed-task";
  const link=participantLink(value);
  if(!link)return"regular-task";
  const provenance=link.collaborationSessionId?context.collaborations?.get(link.collaborationSessionId):undefined;
  const mode=text(value.metadata?.collaborationMode)??text(provenance?.mode);
  // Conversation residue stays with the conversation even when it inherited a
  // work chain from the session it was started from.
  if(mode==="debate"||mode==="conversation")return"conversation-participant";
  const chain=chainOf(value,provenance);
  if(chain)return provenance?.boardVisible===true||context.boardChainIds?.has(chain)?"board-participant":"collaboration-work-participant";
  if(mode==="assist")return"assist-task";
  if(mode==="review"||mode==="parallel")return"collaboration-work-participant";
  // An unknown collaboration is almost always an archived conversation whose
  // session row is gone. Keep it reachable from the linked-session surface
  // instead of promoting it into the provider tabs.
  return"conversation-participant";
}

const INHERITED:SessionClassification[]=["browser-task","conversation-participant","board-participant","collaboration-work-participant"];

// A native provider row carries no Workhouse metadata. It inherits the
// classification of the Workhouse task that owns the same provider thread so a
// conversation, board or browser session cannot reappear through its mirror.
export function classifySessionWithThread(value:ClassifiableSession,linkedTasks:readonly ClassifiableSession[]=[],context:SessionClassificationContext={}):SessionClassification{
  const own=classifyProviderSession(value,context);
  if(own!=="regular-task")return own;
  if(!value.threadId)return own;
  const siblings=linkedTasks.filter(task=>task.threadId===value.threadId&&(!value.provider||!task.provider||task.provider===value.provider)).map(task=>classifyProviderSession(task,context));
  return INHERITED.find(candidate=>siblings.includes(candidate))??own;
}
