import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { normalizeAgentEvent } from "./events.js";
import type { AgentEvent, ProviderId, StreamEvent } from "./types.js";

export const STREAM_MAX_BYTES = 8 * 1024 * 1024;
export const STREAM_REPLAY_LIMIT = 2000;
export const STREAM_TTL_MS = 24 * 60 * 60 * 1000;
const STREAM_CACHE_TTL_MS = 10 * 60 * 1000;
const STREAM_CACHE_MAX_FILES = 64;
const STREAM_CACHE_MAX_SOURCE_BYTES = 128 * 1024 * 1024;

type CachedStreamFile = {
  dev:number;
  ino:number;
  offset:number;
  remainder:Buffer;
  events:StreamEvent[];
  firstSequence:number|null;
  lastUsed:number;
};

const streamFileCache=new Map<string,CachedStreamFile>();

export function sseResumeSequence(lastEventId:unknown,after:unknown){
  const header=Number(String(lastEventId??"").split(":").at(-1)??0),query=Number(after??0);
  return Math.max(Number.isSafeInteger(header)&&header>0?header:0,Number.isSafeInteger(query)&&query>0?query:0);
}

function fileKey(taskId: string) { return crypto.createHash("sha256").update(taskId).digest("hex"); }
export function streamFile(root: string, taskId: string) { return path.join(root, "data", "stream-events", `${fileKey(taskId)}.ndjson`); }

function lastSequence(file: string) {
  for (const candidate of [file, `${file}.1`]) {
    try {
      const lines = fs.readFileSync(candidate, "utf8").trim().split("\n");
      const value = JSON.parse(lines.at(-1) ?? "{}").sequence;
      if (Number.isSafeInteger(value)) return value;
    } catch {}
  }
  return 0;
}

export class StreamSpool {
  private sequence: number;
  readonly file: string;
  constructor(root: string, readonly taskId: string, readonly provider: ProviderId) {
    this.file = streamFile(root, taskId);
    fs.mkdirSync(path.dirname(this.file), { recursive:true, mode:0o700 });
    try { fs.chmodSync(path.dirname(this.file), 0o700); } catch {}
    this.sequence = lastSequence(this.file);
  }

  append(value: Partial<AgentEvent> & { type:string; content?:string; threadId?:string|null; turnId?:string|null; itemId?:string|null; terminal?:boolean }) {
    try {
      if (fs.existsSync(this.file) && fs.statSync(this.file).size >= STREAM_MAX_BYTES) {
        fs.rmSync(`${this.file}.1`, { force:true });
        fs.renameSync(this.file, `${this.file}.1`);
      }
      const normalized = normalizeAgentEvent({ ...value, provider:this.provider, content:value.content ?? "" }, this.provider);
      const event: StreamEvent = {
        ...normalized,
        sequence:++this.sequence,
        eventId:`${fileKey(this.taskId).slice(0,16)}:${this.sequence}`,
        taskId:this.taskId,
        threadId:value.threadId ?? null,
        turnId:value.turnId ?? null,
        itemId:value.itemId ?? null,
        terminal:Boolean(value.terminal),
        timestamp:value.timestamp ?? new Date().toISOString()
      };
      fs.appendFileSync(this.file, `${JSON.stringify(event)}\n`, { encoding:"utf8", mode:0o600 });
      try { fs.chmodSync(this.file, 0o600); } catch {}
      return event;
    } catch (error) {
      return { error:error instanceof Error ? error.message : String(error) };
    }
  }
}

function parseLines(buffer:Buffer,taskId:string){
  const events:StreamEvent[]=[];
  for(const line of buffer.toString("utf8").split("\n")){
    if(!line)continue;
    try{const event=JSON.parse(line) as StreamEvent;if(event.taskId===taskId)events.push(event);}catch{}
  }
  return events;
}

function pruneStreamFileCache(now:number){
  let sourceBytes=0;
  for(const [file,value]of streamFileCache){if(now-value.lastUsed>STREAM_CACHE_TTL_MS)streamFileCache.delete(file);else sourceBytes+=value.offset;}
  if(streamFileCache.size<=STREAM_CACHE_MAX_FILES&&sourceBytes<=STREAM_CACHE_MAX_SOURCE_BYTES)return;
  for(const [file,value]of [...streamFileCache.entries()].sort((a,b)=>a[1].lastUsed-b[1].lastUsed)){
    streamFileCache.delete(file);sourceBytes-=value.offset;
    if(streamFileCache.size<=STREAM_CACHE_MAX_FILES&&sourceBytes<=STREAM_CACHE_MAX_SOURCE_BYTES)break;
  }
}

