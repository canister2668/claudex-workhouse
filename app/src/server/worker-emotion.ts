import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {EMOTION_COPY as COPY,emotionStateFile,writeEmotionState} from "./emotion-state-file.js";

type Provider="claude"|"codex"|"deepseek"|"ollama"|"antigravity"|"grok";

// Each provider worker owns exactly one task. Do not trust an inherited value:
// the Workhouse server itself may have been launched from another managed task,
// and forwarding that timestamp makes unrelated avatar hooks look equally old.
const workerTaskStartedAt=Date.now();
process.env.CLAUDEX_WORKHOUSE_TASK_STARTED_AT=String(workerTaskStartedAt);

const defaultOutfit:Record<Provider,string>={claude:"normal",codex:"Gpt-Sol",deepseek:"DeepSeek",ollama:"Ollama",antigravity:"Antigravity",grok:"Grok"};

const ACTIVITY_VARIANTS:Record<string,string[]>={
  thinking:["thinking","thinking_2","thinking_3"],
  coding:["coding","coding_2","coding_3"],
  building:["building","building_2","building_3"],
  reading:["reading","reading_2","reading_3"],
  searching:["searching","searching_2","searching_3"]
};

/** Emotions that assert work is still happening, so a finished task must replace them. */
export const ACTIVITY_EMOTIONS=new Set(Object.values(ACTIVITY_VARIANTS).flat());
export const isTerminalEmotion=(requested:string)=>requested==="done"||requested==="disappointed";
/** Faces that report an outcome, and therefore claim the task is over. */
export const OUTCOME_EMOTIONS=new Set(["happy","proud","disappointed"]);
export function providerEmotionWins(current:Record<string,any>,incomingTask:string,incomingStartedAt:number,lifecycle:"start"|"update"="update",incomingEmotion=""){
  if(lifecycle==="start"||!incomingTask||!current.taskId||String(current.taskId)===incomingTask)return true;
  // Newest-task-wins decides which *running* task speaks for the provider. A
  // task that already reported its outcome is not running, so it must not hold
  // "완료" on the shared avatar while an older task is still working: that is
  // the state the session badge then contradicts. Outcome-vs-outcome keeps the
  // start-order rule so a late finisher cannot be undone by an earlier one.
  if(OUTCOME_EMOTIONS.has(String(current.emotion??""))&&!OUTCOME_EMOTIONS.has(incomingEmotion))return true;
  const currentStartedAt=Number(current.taskStartedAt)||0;
  return !currentStartedAt||Boolean(incomingStartedAt&&incomingStartedAt>currentStartedAt);
}

export function claudeEmotionForTool(name:string){
  if(name==="Bash")return"building";
  if(["Edit","MultiEdit","Write","NotebookEdit"].includes(name))return"coding";
  if(["Read","NotebookRead","Glob","Grep","WebFetch","WebSearch"].includes(name))return"reading";
  if(name==="Agent"||name==="Task")return"searching";
  return null;
}

export function codexEmotionForItem(item:any){
  if(item?.type==="commandExecution")return"building";
  if(item?.type==="fileChange")return"coding";
  if(item?.type==="collabAgentToolCall"||item?.type==="subAgentActivity")return"searching";
  if(["webSearch","imageView","dynamicToolCall","mcpToolCall"].includes(item?.type))return"reading";
  return null;
}

export function beginWorkerEmotion(root:string,provider:Provider,prompt:string,sessionId:string|null){
  const appRoot=process.env.CLAUDEX_WORKHOUSE_APP_ROOT??root,script=path.join(appRoot,"hooks","emotion","set-emotion.mjs");
  if(fs.existsSync(script)){
    const result=spawnSync(process.execPath,[script,provider,provider==="claude"?"prompt":"auto"],{
      input:JSON.stringify({prompt,session_id:sessionId??"",task_id:process.env.CLAUDEX_WORKHOUSE_CURRENT_TASK_ID??"",task_started_at:workerTaskStartedAt,lifecycle:"start"}),encoding:"utf8",shell:false,windowsHide:true,timeout:3000,
      env:{...process.env,CLAUDEX_WORKHOUSE_ROOT:root,CLAUDEX_WORKHOUSE_APP_ROOT:appRoot,CLAUDEX_WORKHOUSE_DATA_ROOT:root},stdio:["pipe","ignore","ignore"]
    });
    if(!result.error&&result.status===0)return;
  }
  updateWorkerEmotion(root,provider,"thinking",sessionId);
}

