import type { AgentEvent } from "./events";
import type { TaskPhase } from "./liveness";
import { normalizeTimestamp } from "./task-time";

// A long turn can spend many minutes inside model<->tool round trips before the
// first assistant sentence exists. Nothing is stuck during that window: the
// provider-common lifecycle stream (task/turn/tool/command) is already flowing.
// This module derives a compact progress heartbeat from that shared stream so
// no provider needs its own indicator, and so the same values can be produced
// from a persisted snapshot, from live SSE, or from the terminal handoff.
export const PROGRESS_QUIET_MS=15_000;

const ACTIVE_STATUSES=new Set(["pending","queued","running","waiting"]);

export type TaskProgressStage="starting"|"queued"|"thinking"|"working"|"command"|"file"|"tool"|"response"|"approval"|"decision";
export type TaskProgressCounts={commands:number;files:number;tools:number};
export type TaskProgressLabel={key:string;params:Record<string,number>};
export type TaskProgressHeartbeat={
  visible:boolean;
  stage:TaskProgressStage;
  stageKey:string;
  elapsedMs:number;
  elapsedKnown:boolean;
  elapsedLabel:TaskProgressLabel;
  quiet:boolean;
  counts:TaskProgressCounts;
  showCounts:boolean;
};

// The stage names a phase of work, never a percentage: no provider reports how
// much of a turn remains, so any progress ratio would be invented.
export function progressStage(input:{status:string;phase:TaskPhase;activity?:string;eventCount:number}):TaskProgressStage{
  if(input.phase==="waiting-approval")return"approval";
  if(input.phase==="waiting-user")return"decision";
  if(input.status==="pending"||input.status==="queued")return"queued";
  if(!input.eventCount)return"starting";
  switch(input.activity){
    case"command":return"command";
    case"file":return"file";
    case"tool":return"tool";
    case"response":return"response";
    case"approval":return"approval";
    case"decision":return"decision";
    default:break;
  }
  // "internal" activity is a provider hook with no user-facing meaning. Report
  // the phase instead of leaking the native event name into the interface.
  return input.phase==="acting"?"working":"thinking";
}

export function progressElapsedLabel(elapsedMs:number):TaskProgressLabel{
  const total=Math.max(0,Math.floor(elapsedMs/1_000));
  if(total<60)return{key:"liveness.durationSeconds",params:{seconds:total}};
  if(total<3_600)return{key:"liveness.durationMinutes",params:{minutes:Math.floor(total/60),seconds:total%60}};
  return{key:"liveness.durationHours",params:{hours:Math.floor(total/3_600),minutes:Math.floor(total%3_600/60)}};
}

// Counts reuse the already translated conversation labels and drop every empty
// category, so a turn that has only reasoned so far shows no count noise.
export function progressCountLabels(counts:TaskProgressCounts):TaskProgressLabel[]{
  const labels:Array<TaskProgressLabel|null>=[
    counts.commands>0?{key:"conversation.commandCount",params:{count:counts.commands}}:null,
    counts.files>0?{key:"conversation.fileCount",params:{count:counts.files}}:null,
    counts.tools>0?{key:"conversation.toolCount",params:{count:counts.tools}}:null
  ];
  return labels.filter((label):label is TaskProgressLabel=>label!==null);
}

export function taskProgressHeartbeat(input:{
  status:string;
  phase:TaskPhase;
  activity?:string;
  startedAt?:unknown;
  now?:number;
  lastEventAt?:number;
  eventCount?:number;
  commandCount?:number;
  fileCount?:number;
  toolCount?:number;
}):TaskProgressHeartbeat{
  const now=input.now??Date.now();
  const startedAt=normalizeTimestamp(input.startedAt,now);
  const eventCount=Math.max(0,input.eventCount??0);
  const counts:TaskProgressCounts={
    commands:Math.max(0,input.commandCount??0),
    files:Math.max(0,input.fileCount??0),
    tools:Math.max(0,input.toolCount??0)
  };
  const stage=progressStage({status:input.status,phase:input.phase,activity:input.activity,eventCount});
  const elapsedMs=startedAt===undefined?0:Math.max(0,now-startedAt);
  // Before the first event the start time is the only reference we have, so a
  // freshly launched task is never reported as quiet.
  const reference=input.lastEventAt&&input.lastEventAt>0?input.lastEventAt:startedAt;
  return{
    visible:ACTIVE_STATUSES.has(input.status),
    stage,
    stageKey:`progress.stage.${stage}`,
    elapsedMs,
    elapsedKnown:startedAt!==undefined,
    elapsedLabel:progressElapsedLabel(elapsedMs),
    quiet:reference===undefined?false:now-reference>=PROGRESS_QUIET_MS,
    counts,
    showCounts:counts.commands+counts.files+counts.tools>0
  };
}

// The elapsed time a reader cares about is "how long has this answer been
// coming", not the age of a session that may already hold many turns. Every
// provider publishes the request as a user message, so the newest one marks the
// active turn; the task's own timestamp remains the fallback.
export function activeTurnStartedAt(events:AgentEvent[],fallback?:unknown,now=Date.now()){
  for(let index=events.length-1;index>=0;index--){
    const event=events[index];
    if(!event||event.type!=="message"||event.metadata?.role!=="user")continue;
    const at=normalizeTimestamp(event.timestamp,now);
    if(at!==undefined)return at;
  }
  return normalizeTimestamp(fallback,now);
}
