import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {describe,it,expect} from "vitest";
import {queuedTaskContinuation,TASK_CONTINUATION_INSTRUCTIONS} from "../../src/server/task-continuation.js";
import {delegationDeveloperInstructions,DEFAULT_DELEGATION_SETTINGS} from "../../src/server/delegation-settings.js";

describe("mid-task correction delivery",()=>{
  it.each([false,true])("preserves the objective across successive corrections through the production dispatcher (worker=%s)",async remote=>{
    const source=fs.readFileSync(new URL("../../src/server/index.ts",import.meta.url),"utf8");
    const code=source.slice(source.indexOf("async function dispatchQueuedMessage("),source.indexOf("let queuePumpBusy=false;"));
    let task:any={id:"first",provider:"codex",threadId:"thread",status:"running",prompt:"Repair the parser and verify the result",metadata:{},executionHostId:remote?"worker":null};
    const messages=new Map<string,any>(),received:any[]=[],stopped:string[]=[];
    const resume=async(value:any,prompt:string)=>{received.push(JSON.parse(prompt.split("\n\n").at(-1)!));return{...value,id:`next-${received.length}`,status:"running"};};
    const context:any={queuedTaskContinuation,queueDispatching:new Set(),activeTaskStatus:(status:string)=>status==="running",executionHostUsesWorker:()=>remote,assertPaidCreditConsent:async()=>{},applyPendingTaskLocation:async(value:any)=>value,automationLevel:()=>"full",latestQueuedThreadTask:async()=>task,withoutLegacyWorkspaceApprovalMetadata:(value:any)=>value??{},publishTaskSnapshot:()=>{},sendTaskMessage:resume,provider:()=>({stopTask:async(value:any)=>{stopped.push(value.id);return{...value,status:"stopped"};}}),remoteTaskCommand:async(value:any,command:string,payload:any)=>{if(command==="provider.task.stop"){stopped.push(value.id);return{...value,status:"stopped"};}expect(command).toBe("provider.session.resume");return resume(value,payload.prompt);},db:{getSessionMessage:async(id:string)=>messages.get(id),claimSessionMessage:async(id:string)=>messages.get(id),finishSessionMessage:async(id:string,status:string)=>{messages.get(id).status=status;},upsertTask:async(value:any)=>{task=value;return value;},appendAudit:async()=>{}}};
    vm.runInNewContext(ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
    for(const [id,input] of [["one","That is the wrong file. Fix the actual parser."],["two","Keep the existing input format."]]){
      messages.set(id,{id,provider:"codex",threadId:"thread",status:"queued",prompt:input});
      expect((await context.dispatchQueuedMessage(id,true)).queued).toBe(false);
      expect(task.prompt).toBe(input);
    }
    expect(stopped).toEqual(["first","next-1"]);
    expect(received).toEqual([
      {originalTask:"Repair the parser and verify the result",latestUserInput:"That is the wrong file. Fix the actual parser."},
      {originalTask:"Repair the parser and verify the result",latestUserInput:"Keep the existing input format."}
    ]);
    expect(task.metadata.queuedTaskContinuation.objective).toBe("Repair the parser and verify the result");
    expect(messages.get("two").prompt).toBe("Keep the existing input format.");
    await expect(context.dispatchQueuedMessage("two",true)).rejects.toMatchObject({code:"QUEUED_MESSAGE_NOT_FOUND"});
    expect(received).toHaveLength(2);
  });
  it("starts fresh after a direct follow-up instead of inheriting a stale objective",()=>{
    const delivery=queuedTaskContinuation({prompt:"Build a new feature",metadata:{queuedTaskContinuation:{objective:"Old task",latestInput:"Old correction"}}},"Use the existing design");
    expect(delivery.metadata.queuedTaskContinuation?.objective).toBe("Build a new feature");
  });
  it.each(["conversation",
  ])("leaves the %s runtime input untouched",runtimeProfile=>{
    expect(queuedTaskContinuation({prompt:"Prior prompt",metadata:{runtimeProfile}},"Why?")).toEqual({prompt:"Why?",metadata:{}});
  });
  it("preserves explicit stop instructions verbatim and gives them precedence",()=>{
    const input="Stop. Do not change any more files.\n\"quoted\"";
    const delivery=queuedTaskContinuation({prompt:"Repair files",metadata:{}},input);
    expect(JSON.parse(delivery.prompt.split("\n\n").at(-1)!)).toEqual({originalTask:"Repair files",latestUserInput:input});
    expect(delivery.prompt).toContain("Explicit cancellation, pause, replacement objectives, permission boundaries, and genuine blockers take precedence");
  });
  it("injects persistence guidance into provider developer instructions",()=>{
    expect(delegationDeveloperInstructions(DEFAULT_DELEGATION_SETTINGS,"codex")).toContain(TASK_CONTINUATION_INSTRUCTIONS);
    expect(delegationDeveloperInstructions(DEFAULT_DELEGATION_SETTINGS,"claude")).toContain(TASK_CONTINUATION_INSTRUCTIONS);
  });
});
