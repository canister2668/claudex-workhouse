import crypto from"node:crypto";
import fs from"node:fs";
import path from"node:path";
import Fastify from"fastify";
import fastifyWebsocket from"@fastify/websocket";
import{afterEach,describe,expect,it}from"vitest";
import{DeckDatabase}from"../../src/server/db/client.js";
import{DesktopWorkerClient}from"../../src/server/desktop-worker/client.js";
import{loadWorkerConfig,saveWorkerConfig}from"../../src/server/desktop-worker/config.js";
import{executionHostUsesWorker,managedLocalWorkerEnabled,managedLocalWorkerHome,prepareManagedLocalWorker}from"../../src/server/managed-local-worker.js";
import{WorkerHub,workerConnectionOriginAllowed}from"../../src/server/worker-hub.js";

const created:string[]=[];
afterEach(()=>{for(const item of created.splice(0))fs.rmSync(item,{recursive:true,force:true});});
async function until(check:()=>boolean|Promise<boolean>,timeout=10_000){const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await new Promise(resolve=>setTimeout(resolve,25));}throw new Error("condition timed out");}

describe("managed Windows local Worker",()=>{
  it("routes only Windows local execution through the managed Worker",()=>{
    expect(managedLocalWorkerEnabled("win32")).toBe(true);
    expect(executionHostUsesWorker("local","win32")).toBe(true);
    expect(executionHostUsesWorker("local","linux")).toBe(false);
    expect(executionHostUsesWorker(crypto.randomUUID(),"linux")).toBe(true);
    expect(workerConnectionOriginAllowed("local","127.0.0.1")).toBe(true);
    expect(workerConnectionOriginAllowed("local","::1")).toBe(true);
    expect(workerConnectionOriginAllowed("local","192.168.1.9")).toBe(false);
    expect(workerConnectionOriginAllowed(crypto.randomUUID(),"192.168.1.9")).toBe(true);
  });

  it("persists the installation credential before its DB hash and rejects remote pairing storage",async()=>{
    const base=fs.mkdtempSync(path.resolve("../data/managed-local-worker-provision-"));created.push(base);
    const db=new DeckDatabase(path.resolve("src/server/db/sqlite-worker.py"),path.join(base,"test.sqlite"));await db.ping();
    const timestamp=new Date().toISOString();
    await db.upsertHost({id:"local",type:"local",name:"local",displayName:"This PC",platform:"win32",architecture:"x64",operatingSystemVersion:"test",workerVersion:null,status:"connecting",capabilities:{local:true},lastSeenAt:null,createdAt:timestamp,updatedAt:timestamp,disabledAt:null,revokedAt:null});
    const input={dataRoot:base,installationId:crypto.randomUUID(),serverUrl:"http://127.0.0.1:3410",claudeBinary:"claude",codexBinary:"codex",roots:[],workspaces:[],db};
    await expect(prepareManagedLocalWorker({...input,db:{
      getWorkerCredential:hostId=>db.getWorkerCredential(hostId),
      putWorkerCredential:async()=>{throw new Error("simulated DB interruption");}
    }})).rejects.toThrow("simulated DB interruption");
    const savedAfterFailure=loadWorkerConfig(managedLocalWorkerHome(base));
    expect(savedAfterFailure.credential).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const recovered=await prepareManagedLocalWorker(input);
    expect(recovered.reused).toBe(true);
    expect(recovered.config.credential).toBe(savedAfterFailure.credential);
    expect((await db.getWorkerCredential("local"))?.credentialHash).toBe(recovered.credentialHash);
    await db.close();

    const pairedBase=fs.mkdtempSync(path.resolve("../data/managed-local-worker-pairing-"));created.push(pairedBase);
    const pairedHome=managedLocalWorkerHome(pairedBase),paired=loadWorkerConfig(pairedHome);
    paired.hostId=crypto.randomUUID();paired.credential=crypto.randomBytes(32).toString("base64url");saveWorkerConfig(paired,pairedHome);
    await expect(prepareManagedLocalWorker({...input,dataRoot:pairedBase})).rejects.toThrow("remote pairing");
  });

  it("reuses its installation identity, connects only as local, rotates, and preserves revocation",async()=>{
    const base=fs.mkdtempSync(path.resolve("../data/managed-local-worker-"));created.push(base);
    const db=new DeckDatabase(path.resolve("src/server/db/sqlite-worker.py"),path.join(base,"test.sqlite"));await db.ping();
    const timestamp=new Date().toISOString();
    await db.upsertHost({id:"local",type:"local",name:"local",displayName:"This PC",platform:"win32",architecture:"x64",operatingSystemVersion:"test",workerVersion:null,status:"connecting",capabilities:{local:true},lastSeenAt:null,createdAt:timestamp,updatedAt:timestamp,disabledAt:null,revokedAt:null});
    const hub=new WorkerHub(db,base),app=Fastify({logger:false});await app.register(fastifyWebsocket,{options:{maxPayload:1024*1024,perMessageDeflate:false}});await hub.register(app);await app.listen({host:"127.0.0.1",port:0});
    let client:DesktopWorkerClient|null=null,running:Promise<void>|null=null;
    try{
      const address=app.server.address();if(!address||typeof address==="string")throw new Error("missing address");
      const workspacePath=path.join(base,"workspace");fs.mkdirSync(workspacePath);
      const fakeClaude=path.join(base,"fake-claude.mjs");fs.writeFileSync(fakeClaude,`#!/usr/bin/env node\nconsole.log(JSON.stringify({type:"system",subtype:"init",session_id:"managed-local-thread"}));\nconsole.log(JSON.stringify({type:"assistant",session_id:"managed-local-thread",message:{content:[{type:"text",text:"managed local reply"}]}}));\nconsole.log(JSON.stringify({type:"result",session_id:"managed-local-thread",is_error:false,result:"done"}));\n`,{mode:0o700});
      const rootId=crypto.randomUUID(),workspaceId=crypto.randomUUID(),root:any={id:rootId,hostId:"local",displayName:"Local root",canonicalPath:workspacePath,allowCreate:true,allowRegister:true,allowClone:true,allowDelete:false,createdAt:timestamp,verifiedAt:timestamp,disabledAt:null},workspace:any={id:workspaceId,projectId:"test-project",hostId:"local",rootId,relativePath:".",canonicalPath:workspacePath,displayName:"Default workspace",workspaceType:"existing",gitRemote:null,defaultBranch:null,lastKnownCommit:null,lastGitStatus:null,lastVerifiedAt:timestamp,createdAt:timestamp,updatedAt:timestamp,archivedAt:null};
      const input={dataRoot:base,installationId:crypto.randomUUID(),serverUrl:`http://127.0.0.1:${address.port}`,claudeBinary:fakeClaude,codexBinary:"codex",roots:[root],workspaces:[workspace],db};
      const first=await prepareManagedLocalWorker(input),second=await prepareManagedLocalWorker(input);
      expect(first.reused).toBe(false);expect(second.reused).toBe(true);expect(second.credentialHash).toBe(first.credentialHash);
      expect(second.config).toMatchObject({managedLocal:true,hostId:"local",installationId:input.installationId,serverUrl:`http://127.0.0.1:${address.port}`});
      const stored=await db.getWorkerCredential("local");expect(stored.credentialHash??stored.credential_hash).toBe(first.credentialHash);
      const configText=fs.readFileSync(path.join(managedLocalWorkerHome(base),"config.json"),"utf8");
      expect(configText).not.toContain(first.credentialHash);expect(configText).toContain(second.config.credential!);
      await expect(prepareManagedLocalWorker({...input,installationId:crypto.randomUUID()})).rejects.toThrow("another installation");
      await expect(prepareManagedLocalWorker({...input,serverUrl:"http://192.168.1.9:3410"})).rejects.toThrow("loopback");

      client=new DesktopWorkerClient(second.config);running=client.run();await until(()=>hub.isOnline("local"));
      expect(await hub.request("local","host.capabilities.read",{})).toMatchObject({managedLocal:true,platform:process.platform,commands:expect.arrayContaining(["provider.task.start"]),roots:[expect.objectContaining({id:rootId})]});
      const started=await hub.request("local","provider.task.start",{taskId:"claude:worker:fixture",provider:"claude",workspaceId,prompt:"hello",permissionProfile:":read-only",automationLevel:"read"}) as any;
      expect(started).toMatchObject({hostTaskId:"claude:worker:fixture",status:"pending"});
      let task:any;await until(async()=>{task=await hub.request("local","provider.task.status",{taskId:"claude:worker:fixture",provider:"claude",workspaceId});return task.status==="completed"||task.status==="failed";});
      expect(task).toMatchObject({status:"completed",threadId:"managed-local-thread",result:"done"});
      const rotation=await hub.request("local","host.credential.rotate",{}) as any;
      expect(rotation.credentialHash).toMatch(/^[a-f0-9]{64}$/);expect(rotation.credentialHash).not.toBe(first.credentialHash);
      await db.putWorkerCredential({hostId:"local",credentialHash:rotation.credentialHash,credentialVersion:rotation.credentialVersion,createdAt:new Date().toISOString(),rotatedAt:new Date().toISOString()});
      hub.reconnectAfterCredentialRotation("local");await until(()=>hub.isOnline("local"));
      expect(loadWorkerConfig(managedLocalWorkerHome(base)).credentialVersion).toBe(2);

      client.stop();await running;running=null;await until(()=>!hub.isOnline("local"));
      await hub.revoke("local");
      await expect(prepareManagedLocalWorker(input)).rejects.toMatchObject({code:"LOCAL_WORKER_CREDENTIAL_REVOKED"});
    }finally{client?.stop();if(running)await running.catch(()=>{});hub.shutdown();await app.close();await db.close();}
  },30_000);
});
