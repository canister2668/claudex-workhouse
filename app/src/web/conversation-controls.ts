export type ConversationControlSession={
  id?:string|null;
  mode?:string|null;
  status?:string|null;
  outcome?:string|null;
  updatedAt?:string|null;
  metadata?:{
    conversationFlow?:string|null;
    automaticContinuation?:boolean|null;
    waitingForUser?:boolean|null;
  }|null;
};

export function automaticContinuationAvailable(session:ConversationControlSession|null|undefined){
  const capabilities=deriveCollaborationContinuation(session);
  return session?.metadata?.conversationFlow==="automatic"&&capabilities.reason==="turn-limit";
}

export function collaborationContinuation(session:ConversationControlSession|null|undefined,runs:any[]=[]){return deriveCollaborationContinuation(session,runs);}

export function focusConversationInput(form:{querySelector:(selector:string)=>{focus:()=>void}|null}|null){const textarea=form?.querySelector("textarea")??null;if(!textarea)return false;textarea.focus();return true;}

export function waitingConversationInputAvailable(session:ConversationControlSession|null|undefined,continuation:CollaborationContinuation=deriveCollaborationContinuation(session)){
  const flow=session?.metadata?.conversationFlow;
  const guided=flow==="guided"||(flow!=="automatic"&&session?.status==="waiting-user"&&session?.metadata?.waitingForUser===true);
  return guided&&continuation.canSubmitUserInput;
}

export function conversationInputAvailable(session:ConversationControlSession|null|undefined,continuation:CollaborationContinuation){
  const guidedInput=waitingConversationInputAvailable(session,continuation);
  const automaticInput=session?.metadata?.conversationFlow==="automatic"&&continuation.canSubmitUserInput;
  return guidedInput||automaticInput;
}

const DETAIL_REFRESH_EVENTS=new Set([
  "run/completed",
  "run/failed",
  "run/cancelled",
  "run/stop-unconfirmed",
    "collaboration/completed",
    "collaboration/partial",
    "participant/created",
    "participant/status"
]);

export function collaborationDetailRefreshDelay(eventType:string){
  if(!DETAIL_REFRESH_EVENTS.has(eventType))return null;
  return eventType==="collaboration/completed"||eventType==="collaboration/partial"?0:50;
}
import { deriveCollaborationContinuation, type CollaborationContinuation } from "../server/collaboration/continuation.js";
