import type {DeckTask,ProviderId} from "./types.js";

// Providers that drive the Claude CLI write their turns into the same session
// transcript, so a Claude mirror of that session belongs to the owning task
// even though the provider ids differ. Every other provider matches only
// itself: two providers that happen to reuse a thread id are not the same
// session and must never be merged.
const CLAUDE_TRANSCRIPT_PROVIDERS:ReadonlySet<string>=new Set<ProviderId>(["claude","deepseek","ollama"]);

export function providerSessionKey(task:Pick<DeckTask,"provider"|"threadId"|"providerSessionId">){
  return task.provider==="claude"?task.providerSessionId??task.threadId:task.threadId??task.providerSessionId;
}

// A Workhouse-owned task is the canonical row for its provider session. The
// native mirror the provider also reports is the same session seen twice and
// must not become a second card.
export function hideOwnedProviderSessionMirrors(tasks:DeckTask[],ownerContext:DeckTask[]=tasks):DeckTask[]{
  const ownedByProvider=new Map<string,Set<string>>(),ownedTranscripts=new Set<string>();
  for(const task of ownerContext){
    if(!task.owned)continue;
    const sessionId=providerSessionKey(task);
    if(!sessionId)continue;
    const bucket=ownedByProvider.get(task.provider)??new Set<string>();
    bucket.add(sessionId);ownedByProvider.set(task.provider,bucket);
    if(CLAUDE_TRANSCRIPT_PROVIDERS.has(task.provider))ownedTranscripts.add(sessionId);
  }
  return tasks.filter(task=>{
    if(task.owned)return true;
    const sessionId=providerSessionKey(task);
    if(!sessionId)return true;
    if(ownedByProvider.get(task.provider)?.has(sessionId))return false;
    return !(task.provider==="claude"&&ownedTranscripts.has(sessionId));
  });
}
