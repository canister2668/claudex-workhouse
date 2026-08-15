import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { DeckDatabase } from "../../src/server/db/client.js";
import type { DeckTask } from "../../src/server/types.js";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(),"claudex-workhouse-db-test-"));
const created: string[] = [];
async function seedDatabase(dbPath:string,sql:string){
  if(process.env.CLAUDEX_WORKHOUSE_DB_WORKER==="node"){
    const{default:Database}=await import("better-sqlite3");
    const seeded=new Database(dbPath);
    try{seeded.exec(sql);}finally{seeded.close();}
    return;
  }
  const seeded=spawnSync("sqlite3",[dbPath],{input:sql,encoding:"utf8"});
  expect(seeded.status,seeded.stderr).toBe(0);
}
async function quickCheck(dbPath:string){
  if(process.env.CLAUDEX_WORKHOUSE_DB_WORKER==="node"){
    const{default:Database}=await import("better-sqlite3");
    const checked=new Database(dbPath,{readonly:true,fileMustExist:true});
    try{return String(Object.values((checked.pragma("quick_check")as Array<Record<string,unknown>>)[0]!)[0]);}
    finally{checked.close();}
  }
  return spawnSync("sqlite3",[dbPath,"PRAGMA quick_check;"],{encoding:"utf8"}).stdout.trim();
}

afterAll(()=>fs.rmSync(dataDir,{recursive:true,force:true}));
afterEach(() => {
  for (const base of created.splice(0)) for (const suffix of ["", "-wal", "-shm"]) if (fs.existsSync(base + suffix)) fs.unlinkSync(base + suffix);
});

