import {AsyncLocalStorage} from "node:async_hooks";

export type GeminiFailure={kind:"cancelled"|"quota"|"network"|"server"|"invalid_stream"|"safety"|"request"|"unknown";retryable:boolean;status?:number;networkCode?:string};
const networkCodes=new Set(["ECONNRESET","ECONNREFUSED","EPIPE","ETIMEDOUT","ENOTFOUND","EAI_AGAIN","EPROTO","UND_ERR_SOCKET","UND_ERR_CONNECT_TIMEOUT","UND_ERR_HEADERS_TIMEOUT","UND_ERR_BODY_TIMEOUT","ERR_STREAM_PREMATURE_CLOSE","ERR_SSL_WRONG_VERSION_NUMBER","CERT_HAS_EXPIRED","DEPTH_ZERO_SELF_SIGNED_CERT","UNABLE_TO_VERIFY_LEAF_SIGNATURE"]);
/** One policy for native structured exceptions and older CLI string envelopes.
 * Walk causes without serializing them: messages can contain URLs or credentials. */
export function classifyGeminiFailure(error:unknown):GeminiFailure{
  const seen=new Set<unknown>(),queue=[error];let status:number|undefined,networkCode:string|undefined,cancelled=false;
  for(let depth=0;queue.length&&depth<12;depth++){
    const current=queue.shift();if(!current||typeof current!=="object"||seen.has(current))continue;seen.add(current);
    const value=current as Record<string,unknown>;
    if(value.name==="AbortError")cancelled=true;
    const candidate=value.status??value.code;
    if(typeof candidate==="number"&&candidate>=400&&candidate<=599)status??=candidate;
    if(typeof value.code==="string"&&networkCodes.has(value.code))networkCode??=value.code;
    if(value.cause)queue.push(value.cause);
    if(Array.isArray(value.errors))queue.push(...value.errors.slice(0,6));
  }
  const message=typeof error==="string"?error:error instanceof Error?error.message:"";
  if(cancelled||/GEMINI_CLI_CANCELLED/.test(message))return{kind:"cancelled",retryable:false};
  if(status===429)return{kind:"quota",retryable:true,status};
  if(status&&status>=500)return{kind:"server",retryable:true,status};
  if(status)return{kind:"request",retryable:false,status};
  if(networkCode)return{kind:"network",retryable:!new Set(["CERT_HAS_EXPIRED","DEPTH_ZERO_SELF_SIGNED_CERT","UNABLE_TO_VERIFY_LEAF_SIGNATURE"]).has(networkCode),networkCode};
  if(/safety_blocked|response was blocked due to safety|model stream ended due to safety/i.test(message))return{kind:"safety",retryable:false};
  if(/invalid.?stream|no_finish_reason|no_response_text|no response text|empty response (?:text|with no text)|model stream ended without a finish reason/i.test(message))return{kind:"invalid_stream",retryable:false};
  if(/\bfetch failed\b/i.test(message))return{kind:"network",retryable:true};
  if(/VERTEX_QUOTA_EXHAUSTED|\bRESOURCE_EXHAUSTED\b|\bResource (?:has been )?exhausted\b|\bstatus\s*429\b/i.test(message))return{kind:"quota",retryable:true};
  return{kind:"unknown",retryable:false};
}

export type GeminiRequestDiagnostic={phase:"compression"|"generation"|"other";outcome:"response"|"failure";durationMs:number;status?:number;failure?:GeminiFailure};
const phase=new AsyncLocalStorage<"compression">();
let observer:((diagnostic:GeminiRequestDiagnostic)=>void)|undefined;
export function observeGeminiRequests(next:typeof observer){observer=next;}
export function inGeminiCompression<T>(operation:()=>Promise<T>){return phase.run("compression",operation);}
/** This is the SDK transport boundary, before its old catch discarded cause.
 * Retry ownership stays in the CLI; this layer never replays a request. */
export async function geminiApiCall(url:string,init:RequestInit,fetcher:typeof fetch=fetch):Promise<Response>{
  const started=Date.now(),requestPhase=phase.getStore()??(/:streamGenerateContent|:generateContent/.test(url)?"generation":"other");
  const report=(value:Omit<GeminiRequestDiagnostic,"phase"|"durationMs">)=>{
    try{observer?.({phase:requestPhase,durationMs:Date.now()-started,...value});}catch{/* diagnostics cannot fail the request */}
  };
  try{
    const response=await fetcher(url,init);
    report(response.ok?{outcome:"response",status:response.status}:{outcome:"failure",status:response.status,failure:classifyGeminiFailure({status:response.status})});
    return response;
  }catch(error){
    report({outcome:"failure",failure:classifyGeminiFailure(error)});
    throw error; // Preserve identity, cause, abort semantics, and native retry decisions.
  }
}

/** Treat child events as untrusted; persist only the diagnostic schema. */
export function parseGeminiRequestDiagnostic(input:unknown):GeminiRequestDiagnostic|null{
  if(!input||typeof input!=="object")return null;
  const value=input as Record<string,any>;
  if(!["compression","generation","other"].includes(value.phase)||!["response","failure"].includes(value.outcome)||!Number.isFinite(value.durationMs)||value.durationMs<0)return null;
  const result:GeminiRequestDiagnostic={phase:value.phase,outcome:value.outcome,durationMs:value.durationMs};
  if(Number.isInteger(value.status)&&value.status>=100&&value.status<=599)result.status=value.status;
  if(value.failure&&["cancelled","quota","network","server","invalid_stream","safety","request","unknown"].includes(value.failure.kind)){
    result.failure={kind:value.failure.kind,retryable:value.failure.retryable===true};
    if(Number.isInteger(value.failure.status)&&value.failure.status>=400&&value.failure.status<=599)result.failure.status=value.failure.status;
    if(networkCodes.has(value.failure.networkCode))result.failure.networkCode=value.failure.networkCode;
  }
  return result;
}
