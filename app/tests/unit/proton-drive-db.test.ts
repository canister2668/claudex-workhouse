import crypto from"node:crypto";
import fs from"node:fs";
import os from"node:os";
import path from"node:path";
import{afterEach,describe,expect,it}from"vitest";
import{DeckDatabase}from"../../src/server/db/client.js";

const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});

describe("Proton Drive upload persistence",()=>{
  it("allows one active upload and preserves an uncertain delivery after restart",async()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),"proton-drive-db-"));roots.push(root);
    const db=new DeckDatabase(path.resolve("src/server/db/sqlite-worker.py"),path.join(root,"test.sqlite"));
    try{
      await db.ping(60_000);
      const now=new Date().toISOString();
      const operation={id:crypto.randomUUID(),hostId:"local",taskId:"codex:test",workspaceId:"workspace-test",sourceRelativePath:"dist/result.zip",sourceName:"result.zip",sourceSize:512,sourceSha256:"a".repeat(64),remotePath:"/my-files/Claudex-Workhouse/demo/result-a.zip",status:"running",stage:"uploading",safeErrorCode:null,cliVersion:"0.7.0",createdAt:now,startedAt:now,updatedAt:now,finishedAt:null,interrupted:false};
      await db.createProtonUploadOperation(operation);
      await expect(db.createProtonUploadOperation({...operation,id:crypto.randomUUID()})).rejects.toThrow();
      expect(await db.reconcileProtonUploadOperations(now)).toBe(1);
      expect(await db.getProtonUploadOperation(operation.id)).toMatchObject({status:"delivery-uncertain",stage:"delivery-uncertain",safeErrorCode:"SERVER_RESTARTED",interrupted:1});
    }finally{await db.close();}
  });
});
