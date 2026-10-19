import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawn} from "node:child_process";
import {afterAll,describe,expect,it} from "vitest";

const scratch=fs.mkdtempSync(path.join(os.tmpdir(),"gemini-worker-"));
afterAll(()=>fs.rmSync(scratch,{recursive:true,force:true}));
async function runWorker(source:string,prompt="continue",setup?:(root:string)=>void){
  const root=fs.mkdtempSync(path.join(scratch,"case-"));
  const entry=path.join(root,"fake.cjs"),statePath=path.join(root,"state.json"),called=path.join(root,"called");
  fs.writeFileSync(entry,`require('node:fs').writeFileSync(${JSON.stringify(called)},'yes');\n${source}`);
  setup?.(root);
  const child=spawn(process.execPath,["--import","tsx","src/server/gemini-cli-worker.ts",statePath,"fixture","bundle",entry,"new",root,"fixture-marker",":read-only","fixture-model","default","fixture-session","",prompt],{
    cwd:process.cwd(),env:{...process.env,HOME:root,CLAUDEX_WORKHOUSE_DATA_ROOT:root},stdio:["ignore","pipe","pipe"]
  });
  let stderr="";child.stderr.on("data",chunk=>stderr+=chunk);
  const code=await new Promise<number|null>((resolve,reject)=>{
    const timer=setTimeout(()=>{child.kill("SIGKILL");reject(new Error("worker timeout"));},10000);
    child.once("error",error=>{clearTimeout(timer);reject(error);});
    child.once("close",code=>{clearTimeout(timer);resolve(code);});
  });
  expect(code,stderr).toBe(0);
  return{state:JSON.parse(fs.readFileSync(statePath,"utf8")),called:fs.existsSync(called)};
}

