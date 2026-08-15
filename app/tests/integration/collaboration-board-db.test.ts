import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach,describe,expect,it } from "vitest";
import { DeckDatabase } from "../../src/server/db/client.js";
import type { WorkChain,WorkChainEvent } from "../../src/server/types.js";

const created:string[]=[];
afterEach(()=>{for(const base of created.splice(0))for(const suffix of["","-wal","-shm"])if(fs.existsSync(base+suffix))fs.unlinkSync(base+suffix);});
const worker=()=>path.resolve("src/server/db/sqlite-worker.py");
const database=()=>{const file=path.join(os.tmpdir(),`collaboration-board-${process.pid}-${Date.now()}-${crypto.randomUUID()}.sqlite`);created.push(file);return{file,db:new DeckDatabase(worker(),file)};};
const project=async(db:DeckDatabase,now:string)=>db.upsertProject({id:"project",name:"Project",slug:"project",description:null,defaultProvider:null,createdAt:now,updatedAt:now,archivedAt:null});
const automation={mode:"manual",state:"idle",stage:null,stopAfter:null,round:0,approvedProviders:[],fullAccessAcknowledged:false,pauseReason:null,lastSessionId:null,startedAt:null} as const;
const card=(id:string,now:string):WorkChain=>({id,projectId:"project",title:"Board card",rootSessionId:null,activeSessionId:null,boardVisible:true,description:"Persisted work",boardStatus:"queued",priority:"high",workspaceId:"workspace",targetBranch:"feature/board",roles:{implementer:{provider:"codex",model:"gpt-5.6-sol",permissionProfile:"write"}},automation,lastActivityAt:now,completedAt:null,revision:1,createdAt:now,updatedAt:now,archivedAt:null});

