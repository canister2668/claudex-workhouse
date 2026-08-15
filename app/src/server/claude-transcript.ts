import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { relativePathInfo, unifiedLineDiff } from "./diff.js";
import {providerOutputBlockId} from "./provider-output-block.js";

// Parses a local Claude Code session transcript (~/.claude/projects/<slug>/<id>.jsonl)
// into the same AgentEvent shapes the live worker emits, so external sessions render
// with the identical conversation UI (user turns, assistant text, diffs, commands).

const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);
export const CLAUDE_TRANSCRIPT_TAIL_BYTES=4*1024*1024;
export const CLAUDE_TRANSCRIPT_MIN_TURNS=12;
export const CLAUDE_TRANSCRIPT_MAX_TURNS=24;
export const CLAUDE_TRANSCRIPT_MAX_BYTES=24*1024*1024;
export const CLAUDE_TRANSCRIPT_EVENT_CONTENT_BYTES=64*1024;
const CLAUDE_TRANSCRIPT_MAX_LINES=6000;
const CLAUDE_TRANSCRIPT_MAX_EVENTS=1500;
export type ClaudeTranscriptTruncation={before:true;droppedTurns:number|null;droppedBytes:number};
export type ClaudeTranscriptResult={events:any[];truncated?:ClaudeTranscriptTruncation;windowBytes:number;turns:number};
const transcriptCache=new Map<string,{dev:number;ino:number;size:number;mtimeMs:number;result:ClaudeTranscriptResult;usedAt:number}>();

export function projectSlug(realPath: string) { return realPath.replaceAll("/", "-"); }
export function transcriptFile(realPath: string, sessionId: string) {
  const home=process.env.HOME || os.homedir();
  return path.join(home, ".claude", "projects", projectSlug(realPath), `${sessionId}.jsonl`);
}

export function transcriptProjectsRoot() {
  return path.join(process.env.HOME || os.homedir(), ".claude", "projects");
}

// The Claude CLI derives its project slug from the working directory the process
// actually started in, which is not always the task's recorded cwd. When those
// disagree the slug path misses and callers used to silently fall back to a
// single-turn stream replay. Session IDs are unique across the store, so locate
// the transcript by ID before giving up.
export function resolveTranscriptFile(realPath: string, sessionId: string) {
  const expected=transcriptFile(realPath, sessionId);
  if(fs.existsSync(expected))return expected;
  const name=`${sessionId}.jsonl`;
  if(!/^[0-9A-Za-z][0-9A-Za-z._-]*$/.test(sessionId)||sessionId.includes("..")) return expected;
  const root=transcriptProjectsRoot();
  let entries:fs.Dirent[];
  try{entries=fs.readdirSync(root,{withFileTypes:true});}catch{return expected;}
  let best:{file:string;mtimeMs:number}|null=null;
  for(const entry of entries){
    if(!entry.isDirectory())continue;
    const candidate=path.join(root,entry.name,name);
    let stat:fs.Stats;
    try{stat=fs.lstatSync(candidate);}catch{continue;}
    if(!stat.isFile())continue;
    if(!best||stat.mtimeMs>best.mtimeMs)best={file:candidate,mtimeMs:stat.mtimeMs};
  }
  return best?best.file:expected;
}

function truncateEventContent(event:any){
  const content=typeof event.content==="string"?event.content:"",bytes=Buffer.byteLength(content,"utf8");
  if(bytes<=CLAUDE_TRANSCRIPT_EVENT_CONTENT_BYTES)return event;
  const shortened=Buffer.from(content,"utf8").subarray(0,CLAUDE_TRANSCRIPT_EVENT_CONTENT_BYTES).toString("utf8").replace(/\uFFFD$/u,"");
  return{...event,content:shortened,metadata:{...(event.metadata??{}),truncatedBytes:bytes-Buffer.byteLength(shortened,"utf8")}};
}

