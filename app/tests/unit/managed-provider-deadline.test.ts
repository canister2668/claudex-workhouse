import {describe,it,expect,vi} from "vitest";
import {ManagedProviderBridge} from "../../src/server/managed-provider-mcp.js";
import {CollaborationOrchestrator} from "../../src/server/collaboration/orchestrator.js";

const source:any={id:"source",provider:"claude",owned:true,ownership:"claudex-workhouse",source:"claudex-workhouse",workspaceId:"workspace",executionHostId:"local",projectId:"project",status:"running",title:"Source",metadata:{automationLevel:"full"}};

function fixture(){
  let session:any;
  const db:any={
    getWorkspace:vi.fn(async()=>({id:"workspace",hostId:"local",displayName:"Workspace"})),
    getHost:vi.fn(async()=>({status:"online"})),getSystemSetting:vi.fn(async()=>null),
    upsertCollaborationSession:vi.fn(async value=>(session=value)),
    getCollaborationSession:vi.fn(async()=>session),
    upsertCollaborationParticipant:vi.fn(async value=>value),
    claimIdempotency:vi.fn(async()=>({claimed:true})),finishIdempotency:vi.fn(async()=>{}),appendAudit:vi.fn(async()=>{}),
    upsertTask:vi.fn(async value=>value),releaseCollaborationLeases:vi.fn(async()=>{}),
  };
  const orchestrator=new CollaborationOrchestrator(db,new Map([["codex",{healthCheck:async()=>({ok:true})} as any]]),{} as any,{emit:vi.fn()} as any,{} as any,async()=>({} as any));
  vi.spyOn(orchestrator as any,"launch").mockImplementation(()=>{});
  vi.spyOn(orchestrator as any,"message").mockResolvedValue({});
  vi.spyOn(orchestrator,"detail").mockImplementation(async()=>({session,participants:[],runs:[]}) as any);
  const bridge=new ManagedProviderBridge(db,orchestrator,async task=>task,async task=>task);
  vi.spyOn(bridge as any,"collaborationSnapshot").mockResolvedValue({taskId:"target",threadId:"thread",status:"running"});
  return{db,orchestrator,bridge,session:()=>session};
}

describe("managed provider execution deadline",()=>{
  it("persists a two-hour deadline through the real managed create and Assist paths",async()=>{
    const f=fixture(),before=Date.now();
    await f.bridge.create(source,{provider:"codex",prompt:"Work",idempotencyKey:"11111111-1111-4111-8111-111111111111"});
    const deadline=Date.parse(f.session().timeoutAt);
    expect(deadline).toBeGreaterThanOrEqual(before+2*60*60_000);
    expect(deadline).toBeLessThanOrEqual(Date.now()+2*60*60_000);
  });

  it("preserves the ordinary Assist twenty-minute default",async()=>{
    const f=fixture(),before=Date.now();
    await f.orchestrator.createAssist({sourceTask:source,targetProvider:"codex",executionHostId:"local",workspaceId:"workspace",title:"Assist",prompt:"Review"});
    expect(Date.parse(f.session().timeoutAt)).toBeGreaterThanOrEqual(before+20*60_000);
    expect(Date.parse(f.session().timeoutAt)).toBeLessThanOrEqual(Date.now()+20*60_000);
  });

  it("records a deadline reason on the stopped provider task",async()=>{
    const f=fixture();
    await f.orchestrator.createAssist({sourceTask:source,targetProvider:"codex",executionHostId:"local",workspaceId:"workspace",title:"Assist",prompt:"Review"});
    const task:any={id:"target",provider:"codex",status:"running",error:null},run:any={id:"run",status:"running",generation:1,deadlineAt:new Date(Date.now()-1000).toISOString()},participant:any={id:"assistant",provider:"codex",workspaceId:"workspace",executionHostId:"local",permissionMode:"read"};
    const stop=vi.fn(async()=>({...task,status:"stopped"}));
    vi.spyOn((f.orchestrator as any).transport,"forHost").mockReturnValue({stop});
    vi.spyOn(f.orchestrator as any,"lease").mockResolvedValue({lease:{id:"lease"},advisory:{}});
    vi.spyOn(f.orchestrator as any,"patchRun").mockImplementation(async(value:any,patch:any)=>({...value,...patch}));
    vi.spyOn(f.orchestrator as any,"avatar").mockResolvedValue(undefined);
    const result=await (f.orchestrator as any).executeRun(f.session(),participant,run,"Review",task);
    expect(result.run).toMatchObject({status:"timed-out",errorCategory:"timeout"});
    expect(stop).toHaveBeenCalledWith(task);
    expect(f.db.upsertTask).toHaveBeenCalledWith(expect.objectContaining({status:"stopped",error:`Execution deadline reached at ${run.deadlineAt}.`}));
  });

  it.each(["get","wait"] as const)("%s explains a persisted timeout even if provider refresh cleared the task error",async method=>{
    const f=fixture(),deadlineAt="2026-09-30T01:00:00.000Z",task:any={...source,id:"target",provider:"codex",status:"stopped",error:null,metadata:{managedProviderSourceTaskId:source.id,managedProviderCollaborationId:"collaboration"}};
    f.db.getTask=vi.fn(async()=>task);
    f.db.listCollaborationRuns=vi.fn(async()=>[{providerTaskId:task.id,status:"timed-out",deadlineAt}]);
    const snapshot=await f.bridge[method](source,{taskId:task.id});
    expect(snapshot.error).toBe(`Execution deadline reached at ${deadlineAt}.`);
    expect(snapshot.status).toBe("stopped");
  });
});
