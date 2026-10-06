import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach,describe,expect,it } from "vitest";
import { DeckDatabase } from "../../src/server/db/client.js";
import { registerExternalParticipantRoutes } from "../../src/server/external-participant.js";
import type { ExternalParticipantExecutor } from "../../src/server/external-participant-tasks.js";
import type { DeckTask } from "../../src/server/types.js";
import type { HostWorkspaceManager } from "../../src/server/host-workspaces.js";

const cleanups:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup();});
async function harness(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"workhouse-external-task-"));
  const db=new DeckDatabase(path.resolve("src/server/db/sqlite-worker.py"),path.join(root,"fixture.sqlite"));
  await db.ping();const now=new Date().toISOString();
  await db.upsertProject({id:"test",name:"Test",slug:"test",description:null,defaultProvider:null,createdAt:now,updatedAt:now,archivedAt:null});
  let archived=false,starts=0,resumes=0;
  const workspaces={requireWorkspace:async(id:string)=>{if(id!=="test")throw Object.assign(new Error("missing"),{statusCode:404});return{id,projectId:"test",hostId:"local",canonicalPath:root,archivedAt:archived?now:null};}} as unknown as HostWorkspaceManager;
  const task=(id:string,threadId:string|null=crypto.randomUUID()):DeckTask=>({id,nativeId:id,provider:"codex",threadId,projectId:"test",title:"Fixture",prompt:"fixture",status:"running",createdAt:now,updatedAt:now,result:null,error:null,log:"fixture",owned:true,pid:null,pgid:null,processStart:null,commandMarker:null,parentThreadId:null,ownership:"claudex-workhouse",source:"claudex-workhouse",executionHostId:"local",workspaceId:"test",permissionProfile:":workspace",metadata:{automationLevel:"auto"}});
  const executor:ExternalParticipantExecutor={
    create:async input=>{starts++;return{...task(`codex:deck:${input.nativeId}`),provider:input.execution.provider,prompt:input.prompt,title:input.title??"Fixture",metadata:{automationLevel:input.execution.automationLevel}};},
    refresh:async item=>(await db.getTask(item.id))!,
    resume:async(item,prompt)=>{resumes++;return{...item,id:`codex:deck:${crypto.randomUUID()}`,status:"running",prompt,result:null};}
  };
  const apps:ReturnType<typeof Fastify>[]=[];
  const newApp=()=>{const app=Fastify();registerExternalParticipantRoutes(app,{db,workspaces,dataRoot:root,executor});apps.push(app);return app;};
  const app=newApp();
  cleanups.push(async()=>{for(const server of apps)await server.close();await db.close();fs.rmSync(root,{recursive:true,force:true});});
  const grant=async(execution:unknown={provider:"codex",automationLevel:"auto",maxActiveTasks:1})=>{
    const response=await app.inject({method:"POST",url:"/api/external-participants/grants",payload:{workspaceId:"test",readPaths:["docs"],execution}});
    expect(response.statusCode).toBe(200);return{...response.json(),headers:{authorization:`Bearer ${response.json().token}`}};
  };
  const create=(headers:Record<string,string>,prompt="Implement fixture",key=crypto.randomUUID())=>app.inject({method:"POST",url:"/external-participants/v1/tasks",headers,payload:{prompt,idempotencyKey:key}});
  return{root,db,app,executor,newApp,grant,create,task,counts:()=>({starts,resumes}),archive:()=>archived=true};
}

