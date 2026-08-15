import { writable, type Writable } from "svelte/store";
import type { AgentEvent } from "./events";
import { subscribeTaskStream, type TaskStreamProvider, type TaskStreamResync, type TaskStreamStatus } from "./task-stream";
import { classifyTaskEvent, mapActivityEvent, type TaskActivity } from "./task-activity-map";
import { translate } from "./i18n";
import { isParallelAgentEvent } from "./conversation";
import { parallelAgentSummaries, parallelAgentTally, type ParallelAgentSummary, type ParallelAgentTally } from "./parallel-agents";
import { normalizeTimestamp } from "./task-time";

export type TaskPhase="reasoning"|"acting"|"waiting-approval"|"waiting-user"|"queued"|"idle"|"completed"|"failed"|"stopped";
export type TaskFreshness="fresh"|"quiet"|"stale"|"dead";
export type TransportState="connected"|"degraded"|"lost";
export type TaskPlanStep={id:string;title:string;status:"pending"|"active"|"completed"|"skipped"};
export type TaskPlanSummary={title?:string;currentStep?:number;totalSteps?:number;steps:TaskPlanStep[];updatedAt?:number};
export type TaskDecisionSummary={id:string;title:string;description?:string;questions:Array<{id:string;header:string;question:string;options:Array<{label:string;description?:string}>}>;createdAt:number;resolvedAt?:number;selectedOption?:string};
export type TaskLiveness={
  taskId:string;
  phase:TaskPhase;
  freshness:TaskFreshness;
  transport:TransportState;
  streamStatus:TaskStreamStatus;
  startedAt?:number;
  lastEventAt:number;
  lastMeaningfulEventAt:number;
  lastHeartbeatAt?:number;
  elapsedMs:number;
  eventAgeMs?:number;
  heartbeatAgeMs?:number;
  lastContent:string;
  recentActivity?:TaskActivity;
  buckets:number[];
  commandCount:number;
  fileCount:number;
  toolCount:number;
  internalCount:number;
  eventCount:number;
  contextPercent?:number;
  plan?:TaskPlanSummary;
  pendingDecision?:TaskDecisionSummary;
  resolvedDecision?:TaskDecisionSummary;
  agents:ParallelAgentSummary[];
  agentTally:ParallelAgentTally;
};

const EMPTY_TALLY:ParallelAgentTally={total:0,running:0,waiting:0,failed:0,completed:0};
// Keep only what the child roster can be rebuilt from. A long parent turn would
// otherwise retain every event just to recompute a handful of rows.
const AGENT_EVENT_BUFFER=600;

export const LIVENESS_BUCKET_MS=5_000;
export const LIVENESS_BUCKET_COUNT=20;
export const LIVENESS_QUIET_MS=5_000;
export const LIVENESS_STALE_MS=30_000;
export const LIVENESS_DEAD_MS=60_000;
export const ACTIVITY_LEASE_MS=90_000;
export const RECENT_ACTIVITY_HOLD_MS=10_000;

const phaseFromStatus=(status?:string):TaskPhase=>status==="pending"||status==="queued"?"queued":status==="completed"?"completed":status==="failed"?"failed":status==="stopped"?"stopped":"idle";
export const initialTaskLiveness=(lastEventAt=0,taskId="",status?:string,startedAt?:number):TaskLiveness=>({
  taskId,phase:phaseFromStatus(status),freshness:"fresh",lastEventAt,lastMeaningfulEventAt:lastEventAt,lastContent:"",transport:"degraded",streamStatus:"connecting",startedAt,
  elapsedMs:startedAt?Math.max(0,Date.now()-startedAt):0,eventAgeMs:lastEventAt?Math.max(0,Date.now()-lastEventAt):undefined,
  buckets:Array(LIVENESS_BUCKET_COUNT).fill(0),
  commandCount:0,fileCount:0,toolCount:0,internalCount:0,eventCount:0,
  agents:[],agentTally:EMPTY_TALLY
});

