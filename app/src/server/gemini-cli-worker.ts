import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import {spawn} from "node:child_process";
import {StreamSpool} from "./stream-events.js";
import {sanitizeSensitiveText,sanitizeSensitiveValue} from "./sensitive-data.js";
import {beginWorkerEmotion,updateWorkerEmotion} from "./worker-emotion.js";
import {automationLevel} from "./automation-level.js";
import {executionPolicyTurnInstructions} from "./automation-level.js";
import {delegationDeveloperInstructions,normalizeDelegationSettings} from "./delegation-settings.js";
import {classifyGeminiCliError,geminiApprovalMode,geminiCliArguments,geminiCliExitFailure,geminiShellAvailable,resolveGeminiSessionFile} from "./gemini-cli-runtime.js";
import {geminiContextUsage,geminiModelBreakdown,geminiOutputUsage,geminiToolEndEvent,geminiToolShape,geminiToolStartEvent,geminiToolSummary,geminiUsage,geminiWorkerActivity,type GeminiStreamEvent} from "./gemini-cli-events.js";

/**
 * Worker for the `vertex-agent` execution backend: the official Gemini CLI,
 * authenticated against the configured Vertex project, so the Gemini provider
 * gets file, edit, and shell tools while the spend stays on Google Cloud.
 *
 * Process supervision mirrors `antigravity-worker.ts` (atomic state file,
 * marker-based identity, stream spool, emotion updates); only the CLI contract
 * differs.
 */

const [,,statePath,taskId,entryKind,entry,mode,cwd,marker,permissionProfile=":read-only",model="",workMode="default",sessionId="",sourceSessionId="",...promptParts]=process.argv;
const prompt=promptParts.join(" ");
const startedAt=new Date().toISOString();
const root=String(process.env.CLAUDEX_WORKHOUSE_DATA_ROOT??"");
const home=String(process.env.HOME??"");
const spool=new StreamSpool(root,taskId,"antigravity");
const level=automationLevel(undefined,permissionProfile);
const approvalMode=geminiApprovalMode(level,workMode);

const procStart=(pid:number)=>{try{return fs.readFileSync(`/proc/${pid}/stat`,"utf8").split(" ")[21]??null;}catch{return null;}};
const state:any={marker,pid:process.pid,pgid:process.pid,processStart:procStart(process.pid),sessionId:sessionId||null,status:"running",startedAt,updatedAt:startedAt,result:null,error:null,log:"",model:model||null,modelBackend:"gemini-cli-vertex",approvalMode,activity:"starting"};
const atomicWrite=()=>{const temp=`${statePath}.${process.pid}.tmp`;fs.writeFileSync(temp,`${JSON.stringify(sanitizeSensitiveValue(state,{preserveSourceIdentifiers:true}))}\n`,{encoding:"utf8",mode:0o600});fs.renameSync(temp,statePath);};
const appendLog=(value:string)=>{const clean=sanitizeSensitiveText(value).trim();if(clean)state.log=`${state.log}${state.log?"\n":""}${clean}`.slice(-262144);};

let settled=false,stopped=false;
const fail=(failure:{code:string;message:string})=>{
  if(settled)return;
  settled=true;
  state.status=stopped?"stopped":"failed";
  state.error=sanitizeSensitiveText(failure.message);
  state.errorCode=failure.code;
  state.activity=state.status;
  state.updatedAt=new Date().toISOString();
  atomicWrite();
  spool.append({type:stopped?"task_stopped":"task_failed",content:state.error,threadId:state.sessionId,terminal:true,metadata:{errorCode:failure.code}});
  updateWorkerEmotion(root,"antigravity",stopped?"neutral":"disappointed",state.sessionId);
};

atomicWrite();
let emotionStarted=Boolean(state.sessionId);
if(emotionStarted)beginWorkerEmotion(root,"antigravity",prompt,state.sessionId);
spool.append({type:"task_started",content:"Gemini CLI (Vertex Agent) worker started.",threadId:state.sessionId});

let delegationSettings:unknown;
try{delegationSettings=JSON.parse(String(process.env.CLAUDEX_WORKHOUSE_DELEGATION_SETTINGS??"null"));}catch{delegationSettings=null;}

// The CLI resolves permission from --approval-mode before the model ever runs,
// so tell the model what it actually has instead of letting it discover a
// missing shell tool mid-task and report that as an environment fault.
const shellNotice=geminiShellAvailable(approvalMode)
  ?"Shell commands are available in this turn."
  :"The shell tool is unavailable in this turn's permission profile. Do not claim you ran a command, and do not report this as a broken environment.";
const providerPrompt=[
  delegationDeveloperInstructions(normalizeDelegationSettings(delegationSettings),"antigravity"),
  executionPolicyTurnInstructions("antigravity",level,cwd),
  shellNotice,
  `# Current user request\n${prompt}`
].filter(Boolean).join("\n\n");

