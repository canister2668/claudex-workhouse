#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { matchEmotion } from "./emotion-match.mjs";

const OUTCOME_EMOTIONS=new Set(["happy","proud","disappointed"]);
const ACTIVITY_EMOTIONS=new Set(["thinking","thinking_2","thinking_3","coding","coding_2","coding_3","building","building_2","building_3","reading","reading_2","reading_3","searching","searching_2","searching_3","execute"]);
const providers=new Set(["claude","codex","deepseek","ollama","antigravity","grok"]);
const provider=providers.has(process.argv[2])?process.argv[2]:"claude";
const stateNames={claude:"state.json",codex:"codex-state.json",deepseek:"deepseek-state.json",ollama:"ollama-state.json",antigravity:"antigravity-state.json",grok:"grok-state.json"};
const defaultOutfits={claude:"normal",codex:"Gpt-Codex",deepseek:"DeepSeek",ollama:"Ollama",antigravity:"Antigravity",grok:"Grok"};
const catchSource=provider==="claude"?"mcp":provider==="codex"?"codex-catch":`${provider}-catch`;
const hookSource=provider==="claude"?"hook":provider==="codex"?"codex-hook":`${provider}-hook`;
let requested=String(process.argv[3]??"neutral").replace(/[^a-zA-Z0-9_-]/g,"")||"neutral";
const suppliedStatus=String(process.argv[4]??"");
const suppliedLine=String(process.argv[5]??"");
const fallbackRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const appRoot=process.env.CLAUDEX_WORKHOUSE_APP_ROOT||process.env.CLAUDEX_WORKHOUSE_ROOT||fallbackRoot;
const dataRoot=process.env.CLAUDEX_WORKHOUSE_DATA_ROOT||process.env.CLAUDEX_WORKHOUSE_ROOT||appRoot;
const dataDir=path.join(dataRoot,"data","emotion"),assetsRoot=path.join(appRoot,"app","public","emoticons");
const stateFile=path.join(dataDir,stateNames[provider]);
const modeFile=path.join(dataDir,"emotion-mode");
fs.mkdirSync(dataDir,{recursive:true,mode:0o700});

let input={};
try{input=JSON.parse(fs.readFileSync(0,"utf8"));}catch{/* Manual calls and some hooks have no JSON input. */}
let current={};
try{current=JSON.parse(fs.readFileSync(stateFile,"utf8"));}catch{/* First run. */}

const prompt=String(input.prompt??input.user_prompt??input.message??"");
const inputSession=String(input.session_id??"").slice(0,100);
const inputTask=String(input.task_id??process.env.CLAUDEX_WORKHOUSE_CURRENT_TASK_ID??"").slice(0,160);
const taskStartedAt=Number(input.task_started_at??process.env.CLAUDEX_WORKHOUSE_TASK_STARTED_AT)||Date.now();
const lifecycle=input.lifecycle==="start"?"start":"update";
const sameTask=!inputTask||!current.taskId||String(current.taskId)===inputTask;
const sameSession=sameTask&&(!inputSession||!current.sessionId||String(current.sessionId)===inputSession);
let explicit=null;
// A valid MCP hold keeps a requested expression (chu, love, ...) on screen
// through the progress churn of a turn. Auto/prompt activity emotions must not
// clobber it; mirror worker-emotion.ts. An outcome that lands on an activity
// emotion still overrides, so a dead task doesn't strand the avatar mid-work.
const holdActive=(provider==="codex"&&sameSession&&Number(current.holdUntil??0)>Date.now()&&["codex-catch","mcp-codex"].includes(String(current.source??"")))
  ||(provider==="claude"&&sameSession&&String(current.source??"")==="mcp"&&Date.now()-Number(current.timestamp??0)<5000)
  ||(provider!=="claude"&&provider!=="codex"&&sameSession&&Number(current.holdUntil??0)>Date.now()&&String(current.source??"")===`mcp-${provider}`);
if((requested==="auto"||requested==="prompt")&&holdActive){
  process.exit(0);
}else if(requested==="auto"||requested==="prompt"){
  let mode="mcp";try{mode=fs.readFileSync(modeFile,"utf8").trim();}catch{/* default */}
  explicit=mode==="catch"?matchEmotion(prompt):null;
  requested=explicit?.emotion??"thinking";
}else if((requested==="done"||requested==="disappointed")&&ACTIVITY_EMOTIONS.has(String(current.emotion??""))){
  // An outcome replaces a held activity emotion rather than being swallowed by
  // it, which would strand the avatar mid-work; see worker-emotion.ts.
}else if(holdActive){
  process.exit(0);
}

