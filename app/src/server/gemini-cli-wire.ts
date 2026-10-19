const {classifyGeminiFailure,inGeminiCompression}=await import(new URL(import.meta.url.endsWith(".ts")?"./gemini-cli-policy.ts":"./gemini-cli-policy.js",import.meta.url).href);
type Part=Record<string,any>;
type Content={role?:string;parts?:Part[];[key:string]:any};

const compressionCooldown=new WeakMap<object,number>();
/** Optional automatic summarization must not terminate a healthy conversation
 * on quota or fetch failures. Never modify history or bypass the window guard. */
export async function geminiCompression(operation:()=>Promise<any>,options:{chat:object;force:boolean;signal?:AbortSignal;tokens:number;limit:number;noop:unknown;now?:number}){
  const {chat,force,signal,tokens,limit,noop}=options,now=options.now??Date.now();
  const canDefer=!force&&!signal?.aborted&&Number.isFinite(tokens)&&tokens>0&&Number.isFinite(limit)&&tokens<limit*0.8;
  const unchanged=()=>({newHistory:null,info:{originalTokenCount:tokens,newTokenCount:tokens,compressionStatus:noop}});
  if(canDefer&&(compressionCooldown.get(chat)??0)>now)return unchanged();
  try{return await inGeminiCompression(operation);}
  catch(error){
    const failure=classifyGeminiFailure(error);
    if(!canDefer||signal?.aborted||!failure.retryable||!["quota","network","server"].includes(failure.kind))throw error;
    compressionCooldown.set(chat,now+10*60_000);
    return unchanged();
  }
}

/** Repair the legacy CLI's sibling image representation at the wire boundary.
 * Never edit native history, invent a tool result, or discard image bytes. */
export function geminiWireContents(contents:Content[],model:string):Content[]{
  if(!/^gemini-(?:3|4)(?:[.-]|$)/.test(model))return contents;
  return contents.map(content=>{
    if(content.role!=="user"||!content.parts?.some(part=>part.functionResponse))return content;
    const parts:Part[]=[];let response:Part|undefined;
    for(const part of content.parts){
      if(part.functionResponse){
        response={...part.functionResponse,parts:[...(part.functionResponse.parts??[])]};
        parts.push({...part,functionResponse:response});
      }else if(response&&(part.inlineData||part.fileData)){
        response.parts.push(part);
      }else{
        // Only immediately following media can be assigned unambiguously.
        response=undefined;parts.push(part);
      }
    }
    for(const part of parts)if(part.functionResponse?.parts?.length===0)delete part.functionResponse.parts;
    return{...content,parts};
  });
}

/** Exact, fail-closed compatibility seam for the bundled Gemini CLI. Loaded
 * in memory; the installed package and other running sessions stay untouched. */
export function patchGeminiWireSource(source:string):string{
  if(!source.includes("function stripToolCallIdPrefixes(contents)"))return source;
  const edits=[
    ["let isConnectionPhase = true;","let isConnectionPhase = true; let emittedOutput = false;"],
    ["for await (const chunk of stream2) {\n              yield { type: StreamEventType.CHUNK, value: chunk };","for await (const chunk of stream2) {\n              emittedOutput = true;\n              yield { type: StreamEventType.CHUNK, value: chunk };"],
    ['function isRetryableError(error40, retryFetchErrors) {','function isRetryableError(error40, retryFetchErrors) {\n  const policy = globalThis[Symbol.for("workhouse.geminiFailurePolicy")](error40);\n  if ((policy.kind === "network" && policy.networkCode) || policy.kind === "cancelled") return policy.retryable;'],
    ['return fetch(url3, requestInit).catch((e2) => {\n      throw new Error(`exception ${e2} sending request`);\n    });','return globalThis[Symbol.for("workhouse.geminiApiCall")](url3, requestInit);'],
    ["const { newHistory, info: info2 } = await this.compressionService.compress(this.getChat(), prompt_id, force, model, this.config, this.hasFailedCompressionAttempt, abortSignal);",'const { newHistory, info: info2 } = await globalThis[Symbol.for("workhouse.geminiCompression")](() => this.compressionService.compress(this.getChat(), prompt_id, force, model, this.config, this.hasFailedCompressionAttempt, abortSignal), {chat:this.getChat(),force,signal:abortSignal,tokens:this.getChat().getLastPromptTokenCount(),limit:tokenLimit(model),noop:CompressionStatus.NOOP});'],
    // Keep transport backoff, including HTTP 429, independent of invalid
    // response retries that resend an already accepted full prompt.
    ["if (isRetryableContentError || isRetryable && !signal.aborted) {","if (!isContentError && !emittedOutput && isRetryable && !signal.aborted) {"],
    ["const finalContents = stripToolCallIdPrefixes(contentsToUse);",'const finalContents = globalThis[Symbol.for("workhouse.geminiWireContents")](stripToolCallIdPrefixes(contentsToUse), modelToUse);'],
    ["name: fc.name,\n            args: fc.args,\n            id: fc.id.substring(name3.length + 2)","...fc,\n            id: fc.id.substring(name3.length + 2)"],
    ["name: fr.name,\n            response: fr.response,\n            id: fr.id.substring(name3.length + 2)","...fr,\n            id: fr.id.substring(name3.length + 2)"]
  ];
  for(const [before,after] of edits){
    if(source.split(before).length!==2)throw new Error("GEMINI_CLI_COMPATIBILITY_UNSUPPORTED: Gemini CLI wire format changed; review the Workhouse compatibility adapter before running this version.");
    source=source.replace(before,after);
  }
  return source;
}