describe("external participant provider tasks",()=>{
  it("keeps legacy file grants unable to launch or inspect tasks",async()=>{
    const h=await harness(),g=await h.grant(null);
    expect((await h.app.inject({method:"GET",url:"/external-participants/v1/capabilities",headers:g.headers})).json().execution).toBeNull();
    expect((await h.create(g.headers)).statusCode).toBe(403);
    expect((await h.app.inject({method:"GET",url:"/external-participants/v1/tasks",headers:g.headers})).statusCode).toBe(403);
    expect((await h.create({})).statusCode).toBe(401);expect(h.counts().starts).toBe(0);
  });
  it("persists ownership and idempotency across a server instance replacement",async()=>{
    const h=await harness(),g=await h.grant(),key=crypto.randomUUID();
    const first=await h.create(g.headers,"Implement fixture",key);expect(first.statusCode).toBe(200);
    const stored=await h.db.getTask(first.json().task.taskId);expect(stored?.metadata?.externalParticipantGrantId).toBe(g.grant.id);
    const app=h.newApp(),replay=await app.inject({method:"POST",url:"/external-participants/v1/tasks",headers:g.headers,payload:{prompt:"Implement fixture",idempotencyKey:key}});
    expect(replay.json()).toMatchObject({replayed:true,task:{taskId:first.json().task.taskId}});expect(h.counts().starts).toBe(1);
    expect((await h.create(g.headers,"Different request",key)).statusCode).toBe(409);
  });
  it("serializes simultaneous submissions and enforces active-task capacity",async()=>{
    const h=await harness(),g=await h.grant();
    const responses=await Promise.all([h.create(g.headers,"A"),h.create(g.headers,"B")]);
    expect(responses.map(item=>item.statusCode).sort()).toEqual([200,409]);expect(h.counts().starts).toBe(1);
    const running=(await h.db.listTasks())[0];await h.db.upsertTask({...running,status:"completed",result:"Done"});
    expect((await h.create(g.headers,"Next work")).statusCode).toBe(200);
  });
  it("denies other grants and unrelated owned tasks, including after refresh",async()=>{
    const h=await harness(),a=await h.grant(),b=await h.grant(),first=await h.create(a.headers),taskId=first.json().task.taskId;
    expect((await h.app.inject({method:"GET",url:`/external-participants/v1/tasks/${taskId}`,headers:b.headers})).statusCode).toBe(404);
    await h.db.upsertTask(h.task("codex:deck:unrelated"));
    expect((await h.app.inject({method:"GET",url:"/external-participants/v1/tasks/codex:deck:unrelated",headers:a.headers})).statusCode).toBe(404);
    expect((await h.app.inject({method:"GET",url:"/external-participants/v1/tasks",headers:a.headers})).json().tasks).toHaveLength(1);
    h.executor.refresh=async task=>({...task,workspaceId:"elsewhere"});
    expect((await h.app.inject({method:"GET",url:`/external-participants/v1/tasks/${taskId}`,headers:a.headers})).statusCode).toBe(409);
  });
  it("resumes only terminal threads and does not repeat a follow-up",async()=>{
    const h=await harness(),g=await h.grant(),first=await h.create(g.headers),taskId=first.json().task.taskId,url=`/external-participants/v1/tasks/${taskId}/messages`;
    expect((await h.app.inject({method:"POST",url,headers:g.headers,payload:{prompt:"Revise",idempotencyKey:crypto.randomUUID()}})).statusCode).toBe(409);
    const source=(await h.db.getTask(taskId))!;await h.db.upsertTask({...source,status:"completed",result:"Implemented"});
    const payload={prompt:"Revise",idempotencyKey:crypto.randomUUID()},next=await h.app.inject({method:"POST",url,headers:g.headers,payload});
    expect(next.statusCode).toBe(200);expect(next.json().task.taskId).not.toBe(taskId);
    expect((await h.app.inject({method:"POST",url,headers:g.headers,payload})).json().replayed).toBe(true);expect(h.counts().resumes).toBe(1);
    const resumed=(await h.db.getTask(next.json().task.taskId))!;
    await h.db.upsertTask({...resumed,status:"completed",metadata:{...resumed.metadata,automationLevel:"full"}});
    expect((await h.app.inject({method:"POST",url:`/external-participants/v1/tasks/${resumed.id}/messages`,headers:g.headers,payload:{prompt:"Escalate",idempotencyKey:crypto.randomUUID()}})).statusCode).toBe(409);
  });
  it("honors revocation, expiry and archived workspace before execution",async()=>{
    const h=await harness(),a=await h.grant();
    await h.app.inject({method:"POST",url:`/api/external-participants/grants/${a.grant.id}/revoke`});
    expect((await h.create(a.headers)).statusCode).toBe(401);
    const b=await h.grant(),setting=(await h.db.getSystemSetting("external-participant.grants.v1"))!;
    const value=setting.value as any;value.grants.find((grant:any)=>grant.id===b.grant.id).expiresAt="2000-01-01T00:00:00.000Z";
    await h.db.putSystemSetting("external-participant.grants.v1",value,new Date().toISOString());
    expect((await h.create(b.headers)).statusCode).toBe(401);
    const c=await h.grant();h.archive();expect((await h.create(c.headers)).statusCode).toBe(403);expect(h.counts().starts).toBe(0);
  });
  it("rejects participant-selected workspace, model, provider and full access",async()=>{
    const h=await harness(),g=await h.grant();
    for(const extra of [{workspaceId:"other"},{model:"invented"},{provider:"claude"},{automationLevel:"full"}])expect((await h.app.inject({method:"POST",url:"/external-participants/v1/tasks",headers:g.headers,payload:{prompt:"work",idempotencyKey:crypto.randomUUID(),...extra}})).statusCode).toBeGreaterThanOrEqual(400);
    expect(h.counts().starts).toBe(0);
  });
  it("leaves stale unresolved dispatches unrepeated and replays failures",async()=>{
    const h=await harness(),g=await h.grant(),idempotencyKey=crypto.randomUUID(),body={prompt:"work",idempotencyKey};
    await h.db.claimIdempotency({key:idempotencyKey,action:`external-task:${g.grant.id}:create`,requestHash:crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex"),ownerToken:"old-instance",now:"2000-01-01T00:00:00.000Z"});
    expect((await h.create(g.headers,"work",idempotencyKey)).json().code).toBe("EXTERNAL_TASK_PENDING");expect(h.counts().starts).toBe(0);
    h.executor.create=async()=>{throw Object.assign(new Error("Provider unavailable"),{statusCode:503});};
    const failedKey=crypto.randomUUID();expect((await h.create(g.headers,"work",failedKey)).statusCode).toBe(503);
    h.executor.create=async()=>{throw new Error("Must not run again");};
    expect((await h.create(g.headers,"work",failedKey)).json().message).toBe("Provider unavailable");
  });
  it("bounds and redacts results without exposing internal metadata or logs",async()=>{
    const h=await harness(),g=await h.grant(),first=await h.create(g.headers),source=(await h.db.getTask(first.json().task.taskId))!;
    await h.db.upsertTask({...source,status:"completed",result:"x".repeat(70_000),metadata:{...source.metadata,internalCapability:"private"},log:"private log"});
    const response=await h.app.inject({method:"GET",url:`/external-participants/v1/tasks/${source.id}`,headers:g.headers}),task=response.json().task;
    expect(task.result).toHaveLength(60_000);expect(task.resultTruncated).toBe(true);expect(task.terminal).toBe(true);expect(task.log).toBeUndefined();expect(task.metadata).toBeUndefined();
  });
  it("round-trips submission, completion and follow-up over real stdio MCP",async()=>{
    const h=await harness(),g=await h.grant(),origin=await h.app.listen({host:"127.0.0.1",port:0}),client=new Client({name:"dot-fixture",version:"1.0.0"});
    try{
      await client.connect(new StdioClientTransport({command:process.execPath,args:["--import","tsx","src/server/external-participant-mcp.ts"],cwd:process.cwd(),env:{...process.env,CLAUDEX_PARTICIPANT_TOKEN:g.token,CLAUDEX_PARTICIPANT_ORIGIN:origin} as Record<string,string>,stderr:"pipe"}));
      const parse=(result:any)=>JSON.parse(result.content[0].text);
      expect(parse(await client.callTool({name:"get_capabilities",arguments:{}})).execution.provider).toBe("codex");
      const submitted=parse(await client.callTool({name:"create_task",arguments:{prompt:"Implement fixture",idempotencyKey:crypto.randomUUID()}})),source=(await h.db.getTask(submitted.task.taskId))!;
      await h.db.upsertTask({...source,status:"completed",result:"Implemented and tested"});
      expect(parse(await client.callTool({name:"get_task",arguments:{taskId:source.id}})).task.result).toBe("Implemented and tested");
      expect(parse(await client.callTool({name:"resume_task",arguments:{taskId:source.id,prompt:"Revise fixture",idempotencyKey:crypto.randomUUID()}})).task.status).toBe("running");
    }finally{await client.close();}
  },30_000);
});