function toolEvent(part: any, cwd: string | null, bashCommandsByToolId:Map<string,string>, timestamp?: string) {
  const name = part.name || "tool";
  const input = part.input || {};
  const events: any[] = [];
  const time=timestamp?{timestamp}:{};
  if (EDIT_TOOLS.has(name)) {
    const changes = name === "MultiEdit" ? (input.edits || []).map((e: any) => ({ file: input.file_path, old: e.old_string, new: e.new_string }))
      : name === "Write" ? [{ file: input.file_path, old: "", new: input.content ?? "" }]
      : [{ file: input.file_path, old: input.old_string ?? "", new: input.new_string ?? "" }];
    for (const ch of changes) {
      const d = unifiedLineDiff(ch.old, ch.new);
      const resolved=relativePathInfo(ch.file,cwd??undefined);events.push(truncateEventContent({ type: "file_change_started", content: d.text, toolName: name, itemId: part.id ?? null, ...time, metadata: { path: resolved.path, pathBase:resolved.pathBase, tool: name, additions: d.additions, deletions: d.deletions } }));
    }
    return events;
  }
  if (name === "Bash") {
    const command=String(input.command??""),itemId=typeof part.id==="string"?part.id:null;
    if(itemId&&command)bashCommandsByToolId.set(itemId,command);
    events.push({type:"command_started",content:command,toolName:name,itemId,...time,metadata:{command,description:input.description??null,source:"provider"}});
    return events;
  }
  const detail = input.file_path ?? input.pattern ?? input.query ?? input.url ?? input.description ?? "";
  events.push({ type: "tool_started", content: typeof detail === "string" && detail ? `${name}: ${detail}` : name, toolName: name, itemId: part.id ?? null, ...time, metadata: {} });
  return events;
}

function userTurn(entry:any){
  if(entry?.type!=="user"||entry.isMeta===true)return false;
  const content=entry.message?.content;
  if(typeof content==="string")return Boolean(content.trim()&&!content.startsWith("<"));
  return(Array.isArray(content)?content:[]).some((part:any)=>part?.type==="text"&&typeof part.text==="string"&&part.text.trim()&&!part.text.startsWith("<"));
}

function emittedEventCount(entry:any){
  if(!entry||entry.isSidechain)return 0;
  if((entry.type==="system"&&entry.subtype==="compact_boundary")||entry.type==="compact_boundary")return 1;
  if(entry.type==="user"){
    if(entry.isMeta===true)return 0;
    const content=entry.message?.content;
    if(typeof content==="string")return content.trim()&&!content.startsWith("<")?1:0;
    return(Array.isArray(content)?content:[]).reduce((count:number,part:any)=>count+(
      part?.type==="text"&&typeof part.text==="string"&&part.text.trim()&&!part.text.startsWith("<")||part?.type==="tool_result"?1:0
    ),0);
  }
  if(entry.type!=="assistant")return 0;
  return(Array.isArray(entry.message?.content)?entry.message.content:[]).reduce((count:number,part:any)=>{
    if(part?.type==="text"&&part.text)return count+1;
    if(part?.type!=="tool_use")return count;
    return count+(part.name==="MultiEdit"&&Array.isArray(part.input?.edits)?part.input.edits.length:1);
  },0);
}

function parseLines(raw:string){
  let offset=0;
  return raw.split("\n").flatMap((line)=>{
    const start=offset;offset+=Buffer.byteLength(line,"utf8")+1;
    if(!line)return[];
    try{return[{line,entry:JSON.parse(line),offset:start}];}catch{return[{line,entry:null,offset:start}];}
  });
}

