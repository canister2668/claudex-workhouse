import type { AgentEvent } from "./events";
import { compactAgentId, compactText, isParallelAgentEvent, processEventSummary, shortAgentName, type DisplayEvent } from "./conversation";
import { translate } from "./i18n";
import { normalizeTimestamp } from "./task-time";

// Single source of truth for parallel (child) agent state. The conversation
// roster and the task panel must name and rank the same children the same way,
// so both read this module instead of re-deriving ownership rules.
export type ParallelAgentStatus="running"|"waiting"|"completed"|"failed";
export type ParallelAgentCard={
  id:string;
  name:string;
  status:ParallelAgentStatus;
  prompt:string;
  activity:string;
  path:string;
  events:DisplayEvent[];
  startedAt:number|null;
  lastEventAt:number|null;
  activityCount:number;
  waitingReason:string;
};
export type ParallelAgentSummary=Omit<ParallelAgentCard,"events">;
export type ParallelAgentTally={total:number;running:number;waiting:number;failed:number;completed:number};

const cleanNativeString=(value:unknown)=>typeof value==="string"&&!['','undefined','null'].includes(value.trim())?value.trim():"";
const WAITING_EVENTS=new Set(["approval_required","user_input_required"]);
const RESOLVED_EVENTS=new Set(["approval_resolved","user_input_resolved"]);
const STATUS_RANK:Record<ParallelAgentStatus,number>={waiting:0,failed:1,running:2,completed:3};

