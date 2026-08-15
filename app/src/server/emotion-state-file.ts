import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// One provider's emotion lives in two places: the global file every avatar of
// that provider falls back to, and a task-scoped copy that a task avatar reads
// directly. The global file is contested between concurrent tasks; the
// task-scoped copy never is.
export const EMOTION_STATE_FILES:Record<string,string>={claude:"state.json",codex:"codex-state.json",deepseek:"deepseek-state.json",ollama:"ollama-state.json",antigravity:"antigravity-state.json",grok:"grok-state.json"};

export const EMOTION_COPY:Record<string,[string,string]>={
  thinking:["음... 생각 중이에요","생각 중."],
  thinking_2:["뭔가 떠오를 것 같은데...","생각 중.."],
  thinking_3:["으음... 이건 좀 고민되네요","생각 중..."],
  coding:["코드 수정 중이에요","코딩 중."],
  coding_2:["열심히 쓰는 중...!","코딩 중.."],
  coding_3:["수정 사항을 다시 확인 중이에요","코딩 중..."],
  building:["명령을 실행 중이에요","실행 중."],
  building_2:["결과를 기다리는 중...","실행 중.."],
  building_3:["출력을 확인하고 있어요","실행 중..."],
  reading:["꼼꼼히 읽는 중이에요","읽는 중."],
  reading_2:["자료를 살펴보고 있어요","읽는 중.."],
  reading_3:["관련 내용을 확인 중이에요","읽는 중..."],
  searching:["어디 있을까...?","조사 중."],
  searching_2:["관련 위치를 찾는 중이에요","조사 중.."],
  searching_3:["조금 더 확인해 볼게요","조사 중..."],
  happy:["다 됐어요","완료!"],
  proud:["해냈어요!","완료!"],
  disappointed:["아쉬워요...","실패"],
  neutral:["",""]
};

export function emotionStateFile(dataDir:string,provider:string){return path.join(dataDir,EMOTION_STATE_FILES[provider]??EMOTION_STATE_FILES.claude);}
export function readEmotionState(dataDir:string,provider:string):Record<string,any>{
  try{return JSON.parse(fs.readFileSync(emotionStateFile(dataDir,provider),"utf8"));}catch{return{};}
}

/** Writes the task-scoped copy always, and the global file only when
 * `decidePublish` accepts the state currently on disk. Both replacements are
 * atomic renames taken under the shared directory lock. */
export function writeEmotionState(dataDir:string,provider:string,next:Record<string,unknown>,decidePublish:(latest:Record<string,any>)=>boolean){
  const stateFile=emotionStateFile(dataDir,provider),lockDir=`${stateFile}.lock`;
  fs.mkdirSync(dataDir,{recursive:true,mode:0o700});
  for(let attempt=0;;attempt++){
    try{fs.mkdirSync(lockDir);break;}catch{
      try{if(Date.now()-fs.statSync(lockDir).mtimeMs>5000)fs.rmSync(lockDir,{recursive:true,force:true});}catch{/* Retry. */}
      if(attempt>=100)return false;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,25);
    }
  }
  try{
    let latest:Record<string,any>={};try{latest=JSON.parse(fs.readFileSync(stateFile,"utf8"));}catch{/* start fresh */}
    const payload=`${JSON.stringify(next)}\n`;
    if(decidePublish(latest)){const temporary=`${stateFile}.${process.pid}.tmp`;fs.writeFileSync(temporary,payload,{encoding:"utf8",mode:0o600});fs.renameSync(temporary,stateFile);}
    const taskId=String(next.taskId??"");
    if(taskId){
      const directory=path.join(dataDir,"tasks",provider),file=path.join(directory,`${crypto.createHash("sha256").update(taskId).digest("hex")}.json`),taskTemporary=`${file}.${process.pid}.tmp`;
      fs.mkdirSync(directory,{recursive:true,mode:0o700});fs.writeFileSync(taskTemporary,payload,{encoding:"utf8",mode:0o600});fs.renameSync(taskTemporary,file);
    }
    return true;
  }finally{fs.rmSync(lockDir,{recursive:true,force:true});}
}