const outfit=String(current.outfit??defaultOutfits[provider]).replace(/[^a-zA-Z0-9_-]/g,"")||defaultOutfits[provider];
const assetDir=path.join(assetsRoot,fs.existsSync(path.join(assetsRoot,outfit))?outfit:provider==="codex"?"Gpt-Codex":"normal");
const prefix=provider==="codex"?`${outfit}_`:"";
function variants(base){
  try{
    const pattern=new RegExp(`^${prefix.replace(/[.*+?^${}()|[\\]\\\\]/g,"\\\\$&")}${base.replace(/[.*+?^${}()|[\\]\\\\]/g,"\\\\$&")}(?:_[0-9]+)?\\.(?:webp|png|gif)$`,"i");
    const values=fs.readdirSync(assetDir).filter(name=>pattern.test(name)).map(name=>name.slice(prefix.length).replace(/\.(?:webp|png|gif)$/i,""));
    return values.length?values:[base];
  }catch{return[base];}
}
const choices=requested==="done"?["happy","proud"]:(explicit?[requested]:variants(requested));
const alternatives=choices.filter(value=>value!==current.emotion),pool=alternatives.length?alternatives:choices;
const emotion=pool[Math.floor(Math.random()*pool.length)]||(requested==="done"?"happy":requested);
const copy={
  thinking:["음... 생각 중이에요","생각 중."],thinking_2:["뭔가 떠오를 것 같은데...","생각 중.."],thinking_3:["으음... 이건 좀 고민되네요","생각 중..."],
  coding:["코드 수정 중이에요","코딩 중."],coding_2:["열심히 쓰는 중...!","코딩 중.."],coding_3:["수정 사항을 다시 확인 중이에요","코딩 중..."],
  building:["명령을 실행 중이에요","실행 중."],building_2:["결과를 기다리는 중...","실행 중.."],building_3:["출력을 확인하고 있어요","실행 중..."],
  reading:["꼼꼼히 읽는 중이에요","읽는 중."],reading_2:["자료를 살펴보고 있어요","읽는 중.."],reading_3:["관련 내용을 확인 중이에요","읽는 중..."],
  searching:["어디 있을까...?","조사 중."],searching_2:["관련 위치를 찾는 중이에요","조사 중.."],searching_3:["조금 더 확인해 볼게요","조사 중..."],
  happy:["다 됐어요","완료!"],proud:["해냈어요!","완료!"],neutral:["",""]
};
const [mappedLine="",mappedStatus=""]=copy[emotion]??["",""];
// Canned copy travels as a translation key so the panel renders it in the user's
// UI language. Caller-supplied text is passed through untranslated on purpose.
const useMapped=!explicit&&!suppliedLine&&Object.hasOwn(copy,emotion);
const next={
  emotion,line:explicit?.line??(suppliedLine||mappedLine),statusLine:explicit?"":(suppliedStatus||mappedStatus),
  ...(explicit?.lineKey?{lineKey:explicit.lineKey}:useMapped?{lineKey:`avatar.line.${emotion}`}:{}),
  ...(!explicit&&!suppliedStatus&&Object.hasOwn(copy,emotion)?{statusKey:`avatar.status.${emotion}`}:{}),
  outfit,source:explicit?catchSource:hookSource,
  sessionId:inputSession||(sameTask?String(current.sessionId??"").slice(0,100):""),taskId:inputTask||String(current.taskId??"").slice(0,160),taskStartedAt,timestamp:Date.now(),
  ...(explicit?{holdUntil:Date.now()+120000}:{})
};

const lockDir=`${stateFile}.lock`;
for(let attempt=0;;attempt++){
  try{fs.mkdirSync(lockDir);break;}catch(error){
    try{if(Date.now()-fs.statSync(lockDir).mtimeMs>5000)fs.rmSync(lockDir,{recursive:true,force:true});}catch{/* Retry. */}
    if(attempt>=100)process.exit(1);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,25);
  }
}
try{
  let latest={};try{latest=JSON.parse(fs.readFileSync(stateFile,"utf8"));}catch{/* start fresh */}
  const latestStartedAt=Number(latest.taskStartedAt)||0;
  // Mirror providerEmotionWins in worker-emotion.ts: a task that already reported
  // an outcome stops speaking for the provider, so an older task that is still
  // working can take the shared avatar back from its "완료".
  const latestFinished=OUTCOME_EMOTIONS.has(String(latest.emotion??""))&&!OUTCOME_EMOTIONS.has(emotion);
  const publishGlobal=lifecycle==="start"||!next.taskId||!latest.taskId||String(latest.taskId)===next.taskId||latestFinished||!latestStartedAt||Boolean(taskStartedAt&&taskStartedAt>latestStartedAt);
  const temporary=`${stateFile}.${process.pid}.tmp`;
  if(publishGlobal){fs.writeFileSync(temporary,`${JSON.stringify(next)}\n`,{encoding:"utf8",mode:0o600});fs.renameSync(temporary,stateFile);}
  if(next.taskId){const directory=path.join(dataDir,"tasks",provider),file=path.join(directory,`${crypto.createHash("sha256").update(next.taskId).digest("hex")}.json`),taskTemporary=`${file}.${process.pid}.tmp`;fs.mkdirSync(directory,{recursive:true,mode:0o700});fs.writeFileSync(taskTemporary,`${JSON.stringify(next)}\n`,{encoding:"utf8",mode:0o600});fs.renameSync(taskTemporary,file);}
}finally{fs.rmSync(lockDir,{recursive:true,force:true});}
