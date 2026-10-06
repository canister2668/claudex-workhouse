import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, it } from "vitest";
import { registerExternalParticipantRoutes } from "../../src/server/external-participant.js";
import { decodeEditableText, resolveWorkspaceTextPath, writeEditableTextFile } from "../../src/server/workspace-file-edit.js";
import type { DeckDatabase } from "../../src/server/db/client.js";
import type { HostWorkspaceManager } from "../../src/server/host-workspaces.js";

const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});

function harness(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"workhouse-participant-"));roots.push(root);
  const naiRoot=fs.mkdtempSync(path.join(os.tmpdir(),"nai-participant-"));roots.push(naiRoot);
  fs.mkdirSync(path.join(root,"docs"));fs.writeFileSync(path.join(root,"docs","guide.md"),"before\n");fs.writeFileSync(path.join(root,"docs",".env"),"private\n");
  fs.mkdirSync(path.join(naiRoot,"projects"));fs.writeFileSync(path.join(naiRoot,"projects","scene.md"),"scene before\n");
  let setting:{value:any;updatedAt:string}|null=null;
  const events:any[]=[];
  const db={
    getSystemSetting:async()=>setting,
    putSystemSettingIfUpdated:async(_key:string,value:any,updatedAt:string,expected:string|null)=>{if((setting?.updatedAt??null)!==expected)return{updated:false,current:setting};setting={value,updatedAt};return{updated:true,current:setting};},
    appendAudit:async()=>undefined,
    listBoardCards:async()=>[{id:"70e9b5b6-d65f-40f1-8f5e-94a0cc9ad27c",workspaceId:"test",boardVisible:true,archivedAt:null,title:"Review",description:"Review docs",boardStatus:"queued",priority:"normal",revision:1,updatedAt:new Date().toISOString()}],
    getWorkChain:async(id:string)=>id==="70e9b5b6-d65f-40f1-8f5e-94a0cc9ad27c"?{id,workspaceId:"test",boardVisible:true,archivedAt:null}:null,
    appendWorkChainEvent:async(event:any)=>{const found=events.find(item=>item.dedupeKey===event.dedupeKey);if(found)return{inserted:false,event:found};events.push(event);return{inserted:true,event};}
  } as unknown as DeckDatabase;
  const workspaceRoot=(id:string)=>id==="test"?root:id==="nai"?naiRoot:null;
  const workspaces={
    requireWorkspace:async(id:string)=>{const canonicalPath=workspaceRoot(id);if(!canonicalPath)throw Object.assign(new Error("missing"),{statusCode:404});return{id,hostId:"local",canonicalPath,archivedAt:null};},
    resolveWorkspaceFile:async(_id:string,input:{path:string})=>({entry:{id:input.path}}),
    readEditableWorkspaceFile:async(id:string,fileId:string)=>{const base=workspaceRoot(id)!;const file=resolveWorkspaceTextPath(base,base,fileId);return decodeEditableText(fs.readFileSync(file.real));},
    writeWorkspaceFile:async(id:string,input:{fileId:string;content:string;expectedRevision:string})=>{const base=workspaceRoot(id)!;const file=resolveWorkspaceTextPath(base,base,input.fileId);return writeEditableTextFile(file.real,input.content,input.expectedRevision);}
  } as unknown as HostWorkspaceManager;
  const app=Fastify();registerExternalParticipantRoutes(app,{db,workspaces,dataRoot:root});
  return{app,root,naiRoot,events};
}

