import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DatabaseRequestError } from "../../src/server/db/client.js";
import { PushManager } from "../../src/server/push.js";
import { ClaudeProvider, hideOwnedClaudeSessionMirrors, inferExternalClaudeStatus } from "../../src/server/providers/claude.js";
import { CodexProvider } from "../../src/server/providers/codex.js";
import { LocalTransport } from "../../src/server/collaboration/provider-transport.js";

const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
function root(){const value=fs.mkdtempSync(path.join(os.tmpdir(),"claudex-workhouse-load-"));roots.push(value);return value;}

describe("background load shedding",()=>{
  it("does not turn transient push polling DB pressure into an unhandled rejection",async()=>{
    let calls=0;
    const manager=new PushManager(root(),{listPushTasks:async()=>{calls++;throw new DatabaseRequestError("overload","list_push_tasks","busy");}} as any);
    await new Promise(resolve=>setTimeout(resolve,30));
    expect(calls).toBe(1);
    await manager.close();
  });

  it("bounds Codex thread cache writes instead of filling the DB request queue",async()=>{
    let active=0,maxActive=0,calls=0;
    const db={upsertCodexThread:async(row:any)=>{calls++;active++;maxActive=Math.max(maxActive,active);await new Promise(resolve=>setTimeout(resolve,2));active--;return row;}};
    const directory=root(),provider=new CodexProvider({dataDir:directory,root:directory} as any,db as any),rows=Array.from({length:300},(_,index)=>({threadId:`thread-${index}`}));
    (provider as any).queueThreadCache(rows);
    await (provider as any).threadCacheFlush;
    expect(calls).toBe(300);
    expect(maxActive).toBeLessThanOrEqual(4);
  });

  it("yields and terminates when every Codex thread cache write is rejected",async()=>{
    let calls=0,timerFired=false;const db={upsertCodexThread:async()=>{calls++;throw new DatabaseRequestError("overload","upsert_codex_thread","busy");}};
    const directory=root(),provider=new CodexProvider({dataDir:directory,root:directory} as any,db as any);
    setTimeout(()=>{timerFired=true;},0);(provider as any).queueThreadCache([{threadId:"thread",archived:false}]);
    await (provider as any).threadCacheFlush;await new Promise(resolve=>setTimeout(resolve,10));
    expect(calls).toBe(1);expect(timerFired).toBe(true);expect((provider as any).pendingThreadCacheRows.size).toBe(0);
  });

  it("returns stored Codex tasks immediately and keeps refresh single-flight",async()=>{
    let provenCalls=0,release:()=>void=()=>{};const gate=new Promise<void>(resolve=>{release=resolve;});
    const db={listProviderTasks:async()=>[],provenTaskIds:async()=>{provenCalls++;await gate;return[];}};
    const directory=root(),provider=new CodexProvider({dataDir:directory,root:directory,projects:[]} as any,db as any);
    await Promise.all([provider.listTasks(),provider.listTasks(),provider.listTasks()]);
    expect(provenCalls).toBe(1);release();await (provider as any).taskListRefresh;
  });

  it("serves the primed Codex thread snapshot with filters and pagination while native metadata is cold",async()=>{
    const directory=root(),threadReads:boolean[]=[];
    const rows=Array.from({length:25},(_,index)=>({
      threadId:`thread-${index}`,sessionId:`thread-${index}`,projectId:index%2?"other":"project",cwd:directory,
      title:`Cached thread ${index}`,preview:index===24?"needle":"preview",source:index%3?"claudex-workhouse":"cli",
      ownership:index%3?"claudex-workhouse":"external",status:"completed",archived:false,requestedModel:index%2?"gpt-b":"gpt-a",
      createdAt:`2026-01-${String(index+1).padStart(2,"0")}T00:00:00.000Z`,updatedAt:`2026-01-${String(index+1).padStart(2,"0")}T00:00:00.000Z`,metadata:{}
    }));
    const archived={...rows[0],threadId:"archived-thread",sessionId:"archived-thread",title:"Archived",archived:true};
    const active:any={id:"task-active",provider:"codex",threadId:"thread-24",projectId:"project",status:"running",updatedAt:"2026-02-01T00:00:00.000Z",commandMarker:"claudex-workhouse-codex:active",jobId:null};
    const db={
      listCodexThreads:async(value:boolean)=>{threadReads.push(value);return value?[archived]:rows;},
      listProviderTasks:async()=>{throw new Error("primed task rows must not be reread on first paint");},
      listProviderTasksSince:async()=>[]
    };
    const provider=new CodexProvider({dataDir:directory,root:directory,projects:[{id:"project",realPath:directory,enabled:true}]} as any,db as any);
    await provider.warmThreadSnapshots([active]);(provider as any).appBlockedUntil=Date.now()+60_000;
    const first=await provider.listThreads({limit:10,ownership:"claudex-workhouse"});
    expect(first.stale).toBe(true);expect(first.capabilities).toMatchObject({search:true,turns:true,settings:true});
    expect(first.sessions).toHaveLength(10);expect(first.nextCursor).toEqual(expect.any(String));
    const second=await provider.listThreads({limit:10,ownership:"claudex-workhouse",cursor:first.nextCursor});
    expect(second.sessions.length).toBeGreaterThan(0);
    const filtered=await provider.listThreads({limit:10,projectId:"project",status:"running",model:"gpt-a",search:"needle"});
    expect(filtered.sessions.map((item:any)=>item.threadId)).toEqual(["thread-24"]);
    const archivedPage=await provider.listThreads({limit:10,archived:true});
    expect(archivedPage.sessions.map((item:any)=>item.threadId)).toEqual(["archived-thread"]);
    await provider.listThreads({limit:10});
    expect(threadReads).toEqual([false,true]);
  });

  it("degrades to an empty stale Codex list when persisted snapshot initialization fails",async()=>{
    const directory=root(),db={listCodexThreads:async()=>{throw new DatabaseRequestError("overload","list_codex_threads","busy");},listProviderTasks:async()=>[],listProviderTasksSince:async()=>[]};
    const provider=new CodexProvider({dataDir:directory,root:directory,projects:[]} as any,db as any);(provider as any).threadTasksInitialized=true;(provider as any).appBlockedUntil=Date.now()+60_000;
    await expect(provider.listThreads({limit:10})).resolves.toMatchObject({sessions:[],stale:true,capabilities:{search:true}});
  });

  it("does not extend the Codex native circuit breaker while serving cached polls",async()=>{
    const directory=root(),db={listCodexThreads:async()=>[],listProviderTasks:async()=>[],listProviderTasksSince:async()=>[]};
    const provider=new CodexProvider({dataDir:directory,root:directory,projects:[]} as any,db as any);await provider.warmThreadSnapshots([]);
    const blockedUntil=Date.now()+60_000;(provider as any).appFailures=6;(provider as any).appBlockedUntil=blockedUntil;
    await provider.listThreads({limit:10});await provider.listThreads({limit:10});
    expect((provider as any).appFailures).toBe(6);expect((provider as any).appBlockedUntil).toBe(blockedUntil);
  });

  it("refreshes Codex task status behind a cached first paint",async()=>{
    const directory=root(),thread:any={threadId:"thread",sessionId:"thread",title:"Thread",status:"completed",archived:false,updatedAt:"2026-01-01T00:00:00.000Z",metadata:{}},active:any={id:"active",provider:"codex",threadId:"thread",status:"running",updatedAt:"2026-02-01T00:00:00.000Z",commandMarker:null,jobId:"job"};
    const db={listCodexThreads:async()=>[thread],listProviderTasks:async()=>[active],listProviderTasksSince:async()=>[active]};
    const provider=new CodexProvider({dataDir:directory,root:directory,projects:[]} as any,db as any);await provider.warmThreadSnapshots([]);(provider as any).appBlockedUntil=Date.now()+60_000;
    expect((await provider.listThreads({limit:10})).sessions[0].status).toBe("completed");
    await (provider as any).threadTaskRefresh;
    expect((await provider.listThreads({limit:10})).sessions[0]).toMatchObject({status:"running",taskId:"active"});
  });

  it("does not let a snapshot refresh roll back an in-flight Codex settings write",async()=>{
    const directory=root(),stored:any={threadId:"thread",archived:false,title:"Thread",status:"completed",updatedAt:"2026-01-01T00:00:00.000Z",requestedModel:"gpt-test",requestedReasoningEffort:"high",permissionProfile:":workspace",metadata:{automationLevel:"auto"}};
    let release:()=>void=()=>{};const gate=new Promise<void>(resolve=>{release=resolve;});
    const db={
      getCodexThread:async()=>stored,
      upsertCodexThread:async(row:any)=>{await gate;return row;},
      listCodexThreads:async()=>[stored],
      listProviderTasks:async()=>[],listProviderTasksSince:async()=>[]
    };
    const provider=new CodexProvider({dataDir:directory,root:directory,projects:[]} as any,db as any);
    await provider.warmThreadSnapshots([]);(provider as any).catalog.validate=async()=>({model:"gpt-test",reasoningEffort:"medium",serviceTier:null,permissionProfile:":workspace"});
    const write=provider.updateThreadSettings("thread",{reasoningEffort:"medium"});
    await new Promise(resolve=>setTimeout(resolve,0));await (provider as any).refreshThreadSnapshots(false);
    expect((provider as any).threadSnapshots.get(false).threads.get("thread").requestedReasoningEffort).toBe("medium");
    release();await write;
  });

  it("does not rewrite an unchanged terminal worker snapshot",async()=>{
    let taskWrites=0,threadWrites=0;const directory=root(),db={upsertTask:async(task:any)=>{taskWrites++;return task;},getCodexThread:async()=>null,upsertCodexThread:async(row:any)=>{threadWrites++;return row;}};
    const provider=new CodexProvider({dataDir:directory,root:directory,projects:[]} as any,db as any),task:any={id:"codex:deck:stable",provider:"codex",threadId:"thread",status:"completed",updatedAt:"2026-01-01T00:00:00.000Z",lastSeenAt:new Date().toISOString(),result:"done",error:null,log:"",pid:null,pgid:null,processStart:null,metadata:{},commandMarker:"claudex-workhouse-codex:stable"};
    fs.writeFileSync(path.join(directory,"codex-jobs","codex_deck_stable.json"),JSON.stringify({threadId:"thread",status:"completed",updatedAt:task.updatedAt,result:"done",error:null,log:"",pid:null,pgid:null,processStart:null}));
    await (provider as any).refreshWorker(task);await (provider as any).refreshWorker(task);
    expect(taskWrites).toBe(0);expect(threadWrites).toBe(0);
  });

  it("returns stored Claude tasks while unchanged worker snapshots stay read-only",async()=>{
    let writes=0;const directory=root(),task:any={id:"claude:stable",provider:"claude",threadId:"session",providerSessionId:"session",status:"completed",updatedAt:"2026-01-01T00:00:00.000Z",result:"done",error:null,log:"",pid:null,pgid:null,processStart:null,metadata:{},owned:true,commandMarker:"claudex-workhouse:stable"},db={listProviderTasks:async()=>[task],upsertTask:async(value:any)=>{writes++;return value;}};
    const provider=new ClaudeProvider({dataDir:directory,root:directory,projects:[],claudeBinary:"/bin/false",commandTimeoutMs:1000,commandOutputLimit:1024} as any,db as any);
    fs.writeFileSync(path.join(directory,"claude-jobs","claude_stable.json"),JSON.stringify({sessionId:"session",status:"completed",updatedAt:task.updatedAt,result:"done",error:null,log:"",pid:null,pgid:null,processStart:null}));
    expect(await provider.listTasks()).toEqual([task]);await (provider as any).taskListRefresh;
    expect(writes).toBe(0);
  });

  it("serves Claude's startup task snapshot without a first-request full table scan",async()=>{
    const directory=root(),persisted:any={id:"claude:startup",provider:"claude",threadId:"session",providerSessionId:"session",status:"running",updatedAt:"2026-08-03T00:00:00.000Z",owned:true,metadata:{}},db={listProviderTasks:async()=>{throw new Error("startup rows must already be primed");},listProviderTasksSince:async()=>[]};
    const provider=new ClaudeProvider({dataDir:directory,root:directory,projects:[],claudeBinary:"/bin/false",commandTimeoutMs:1000,commandOutputLimit:1024} as any,db as any);
    provider.warmTaskSnapshot([persisted]);
    expect(await provider.listTasks()).toEqual([persisted]);
    await (provider as any).taskListRefresh;
  });

  it("does not call a recently active external Claude transcript completed only because agents briefly omits it",()=>{
    const now=Date.parse("2026-07-25T13:00:00.000Z");
    expect(inferExternalClaudeStatus({agentKind:null,transcriptMtimeMs:now-10_000,previousStatus:"running",agentsListingOk:true,nowMs:now})).toBe("running");
    expect(inferExternalClaudeStatus({agentKind:null,transcriptMtimeMs:now-180_000,previousStatus:"running",agentsListingOk:true,nowMs:now})).toBe("completed");
    expect(inferExternalClaudeStatus({agentKind:"interactive",transcriptMtimeMs:now-30_000,previousStatus:"running",agentsListingOk:true,nowMs:now})).toBe("waiting");
  });

  it("hides a raced external Claude mirror when Workhouse owns the same session",()=>{
    const owned:any={id:"claude:owned",provider:"claude",threadId:"session-a",owned:true,updatedAt:"2026-07-30T10:06:17.000Z"};
    const mirror:any={id:"claude:external:session-a",provider:"claude",threadId:"session-a",owned:false,ownership:"external",updatedAt:"2026-07-30T10:04:57.000Z"};
    const unrelated:any={id:"claude:external:session-b",provider:"claude",threadId:"session-b",owned:false,ownership:"external",updatedAt:"2026-07-30T10:05:00.000Z"};
    const pendingOwned:any={id:"claude:pending",provider:"claude",threadId:null,owned:true,updatedAt:"2026-07-30T10:07:00.000Z"};
    expect(hideOwnedClaudeSessionMirrors([mirror,unrelated,owned,pendingOwned])).toEqual([unrelated,owned,pendingOwned]);
    expect(hideOwnedClaudeSessionMirrors([mirror])).toEqual([mirror]);
  });

  it("hides stale Claude mirrors from a combined snapshot without touching Codex",()=>{
    const owned:any={id:"claude:owned",provider:"claude",threadId:null,providerSessionId:"shared-session",owned:true};
    const mirror:any={id:"claude:external:shared-session",provider:"claude",threadId:"shared-session",owned:false,ownership:"external"};
    const codex:any={id:"codex:external:shared-session",provider:"codex",threadId:"shared-session",owned:false,ownership:"external"};
    expect(hideOwnedClaudeSessionMirrors([mirror,codex,owned])).toEqual([codex,owned]);
  });

  it("hides a Claude transcript mirror owned by a compatible provider",()=>{
    const deepseek:any={id:"deepseek:owned",provider:"deepseek",threadId:"shared-session",owned:true};
    const mirror:any={id:"claude:external:shared-session",provider:"claude",threadId:"shared-session",owned:false,ownership:"external"};
    expect(hideOwnedClaudeSessionMirrors([mirror],[mirror,deepseek])).toEqual([]);
  });

  it("does not list a raced external mirror from the Claude task snapshot",async()=>{
    const directory=root();
    const owned:any={id:"claude:owned",provider:"claude",threadId:"session-a",owned:true,status:"completed",updatedAt:"2026-07-30T10:06:17.000Z"};
    const mirror:any={id:"claude:external:session-a",provider:"claude",threadId:"session-a",owned:false,ownership:"external",status:"completed",updatedAt:"2026-07-30T10:04:57.000Z"};
    const db={listProviderTasks:async()=>[mirror,owned]};
    const provider=new ClaudeProvider({dataDir:directory,root:directory,projects:[],claudeBinary:"/bin/false",commandTimeoutMs:1000,commandOutputLimit:1024} as any,db as any);
    expect(await provider.listTasks()).toEqual([owned]);
    await (provider as any).taskListRefresh;
  });

  it("does not upsert an unchanged task returned by conversation status polling",async()=>{
    const task:any={id:"codex:stable",provider:"codex",status:"running"},provider={getTask:async()=>task},db={upsertTask:async()=>{throw new Error("unchanged task must not be written");}},transport=new LocalTransport(db as any,new Map([["codex",provider]]) as any);
    await expect(transport.status(task)).resolves.toBe(task);
  });

  it("keeps collaboration linkage on a Claude follow-up task",async()=>{
    let written:any=null;const task:any={id:"claude:first",provider:"claude",threadId:"thread",metadata:{collaborationSessionId:"conversation",collaborationParticipantId:"participant",workMode:"plan"}},provider={sendMessage:async()=>({id:"claude:next",provider:"claude",threadId:"thread",metadata:{activity:"runtime_initializing"}})},db={upsertTask:async(value:any)=>(written=value)},transport=new LocalTransport(db as any,new Map([["claude",provider]]) as any);
    await transport.followUp(task,"continue");
    expect(written.metadata).toMatchObject({collaborationSessionId:"conversation",collaborationParticipantId:"participant",workMode:"plan",activity:"runtime_initializing"});
  });

  it("self-heals an active Codex snapshot whose worker process is gone",async()=>{
    let written:any=null;const directory=root(),db={upsertTask:async(task:any)=>(written=task),getCodexThread:async()=>null,upsertCodexThread:async(row:any)=>row},provider=new CodexProvider({dataDir:directory,root:directory,projects:[]} as any,db as any),task:any={id:"codex:deck:dead",provider:"codex",threadId:"thread",status:"running",updatedAt:"2026-01-01T00:00:00.000Z",lastSeenAt:new Date().toISOString(),result:null,error:null,log:"",pid:99999999,pgid:99999999,processStart:"1",metadata:{},commandMarker:"claudex-workhouse-codex:dead"};
    fs.writeFileSync(path.join(directory,"codex-jobs","codex_deck_dead.json"),JSON.stringify({threadId:"thread",status:"running",updatedAt:task.updatedAt,pid:task.pid,pgid:task.pgid,processStart:task.processStart,marker:task.commandMarker}));
    await (provider as any).refreshWorker(task);expect(written?.status).toBe("stopped");expect(written?.error).toMatch(/no longer running/i);
  });

  it("drops a tracked push task when the DB is terminal without a terminal spool event",async()=>{
    const directory=root(),task:any={id:"claude:tracked",provider:"claude",status:"running"},db={listPushTasks:async()=>[task],getSystemSetting:async()=>null,listPushSubscriptions:async()=>[]},manager=new PushManager(directory,db as any);
    await new Promise(resolve=>setTimeout(resolve,20));task.status="completed";await (manager as any).poll();expect((manager as any).sequences.size).toBe(0);await manager.close();
  });
});