let sessionFile:string|null=null;
if(mode==="fork"){
  const source=sourceSessionId?resolveGeminiSessionFile(home,sourceSessionId,cwd):null;
  if(!source){
    fail({code:"GEMINI_CLI_FORK_SOURCE_MISSING",message:"The source Gemini CLI session transcript is no longer on disk, so this branch cannot inherit its context."});
    process.exit(0);
  }
  // The CLI persists a branch itself once it is handed the parent transcript;
  // Workhouse must not copy, rename, or delete anything inside the CLI's own
  // session store. Doing so makes the store inconsistent and the CLI then
  // prunes the very transcripts a later resume needs.
  sessionFile=source;
}

const args=geminiCliArguments({
  prompt:providerPrompt,
  model:model||null,
  approvalMode,
  launch:{mode:mode as "new"|"resume"|"fork",sessionId:mode==="resume"?sourceSessionId||sessionId:sessionId,sessionFile}
});
const command=entryKind==="bundle"?process.execPath:entry;
const commandArgs=entryKind==="bundle"?[entry,...args]:args;

// `gemini.js` is a launcher: the real CLI, and every shell command it runs, are
// grandchildren. Signalling only the direct child leaves those reparented to
// init and still holding the workspace. Its own process group makes the whole
// tree addressable in one signal.
const child=spawn(command,commandArgs,{cwd,shell:false,windowsHide:true,detached:true,stdio:["ignore","pipe","pipe"],env:process.env});
const childGroup=child.pid??null;
state.activity="thinking";
atomicWrite();

/**
 * The CLI starts each shell command in its own session, so those processes are
 * outside the child's process group and survive a group signal. Collect the
 * live descendant set from /proc first and signal it explicitly; once the
 * intermediate parents die the survivors reparent to init and can no longer be
 * found by walking down from the child.
 */
const descendants=(rootPid:number)=>{
  const children=new Map<number,number[]>();
  let entries:string[];
  try{entries=fs.readdirSync("/proc");}catch{return[];}
  for(const entry of entries){
    if(!/^\d+$/.test(entry))continue;
    try{
      const stat=fs.readFileSync(`/proc/${entry}/stat`,"utf8");
      const parent=Number(stat.slice(stat.lastIndexOf(")")+2).split(" ")[1]);
      if(!Number.isFinite(parent))continue;
      children.set(parent,[...(children.get(parent)??[]),Number(entry)]);
    }catch{/* the process exited while the table was being read */}
  }
  const collected:number[]=[],queue=[rootPid];
  while(queue.length){
    const pid=queue.shift()!;
    for(const value of children.get(pid)??[]){
      if(collected.includes(value))continue;
      collected.push(value);
      queue.push(value);
    }
  }
  return collected;
};

const signalTree=(signal:NodeJS.Signals)=>{
  if(childGroup===null)return;
  // Deepest first, so a parent cannot spawn a replacement mid-teardown.
  for(const pid of descendants(childGroup).reverse())try{process.kill(pid,signal);}catch{/* already gone */}
  try{process.kill(-childGroup,signal);}catch{
    try{child.kill(signal);}catch{/* the tree is already gone */}
  }
};
const stop=()=>{
  if(stopped)return;
  stopped=true;
  signalTree("SIGTERM");
  // The worker must not outlive a cancel even if the CLI ignores SIGTERM.
  setTimeout(()=>{signalTree("SIGKILL");},5_000).unref();
  setTimeout(()=>{if(!settled){fail({code:"GEMINI_CLI_CANCELLED",message:"Gemini CLI task stopped."});process.exit(0);}},8_000).unref();
};
process.once("SIGTERM",stop);
process.once("SIGINT",stop);

let finalText="",streamFailure:{code:string;message:string}|null=null,sawResult=false;
const toolShapes=new Map<string,ReturnType<typeof geminiToolShape>>();
const toolNames=new Map<string,string>();

