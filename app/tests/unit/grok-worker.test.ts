import {spawn,spawnSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach,describe,expect,it} from "vitest";

const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});

function runWorker(options:{mode?:"new"|"resume"|"fork";permission?:string;automation?:string;events?:unknown[];oldLayout?:boolean;stderr?:string;runtimeProfile?:"default"|"conversation"}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"grok-worker-contract-"));roots.push(root);
  const jobs=path.join(root,"data","grok-jobs"),cwd=path.join(root,"workspace"),statePath=path.join(jobs,"task.json"),argsPath=path.join(root,"args.json"),envPath=path.join(root,"env.json"),fake=path.join(root,"fake-grok.mjs");
  fs.mkdirSync(jobs,{recursive:true});fs.mkdirSync(cwd);
  const events=options.events??[
    {type:"message_start",message:{id:"message-1",model:"grok-4.5"}},
    {type:"content_block_delta",index:0,delta:{type:"text_delta",text:"안녕!"}},
    {type:"message_stop"}
  ];
  fs.writeFileSync(fake,`#!/usr/bin/env node
import fs from "node:fs";
fs.writeFileSync(process.env.GROK_TEST_ARGS,JSON.stringify(process.argv.slice(2)));
fs.writeFileSync(process.env.GROK_TEST_ENV,JSON.stringify({sandbox:process.env.GROK_SANDBOX??null}));
if(${JSON.stringify(options.stderr??"")})process.stderr.write(${JSON.stringify(options.stderr??"")});
for(const event of ${JSON.stringify(events)})console.log(JSON.stringify(event));
`);fs.chmodSync(fake,0o700);
  const worker=path.resolve("dist-server/grok-worker.js"),session="11111111-1111-4111-8111-111111111111",mode=options.mode??"new";
  const workerArgs=[worker,statePath,"grok:test",fake,mode,cwd,"claudex-workhouse-grok:test",options.permission??":read-only","default","default","default",...(options.oldLayout?[]:[options.automation??"read"]),mode==="resume"||mode==="fork"?session:"",session,"hello"];
  const result=spawnSync(process.execPath,workerArgs,{cwd,encoding:"utf8",timeout:15_000,env:{...process.env,GROK_SANDBOX:"inherited-and-must-be-removed",GROK_TEST_ARGS:argsPath,GROK_TEST_ENV:envPath,CLAUDEX_WORKHOUSE_RUNTIME_PROFILE:options.runtimeProfile??"default",CLAUDEX_WORKHOUSE_CURRENT_TASK_ID:"grok:test",CLAUDEX_WORKHOUSE_CURRENT_SESSION_ID:session,CLAUDEX_WORKHOUSE_EMOTION_MCP_URL:"http://127.0.0.1:3410/mcp/grok",CLAUDEX_WORKHOUSE_MANAGED_PROVIDER_MCP_URL:"http://127.0.0.1:3410/mcp/claudex-workhouse",CLAUDEX_WORKHOUSE_MANAGED_PROVIDER_TOKEN:"test-token"}});
  return{result,args:JSON.parse(fs.readFileSync(argsPath,"utf8")),childEnv:JSON.parse(fs.readFileSync(envPath,"utf8")),state:JSON.parse(fs.readFileSync(statePath,"utf8"))};
}

async function runStoppedWorker(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"grok-worker-stop-"));roots.push(root);
  const jobs=path.join(root,"data","grok-jobs"),cwd=path.join(root,"workspace"),statePath=path.join(jobs,"task.json"),readyPath=path.join(root,"ready"),fake=path.join(root,"fake-grok.mjs"),worker=path.resolve("dist-server/grok-worker.js"),session="11111111-1111-4111-8111-111111111111";
  fs.mkdirSync(jobs,{recursive:true});fs.mkdirSync(cwd);fs.writeFileSync(fake,`#!/usr/bin/env node
import fs from "node:fs";
fs.writeFileSync(process.env.GROK_TEST_READY,"ready");
process.on("SIGTERM",()=>{console.log(JSON.stringify({type:"user",message:{content:[{type:"tool_result",is_error:true,content:"User cancelled the execution for tool run_terminal_command"}]}}));console.log(JSON.stringify({type:"result",is_error:true,subtype:"error_during_execution"}));setTimeout(()=>process.exit(1),20);});
setInterval(()=>{},1000);
`);fs.chmodSync(fake,0o700);
  const child=spawn(process.execPath,[worker,statePath,"grok:stop",fake,"resume",cwd,"claudex-workhouse-grok:stop",":workspace-write","default","default","default","auto",session,session,"wait"],{cwd,stdio:"pipe",env:{...process.env,GROK_TEST_READY:readyPath,CLAUDEX_WORKHOUSE_RUNTIME_PROFILE:"default",CLAUDEX_WORKHOUSE_CURRENT_TASK_ID:"grok:stop",CLAUDEX_WORKHOUSE_CURRENT_SESSION_ID:session}});
  const deadline=Date.now()+5000;while(!fs.existsSync(readyPath)){if(Date.now()>deadline)throw new Error("fake Grok did not start");await new Promise(resolve=>setTimeout(resolve,20));}
  child.kill("SIGTERM");
  await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error("worker did not stop")),5000);child.once("exit",()=>{clearTimeout(timer);resolve();});});
  return JSON.parse(fs.readFileSync(statePath,"utf8"));
}