export function phaseForEvent(event:AgentEvent,previous:TaskPhase,provider:TaskStreamProvider=event.provider??"codex"):TaskPhase{
  if(event.type==="approval_required")return"waiting-approval";
  if(event.type==="user_input_required")return"waiting-user";
  if(event.type==="approval_resolved"||event.type==="user_input_resolved")return"reasoning";
  if(event.type==="task_started")return"queued";
  if(event.type==="task_completed")return"completed";
  if(event.type==="task_failed")return"failed";
  if(event.type==="task_stopped")return"stopped";
  if(event.type==="command_started"||event.type==="command_completed"||event.type==="tool_started"||event.type==="tool_completed"||event.type==="file_change_started"||event.type==="file_change_completed"||event.type==="mcp_tool_call"||event.type==="mcp_tool_result")return"acting";
  if(event.type==="turn_started"){
    if(provider==="claude"&&event.metadata?.nativeType==="system"&&event.metadata?.subtype==="init")return previous==="idle"?"queued":previous;
    return event.metadata?.role==="user"?previous:"reasoning";
  }
  if(event.type==="message_delta"||event.type==="message_completed")return event.metadata?.role==="user"?previous:"reasoning";
  return previous;
}

export const livenessFreshness=(lastEventAt:number,now=Date.now()):TaskFreshness=>{
  const age=Math.max(0,now-lastEventAt);
  return age>=LIVENESS_DEAD_MS?"dead":age>=LIVENESS_STALE_MS?"stale":age>=LIVENESS_QUIET_MS?"quiet":"fresh";
};

export const effectiveTransport=(status:TaskStreamStatus,lastEventAt:number,now=Date.now()):TransportState=>status==="live"?"connected":Math.max(0,now-lastEventAt)>=LIVENESS_DEAD_MS?"lost":"degraded";

export function rotateBuckets(buckets:number[],lastEventAt:number,eventAt:number){
  const next=(buckets.length?buckets:Array(LIVENESS_BUCKET_COUNT).fill(0)).slice(-LIVENESS_BUCKET_COUNT);
  if(!lastEventAt||eventAt<=lastEventAt){next[next.length-1]=(next[next.length-1]??0)+1;return next;}
  const steps=Math.min(LIVENESS_BUCKET_COUNT,Math.floor((eventAt-lastEventAt)/LIVENESS_BUCKET_MS));
  for(let index=0;index<steps;index++)next.push(0);
  const trimmed=next.slice(-LIVENESS_BUCKET_COUNT);
  trimmed[trimmed.length-1]=(trimmed[trimmed.length-1]??0)+1;
  return trimmed;
}