const consume=(line:string)=>{
  let value:GeminiStreamEvent;
  try{value=JSON.parse(line);}catch{appendLog(line);state.updatedAt=new Date().toISOString();atomicWrite();return;}
  const type=String(value.type??"");
  if(type==="init"){
    const id=typeof value.session_id==="string"?value.session_id:"";
    if(id){
      state.sessionId=id;
      if(!emotionStarted){emotionStarted=true;beginWorkerEmotion(root,"antigravity",prompt,state.sessionId);}
    }
    // `init.model` is "auto" whenever the CLI picks per request, so it must not
    // overwrite the model the task was created with.
    if(typeof value.model==="string"&&value.model&&value.model!=="auto")state.model=value.model;
    state.activity="thinking";
    updateWorkerEmotion(root,"antigravity","thinking",state.sessionId);
    spool.append({type:"turn_started",content:"Gemini CLI turn started.",threadId:state.sessionId});
  }else if(type==="message"){
    // The CLI echoes the submitted prompt back as a user message; only the
    // assistant side is conversation output.
    if(value.role==="assistant"){
      const content=typeof value.content==="string"?value.content:"";
      if(content){
        finalText+=content;
        state.activity="thinking";
        spool.append({type:"message_delta",content,threadId:state.sessionId});
      }
    }
  }else if(type==="tool_use"){
    const toolName=String(value.tool_name??"tool"),toolId=String(value.tool_id??toolName);
    const shape=geminiToolShape(toolName);
    toolShapes.set(toolId,shape);
    toolNames.set(toolId,toolName);
    state.activity="tool";
    updateWorkerEmotion(root,"antigravity",geminiWorkerActivity(shape),state.sessionId);
    spool.append({type:geminiToolStartEvent(shape),content:geminiToolSummary(toolName,value.parameters),threadId:state.sessionId,toolName,metadata:{toolId,parameters:sanitizeSensitiveValue(value.parameters ?? {})}});
  }else if(type==="tool_result"){
    const toolId=String(value.tool_id??""),shape=toolShapes.get(toolId)??"tool",toolName=toolNames.get(toolId)??"tool";
    const failed=String(value.status??"")==="error";
    const output=typeof value.output==="string"?value.output:"";
    state.activity="thinking";
    spool.append({type:geminiToolEndEvent(shape,failed),content:output.slice(0,20_000),threadId:state.sessionId,toolName,status:failed?"error":"success",metadata:{toolId,...(value.error?{error:value.error}:{})}});
    toolShapes.delete(toolId);
    toolNames.delete(toolId);
  }else if(type==="error"){
    const message=String(value.message??"Gemini CLI reported an error.");
    appendLog(message);
    spool.append({type:"error",content:sanitizeSensitiveText(message).slice(0,4_000),threadId:state.sessionId,metadata:{severity:value.severity??"error"}});
  }else if(type==="result"){
    sawResult=true;
    const usage=geminiUsage(value.stats),at=new Date().toISOString();
    if(usage){
      state.outputUsage=geminiOutputUsage(usage,at);
      state.contextUsage=geminiContextUsage(usage,at);
      state.modelUsage=geminiModelBreakdown(usage);
      const primary=usage.models[0];
      // The CLI's own choice is the authoritative effective model. It rewrites
      // some requested ids before calling Vertex, so the difference is reported
      // from what actually ran rather than from a routing table Workhouse would
      // have to keep in step with every CLI release.
      if(primary?.model){
        if(model&&primary.model!==model&&!state.modelRewrittenFrom){
          state.modelRewrittenFrom=model;
          spool.append({type:"unknown",content:`Gemini CLI ran this turn on ${primary.model} instead of the requested ${model}.`,threadId:state.sessionId,metadata:{requestedModel:model,routedModel:primary.model}});
        }
        state.model=primary.model;
      }
    }
    if(String(value.status??"")==="error"){
      const message=String(value.error?.message??"Gemini CLI failed without a message.");
      appendLog(message);
      streamFailure=classifyGeminiCliError(message);
    }
  }
  state.updatedAt=new Date().toISOString();
  atomicWrite();
};

readline.createInterface({input:child.stdout}).on("line",consume);
readline.createInterface({input:child.stderr}).on("line",line=>{
  // The CLI writes terminal-capability and ripgrep notices to stderr on every
  // headless run; they are log material, not task failures.
  appendLog(line);
  state.updatedAt=new Date().toISOString();
  atomicWrite();
});

child.once("error",error=>fail({code:"GEMINI_CLI_SPAWN_FAILED",message:error.message}));
child.once("close",(code,signal)=>{
  if(settled)return;
  if(streamFailure){fail(streamFailure);return;}
  if(stopped){fail({code:"GEMINI_CLI_CANCELLED",message:"Gemini CLI task stopped."});return;}
  if(code!==0){fail(geminiCliExitFailure(code,signal));return;}
  if(!sawResult){fail({code:"GEMINI_CLI_NO_RESULT",message:"Gemini CLI exited successfully without emitting a result."});return;}
  settled=true;
  const at=new Date().toISOString();
  state.result=finalText.trim()||state.log;
  state.status="completed";
  state.activity="completed";
  state.updatedAt=at;
  atomicWrite();
  spool.append({type:"message_completed",content:state.result,threadId:state.sessionId,metadata:{role:"agent",phase:"final_answer",...(state.modelUsage?{modelUsage:state.modelUsage}:{})}});
  spool.append({type:"task_completed",content:"Gemini CLI task completed.",threadId:state.sessionId,terminal:true});
  updateWorkerEmotion(root,"antigravity","done",state.sessionId);
});
