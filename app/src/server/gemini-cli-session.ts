import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

type RecordValue=Record<string,any>;
export function parseGeminiSession(raw:string,sessionId:string){
  const messages=new Map<string,RecordValue>();let metadata:RecordValue={};
  const records=raw.split(/\r?\n/).filter(line=>line.trim()).map(line=>JSON.parse(line));
  if(records[0]?.sessionId!==sessionId)throw new Error("Gemini transcript session identity mismatch.");
  const add=(items:unknown)=>{
    if(!Array.isArray(items))throw new Error("Invalid Gemini messages record.");
    for(const message of items){if(typeof message?.id!=="string")throw new Error("Invalid Gemini message identity.");messages.set(message.id,message);}
  };
  for(const record of records){
    if(typeof record.$rewindTo==="string"){
      const ids=[...messages.keys()],index=ids.indexOf(record.$rewindTo);
      for(const id of index<0?ids:ids.slice(index))messages.delete(id);
    }else if(typeof record.id==="string")messages.set(record.id,record);
    else if(record.$set&&typeof record.$set==="object"){
      const {messages:replacement,...updates}=record.$set;
      if(replacement!==undefined){messages.clear();add(replacement);}
      metadata={...metadata,...updates};
    }else if(typeof record.sessionId==="string"&&typeof record.projectHash==="string"){
      const {messages:initial,...updates}=record;metadata={...metadata,...updates};
      if(initial!==undefined)add(initial);
    }else throw new Error("Unsupported Gemini transcript record.");
  }
  if(metadata.sessionId!==sessionId)throw new Error("Gemini transcript session identity changed.");
  return{metadata,messages:[...messages.values()]};
}

export function geminiSessionInputTokens(file:string|null,sessionId:string):number|null{
  if(!file)return null;
  try{
    const raw=fs.readFileSync(file,"utf8"),session=parseGeminiSession(raw,sessionId);
    // Rollback may replace all history IDs and omit token metadata. The raw
    // last measured API request remains useful; never sum journal records.
    const barrier=session.metadata.workhouseCompaction?.lastGeminiId;
    const measured=[...session.messages].reverse().find(message=>message.type==="gemini"&&typeof message.tokens?.input==="number"&&Number.isFinite(message.tokens.input)&&message.tokens.input>=0);
    if(!barrier&&measured)return measured.tokens.input;
    if(!session.messages.some(message=>message.type==="gemini"))return null;
    let awaitingBarrier=Boolean(barrier),input:number|null=null;
    for(const line of raw.split(/\r?\n/)){
      if(!line.trim())continue;
      const record=JSON.parse(line);
      if(record.$rewindTo)input=null;
      if(awaitingBarrier){if(record.id===barrier)awaitingBarrier=false;continue;}
      if(record.type==="gemini"&&typeof record.tokens?.input==="number"&&Number.isFinite(record.tokens.input)&&record.tokens.input>=0)input=record.tokens.input;
    }
    return input;
  }catch{return null;}
}

/** Shared by generation and compaction workers. An existing lock always
 * fails closed, including a crashed owner requiring inspection. No provider process is stopped. */
export function lockGeminiSession(home:string,sessionId:string){
  if(!/^[a-zA-Z0-9_-]+$/.test(sessionId))throw new Error("Invalid Gemini session identity.");
  const directory=path.join(home,".gemini","workhouse-locks");fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const file=path.join(directory,`${sessionId}.lock`),token=crypto.randomUUID();
  const content=JSON.stringify({pid:process.pid,token});
  try{fs.writeFileSync(file,content,{mode:0o600,flag:"wx"});}
  catch(error){
    if((error as NodeJS.ErrnoException).code!=="EEXIST")throw error;
    throw new Error("Gemini session is busy or has a stale lock requiring inspection.");
  }
  return()=>{try{if(fs.readFileSync(file,"utf8")===content)fs.unlinkSync(file);}catch{/* already released */}};
}

/** Deterministic compaction: no model request, no dropped user/assistant text,
 * and no broken function-call/response pairs. Native journal is backed up. */
export function compactGeminiSession(file:string,sessionId:string){
  if(fs.lstatSync(file).isSymbolicLink())throw new Error("Refusing a symlinked Gemini transcript.");
  const original=fs.readFileSync(file),session=parseGeminiSession(original.toString("utf8"),sessionId);
  const backup=`${file}.workhouse-backup-${crypto.randomUUID()}`;
  const marker=`[Older tool output omitted by Workhouse compaction. Original transcript: ${backup}]`;
  let trimmedOutputs=0;
  function trim(value:any):any{
    if(Array.isArray(value))return value.map(trim);
    if(!value||typeof value!=="object")return value;
    const next={...value};
    if(next.functionResponse&&typeof next.functionResponse==="object"){
      const response=next.functionResponse.response;
      if(JSON.stringify(response??"").length>2048){next.functionResponse={...next.functionResponse,response:{output:marker}};trimmedOutputs++;}
    }
    return next;
  }
  const messages=session.messages.map((message,index)=>{
    if(index>=session.messages.length-8)return message;
    const next:RecordValue={...message,content:trim(message.content)};
    if(Array.isArray(message.toolCalls))next.toolCalls=message.toolCalls.map((tool:RecordValue)=>{
      const before=trimmedOutputs;
      let result=trim(tool.result);
      if(typeof result==="string"&&result.length>2048){result=marker;trimmedOutputs++;}
      return trimmedOutputs===before?tool:{...tool,result,resultDisplay:marker};
    });
    return next;
  });
  if(!trimmedOutputs)return{trimmedOutputs:0,beforeBytes:original.length,afterBytes:original.length,backup:null};
  const at=new Date().toISOString();
  const metadata={...session.metadata,lastUpdated:at,workhouseCompaction:{at,lastGeminiId:[...messages].reverse().find(message=>message.type==="gemini")?.id??null}};
  const replacement=Buffer.from([metadata,...messages].map(record=>JSON.stringify(record)).join("\n")+"\n");
  parseGeminiSession(replacement.toString("utf8"),sessionId);
  fs.writeFileSync(backup,original,{mode:0o600,flag:"wx"});
  if(!fs.readFileSync(backup).equals(original))throw new Error("Gemini transcript backup verification failed.");
  const temporary=`${file}.${crypto.randomUUID()}.tmp`;
  try{
    fs.writeFileSync(temporary,replacement,{mode:0o600,flag:"wx"});
    if(!fs.readFileSync(file).equals(original))throw new Error("Gemini transcript changed during compaction.");
    fs.renameSync(temporary,file);
    if(!fs.readFileSync(file).equals(replacement))throw new Error("Gemini transcript readback failed.");
  }finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
  return{trimmedOutputs,beforeBytes:original.length,afterBytes:replacement.length,backup};
}
