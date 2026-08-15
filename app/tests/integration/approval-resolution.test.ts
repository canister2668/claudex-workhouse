import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach,describe,expect,it,vi} from "vitest";
import {codexApprovalRecord,persistPendingApproval,submitApprovalDecision,waitForApprovalDecision,type ApprovalDecision} from "../../src/server/approval-bridge";
import {resolveTaskApproval} from "../../src/server/approval-resolution";
import type {DeckTask} from "../../src/server/types";
import {CodexProvider} from "../../src/server/providers/codex";

const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});

function fixture(ttlMs=5000){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"approval-resolution-"));roots.push(root);
  const stateFile=path.join(root,"task.json"),task={id:"codex:approval",provider:"codex",executionHostId:"local",workspaceId:"workspace",hostTaskId:null} as DeckTask;
  const approval=codexApprovalRecord({taskId:task.id,hostId:"local",workspaceId:task.workspaceId,cwd:root,method:"item/commandExecution/requestApproval",params:{command:["git","status"],availableDecisions:["accept","acceptForSession","decline"]},ttlMs});
  persistPendingApproval(stateFile,approval);
  const resolve=(decision:ApprovalDecision)=>resolveTaskApproval({task,approvalId:approval.id,decision,localHostId:"local",listLocal:()=>[approval],respondLocal:(_task,id,value)=>submitApprovalDecision(stateFile,id,value),requestRemote:vi.fn()});
  return{stateFile,task,approval,resolve};
}

describe("server approval resolution",()=>{
  it.each(["accept","acceptForSession","decline"] satisfies ApprovalDecision[])("round-trips local %s with the listed task context",async(decision)=>{
    const item=fixture(),pending=await item.resolve(decision);
    expect(pending).toMatchObject({id:item.approval.id,taskId:item.task.id,hostId:"local",workspaceId:"workspace",risk:"medium"});
    await expect(waitForApprovalDecision(item.stateFile,item.approval)).resolves.toBe(decision);
  });

  it("does not respond when the listed approval belongs to another execution context",async()=>{
    const item=fixture();
    await expect(resolveTaskApproval({task:item.task,approvalId:item.approval.id,decision:"accept",localHostId:"local",listLocal:()=>[{...item.approval,workspaceId:"other"}],respondLocal:vi.fn(),requestRemote:vi.fn()})).rejects.toThrow(/context does not match/);
  });

  it("rejects expiry and a second decision through the server resolution path",async()=>{
    const expired=fixture(-1);
    await expect(expired.resolve("accept")).rejects.toMatchObject({statusCode:409});
    const duplicate=fixture();
    await duplicate.resolve("decline");
    await expect(duplicate.resolve("decline")).rejects.toMatchObject({statusCode:409});
  });

  it("preserves an offline Worker failure instead of treating it as a decision",async()=>{
    const item=fixture(),offline=Object.assign(new Error("Worker is offline."),{statusCode:503,code:"HOST_OFFLINE"});
    await expect(resolveTaskApproval({task:{...item.task,executionHostId:"remote",hostTaskId:"remote-task"},approvalId:item.approval.id,decision:"decline",localHostId:"local",listLocal:vi.fn(),respondLocal:vi.fn(),requestRemote:vi.fn().mockRejectedValue(offline)})).rejects.toMatchObject({statusCode:503,code:"HOST_OFFLINE"});
  });

  it("routes a managed local Worker approval through the Worker channel",async()=>{
    const item=fixture(),requestRemote=vi.fn().mockResolvedValueOnce({approvals:[item.approval]}).mockResolvedValueOnce({approval:item.approval});
    await expect(resolveTaskApproval({task:item.task,approvalId:item.approval.id,decision:"accept",localHostId:"local",workerBacked:true,listLocal:vi.fn(),respondLocal:vi.fn(),requestRemote})).resolves.toMatchObject({id:item.approval.id});
    expect(requestRemote).toHaveBeenNthCalledWith(1,"local","provider.approvals.list",expect.objectContaining({taskId:item.task.id}));
    expect(requestRemote).toHaveBeenNthCalledWith(2,"local","provider.approval.respond",expect.objectContaining({decision:"accept"}));
  });

  it("rejects a missing or context-mismatched Worker response",async()=>{
    const item=fixture(),remote={...item.task,executionHostId:"remote",hostTaskId:"remote-task"};
    const list={approvals:[{...item.approval,taskId:"remote-task",hostId:"remote"}]};
    await expect(resolveTaskApproval({task:remote,approvalId:item.approval.id,decision:"accept",localHostId:"local",listLocal:vi.fn(),respondLocal:vi.fn(),requestRemote:vi.fn().mockResolvedValueOnce(list).mockResolvedValueOnce({accepted:true})})).rejects.toMatchObject({statusCode:502,code:"APPROVAL_RESPONSE_INVALID"});
    await expect(resolveTaskApproval({task:remote,approvalId:item.approval.id,decision:"accept",localHostId:"local",listLocal:vi.fn(),respondLocal:vi.fn(),requestRemote:vi.fn().mockResolvedValueOnce(list).mockResolvedValueOnce({approval:{...item.approval,taskId:"remote-task",hostId:"other"}})})).rejects.toMatchObject({statusCode:409});
  });

  it("keeps the real Codex provider ownership marker guard",()=>{
    const item=fixture(),provider=Object.create(CodexProvider.prototype) as CodexProvider;(provider as any).stateDir=path.dirname(item.stateFile);
    const external={...item.task,commandMarker:null};
    expect(provider.listApprovals(external)).toEqual([]);
    expect(()=>provider.respondApproval(external,item.approval.id,"accept")).toThrow(/Only an Claudex Workhouse Codex worker/);
  });
});
