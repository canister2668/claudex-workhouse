import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AppConfig } from "../../src/server/config.js";
import { DeckDatabase } from "../../src/server/db/client.js";
import { HostWorkspaceManager } from "../../src/server/host-workspaces.js";
import { persistConfiguredWorkspacePath } from "../../src/server/project-config-file.js";

const created:string[]=[];
afterEach(()=>{for(const item of created.splice(0))fs.rmSync(item,{recursive:true,force:true});});

describe("workspace path editing and project pipeline",()=>{
  it("validates a new path, persists the configured primary path, and honors pipeline order",async()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),"claudex-workhouse-workspace-edit-"));created.push(root);
    const original=path.join(root,"original"),alternate=path.join(root,"alternate"),secondary=path.join(root,"secondary"),blocked=path.join(root,"blocked"),outside=fs.mkdtempSync(path.join(os.tmpdir(),"claudex-workhouse-workspace-outside-"));created.push(outside);
    for(const directory of [original,alternate,secondary,blocked])fs.mkdirSync(directory);fs.mkdirSync(path.join(root,"config"));fs.writeFileSync(path.join(root,"config","projects.json"),`${JSON.stringify({projects:[{id:"project",name:"Project",path:original}]},null,2)}\n`);
    const config={root,host:"127.0.0.1",port:3410,externalOrigin:"https://example.com",allowedEmail:"owner@example.com",teamDomain:"https://example.cloudflareaccess.com",audience:"test",authMode:"test",promptMaxLength:20000,commandTimeoutMs:15000,commandOutputLimit:2*1024*1024,claudeBinary:"claude",dataDir:path.join(root,"data"),snapshotDir:path.join(root,"snapshots"),logDir:path.join(root,"logs"),runDir:path.join(root,"run"),dbPath:path.join(root,"deck.sqlite"),emotionStateFile:path.join(root,"data","emotion","state.json"),emotionAssetsDir:path.join(root,"app","public","emoticons"),emotionAssetBaseUrl:"https://example.com",workspaceRoots:[{path:root,displayName:"Test",allowCreate:true,allowRegister:true,allowClone:true,allowDelete:false}],projects:[{id:"project",name:"Project",path:original,realPath:original,enabled:true,error:null}]} satisfies AppConfig;
    const db=new DeckDatabase(path.resolve("src/server/db/sqlite-worker.py"),config.dbPath);await db.ping();
    try{
      const manager=new HostWorkspaceManager(config,db);await manager.initializeLocal();const workspace=(await db.listWorkspaces({projectId:"project"}))[0]!,rootRecord=(await db.listWorkspaceRoots("local")).find(item=>item.canonicalPath===root)!;
      const changed=await manager.updateLocalWorkspace(workspace.id,{displayName:"Alternate",rootId:rootRecord.id,canonicalPath:alternate});expect(changed).toMatchObject({pathChanged:true,workspace:{canonicalPath:alternate,displayName:"Alternate"}});
      expect(persistConfiguredWorkspacePath(config,"project",original,alternate)).toBe(true);expect(JSON.parse(fs.readFileSync(path.join(root,"config","projects.json"),"utf8")).projects[0].path).toBe(alternate);
      fs.symlinkSync(outside,path.join(root,"outside-link"),"dir");await expect(manager.updateLocalWorkspace(workspace.id,{displayName:"Escape",rootId:rootRecord.id,canonicalPath:path.join(root,"outside-link")})).rejects.toThrow(/exact real directory|symlink/i);
      const now=new Date().toISOString(),second=await db.upsertWorkspace({...workspace,id:"workspace-secondary",canonicalPath:secondary,relativePath:"secondary",displayName:"Secondary",createdAt:now,updatedAt:now});await db.putSystemSetting("project.workspace-pipeline.project",{workspaceIds:[second.id,workspace.id],version:1},now);expect((await manager.localWorkspaceForProject("project"))?.id).toBe(second.id);
      await db.upsertTask({id:"codex:active",provider:"codex",nativeId:"active",threadId:null,projectId:"project",title:"active",prompt:"",status:"running",createdAt:now,updatedAt:now,result:null,error:null,log:"",owned:true,pid:null,pgid:null,processStart:null,commandMarker:null,parentThreadId:null,executionHostId:"local",workspaceId:workspace.id});
      await expect(manager.updateLocalWorkspace(workspace.id,{displayName:"Blocked",rootId:rootRecord.id,canonicalPath:blocked})).rejects.toThrow(/active or unconfirmed/i);
    }finally{await db.close();}
  });
});
