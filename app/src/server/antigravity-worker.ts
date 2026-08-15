import fs from "node:fs";
import path from "node:path";
import {spawn} from "node:child_process";
import readline from "node:readline";
import {StreamSpool} from "./stream-events.js";
import {sanitizeSensitiveText,sanitizeSensitiveValue} from "./sensitive-data.js";
import {beginWorkerEmotion,updateWorkerEmotion} from "./worker-emotion.js";
import {antigravityConversationId,antigravityTextValue} from "./antigravity-runtime.js";
import {addAntigravityUsage,antigravityContextUsage,antigravityOutputUsage,antigravityStepUsage,antigravityUsageTotals,type AntigravityUsageTotals} from "./antigravity-usage.js";
import {automationLevel} from "./automation-level.js";
import {antigravityTurnPrompt} from "./antigravity-prompt.js";
import {delegationDeveloperInstructions,normalizeDelegationSettings} from "./delegation-settings.js";

const [,,statePath,taskId,binary,mode,cwd,marker,permissionProfile=":read-only",model="",effort="default",executionBackend="consumer",runtimeProfile="default",sessionId="",...promptParts]=process.argv;
const prompt=promptParts.join(" ");
let effectiveCwd=cwd;
const startedAt=new Date().toISOString();
const root=String(process.env.CLAUDEX_WORKHOUSE_DATA_ROOT??"");
const spool=new StreamSpool(root,taskId,"antigravity");
const procStart=(pid:number)=>{try{return fs.readFileSync(`/proc/${pid}/stat`,"utf8").split(" ")[21]??null;}catch{return null;}};
const state:any={marker,pid:process.pid,pgid:process.pid,processStart:procStart(process.pid),sessionId:sessionId||null,status:"running",startedAt,updatedAt:startedAt,result:null,error:null,log:"",model:model||null,modelBackend:executionBackend==="vertex"?"antigravity-vertex":"antigravity-cli",activity:"starting"};
const atomicWrite=()=>{const temp=`${statePath}.${process.pid}.tmp`;fs.writeFileSync(temp,`${JSON.stringify(sanitizeSensitiveValue(state,{preserveSourceIdentifiers:true}))}\n`,{encoding:"utf8",mode:0o600});fs.renameSync(temp,statePath);};
const appendLog=(value:string)=>{const clean=sanitizeSensitiveText(value.replace(/[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g,"")).trim();if(clean)state.log=`${state.log}${state.log?"\n":""}${clean}`.slice(-262144);};

atomicWrite();let emotionStarted=Boolean(state.sessionId);if(emotionStarted)beginWorkerEmotion(root,"antigravity",prompt,state.sessionId);spool.append({type:"task_started",content:"Gemini Antigravity worker started.",threadId:state.sessionId});
let emotionMode="mcp";try{emotionMode=fs.readFileSync(`${root}/data/emotion/emotion-mode`,"utf8").trim();}catch{}
let delegationSettings:unknown;try{delegationSettings=JSON.parse(String(process.env.CLAUDEX_WORKHOUSE_DELEGATION_SETTINGS??"null"));}catch{delegationSettings=null;}
const basePrompt=antigravityTurnPrompt(prompt,effectiveCwd,automationLevel(undefined,permissionProfile),runtimeProfile==="conversation"?"conversation":"default",runtimeProfile==="conversation"&&emotionMode!=="catch");
let providerPrompt=runtimeProfile==="conversation"?basePrompt:`${delegationDeveloperInstructions(normalizeDelegationSettings(delegationSettings),"antigravity")}\n\n${basePrompt}`;
const args=["--print",providerPrompt,"--output-format","stream-json"];
args.push("--print-timeout","30m","--log-file",process.platform==="win32"?"NUL":"/dev/null");
if(model)args.push("--model",model);
if(effort&&effort!=="default")args.push("--effort",effort);
if(mode==="resume"||mode==="fork")args.push("--conversation",sessionId);
if(mode==="fork")args[1]=`/fork\n${providerPrompt}`;
let allowDangerous=permissionProfile===":danger-full-access";
if(allowDangerous)args.push("--dangerously-skip-permissions");
else args.push("--sandbox");

const childEnvironment:NodeJS.ProcessEnv={...process.env,AGY_CLI_DISABLE_AUTO_UPDATE:"true",NO_COLOR:"1"};
const child=spawn(binary,args,{cwd:effectiveCwd,shell:false,windowsHide:true,stdio:["ignore","pipe","pipe"],env:childEnvironment});
let finalText="";
// Gemini only reports cumulative conversation totals in `result`, so this turn's
// usage has to be accumulated from the per-request step counters instead.
let turnTotals:AntigravityUsageTotals|null=null,turnRequests=0;
const consume=(line:string)=>{
  appendLog(line);let value:any;try{value=JSON.parse(line);}catch{state.updatedAt=new Date().toISOString();atomicWrite();return;}
  const nextId=antigravityConversationId(value);if(nextId){state.sessionId=nextId;if(!emotionStarted){emotionStarted=true;beginWorkerEmotion(root,"antigravity",prompt,state.sessionId);}}
  const type=String(value?.event??value?.type??"");const step=value?.step_update??value?.step??value;const stepType=String(step?.step_type??step?.type??"");const text=antigravityTextValue(type==="result"?value?.result??value:type==="step_update"?step:value);
  if(type==="init"){state.activity="thinking";updateWorkerEmotion(root,"antigravity","thinking",state.sessionId);spool.append({type:"turn_started",content:"Gemini turn started.",threadId:state.sessionId});}
  else if(type==="step_update"){
    state.activity=/tool|command|file/i.test(stepType)?"tool":"thinking";
    updateWorkerEmotion(root,"antigravity",/command/i.test(stepType)?"building":/file.*(write|edit|create)/i.test(stepType)?"coding":/tool/i.test(stepType)?"searching":"thinking",state.sessionId);
    const eventType=/command/i.test(stepType)?"command_output":/file.*(write|edit|create)/i.test(stepType)?"file_change_started":/tool/i.test(stepType)?"tool_progress":"message_delta";
    if(text)spool.append({type:eventType,content:text,threadId:state.sessionId,metadata:{stepType}});
    const stepUsage=antigravityStepUsage(value);
    if(stepUsage){
      turnTotals=addAntigravityUsage(turnTotals,stepUsage.totals);turnRequests++;
      const at=new Date().toISOString();
      state.outputUsage=antigravityOutputUsage(turnTotals,turnRequests,at);
      state.contextUsage=antigravityContextUsage(step?.usage,state.model??model,at);
      spool.append({type:"unknown",content:"Gemini usage updated.",threadId:state.sessionId,metadata:{nativeMethod:"claude/outputUsage/updated",outputCallId:`step-${stepUsage.stepIndex??turnRequests}`,outputUsage:antigravityOutputUsage(stepUsage.totals,1,at),contextUsage:state.contextUsage}});
    }
  }else if(type==="result"){
    finalText=text||finalText;
    const cumulative=antigravityUsageTotals(value?.result?.usage??value?.usage),at=new Date().toISOString();
    state.conversationUsage=antigravityOutputUsage(cumulative,Number(value?.result?.num_turns??value?.num_turns)||null,at);
    // A first turn's cumulative total is that turn's total, so it is a safe
    // fallback when the CLI emitted no per-step counters.
    if(!turnTotals&&cumulative&&Number(value?.result?.num_turns??value?.num_turns??1)<=1)state.outputUsage=antigravityOutputUsage(cumulative,1,at);
  }
  state.updatedAt=new Date().toISOString();atomicWrite();
};
readline.createInterface({input:child.stdout}).on("line",consume);
readline.createInterface({input:child.stderr}).on("line",line=>{appendLog(line);state.updatedAt=new Date().toISOString();atomicWrite();});
child.once("error",error=>{state.status="failed";state.error=error.message;state.updatedAt=new Date().toISOString();atomicWrite();spool.append({type:"task_failed",content:error.message,threadId:state.sessionId,terminal:true});updateWorkerEmotion(root,"antigravity","disappointed",state.sessionId);});
child.once("close",async(code,signal)=>{if(state.status==="failed")return;state.updatedAt=new Date().toISOString();if(code===0){
  try{
    const raw=finalText||state.log;
    state.result=raw;
    state.status="completed";state.activity="completed";spool.append({type:"message_completed",content:state.result,threadId:state.sessionId});spool.append({type:"task_completed",content:"Gemini task completed.",threadId:state.sessionId,terminal:true});updateWorkerEmotion(root,"antigravity","done",state.sessionId);
  }catch(error){const message=sanitizeSensitiveText(error instanceof Error?error.message:String(error));state.status="failed";state.error=message;state.activity="failed";
    spool.append({type:"task_failed",content:message,threadId:state.sessionId,terminal:true});updateWorkerEmotion(root,"antigravity","disappointed",state.sessionId);}
}else{state.status=signal?"stopped":"failed";state.error=`Gemini Antigravity runtime exited with ${signal??code}.`;state.activity=state.status;spool.append({type:state.status==="stopped"?"task_stopped":"task_failed",content:state.error,threadId:state.sessionId,terminal:true});updateWorkerEmotion(root,"antigravity",state.status==="stopped"?"neutral":"disappointed",state.sessionId);}atomicWrite();});
