import type { AgentEvent } from "./events";

export const RUNNING_HISTORY_OUTPUT_LIMIT=3;

/**
 * The earlier-history loader sits at the transcript top. While a running session is still
 * collapsed to its current task, the running-session banner is the only top control; once the
 * user expands that history — or the session is no longer running — the loader is exposed
 * directly, with no extra disclosure step.
 */
export function earlierHistoryActionVisible(state:{truncatedBefore:boolean;runningHistoryVisible:boolean;runningHistoryExpanded:boolean}):boolean{
  return state.truncatedBefore&&(!state.runningHistoryVisible||state.runningHistoryExpanded);
}

const isUser=(event:AgentEvent)=>event.type==="message"&&event.metadata?.role==="user";
const hasAssistantOutput=(events:AgentEvent[])=>events.some(event=>event.type==="message_completed"||(event.type==="message"&&event.metadata?.role==="agent"));

export function recentRunningConversationEvents(events:AgentEvent[],includeHistory:boolean,limit=RUNNING_HISTORY_OUTPUT_LIMIT):AgentEvent[]{
  const turns:AgentEvent[][]=[];
  let current:AgentEvent[]=[];
  for(const event of events){
    if(isUser(event)&&current.length){turns.push(current);current=[];}
    current.push(event);
  }
  if(current.length)turns.push(current);
  if(turns.length<2)return events;
  const active=turns.at(-1)!;
  if(!includeHistory)return active;
  const previous=turns.slice(0,-1).filter(hasAssistantOutput).slice(-Math.max(0,limit));
  return [...previous.flat(),...active];
}
