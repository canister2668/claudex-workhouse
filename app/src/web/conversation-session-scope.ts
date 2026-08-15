import {CONVERSATION_LINKED_CLASSIFICATIONS,INDEPENDENT_CLASSIFICATIONS,classifySessionWithThread,collaborationLink,type ClassifiableSession,type SessionClassificationContext} from "./session-classification";

export type ConversationSessionScope="regular"|"conversation-linked";
type ConversationScopeOptions=SessionClassificationContext;

export const conversationSessionLink=collaborationLink;

export function sessionMatchesConversationScope(value:ClassifiableSession,scope:ConversationSessionScope,linkedTasks:ClassifiableSession[]=[],options:ConversationScopeOptions={}){
  const classification=classifySessionWithThread(value,linkedTasks,options);
  return scope==="conversation-linked"?CONVERSATION_LINKED_CLASSIFICATIONS.has(classification):INDEPENDENT_CLASSIFICATIONS.has(classification);
}
