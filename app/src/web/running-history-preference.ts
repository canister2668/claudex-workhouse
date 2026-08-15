export type RunningHistoryProvider="codex"|"claude"|"deepseek"|"ollama"|"antigravity"|"grok";
export type RunningHistoryStorage=Pick<Storage,"getItem"|"setItem">;

const PREFIX="deck-show-running-history:v2";

export function runningHistoryPreferenceKey(provider:RunningHistoryProvider,sessionId:string){
  return`${PREFIX}:${provider}:${encodeURIComponent(sessionId)}`;
}

export function readRunningHistoryPreference(storage:RunningHistoryStorage,provider:RunningHistoryProvider,sessionId:string){
  return storage.getItem(runningHistoryPreferenceKey(provider,sessionId))==="1";
}

export function writeRunningHistoryPreference(storage:RunningHistoryStorage,provider:RunningHistoryProvider,sessionId:string,value:boolean){
  storage.setItem(runningHistoryPreferenceKey(provider,sessionId),value?"1":"0");
}
