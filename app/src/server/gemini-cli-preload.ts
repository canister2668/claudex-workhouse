import {registerHooks} from "node:module";
const {geminiWireContents,geminiCompression,patchGeminiWireSource}=await import(new URL(import.meta.url.endsWith(".ts")?"./gemini-cli-wire.ts":"./gemini-cli-wire.js",import.meta.url).href);

(globalThis as any)[Symbol.for("workhouse.geminiWireContents")]=geminiWireContents;
(globalThis as any)[Symbol.for("workhouse.geminiCompression")]=geminiCompression;
const {geminiApiCall,observeGeminiRequests,classifyGeminiFailure}=await import(new URL(import.meta.url.endsWith(".ts")?"./gemini-cli-policy.ts":"./gemini-cli-policy.js",import.meta.url).href);
(globalThis as any)[Symbol.for("workhouse.geminiApiCall")]=geminiApiCall;
(globalThis as any)[Symbol.for("workhouse.geminiFailurePolicy")]=classifyGeminiFailure;
observeGeminiRequests((diagnostic:unknown)=>process.stdout.write(JSON.stringify({type:"workhouse_request",diagnostic})+"\n"));
let compatibilityReady=false;
const originalFetch=globalThis.fetch;
globalThis.fetch=(input,init)=>{
  const url=typeof input==="string"?input:input instanceof URL?input.href:input.url;
  if(!compatibilityReady&&/:(?:streamGenerateContent|generateContent|countTokens)(?:[/?#]|$)/.test(url))
    return Promise.reject(new Error("GEMINI_CLI_COMPATIBILITY_UNSUPPORTED: The Gemini request adapter was not loaded; no model request was sent."));
  return originalFetch(input,init);
};
registerHooks({load(url,context,nextLoad){
  const loaded=nextLoad(url,context);
  if(url.includes("/@google/gemini-cli/bundle/")&&loaded.format==="module"&&loaded.source){
    const source=typeof loaded.source==="string"?loaded.source:new TextDecoder().decode(loaded.source);
    const patched=patchGeminiWireSource(source);
    if(patched!==source)compatibilityReady=true;
    return{...loaded,source:patched};
  }
  return loaded;
}});