export function updateWorkerEmotion(root:string,provider:Provider,requested:string,sessionId:string|null,random:()=>number=Math.random){
  const dataDir=path.join(root,"data","emotion");
  fs.mkdirSync(dataDir,{recursive:true,mode:0o700});
  let current:Record<string,any>={};
  try{current=JSON.parse(fs.readFileSync(emotionStateFile(dataDir,provider),"utf8"));}catch{}
  const incomingSession=String(sessionId??"").slice(0,100),incomingTask=String(process.env.CLAUDEX_WORKHOUSE_CURRENT_TASK_ID??"").slice(0,160),sameTask=!incomingTask||!current.taskId||String(current.taskId)===incomingTask,sameSession=sameTask&&(!incomingSession||!current.sessionId||String(current.sessionId)===incomingSession);
  const catchSource=provider==="claude"?"mcp":provider==="codex"?"codex-catch":`${provider}-catch`;
  // A hold keeps a requested expression (chu, love, ...) on screen through the
  // progress churn of a turn, and an outcome must not cut that short. But when
  // the hold is sitting on an activity emotion, swallowing the outcome strands
  // the avatar mid-work: a Gemini task that failed inside its window stayed on
  // "조사 중" indefinitely, because nothing writes to a dead task afterwards.
  if(!(isTerminalEmotion(requested)&&ACTIVITY_EMOTIONS.has(String(current.emotion??"")))){
    if(sameSession&&Number(current.holdUntil??0)>Date.now()&&String(current.source??"")===catchSource)return;
    const protectedMcpSource=provider==="claude"?"mcp":`mcp-${provider}`;
    if(sameSession&&Number(current.holdUntil??0)>Date.now()&&String(current.source??"")===protectedMcpSource)return;
    // Compatibility for state written before non-Codex MCP calls gained an
    // explicit hold window. New writes use holdUntil for every provider.
    if(provider!=="codex"&&sameSession&&String(current.source??"")===protectedMcpSource&&Date.now()-Number(current.timestamp??0)<5000)return;
  }
  const outfit=String(current.outfit??defaultOutfit[provider]).replace(/[^a-zA-Z0-9_-]/g,"")||defaultOutfit[provider];
  const choices=ACTIVITY_VARIANTS[requested]??[requested];
  const alternatives=choices.filter(emotion=>emotion!==current.emotion),pool=alternatives.length?alternatives:choices;
  const selected=pool[Math.min(pool.length-1,Math.max(0,Math.floor(random()*pool.length)))]??requested;
  // Pick between the two completion faces by coin flip. This used to alternate
  // off current.emotion, which at completion is always this task's own last
  // activity emotion, so every completion read as the first one and "happy"
  // never appeared at all.
  const emotion=requested==="done"?(random()<0.5?"proud":"happy"):selected;
  const[mappedLine="",statusLine=""]=COPY[emotion]??["",""];
  // The panel translates lineKey/statusKey; the literal text stays for the VS Code
  // panel and any older reader of the emotion state file.
  const keys=Object.hasOwn(COPY,emotion)?{lineKey:`avatar.line.${emotion}`,statusKey:`avatar.status.${emotion}`}:{};
  const next={emotion,line:mappedLine,statusLine,...keys,outfit,source:`${provider}-worker`,sessionId:incomingSession||(sameTask?String(current.sessionId??"").slice(0,100):""),taskId:incomingTask||String(current.taskId??"").slice(0,160),taskStartedAt:workerTaskStartedAt,timestamp:Date.now()};
  writeEmotionState(dataDir,provider,next,latest=>providerEmotionWins(latest,next.taskId,workerTaskStartedAt,"update",emotion));
}
