import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AppConfig } from "../../src/server/config.js";
import { DeckDatabase } from "../../src/server/db/client.js";
import { HostWorkspaceManager } from "../../src/server/host-workspaces.js";
import { emptyConfig } from "../../src/server/desktop-worker/config.js";
import { resolveWorkerWorkspaceDownload } from "../../src/server/desktop-worker/workspaces.js";
import { MAX_WORKSPACE_DOWNLOAD_BYTES } from "../../src/server/workspace-limits.js";

const created:string[]=[];
afterEach(()=>{for(const item of created.splice(0))fs.rmSync(item,{recursive:true,force:true});});

async function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"claudex-workhouse-download-"));created.push(root);
  const workspacePath=path.join(root,"workspace");fs.mkdirSync(workspacePath);
  const config={
    root,host:"127.0.0.1",port:3410,externalOrigin:"https://example.com",allowedEmail:"owner@example.com",teamDomain:"https://example.cloudflareaccess.com",audience:"test",authMode:"test",promptMaxLength:20000,commandTimeoutMs:15000,commandOutputLimit:2*1024*1024,claudeBinary:"claude",dataDir:path.join(root,"data"),snapshotDir:path.join(root,"snapshots"),logDir:path.join(root,"logs"),runDir:path.join(root,"run"),dbPath:path.join(root,"deck.sqlite"),emotionStateFile:path.join(root,"data","emotion","state.json"),emotionAssetsDir:path.join(root,"app","public","emoticons"),emotionAssetBaseUrl:"https://example.com",workspaceRoots:[{path:root,displayName:"Test",allowCreate:true,allowRegister:true,allowClone:true,allowDelete:false}],projects:[{id:"claudex-workhouse",name:"Claudex Workhouse",path:workspacePath,realPath:workspacePath,enabled:true,error:null}]
  } satisfies AppConfig;
  const db=new DeckDatabase(path.resolve("src/server/db/sqlite-worker.py"),config.dbPath);await db.ping();
  const manager=new HostWorkspaceManager(config,db);await manager.initializeLocal();
  const workspace=(await db.listWorkspaces({hostId:"local",projectId:"claudex-workhouse"}))[0]!;
  return{root,workspacePath,db,manager,workspace};
}

describe("workspace file download boundary",()=>{
  it("resolves a regular unicode-named file inside the active local workspace",async()=>{
    const x=await fixture();try{const dir=path.join(x.workspacePath,"releases");fs.mkdirSync(dir);const target=path.join(dir,"가이드.zip");fs.writeFileSync(target,"zip-content");const resolved=await x.manager.resolveWorkspaceDownload(x.workspace.id,"releases/가이드.zip");expect(resolved).toMatchObject({real:target,relative:path.join("releases","가이드.zip"),name:"가이드.zip",size:11});}finally{await x.db.close();}
  });

  it("rejects absolute paths, traversal, symlinks, and oversized files while allowing explicitly selected sensitive files",async()=>{
    const x=await fixture();try{
      const outside=path.join(x.root,"outside.zip");fs.writeFileSync(outside,"outside");
      await expect(x.manager.resolveWorkspaceDownload(x.workspace.id,outside)).rejects.toMatchObject({statusCode:400});
      await expect(x.manager.resolveWorkspaceDownload(x.workspace.id,"../outside.zip")).rejects.toMatchObject({statusCode:403});
      const link=path.join(x.workspacePath,"outside-link.zip");fs.symlinkSync(outside,link);await expect(x.manager.resolveWorkspaceDownload(x.workspace.id,"outside-link.zip")).rejects.toMatchObject({statusCode:403});
      fs.writeFileSync(path.join(x.workspacePath,".env"),"TOKEN=secret");expect(await x.manager.resolveWorkspaceDownload(x.workspace.id,".env")).toMatchObject({relative:".env",name:".env"});
      const previouslyTooLarge=path.join(x.workspacePath,"previously-too-large.bin");fs.closeSync(fs.openSync(previouslyTooLarge,"w"));fs.truncateSync(previouslyTooLarge,100*1024*1024+1);await expect(x.manager.resolveWorkspaceDownload(x.workspace.id,"previously-too-large.bin")).resolves.toMatchObject({size:100*1024*1024+1});
      const large=path.join(x.workspacePath,"large.bin");fs.closeSync(fs.openSync(large,"w"));fs.truncateSync(large,MAX_WORKSPACE_DOWNLOAD_BYTES+1);await expect(x.manager.resolveWorkspaceDownload(x.workspace.id,"large.bin")).rejects.toMatchObject({statusCode:413,code:"WORKSPACE_DOWNLOAD_TOO_LARGE"});
    }finally{await x.db.close();}
  });

  it("applies the same regular-file, traversal, symlink, and size boundary on a remote Worker",()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),"claudex-workhouse-worker-download-"));created.push(root);
    const workspacePath=path.join(root,"workspace");fs.mkdirSync(workspacePath);const config=emptyConfig(),rootId="root-1",workspaceId="workspace-1";
    config.roots=[{id:rootId,displayName:"Test",canonicalPath:root,allowCreate:true,allowRegister:true,allowClone:true,allowDelete:false}];
    config.workspaces=[{id:workspaceId,projectId:"project",hostId:"host",rootId,relativePath:"workspace",canonicalPath:workspacePath,displayName:"Workspace",workspaceType:"existing",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}];
    const dir=path.join(workspacePath,"releases");fs.mkdirSync(dir);const target=path.join(dir,"가이드.zip");fs.writeFileSync(target,"zip-content");
    expect(resolveWorkerWorkspaceDownload(config,workspaceId,"releases/가이드.zip")).toMatchObject({real:target,relativePath:path.join("releases","가이드.zip"),name:"가이드.zip",size:11});
    expect(()=>resolveWorkerWorkspaceDownload(config,workspaceId,"../outside.zip")).toThrow("escape");
    const outside=path.join(root,"outside.zip");fs.writeFileSync(outside,"outside");const link=path.join(workspacePath,"outside-link.zip");fs.symlinkSync(outside,link);
    expect(()=>resolveWorkerWorkspaceDownload(config,workspaceId,"outside-link.zip")).toThrow("Symbolic");
    const previouslyTooLarge=path.join(workspacePath,"previously-too-large.bin");fs.closeSync(fs.openSync(previouslyTooLarge,"w"));fs.truncateSync(previouslyTooLarge,100*1024*1024+1);
    expect(resolveWorkerWorkspaceDownload(config,workspaceId,"previously-too-large.bin")).toMatchObject({size:100*1024*1024+1});
    const large=path.join(workspacePath,"large.bin");fs.closeSync(fs.openSync(large,"w"));fs.truncateSync(large,MAX_WORKSPACE_DOWNLOAD_BYTES+1);
    expect(()=>resolveWorkerWorkspaceDownload(config,workspaceId,"large.bin")).toThrow("1024 MiB");
  });
});
