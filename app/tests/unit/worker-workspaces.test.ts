import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { emptyConfig, type WorkerConfig } from "../../src/server/desktop-worker/config.js";
import { addRoot, workspaceCommand } from "../../src/server/desktop-worker/workspaces.js";

const created:string[]=[];
afterEach(()=>{for(const item of created.splice(0))fs.rmSync(item,{recursive:true,force:true});});
function fixture(allowDelete=false){
  const parent=fs.mkdtempSync(path.join(os.tmpdir(),"claudex-workhouse-worker-workspaces-"));created.push(parent);
  const rootPath=path.join(parent,"root"),outside=path.join(parent,"outside");fs.mkdirSync(rootPath);fs.mkdirSync(outside);
  const config=emptyConfig() as WorkerConfig;const root=addRoot(config,rootPath,"Projects",allowDelete);const hostId=crypto.randomUUID();config.hostId=hostId;
  return{config,root,rootPath,outside,hostId};
}

describe("Desktop Worker workspace boundary",()=>{
  it("rejects traversal names and dangerous Git transports",async()=>{
    const x=fixture();
    await expect(workspaceCommand(x.config,"workspace.create",{rootId:x.root.id,projectId:"p",folderName:"../escape",mode:"empty"},x.hostId)).rejects.toThrow(/invalid workspace folder/i);
    await expect(workspaceCommand(x.config,"workspace.git.clone",{rootId:x.root.id,projectId:"p",folderName:"repo",repository:"file:///tmp/repo"},x.hostId)).rejects.toThrow(/transport/i);
    expect(fs.existsSync(path.join(path.dirname(x.rootPath),"escape"))).toBe(false);
  });

  it("does not enumerate a symlink that escapes the approved root",async()=>{
    const x=fixture();fs.symlinkSync(x.outside,path.join(x.rootPath,"outside-link"),"dir");fs.mkdirSync(path.join(x.rootPath,"inside"));
    const result=await workspaceCommand(x.config,"workspace.browse",{rootId:x.root.id},x.hostId) as any;
    expect(result.entries.map((item:any)=>item.name)).toEqual(["inside"]);
  });

  it("requires operator-enabled deletion and an exact confirmation",async()=>{
    const denied=fixture(false);let made=await workspaceCommand(denied.config,"workspace.create",{rootId:denied.root.id,projectId:"p",folderName:"keep",displayName:"Keep",mode:"empty"},denied.hostId) as any;
    await expect(workspaceCommand(denied.config,"workspace.delete",{workspaceId:made.workspace.id,confirmName:"Keep"},denied.hostId)).rejects.toThrow(/not permitted/i);
    expect(fs.existsSync(path.join(denied.rootPath,"keep"))).toBe(true);
    const allowed=fixture(true);made=await workspaceCommand(allowed.config,"workspace.create",{rootId:allowed.root.id,projectId:"p",folderName:"remove",displayName:"Remove",mode:"empty"},allowed.hostId) as any;
    await expect(workspaceCommand(allowed.config,"workspace.delete",{workspaceId:made.workspace.id,confirmName:"wrong"},allowed.hostId)).rejects.toThrow(/confirmation/i);
    allowed.config.tasks.push({id:"claude:active",provider:"claude",workspaceId:made.workspace.id,stateFile:path.join(allowed.rootPath,"state.json"),pid:null,marker:"test",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),status:"running",threadId:null,lastForwardedSequence:0});
    await expect(workspaceCommand(allowed.config,"workspace.delete",{workspaceId:made.workspace.id,confirmName:"Remove"},allowed.hostId)).rejects.toThrow(/active or unconfirmed/i);
    allowed.config.tasks[0]!.status="completed";
    expect(await workspaceCommand(allowed.config,"workspace.delete",{workspaceId:made.workspace.id,confirmName:"Remove"},allowed.hostId)).toEqual({deleted:true,filesDeleted:true});
    expect(fs.existsSync(path.join(allowed.rootPath,"remove"))).toBe(false);
  });

  it("updates a workspace path only inside an approved root while idle",async()=>{
    const x=fixture(),first=path.join(x.rootPath,"first"),second=path.join(x.rootPath,"second");fs.mkdirSync(first);fs.mkdirSync(second);
    const entry=(await workspaceCommand(x.config,"workspace.browse",{rootId:x.root.id},x.hostId) as any).entries.find((item:any)=>item.name==="first"),created=await workspaceCommand(x.config,"workspace.register",{rootId:x.root.id,projectId:"p",entryId:entry.id,displayName:"First"},x.hostId) as any;
    const updated=await workspaceCommand(x.config,"workspace.update",{workspaceId:created.workspace.id,rootId:x.root.id,canonicalPath:second,displayName:"Second"},x.hostId) as any;expect(updated).toMatchObject({pathChanged:true,workspace:{canonicalPath:second,displayName:"Second"}});
    x.config.tasks.push({id:"codex:active",provider:"codex",workspaceId:created.workspace.id,stateFile:path.join(x.rootPath,"state.json"),pid:null,marker:"active",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),status:"running",threadId:null,lastForwardedSequence:0});
    await expect(workspaceCommand(x.config,"workspace.update",{workspaceId:created.workspace.id,rootId:x.root.id,canonicalPath:first,displayName:"Blocked"},x.hostId)).rejects.toThrow(/active or unconfirmed/i);
  });

  it("reads files above five MiB in bounded chunks",async()=>{
    const x=fixture(),folder=path.join(x.rootPath,"large");fs.mkdirSync(folder);const rootEntry=(await workspaceCommand(x.config,"workspace.browse",{rootId:x.root.id},x.hostId) as any).entries.find((item:any)=>item.name==="large"),registered=await workspaceCommand(x.config,"workspace.register",{rootId:x.root.id,projectId:"p",entryId:rootEntry.id,displayName:"Large"},x.hostId) as any,target=path.join(folder,"large.txt");fs.writeFileSync(target,`start${"x".repeat(5*1024*1024-4)}`);const file=(await workspaceCommand(x.config,"workspace.files.browse",{workspaceId:registered.workspace.id},x.hostId) as any).entries.find((item:any)=>item.name==="large.txt"),opened=await workspaceCommand(x.config,"workspace.files.read",{workspaceId:registered.workspace.id,fileId:file.id,offset:0,limit:65536},x.hostId) as any,tail=await workspaceCommand(x.config,"workspace.files.read",{workspaceId:registered.workspace.id,fileId:file.id,offset:5*1024*1024,limit:65536},x.hostId) as any;expect(opened).toMatchObject({size:5*1024*1024+1,offset:0,nextOffset:65536,binary:false});expect(opened.content.startsWith("start")).toBe(true);expect(tail).toMatchObject({offset:5*1024*1024,nextOffset:null,content:"x",binary:false});
  });
});