describe("external participant scoped exchange",()=>{
  it("requires a token and enforces read, write and revision scopes",async()=>{
    const {app,root}=harness();try{
      const created=await app.inject({method:"POST",url:"/api/external-participants/grants",payload:{workspaceId:"test",readPaths:["docs"],writePaths:["docs/guide.md"]}});
      expect(created.statusCode).toBe(200);const {token,grant}=created.json();expect(grant.tokenHash).toBeUndefined();
      expect((await app.inject({method:"GET",url:"/external-participants/v1/assignments"})).statusCode).toBe(401);
      const headers={authorization:`Bearer ${token}`};
      const listed=await app.inject({method:"GET",url:"/external-participants/v1/files?directory=docs",headers});expect(listed.statusCode).toBe(200);expect(listed.json().entries.map((item:any)=>item.name)).toEqual(["guide.md"]);
      const read=await app.inject({method:"GET",url:"/external-participants/v1/file?path=docs/guide.md",headers});expect(read.statusCode).toBe(200);const revision=read.json().revision;
      expect((await app.inject({method:"GET",url:"/external-participants/v1/file?path=docs/.env",headers})).statusCode).toBe(403);
      expect((await app.inject({method:"PUT",url:"/external-participants/v1/file",headers,payload:{path:"docs/guide.md",content:"after",expectedRevision:crypto.randomBytes(32).toString("hex")}})).statusCode).toBe(409);
      expect((await app.inject({method:"PUT",url:"/external-participants/v1/file",headers,payload:{path:"docs/guide.md",content:"after",expectedRevision:revision}})).statusCode).toBe(200);
      expect(fs.readFileSync(path.join(root,"docs","guide.md"),"utf8")).toBe("after\n");
      expect((await app.inject({method:"POST",url:"/external-participants/v1/file",headers,payload:{path:"docs/new.html",content:"<p>x</p>"}})).statusCode).toBe(403);
      expect((await app.inject({method:"GET",url:"/external-participants/v1/file?path=docs%2F..%2Foutside",headers})).statusCode).toBeGreaterThanOrEqual(400);
    }finally{await app.close();}
  });

  it("creates only permitted new files and records idempotent handoffs",async()=>{
    const {app,root,events}=harness();try{
      const created=await app.inject({method:"POST",url:"/api/external-participants/grants",payload:{workspaceId:"test",readPaths:["docs"],writePaths:["docs"]}}),headers={authorization:`Bearer ${created.json().token}`};
      const first=await app.inject({method:"POST",url:"/external-participants/v1/file",headers,payload:{path:"docs/new.html",content:"<p>x</p>"}});expect(first.statusCode).toBe(200);
      expect((await app.inject({method:"POST",url:"/external-participants/v1/file",headers,payload:{path:"docs/new.html",content:"overwrite"}})).statusCode).toBe(409);
      expect(fs.readFileSync(path.join(root,"docs","new.html"),"utf8")).toBe("<p>x</p>");
      const body={kind:"handoff",content:"Ready for review",idempotencyKey:crypto.randomUUID()},url="/external-participants/v1/assignments/70e9b5b6-d65f-40f1-8f5e-94a0cc9ad27c/report";
      expect((await app.inject({method:"POST",url,headers,payload:body})).json().inserted).toBe(true);
      expect((await app.inject({method:"POST",url,headers,payload:body})).json().inserted).toBe(false);
      expect(events).toHaveLength(1);
    }finally{await app.close();}
  });

  it("exposes only explicitly mounted folders across local workspaces",async()=>{
    const {app,root,naiRoot}=harness();try{
      const created=await app.inject({method:"POST",url:"/api/external-participants/grants",payload:{workspaceId:"test",mounts:[
        {alias:"workhouse",workspaceId:"test",rootPath:"docs",readPaths:["guide.md"],writePaths:[]},
        {alias:"nai",workspaceId:"nai",rootPath:"projects",readPaths:["."],writePaths:["scene.md"]}
      ]}});
      expect(created.statusCode).toBe(200);const headers={authorization:`Bearer ${created.json().token}`};
      const top=await app.inject({method:"GET",url:"/external-participants/v1/files?directory=.",headers});
      expect(top.json().entries.map((entry:any)=>entry.name)).toEqual(["workhouse","nai"]);
      const listed=await app.inject({method:"GET",url:"/external-participants/v1/files?directory=workhouse",headers});
      expect(listed.json().entries.map((entry:any)=>entry.name)).toEqual(["guide.md"]);
      const naiFile=await app.inject({method:"GET",url:"/external-participants/v1/file?path=nai/scene.md",headers});
      expect(naiFile.json().content).toBe("scene before\n");
      expect((await app.inject({method:"GET",url:"/external-participants/v1/file?path=nai/.env",headers})).statusCode).toBe(403);
      expect((await app.inject({method:"GET",url:"/external-participants/v1/file?path=projects/scene.md",headers})).statusCode).toBe(403);
      expect((await app.inject({method:"PUT",url:"/external-participants/v1/file",headers,payload:{path:"workhouse/guide.md",content:"blocked",expectedRevision:(await app.inject({method:"GET",url:"/external-participants/v1/file?path=workhouse/guide.md",headers})).json().revision}})).statusCode).toBe(403);
      expect((await app.inject({method:"PUT",url:"/external-participants/v1/file",headers,payload:{path:"nai/scene.md",content:"scene after\n",expectedRevision:naiFile.json().revision}})).statusCode).toBe(200);
      expect(fs.readFileSync(path.join(naiRoot,"projects","scene.md"),"utf8")).toBe("scene after\n");
      expect(fs.readFileSync(path.join(root,"docs","guide.md"),"utf8")).toBe("before\n");
    }finally{await app.close();}
  });

  it("rejects duplicate aliases, secret roots and symlink mount roots",async()=>{
    const {app,root}=harness();try{
      const mount={alias:"docs",workspaceId:"test",rootPath:"docs",readPaths:["."],writePaths:[]};
      expect((await app.inject({method:"POST",url:"/api/external-participants/grants",payload:{workspaceId:"test",mounts:[mount,mount]}})).statusCode).toBe(400);
      expect((await app.inject({method:"POST",url:"/api/external-participants/grants",payload:{workspaceId:"test",mounts:[{...mount,rootPath:"data/secrets"}]}})).statusCode).toBe(403);
      fs.symlinkSync(path.join(root,"docs"),path.join(root,"linked-docs"));
      expect((await app.inject({method:"POST",url:"/api/external-participants/grants",payload:{workspaceId:"test",mounts:[{...mount,rootPath:"linked-docs"}]}})).statusCode).toBe(403);
    }finally{await app.close();}
  });

  it("stores only active grant tokens and runtime keys as owner-only files",async()=>{
    const {app,root}=harness();try{
      const created=await app.inject({method:"POST",url:"/api/external-participants/grants",payload:{workspaceId:"test",readPaths:["docs"]}}),token=created.json().token;
      const key="sk-proj-"+"a".repeat(40);
      expect((await app.inject({method:"PUT",url:"/api/external-participants/tunnel-token",payload:{participantToken:"whp_"+"a".repeat(43)}})).statusCode).toBe(403);
      expect((await app.inject({method:"PUT",url:"/api/external-participants/tunnel-token",payload:{participantToken:token}})).statusCode).toBe(200);
      expect((await app.inject({method:"PUT",url:"/api/external-participants/tunnel-key",payload:{apiKey:key}})).statusCode).toBe(200);
      const status=(await app.inject({method:"GET",url:"/api/external-participants/tunnel-status"})).json();
      expect(status).toEqual({runtimeKeyConfigured:true,participantTokenConfigured:true});
      const directory=path.join(root,"secrets","openai-participant");
      expect(fs.statSync(directory).mode&0o777).toBe(0o700);
      expect(fs.statSync(path.join(directory,"tunnel-runtime.key")).mode&0o777).toBe(0o600);
      expect(fs.statSync(path.join(directory,"participant.token")).mode&0o777).toBe(0o600);
      expect(fs.readFileSync(path.join(directory,"participant.token"),"utf8").trim()).toBe(token);
      expect((await app.inject({method:"POST",url:`/api/external-participants/grants/${created.json().grant.id}/revoke`})).statusCode).toBe(200);
      expect((await app.inject({method:"GET",url:"/api/external-participants/tunnel-status"})).json().participantTokenConfigured).toBe(false);
    }finally{await app.close();}
  });

  it("advertises scoped tools through the stdio MCP entrypoint",async()=>{
    const {app}=harness();let client:Client|null=null;try{
      const created=await app.inject({method:"POST",url:"/api/external-participants/grants",payload:{workspaceId:"test",readPaths:["docs"],writePaths:[]}}),origin=await app.listen({host:"127.0.0.1",port:0});
      client=new Client({name:"participant-test",version:"1.0.0"});
      await client.connect(new StdioClientTransport({command:process.execPath,args:["--import","tsx","src/server/external-participant-mcp.ts"],cwd:process.cwd(),env:{...process.env,CLAUDEX_PARTICIPANT_TOKEN:created.json().token,CLAUDEX_PARTICIPANT_ORIGIN:origin} as Record<string,string>,stderr:"pipe"}));
      const tools=await client.listTools();expect(tools.tools.map(tool=>tool.name)).toEqual(["get_capabilities","create_task","list_tasks","get_task","resume_task","list_assignments","list_files","read_file","write_file","create_file","submit_report"]);
      expect(tools.tools.find(tool=>tool.name==="write_file")?.annotations?.destructiveHint).toBe(true);
      const read=await client.callTool({name:"read_file",arguments:{path:"docs/guide.md"}});expect(JSON.stringify(read)).toContain("before");
    }finally{await client?.close();await app.close();}
  },30_000);
});