describe("Grok worker CLI contract",()=>{
  it("keeps read-only sessions tool-restricted",()=>{
    const{result,args,state}=runWorker({});
    expect(result.status,result.stderr).toBe(0);
    expect(args).toContain("--single");
    expect(args[args.indexOf("--permission-mode")+1]).toBe("plan");
    expect(args).not.toContain("--sandbox");
    expect(args[args.indexOf("--tools")+1]).toBe("Read,Glob,Grep,WebSearch,WebFetch");
    expect(args).not.toContain("--plugin-dir");
    expect(args.some((value:string)=>value.startsWith("MCPTool("))).toBe(false);
    expect(state).toMatchObject({status:"completed",result:"안녕!",sessionId:"11111111-1111-4111-8111-111111111111"});
  });

  it("uses Grok auto mode instead of an unanswerable approval prompt",()=>{
    const{result,args,childEnv}=runWorker({permission:":workspace-write",automation:"auto"});
    expect(result.status,result.stderr).toBe(0);
    expect(args[args.indexOf("--permission-mode")+1]).toBe("auto");
    expect(args).not.toContain("--sandbox");
    expect(args).not.toContain("--tools");
    expect(args[args.indexOf("--rules")+1]).toContain("- Automation: auto");
    expect(args[args.indexOf("--rules")+1]).toContain("does not enforce an OS filesystem sandbox");
    expect(childEnv.sandbox).toBeNull();
  });

  it("maps explicit full access to bypassPermissions",()=>{const{args}=runWorker({permission:":danger-full-access",automation:"full"});expect(args[args.indexOf("--permission-mode")+1]).toBe("bypassPermissions");expect(args[args.indexOf("--rules")+1]).toContain("explicit full access");});

  it("keeps conversation built-ins restricted while retaining the measured MCP meta-tools",()=>{const{args}=runWorker({runtimeProfile:"conversation"}),tools=args[args.indexOf("--tools")+1],rules=args[args.indexOf("--rules")+1];expect(tools).toBe("search_tool,use_tool");expect(rules).toContain("call set_emotion exactly once");expect(rules).toContain("뽀뽀쪽");expect(rules).toContain("Do not call express_emotion");});

  it("does not let mismatched full metadata upgrade workspace access",()=>{const{args}=runWorker({permission:":workspace-write",automation:"full"});expect(args[args.indexOf("--permission-mode")+1]).toBe("auto");expect(args[args.indexOf("--rules")+1]).toContain("- Automation: auto");});

  it("keeps resume and fork session arguments in their native positions",()=>{
    const resumed=runWorker({mode:"resume"}).args,forked=runWorker({mode:"fork"}).args,session="11111111-1111-4111-8111-111111111111";
    expect(resumed.slice(resumed.indexOf("--resume"),resumed.indexOf("--resume")+2)).toEqual(["--resume",session]);expect(resumed).not.toContain("--session-id");
    expect(forked.slice(forked.indexOf("--resume"),forked.indexOf("--resume")+2)).toEqual(["--resume",session]);expect(forked).toContain("--fork-session");expect(forked.slice(forked.indexOf("--session-id"),forked.indexOf("--session-id")+2)).toEqual(["--session-id",session]);
  });

  it("accepts the pre-automation rolling worker argv layout",()=>{const{args,state}=runWorker({mode:"resume",permission:":workspace-write",oldLayout:true});expect(args[args.indexOf("--single")+1]).toBe("hello");expect(args[args.indexOf("--permission-mode")+1]).toBe("auto");expect(args.slice(args.indexOf("--resume"),args.indexOf("--resume")+2)).toEqual(["--resume","11111111-1111-4111-8111-111111111111"]);expect(state.sessionId).toBe("11111111-1111-4111-8111-111111111111");});

  it("reports an unavailable headless approval instead of a user cancellation",()=>{
    const events=[
      {type:"user",message:{content:[{type:"tool_result",tool_use_id:"call-1",is_error:true,content:"User cancelled the execution for tool `run_terminal_command`"}]}},
      {type:"result",subtype:"error_during_execution",is_error:true}
    ];
    const{result,state}=runWorker({mode:"resume",permission:":workspace-write",automation:"auto",events});
    expect(result.status,result.stderr).toBe(0);
    expect(state).toMatchObject({status:"failed",error:"Grok tool approval was unavailable in the headless session."});
  });

  it("preserves a concrete provider failure when the result omits its message",()=>{const{state}=runWorker({events:[{type:"result",subtype:"error_during_execution",is_error:true}],stderr:"API error (status 429 Too Many Requests): free usage exhausted\n"});expect(state).toMatchObject({status:"failed",error:"API error (status 429 Too Many Requests): free usage exhausted"});});

  it("keeps an actual Workhouse stop distinct from headless approval failure",async()=>{await expect(runStoppedWorker()).resolves.toMatchObject({status:"stopped",error:null});});
});