describe("Gemini worker terminal stream handling",()=>{
  it("rejects malformed result status even when the process exits zero",async()=>{
    const {state}=await runWorker(`console.log(JSON.stringify({type:'message',role:'assistant',content:'partial'}));console.log(JSON.stringify({type:'result'}));`);
    expect(state.status).toBe("failed");expect(state.errorCode).toBe("GEMINI_CLI_INVALID_RESULT");
  });
  it("never presents stderr as a successful assistant reply",async()=>{
    const {state}=await runWorker(`console.error('diagnostic only');console.log(JSON.stringify({type:'result',status:'success'}));`);
    expect(state.status).toBe("failed");expect(state.errorCode).toBe("GEMINI_INVALID_STREAM");expect(state.result).toBeNull();
  });
  it("persists safe transport diagnostics and keeps final failure authoritative",async()=>{
    const {state}=await runWorker(`
      console.log(JSON.stringify({type:'workhouse_request',diagnostic:{phase:'generation',outcome:'failure',durationMs:5,url:'secret',failure:{kind:'network',retryable:true,networkCode:'ECONNRESET',message:'secret'}}}));
      console.log(JSON.stringify({type:'error',severity:'error',message:'fetch failed'}));
      console.log(JSON.stringify({type:'result',status:'error'}));
    `);
    expect(state.failureDetails).toMatchObject({kind:"network",networkCode:"ECONNRESET",phase:"generation"});
    expect(JSON.stringify(state.requestDiagnostics)).not.toContain("secret");
  });
  it("does not classify a successful recovery from earlier request diagnostics as failure",async()=>{
    const {state}=await runWorker(`
      console.log(JSON.stringify({type:'workhouse_request',diagnostic:{phase:'generation',outcome:'failure',durationMs:5,status:429,failure:{kind:'quota',retryable:true,status:429}}}));
      console.log(JSON.stringify({type:'workhouse_request',diagnostic:{phase:'generation',outcome:'response',durationMs:5,status:200}}));
      console.log(JSON.stringify({type:'message',role:'assistant',content:'recovered'}));console.log(JSON.stringify({type:'result',status:'success'}));
    `);
    expect(state.status).toBe("completed");expect(state.result).toBe("recovered");expect(state.requestCount).toBe(2);
  });

  it("reports a terminal model-turn rejection separately from earlier quota retries",async()=>{
    const {state}=await runWorker(`
      console.error('Attempt 1 failed with status 429: RESOURCE_EXHAUSTED');
      console.log(JSON.stringify({type:'error',severity:'error',message:'Requests ending with a model turn are not supported.'}));
      console.log(JSON.stringify({type:'result',status:'error'}));
      process.exitCode=1;
    `);
    expect(state.errorCode).toBe("GEMINI_INVALID_TURN");
  });
  it("waits for final stderr after an empty result.error",async()=>{
    const {state}=await runWorker(`
      console.error('Attempt 1 failed with status 429: RESOURCE_EXHAUSTED');
      console.log(JSON.stringify({type:'result',status:'error',error:{}}));
      setTimeout(()=>{console.error('Model stream ended without a finish reason.');process.exitCode=1;},100);
    `);
    expect(state.status).toBe("failed");
    expect(state.errorCode).toBe("GEMINI_CLI_INCOMPLETE_STREAM");
    expect(state.log).toContain("RESOURCE_EXHAUSTED");
  });
  it("prefers the structured terminal error over late stderr and warnings",async()=>{
    const {state}=await runWorker(`
      console.log(JSON.stringify({type:'error',severity:'error',message:'response was blocked due to safety'}));
      console.log(JSON.stringify({type:'error',severity:'warning',message:'temporary warning'}));
      console.log(JSON.stringify({type:'result',status:'error'}));
      setTimeout(()=>{console.error('Attempt 1 failed with status 429: RESOURCE_EXHAUSTED');process.exitCode=1;},100);
    `);
    expect(state.errorCode).toBe("GEMINI_SAFETY_BLOCKED");
  });
  it("reads the final native prompt size without changing cumulative output usage",async()=>{
    const {state}=await runWorker(`console.log(JSON.stringify({type:'result',status:'success',stats:{input_tokens:4721215,total_tokens:4721315,output_tokens:100}}));`,"continue",root=>{
      const chats=path.join(root,".gemini","tmp","fixture","chats");fs.mkdirSync(chats,{recursive:true});
      fs.writeFileSync(path.join(chats,"session-fixture.jsonl"),[{sessionId:"fixture-session",projectHash:"fixture"},{id:"m1",type:"gemini",tokens:{input:190059}}].map(x=>JSON.stringify(x)).join("\n")+"\n");
    });
    expect(state.contextUsage.usedTokens).toBe(190059);expect(state.contextUsage.percent).toBe(19);
    expect(state.outputUsage.inputTokens).toBe(4721215);
  });
  it("compacts locally without launching the CLI or consuming model tokens",async()=>{
    const {state,called}=await runWorker("throw new Error('must not run')","/compact",root=>{
      const chats=path.join(root,".gemini","tmp","fixture","chats");fs.mkdirSync(chats,{recursive:true});
      const messages=Array.from({length:12},(_,i)=>({id:`m${i}`,type:"gemini",content:"kept",toolCalls:[{id:`t${i}`,name:"read_file",args:{path:"file"},result:[{functionResponse:{id:`t${i}`,name:"read_file",response:{output:"x".repeat(6000)}}}]}]}));
      fs.writeFileSync(path.join(chats,"session-fixture.jsonl"),[{sessionId:"fixture-session",projectHash:"fixture"},...messages].map(x=>JSON.stringify(x)).join("\n")+"\n");
    });
    expect(called).toBe(false);expect(state.status).toBe("completed");expect(state.compaction.trimmedOutputs).toBe(4);
    expect(state.contextUsage.usedTokens).toBeNull();expect(fs.existsSync(state.compaction.backup)).toBe(true);
  });
  it("does not turn recovered 429 diagnostics into a failed success",async()=>{
    const {state}=await runWorker(`
      console.error('Attempt 1 failed with status 429: RESOURCE_EXHAUSTED');
      console.log(JSON.stringify({type:'message',role:'assistant',content:'ok'}));
      console.log(JSON.stringify({type:'result',status:'success'}));
    `);
    expect(state.status).toBe("completed");expect(state.result).toBe("ok");
  });
  it("fails missing-transcript compression without launching the CLI",async()=>{
    const {state,called}=await runWorker("throw new Error('must not run')","/compact");
    expect(called).toBe(false);expect(state.errorCode).toBe("GEMINI_COMPACTION_FAILED");
  });
});
