import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach,describe,expect,it} from "vitest";
import {asyncAnswerPrompt,listAsyncUserInputs,persistAsyncUserInput} from "../../src/server/async-user-input.js";
import type {ProviderId} from "../../src/server/types.js";
import vm from "node:vm";
import ts from "typescript";
import Fastify from "fastify";
import {registerManagedProviderMcp} from "../../src/server/managed-provider-mcp.js";
import {phaseForEvent} from "../../src/web/liveness.js";
import {z} from "zod";

const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
function root(){const value=fs.mkdtempSync(path.join(os.tmpdir(),"async-input-"));roots.push(value);return value;}
describe("asynchronous choice cards",()=>{
  it.each((["codex","claude","deepseek","ollama","antigravity","grok"] as ProviderId[]).flatMap(provider=>["running","completed"].map(status=>({provider,status}))))("delivers $provider answers immediately once from $status through the production HTTP routes",async ({provider,status})=>{
    const directory=root(),app=Fastify(),task={id:`${provider}:task`,provider,threadId:"thread",owned:true,ownership:"claudex-workhouse",status,title:"Question"};
    const card=persistAsyncUserInput(directory,task,{id:"call",questions:[{title:"Choose",options:["A","B"]}]});
    const queued=new Map<string,any>(),db={getTask:async(id:string)=>id===task.id?task:null,getSessionMessage:async(id:string)=>queued.get(id),enqueueSessionMessage:async(item:any)=>{expect(queued.has(item.id)).toBe(false);queued.set(item.id,{...item,status:"queued"});return item;}};
    const source=fs.readFileSync(new URL("../../src/server/index.ts",import.meta.url),"utf8"),start=source.indexOf('app.get("/api/user-input"'),end=source.indexOf('app.post("/api/tasks/:provider/:taskId/resync"',start);
    const code=ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
    const dispatchSource=source.slice(source.indexOf('async function dispatchQueuedMessage('),source.indexOf('let queuePumpBusy=false;'));
    const calls:string[]=[];
    Object.assign(db,{
      claimSessionMessage:async(id:string)=>queued.get(id),
      finishSessionMessage:async(id:string,status:string)=>{queued.get(id).status=status;},
      upsertTask:async(value:any)=>value,
      appendAudit:async()=>{}
    });
    vm.runInNewContext(ts.transpileModule(dispatchSource,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText+code,{app,z,db,config:{dataRoot:directory},providerParam:z.enum(["codex","claude","deepseek","ollama","antigravity","grok"]),listAsyncUserInputs,asyncAnswerPrompt,executionHostUsesWorker:()=>false,codex:{listUserInputs:()=>[]},idempotent:async(_request:any,_action:any,_body:any,run:()=>any)=>run(),requirePaidCreditConsent:async()=>{},confirmedPaidCreditProviders:()=>new Set(),queueDispatching:new Set(),latestQueuedThreadTask:async()=>task,activeTaskStatus:(status:string)=>status==="running",assertPaidCreditConsent:async()=>{},applyPendingTaskLocation:async(value:any)=>value,workspacePromptForTask:(_task:any,prompt:string)=>prompt,withoutLegacyWorkspaceApprovalMetadata:()=>({}),publishTaskSnapshot:(value:any)=>value,provider:()=>({stopTask:async()=>{calls.push("stop");return{...task,status:"stopped"};},sendMessage:async(value:any,prompt:string)=>{expect(value.status).toBe(status==="running"?"stopped":"completed");expect(prompt).toBe("Choose\nB");calls.push("resume");return{...value,id:"next",status:"running"};}}),audit:async()=>{}});
    try{
      const url=`/api/tasks/${provider}/${encodeURIComponent(task.id)}/user-input/${card.id}`,payload={answers:{question_1:{answers:["B"]}}};
      expect((await app.inject(`/api/user-input?taskId=${encodeURIComponent(task.id)}`)).json().requests).toHaveLength(1);
      expect((await app.inject({method:"POST",url,payload:{answers:{wrong:{answers:["B"]}}}})).statusCode).toBe(400);
      expect((await app.inject({method:"POST",url,payload})).json()).toMatchObject({resolved:true,queued:false});
      expect((await app.inject({method:"POST",url,payload})).json()).toMatchObject({resolved:true,queued:false});
      expect(calls).toEqual(status==="running"?["stop","resume"]:["resume"]);
      expect([...queued.values()]).toMatchObject([{provider,threadId:"thread",prompt:"Choose\nB"}]);
      expect((await app.inject(`/api/user-input?taskId=${encodeURIComponent(task.id)}`)).json().requests).toEqual([]);
    }finally{await app.close();}
  });
  it("keeps a nonblocking question from marking the worker as waiting",()=>{
    expect(phaseForEvent({type:"user_input_required",content:"Choose",metadata:{delivery:"async"}} as any,"acting")).toBe("acting");
    expect(phaseForEvent({type:"user_input_required",content:"Choose"} as any,"acting")).toBe("waiting-user");
  });
  it.each<ProviderId>(["codex","claude","deepseek","ollama","antigravity","grok"])("exposes and executes the authenticated %s question tool",async provider=>{
    const directory=root(),app=Fastify(),source={id:`${provider}:task`,provider,threadId:"thread",metadata:{}};
    registerManagedProviderMcp(app,{authenticate:async()=>source} as any,undefined,directory);
    try{
      const origin=await app.listen({port:0,host:"127.0.0.1"});
      const response=await fetch(`${origin}/mcp/claudex-workhouse`,{method:"POST",headers:{"content-type":"application/json",accept:"application/json, text/event-stream",authorization:"Bearer fixture","x-claudex-workhouse-task-id":source.id},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/call",params:{name:"request_user_input_async",arguments:{idempotencyKey:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",questions:[{title:"Continue?",options:["Yes","No"]}]}}})});
      expect(response.status).toBe(200);expect((await response.json()).result.isError).not.toBe(true);
      expect(listAsyncUserInputs(directory,source.id)[0]).toMatchObject({provider,delivery:"async",questions:[{question:"Continue?"}]});
    }finally{await app.close();}
  });
  it("captures the actual Codex async agent-message notification as a card",()=>{
    const directory=root(),events:any[]=[];
    const source=fs.readFileSync(new URL("../../src/server/codex-worker.ts",import.meta.url),"utf8");
    const start=source.indexOf("function appendNotification("),end=source.indexOf("\nfunction write(",start);
    expect(start).toBeGreaterThan(-1);expect(end).toBeGreaterThan(start);
    const context={root:directory,taskId:"codex:task",threadId:"thread",turnId:"turn",mode:"resume",persistAsyncUserInput,write:()=>{},spool:{append:(event:any)=>events.push(event)}};
    const code=ts.transpileModule(source.slice(start,end)+"\nappendNotification;",{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
    const notify=vm.runInNewContext(code,context);
    notify({method:"item/completed",params:{threadId:"thread",turnId:"turn",item:{type:"agentMessage",id:"call_native",text:"Which path?",phase:"final_answer",delivery:"async",questions:[{title:"Which path?",options:["A","B"]}]}}});
    expect(events).toHaveLength(1);expect(events[0]).toMatchObject({type:"user_input_required",metadata:{delivery:"async"}});
    expect(listAsyncUserInputs(directory,"codex:task")[0].questions[0].options.map(o=>o.label)).toEqual(["A","B"]);
  });
  it.each<ProviderId>(["codex","claude","deepseek","ollama","antigravity","grok"])("persists %s questions without a blocking native request",provider=>{
    const directory=root(),source={id:`${provider}:task`,provider,threadId:"thread"};
    const card=persistAsyncUserInput(directory,source,{id:"call_1",questions:[{title:"Which path?",options:["A","B"]},{title:"Any constraints?"}]});
    expect(card).toMatchObject({provider,delivery:"async",threadId:"thread",questions:[{id:"question_1",question:"Which path?",options:[{label:"A",description:""},{label:"B",description:""}]},{id:"question_2",question:"Any constraints?",options:[]}]});
    expect(listAsyncUserInputs(directory,source.id)).toEqual([card]);
    expect(listAsyncUserInputs(directory,"other-task")).toEqual([]);
    expect(asyncAnswerPrompt(card,{question_1:{answers:["B"]},question_2:{answers:["Keep existing data"]}})).toBe("Which path?\nB\n\nAny constraints?\nKeep existing data");
  });
  it("keeps replayed cards stable and does not extend their expiry",()=>{
    const directory=root(),source={id:"codex:task",provider:"codex" as const},item={id:"call",questions:[{title:"Choose",options:["A"]}]};
    const first=persistAsyncUserInput(directory,source,item),again=persistAsyncUserInput(directory,source,item);
    expect(again).toEqual(first);expect(listAsyncUserInputs(directory,source.id)).toHaveLength(1);
    expect(persistAsyncUserInput(directory,{...source,id:"codex:other"},item).id).not.toBe(first.id);
  });
  it("rejects empty or mismatched answers instead of silently submitting a default",()=>{
    const card=persistAsyncUserInput(root(),{id:"task",provider:"codex"},{id:"call",questions:[{title:"Choose",options:["A"]}]});
    for(const answers of [{},{wrong:{answers:["A"]}},{question_1:{answers:[]}}, {question_1:{answers:[" "]}}])expect(()=>asyncAnswerPrompt(card,answers)).toThrow(/matching answer/);
  });
  it("does not resurrect expired native history",()=>{
    const directory=root();persistAsyncUserInput(directory,{id:"task",provider:"codex"},{id:"old",requestedAt:"2020-01-01T00:00:00Z",questions:[{title:"Old question"}]});
    expect(listAsyncUserInputs(directory,"task")).toEqual([]);
  });
});