export function parallelAgentCards(events: AgentEvent[],rootThreadId:string|null=null): ParallelAgentCard[] {
  const cards=new Map<string,ParallelAgentCard>();
  const blank=(id:string,activity=""):ParallelAgentCard=>({id,name:translate("conversation.agentName",{id:compactAgentId(id)}),status:"running",prompt:"",activity,path:"",events:[],startedAt:null,lastEventAt:null,activityCount:0,waitingReason:""});
  for(const event of events){
    if(!isParallelAgentEvent(event)){
      // Rebuild a child card from thread ownership even when a historical or
      // resumed stream no longer contains the original spawn lifecycle item.
      const eventThreadId=cleanNativeString(event.threadId);
      if(rootThreadId&&eventThreadId&&eventThreadId!==rootThreadId&&!cards.has(eventThreadId))cards.set(eventThreadId,blank(eventThreadId,compactText(event.content)));
      continue;
    }
    const metadata=event.metadata??{};
    const receivers=Array.isArray(metadata.receiverThreadIds)?metadata.receiverThreadIds.map(cleanNativeString).filter(Boolean):[];
    const states=metadata.agentsStates&&typeof metadata.agentsStates==="object"&&!Array.isArray(metadata.agentsStates)?metadata.agentsStates as Record<string,unknown>:{};
    const stateIds=Object.keys(states).map(cleanNativeString).filter(Boolean);
    // wait/send-input collaboration calls often have no receivers and are
    // controller activity, not new agents. Likewise an "interacted" activity
    // names its target (frequently /root), so it must not seed a new card.
    const directId=metadata.kind!=="interacted"?cleanNativeString(metadata.agentThreadId):"";
    const ids=receivers.length?receivers:stateIds.length?stateIds:directId?[directId]:[];
    for(const id of ids){
      const previous=cards.get(id);
      const state=states[id]&&typeof states[id]==="object"?states[id] as Record<string,unknown>:{};
      const rawStatus=String(state.status??event.status??"");
      const status:ParallelAgentStatus=["failed","errored","interrupted","notFound"].includes(rawStatus)||(!rawStatus&&event.type==="agent_failed")?"failed":["completed","shutdown"].includes(rawStatus)||(!rawStatus&&event.type==="agent_completed")?"completed":"running";
      const path=cleanNativeString(metadata.agentPath)||previous?.path||"";
      const explicitName=[state.name,state.nickname,state.role].map(cleanNativeString).find(Boolean);
      const pathName=path.split("/").filter(Boolean).at(-1);
      cards.set(id,{...(previous??blank(id)),id,status,path,
        name:explicitName||pathName||previous?.name||translate("conversation.agentName",{id:compactAgentId(id)}),
        prompt:cleanNativeString(metadata.prompt)||previous?.prompt||"",
        activity:cleanNativeString(state.message)||cleanNativeString(event.content)||previous?.activity||"",
        events:previous?.events??[]});
    }
  }
  // Native child-thread notifications carry the child ID as threadId, while
  // collaboration lifecycle rows use receiverThreadIds/agentThreadId. Actual
  // output has exactly one owner; only shared lifecycle rows may touch more
  // than one card.
  for(const event of events){
    const metadata=event.metadata??{};
    const ids=new Set<string>();
    const eventThreadId=cleanNativeString(event.threadId);
    const directId=cleanNativeString(metadata.agentThreadId);
    if(isParallelAgentEvent(event)){
      const receivers=Array.isArray(metadata.receiverThreadIds)?metadata.receiverThreadIds.map(cleanNativeString).filter(Boolean):[];
      for(const id of receivers)if(cards.has(id))ids.add(id);
      if(!ids.size){
        const owner=metadata.kind==="interacted"
          ?eventThreadId&&cards.has(eventThreadId)?eventThreadId:directId
          :directId||eventThreadId;
        if(owner&&cards.has(owner))ids.add(owner);
      }
    }else{
      const owner=eventThreadId&&cards.has(eventThreadId)?eventThreadId:directId&&cards.has(directId)?directId:"";
      if(owner)ids.add(owner);
    }
    for(const id of ids){
      const card=cards.get(id)!;card.events.push(event as DisplayEvent);
      const at=normalizeTimestamp(event.timestamp);
      if(at!==undefined){
        card.startedAt=card.startedAt===null?at:Math.min(card.startedAt,at);
        card.lastEventAt=card.lastEventAt===null?at:Math.max(card.lastEventAt,at);
      }
      if(!isParallelAgentEvent(event))card.activityCount+=1;
      // A child that stops for a human never reports itself as anything but
      // running, so the pause has to be read off its own approval events.
      if(WAITING_EVENTS.has(event.type))card.waitingReason=compactText(event.metadata?.command??event.content);
      else if(RESOLVED_EVENTS.has(event.type))card.waitingReason="";
      const states=metadata.agentsStates&&typeof metadata.agentsStates==="object"&&!Array.isArray(metadata.agentsStates)?metadata.agentsStates as Record<string,unknown>:{};
      const state=states[id]&&typeof states[id]==="object"?states[id] as Record<string,unknown>:{};
      const stateMessage=cleanNativeString(state.message);
      if(stateMessage)card.activity=stateMessage;
      else if(event.content&&event.type!=="unknown")card.activity=isParallelAgentEvent(event)?event.content:processEventSummary(event);
    }
  }
  // Names stay bound to spawn order; only the render layer reorders.
  return [...cards.values()].map((card,index)=>({...card,name:shortAgentName(index),status:card.status==="running"&&card.waitingReason?"waiting":card.status}));
}

export function parallelAgentSummaries(events:AgentEvent[],rootThreadId:string|null=null):ParallelAgentSummary[]{
  return parallelAgentCards(events,rootThreadId).map(({events:_events,...summary})=>summary);
}

export function parallelAgentTally(agents:ReadonlyArray<{status:ParallelAgentStatus}>):ParallelAgentTally{
  return{
    total:agents.length,
    running:agents.filter(agent=>agent.status==="running").length,
    waiting:agents.filter(agent=>agent.status==="waiting").length,
    failed:agents.filter(agent=>agent.status==="failed").length,
    completed:agents.filter(agent=>agent.status==="completed").length
  };
}

// Whatever needs a human comes first, then what broke, then live work.
export function sortAgentsByAttention<T extends {status:ParallelAgentStatus}>(agents:ReadonlyArray<T>):T[]{
  return agents.map((agent,index)=>({agent,index})).sort((left,right)=>STATUS_RANK[left.agent.status]-STATUS_RANK[right.agent.status]||left.index-right.index).map(entry=>entry.agent);
}

export const parallelAgentsActive=(agents:ReadonlyArray<{status:ParallelAgentStatus}>)=>agents.some(agent=>agent.status==="running"||agent.status==="waiting");