describe("Collaboration Board database",()=>{
  it("keeps legacy chains hidden and persists board metadata with optimistic revisions",async()=>{
    const{db}=database(),now=new Date().toISOString();await db.ping();await project(db,now);
    const legacy=await db.createWorkChain({id:"legacy",projectId:"project",title:"Legacy handoff",createdAt:now,updatedAt:now});
    expect(legacy).toMatchObject({boardVisible:false,description:"",boardStatus:"queued",priority:"normal",roles:{},automation:{},revision:1});
    expect(await db.listBoardCards()).toEqual([]);
    const stored=await db.createWorkChain(card("board",now));
    expect(stored).toMatchObject({boardVisible:true,workspaceId:"workspace",targetBranch:"feature/board",roles:{implementer:{provider:"codex"}},automation:{mode:"manual",state:"idle"}});
    expect((await db.listBoardCards()).map(item=>item.id)).toEqual(["board"]);
    const changedAt=new Date(Date.parse(now)+1000).toISOString();
    const changed=await db.updateBoardCard({...stored,title:"Edited",description:"Updated",boardStatus:"in_progress",priority:"urgent",roles:stored.roles,updatedAt:changedAt},1);
    expect(changed).toMatchObject({updated:true,current:{title:"Edited",revision:2,boardStatus:"in_progress"}});
    const stale=await db.updateBoardCard({...stored,title:"Stale",description:"Stale",boardStatus:"queued",priority:"low",roles:{},updatedAt:changedAt},1);
    expect(stale).toMatchObject({updated:false,current:{title:"Edited",revision:2}});
    await db.close();
  });

  it("deduplicates automatic events and updates card activity in the same operation",async()=>{
    const{db}=database(),now=new Date().toISOString();await db.ping();await project(db,now);await db.createWorkChain(card("board",now));
    const event:WorkChainEvent={id:crypto.randomUUID(),chainId:"board",eventType:"task.completed",taskId:"task-1",collaborationSessionId:null,actorType:"system",actorId:null,dedupeKey:"task:task-1:completed",payload:{status:"completed"},createdAt:new Date(Date.parse(now)+2000).toISOString()};
    expect(await db.appendWorkChainEvent(event)).toMatchObject({inserted:true,event:{id:event.id,payload:{status:"completed"}}});
    const duplicate=await db.appendWorkChainEvent({...event,id:crypto.randomUUID()});
    expect(duplicate).toMatchObject({inserted:false,event:{id:event.id}});
    expect(await db.listWorkChainEvents("board")).toHaveLength(1);
    expect((await db.getWorkChain("board"))?.lastActivityAt).toBe(event.createdAt);
    await db.close();
  });

  it("attaches a persisted task and its timeline event atomically",async()=>{
    const{db}=database(),now=new Date().toISOString();await db.ping();await project(db,now);await db.createWorkChain(card("board",now));
    await db.upsertTask({id:"codex:board-task",provider:"codex",nativeId:"board-task",threadId:null,projectId:"project",title:"Task",prompt:"work",status:"pending",createdAt:now,updatedAt:now,result:null,error:null,log:"",owned:true,pid:null,pgid:null,processStart:null,commandMarker:null,parentThreadId:null} as any);
    const createdAt=new Date(Date.parse(now)+3000).toISOString(),event:WorkChainEvent={id:crypto.randomUUID(),chainId:"board",eventType:"session.attached",taskId:"codex:board-task",collaborationSessionId:null,actorType:"user",actorId:null,dedupeKey:"task:codex:board-task:attached",payload:{role:"implementer"},createdAt};
    expect(await db.attachBoardSession({chainId:"board",taskId:"codex:board-task",event})).toMatchObject({attached:true,chain:{lastActivityAt:createdAt},event:{id:event.id}});
    expect((await db.getTask("codex:board-task"))?.workChainId).toBe("board");expect(await db.listWorkChainEvents("board")).toHaveLength(1);await db.close();
  });

  it("records persisted task and collaboration status transitions only for visible cards",async()=>{
    const{db}=database(),now=new Date().toISOString();await db.ping();await project(db,now);await db.createWorkChain(card("board",now));await db.createWorkChain({id:"hidden",projectId:"project",title:"Hidden",createdAt:now,updatedAt:now});
    const baseTask:any={id:"codex:auto-events",provider:"codex",nativeId:"auto-events",threadId:null,projectId:"project",title:"Task",prompt:"work",status:"pending",createdAt:now,updatedAt:now,result:null,error:null,log:"",owned:true,pid:null,pgid:null,processStart:null,commandMarker:null,parentThreadId:null,workChainId:"board"};
    await db.upsertTask(baseTask);
    for(const[index,status]of["running","running","waiting","completed"].entries())await db.upsertTask({...baseTask,status,updatedAt:new Date(Date.parse(now)+(index+1)*1000).toISOString()});
    await db.upsertTask({...baseTask,id:"codex:hidden",nativeId:"hidden",status:"running",workChainId:"hidden",updatedAt:new Date(Date.parse(now)+5000).toISOString()});
    const session:any={id:"collaboration-auto",projectId:"project",title:"Review",mode:"review",status:"starting",outcome:null,primaryParticipantId:null,maxCalls:2,currentCallCount:0,currentStep:"queued",maxTurnsPerParticipant:null,currentTurnCounts:{claude:0,codex:0},timeoutAt:"2099-01-01T00:00:00.000Z",controllerGeneration:1,workChainId:"board",sourceTaskId:null,createdAt:now,updatedAt:new Date(Date.parse(now)+6000).toISOString(),completedAt:null,cancelledAt:null,archivedAt:null,metadata:{}};
    const first=await db.upsertCollaborationSession(session);await db.upsertCollaborationSession({...first,status:"failed",updatedAt:new Date(Date.parse(now)+7000).toISOString()});
    const events=await db.listWorkChainEvents("board");
    expect(events.map(event=>event.eventType)).toEqual(["task.started","task.waiting","task.completed","collaboration.started","collaboration.failed"]);
    expect(events.map(event=>event.dedupeKey)).toEqual(["task:codex:auto-events:started","task:codex:auto-events:waiting","task:codex:auto-events:completed","collaboration:collaboration-auto:started","collaboration:collaboration-auto:failed"]);
    expect((await db.getWorkChain("board"))?.lastActivityAt).toBe(new Date(Date.parse(now)+7000).toISOString());expect(await db.listWorkChainEvents("hidden")).toEqual([]);await db.close();
  });

  it("additively migrates an existing work_chains table without exposing its rows",async()=>{
    const file=path.join(os.tmpdir(),`collaboration-board-legacy-${process.pid}-${Date.now()}.sqlite`);created.push(file);const now=new Date().toISOString();
    const sql=`PRAGMA foreign_keys=ON;CREATE TABLE projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,slug TEXT NOT NULL UNIQUE,description TEXT,default_provider TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,archived_at TEXT);INSERT INTO projects VALUES('project','Project','project',NULL,NULL,'${now}','${now}',NULL);CREATE TABLE work_chains(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),title TEXT NOT NULL,root_session_id TEXT,active_session_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,archived_at TEXT);INSERT INTO work_chains VALUES('legacy','project','Legacy',NULL,NULL,'${now}','${now}',NULL);`;
    const seeded=spawnSync("sqlite3",[file],{input:sql,encoding:"utf8"});expect(seeded.status,seeded.stderr).toBe(0);
    const db=new DeckDatabase(worker(),file);await db.ping();expect(await db.getWorkChain("legacy")).toMatchObject({boardVisible:false,boardStatus:"queued",priority:"normal",revision:1});expect(await db.listBoardCards()).toEqual([]);await db.close();
  });
});
