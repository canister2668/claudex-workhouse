import{describe,expect,it,vi}from"vitest";
import{createThreadTurnGate,liveTurnStatus}from"../../src/server/session-turn.js";
import{ManagedProviderBridge}from"../../src/server/managed-provider-mcp.js";
import type{DeckTask}from"../../src/server/types.js";

function task(overrides:Partial<DeckTask>&{id:string}):DeckTask{
  return{provider:"claude",nativeId:overrides.id,threadId:"session-1",projectId:"project",title:"turn",prompt:"",status:"completed",createdAt:"2026-08-14T00:00:00.000Z",updatedAt:"2026-08-14T00:00:00.000Z",result:null,error:null,log:"",owned:true,pid:null,pgid:null,processStart:null,commandMarker:null,parentThreadId:null,ownership:"claudex-workhouse",source:"claudex-workhouse",executionHostId:"local",workspaceId:"workspace-a",providerSessionId:"session-1",metadata:{},...overrides} as DeckTask;
}

function gate(rows:DeckTask[],refresh?:(item:DeckTask)=>Promise<DeckTask>){
  const onThread=(threadId:string)=>rows.filter(row=>row.threadId===threadId);
  const latest=async(_provider:any,threadId:string)=>onThread(threadId).slice().sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).at(-1)??null;
  return createThreadTurnGate({latestThreadTask:latest,activeTasks:async()=>rows.filter(row=>liveTurnStatus(row.status)),refresh:refresh??(async item=>item)});
}

describe("session turn admission",()=>{
  it("refuses a second turn while the task being continued is still running",async()=>{
    const running=task({id:"claude:a",status:"running",createdAt:"2026-08-14T00:38:57.000Z"});
    const{withThreadTurn}=gate([running]),run=vi.fn(async()=>"launched");
    await expect(withThreadTurn("claude","session-1",run)).rejects.toMatchObject({statusCode:409,code:"SESSION_TURN_IN_PROGRESS",taskId:"claude:a"});
    expect(run).not.toHaveBeenCalled();
  });

  it("refuses a turn when an older sibling of the finished latest task is still live",async()=>{
    // The exact production shape: the newest row settled while an earlier
    // resume on the same session was still running.
    const rows=[task({id:"claude:a",status:"running",createdAt:"2026-08-14T00:38:57.000Z"}),task({id:"claude:b",status:"completed",createdAt:"2026-08-14T00:42:53.000Z"})];
    const{withThreadTurn}=gate(rows),run=vi.fn(async()=>"launched");
    await expect(withThreadTurn("claude","session-1",run)).rejects.toMatchObject({statusCode:409,taskId:"claude:a"});
    expect(run).not.toHaveBeenCalled();
  });

  it("hands a busy session to the queue fallback instead of failing",async()=>{
    const running=task({id:"claude:a",status:"running"});
    const{withThreadTurn}=gate([running]),run=vi.fn(async()=>"launched");
    await expect(withThreadTurn("claude","session-1",run,async active=>`queued:${active.id}`)).resolves.toBe("queued:claude:a");
    expect(run).not.toHaveBeenCalled();
  });

  it("does not block on a stale row whose provider process is gone",async()=>{
    const stale=task({id:"claude:a",status:"running"}),newest=task({id:"claude:b",status:"completed",createdAt:"2026-08-14T00:42:53.000Z"});
    const{withThreadTurn}=gate([stale,newest],async item=>({...item,status:"failed"}));
    await expect(withThreadTurn("claude","session-1",async()=>"launched")).resolves.toBe("launched");
  });

  it("serializes concurrent admissions on one session",async()=>{
    const rows:DeckTask[]=[task({id:"claude:a",status:"completed"})];
    const{withThreadTurn}=gate(rows);
    let release=()=>{};const started=new Promise<void>(resolve=>{release=resolve;});
    const first=withThreadTurn("claude","session-1",async()=>{await started;return"first";});
    await expect(withThreadTurn("claude","session-1",async()=>"second")).rejects.toMatchObject({code:"SESSION_TURN_IN_PROGRESS"});
    release();
    await expect(first).resolves.toBe("first");
    await expect(withThreadTurn("claude","session-1",async()=>"third")).resolves.toBe("third");
  });

  it("keeps separate sessions independent",async()=>{
    const{withThreadTurn}=gate([task({id:"claude:a",status:"running"})]);
    await expect(withThreadTurn("claude","session-2",async()=>"launched")).resolves.toBe("launched");
  });
});

describe("managed provider resume",()=>{
  const source=task({id:"codex:deck:source",provider:"codex",threadId:"source-thread",providerSessionId:"source-thread",status:"running"});
  function bridge(status:string){
    const target=task({id:"claude:managed",status,metadata:{managedProviderSourceTaskId:source.id}});
    const db:any={
      getTask:vi.fn(async(id:string)=>id===target.id?target:id===source.id?source:null),
      upsertTask:vi.fn(async(value:DeckTask)=>value),
      getWorkspace:vi.fn(async()=>({id:"workspace-a",displayName:"workspace"})),
      appendAudit:vi.fn(async()=>true),
      claimIdempotency:vi.fn(async(input:any)=>({claimed:true,requestHash:input.requestHash,state:"pending",response:null})),
      finishIdempotency:vi.fn(async()=>true)
    };
    const resumeTask=vi.fn(async(item:DeckTask)=>task({id:"claude:managed-next",status:"running",metadata:item.metadata}));
    return{bridge:new ManagedProviderBridge(db,{} as any,async item=>item,resumeTask),resumeTask};
  }

  it("refuses to start another turn on a managed task that is still running",async()=>{
    const{bridge:instance,resumeTask}=bridge("running");
    await expect(instance.resume(source,{taskId:"claude:managed",prompt:"continue",idempotencyKey:"22222222-2222-4222-8222-222222222222"})).rejects.toMatchObject({statusCode:409,code:"MANAGED_PROVIDER_TASK_ACTIVE",taskId:"claude:managed"});
    expect(resumeTask).not.toHaveBeenCalled();
  });

  it("resumes a managed task that reached a terminal status",async()=>{
    const{bridge:instance,resumeTask}=bridge("completed");
    await expect(instance.resume(source,{taskId:"claude:managed",prompt:"continue",idempotencyKey:"33333333-3333-4333-8333-333333333333"})).resolves.toMatchObject({taskId:"claude:managed-next"});
    expect(resumeTask).toHaveBeenCalledTimes(1);
  });
});