type RegistryEntry={
  provider:TaskStreamProvider;
  store:Writable<TaskLiveness>;
  value:TaskLiveness;
  seen:Set<string>;
  commands:Set<string>;
  files:Set<string>;
  tools:Set<string>;
  leases:Map<string,{kind:"command"|"file"|"tool";activity:TaskActivity;startedAt:number;expiresAt:number}>;
  lastActivity?:{activity:TaskActivity;at:number};
  agentEvents:AgentEvent[];
  rootThreadId:string|null;
  subscribers:number;
};
const registry=new Map<string,RegistryEntry>();
const registryKey=(provider:TaskStreamProvider,taskId:string)=>`${provider}:${taskId}`;
const eventKey=(event:AgentEvent)=>String(event.eventId??`${event.sequence??""}:${event.itemId??""}:${event.type}:${event.timestamp??""}:${event.content.slice(0,48)}`);
const itemKey=(event:AgentEvent)=>String(event.itemId??event.metadata?.itemId??event.eventId??event.sequence??eventKey(event));
const eventAt=(event:AgentEvent,now:number)=>normalizeTimestamp(event.timestamp,now)??now;
const explicitItemKey=(event:AgentEvent)=>event.itemId??(typeof event.metadata?.itemId==="string"?event.metadata.itemId:null);
const planFrom=(event:AgentEvent):TaskPlanSummary|undefined=>{
  const raw=(event.metadata?.plan??event.metadata?.steps) as any;
  const source=Array.isArray(raw)?raw:Array.isArray(raw?.steps)?raw.steps:null;
  if(!source)return undefined;
  const steps:TaskPlanStep[]=source.map((item:any,index:number):TaskPlanStep=>({
    id:String(item.id??index),
    title:String(item.title??item.step??item.text??""),
    status:["pending","active","completed","skipped"].includes(item.status)
      ? item.status as TaskPlanStep["status"]
      : item.status==="in_progress"?"active":"pending"
  })).filter((item:TaskPlanStep)=>Boolean(item.title));
  if(!steps.length)return undefined;
  const active=steps.findIndex(item=>item.status==="active");
  return{title:typeof raw?.title==="string"?raw.title:undefined,currentStep:active>=0?active+1:steps.filter(item=>item.status==="completed").length,totalSteps:steps.length,steps,updatedAt:eventAt(event,Date.now())};
};
const decisionFrom=(event:AgentEvent):TaskDecisionSummary|undefined=>{
  if(event.type!=="user_input_required")return undefined;
  const questions=Array.isArray(event.metadata?.questions)?(event.metadata?.questions as any[]):[];
  return{id:String(event.metadata?.requestId??event.itemId??event.eventId??"decision"),title:String(questions[0]?.question??event.content),description:String(event.content??""),questions:questions.map((item,index)=>({id:String(item.id??index),header:String(item.header??""),question:String(item.question??""),options:Array.isArray(item.options)?item.options.map((option:any)=>({label:String(option.label??option.value??""),description:typeof option.description==="string"?option.description:undefined})):[]})),createdAt:eventAt(event,Date.now())};
};

function entryFor(provider:TaskStreamProvider,taskId:string,lastEventAt=0,status?:string,startedAt?:number,rootThreadId:string|null=null){
  const key=registryKey(provider,taskId),existing=registry.get(key);
  if(existing){if(rootThreadId&&!existing.rootThreadId)existing.rootThreadId=rootThreadId;return existing;}
  const value=initialTaskLiveness(lastEventAt,taskId,status,startedAt),entry={provider,store:writable(value),value,seen:new Set<string>(),commands:new Set<string>(),files:new Set<string>(),tools:new Set<string>(),leases:new Map(),agentEvents:[] as AgentEvent[],rootThreadId,subscribers:0};
  registry.set(key,entry);
  return entry;
}

// A child event either carries a spawn lifecycle type or a thread that is not
// the parent's. Everything else is parent activity and never touches the roster.
function childEvent(entry:RegistryEntry,event:AgentEvent){
  if(isParallelAgentEvent(event))return true;
  const thread=typeof event.threadId==="string"?event.threadId.trim():"";
  if(thread&&entry.rootThreadId&&thread!==entry.rootThreadId)return true;
  const direct=event.metadata?.agentThreadId;
  return typeof direct==="string"&&Boolean(direct.trim());
}

function trackAgents(entry:RegistryEntry,event:AgentEvent){
  if(!childEvent(entry,event))return null;
  entry.agentEvents.push(event);
  if(entry.agentEvents.length>AGENT_EVENT_BUFFER)entry.agentEvents=entry.agentEvents.slice(-AGENT_EVENT_BUFFER);
  const agents=parallelAgentSummaries(entry.agentEvents,entry.rootThreadId);
  return{agents,agentTally:parallelAgentTally(agents)};
}