function readCachedFile(file:string,taskId:string){
  let descriptor:number|undefined;
  try{
    descriptor=fs.openSync(file,"r");
    const stat=fs.fstatSync(descriptor),previous=streamFileCache.get(file),same=Boolean(previous&&previous.dev===stat.dev&&previous.ino===stat.ino&&stat.size>=previous.offset);
    const start=same?previous!.offset:0,remaining=Math.max(0,stat.size-start),chunk=Buffer.allocUnsafe(remaining);let read=0;
    if(same&&remaining===0){previous!.lastUsed=Date.now();return previous!;}
    while(read<remaining){const count=fs.readSync(descriptor,chunk,read,remaining-read,start+read);if(!count)break;read+=count;}
    const bytes=read===chunk.length?chunk:chunk.subarray(0,read),combined=same&&previous!.remainder.length?Buffer.concat([previous!.remainder,bytes]):bytes;
    const newline=combined.lastIndexOf(10),complete=newline>=0?combined.subarray(0,newline):Buffer.alloc(0),remainder=newline>=0?combined.subarray(newline+1):combined;
    const added=complete.length?parseLines(complete,taskId):[],events=(same?[...previous!.events,...added]:added).slice(-STREAM_REPLAY_LIMIT),now=Date.now();
    const value:CachedStreamFile={dev:stat.dev,ino:stat.ino,offset:start+read,remainder:Buffer.from(remainder),events,firstSequence:same?(previous!.firstSequence??added[0]?.sequence??null):(added[0]?.sequence??null),lastUsed:now};
    streamFileCache.set(file,value);pruneStreamFileCache(now);return value;
  }catch{streamFileCache.delete(file);return null;}
  finally{if(descriptor!==undefined)try{fs.closeSync(descriptor);}catch{}}
}

export function readStreamEvents(root: string, taskId: string, afterSequence = 0, limit = STREAM_REPLAY_LIMIT) {
  const file = streamFile(root, taskId);
  const rotated=readCachedFile(`${file}.1`,taskId),current=readCachedFile(file,taskId);
  const all = [...(rotated?.events??[]),...(current?.events??[])];
  const firstSequence = rotated?.firstSequence??current?.firstSequence??null;
  const latestSequence = all.at(-1)?.sequence ?? 0;
  if(afterSequence>0&&afterSequence>=latestSequence)return{events:[],firstSequence,latestSequence,replayMissed:false};
  const pending=all.filter((event)=>event.sequence>afterSequence);
  const boundedLimit=Math.max(1,Math.min(STREAM_REPLAY_LIMIT,limit));
  const firstCachedSequence=all[0]?.sequence??null;
  const replayMissed = afterSequence > 0 && ((firstSequence !== null && afterSequence < firstSequence - 1) || (firstCachedSequence!==null&&afterSequence<firstCachedSequence-1) || pending.length > boundedLimit);
  return { events:replayMissed ? [] : pending.slice(-boundedLimit), firstSequence, latestSequence, replayMissed };
}

// File edits are durable session artifacts, not transient progress. A noisy
// provider can emit more than STREAM_REPLAY_LIMIT progress events after an edit,
// so recover these sparse events from the complete bounded spool.
export function readStreamFileChanges(root:string,taskId:string,limit=1000){
  const file=streamFile(root,taskId),events:StreamEvent[]=[];
  for(const candidate of [`${file}.1`,file]){
    let content:Buffer;try{content=fs.readFileSync(candidate);}catch{continue;}
    for(const event of parseLines(content,taskId))if(event.type==="file_change_started"||event.type==="file_change_completed")events.push(event);
  }
  return events.slice(-Math.max(1,Math.min(1000,limit)));
}

export function cleanupStreamEvents(root: string) {
  const directory = path.join(root, "data", "stream-events");
  try {
    for (const name of fs.readdirSync(directory)) {
      const file = path.join(directory, name);
      const stat = fs.statSync(file);
      if (stat.isFile() && Date.now()-stat.mtimeMs > STREAM_TTL_MS){fs.rmSync(file,{force:true});streamFileCache.delete(file);}
    }
  } catch {}
}
