import {describe,it,expect,vi} from "vitest";
import {geminiCompression} from "../../src/server/gemini-cli-wire";
describe("optional automatic Gemini compression",()=>{
 const options=()=>({chat:{history:["original"]},force:false,tokens:108363,limit:1_000_000,noop:0,now:1000});
 it("preserves history and accounting and backs off for ten minutes",async()=>{
  const opts=options(),before=JSON.stringify(opts.chat),operation=vi.fn().mockRejectedValue(new Error("Failed to generate content: Resource exhausted. Please try again later."));
  expect(await geminiCompression(operation,opts)).toEqual({newHistory:null,info:{originalTokenCount:108363,newTokenCount:108363,compressionStatus:0}});
  expect(JSON.stringify(opts.chat)).toBe(before);
  await geminiCompression(operation,{...opts,now:600999});expect(operation).toHaveBeenCalledTimes(1);
  await geminiCompression(operation,{...opts,now:601000});expect(operation).toHaveBeenCalledTimes(2);
 });
 it.each([{force:true},{tokens:800000},{tokens:0},{tokens:NaN},{signal:AbortSignal.abort()}])("propagates quota when unsafe: %j",async override=>{
  const error=Object.assign(new Error("quota"),{status:429});
  await expect(geminiCompression(()=>Promise.reject(error),{...options(),...override})).rejects.toBe(error);
 });
 it("propagates non-quota errors and abort during compression",async()=>{
  const opts=options(),error=new Error("invalid credentials");
  await expect(geminiCompression(()=>Promise.reject(error),opts)).rejects.toBe(error);
  const controller=new AbortController(),quota=Object.assign(new Error("quota"),{code:429});
  await expect(geminiCompression(async()=>{controller.abort();throw quota;},{...opts,signal:controller.signal})).rejects.toBe(quota);
 });
 it("never applies cooldown to forced or near-window compression",async()=>{
  const opts=options(),error=Object.assign(new Error("quota"),{status:429}),operation=vi.fn().mockRejectedValue(error);
  await geminiCompression(operation,opts);
  await expect(geminiCompression(operation,{...opts,force:true})).rejects.toBe(error);
  await expect(geminiCompression(operation,{...opts,tokens:900000})).rejects.toBe(error);
  expect(operation).toHaveBeenCalledTimes(3);
 });
 it("defers the logged compression fetch failure without changing history or repeating the request",async()=>{
  const opts={...options(),tokens:380689},before=JSON.stringify(opts.chat);
  const operation=vi.fn().mockRejectedValue(new Error("Failed to generate content: exception TypeError: fetch failed sending request"));
  const result=await geminiCompression(operation,opts);
  expect(result).toEqual({newHistory:null,info:{originalTokenCount:380689,newTokenCount:380689,compressionStatus:0}});
  await geminiCompression(operation,opts);
  expect(operation).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(opts.chat)).toBe(before);
 });
 it.each([{force:true},{tokens:800000},{tokens:0},{signal:AbortSignal.abort()}])("propagates fetch failures when deferral is unsafe: %j",async override=>{
  const error=new Error("exception TypeError: fetch failed sending request");
  await expect(geminiCompression(()=>Promise.reject(error),{...options(),...override})).rejects.toBe(error);
 });
 it("does not swallow an AbortError containing fetch failure text",async()=>{
  const error=Object.assign(new Error("fetch failed"),{name:"AbortError"});
  await expect(geminiCompression(()=>Promise.reject(error),options())).rejects.toBe(error);
 });
 it("preserves successful native results",async()=>{
  const result={newHistory:["summary"],info:{compressionStatus:1}};
  expect(await geminiCompression(()=>Promise.resolve(result),options())).toBe(result);
 });
});
