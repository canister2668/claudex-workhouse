import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DeckDatabase } from "../../src/server/db/client.js";
import { reservationPermissionSnapshot, runQuotaReservationPump } from "../../src/server/quota-task-reservations.js";

const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});

async function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"quota-reservation-"));roots.push(root);
  const db=new DeckDatabase(path.resolve("src/server/db/sqlite-worker.py"),path.join(root,"db.sqlite"));await db.ping();
  return{db,root};
}

function item(provider:"codex"|"claude"="codex"){
  const now="2026-07-29T09:00:00.000Z",request={provider,projectId:"p",executionHostId:"local",workspaceId:"w",prompt:"do work",automationLevel:"read",permissionProfile:":read-only",workMode:"plan"};
  return{id:crypto.randomUUID(),provider,projectId:"p",executionHostId:"local",workspaceId:"w",title:"do work",request,permissionSnapshot:reservationPermissionSnapshot(request),status:"waiting-quota",idempotencyKey:crypto.randomUUID(),createdAt:now,updatedAt:now,nextCheckAt:now,lastQuotaCheckAt:null,lastQuotaStatus:null,claimStartedAt:null,taskId:null,error:null};
}

describe("quota task reservation persistence",()=>{
  it("does not expose a reservation to the pump before its expected check time",async()=>{
    const{db}=await fixture(),future={...item(),nextCheckAt:"2099-01-01T00:00:00.000Z"};await db.createQuotaTaskReservation(future);
    let starts=0;
    const result=await runQuotaReservationPump({store:db,quota:{codex:{fiveHour:{pct:0,resetsAt:null,durationMins:300},sevenDay:{pct:0,resetsAt:null,durationMins:10080},status:"ok"},claude:undefined},start:async()=>{starts++;},now:()=>Date.parse("2026-07-29T09:00:00.000Z")});
    expect(result).toEqual({examined:0,started:0});expect(starts).toBe(0);
    await db.close();
  });

  it("atomically lets concurrent pumps claim a reservation once",async()=>{
    const{db}=await fixture(),created=await db.createQuotaTaskReservation(item());
    const claims=await Promise.all(Array.from({length:8},()=>db.claimQuotaTaskReservation(created.id,new Date().toISOString(),"available")));
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect((await db.getQuotaTaskReservation(created.id))?.status).toBe("claiming");
    await db.close();
  });

  it("keeps providers isolated and cancelled reservations cannot run",async()=>{
    const{db}=await fixture(),codex=await db.createQuotaTaskReservation(item("codex")),claude=await db.createQuotaTaskReservation(item("claude"));
    expect((await db.listQuotaTaskReservations({provider:"codex"})).map(row=>row.id)).toEqual([codex.id]);
    expect((await db.listQuotaTaskReservations({provider:"claude"})).map(row=>row.id)).toEqual([claude.id]);
    expect((await db.cancelQuotaTaskReservation(codex.id,new Date().toISOString()))?.status).toBe("cancelled");
    expect(await db.claimQuotaTaskReservation(codex.id,new Date().toISOString(),"available")).toBeNull();
    expect(await db.claimQuotaTaskReservation(claude.id,new Date().toISOString(),"available")).not.toBeNull();
    await db.close();
  });

  it("recovers stale claiming work and reconciles a confirmed task",async()=>{
    const{db}=await fixture(),retry=await db.createQuotaTaskReservation(item()),uncertain=await db.createQuotaTaskReservation(item()),started=await db.createQuotaTaskReservation(item("claude")),timestamp=new Date().toISOString();
    await db.claimQuotaTaskReservation(retry.id,timestamp,"available");
    await db.claimQuotaTaskReservation(uncertain.id,timestamp,"available");
    await db.markQuotaTaskReservationStarting(uncertain.id,timestamp,`codex:deck:${uncertain.id}`);
    await db.claimQuotaTaskReservation(started.id,timestamp,"available");
    const taskId=`claude:${crypto.randomUUID()}`;
    await db.upsertTask({id:taskId,provider:"claude",nativeId:taskId,threadId:null,projectId:"p",title:"started",prompt:"do work",status:"pending",createdAt:timestamp,updatedAt:timestamp,result:null,error:null,log:"",owned:true,pid:null,pgid:null,processStart:null,commandMarker:null,parentThreadId:null,executionHostId:"local",workspaceId:"w"});
    await db.markQuotaTaskReservationStarting(started.id,timestamp,taskId);
    expect(await db.recoverQuotaTaskReservations(new Date().toISOString())).toHaveLength(3);
    expect(await db.getQuotaTaskReservation(retry.id)).toMatchObject({status:"waiting-quota",taskId:null});
    expect(await db.getQuotaTaskReservation(uncertain.id)).toMatchObject({status:"failed",error:expect.stringContaining("duplicate execution")});
    expect(await db.getQuotaTaskReservation(started.id)).toMatchObject({status:"started",taskId});
    await db.close();
  });

  it("leaves fresh runtime claims alone and reconciles them only after the stale cutoff",async()=>{
    const{db}=await fixture(),created=await db.createQuotaTaskReservation(item()),claimedAt="2026-07-29T09:10:00.000Z";
    await db.claimQuotaTaskReservation(created.id,claimedAt,"available");
    expect(await db.recoverQuotaTaskReservations("2026-07-29T09:11:00.000Z","2026-07-29T09:05:00.000Z")).toHaveLength(0);
    expect((await db.getQuotaTaskReservation(created.id))?.status).toBe("claiming");
    expect(await db.recoverQuotaTaskReservations("2026-07-29T09:20:00.000Z","2026-07-29T09:15:00.000Z")).toHaveLength(1);
    expect((await db.getQuotaTaskReservation(created.id))?.status).toBe("waiting-quota");
    await db.close();
  });

  it("makes start-now and the automatic pump share the same claim race",async()=>{
    const{db}=await fixture(),created=await db.createQuotaTaskReservation(item());
    const [manual,automatic]=await Promise.all([
      db.claimQuotaTaskReservation(created.id,new Date().toISOString(),"manual-start"),
      db.claimQuotaTaskReservation(created.id,new Date().toISOString(),"available")
    ]);
    expect([manual,automatic].filter(Boolean)).toHaveLength(1);
    await db.close();
  });

  it("runs an observed recovery exactly once across concurrent pumps",async()=>{
    const{db}=await fixture();await db.createQuotaTaskReservation(item());
    let starts=0;
    const available={codex:{fiveHour:{pct:2,resetsAt:null,durationMins:300},sevenDay:{pct:10,resetsAt:null,durationMins:10080},status:"ok" as const},claude:undefined};
    await Promise.all(Array.from({length:4},()=>runQuotaReservationPump({store:db,quota:available,start:async reservation=>{starts++;const now=new Date().toISOString(),taskId=`codex:deck:${reservation.id}`;await db.markQuotaTaskReservationStarting(reservation.id,now,taskId);await db.markQuotaTaskReservationStarted(reservation.id,now,taskId);}})));
    expect(starts).toBe(1);
    expect((await db.listQuotaTaskReservations({provider:"codex"}))[0]).toMatchObject({status:"started"});
    await db.close();
  });

  it("does not resurrect a cancellation made after a pump read the due row",async()=>{
    const{db}=await fixture(),created=await db.createQuotaTaskReservation(item());
    let release!:()=>void;
    const blocked=new Promise<void>(resolve=>{release=resolve;});
    let listed!:()=>void;
    const didList=new Promise<void>(resolve=>{listed=resolve;});
    const store={
      listDueQuotaTaskReservations:async(now:string,limit?:number)=>{const rows=await db.listDueQuotaTaskReservations(now,limit);listed();await blocked;return rows;},
      rescheduleQuotaTaskReservation:db.rescheduleQuotaTaskReservation.bind(db),
      claimQuotaTaskReservation:db.claimQuotaTaskReservation.bind(db)
    };
    const running=runQuotaReservationPump({store,quota:{codex:{fiveHour:null,sevenDay:null,status:"partial",error:"unavailable"},claude:undefined},start:async()=>{}});
    await didList;
    expect((await db.cancelQuotaTaskReservation(created.id,new Date().toISOString()))?.status).toBe("cancelled");
    release();await running;
    expect(await db.getQuotaTaskReservation(created.id)).toMatchObject({status:"cancelled",quotaCheckCount:0});
    await db.close();
  });

  it("clears an unconfirmed predicted task id and allows an explicit retry",async()=>{
    const{db}=await fixture(),created=await db.createQuotaTaskReservation(item()),now=new Date().toISOString();
    await db.claimQuotaTaskReservation(created.id,now,"available");
    await db.markQuotaTaskReservationStarting(created.id,now,`codex:deck:${created.id}`);
    expect(await db.failQuotaTaskReservation(created.id,now,"provider unavailable")).toMatchObject({status:"failed",taskId:null});
    expect(await db.retryQuotaTaskReservation(created.id,new Date().toISOString())).toMatchObject({status:"waiting-quota",error:null,taskId:null,quotaCheckCount:0});
    await db.close();
  });

  it("does not invoke the provider for exhausted, unknown, weekly-blocked, or cancelled reservations",async()=>{
    const{db}=await fixture(),exhausted=await db.createQuotaTaskReservation(item()),unknown=await db.createQuotaTaskReservation(item()),weekly=await db.createQuotaTaskReservation(item()),cancelled=await db.createQuotaTaskReservation(item());
    await db.cancelQuotaTaskReservation(cancelled.id,new Date().toISOString());
    let starts=0;
    const start=async()=>{starts++;};
    const fiveExhausted={fiveHour:{pct:100,resetsAt:null,durationMins:300},sevenDay:{pct:10,resetsAt:null,durationMins:10080},status:"ok" as const};
    await runQuotaReservationPump({store:db,quota:{codex:fiveExhausted,claude:undefined},start});
    await db.cancelQuotaTaskReservation(exhausted.id,new Date().toISOString());
    await runQuotaReservationPump({store:db,quota:{codex:{fiveHour:null,sevenDay:null,status:"partial",error:"unavailable"},claude:undefined},start,now:()=>Date.now()+120_000});
    await db.cancelQuotaTaskReservation(unknown.id,new Date().toISOString());
    await runQuotaReservationPump({store:db,quota:{codex:{fiveHour:{pct:1,resetsAt:null,durationMins:300},sevenDay:{pct:100,resetsAt:null,durationMins:10080},status:"ok"},claude:undefined},start,now:()=>Date.now()+240_000});
    expect(starts).toBe(0);
    expect((await db.getQuotaTaskReservation(weekly.id))?.lastQuotaStatus).toBe("other-window-exhausted");
    expect((await db.getQuotaTaskReservation(cancelled.id))?.status).toBe("cancelled");
    await db.close();
  });
});
