import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AppConfig } from "../../src/server/config.js";
import { DeckDatabase } from "../../src/server/db/client.js";
import { HostWorkspaceManager,workspaceStableId } from "../../src/server/host-workspaces.js";

const created:string[]=[];
afterEach(()=>{for(const item of created.splice(0))fs.rmSync(item,{recursive:true,force:true});});

describe("configured project and workspace initialization",()=>{
  it("derives one Windows workspace id for path case variants",()=>{
    expect(workspaceStableId("project","C:\\Users\\Alice\\Work","win32")).toBe(workspaceStableId("project","c:\\users\\ALICE\\work","win32"));
  });
  it("preserves removed user projects while always restoring Claudex Workhouse",async()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),"claudex-workhouse-project-init-"));created.push(root);
    const deckPath=path.join(root,"claudex-workhouse"),risuPath=path.join(root,"risu");fs.mkdirSync(deckPath);fs.mkdirSync(risuPath);
    const config={
      root,host:"127.0.0.1",port:3410,externalOrigin:"https://example.com",allowedEmail:"owner@example.com",teamDomain:"https://example.cloudflareaccess.com",audience:"test",authMode:"test",promptMaxLength:20000,commandTimeoutMs:15000,commandOutputLimit:2*1024*1024,claudeBinary:"claude",dataDir:path.join(root,"data"),snapshotDir:path.join(root,"snapshots"),logDir:path.join(root,"logs"),runDir:path.join(root,"run"),dbPath:path.join(root,"deck.sqlite"),emotionStateFile:path.join(root,"data","emotion","state.json"),emotionAssetsDir:path.join(root,"app","public","emoticons"),emotionAssetBaseUrl:"https://example.com",workspaceRoots:[{path:root,displayName:"Test",allowCreate:true,allowRegister:true,allowClone:true,allowDelete:false}],projects:[
        {id:"claudex-workhouse",name:"Claudex Workhouse",path:deckPath,realPath:deckPath,enabled:true,error:null},
        {id:"risuai",name:"RisuAI",path:risuPath,realPath:risuPath,enabled:true,error:null}
      ]
    } satisfies AppConfig;
    const db=new DeckDatabase(path.resolve("src/server/db/sqlite-worker.py"),config.dbPath);await db.ping();
    const manager=new HostWorkspaceManager(config,db);await manager.initializeLocal();
    const initialProjects=await db.listProjects(),initialWorkspaces=await db.listWorkspaces({hostId:"local"}),now=new Date().toISOString();
    const risuProject=initialProjects.find(item=>item.id==="risuai")!,deckProject=initialProjects.find(item=>item.id==="claudex-workhouse")!,risuWorkspace=initialWorkspaces.find(item=>item.projectId==="risuai")!,deckWorkspace=initialWorkspaces.find(item=>item.projectId==="claudex-workhouse")!;
    await db.upsertProject({...risuProject,name:"Renamed Risu",updatedAt:now});await db.upsertWorkspace({...risuWorkspace,displayName:"Renamed Workspace",updatedAt:now});
    await manager.initializeLocal();
    expect((await db.listProjects()).find(item=>item.id==="risuai")?.name).toBe("Renamed Risu");
    expect((await db.listWorkspaces({hostId:"local",projectId:"risuai"}))[0]?.displayName).toBe("Renamed Workspace");
    await db.upsertProject({...risuProject,name:"Renamed Risu",updatedAt:now,archivedAt:now});await db.archiveWorkspace(risuWorkspace.id,now);
    await db.upsertProject({...deckProject,name:"Broken Workhouse",updatedAt:now,archivedAt:now});await db.archiveWorkspace(deckWorkspace.id,now);

    await manager.initializeLocal();
    const projects=await db.listProjects(),activeWorkspaces=await db.listWorkspaces({hostId:"local"});
    expect(projects.find(item=>item.id==="risuai")).toMatchObject({name:"Renamed Risu",archivedAt:now});
    expect(activeWorkspaces.some(item=>item.projectId==="risuai")).toBe(false);
    expect(projects.find(item=>item.id==="claudex-workhouse")).toMatchObject({name:"Claudex Workhouse",archivedAt:null});
    expect(activeWorkspaces.find(item=>item.projectId==="claudex-workhouse")).toMatchObject({canonicalPath:deckPath,displayName:"Claudex Workhouse",archivedAt:null});
    await db.close();
  });
});
