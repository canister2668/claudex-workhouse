import {describe,expect,it} from "vitest";
import {assertRecoveryThread,defaultRecoveryPrompt,retryableRecoveryPrelaunchFailure,taskRecoveryBoundary,taskRecoveryEligibility,taskRecoveryPermission} from "../../src/server/task-recovery.js";
import type {DeckTask} from "../../src/server/types.js";

function task(overrides:Partial<DeckTask>={}):DeckTask{
  return{id:"claude:lost",provider:"claude",nativeId:"lost",threadId:"11111111-1111-4111-8111-111111111111",projectId:"project",title:"Interrupted",prompt:"work",status:"stopped",createdAt:"2026-07-29T09:00:00.000Z",updatedAt:"2026-07-29T09:10:00.000Z",result:null,error:"Worker process is no longer running.",log:"",owned:true,pid:null,pgid:null,processStart:null,commandMarker:"claudex-workhouse:lost",parentThreadId:null,executionHostId:"local",workspaceId:"workspace",permissionProfile:":workspace-write",ownership:"claudex-workhouse",source:"claudex-workhouse",metadata:{interruptionCause:"worker-process-lost"},...overrides};
}

describe("task recovery eligibility",()=>{
  it("offers recovery only for a proven managed Worker interruption",()=>{
    expect(taskRecoveryEligibility(task())).toEqual({eligible:true,cause:"worker-process-lost",reason:"eligible"});
    expect(taskRecoveryEligibility(task({status:"completed"}))).toMatchObject({eligible:false,reason:"not-interrupted"});
    expect(taskRecoveryEligibility(task({status:"failed"}))).toMatchObject({eligible:false,reason:"not-interrupted"});
    expect(taskRecoveryEligibility(task({metadata:{terminationCause:"user-stopped"}}))).toMatchObject({eligible:false,reason:"not-interrupted"});
  });

  it("blocks external ownership and ambiguous session or workspace identity",()=>{
    expect(taskRecoveryEligibility(task({owned:false,ownership:"external",source:"cli",commandMarker:null}))).toMatchObject({eligible:false,reason:"not-owned"});
    expect(taskRecoveryEligibility(task({threadId:null}))).toMatchObject({eligible:false,reason:"missing-thread"});
    expect(taskRecoveryEligibility(task({workspaceId:null}))).toMatchObject({eligible:false,reason:"missing-workspace"});
  });

  it("prefills the interruption and last checkpoint without inventing completion",()=>{
    expect(defaultRecoveryPrompt(task({error:"last command was interrupted"}))).toContain("마지막 확인 지점: last command was interrupted");
  });

  it("requires the exact original host, project, and workspace boundary",()=>{
    const source=task(),host={id:"local"},workspace={id:"workspace",hostId:"local",projectId:"project"};
    expect(taskRecoveryBoundary(source,host,workspace,true)).toEqual({valid:true,reason:"valid"});
    expect(taskRecoveryBoundary(source,host,{...workspace,projectId:"other"},true)).toEqual({valid:false,reason:"workspace-source-mismatch"});
    expect(taskRecoveryBoundary(source,{id:"remote"},{...workspace,hostId:"remote"},false)).toEqual({valid:false,reason:"host-missing"});
  });

  it("never elevates the saved permission and only permits a capability downgrade",()=>{
    expect(taskRecoveryPermission(task(),["auto","read"])).toMatchObject({available:true,effectiveLevel:"auto",effectivePermission:":workspace-write",downgraded:false});
    expect(taskRecoveryPermission(task(),["read"])).toMatchObject({available:true,effectiveLevel:"read",effectivePermission:":read-only",downgraded:true});
    expect(taskRecoveryPermission(task(),["confirm"])).toMatchObject({available:false,effectiveLevel:null});
  });

  it("requires the Provider to return the exact source thread",()=>{
    expect(()=>assertRecoveryThread(task().threadId!,"different-thread")).toThrow("confirmed source thread");
    expect(()=>assertRecoveryThread(task().threadId!,task().threadId)).not.toThrow();
  });

  it("releases only failures proven to happen before Provider launch",()=>{
    expect(retryableRecoveryPrelaunchFailure({code:"AUTOMATIC_EXECUTION_BLOCKED"})).toBe(true);
    expect(retryableRecoveryPrelaunchFailure({code:"TASK_RECOVERY_SOURCE_ACTIVE"})).toBe(true);
    expect(retryableRecoveryPrelaunchFailure({code:"HOST_OFFLINE"})).toBe(false);
  });
});
