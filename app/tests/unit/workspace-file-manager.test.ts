import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach,describe,expect,it} from "vitest";
import type {AppConfig} from "../../src/server/config.js";
import {DeckDatabase} from "../../src/server/db/client.js";
import {HostWorkspaceManager} from "../../src/server/host-workspaces.js";

const created:string[]=[];
afterEach(()=>{for(const item of created.splice(0))fs.rmSync(item,{recursive:true,force:true});});

async function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"claudex-workhouse-file-manager-"));created.push(root);const workspacePath=path.join(root,"workspace"),nested=path.join(workspacePath,"app");fs.mkdirSync(nested,{recursive:true});
  const config={root,host:"127.0.0.1",port:3410,externalOrigin:"https://example.com",allowedEmail:"owner@example.com",teamDomain:"https://example.cloudflareaccess.com",audience:"test",authMode:"test",promptMaxLength:20000,commandTimeoutMs:15000,commandOutputLimit:2*1024*1024,claudeBinary:"claude",dataDir:path.join(root,"data"),snapshotDir:path.join(root,"snapshots"),logDir:path.join(root,"logs"),runDir:path.join(root,"run"),dbPath:path.join(root,"deck.sqlite"),emotionStateFile:path.join(root,"data","emotion","state.json"),emotionAssetsDir:path.join(root,"app","public","emoticons"),emotionAssetBaseUrl:"https://example.com",workspaceRoots:[{path:root,displayName:"Test",allowCreate:true,allowRegister:true,allowClone:true,allowDelete:false}],projects:[{id:"project",name:"Project",path:workspacePath,realPath:workspacePath,enabled:true,error:null}]} satisfies AppConfig;
  const db=new DeckDatabase(path.resolve("src/server/db/sqlite-worker.py"),config.dbPath);await db.ping();const manager=new HostWorkspaceManager(config,db);await manager.initializeLocal();const workspace=(await db.listWorkspaces({projectId:"project"}))[0]!,now=new Date().toISOString();
  await db.upsertTask({id:"codex:file-source",provider:"codex",nativeId:"file-source",threadId:"thread",projectId:"project",title:"source",prompt:"",status:"completed",createdAt:now,updatedAt:now,result:null,error:null,log:"",owned:true,pid:null,pgid:null,processStart:null,commandMarker:null,parentThreadId:null,executionHostId:"local",workspaceId:workspace.id,cwd:nested});
  return{config,db,manager,workspace,workspacePath,nested};
}

