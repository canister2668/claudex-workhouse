import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { ClaudeProvider } from "../../src/server/providers/claude.js";
import { transcriptFile } from "../../src/server/claude-transcript.js";
import type { DeckTask } from "../../src/server/types.js";

const created:string[]=[];const originalHome=process.env.HOME;
afterEach(()=>{process.env.HOME=originalHome;for(const directory of created.splice(0))fs.rmSync(directory,{recursive:true,force:true});});

function task(threadId:string,status:DeckTask["status"]="completed"):DeckTask{return{id:`claude:external:${threadId}`,provider:"claude",nativeId:threadId,threadId,projectId:"project",title:"Claude session",prompt:"",status,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),result:null,error:null,log:"",owned:false,pid:null,pgid:null,processStart:null,commandMarker:null,parentThreadId:null,ownership:"external",source:"cli",cwd:"/tmp/project",executionHostId:"local"};}

describe("Claude session deletion",()=>{
  it("removes the native transcript and every indexed turn",async()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),"claudex-workhouse-claude-delete-"));created.push(root);process.env.HOME=path.join(root,"home");
    const threadId=crypto.randomUUID(),member=task(threadId),file=transcriptFile(member.cwd!,threadId);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,"{}\n");
    let deleted:{provider:string;threadId:string}|null=null;
    const db={listProviderTasks:async()=>[member,{...member,id:`claude:turn:${crypto.randomUUID()}`}],deleteTaskSession:async(provider:string,id:string)=>{deleted={provider,threadId:id};return 2;}};
    const provider=new ClaudeProvider({root,dataDir:path.join(root,"data")} as any,db as any);
    await expect(provider.deleteSession(member)).resolves.toMatchObject({deleted:true,deletedTasks:2,threadId});
    expect(fs.existsSync(file)).toBe(false);expect(deleted).toEqual({provider:"claude",threadId});
  });

  it("rejects active and remote sessions",async()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),"claudex-workhouse-claude-delete-"));created.push(root);const threadId=crypto.randomUUID(),active=task(threadId,"running");
    const db={listProviderTasks:async()=>[active],deleteTaskSession:async()=>0};const provider=new ClaudeProvider({root,dataDir:path.join(root,"data")} as any,db as any);
    await expect(provider.deleteSession(active)).rejects.toThrow(/Stop the Claude session/);
    await expect(provider.deleteSession({...task(crypto.randomUUID()),executionHostId:"worker"})).rejects.toThrow(/Remote Claude sessions/);
  });
});
