import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach,describe,expect,it} from "vitest";
import {DeckDatabase} from "../../src/server/db/client.js";

const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
const tempRoot=()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),"refresh-rows-"));roots.push(root);return root;};
const task=(id:string,owned:boolean,metadata:Record<string,unknown>)=>({id,provider:"claude" as const,nativeId:id,threadId:id,providerSessionId:id,projectId:"project",cwd:"/workspace",title:id,prompt:"prompt",status:"completed" as const,createdAt:"2026-08-01T00:00:00.000Z",updatedAt:"2026-08-01T00:00:00.000Z",result:"result",error:null,log:"log",owned,pid:null,pgid:null,processStart:null,commandMarker:null,parentThreadId:null,ownership:owned?"claudex-workhouse":"external",source:owned?"claudex-workhouse":"cli",metadata});

describe("provider task refresh rows",()=>{
  it("returns external mirror metadata but omits owned-row metadata",async()=>{
    const root=tempRoot(),db=new DeckDatabase(path.resolve("src/server/db/sqlite-worker.py"),path.join(root,"workhouse.sqlite"));
    try{
      await db.ping();
      await db.upsertTask(task("claude:owned",true,{characterSnapshot:{directive:"x".repeat(4096)},gitAttribution:{observedFiles:["a.ts"]}}) as any);
      await db.upsertTask(task("claude:external:mirror",false,{customTitle:"Renamed"}) as any);
      const rows=new Map((await db.listProviderTaskRefreshRows("claude")).map(row=>[row.id,row]));
      expect(rows.get("claude:owned")).toMatchObject({owned:true,status:"completed",metadata:{},prompt:"",log:""});
      expect(rows.get("claude:external:mirror")).toMatchObject({owned:false,metadata:{customTitle:"Renamed"}});
      // The full row is untouched; only the refresh projection is trimmed.
      expect((await db.getTask("claude:owned"))?.metadata).toMatchObject({gitAttribution:{observedFiles:["a.ts"]}});
    }finally{await db.close();}
  });
});
