import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DeckDatabase } from "../../src/server/db/client.js";

const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
function attempt(state="staging"){
  const now=new Date().toISOString();return{id:crypto.randomUUID(),state,sourceVersion:"1.0.0",targetVersion:"1.1.0",manifestSha256:"a".repeat(64),installMethod:"docker-compose",platform:"linux",architecture:"x64",snapshotId:null,requestPath:null,rollbackPerformed:false,error:null,createdAt:now,updatedAt:now,completedAt:null};
}

describe("application update attempt store",()=>{
  it("persists attempts and enforces one process-independent active update",async()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),"application-update-db-"));roots.push(root);const db=new DeckDatabase(path.resolve("src/server/db/sqlite-worker.py"),path.join(root,"db.sqlite"));
    try{
      await db.ping();const first=await db.createApplicationUpdateAttempt(attempt());expect(await db.getActiveApplicationUpdateAttempt()).toMatchObject({id:first.id,state:"staging",rollbackPerformed:false});
      await expect(db.createApplicationUpdateAttempt(attempt())).rejects.toThrow();
      const completed=await db.updateApplicationUpdateAttempt({...first,state:"completed",updatedAt:new Date().toISOString(),completedAt:new Date().toISOString()});expect(completed.state).toBe("completed");
      const second=await db.createApplicationUpdateAttempt(attempt("applying"));expect((await db.listApplicationUpdateAttempts(10)).map(item=>item.id)).toEqual([second.id,first.id]);
    }finally{await db.close();}
  });
});
