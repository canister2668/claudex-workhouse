import type { AgentEvent } from "./events";
import { assertUniqueKeys } from "./identity-selectors";
import { taskEventKey } from "./collaboration-identity";

const TERMINAL_RUN=new Set(["completed","failed","timed-out","cancelled","stop-unconfirmed"]);

export type TaskStreamTarget={key:string;runId:string;taskId:string;generation:number;provider:string};

export function taskStreamKey(run:any){
  return `${String(run?.id??"")}::${String(run?.providerTaskId??"")}::${Math.max(0,Number(run?.generation)||0)}`;
}

function eventOrder(event:AgentEvent,index:number){
  const sequence=Number(event.sequence);
  if(Number.isSafeInteger(sequence)&&sequence>=0)return{sequence,time:0,index};
  const time=Date.parse(event.timestamp??"");
  return{sequence:Number.MAX_SAFE_INTEGER,time:Number.isFinite(time)?time:Number.MAX_SAFE_INTEGER,index};
}

function terminalMessage(event:AgentEvent){return event.type==="message_completed"?1:0;}

// Snapshot and SSE replay describe one task stream. Canonicalize them before
// presentation so an older delta can never follow its completed snapshot and
// an exact replay cannot create a second render row.
export function mergeCollaborationRunEvents(run:any,snapshot:readonly AgentEvent[]=[],live:readonly AgentEvent[]=[]):AgentEvent[]{
  const stream=taskStreamKey(run),rows=new Map<string,{event:AgentEvent;order:ReturnType<typeof eventOrder>}>();
  let fallback=0;
  for(const event of [...snapshot,...live]){
    const order=eventOrder(event,fallback++);
    const identity=taskEventKey(run,event);
    const current=rows.get(identity);
    if(!current||terminalMessage(event)>terminalMessage(current.event)||order.index>current.order.index)rows.set(identity,{event:current?{...current.event,...event,metadata:{...(current.event.metadata??{}),...(event.metadata??{})}}:event,order});
  }
  const merged=[...rows.values()].sort((left,right)=>left.order.sequence-right.order.sequence||left.order.time-right.order.time||left.order.index-right.order.index).map(row=>row.event);
  if(import.meta.env?.DEV)assertUniqueKeys(`collaboration stream ${stream}`,merged,event=>taskEventKey(run,event));
  return merged;
}

export function taskStreamCursor(events:readonly AgentEvent[]=[]){
  return events.reduce((maximum,event)=>Math.max(maximum,Number.isSafeInteger(Number(event.sequence))?Number(event.sequence):0),0);
}

export function upsertCollaborationRunEvent(run:any,current:readonly AgentEvent[],event:AgentEvent,limit=1500){
  const key=taskEventKey(run,event),index=current.findIndex(item=>taskEventKey(run,item)===key);
  if(index<0)return{events:[...current,event].slice(-limit),changed:true,inserted:true};
  const previous=current[index],next={...previous,...event,metadata:{...(previous.metadata??{}),...(event.metadata??{})}};
  if(JSON.stringify(previous)===JSON.stringify(next))return{events:[...current],changed:false,inserted:false};
  const events=[...current];events[index]=next;return{events:events.slice(-limit),changed:true,inserted:false};
}

export function activeTaskStreamTargets(detail:any,terminalKeys:ReadonlySet<string>=new Set(),openKeys:ReadonlySet<string>=new Set()):TaskStreamTarget[]{
  const providers=new Map((detail?.participants??[]).map((person:any)=>[person.id,person.provider]));
  const eligible=(detail?.runs??[]).filter((run:any)=>run?.providerTaskId&&!terminalKeys.has(taskStreamKey(run))),draining=eligible.filter((run:any)=>TERMINAL_RUN.has(String(run.status))&&openKeys.has(taskStreamKey(run))),active=eligible.filter((run:any)=>!TERMINAL_RUN.has(String(run.status))).sort((left:any,right:any)=>Number(left.sequence)-Number(right.sequence)||Number(left.generation)-Number(right.generation));
  const selected=detail?.session?.mode==="debate"?active.slice(-1):active;
  return [...draining,...selected].flatMap((run:any)=>{const provider=providers.get(run.participantId);return typeof provider==="string"?[{key:taskStreamKey(run),runId:String(run.id),taskId:String(run.providerTaskId),generation:Math.max(0,Number(run.generation)||0),provider}]:[];});
}
