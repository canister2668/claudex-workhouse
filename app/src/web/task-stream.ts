import type { AgentEvent } from "./events";

export type TaskStreamProvider="codex"|"claude"|"deepseek"|"ollama"|"antigravity"|"grok";
export type TaskStreamStatus="connecting"|"live"|"delayed";
export type TaskStreamResync={reason?:string;latestSequence?:number};
export type TaskStreamSubscription={
  provider:TaskStreamProvider;
  taskId:string;
  after?:number;
  replay?:boolean;
  onEvent:(event:AgentEvent)=>void;
  onResync?:(value:TaskStreamResync)=>void;
  onStatus?:(status:TaskStreamStatus)=>void;
};

type Subscriber=TaskStreamSubscription&{cursor:number};
type Entry={
  key:string;
  provider:TaskStreamProvider;
  taskId:string;
  cursor:number;
  status:TaskStreamStatus;
  source:EventSource|null;
  retry:number;
  retryTimer:ReturnType<typeof setTimeout>|null;
  buffer:AgentEvent[];
  subscribers:Set<Subscriber>;
  tail:boolean;
};

const entries=new Map<string,Entry>();
const BUFFER_LIMIT=500;
const keyFor=(provider:TaskStreamProvider,taskId:string)=>`${provider}:${taskId}`;
const sequenceOf=(event:AgentEvent)=>Number.isSafeInteger(Number(event.sequence))?Math.max(0,Number(event.sequence)):0;

export function taskStreamRetryDelay(attempt:number){
  return Math.min(30_000,1_000*2**Math.min(5,Math.max(0,attempt)));
}

function setStatus(entry:Entry,status:TaskStreamStatus){
  entry.status=status;
  for(const subscriber of entry.subscribers)subscriber.onStatus?.(status);
}

function clearRetry(entry:Entry){
  if(entry.retryTimer)clearTimeout(entry.retryTimer);
  entry.retryTimer=null;
}

function destroy(entry:Entry){
  clearRetry(entry);
  entry.source?.close();
  entry.source=null;
  entries.delete(entry.key);
}

function restartForReplay(entry:Entry,after:number){
  clearRetry(entry);
  entry.source?.close();
  entry.source=null;
  entry.cursor=after;
  entry.tail=false;
  entry.buffer=[];
  entry.retry=0;
  connect(entry);
}

function scheduleReconnect(entry:Entry){
  if(!entry.subscribers.size||entry.retryTimer)return;
  setStatus(entry,"delayed");
  const delay=taskStreamRetryDelay(entry.retry++);
  entry.retryTimer=setTimeout(()=>{entry.retryTimer=null;connect(entry);},delay);
}

function connect(entry:Entry){
  if(!entry.subscribers.size||entry.source)return;
  clearRetry(entry);
  setStatus(entry,"connecting");
  const query=entry.tail?`tail=1`:`after=${entry.cursor}`;
  const source=new EventSource(`/api/tasks/${entry.provider}/${encodeURIComponent(entry.taskId)}/events/stream?${query}`);
  entry.source=source;
  source.addEventListener("open",()=>{
    if(entry.source!==source)return;
    entry.retry=0;
    setStatus(entry,"live");
  });
  source.addEventListener("agent-event",message=>{
    if(entry.source!==source)return;
    try{
      const event=JSON.parse((message as MessageEvent).data) as AgentEvent,sequence=sequenceOf(event);
      if(sequence&&sequence<=entry.cursor)return;
      if(sequence)entry.cursor=sequence;
      entry.buffer.push(event);
      if(entry.buffer.length>BUFFER_LIMIT)entry.buffer=entry.buffer.slice(-BUFFER_LIMIT);
      for(const subscriber of entry.subscribers){
        if(sequence&&sequence<=subscriber.cursor)continue;
        if(sequence)subscriber.cursor=sequence;
        subscriber.onEvent(event);
      }
    }catch{}
  });
  source.addEventListener("resync",message=>{
    if(entry.source!==source)return;
    let value:TaskStreamResync={reason:"server-resync"};
    try{value=JSON.parse((message as MessageEvent).data) as TaskStreamResync;}catch{}
    const latest=Number(value.latestSequence);
    if(Number.isSafeInteger(latest)&&latest>=0)entry.cursor=Math.max(entry.cursor,latest);
    entry.buffer=[];
    setStatus(entry,"delayed");
    for(const subscriber of entry.subscribers){subscriber.cursor=Math.max(subscriber.cursor,entry.cursor);subscriber.onResync?.(value);}
  });
  source.onerror=()=>{
    if(entry.source!==source)return;
    source.close();
    entry.source=null;
    scheduleReconnect(entry);
  };
}

export function subscribeTaskStream(options:TaskStreamSubscription){
  const key=keyFor(options.provider,options.taskId),after=Math.max(0,Number(options.after)||0),replay=options.replay!==false;
  let entry=entries.get(key);
  if(!entry){
    entry={key,provider:options.provider,taskId:options.taskId,cursor:after,status:"connecting",source:null,retry:0,retryTimer:null,buffer:[],subscribers:new Set(),tail:!replay};
    entries.set(key,entry);
  }
  const subscriber:Subscriber={...options,cursor:replay?after:entry.cursor};
  entry.subscribers.add(subscriber);
  const buffered=replay?entry.buffer.filter(event=>sequenceOf(event)>after):[];
  const first=sequenceOf(buffered[0]??({} as AgentEvent));
  // A status-only subscriber (the avatar dock) can reconnect with a cursor
  // ahead of a detail view while the old replay buffer has already gone
  // away. Rewind the one shared source instead of leaving the late subscriber
  // attached to a healthy-looking stream that can never deliver its gap.
  if(replay&&(entry.tail||(entry.cursor>after&&(!buffered.length||first>after+1))))restartForReplay(entry,after);
  else for(const event of buffered){const sequence=sequenceOf(event);if(sequence)subscriber.cursor=sequence;subscriber.onEvent(event);}
  entry.cursor=Math.max(entry.cursor,after);
  subscriber.onStatus?.(entry.status);
  connect(entry);
  let active=true;
  return()=>{
    if(!active)return;
    active=false;
    entry!.subscribers.delete(subscriber);
    if(!entry!.subscribers.size)destroy(entry!);
  };
}

export function resetTaskStreamsForTests(){
  for(const entry of [...entries.values()])destroy(entry);
}

export function taskStreamCountForTests(){return entries.size;}