const leaseKind=(type:AgentEvent["type"]):"command"|"file"|"tool"|null=>type==="command_started"?"command":type==="file_change_started"?"file":type==="tool_started"||type==="mcp_tool_call"?"tool":null;
const completionKind=(type:AgentEvent["type"]):"command"|"file"|"tool"|null=>type==="command_completed"?"command":type==="file_change_completed"?"file":type==="tool_completed"||type==="mcp_tool_result"?"tool":null;
const activityPriority=(activity:TaskActivity)=>activity.type==="approval"||activity.type==="decision"?5:activity.type==="command"||activity.type==="file"||activity.type==="tool"?4:activity.type==="response"?3:2;
function purgeLeases(entry:RegistryEntry,at:number){for(const[key,lease]of entry.leases)if(lease.expiresAt<=at)entry.leases.delete(key);}
function selectedActivity(entry:RegistryEntry,at:number){
  purgeLeases(entry,at);
  if(["completed","failed","stopped","waiting-approval","waiting-user"].includes(entry.value.phase))return entry.lastActivity?.activity;
  const active=[...entry.leases.values()].sort((a,b)=>activityPriority(b.activity)-activityPriority(a.activity)||b.startedAt-a.startedAt)[0]?.activity;
  if(active)return active;
  if(entry.lastActivity&&at-entry.lastActivity.at<=RECENT_ACTIVITY_HOLD_MS)return entry.lastActivity.activity;
  if(entry.value.phase!=="idle")return{type:"reasoning",labelKey:"liveness.activity.reasoning",detail:translate("progress.stage.thinking"),raw:"liveness"};
  return entry.lastActivity?.activity;
}

function applyEvent(entry:RegistryEntry,event:AgentEvent,now=Date.now()){
  const identity=eventKey(event);
  if(entry.seen.has(identity))return;
  entry.seen.add(identity);
  if(entry.seen.size>2_000){
    const oldest=[...entry.seen].slice(0,entry.seen.size-1_000);
    for(const key of oldest)entry.seen.delete(key);
  }
  const at=eventAt(event,now),type=event.type,key=itemKey(event),classification=classifyTaskEvent(entry.provider,event);
  const command=type==="command_started"||type==="command_completed"||type==="command",file=type==="file_change_started"||type==="file_change_completed"||type==="file_read"||type==="file_write",tool=type==="tool_started"||type==="tool_completed"||type==="mcp_tool_call"||type==="mcp_tool_result";
  if(command)entry.commands.add(key);else if(file)entry.files.add(key);else if(tool)entry.tools.add(key);
  const mapped=mapActivityEvent(entry.provider,event),plan=classification==="activity"?planFrom(event):undefined,decision=classification==="activity"?decisionFrom(event):undefined;
  const fanout=trackAgents(entry,event);
  purgeLeases(entry,at);
  const leaseId=explicitItemKey(event),ending=completionKind(type);
  const completedActivity=leaseId&&ending?entry.leases.get(String(leaseId))?.activity:undefined;
  if(leaseId&&ending)entry.leases.delete(String(leaseId));
  const starting=leaseKind(type);
  if(leaseId&&starting)entry.leases.set(String(leaseId),{kind:starting,activity:mapped,startedAt:at,expiresAt:at+ACTIVITY_LEASE_MS});
  if(type==="task_completed"||type==="task_failed"||type==="task_stopped")entry.leases.clear();
  if(classification==="activity")entry.lastActivity={activity:completedActivity??mapped,at};
  const meaningfulAt=classification==="activity"?Math.max(entry.value.lastMeaningfulEventAt,at):entry.value.lastMeaningfulEventAt;
  const phase=classification==="activity"?phaseForEvent(event,entry.value.phase,entry.provider):entry.value.phase;
  entry.value={...entry.value,phase};
  const activity=selectedActivity(entry,at);
  const next:TaskLiveness={
    ...entry.value,
    ...(fanout??{}),
    phase,
    freshness:meaningfulAt?livenessFreshness(meaningfulAt,now):"quiet",
    transport:effectiveTransport(entry.value.streamStatus,Math.max(entry.value.lastEventAt,at),now),
    lastEventAt:Math.max(entry.value.lastEventAt,at),
    lastMeaningfulEventAt:meaningfulAt,
    elapsedMs:entry.value.startedAt?Math.max(0,now-entry.value.startedAt):entry.value.elapsedMs,
    eventAgeMs:meaningfulAt?Math.max(0,now-meaningfulAt):undefined,
    lastContent:activity?.detail||entry.value.lastContent,
    recentActivity:activity,
    buckets:classification==="activity"?rotateBuckets(entry.value.buckets,entry.value.lastMeaningfulEventAt,at):entry.value.buckets,
    commandCount:entry.commands.size,fileCount:entry.files.size,toolCount:entry.tools.size,
    internalCount:entry.value.internalCount+(classification==="activity"&&mapped.type==="internal"?1:0),
    eventCount:entry.value.eventCount+1,
    plan:plan??entry.value.plan,
    pendingDecision:event.type==="user_input_resolved"?undefined:decision??entry.value.pendingDecision,
    resolvedDecision:event.type==="user_input_resolved"&&entry.value.pendingDecision
      ?{...entry.value.pendingDecision,resolvedAt:at,selectedOption:String(event.content??event.metadata?.selectedOption??"").trim()||undefined}
      :entry.value.resolvedDecision
  };
  entry.value=next;entry.store.set(next);
}

