import {afterEach,describe,expect,it,vi}from"vitest";
import {LIVENESS_DEAD_MS,LIVENESS_QUIET_MS,LIVENESS_STALE_MS,deriveTaskLiveness,effectiveTransport,livenessFreshness,phaseForEvent,resetTaskLivenessForTests,rotateBuckets,subscribeTaskLiveness,taskLivenessRegistrySizeForTests}from"../../src/web/liveness";
import {setLocale}from"../../src/web/i18n";

class FakeEventSource{
  onerror:((event:any)=>void)|null=null;
  addEventListener(){}
  close(){}
}

describe("task liveness",()=>{
  afterEach(()=>{resetTaskLivenessForTests();setLocale("en");vi.unstubAllGlobals();});
  it("maps provider events to stable user-facing phases",()=>{
    expect(phaseForEvent({type:"turn_started",content:""},"idle")).toBe("reasoning");
    expect(phaseForEvent({type:"command_started",content:"test"},"reasoning")).toBe("acting");
    expect(phaseForEvent({type:"command_completed",content:"done"},"acting")).toBe("acting");
    expect(phaseForEvent({type:"approval_required",content:""},"acting")).toBe("waiting-approval");
    expect(phaseForEvent({type:"approval_resolved",content:""},"waiting-approval")).toBe("reasoning");
    expect(phaseForEvent({type:"user_input_required",content:""},"reasoning")).toBe("waiting-user");
    expect(phaseForEvent({type:"task_completed",content:""},"acting")).toBe("completed");
    expect(phaseForEvent({type:"task_failed",content:""},"acting")).toBe("failed");
    expect(phaseForEvent({type:"task_stopped",content:""},"acting")).toBe("stopped");
    expect(phaseForEvent({type:"turn_started",content:"Claude session initialized.",metadata:{nativeType:"system",subtype:"init"}},"queued","claude")).toBe("queued");
  });

  it("uses exact quiet and stale boundaries",()=>{
    const now=100_000;
    expect(livenessFreshness(now-LIVENESS_QUIET_MS+1,now)).toBe("fresh");
    expect(livenessFreshness(now-LIVENESS_QUIET_MS,now)).toBe("quiet");
    expect(livenessFreshness(now-LIVENESS_STALE_MS+1,now)).toBe("quiet");
    expect(livenessFreshness(now-LIVENESS_STALE_MS,now)).toBe("stale");
    expect(livenessFreshness(now-LIVENESS_DEAD_MS,now)).toBe("dead");
  });

  it("keeps transport health separate from task freshness",()=>{
    const now=100_000;
    expect(effectiveTransport("live",now-LIVENESS_DEAD_MS*2,now)).toBe("connected");
    expect(effectiveTransport("connecting",now-1_000,now)).toBe("degraded");
    expect(effectiveTransport("delayed",now-LIVENESS_DEAD_MS,now)).toBe("lost");
  });

  it("rotates five-second activity buckets without exceeding twenty",()=>{
    const initial=Array(20).fill(0);
    const first=rotateBuckets(initial,0,1_000);
    expect(first.at(-1)).toBe(1);
    const moved=rotateBuckets(first,1_000,11_000);
    expect(moved).toHaveLength(20);
    expect(moved.slice(-3)).toEqual([1,0,1]);
  });

  it("keeps plans and decisions attributed to the derived task",()=>{
    const now=Date.parse("2026-07-30T12:00:00Z");
    const state=deriveTaskLiveness([
      {type:"tool_completed",content:"plan updated",timestamp:"2026-07-30T11:59:58Z",metadata:{plan:{steps:[
        {step:"Inspect",status:"completed"},
        {step:"Implement",status:"in_progress"}
      ]}}},
      {type:"user_input_required",content:"Choose scope",timestamp:"2026-07-30T11:59:59Z",metadata:{
        requestId:"decision-1",
        questions:[{id:"scope",header:"Scope",question:"Where?",options:[{label:"Mobile"}]}]
      }}
    ],{provider:"codex",taskId:"task-1",now});
    expect(state.taskId).toBe("task-1");
    expect(state.plan?.currentStep).toBe(2);
    expect(state.plan?.steps[1].status).toBe("active");
    expect(state.pendingDecision?.id).toBe("decision-1");
    expect(state.phase).toBe("waiting-user");
  });

  it("folds a resolved decision into a task-scoped record",()=>{
    const now=Date.parse("2026-07-30T12:00:00Z");
    const state=deriveTaskLiveness([
      {type:"user_input_required",content:"Choose",timestamp:"2026-07-30T11:59:58Z",metadata:{requestId:"d1",questions:[{id:"q",question:"Scope?",options:[]}]}},
      {type:"user_input_resolved",content:"Mobile",timestamp:"2026-07-30T11:59:59Z",metadata:{requestId:"d1"}}
    ],{provider:"codex",taskId:"task-1",now});
    expect(state.pendingDecision).toBeUndefined();
    expect(state.resolvedDecision).toMatchObject({id:"d1",selectedOption:"Mobile"});
  });

  it("does not let Claude telemetry overwrite concrete task activity",()=>{
    setLocale("ko");
    const now=Date.parse("2026-08-13T10:00:20Z");
    const events=[
      {type:"task_started" as const,content:"Claude worker started.",timestamp:"2026-08-13T10:00:00Z"},
      {type:"turn_started" as const,content:"Claude session initialized.",timestamp:"2026-08-13T10:00:01Z",metadata:{nativeType:"system",subtype:"init"}},
      {type:"tool_progress" as const,content:"Claude hook_started event.",timestamp:"2026-08-13T10:00:02Z",metadata:{nativeType:"system",subtype:"hook_started"}},
      {type:"command_started" as const,content:"pnpm test",itemId:"cmd-1",timestamp:"2026-08-13T10:00:03Z"},
      {type:"tool_progress" as const,content:"Claude tool progress.",timestamp:"2026-08-13T10:00:04Z",metadata:{synthetic:true}},
      {type:"command_completed" as const,content:"tests passed",itemId:"cmd-1",timestamp:"2026-08-13T10:00:05Z"},
      {type:"tool_progress" as const,content:"Claude status event.",timestamp:"2026-08-13T10:00:19Z",metadata:{nativeType:"system",subtype:"status"}}
    ];
    const original=JSON.stringify(events);
    const state=deriveTaskLiveness(events,{provider:"claude",taskId:"claude-task",status:"running",now});
    expect(state.lastEventAt).toBe(Date.parse("2026-08-13T10:00:19Z"));
    expect(state.lastMeaningfulEventAt).toBe(Date.parse("2026-08-13T10:00:05Z"));
    expect(state.commandCount).toBe(1);
    expect(state.toolCount).toBe(0);
    expect(state.recentActivity?.type).toBe("reasoning");
    expect(state.lastContent).toBe("분석 중");
    expect(state.lastContent).not.toMatch(/Claude|hook|status|progress/i);
    expect(JSON.stringify(events)).toBe(original);
  });

  it("keeps parallel activity leases independent and expires abandoned ones",()=>{
    const base=Date.parse("2026-08-13T10:00:00Z");
    const active=deriveTaskLiveness([
      {type:"tool_started",content:"Read A",itemId:"tool-a",timestamp:new Date(base).toISOString()},
      {type:"tool_started",content:"Search B",itemId:"tool-b",timestamp:new Date(base+1_000).toISOString()},
      {type:"tool_completed",content:"done",itemId:"tool-a",timestamp:new Date(base+2_000).toISOString()}
    ],{provider:"claude",taskId:"parallel",status:"running",now:base+3_000});
    expect(active.toolCount).toBe(2);
    expect(active.recentActivity?.detail).toBe("Search B");

    const expired=deriveTaskLiveness([
      {type:"tool_started",content:"Abandoned tool",itemId:"tool-old",timestamp:new Date(base).toISOString()},
      {type:"tool_progress",content:"heartbeat",timestamp:new Date(base+100_000).toISOString()}
    ],{provider:"claude",taskId:"expired",status:"running",now:base+100_000});
    expect(expired.recentActivity?.type).toBe("reasoning");
  });

  it("evicts an unused task from the shared liveness registry",()=>{
    vi.stubGlobal("EventSource",FakeEventSource);
    const stop=subscribeTaskLiveness({provider:"codex",taskId:"task-evict",onChange:()=>{}});
    expect(taskLivenessRegistrySizeForTests()).toBe(1);
    stop();
    expect(taskLivenessRegistrySizeForTests()).toBe(0);
  });
});
