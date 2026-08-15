import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach,describe,expect,it} from "vitest";
import {DeckDatabase} from "../../src/server/db/client.js";
import {ClaudeProvider} from "../../src/server/providers/claude.js";

const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
const tempRoot=()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),"claude-mirror-healing-"));roots.push(root);return root;};
const task=(id:string,threadId:string,owned:boolean)=>({id,provider:"claude" as const,nativeId:id,threadId,providerSessionId:threadId,projectId:"project",cwd:"/workspace",title:id,prompt:"",status:"completed" as const,createdAt:"2026-08-01T00:00:00.000Z",updatedAt:"2026-08-01T00:00:00.000Z",result:null,error:null,log:"",owned,pid:null,pgid:null,processStart:null,commandMarker:null,parentThreadId:null,ownership:owned?"claudex-workhouse":"external",source:owned?"claudex-workhouse":"cli",metadata:{}});

describe("Claude external mirror healing",()=>{
  it("deletes only the exact external mirror and preserves every owned turn",async()=>{
    const root=tempRoot(),db=new DeckDatabase(path.resolve("src/server/db/sqlite-worker.py"),path.join(root,"workhouse.sqlite"));
    try{
      await db.ping();const threadId=crypto.randomUUID(),ownedA=task(`claude:${crypto.randomUUID()}`,threadId,true),ownedB=task(`claude:${crypto.randomUUID()}`,threadId,true),mirror=task(`claude:external:${threadId}`,threadId,false);
      await db.upsertTask(ownedA);await db.upsertTask(ownedB);await db.upsertTask(mirror);
      await expect(db.deleteExternalTaskMirror("claude",ownedA.id,threadId)).resolves.toBe(false);
      await expect(db.deleteExternalTaskMirror("claude",mirror.id,threadId)).resolves.toBe(true);
      expect((await db.listProviderTasks("claude")).map(row=>row.id).sort()).toEqual([ownedA.id,ownedB.id].sort());
    }finally{await db.close();}
  });

  it("persists a generated session ID before spawning a new Claude worker",async()=>{
    const root=tempRoot(),worker=path.join(root,"app","dist-server","claude-worker.js"),observed=path.join(root,"worker.json");fs.mkdirSync(path.dirname(worker),{recursive:true});
    fs.writeFileSync(worker,`require("node:fs").writeFileSync(${JSON.stringify(observed)},JSON.stringify({sessionId:process.env.CLAUDEX_WORKHOUSE_CLAUDE_SESSION_ID,argv:process.argv.slice(2)}));`);
    const writes:any[]=[],db={getSystemSetting:async()=>null,deleteExternalTaskMirror:async()=>false,upsertTask:async(value:any)=>{writes.push(structuredClone(value));return value;}};
    const provider=new ClaudeProvider({root,appRoot:root,dataRoot:root,dataDir:path.join(root,"data"),tempDir:path.join(root,"tmp"),port:3410,claudeBinary:"/bin/false",projects:[]} as any,db as any),project={id:"project",name:"project",path:root,realPath:root,enabled:true,error:null};
    const created=await provider.createTask({project,prompt:"hello"} as any);
    expect(created.threadId).toMatch(/^[0-9a-f-]{36}$/i);expect(created.providerSessionId).toBe(created.threadId);
    expect(writes[0]).toMatchObject({threadId:created.threadId,providerSessionId:created.threadId,pid:null,owned:true});
    expect(writes[1].pid).toEqual(expect.any(Number));
    await expect.poll(()=>{
      try{return JSON.parse(fs.readFileSync(observed,"utf8")).sessionId;}catch{return null;}
    },{timeout:5_000}).toBe(created.threadId);
  });
});
