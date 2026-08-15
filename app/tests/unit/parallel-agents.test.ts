import {describe,expect,it}from"vitest";
import type {AgentEvent}from"../../src/web/events";
import {parallelAgentCards,parallelAgentTally,parallelAgentsActive,sortAgentsByAttention}from"../../src/web/parallel-agents";
import {deriveTaskLiveness}from"../../src/web/liveness";

const spawn=(ids:string[]):AgentEvent=>({type:"agent_started",content:"spawn",metadata:{receiverThreadIds:ids},threadId:"root",timestamp:"2026-08-01T00:00:00.000Z"});

describe("parallel agent state",()=>{
  it("marks a child that stopped for a human as waiting until the approval resolves",()=>{
    const events:AgentEvent[]=[
      spawn(["child-a","child-b"]),
      {type:"approval_required",content:"캐시 삭제",threadId:"child-b",metadata:{command:"rm -rf runtime/cache"},timestamp:"2026-08-01T00:00:10.000Z"}
    ];
    const waiting=parallelAgentCards(events,"root");
    expect(waiting.map(card=>card.status)).toEqual(["running","waiting"]);
    expect(waiting[1]?.waitingReason).toBe("rm -rf runtime/cache");

    const resolved=parallelAgentCards([...events,{type:"approval_resolved",content:"승인됨",threadId:"child-b",timestamp:"2026-08-01T00:00:20.000Z"}],"root");
    expect(resolved.map(card=>card.status)).toEqual(["running","running"]);
    expect(resolved[1]?.waitingReason).toBe("");
  });

  it("keeps names bound to spawn order while ranking attention first",()=>{
    const cards=parallelAgentCards([
      spawn(["child-a","child-b","child-c"]),
      {type:"agent_completed",content:"done",threadId:"root",metadata:{agentThreadId:"child-a"},timestamp:"2026-08-01T00:00:05.000Z"},
      {type:"approval_required",content:"확인 필요",threadId:"child-c",timestamp:"2026-08-01T00:00:06.000Z"}
    ],"root");
    expect(cards.map(card=>[card.name,card.status])).toEqual([["Ada","completed"],["Ben","running"],["Cora","waiting"]]);
    expect(sortAgentsByAttention(cards).map(card=>card.name)).toEqual(["Cora","Ben","Ada"]);
  });

  it("counts activity and elapsed window per child",()=>{
    const cards=parallelAgentCards([
      spawn(["child-a"]),
      {type:"command_completed",content:"pnpm test",threadId:"child-a",timestamp:"2026-08-01T00:00:30.000Z"},
      {type:"tool_completed",content:"read",threadId:"child-a",timestamp:"2026-08-01T00:01:00.000Z"}
    ],"root");
    expect(cards[0]?.activityCount).toBe(2);
    expect(cards[0]?.startedAt).toBe(Date.parse("2026-08-01T00:00:00.000Z"));
    expect(cards[0]?.lastEventAt).toBe(Date.parse("2026-08-01T00:01:00.000Z"));
  });

  it("tallies and reports whether any child still needs the runtime",()=>{
    const done=[{status:"completed" as const},{status:"failed" as const}];
    expect(parallelAgentTally(done)).toEqual({total:2,running:0,waiting:0,failed:1,completed:1});
    expect(parallelAgentsActive(done)).toBe(false);
    expect(parallelAgentsActive([...done,{status:"waiting" as const}])).toBe(true);
  });

  it("carries the child roster into task liveness without counting parent activity",()=>{
    const state=deriveTaskLiveness([
      {type:"command_started",content:"parent work",threadId:"root",timestamp:"2026-08-01T00:00:01.000Z"},
      spawn(["child-a","child-b"]),
      {type:"approval_required",content:"확인 필요",threadId:"child-b",timestamp:"2026-08-01T00:00:09.000Z"}
    ],{provider:"codex",taskId:"task-1",status:"running",rootThreadId:"root",now:Date.parse("2026-08-01T00:00:30.000Z")});
    expect(state.agentTally).toEqual({total:2,running:1,waiting:1,failed:0,completed:0});
    expect(state.agents.map(agent=>agent.name)).toEqual(["Ada","Ben"]);
    expect(state.agents.every(agent=>!("events" in agent))).toBe(true);
  });

  it("leaves the roster empty for a task that never spawned a child",()=>{
    const state=deriveTaskLiveness([
      {type:"command_started",content:"solo",threadId:"root",timestamp:"2026-08-01T00:00:01.000Z"}
    ],{provider:"codex",taskId:"task-2",status:"running",rootThreadId:"root",now:Date.parse("2026-08-01T00:00:05.000Z")});
    expect(state.agents).toEqual([]);
    expect(state.agentTally.total).toBe(0);
  });
});
