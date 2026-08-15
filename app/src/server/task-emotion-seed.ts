import path from "node:path";
import {EMOTION_COPY,readEmotionState,writeEmotionState} from "./emotion-state-file.js";

export type SeedEmotionProvider="claude"|"codex"|"deepseek"|"ollama"|"antigravity"|"grok";
const defaultOutfit:Record<SeedEmotionProvider,string>={claude:"normal",codex:"Gpt-Sol",deepseek:"DeepSeek",ollama:"Ollama",antigravity:"Antigravity",grok:"Grok"};

// A provider worker needs seconds to boot before it writes its own first
// emotion, and until then a freshly created task owned no state at all. Every
// avatar scoped to it therefore fell back to the previous task's outcome, which
// is the "완료" that flashed at the start of each run before the work emotion
// arrived. Seeding at launch closes that window at the source instead of asking
// the UI to recognise a stale state after the fact.
export function seedTaskEmotion(dataRoot:string,provider:SeedEmotionProvider,taskId:string,sessionId:string|null,startedAt=Date.now()){
  try{
    const dataDir=path.join(dataRoot,"data","emotion"),current=readEmotionState(dataDir,provider);
    const outfit=String(current.outfit??defaultOutfit[provider]).replace(/[^a-zA-Z0-9_-]/g,"")||defaultOutfit[provider];
    const[line,statusLine]=EMOTION_COPY.thinking;
    const next={
      emotion:"thinking",line,statusLine,lineKey:"avatar.line.thinking",statusKey:"avatar.status.thinking",outfit,
      source:`${provider}-start`,sessionId:String(sessionId??"").slice(0,100),taskId:String(taskId).slice(0,160),taskStartedAt:startedAt,timestamp:Date.now()
    };
    // A launch is the newest event this provider has, so it takes the global
    // avatar the same way the worker's own start hook does.
    writeEmotionState(dataDir,provider,next,()=>true);
  }catch{/* The avatar is cosmetic: never fail a launch over it. */}
}
