import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach,describe,expect,it} from "vitest";
import {DeckDatabase} from "../../src/server/db/client.js";

const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});

function thread(settingsUpdatedAt:string,requestedServiceTier:string|null){
  return{threadId:"thread-fast-setting",sessionId:"thread-fast-setting",projectId:"project",cwd:"/workspace",title:"Fast setting",preview:"",source:"claudex-workhouse",ownership:"claudex-workhouse",status:"completed",archived:false,parentThreadId:null,forkedFromId:null,modelProvider:null,requestedModel:"gpt-5.6-sol",effectiveModel:null,requestedReasoningEffort:"medium",effectiveReasoningEffort:null,requestedServiceTier,effectiveServiceTier:null,permissionProfile:":workspace",settingsUpdatedAt,createdAt:"2026-08-13T00:00:00.000Z",updatedAt:settingsUpdatedAt,lastSeenAt:settingsUpdatedAt,metadata:{automationLevel:"auto"},executionHostId:"local",workspaceId:"workspace",workChainId:null};
}

async function database(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"claudex-thread-settings-"));roots.push(root);
  const db=new DeckDatabase(path.resolve("src/server/db/sqlite-worker.py"),path.join(root,"test.sqlite"));await db.ping(60_000);return db;
}

describe("Codex thread settings persistence",()=>{
  it("clears Fast when Standard is saved and still rejects an older settings snapshot",async()=>{
    const db=await database();
    try{
      await db.upsertCodexThread(thread("2026-08-13T01:00:00.000Z","priority"));
      const standard=await db.upsertCodexThread(thread("2026-08-13T02:00:00.000Z",null));
      expect(standard).toMatchObject({requestedServiceTier:null,settingsUpdatedAt:"2026-08-13T02:00:00.000Z"});
      const stale=await db.upsertCodexThread(thread("2026-08-13T01:30:00.000Z","priority"));
      expect(stale).toMatchObject({requestedServiceTier:null,settingsUpdatedAt:"2026-08-13T02:00:00.000Z"});
    }finally{await db.close();}
  });
});