export function deriveTaskLiveness(
  events:AgentEvent[],
  options:{provider:TaskStreamProvider;taskId?:string;status?:string;startedAt?:unknown;streamStatus?:TaskStreamStatus;now?:number;rootThreadId?:string|null}
):TaskLiveness{
  const now=options.now??Date.now();
  const value=initialTaskLiveness(0,options.taskId??"",options.status,normalizeTimestamp(options.startedAt,now));
  const entry:RegistryEntry={
    provider:options.provider,
    store:writable(value),
    value,
    seen:new Set<string>(),
    commands:new Set<string>(),
    files:new Set<string>(),
    tools:new Set<string>(),
    leases:new Map(),
    agentEvents:[],
    rootThreadId:options.rootThreadId??null,
    subscribers:0
  };
  entry.value={...entry.value,streamStatus:options.streamStatus??"live"};
  for(const event of events)applyEvent(entry,event,now);
  const last=entry.value.lastMeaningfulEventAt,activity=selectedActivity(entry,now);
  entry.value={
    ...entry.value,
    freshness:last?livenessFreshness(last,now):"quiet",
    transport:effectiveTransport(entry.value.streamStatus,entry.value.lastEventAt,now),
    elapsedMs:entry.value.startedAt?Math.max(0,now-entry.value.startedAt):0,
    eventAgeMs:last?Math.max(0,now-last):undefined,
    recentActivity:activity,
    lastContent:activity?.detail||entry.value.lastContent
  };
  return entry.value;
}

export function subscribeTaskLiveness(options:{
  provider:TaskStreamProvider;taskId:string;after?:number;lastEventAt?:number;
  taskStatus?:string;startedAt?:number;rootThreadId?:string|null;
  onChange:(value:TaskLiveness)=>void;onEvent?:(event:AgentEvent)=>void;
  onResync?:(value:TaskStreamResync)=>void;onStatus?:(status:TaskStreamStatus)=>void;
}){
  const entry=entryFor(options.provider,options.taskId,options.lastEventAt??0,options.taskStatus,options.startedAt,options.rootThreadId??null);
  entry.subscribers++;
  const stopStore=entry.store.subscribe(options.onChange);
  const stopStream=subscribeTaskStream({
    provider:options.provider,taskId:options.taskId,after:options.after,replay:options.after!==undefined,
    onStatus:streamStatus=>{entry.value={...entry.value,streamStatus,transport:effectiveTransport(streamStatus,entry.value.lastEventAt)};entry.store.set(entry.value);options.onStatus?.(streamStatus);},
    onEvent:event=>{applyEvent(entry,event);options.onEvent?.(event);},
    onResync:options.onResync
  });
  let active=true;
  return()=>{
    if(!active)return;
    active=false;
    stopStore();stopStream();
    entry.subscribers=Math.max(0,entry.subscribers-1);
    if(!entry.subscribers)registry.delete(registryKey(options.provider,options.taskId));
  };
}

export function resetTaskLivenessForTests(){registry.clear();}
export function taskLivenessRegistrySizeForTests(){return registry.size;}