describe("HostWorkspaceManager editable files",()=>{
  it("resolves task-cwd paths, reads revisions, and requires CAS for overwrite",async()=>{
    const x=await fixture();try{const target=path.join(x.nested,"file.txt");fs.writeFileSync(target,"base\n");const resolved=await x.manager.resolveWorkspaceFile(x.workspace.id,{path:"file.txt",pathBase:"task-cwd",sourceTaskId:"codex:file-source"});expect(resolved.entry.relativePath).toBe(path.join("app","file.txt"));
      const opened=await x.manager.readEditableWorkspaceFile(x.workspace.id,resolved.entry.id);expect(opened.content).toBe("base\n");fs.writeFileSync(target,"agent\n");await expect(x.manager.writeWorkspaceFile(x.workspace.id,{fileId:resolved.entry.id,content:"human\n",expectedRevision:opened.revision})).rejects.toMatchObject({statusCode:409,code:"FILE_VERSION_CONFLICT"});
      const latest=await x.manager.readEditableWorkspaceFile(x.workspace.id,resolved.entry.id),saved=await x.manager.writeWorkspaceFile(x.workspace.id,{fileId:resolved.entry.id,content:"human\n",expectedRevision:opened.revision,expectedCurrentRevision:latest.revision});expect(saved.revision).not.toBe(latest.revision);expect(fs.readFileSync(target,"utf8")).toBe("human\n");
    }finally{await x.db.close();}
  });

  it("re-resolves after manager restart, allows explicit sensitive-file access, and still blocks git metadata",async()=>{
    const x=await fixture();try{fs.writeFileSync(path.join(x.workspacePath,"plain.txt"),"plain");fs.writeFileSync(path.join(x.workspacePath,".env"),"TOKEN=x");fs.mkdirSync(path.join(x.workspacePath,".git"));fs.writeFileSync(path.join(x.workspacePath,".git","config"),"x");const old=await x.manager.resolveWorkspaceFile(x.workspace.id,{path:"plain.txt",pathBase:"workspace"});const restarted=new HostWorkspaceManager(x.config,x.db);await expect(restarted.readEditableWorkspaceFile(x.workspace.id,old.entry.id)).rejects.toThrow(/Invalid directory entry/);const fresh=await restarted.resolveWorkspaceFile(x.workspace.id,{path:"plain.txt",pathBase:"workspace"});expect((await restarted.readEditableWorkspaceFile(x.workspace.id,fresh.entry.id)).content).toBe("plain");await expect(restarted.resolveWorkspaceFile(x.workspace.id,{path:".git/config",pathBase:"workspace"})).rejects.toMatchObject({code:"GIT_METADATA_EDIT_BLOCKED"});const sensitive=await restarted.resolveWorkspaceFile(x.workspace.id,{path:".env",pathBase:"workspace"}),opened=await restarted.readEditableWorkspaceFile(x.workspace.id,sensitive.entry.id);expect(opened.content).toBe("TOKEN=x");await restarted.writeWorkspaceFile(x.workspace.id,{fileId:sensitive.entry.id,content:"TOKEN=y",expectedRevision:opened.revision});expect(fs.readFileSync(path.join(x.workspacePath,".env"),"utf8")).toBe("TOKEN=y");}finally{await x.db.close();}
  });
  it("reads files above five MiB through the existing bounded chunk protocol",async()=>{
    const x=await fixture();try{const target=path.join(x.workspacePath,"large.txt");fs.writeFileSync(target,`start${"x".repeat(5*1024*1024-4)}`);const entry=(await x.manager.browseWorkspace(x.workspace.id)).entries.find(item=>item.name==="large.txt")!,opened=await x.manager.readWorkspaceFile(x.workspace.id,entry.id,0,65536),tail=await x.manager.readWorkspaceFile(x.workspace.id,entry.id,5*1024*1024,65536);expect(opened).toMatchObject({relativePath:"large.txt",size:5*1024*1024+1,offset:0,nextOffset:65536,binary:false});expect(opened.content?.startsWith("start")).toBe(true);expect(tail).toMatchObject({offset:5*1024*1024,nextOffset:null,content:"x",binary:false});}finally{await x.db.close();}
  });
  it("creates a new Markdown conclusion without allowing overwrite or escape",async()=>{
    const x=await fixture();try{fs.mkdirSync(path.join(x.workspacePath,"docs"));const target=path.join(x.workspacePath,"docs","conclusion.md"),created=await x.manager.createWorkspaceMarkdown(x.workspace.id,"docs/conclusion.md","# Conclusion");expect(created.relativePath).toBe("docs/conclusion.md");expect(fs.readFileSync(target,"utf8")).toBe("# Conclusion\n");await expect(x.manager.createWorkspaceMarkdown(x.workspace.id,"docs/conclusion.md","again")).rejects.toMatchObject({code:"MARKDOWN_ALREADY_EXISTS"});await expect(x.manager.createWorkspaceMarkdown(x.workspace.id,"../escape.md","no")).rejects.toMatchObject({code:"WORKSPACE_PATH_ESCAPE"});await expect(x.manager.createWorkspaceMarkdown(x.workspace.id,"docs/result.txt","no")).rejects.toMatchObject({code:"MARKDOWN_PATH_REQUIRED"});fs.writeFileSync(target,"changed\n");await expect(x.manager.deleteWorkspaceMarkdown(x.workspace.id,"docs/conclusion.md",created.revision)).rejects.toMatchObject({code:"CONCLUSION_FILE_CHANGED"});expect(fs.existsSync(target)).toBe(true);const replacement=await x.manager.createWorkspaceMarkdown(x.workspace.id,"docs/second.md","# Second");await expect(x.manager.deleteWorkspaceMarkdown(x.workspace.id,"docs/second.md",replacement.revision)).resolves.toMatchObject({deleted:true,relativePath:"docs/second.md"});expect(fs.existsSync(path.join(x.workspacePath,"docs","second.md"))).toBe(false);}finally{await x.db.close();}
  });
});