export function claudeTranscriptEvents(file: string, cwd: string | null, options:{turns?:number}={}):ClaudeTranscriptResult {
  const requestedTurns=Math.max(CLAUDE_TRANSCRIPT_MIN_TURNS,Math.min(CLAUDE_TRANSCRIPT_MAX_TURNS,Math.floor(options.turns??CLAUDE_TRANSCRIPT_MIN_TURNS)));
  const cacheKey=`${file}\0${cwd??""}\0${requestedTurns}`;let descriptor:number|undefined,raw="",rawStart=0,parsedWindow:ReturnType<typeof parseLines>=[],stat:fs.Stats|undefined,start=0;
  try {
    descriptor=fs.openSync(file,"r");stat=fs.fstatSync(descriptor);const cached=transcriptCache.get(cacheKey);
    if(cached&&cached.dev===stat.dev&&cached.ino===stat.ino&&cached.size===stat.size&&cached.mtimeMs===stat.mtimeMs){cached.usedAt=Date.now();return cached.result;}
    let windowBytes=Math.min(stat.size,CLAUDE_TRANSCRIPT_TAIL_BYTES,CLAUDE_TRANSCRIPT_MAX_BYTES);
    while(true){
      start=Math.max(0,stat.size-windowBytes);const buffer=Buffer.allocUnsafe(stat.size-start);let read=0;
      while(read<buffer.length){const count=fs.readSync(descriptor,buffer,read,Math.min(CLAUDE_TRANSCRIPT_TAIL_BYTES,buffer.length-read),start+read);if(!count)break;read+=count;}
      const newline=start>0?buffer.subarray(0,read).indexOf(0x0a):-1,contentOffset=start>0?(newline>=0?newline+1:read):0;
      rawStart=start+contentOffset;raw=buffer.subarray(contentOffset,read).toString("utf8");
      parsedWindow=parseLines(raw);
      if(parsedWindow.filter(item=>userTurn(item.entry)).length>=requestedTurns||start===0||windowBytes>=CLAUDE_TRANSCRIPT_MAX_BYTES)break;
      const nextWindow=Math.min(stat.size,CLAUDE_TRANSCRIPT_MAX_BYTES,windowBytes+CLAUDE_TRANSCRIPT_TAIL_BYTES);
      windowBytes=stat.size-nextWindow<CLAUDE_TRANSCRIPT_TAIL_BYTES?Math.min(stat.size,CLAUDE_TRANSCRIPT_MAX_BYTES):nextWindow;
    }
  } catch { transcriptCache.delete(cacheKey);return{events:[],windowBytes:0,turns:0}; }
  finally{if(descriptor!==undefined)try{fs.closeSync(descriptor);}catch{}}
  let parsed=parsedWindow,lineLimited=false;
  if(parsed.length>CLAUDE_TRANSCRIPT_MAX_LINES){parsed=parsed.slice(-CLAUDE_TRANSCRIPT_MAX_LINES);lineLimited=true;}
  const turnIndexes=parsed.map((item,index)=>userTurn(item.entry)?index:-1).filter(index=>index>=0);
  // Preserve every complete turn already present in a partial tail when it is
  // within the 24-turn safety bound. A whole-file or denser tail is paged to
  // the requested 12/24 turns so the explicit expansion remains meaningful.
  const selectedTurns=start===0||turnIndexes.length>CLAUDE_TRANSCRIPT_MAX_TURNS?requestedTurns:CLAUDE_TRANSCRIPT_MAX_TURNS;
  let selectedStart=turnIndexes.length>selectedTurns
    ?turnIndexes.at(-selectedTurns)!
    :(rawStart>0||lineLimited)&&turnIndexes.length
      ?turnIndexes[0]!
      :0;
  let selected=parsed.slice(selectedStart),droppedTurnsInWindow=turnIndexes.filter(index=>index<selectedStart).length;
  // Keep the emitted-event cap turn-aligned. One JSONL assistant row can emit
  // many cards (notably MultiEdit), so a line-count bound followed by an event
  // tail slice would still cut through the first retained turn.
  let selectedEventCount=selected.reduce((count,item)=>count+emittedEventCount(item.entry),0);
  while(selectedStart<parsed.length&&selectedEventCount>CLAUDE_TRANSCRIPT_MAX_EVENTS){
    const nextTurn=turnIndexes.find(index=>index>selectedStart);if(nextTurn===undefined)break;
    selectedStart=nextTurn;selected=parsed.slice(selectedStart);droppedTurnsInWindow=turnIndexes.filter(index=>index<selectedStart).length;
    selectedEventCount=selected.reduce((count,item)=>count+emittedEventCount(item.entry),0);
  }
  const droppedBytes=selectedStart===0?rawStart:rawStart+(selected[0]?.offset??0);
  const exactDroppedTurns=start===0&&!lineLimited?droppedTurnsInWindow:null;
  const lines=selected;
  const events: any[] = [];
  const transcriptThreadId=path.basename(file,path.extname(file));
  const completedBlocks=new Map<string,number>();
  const bashCommandsByToolId=new Map<string,string>();
  for (const parsedLine of lines) {
    const entry=parsedLine.entry;if(!entry)continue;
    if (entry.isSidechain) continue;
    const timestamp=typeof entry.timestamp==="string"?entry.timestamp:undefined,time=timestamp?{timestamp}:{};
    if ((entry.type === "system" && entry.subtype === "compact_boundary") || entry.type === "compact_boundary") {
      const compactMetadata=entry.compactMetadata&&typeof entry.compactMetadata==="object"
        ?entry.compactMetadata
        :entry.compact_metadata&&typeof entry.compact_metadata==="object"
          ?entry.compact_metadata
          :{};
      const nativeTrigger=compactMetadata.trigger,trigger=nativeTrigger==="auto"?"auto":nativeTrigger==="manual"?"manual":null;
      const nativeItemId=typeof entry.uuid==="string"&&entry.uuid?entry.uuid:typeof entry.id==="string"&&entry.id?entry.id:null;
      const preTokens=Number(compactMetadata.preTokens??compactMetadata.pre_tokens);
      events.push({
        type:"context_compaction",
        content:`Claude context ${trigger==="auto"?"automatically ":""}compacted.`,
        itemId:nativeItemId,
        ...time,
        metadata:{
          nativeType:entry.type,
          subtype:entry.subtype??null,
          trigger,
          preTokens:Number.isFinite(preTokens)?preTokens:null,
          ...(nativeItemId?{itemId:nativeItemId}:{}),
          ...(transcriptThreadId?{threadId:transcriptThreadId}:{})
        }
      });
    } else if (entry.type === "user") {
      if(entry.isMeta===true)continue;
      const content = entry.message?.content;
      if (typeof content === "string") { if (content.trim() && !content.startsWith("<")) events.push({ type: "message", content, ...time, metadata: { role: "user" } }); continue; }
      for (const part of Array.isArray(content) ? content : []) {
        if (part.type === "text" && part.text?.trim() && !part.text.startsWith("<")) events.push({ type: "message", content: part.text, ...time, metadata: { role: "user" } });
        else if (part.type === "tool_result") {
          const itemId=typeof part.tool_use_id==="string"?part.tool_use_id:null,command=itemId?bashCommandsByToolId.get(itemId):undefined,isError=Boolean(part.is_error),result=typeof part.content==="string"?part.content:JSON.stringify(part.content??"");
          if(itemId)bashCommandsByToolId.delete(itemId);
          if(command)events.push(truncateEventContent({type:"command_completed",content:result,status:isError?"failed":"completed",toolName:"Bash",itemId,...time,metadata:{command,isError,ok:!isError,source:"provider"}}));
          else events.push(truncateEventContent({type:"tool_completed",content:result,itemId,...time,metadata:{isError}}));
        }
      }
    } else if (entry.type === "assistant") {
      for (const part of entry.message?.content ?? []) {
        if (part.type === "text" && part.text) {
          const callId=typeof entry.message?.id==="string"?entry.message.id:"",ordinal=completedBlocks.get(callId)??0,itemId=providerOutputBlockId(callId,ordinal);
          if(callId)completedBlocks.set(callId,ordinal+1);
          events.push({ type:"message_completed", content:part.text, itemId, threadId:transcriptThreadId, ...time, metadata:{...(itemId?{itemId}:{}),threadId:transcriptThreadId} });
        }
        else if (part.type === "tool_use") events.push(...toolEvent(part,cwd,bashCommandsByToolId,timestamp));
      }
    }
  }
  const result:ClaudeTranscriptResult={events,windowBytes:(stat?.size??0)-start,turns:turnIndexes.length-droppedTurnsInWindow,...(droppedBytes>0?{truncated:{before:true,droppedTurns:exactDroppedTurns,droppedBytes}}:{})};
  if(stat)transcriptCache.set(cacheKey,{dev:stat.dev,ino:stat.ino,size:stat.size,mtimeMs:stat.mtimeMs,result,usedAt:Date.now()});
  if(transcriptCache.size>32)for(const[key]of [...transcriptCache.entries()].sort((a,b)=>a[1].usedAt-b[1].usedAt).slice(0,transcriptCache.size-32))transcriptCache.delete(key);
  return result;
}
