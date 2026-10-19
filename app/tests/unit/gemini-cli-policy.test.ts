import {afterEach,describe,it,expect} from "vitest";
import {classifyGeminiFailure,geminiApiCall,inGeminiCompression,observeGeminiRequests,parseGeminiRequestDiagnostic} from "../../src/server/gemini-cli-policy";
afterEach(()=>observeGeminiRequests(undefined));
describe("Gemini request policy",()=>{
 it.each(["ECONNRESET","EAI_AGAIN","UND_ERR_SOCKET","UND_ERR_CONNECT_TIMEOUT"])("retains structured %s and exception identity",async code=>{
  const cause=Object.assign(new Error("private hostname and credential"),{code}),error=new TypeError("fetch failed",{cause}),events:any[]=[];
  observeGeminiRequests(event=>events.push(event));
  await expect(geminiApiCall("https://private.test:443/v1/models/model:generateContent?key=secret",{headers:{Authorization:"secret"},body:"private prompt"},async()=>{throw error;})).rejects.toBe(error);
  expect(classifyGeminiFailure(error)).toEqual({kind:"network",retryable:true,networkCode:code});
  expect(events[0]).toMatchObject({phase:"generation",outcome:"failure",failure:{networkCode:code}});
  expect(JSON.stringify(events)).not.toMatch(/secret|private|credential|hostname/);
 });
 it("distinguishes cancellation, permanent TLS, quota, server and request errors",()=>{
  expect(classifyGeminiFailure(Object.assign(new Error("fetch failed"),{name:"AbortError"}))).toEqual({kind:"cancelled",retryable:false});
  expect(classifyGeminiFailure(new TypeError("fetch failed",{cause:{code:"CERT_HAS_EXPIRED"}}))).toEqual({kind:"network",retryable:false,networkCode:"CERT_HAS_EXPIRED"});
  expect(classifyGeminiFailure({status:429})).toEqual({kind:"quota",retryable:true,status:429});
  expect(classifyGeminiFailure({status:503}).kind).toBe("server");
  expect(classifyGeminiFailure({status:400}).retryable).toBe(false);
  expect(classifyGeminiFailure(new Error("The model returned an empty response with no text or thoughts.")).kind).toBe("invalid_stream");
 });
 it("separates concurrent compression and generation, preserving the response body",async()=>{
  const events:any[]=[];observeGeminiRequests(event=>events.push(event));
  const compression=await inGeminiCompression(()=>geminiApiCall("https://fixture/model:generateContent",{},async()=>new Response("quota",{status:429})));
  const response=await geminiApiCall("https://fixture/model:streamGenerateContent",{},async()=>new Response("data: original\n\n"));
  expect(await compression.text()).toBe("quota");expect(await response.text()).toBe("data: original\n\n");
  expect(events.map(event=>[event.phase,event.outcome,event.status])).toEqual([["compression","failure",429],["generation","response",200]]);
 });
 it("handles cyclic and aggregate causes without logging arbitrary fields",()=>{
  const error:any={cause:null};error.cause=error;error.errors=[{code:"ETIMEDOUT"}];
  expect(classifyGeminiFailure(error).networkCode).toBe("ETIMEDOUT");
  expect(parseGeminiRequestDiagnostic({phase:"generation",outcome:"failure",durationMs:2,url:"secret",failure:{kind:"network",retryable:true,networkCode:"TOKEN=secret",message:"secret"}})).toEqual({phase:"generation",outcome:"failure",durationMs:2,failure:{kind:"network",retryable:true}});
 });
});
