import type { AgentEvent } from "./events";

const value=(input:unknown)=>String(input??"");
const safeSequence=(input:unknown)=>{
  const sequence=Number(input);
  return Number.isSafeInteger(sequence)&&sequence>=0?sequence:null;
};

export function collaborationRunKey(sessionId:unknown,run:any){
  return `run:${value(sessionId)}:${value(run?.id)}`;
}

export function collaborationMessageKey(sessionId:unknown,message:any){
  const id=message?.sourceMessageId??message?.clientId??message?.clientMutationId??message?.id??message?.providerMessageId;
  return `message:${value(sessionId)}:${value(id)}`;
}

export function collaborationParticipantKey(sessionId:unknown,participant:any){
  return `participant:${value(sessionId)}:${value(participant?.id)}`;
}

export function collaborationAvatarKey(sessionId:unknown,state:any){
  return `avatar-state:${value(sessionId)}:${value(state?.participantId)}`;
}

export function taskEventKey(run:any,event:AgentEvent){
  const runId=value(run?.id),taskId=value(run?.providerTaskId),generation=Math.max(0,Number(run?.generation)||0),sequence=safeSequence(event?.sequence);
  if(sequence!==null)return `event:${runId}:${taskId}:${generation}:sequence:${sequence}`;
  if(event?.eventId)return `event:${runId}:${taskId}:${generation}:id:${value(event.eventId)}`;
  return `event:${runId}:${taskId}:${generation}:fallback:${value(event?.type)}:${value(event?.itemId)}:${value(event?.threadId)}:${value(event?.turnId)}:${value(event?.timestamp)}:${value(event?.content)}`;
}

export function collaborationEventKey(event:any){
  const sessionId=value(event?.collaborationSessionId),sequence=safeSequence(event?.sequence);
  if(sequence!==null)return `collaboration-event:${sessionId}:sequence:${sequence}`;
  if(event?.eventId)return `collaboration-event:${sessionId}:id:${value(event.eventId)}`;
  return `collaboration-event:${sessionId}:${value(event?.type)}:${value(event?.runId)}:${value(event?.participantId)}:${value(event?.generation)}:${value(event?.timestamp)}`;
}

export function processRowKey(sessionId:unknown,run:any,participant:any,row:any){
  return `process:${value(sessionId)}:${value(run?.id)}:${value(participant?.id)}:${value(row?.id)}`;
}

export function inlineSceneKey(sessionId:unknown,run:any,participant:any,scene:any){
  return `scene:${value(sessionId)}:${value(run?.id)}:${value(participant?.id)}:${value(scene?.id)}`;
}

export type DuplicateDiagnostic={
  key:string;itemType:string;sessionId:string;runId:string|null;participantId:string|null;itemId:string|null;count:number;
};

export function duplicateDiagnostics<T>(input:{
  rows:readonly T[];keyFor:(row:T)=>string;itemType:string;sessionId:unknown;
  runIdFor?:(row:T)=>unknown;participantIdFor?:(row:T)=>unknown;itemIdFor?:(row:T)=>unknown;
}):DuplicateDiagnostic[]{
  const grouped=new Map<string,T[]>();
  for(const row of input.rows){const key=input.keyFor(row),rows=grouped.get(key)??[];rows.push(row);grouped.set(key,rows);}
  return [...grouped].filter(([,rows])=>rows.length>1).map(([key,rows])=>{
    const row=rows.at(-1)!;
    return{key,itemType:input.itemType,sessionId:value(input.sessionId),runId:input.runIdFor?value(input.runIdFor(row)):null,participantId:input.participantIdFor?value(input.participantIdFor(row)):null,itemId:input.itemIdFor?value(input.itemIdFor(row)):null,count:rows.length};
  });
}

export function upsertStableRows<T>(rows:readonly T[],keyFor:(row:T)=>string):T[]{
  const merged=new Map<string,T>();
  for(const row of rows){const key=keyFor(row),previous=merged.get(key);merged.set(key,previous&&typeof previous==="object"&&typeof row==="object"?{...previous,...row}:row);}
  return [...merged.values()];
}
