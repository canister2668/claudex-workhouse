import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach,describe,expect,it} from "vitest";
import type {AppConfig} from "../../src/server/config.js";
import {DeckDatabase} from "../../src/server/db/client.js";
import {HostWorkspaceManager,MAX_HTML_PREVIEW_BYTES} from "../../src/server/host-workspaces.js";

const created:string[]=[];
afterEach(()=>{for(const item of created.splice(0))fs.rmSync(item,{recursive:true,force:true});});

async function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"claudex-workhouse-html-preview-"));created.push(root);
  const workspacePath=path.join(root,"workspace");fs.mkdirSync(workspacePath);
  const config={
    root,host:"127.0.0.1",port:3410,externalOrigin:"https://example.com",allowedEmail:"owner@example.com",teamDomain:"https://example.cloudflareaccess.com",audience:"test",authMode:"test",promptMaxLength:20000,commandTimeoutMs:15000,commandOutputLimit:2*1024*1024,claudeBinary:"claude",dataDir:path.join(root,"data"),snapshotDir:path.join(root,"snapshots"),logDir:path.join(root,"logs"),runDir:path.join(root,"run"),dbPath:path.join(root,"deck.sqlite"),emotionStateFile:path.join(root,"data","emotion","state.json"),emotionAssetsDir:path.join(root,"app","public","emoticons"),emotionAssetBaseUrl:"https://example.com",workspaceRoots:[{path:root,displayName:"Test",allowCreate:true,allowRegister:true,allowClone:true,allowDelete:false}],projects:[{id:"claudex-workhouse",name:"Claudex Workhouse",path:workspacePath,realPath:workspacePath,enabled:true,error:null}]
  } satisfies AppConfig;
  const db=new DeckDatabase(path.resolve("src/server/db/sqlite-worker.py"),config.dbPath);await db.ping();
  const manager=new HostWorkspaceManager(config,db);await manager.initializeLocal();
  const workspace=(await db.listWorkspaces({hostId:"local",projectId:"claudex-workhouse"}))[0]!;
  const entry=async(name:string)=>(await manager.browseWorkspace(workspace.id)).entries.find(item=>item.name===name)!;
  return{root,workspacePath,db,manager,workspace,entry};
}

describe("local workspace HTML preview reads",()=>{
  it("returns one bounded UTF-8 HTML snapshot with a stable revision",async()=>{
    const x=await fixture();try{
      fs.writeFileSync(path.join(x.workspacePath,"guide.html"),"\ufeff<!doctype html><p>안녕</p>");
      const file=await x.entry("guide.html"),result=await x.manager.readHtmlPreview(x.workspace.id,file.id);
      expect(result).toMatchObject({relativePath:"guide.html",content:"<!doctype html><p>안녕</p>",byteLength:31});
      expect(result.revision).toMatch(/^[a-f0-9]{64}$/);
    }finally{await x.db.close();}
  });

  it("rejects extensions, oversized content, invalid UTF-8, and sensitive HTML without confirmation",async()=>{
    const x=await fixture();try{
      fs.writeFileSync(path.join(x.workspacePath,"guide.txt"),"<p>text</p>");
      fs.writeFileSync(path.join(x.workspacePath,"invalid.html"),Buffer.from([0xff,0xfe,0x00]));
      fs.writeFileSync(path.join(x.workspacePath,"secrets.html"),"<p>secret</p>");
      const large=path.join(x.workspacePath,"large.html");fs.closeSync(fs.openSync(large,"w"));fs.truncateSync(large,MAX_HTML_PREVIEW_BYTES+1);
      await expect(x.manager.readHtmlPreview(x.workspace.id,(await x.entry("guide.txt")).id)).rejects.toMatchObject({code:"HTML_PREVIEW_EXTENSION_REQUIRED"});
      await expect(x.manager.readHtmlPreview(x.workspace.id,(await x.entry("large.html")).id)).rejects.toMatchObject({code:"HTML_PREVIEW_TOO_LARGE"});
      await expect(x.manager.readHtmlPreview(x.workspace.id,(await x.entry("invalid.html")).id)).rejects.toMatchObject({code:"HTML_PREVIEW_INVALID_UTF8"});
      const sensitive=await x.entry("secrets.html");
      await expect(x.manager.readHtmlPreview(x.workspace.id,sensitive.id)).rejects.toMatchObject({code:"HTML_PREVIEW_SENSITIVE_CONFIRMATION_REQUIRED"});
      await expect(x.manager.readHtmlPreview(x.workspace.id,sensitive.id,true)).resolves.toMatchObject({content:"<p>secret</p>"});
    }finally{await x.db.close();}
  });

  it("rejects a path replaced by a symlink and an archived workspace",async()=>{
    const x=await fixture();try{
      const target=path.join(x.workspacePath,"guide.html"),outside=path.join(x.root,"outside.html");fs.writeFileSync(target,"<p>inside</p>");fs.writeFileSync(outside,"<p>outside</p>");
      const file=await x.entry("guide.html");fs.unlinkSync(target);fs.symlinkSync(outside,target);
      await expect(x.manager.readHtmlPreview(x.workspace.id,file.id)).rejects.toMatchObject({statusCode:403});
      fs.unlinkSync(target);fs.writeFileSync(target,"<p>inside</p>");
      await x.db.archiveWorkspace(x.workspace.id,new Date().toISOString());
      await expect(x.manager.readHtmlPreview(x.workspace.id,file.id)).rejects.toMatchObject({statusCode:404});
    }finally{await x.db.close();}
  });
});
