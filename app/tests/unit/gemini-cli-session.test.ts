import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterAll,describe,expect,it,vi} from "vitest";
import {compactGeminiSession,geminiSessionInputTokens,lockGeminiSession,parseGeminiSession} from "../../src/server/gemini-cli-session";
const root=fs.mkdtempSync(path.join(os.tmpdir(),"gemini-session-"));
afterAll(()=>fs.rmSync(root,{recursive:true,force:true}));
const header={sessionId:"session-id",projectHash:"project",kind:"main"};
const jsonl=(rows:unknown[])=>rows.map(x=>JSON.stringify(x)).join("\n")+"\n";
const write=(rows:unknown[])=>{const file=path.join(root,`${Math.random()}.jsonl`);fs.writeFileSync(file,jsonl([header,...rows]));return file;};
describe("Gemini native journal",()=>{
  it("replays updates, replacements, rewinds, and per-request tokens",()=>{
    const file=write([{id:"a",type:"gemini",tokens:{input:100}},{id:"a",type:"gemini",tokens:{input:190059}},{id:"b",type:"gemini",tokens:{input:200000}},{$rewindTo:"b"}]);
    expect(geminiSessionInputTokens(file,"session-id")).toBe(190059);
    fs.appendFileSync(file,jsonl([{$set:{messages:[{id:"c",type:"gemini",tokens:{input:140000,total:200000}}]}}]));
    expect(geminiSessionInputTokens(file,"session-id")).toBe(140000);
    expect(parseGeminiSession(fs.readFileSync(file,"utf8"),"session-id").messages).toHaveLength(1);
  });
  it("does not substitute total or stale tokens for unavailable prompt usage",()=>{
    for(const rows of [[{id:"a",type:"gemini",tokens:{total:99}}]])expect(geminiSessionInputTokens(write(rows),"session-id")).toBeNull();
    expect(geminiSessionInputTokens(write([]),"wrong")).toBeNull();
    expect(geminiSessionInputTokens(write([{id:"old",type:"gemini",tokens:{input:190059}},{$set:{messages:[{id:"rebuilt",type:"gemini",content:"restored"}]}}]),"session-id")).toBe(190059);
  });
  it("backs up exact bytes, masks old responses, retains recent turns and identities",()=>{
    const messages=Array.from({length:12},(_,i)=>({id:`m${i}`,type:"gemini",content:"assistant text",tokens:{input:190059},toolCalls:[{id:`t${i}`,name:"read_file",args:{path:"file"},result:[{functionResponse:{id:`t${i}`,name:"read_file",response:{output:"x".repeat(6000)}}}]}]}));
    const file=write(messages),original=fs.readFileSync(file);const result=compactGeminiSession(file,"session-id");
    expect(result.trimmedOutputs).toBe(4);expect(result.afterBytes).toBeLessThan(result.beforeBytes);
    expect(fs.readFileSync(result.backup!)).toEqual(original);
    const compacted=parseGeminiSession(fs.readFileSync(file,"utf8"),"session-id");
    expect(compacted.messages.slice(-8)).toEqual(messages.slice(-8));
    expect(compacted.messages[0].toolCalls[0].result[0].functionResponse.id).toBe("t0");
    expect(compacted.messages[0].content).toBe("assistant text");
    expect(geminiSessionInputTokens(file,"session-id")).toBeNull();
    fs.appendFileSync(file,jsonl([{id:"new",type:"gemini",tokens:{input:12000}}]));
    expect(geminiSessionInputTokens(file,"session-id")).toBe(12000);
    expect(compactGeminiSession(file,"session-id").trimmedOutputs).toBe(1);
  });
  it("does not write malformed, unknown, or wrong-session journals",()=>{
    for(const suffix of ['{broken\n',jsonl([{unknown:true}])]){
      const file=write([]);fs.appendFileSync(file,suffix);const before=fs.readFileSync(file);
      expect(()=>compactGeminiSession(file,"session-id")).toThrow();expect(fs.readFileSync(file)).toEqual(before);
    }
    const file=write([]);expect(()=>compactGeminiSession(file,"other")).toThrow();
    expect(compactGeminiSession(file,"session-id").backup).toBeNull();
  });
  it("preserves a concurrent source edit instead of replacing it",()=>{
    const file=write(Array.from({length:10},(_,i)=>({id:`m${i}`,type:"gemini",toolCalls:[{result:"x".repeat(6000)}]})));
    const original=fs.readFileSync(file),writeFile=fs.writeFileSync;
    const spy=vi.spyOn(fs,"writeFileSync").mockImplementation(((target:any,...args:any[])=>{
      (writeFile as any)(target,...args);
      if(String(target).includes(".workhouse-backup-"))fs.appendFileSync(file,"\n");
    }) as typeof fs.writeFileSync);
    try{expect(()=>compactGeminiSession(file,"session-id")).toThrow(/changed during/);}
    finally{spy.mockRestore();}
    expect(fs.readFileSync(file)).toEqual(Buffer.concat([original,Buffer.from("\n")]));
  });
  it("serializes generation and compaction for a native thread",()=>{
    const release=lockGeminiSession(root,"session-id");expect(()=>lockGeminiSession(root,"session-id")).toThrow(/busy/);
    release();lockGeminiSession(root,"session-id")();
  });
});
