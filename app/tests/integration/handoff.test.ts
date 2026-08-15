import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { DeckDatabase } from "../../src/server/db/client.js";
import { HostWorkspaceManager } from "../../src/server/host-workspaces.js";
import { HandoffManager } from "../../src/server/handoff.js";
import { WorkerHub } from "../../src/server/worker-hub.js";
import type { DeckTask } from "../../src/server/types.js";

const created:string[]=[];
afterEach(()=>{for(const item of created.splice(0))fs.rmSync(item,{recursive:true,force:true});});
function git(cwd:string,args:string[]){const result=spawnSync("git",args,{cwd,shell:false,encoding:"utf8"});if(result.status!==0)throw new Error(result.stderr);}

describe("Handoff artifacts",()=>{
  it("redacts sensitive paths, creates a chain, and purges expired drafts",async()=>{
    const base=fs.mkdtempSync(path.join(os.tmpdir(),"claudex-workhouse-handoff-"));created.push(base);const workspacePath=path.join(base,"project");fs.mkdirSync(workspacePath);git(workspacePath,["init","-b","main"]);fs.writeFileSync(path.join(workspacePath,"README.md"),"hello\n");git(workspacePath,["add","README.md"]);git(workspacePath,["-c","user.name=Test","-c","user.email=test@example.invalid","commit","-m","initial"]);git(workspacePath,["remote","add","origin","https://token@example.invalid/repo.git?secret=yes"]);fs.writeFileSync(path.join(workspacePath,".env"),"TOKEN=secret\n");fs.writeFileSync(path.join(workspacePath,"change.txt"),"safe\n");
    const db=new DeckDatabase(path.resolve("src/server/db/sqlite-worker.py"),path.join(base,"db.sqlite"));await db.ping();const now=new Date().toISOString();await db.upsertHost({id:"local",type:"local",name:"local",displayName:"NAS",platform:"linux",architecture:"x64",operatingSystemVersion:null,workerVersion:null,status:"online",capabilities:{},lastSeenAt:now,createdAt:now,updatedAt:now,disabledAt:null,revokedAt:null});await db.upsertProject({id:"project",name:"Project",slug:"project",description:null,defaultProvider:null,createdAt:now,updatedAt:now,archivedAt:null});await db.upsertWorkspaceRoot({id:"root",hostId:"local",displayName:"Root",canonicalPath:workspacePath,allowCreate:false,allowRegister:false,allowClone:false,allowDelete:false,createdAt:now,verifiedAt:now,disabledAt:null});await db.upsertWorkspace({id:"workspace",projectId:"project",hostId:"local",rootId:"root",relativePath:".",canonicalPath:workspacePath,displayName:"Project",workspaceType:"existing",gitRemote:"https://token@example.invalid/repo.git?secret=yes",defaultBranch:"main",lastKnownCommit:null,lastGitStatus:null,lastVerifiedAt:now,createdAt:now,updatedAt:now,archivedAt:null});
    const source:DeckTask={id:"codex:source",provider:"codex",nativeId:"source",threadId:"source-thread",projectId:"project",title:"Source",prompt:"work",status:"completed",createdAt:now,updatedAt:now,result:"done",error:null,log:"",owned:true,pid:null,pgid:null,processStart:null,commandMarker:null,parentThreadId:null,executionHostId:"local",workspaceId:"workspace"};await db.upsertTask(source);
    let started:any=null;const config:any={root:base,dataDir:path.join(base,"data"),projects:[],workspaceRoots:[]};const workspaces=new HostWorkspaceManager(config,db),workers=new WorkerHub(db,base);const manager=new HandoffManager(base,db,workspaces,workers,async input=>{started=input;const target:DeckTask={...source,id:"claude:target",provider:"claude",nativeId:"target",threadId:"target-thread",title:"Target",prompt:input.prompt,status:"pending",sourceSessionId:"source-thread"};await db.upsertTask(target);return target;});
    try{
      const draft=await manager.create({sourceTaskId:source.id,targetHostId:"local",targetWorkspaceId:"workspace",targetProvider:"claude",targetModel:"claude-review",targetReasoningEffort:"high",kind:"review",includePatch:false,purpose:"review",completed:"done",tests:"unit",remaining:"none",warnings:"",lastDecision:"review"});expect(draft.markdown).not.toContain(".env");expect(draft.markdown).not.toContain("token@");expect(draft.manifest.changedFiles).not.toContain(".env");expect(draft.manifest).toMatchObject({schemaVersion:2,targetExecution:{provider:"claude",model:"claude-review",reasoningEffort:"high",serviceTier:null}});expect(draft.artifact.targetExecution).toMatchObject({model:"claude-review",reasoningEffort:"high"});expect(draft.warnings.join(" ")).toContain("민감 가능 파일명");expect((await manager.validate(draft.artifact.id)).ok).toBe(true);const delivered=await manager.execute(draft.artifact.id);expect(started).toMatchObject({targetProvider:"claude",targetModel:"claude-review",targetReasoningEffort:"high",targetServiceTier:null,kind:"review"});expect(delivered.targetTask.sourceSessionId).toBe("source-thread");expect((await manager.chain(delivered.chainId)).links).toHaveLength(1);
      await db.putSystemSetting("ui.locale",{locale:"ja"},new Date().toISOString());
      const expiring=await manager.create({sourceTaskId:source.id,targetHostId:"local",targetWorkspaceId:"workspace",targetProvider:"claude",kind:"review",includePatch:false,purpose:"expire",completed:"",tests:"",remaining:"",warnings:"",lastDecision:""});expect(expiring.markdown).toContain("# 作業引き継ぎ");expect(expiring.manifest.locale).toBe("ja");const directory=path.join(base,"data","handoffs","project",expiring.artifact.id);expect(fs.existsSync(directory)).toBe(true);expect((await manager.expire(expiring.artifact.id)).contentPurged).toBe(true);expect(fs.existsSync(directory)).toBe(false);
    }finally{workers.shutdown();await db.close();}
  },10_000);
});