describe("Claudex Workhouse SQLite worker", () => {
  it("uses WAL, stores tasks, and deduplicates idempotency keys", async () => {
    const dbPath = path.join(dataDir, `test-${process.pid}-${Date.now()}.sqlite`);
    created.push(dbPath);
    const worker = path.resolve("src/server/db/sqlite-worker.py");
    const db = new DeckDatabase(worker, dbPath);
    expect(await db.ping()).toEqual({ journalMode: "wal", synchronous:2, walAutocheckpoint:1000 });
    const now = new Date().toISOString();
    const task: DeckTask = { id: "codex:test", provider: "codex", nativeId: "test", threadId: null, projectId: "risuai", title: "test", prompt: "read only", status: "pending", createdAt: now, updatedAt: now, result: null, error: null, log: "", owned: true, pid: null, pgid: null, processStart: null, commandMarker: null, parentThreadId: null };
    expect((await db.upsertTask(task)).id).toBe(task.id);
    expect(await db.listPushTasks()).toEqual([expect.objectContaining({id:task.id,provider:"codex",status:"pending"})]);
    expect(await db.listPushTasks()).not.toEqual([expect.objectContaining({prompt:expect.anything()})]);
    await db.upsertTask({...task,status:"completed"});
    expect(await db.listPushTasks([task.id])).toEqual([expect.objectContaining({id:task.id,status:"completed"})]);
    await db.upsertTask(task);
    const host=await db.upsertHost({id:"local",type:"local",name:"local",displayName:"NAS",platform:"linux",architecture:"x64",operatingSystemVersion:null,workerVersion:null,status:"online",capabilities:{local:true},lastSeenAt:now,createdAt:now,updatedAt:now,disabledAt:null,revokedAt:null});
    expect(host.id).toBe("local");
    await db.upsertProject({id:"risuai",name:"RisuAI",slug:"risuai",description:null,defaultProvider:null,createdAt:now,updatedAt:now,archivedAt:null});
    await db.upsertWorkspaceRoot({id:"root-test",hostId:"local",displayName:"Projects",canonicalPath:"/tmp/projects",allowCreate:true,allowRegister:true,allowClone:true,allowDelete:false,createdAt:now,verifiedAt:now,disabledAt:null});
    await db.upsertWorkspace({id:"workspace-test",projectId:"risuai",hostId:"local",rootId:"root-test",relativePath:"risuai",canonicalPath:"/tmp/projects/risuai",displayName:"RisuAI",workspaceType:"existing",gitRemote:null,defaultBranch:null,lastKnownCommit:null,lastGitStatus:null,lastVerifiedAt:now,createdAt:now,updatedAt:now,archivedAt:null});
    expect(await db.backfillLocalAssignments({hostId:"local",projects:[{projectId:"risuai",workspaceId:"workspace-test"}]})).toEqual({tasks:1,threads:0});
    expect((await db.getTask(task.id))?.executionHostId).toBe("local");
    expect((await db.getTask(task.id))?.workspaceId).toBe("workspace-test");
    const legacy={...task,id:"claude:legacy",provider:"claude" as const,nativeId:"legacy",projectId:"dir:-tmp-legacy",cwd:"/tmp/legacy"};
    await db.upsertTask(legacy);
    expect(await db.listUnassignedLocations()).toContainEqual({projectId:"dir:-tmp-legacy",cwd:"/tmp/legacy"});
    expect(await db.backfillLocalLocations({hostId:"local",locations:[{projectId:legacy.projectId,cwd:legacy.cwd,workspaceId:"workspace-test"}]})).toEqual({tasks:1,threads:0});
    expect((await db.getTask(legacy.id))?.workspaceId).toBe("workspace-test");
    const sessionId=crypto.randomUUID(),sessionMember={...legacy,id:"claude:session-one",nativeId:"session-one",threadId:sessionId,status:"completed" as const};
    await db.upsertTask(sessionMember);await db.upsertTask({...sessionMember,id:"claude:session-two",nativeId:"session-two"});
    const queuedOne=await db.enqueueSessionMessage({id:crypto.randomUUID(),provider:"claude",threadId:sessionId,sourceTaskId:sessionMember.id,prompt:"first queued input",createdAt:now,updatedAt:now}),queuedTwo=await db.enqueueSessionMessage({id:crypto.randomUUID(),provider:"claude",threadId:sessionId,sourceTaskId:sessionMember.id,prompt:"second queued input",createdAt:now,updatedAt:now});
    expect(await db.listSessionMessages("claude",sessionId)).toHaveLength(2);
    expect(await db.deferSessionMessageCredit(queuedTwo.id,"paid-credit-consent-required:claude:exhausted",now)).toMatchObject({status:"queued",error:"paid-credit-consent-required:claude:exhausted"});
    expect((await db.listCreditWaitingSessionMessages()).map(item=>item.id)).toContain(queuedTwo.id);
    expect((await db.listQueuedSessionMessages()).map(item=>item.id)).not.toContain(queuedTwo.id);
    expect(await db.clearSessionMessageCreditWait(queuedTwo.id,now)).toMatchObject({status:"queued",error:null});
    expect(await db.updateSessionMessage(queuedOne.id,"edited queued input",now)).toMatchObject({prompt:"edited queued input",status:"queued"});
    expect((await db.claimSessionMessage(queuedOne.id,now))?.status).toBe("dispatching");
    expect(await db.updateSessionMessage(queuedOne.id,"too late",now)).toBeNull();
    expect(await db.claimSessionMessage(queuedTwo.id,now)).toBeNull();
    expect(await db.recoverSessionMessages(now)).toBe(1);
    expect((await db.getSessionMessage(queuedOne.id))?.status).toBe("delivery-uncertain");
    expect(await db.claimSessionMessage(queuedTwo.id,now)).toBeNull();
    expect((await db.retrySessionMessage(queuedOne.id,now))?.status).toBe("queued");
    expect((await db.claimSessionMessage(queuedOne.id,now))?.status).toBe("dispatching");
    expect((await db.finishSessionMessage(queuedOne.id,"sent",now,"claude:next"))?.status).toBe("sent");
    expect((await db.claimSessionMessage(queuedTwo.id,now))?.status).toBe("dispatching");
    expect(await db.recoverSessionMessages(now)).toBe(1);
    expect((await db.resolveSessionMessageSent(queuedTwo.id,now))?.status).toBe("sent");
    const removable=await db.enqueueSessionMessage({id:crypto.randomUUID(),provider:"claude",threadId:sessionId,sourceTaskId:sessionMember.id,prompt:"uncertain then removed",createdAt:now,updatedAt:now});
    expect((await db.claimSessionMessage(removable.id,now))?.status).toBe("dispatching");
    expect(await db.recoverSessionMessages(now)).toBe(1);
    expect(await db.deleteSessionMessage(removable.id)).toBe(true);
    expect((await db.latestThreadTask("claude",sessionId))?.threadId).toBe(sessionId);
    await db.enqueueSessionMessage({id:crypto.randomUUID(),provider:"claude",threadId:sessionId,sourceTaskId:sessionMember.id,prompt:"deleted with session",createdAt:now,updatedAt:now});
    expect(await db.deleteTaskSession("claude",sessionId)).toBe(2);
    expect((await db.listProviderTasks("claude")).filter(item=>item.threadId===sessionId)).toHaveLength(0);
    expect(await db.listSessionMessages("claude",sessionId)).toHaveLength(0);
    await db.putWorkerCredential({hostId:"local",credentialHash:"a".repeat(64),credentialVersion:1,createdAt:now});
    expect((await db.getWorkerCredential("local"))?.credentialHash).toBe("a".repeat(64));
    const claim = { key: crypto.randomUUID(), action: "create", requestHash: "abc", now };
    expect((await db.claimIdempotency(claim)).claimed).toBe(true);
    expect((await db.claimIdempotency(claim)).claimed).toBe(false);
    const staleKey=crypto.randomUUID(),old="2025-01-01T00:00:00.000Z";
    expect((await db.claimIdempotency({key:staleKey,action:"message",requestHash:"old",ownerToken:"old-process",now:old,staleBefore:"2024-01-01T00:00:00.000Z"})).claimed).toBe(true);
    expect(await db.claimIdempotency({key:staleKey,action:"message",requestHash:"new",ownerToken:"new-process",now,staleBefore:"2025-02-01T00:00:00.000Z"})).toMatchObject({claimed:true,requestHash:"new"});
    await db.finishIdempotency({key:staleKey,action:"message",ownerToken:"new-process",state:"failed",response:{error:"provider failed",statusCode:502,code:"PROVIDER_FAILED"},now});
    expect(await db.claimIdempotency({key:staleKey,action:"message",requestHash:"new",ownerToken:"new-process",now,staleBefore:"2025-02-01T00:00:00.000Z"})).toMatchObject({claimed:false,state:"failed",response:{error:"provider failed",statusCode:502,code:"PROVIDER_FAILED"}});
    await db.appendAudit({createdAt:now,actor:"owner@example.com",action:"codex-message",provider:"codex",taskId:task.id,projectId:task.projectId,outcome:"success",detail:null});
    expect(await db.provenTaskIds()).toContain(task.id);
    const snapshotId=crypto.randomUUID();
    await db.upsertSnapshot({id:snapshotId,formatVersion:1,logicalKey:"daily-20260720",kind:"database",origin:"daily-first-start",state:"ready",relativePath:`objects/${snapshotId}`,createdAt:now,updatedAt:now,sizeBytes:1024,fileCount:4,verification:"verified",pinned:false,protectedReason:null,trashedAt:null,purgeAfter:null,lastError:null,manifestDigest:"a".repeat(64)});
    expect(await db.getSnapshot(snapshotId)).toMatchObject({id:snapshotId,state:"ready",pinned:false,sizeBytes:1024});
    expect(await db.listSnapshots()).toHaveLength(1);
    const ownedThread={threadId:"11111111-1111-4111-8111-111111111111",sessionId:"11111111-1111-4111-8111-111111111111",projectId:"risuai",cwd:"/tmp/projects/risuai",title:"Owned",preview:"",source:"claudex-workhouse",ownership:"claudex-workhouse",status:"completed",archived:false,parentThreadId:null,forkedFromId:null,modelProvider:null,requestedModel:null,effectiveModel:null,requestedReasoningEffort:null,effectiveReasoningEffort:null,requestedServiceTier:null,effectiveServiceTier:null,permissionProfile:":danger-full-access",settingsUpdatedAt:now,createdAt:now,updatedAt:now,lastSeenAt:now,executionHostId:"local",workspaceId:"workspace-test",workChainId:"chain-1",metadata:{automationLevel:"full"}};
    await db.upsertCodexThread(ownedThread);
    await db.upsertCodexThread({...ownedThread,source:"vscode",ownership:"external",title:"Provider snapshot"});
    const preserved=await db.getCodexThread(ownedThread.threadId);
    expect(preserved?.ownership).toBe("claudex-workhouse");
    expect(preserved?.source).toBe("claudex-workhouse");
    expect(preserved).toMatchObject({executionHostId:"local",workspaceId:"workspace-test",workChainId:"chain-1"});
    const newerSettingsAt=new Date(Date.parse(now)+2_000).toISOString(),staleSettingsAt=new Date(Date.parse(now)+1_000).toISOString();
    const newerSettings={...preserved,requestedReasoningEffort:"medium",permissionProfile:":workspace",settingsUpdatedAt:newerSettingsAt,metadata:{...preserved!.metadata,workMode:"default",automationLevel:"auto"}};
    await db.upsertCodexThread(newerSettings);
    const staleListWrite=await db.upsertCodexThread({...newerSettings,title:"Fresh provider title",requestedReasoningEffort:"ultra",permissionProfile:":danger-full-access",settingsUpdatedAt:staleSettingsAt,metadata:{...newerSettings.metadata,workMode:"plan",automationLevel:"full"}});
    expect(staleListWrite).toMatchObject({title:"Fresh provider title",requestedReasoningEffort:"medium",permissionProfile:":workspace",settingsUpdatedAt:newerSettingsAt,metadata:{workMode:"default",automationLevel:"auto"}});
    const relocatedTask={...(await db.getTask(task.id))!,projectId:"claudex-workhouse",workspaceId:"workspace-deck",cwd:"/tmp/projects/claudex-workhouse",metadata:{nextWorkspaceId:"workspace-deck"}},relocatedThread={...preserved,projectId:"claudex-workhouse",workspaceId:"workspace-deck",cwd:"/tmp/projects/claudex-workhouse",metadata:{workspaceId:"workspace-deck"}};
    const atomic=await db.applyTaskThreadSettings([relocatedTask],relocatedThread);expect(atomic.tasks[0]).toMatchObject({projectId:"claudex-workhouse",workspaceId:"workspace-deck",cwd:"/tmp/projects/claudex-workhouse"});expect(atomic.thread).toMatchObject({projectId:"claudex-workhouse",workspaceId:"workspace-deck",cwd:"/tmp/projects/claudex-workhouse"});
    await expect(db.applyTaskThreadSettings([{...relocatedTask,projectId:"must-rollback"},{id:"invalid"} as any],{...relocatedThread,projectId:"must-rollback"})).rejects.toThrow();expect(await db.getTask(task.id)).toMatchObject({projectId:"claudex-workhouse",workspaceId:"workspace-deck"});expect(await db.getCodexThread(ownedThread.threadId)).toMatchObject({projectId:"claudex-workhouse",workspaceId:"workspace-deck"});
    expect(fs.existsSync(dbPath + "-wal")).toBe(true);
    expect(fs.existsSync(dbPath + "-shm")).toBe(true);
    await db.close();
  });

  it("increments one aggregate revision for session and child mutations",async()=>{
    const dbPath=path.join(dataDir,`test-revision-${process.pid}-${Date.now()}.sqlite`);created.push(dbPath);const db=new DeckDatabase(path.resolve("src/server/db/sqlite-worker.py"),dbPath),now=new Date().toISOString(),id=crypto.randomUUID();await db.ping();
    const base:any={id,projectId:"p",title:"revision",mode:"debate",status:"starting",outcome:null,primaryParticipantId:null,maxCalls:2,currentCallCount:0,currentStep:"queued",maxTurnsPerParticipant:1,currentTurnCounts:{claude:0,codex:0},timeoutAt:"2099-01-01T00:00:00.000Z",controllerGeneration:1,workChainId:null,sourceTaskId:null,createdAt:now,updatedAt:now,completedAt:null,cancelledAt:null,archivedAt:null,metadata:{}};
    const first:any=await db.upsertCollaborationSession(base),second:any=await db.upsertCollaborationSession({...first,status:"running"});expect(first.revision).toBe(1);expect(second.revision).toBe(2);
    const participant:any=await db.upsertCollaborationParticipant({id:crypto.randomUUID(),collaborationSessionId:id,provider:"codex",role:"primary",executionHostId:"local",workspaceId:"w",providerSessionId:null,sourceTaskId:null,permissionMode:"read",status:"queued",sessionGeneration:1,capabilitySnapshot:{},createdAt:now,updatedAt:now,archivedAt:null});expect(participant.revision).toBe(3);expect((await db.getCollaborationSession(id) as any).revision).toBe(3);await db.close();
  });

  it("returns collaboration session and children from one logical read snapshot",async()=>{const dbPath=path.join(dataDir,`test-detail-snapshot-${process.pid}-${Date.now()}.sqlite`);created.push(dbPath);const db=new DeckDatabase(path.resolve("src/server/db/sqlite-worker.py"),dbPath),now=new Date().toISOString(),id=crypto.randomUUID(),participantId=crypto.randomUUID();await db.ping();const session:any=await db.upsertCollaborationSession({id,projectId:"p",title:"snapshot",mode:"debate",status:"running",outcome:null,primaryParticipantId:participantId,maxCalls:2,currentCallCount:0,currentStep:"queued",maxTurnsPerParticipant:1,currentTurnCounts:{claude:0,codex:0},timeoutAt:"2099-01-01T00:00:00.000Z",controllerGeneration:1,workChainId:null,sourceTaskId:null,createdAt:now,updatedAt:now,completedAt:null,cancelledAt:null,archivedAt:null,metadata:{conversationFlow:"automatic"}});await db.upsertCollaborationParticipant({id:participantId,collaborationSessionId:id,provider:"codex",role:"primary",executionHostId:"local",workspaceId:"w",providerSessionId:null,sourceTaskId:null,permissionMode:"read",status:"queued",sessionGeneration:1,capabilitySnapshot:{},createdAt:now,updatedAt:now,archivedAt:null});const beforeMutation=db.getCollaborationDetailSnapshot(id),mutation=db.upsertCollaborationSession({...session,status:"completed",outcome:"turn-limit",metadata:{...session.metadata,automaticContinuation:true,waitingForUser:true},updatedAt:new Date().toISOString()});const [snapshot,updated]:any[]=await Promise.all([beforeMutation,mutation]);expect(snapshot.session.status).toBe("running");expect(snapshot.session.revision).toBe(2);expect(snapshot.participants).toHaveLength(1);expect(snapshot.runs).toEqual([]);expect(snapshot.messages).toEqual([]);expect(updated).toMatchObject({status:"completed",revision:3});await db.close();});

  it("migrates v5 collaboration sessions to Debate without losing existing wrappers",async()=>{
    const dbPath=path.join(dataDir,`test-v5-${process.pid}-${Date.now()}.sqlite`);created.push(dbPath);const now=new Date().toISOString(),oldId=crypto.randomUUID();
    const sql=`CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL,description TEXT NOT NULL);CREATE TABLE collaboration_sessions(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,title TEXT NOT NULL,mode TEXT NOT NULL CHECK(mode IN ('parallel','review','assist')),status TEXT NOT NULL,outcome TEXT,primary_participant_id TEXT,max_calls INTEGER NOT NULL,current_call_count INTEGER NOT NULL DEFAULT 0,current_step TEXT NOT NULL,timeout_at TEXT NOT NULL,controller_generation INTEGER NOT NULL DEFAULT 1,work_chain_id TEXT,source_task_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,completed_at TEXT,cancelled_at TEXT,archived_at TEXT,metadata_json TEXT NOT NULL DEFAULT '{}');INSERT INTO collaboration_sessions VALUES('${oldId}','p','existing','parallel','completed','all-succeeded',NULL,2,2,'done','2099-01-01T00:00:00.000Z',1,NULL,NULL,'${now}','${now}','${now}',NULL,NULL,'{}');`;
    await seedDatabase(dbPath,sql);
    const db=new DeckDatabase(path.resolve("src/server/db/sqlite-worker.py"),dbPath);await db.ping();const preserved=await db.getCollaborationSession(oldId);expect(preserved?.mode).toBe("parallel");expect(preserved?.currentTurnCounts).toEqual({claude:0,codex:0});expect(preserved?.maxTurnsPerParticipant).toBeNull();const debateId=crypto.randomUUID();await db.upsertCollaborationSession({id:debateId,projectId:"p",title:"debate",mode:"debate",status:"starting",outcome:null,primaryParticipantId:null,maxCalls:10,currentCallCount:0,currentStep:"queued",maxTurnsPerParticipant:5,currentTurnCounts:{claude:0,codex:0},timeoutAt:"2099-01-01T00:00:00.000Z",controllerGeneration:1,workChainId:null,sourceTaskId:null,createdAt:now,updatedAt:now,completedAt:null,cancelledAt:null,archivedAt:null,metadata:{debateKind:"discussion"}});expect((await db.getCollaborationSession(debateId))?.mode).toBe("debate");await db.close();expect(await quickCheck(dbPath)).toBe("ok");
  });

  it("migrates queued messages to delivery-uncertain without retrying an in-flight dispatch",async()=>{
    const dbPath=path.join(dataDir,`test-v7-${process.pid}-${Date.now()}.sqlite`);created.push(dbPath);const now=new Date().toISOString(),id=crypto.randomUUID(),threadId=crypto.randomUUID();
    const sql=`CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL,description TEXT NOT NULL);CREATE TABLE session_message_queue(id TEXT PRIMARY KEY,provider TEXT NOT NULL CHECK(provider IN ('codex','claude')),thread_id TEXT NOT NULL,source_task_id TEXT NOT NULL,prompt TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('queued','dispatching','sent','failed')),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,dispatched_task_id TEXT,error TEXT);INSERT INTO session_message_queue VALUES('${id}','claude','${threadId}','claude:source','possibly delivered','dispatching','${now}','${now}',NULL,NULL);`;
    await seedDatabase(dbPath,sql);const db=new DeckDatabase(path.resolve("src/server/db/sqlite-worker.py"),dbPath);await db.ping();expect(await db.recoverSessionMessages(now)).toBe(1);expect((await db.getSessionMessage(id))?.status).toBe("delivery-uncertain");expect(await db.claimSessionMessage(id,now)).toBeNull();await db.close();
  });

  it("migrates the message queue provider constraint for compatible sessions",async()=>{
    const dbPath=path.join(dataDir,`test-queue-providers-${process.pid}-${Date.now()}.sqlite`);created.push(dbPath);const now=new Date().toISOString();
    await seedDatabase(dbPath,`CREATE TABLE session_message_queue(id TEXT PRIMARY KEY,provider TEXT NOT NULL CHECK(provider IN ('codex','claude')),thread_id TEXT NOT NULL,source_task_id TEXT NOT NULL,prompt TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('queued','dispatching','delivery-uncertain','sent','failed')),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,dispatched_task_id TEXT,error TEXT);`);
    const db=new DeckDatabase(path.resolve("src/server/db/sqlite-worker.py"),dbPath);await db.ping();
    for(const provider of ["deepseek","ollama","antigravity"]){const item=await db.enqueueSessionMessage({id:crypto.randomUUID(),provider,threadId:crypto.randomUUID(),sourceTaskId:`${provider}:source`,prompt:"queued",createdAt:now,updatedAt:now});expect(item.provider).toBe(provider);}
    await db.close();expect(await quickCheck(dbPath)).toBe("ok");
  });

  it("reconciles slash-form Windows roots after the data directory moves",async()=>{
    const dbPath=path.join(dataDir,`test-root-move-${process.pid}-${Date.now()}.sqlite`);created.push(dbPath);
    const worker=path.resolve("src/server/db/sqlite-worker.py"),now=new Date().toISOString(),oldRoot="C:/Users/Test/Claudex Workhouse";
    const db=new DeckDatabase(worker,dbPath);await db.ping();
    await db.upsertHost({id:"local",type:"local",name:"local",displayName:"Local",platform:"win32",architecture:"x64",operatingSystemVersion:null,workerVersion:null,status:"online",capabilities:{},lastSeenAt:now,createdAt:now,updatedAt:now,disabledAt:null,revokedAt:null});
    await db.upsertProject({id:"claudex-workhouse",name:"Claudex Workhouse",slug:"claudex-workhouse",description:null,defaultProvider:null,createdAt:now,updatedAt:now,archivedAt:null});
    await db.upsertWorkspaceRoot({id:"nested-root",hostId:"local",displayName:"Nested",canonicalPath:`${oldRoot}/projects`,allowCreate:true,allowRegister:true,allowClone:false,allowDelete:false,createdAt:now,verifiedAt:now,disabledAt:null});
    await db.upsertWorkspace({id:"workhouse",projectId:"claudex-workhouse",hostId:"local",rootId:"nested-root",relativePath:".",canonicalPath:oldRoot,displayName:"Claudex Workhouse",workspaceType:"existing",gitRemote:null,defaultBranch:null,lastKnownCommit:null,lastGitStatus:null,lastVerifiedAt:now,createdAt:now,updatedAt:now,archivedAt:null});
    await db.close();
    const reopened=new DeckDatabase(worker,dbPath);await reopened.ping();
    const expectedRoot=path.dirname(path.dirname(path.resolve(dbPath)));
    expect((await reopened.listWorkspaceRoots("local")).find(item=>item.id==="nested-root")?.canonicalPath).toBe(`${expectedRoot}/projects`);
    expect((await reopened.getWorkspace("workhouse"))?.canonicalPath).toBe(expectedRoot);
    await reopened.close();
  });

});
