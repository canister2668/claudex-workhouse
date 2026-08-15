import fs from"node:fs";
import os from"node:os";
import path from"node:path";
import { describe, expect, it } from "vitest";
import { WorkerHub } from "../../src/server/worker-hub.js";
import{readStreamEvents}from"../../src/server/stream-events.js";

describe("Desktop Worker pairing",()=>{
  it("stores only a credential hash and rejects code reuse",async()=>{
    let stored:any=null;const db:any={upsertHost:async(value:any)=>value,putWorkerCredential:async(value:any)=>{stored=value;return true;},getWorkerCredential:async()=>null};
    const hub=new WorkerHub(db,"/tmp");
    try{
      const pairing=hub.createPairing();
      expect(pairing.code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
      const result=await hub.claimPairing({code:pairing.code,displayName:"Desktop",platform:"linux",architecture:"x64",workerVersion:"test"},"127.0.0.1");
      expect(result.credential).toHaveLength(43);
      expect(stored.credentialHash).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(stored)).not.toContain(result.credential);
      await expect(hub.claimPairing({code:pairing.code,displayName:"Other",platform:"linux",architecture:"x64",workerVersion:"test"},"127.0.0.2")).rejects.toThrow(/invalid or expired/i);
    }finally{hub.shutdown();}
  });
  it("flushes worker events that arrived before task registration",async()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),"worker-event-race-"));let task:any=null;const db:any={getTask:async()=>task};const hub=new WorkerHub(db,root);
    try{(hub as any).pendingEvents.set("codex:worker:race",[{hostId:"local",eventId:"event-1",event:{type:"agent_message",content:"streamed"}}]);task={id:"codex:worker:race",provider:"codex",executionHostId:"local"};await hub.taskRegistered(task.id);expect(readStreamEvents(root,task.id,0,10).events[0]).toMatchObject({content:"streamed",metadata:{sourceWorkerEventId:"event-1",sourceHostId:"local"}});}finally{hub.shutdown();fs.rmSync(root,{recursive:true,force:true});}
  });
});
