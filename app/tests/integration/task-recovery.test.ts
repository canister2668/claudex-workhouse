import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach,describe,expect,it} from "vitest";
import {DeckDatabase} from "../../src/server/db/client.js";

const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
async function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"task-recovery-"));roots.push(root);const file=path.join(root,"db.sqlite");
  const db=new DeckDatabase(path.resolve("src/server/db/sqlite-worker.py"),file);await db.ping();
  const now="2026-07-29T09:00:00.000Z",task={id:"claude:lost",provider:"claude",nativeId:"lost",threadId:"11111111-1111-4111-8111-111111111111",projectId:"project",title:"Interrupted",prompt:"work",status:"stopped",createdAt:now,updatedAt:now,result:null,error:"Worker lost",log:"",owned:true,pid:null,pgid:null,processStart:null,commandMarker:"claudex-workhouse:lost",parentThreadId:null,executionHostId:"local",workspaceId:"workspace",permissionProfile:":workspace-write",ownership:"claudex-workhouse",source:"claudex-workhouse",metadata:{interruptionCause:"worker-process-lost"}};
  await db.upsertTask(task as any);return{db,file};
}

describe("task recovery persistence",()=>{
  it("atomically lets only one concurrent recovery claim a source task",async()=>{
    const{db}=await fixture(),now=new Date().toISOString();
    const claims=await Promise.all(Array.from({length:8},()=>db.claimTaskRecovery({sourceTaskId:"claude:lost",attemptId:crypto.randomUUID(),promptHash:"a".repeat(64),now})));
    expect(claims.filter(item=>item.claimed)).toHaveLength(1);
    expect((await db.getTaskRecoveryAttempt("claude:lost"))?.status).toBe("claiming");
    await db.close();
  });

  it("persists the resolved resume task across a database restart",async()=>{
    const{db,file}=await fixture(),attemptId=crypto.randomUUID(),now=new Date().toISOString();
    await db.claimTaskRecovery({sourceTaskId:"claude:lost",attemptId,promptHash:"b".repeat(64),now});
    expect(await db.finishTaskRecovery({sourceTaskId:"claude:lost",attemptId,status:"started",now,resumedTaskId:"claude:resumed",error:null})).toMatchObject({status:"started",resumedTaskId:"claude:resumed"});
    await db.close();
    const reopened=new DeckDatabase(path.resolve("src/server/db/sqlite-worker.py"),file);await reopened.ping();
    expect(await reopened.getTaskRecoveryAttempt("claude:lost")).toMatchObject({status:"started",resumedTaskId:"claude:resumed"});
    await reopened.close();
  });

  it("reconciles a crash-window claim without ever making it retryable by accident",async()=>{
    const{db}=await fixture(),attemptId=crypto.randomUUID(),now=new Date().toISOString();
    await db.claimTaskRecovery({sourceTaskId:"claude:lost",attemptId,promptHash:"c".repeat(64),now});
    expect(await db.recoverTaskRecoveryAttempts(new Date().toISOString())).toEqual([expect.objectContaining({sourceTaskId:"claude:lost",status:"failed",resumedTaskId:null})]);
    expect((await db.getTaskRecoveryAttempt("claude:lost"))?.error).toContain("Automatic retry is blocked");
    await db.close();
  });

  it("promotes a crash-window claim when the resumed task was already persisted",async()=>{
    const{db}=await fixture(),attemptId=crypto.randomUUID(),now=new Date().toISOString();
    await db.claimTaskRecovery({sourceTaskId:"claude:lost",attemptId,promptHash:"d".repeat(64),now});
    const source=await db.getTask("claude:lost");
    await db.upsertTask({...source!,id:"claude:resumed",nativeId:"resumed",createdAt:new Date().toISOString(),metadata:{recoveredFromTaskId:"claude:lost",recoveryAttemptId:attemptId}} as any);
    expect(await db.recoverTaskRecoveryAttempts(new Date().toISOString())).toEqual([expect.objectContaining({status:"started",resumedTaskId:"claude:resumed"})]);
    await db.close();
  });

  it("allows a new claim only after a proven pre-launch failure releases the old claim",async()=>{
    const{db}=await fixture(),attemptId=crypto.randomUUID(),now=new Date().toISOString();
    await db.claimTaskRecovery({sourceTaskId:"claude:lost",attemptId,promptHash:"e".repeat(64),now});
    expect(await db.releaseTaskRecoveryClaim({sourceTaskId:"claude:lost",attemptId})).toBe(true);
    expect((await db.claimTaskRecovery({sourceTaskId:"claude:lost",attemptId:crypto.randomUUID(),promptHash:"f".repeat(64),now})).claimed).toBe(true);
    await db.close();
  });
});
