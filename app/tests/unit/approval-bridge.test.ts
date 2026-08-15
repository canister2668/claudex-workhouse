import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { codexApprovalRecord, listPendingApprovals, persistPendingApproval, submitApprovalDecision, waitForApprovalDecision, type ApprovalDecision } from "../../src/server/approval-bridge.js";

describe("Codex approval bridge",()=>{
  function state(){const root=fs.mkdtempSync(path.join(os.tmpdir(),"deck-approval-"));return{root,file:path.join(root,"task.json")};}
  it("keeps the displayed command, scope, and risk aligned with the provider request",()=>{
    const item=codexApprovalRecord({taskId:"task",hostId:"local",workspaceId:"ws",cwd:"/work",method:"item/commandExecution/requestApproval",params:{threadId:"thread",turnId:"turn",itemId:"item",command:["git","push"],reason:"Publish the branch",networkApprovalContext:{host:"example.invalid"},availableDecisions:["accept","acceptForSession","decline",{acceptWithExecpolicyAmendment:{}}]}});
    expect(item).toMatchObject({taskId:"task",hostId:"local",workspaceId:"ws",threadId:"thread",turnId:"turn",itemId:"item",kind:"command",summary:"Publish the branch",command:"git push",paths:[],access:["execute","network"],risk:"high",availableDecisions:["accept","acceptForSession","decline"]});
    expect(item).not.toHaveProperty("requestId");
  });
  it("classifies credential access as very high",()=>{const item=codexApprovalRecord({taskId:"task",hostId:"local",cwd:"/work",method:"item/fileChange/requestApproval",params:{changes:[{path:"/home/user/.ssh/id_ed25519"}]}});expect(item.risk).toBe("very-high");expect(item.access).toContain("write");});
  it("classifies file paths against the request workspace rather than the server cwd",()=>{
    const inside=codexApprovalRecord({taskId:"inside",hostId:"remote",cwd:"/worker/project",method:"item/fileChange/requestApproval",params:{changes:[{path:"/worker/project/src/app.ts"}]}});
    const outside=codexApprovalRecord({taskId:"outside",hostId:"remote",cwd:"/worker/project",method:"item/fileChange/requestApproval",params:{changes:[{path:"/worker/other/app.ts"}]}});
    expect(inside.risk).toBe("medium");
    expect(outside.risk).toBe("high");
  });
  it.each(["accept","acceptForSession","decline"] satisfies ApprovalDecision[])("round-trips the advertised %s decision",(decision)=>roundTrip(decision));
  async function roundTrip(decision:ApprovalDecision){
    const {root,file}=state();
    try{
      const item=codexApprovalRecord({taskId:"task",hostId:"local",cwd:root,method:"item/commandExecution/requestApproval",params:{command:"git status",availableDecisions:["accept","acceptForSession","decline"]},ttlMs:5000});
      persistPendingApproval(file,item);
      expect(listPendingApprovals(file)).toHaveLength(1);
      submitApprovalDecision(file,item.id,decision);
      await expect(waitForApprovalDecision(file,item)).resolves.toBe(decision);
      expect(listPendingApprovals(file)).toHaveLength(0);
    }finally{fs.rmSync(root,{recursive:true,force:true});}
  }
  it("rejects a session-wide decision when the provider did not advertise it",()=>{
    const {root,file}=state();
    try{
      const item=codexApprovalRecord({taskId:"task",hostId:"local",cwd:root,method:"item/commandExecution/requestApproval",params:{command:"git status",availableDecisions:["accept","decline"]},ttlMs:5000});
      persistPendingApproval(file,item);
      expect(capture(()=>submitApprovalDecision(file,item.id,"acceptForSession"))).toMatchObject({statusCode:400,code:"APPROVAL_SCOPE_UNSUPPORTED"});
    }finally{fs.rmSync(root,{recursive:true,force:true});}
  });
  it("rejects an expired approval without turning it into an implicit decision",()=>{
    const {root,file}=state();
    try{
      const item=codexApprovalRecord({taskId:"task",hostId:"local",cwd:root,method:"item/commandExecution/requestApproval",params:{availableDecisions:["accept","decline"]},ttlMs:-1});
      persistPendingApproval(file,item);
      expect(capture(()=>submitApprovalDecision(file,item.id,"accept"))).toMatchObject({statusCode:409,code:"APPROVAL_EXPIRED"});
    }finally{fs.rmSync(root,{recursive:true,force:true});}
  });
  it("rejects replay after the pending record is consumed",async()=>{const {root,file}=state();const item=codexApprovalRecord({taskId:"task",hostId:"local",cwd:root,method:"item/fileChange/requestApproval",params:{availableDecisions:["decline"]},ttlMs:5000});persistPendingApproval(file,item);submitApprovalDecision(file,item.id,"decline");await waitForApprovalDecision(file,item);expect(capture(()=>submitApprovalDecision(file,item.id,"decline"))).toMatchObject({statusCode:409,code:"APPROVAL_NOT_PENDING"});fs.rmSync(root,{recursive:true,force:true});});
  it("rejects a competing second response before the worker consumes the first",()=>{const {root,file}=state();const item=codexApprovalRecord({taskId:"task",hostId:"local",cwd:root,method:"item/commandExecution/requestApproval",params:{availableDecisions:["accept","decline"]},ttlMs:5000});persistPendingApproval(file,item);submitApprovalDecision(file,item.id,"accept");expect(capture(()=>submitApprovalDecision(file,item.id,"decline"))).toMatchObject({statusCode:409,code:"APPROVAL_ALREADY_ANSWERED"});fs.rmSync(root,{recursive:true,force:true});});
  function capture(run:()=>unknown){try{run();throw new Error("Expected approval failure.");}catch(error){return error;}}
});
