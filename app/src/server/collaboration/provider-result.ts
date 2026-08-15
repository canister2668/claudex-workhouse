import type { DeckTask, ProviderId } from "../types.js";

export type ProviderResult = { provider:ProviderId; taskId:string; providerSessionId:string; content:string; status:"completed"; providerMessageId:string|null };
const GENERIC = /^(?:완료(?:됨|했습니다)?|completed|done|success|작업 완료|turn completed; transcript is available from codex)[.!\s]*$/i;

export class ProviderResultAdapter {
  extract(task:DeckTask):ProviderResult {
    if (task.status!=="completed") throw Object.assign(new Error("provider output unavailable"),{code:"PROVIDER_OUTPUT_UNAVAILABLE"});
    const content=String(task.result??"").trim();
    const sessionId=task.providerSessionId??task.threadId;
    if (!sessionId||!content||GENERIC.test(content)) throw Object.assign(new Error("provider output unavailable"),{code:"PROVIDER_OUTPUT_UNAVAILABLE"});
    return {provider:task.provider,taskId:task.id,providerSessionId:sessionId,content,status:"completed",providerMessageId:typeof task.metadata?.finalMessageId==="string"?task.metadata.finalMessageId:null};
  }
}
