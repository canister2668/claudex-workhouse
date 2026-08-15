import { describe,expect,it } from "vitest";
import { canApplyLiveSnapshot, canApplySnapshotStatus, liveRowsForTask, liveSnapshotSequence, mergeLiveEvents, mergeTerminalSnapshot } from "../../src/web/live-events.js";
import { organizeConversation } from "../../src/web/conversation.js";
import { recentRunningConversationEvents } from "../../src/web/running-history.js";

describe("follow-up turn ordering",()=>{
  // The browser adds the request optimistically and keeps the previous turn's
  // rows on screen. Both used to survive the next snapshot merge unanchored:
  // the turn ended up with two request cards, and the previous turn's output
  // was re-appended below the new request.
  const previousTask="claude:previous",currentTask="claude:current";
  const previousTurn=[
    {type:"message",content:"이전 요청",timestamp:"2026-08-04T09:00:00.000Z",taskId:previousTask,metadata:{role:"user",section:"request"}},
    {type:"message_completed",content:"이전 답변",timestamp:"2026-08-04T09:01:00.000Z",taskId:previousTask,eventId:"prev:1"}
  ] as any[];
  const optimisticRequest={type:"message",content:"새 요청",timestamp:"2026-08-04T09:02:00.000Z",taskId:currentTask,metadata:{role:"user",section:"request"}} as any;
  // The server rebuilds the same turn from the thread transcript, so its copies
  // of the earlier rows carry no task and no stream identity.
  const snapshot=[
    {type:"message",content:"이전 요청",timestamp:"2026-08-04T09:00:00.000Z",metadata:{role:"user",section:"request"}},
    {type:"message_completed",content:"이전 답변",timestamp:"2026-08-04T09:01:00.000Z"},
    {...optimisticRequest},
    {type:"task_started",content:"worker started",timestamp:"2026-08-04T09:02:01.000Z",taskId:currentTask,eventId:"cur:1"}
  ] as any[];

  it("keeps one request card and the new turn's rows below it",()=>{
    const live=[...previousTurn,optimisticRequest];
    const merged=mergeTerminalSnapshot(snapshot,liveRowsForTask(live,currentTask));
    expect(merged.filter(event=>event.content==="새 요청")).toHaveLength(1);
    expect(merged.map(event=>event.content)).toEqual(["이전 요청","이전 답변","새 요청","worker started"]);
    // "current task only" must show the request first and its own rows after it.
    expect(recentRunningConversationEvents(merged,false).map(event=>event.content)).toEqual(["새 요청","worker started"]);
  });

  it("drops an earlier task's live rows and keeps unscoped history",()=>{
    const live=[{type:"message_completed",content:"전사본 행"} as any,...previousTurn,optimisticRequest];
    expect(liveRowsForTask(live,currentTask).map(event=>event.content)).toEqual(["전사본 행","새 요청"]);
    expect(liveRowsForTask(live,null)).toBe(live);
  });

  it("still separates the same words asked again in a later turn",()=>{
    const repeated={...optimisticRequest,content:"이전 요청"};
    const merged=mergeTerminalSnapshot([...snapshot.slice(0,2),repeated],[repeated]);
    expect(merged.filter(event=>event.content==="이전 요청")).toHaveLength(2);
  });

  it("deduplicates the completed Claude transcript request despite its later native timestamp",()=>{
    const snapshot=[{type:"message",content:"새 요청",timestamp:"2026-08-04T09:02:03.000Z",taskId:currentTask,metadata:{role:"user"}}] as any[];
    const live=[optimisticRequest];
    expect(mergeTerminalSnapshot(snapshot,live).filter(event=>event.content==="새 요청")).toHaveLength(1);
  });

  it("keeps a repeated Codex request when only history has provider turn ids",()=>{
    const snapshot=[
      {type:"message",content:"계속",taskId:previousTask,metadata:{role:"user",turnId:"turn-1",itemId:"user-1"}},
      {type:"message",content:"계속",taskId:currentTask,metadata:{role:"user",turnId:"turn-2",itemId:"user-2"}}
    ] as any[];
    const live=[{type:"message",content:"계속",timestamp:"2026-08-04T09:02:00.000Z",taskId:currentTask,metadata:{role:"user",section:"request"}}] as any[];
    const merged=mergeTerminalSnapshot(snapshot,live);
    expect(merged.filter(event=>event.content==="계속")).toHaveLength(2);
  });
});

describe("shared live event buffering",()=>{
  it("merges adjacent message deltas and applies one common limit",()=>{
    const merged=mergeLiveEvents([],[
      {type:"message_delta",content:"안",itemId:"m1",sequence:1,eventId:"e1"},
      {type:"message_delta",content:"녕",itemId:"m1",sequence:2,eventId:"e2"},
      {type:"tool_completed",content:"done",sequence:3,eventId:"e3"}
    ],2);
    expect(merged).toEqual([
      expect.objectContaining({type:"message_delta",content:"안녕",sequence:2}),
      expect.objectContaining({type:"tool_completed",content:"done"})
    ]);
  });

  it("keeps earlier turns' cards when live appends push the buffer past the cap",()=>{
    const current=[
      {type:"message",content:"첫 요청",metadata:{role:"user"},eventId:"u1"},
      {type:"message_completed",content:"첫 답변",eventId:"mc1"},
      ...Array.from({length:1498},(_,i)=>({type:"tool_progress",content:`step ${i}`,eventId:`p${i}`}))
    ] as any[];
    const merged=mergeLiveEvents(current,[{type:"message_completed",content:"새 답변",eventId:"mc2"}]);
    expect(merged.length).toBeLessThanOrEqual(1500);
    expect(merged.filter(event=>event.content==="첫 요청")).toHaveLength(1);
    expect(merged.filter(event=>event.content==="첫 답변")).toHaveLength(1);
    expect(merged.filter(event=>event.content==="새 답변")).toHaveLength(1);
  });

  it("does not let a stale HTTP snapshot overwrite newer SSE output",()=>{
    expect(canApplyLiveSnapshot(42,41)).toBe(false);
    expect(canApplyLiveSnapshot(42,42)).toBe(true);
    expect(canApplyLiveSnapshot(42,43)).toBe(true);
    expect(liveSnapshotSequence("43")).toBe(43);
    expect(liveSnapshotSequence(undefined)).toBe(0);
  });

  it("accepts completion from history without reopening a terminal task",()=>{
    expect(canApplySnapshotStatus("running","completed")).toBe(true);
    expect(canApplySnapshotStatus("completed","running")).toBe(false);
    expect(canApplySnapshotStatus("failed","waiting")).toBe(false);
  });


  it("preserves terminal live output when provider history is still stale",()=>{
    const snapshot=[
      {type:"message",content:"요청",turnId:"turn-1",itemId:"user-1",metadata:{role:"user"}},
      {type:"command_completed",content:"passed",turnId:"turn-1",itemId:"command-1"}
    ] as any[];
    const live=[
      {type:"message_delta",content:"완료",threadId:"root",turnId:"turn-1",itemId:"answer-1",sequence:40,eventId:"stream:40"},
      {type:"message_completed",content:"완료했습니다.",threadId:"root",turnId:"turn-1",itemId:"answer-1",sequence:41,eventId:"stream:41",metadata:{role:"agent",phase:"final_answer"}},
      {type:"task_completed",content:"Codex turn completed.",threadId:"root",turnId:"turn-1",sequence:42,eventId:"stream:42",terminal:true}
    ] as any[];
    const merged=mergeTerminalSnapshot(snapshot,live);
    expect(merged.map(event=>event.content)).toEqual(["요청","passed","완료했습니다.","Codex turn completed."]);
    expect(merged.find(event=>event.itemId==="answer-1")).toMatchObject({type:"message_completed",threadId:"root"});
  });

  it("keeps an in-flight build command when a newer output chunk is merged",()=>{
    const started={type:"command_started",content:"pnpm run build",turnId:"turn-build",itemId:"build-1",sequence:10,eventId:"stream:10"} as any;
    const output={type:"command_output",content:"transforming...",turnId:"turn-build",itemId:"build-1",sequence:11,eventId:"stream:11"} as any;
    const merged=mergeTerminalSnapshot([{type:"message",content:"빌드해줘",metadata:{role:"user"}}] as any[],[started,output]);
    expect(merged).toEqual([
      expect.objectContaining({type:"message"}),
      expect.objectContaining({type:"command_started",content:"pnpm run build"}),
      expect.objectContaining({type:"command_output",content:"transforming..."})
    ]);
  });

  it("retains terminal housekeeping data without rendering a fold below the final answer",()=>{
    const snapshot=[
      {type:"message",content:"요청",threadId:"root",turnId:"turn-1",itemId:"user-1",metadata:{role:"user"}},
      {type:"command_completed",content:"passed",threadId:"root",turnId:"turn-1",itemId:"command-1"}
    ] as any[];
    const live=[
      {type:"message_completed",content:"완료했습니다.",threadId:"root",turnId:"turn-1",itemId:"answer-1",metadata:{role:"agent",phase:"final_answer"}},
      {type:"unknown",content:"Codex context usage updated.",threadId:"root",turnId:"turn-1",metadata:{nativeMethod:"thread/tokenUsage/updated"}},
      {type:"unknown",content:"Codex notification: account/rateLimits/updated",threadId:"root",turnId:"turn-1",metadata:{nativeMethod:"account/rateLimits/updated"}},
      {type:"unknown",content:"Codex notification: turn/diff/updated",threadId:"root",turnId:"turn-1",metadata:{truncated:true}},
      {type:"unknown",content:"Codex notification: thread/status/changed",threadId:"root",turnId:"turn-1",metadata:{nativeMethod:"thread/status/changed"}},
      {type:"task_completed",content:"Codex turn completed.",threadId:"root",turnId:"turn-1",terminal:true}
    ] as any[];
    const merged=mergeTerminalSnapshot(snapshot,live),turn=organizeConversation(merged,"",false,"root")[0];
    expect(merged.filter(event=>event.type==="unknown")).toHaveLength(4);
    expect(turn.timeline.at(-1)).toMatchObject({kind:"event",event:{content:"완료했습니다."}});
    expect(turn.timeline.filter(block=>block.kind==="process")).toHaveLength(1);
  });

  it("lets the live completed item replace a lagging snapshot copy in place",()=>{
    const snapshot=[
      {type:"message",content:"요청",turnId:"turn-1",itemId:"user-1",metadata:{role:"user"}},
      {type:"message_completed",content:"이전 스냅샷",turnId:"turn-1",itemId:"answer-1",metadata:{role:"agent"}}
    ] as any[];
    const live=[{type:"message_completed",content:"최신 완료 출력",threadId:"root",turnId:"turn-1",itemId:"answer-1",metadata:{role:"agent",phase:"final_answer"}}] as any[];
    expect(mergeTerminalSnapshot(snapshot,live).map(event=>event.content)).toEqual(["요청","최신 완료 출력"]);
  });

  it("deduplicates Codex history identities stored in metadata against live top-level identities",()=>{
    const snapshot=[
      {type:"message",content:"큐 입력",metadata:{role:"user",turnId:"turn-2",itemId:"user-2"}},
      {type:"message_completed",content:"최종 출력",metadata:{role:"agent",phase:"final_answer",turnId:"turn-2",itemId:"answer-2"}}
    ] as any[];
    const live=[
      {type:"message",content:"큐 입력",turnId:"turn-2",itemId:"user-2",metadata:{role:"user"}},
      {type:"message_completed",content:"최종 출력",turnId:"turn-2",itemId:"answer-2",metadata:{role:"agent",phase:"final_answer"}}
    ] as any[];
    expect(mergeTerminalSnapshot(snapshot,live).map(event=>event.content)).toEqual(["큐 입력","최종 출력"]);
  });

  it("keeps thread history while removing the early task prompt fallback at completion",()=>{
    const snapshot=[
      {type:"message",content:"이전 요청",metadata:{role:"user",turnId:"turn-1",itemId:"user-1"}},
      {type:"message_completed",content:"이전 답변",metadata:{role:"agent",phase:"final_answer",turnId:"turn-1",itemId:"answer-1"}},
      {type:"message",content:"후속 요청",metadata:{role:"user",turnId:"turn-2",itemId:"user-2"}},
      {type:"message_completed",content:"후속 최종",metadata:{role:"agent",phase:"final_answer",turnId:"turn-2",itemId:"history-answer-2"}}
    ] as any[];
    const live=[
      {type:"message",content:"후속 요청",metadata:{role:"user",section:"request"}},
      {type:"message_completed",content:"후속 진행 1",threadId:"root",turnId:"turn-2",itemId:"comment-1",metadata:{role:"agent",phase:"commentary"}},
      {type:"message_completed",content:"후속 진행 2",threadId:"root",turnId:"turn-2",itemId:"comment-2",metadata:{role:"agent",phase:"commentary"}},
      {type:"message_completed",content:"후속 최종",threadId:"root",turnId:"turn-2",itemId:"live-answer-2",metadata:{role:"agent",phase:"final_answer"}},
      {type:"task_completed",content:"Codex turn completed.",threadId:"root",turnId:"turn-2",terminal:true}
    ] as any[];
    const merged=mergeTerminalSnapshot(snapshot,live);
    expect(merged.map(event=>event.content)).toEqual(["이전 요청","이전 답변","후속 요청","후속 진행 1","후속 진행 2","후속 최종","Codex turn completed."]);
    expect(merged.filter(event=>event.content==="후속 요청")).toHaveLength(1);
    expect(organizeConversation(merged,"",false,"root")).toHaveLength(2);
  });

  it("moves a history final answer behind live-only commentary from the same turn",()=>{
    const snapshot=[
      {type:"message",content:"요청",metadata:{role:"user",turnId:"turn-1",itemId:"user-1"}},
      {type:"message_completed",content:"최종 답변",metadata:{role:"agent",phase:"final_answer",turnId:"turn-1",itemId:"history-final"}}
    ] as any[];
    const live=[
      {type:"message",content:"요청",metadata:{role:"user",section:"request"}},
      {type:"message_completed",content:"진행 1",threadId:"root",turnId:"turn-1",itemId:"comment-1",metadata:{role:"agent",phase:"commentary"}},
      {type:"message_completed",content:"진행 2",threadId:"root",turnId:"turn-1",itemId:"comment-2",metadata:{role:"agent",phase:"commentary"}}
    ] as any[];
    expect(mergeTerminalSnapshot(snapshot,live).map(event=>event.content)).toEqual(["요청","진행 1","진행 2","최종 답변"]);
  });

  it("keeps a live-only task-start hook before the matching persisted final answer",()=>{
    const snapshot=[
      {type:"message",content:"요청",metadata:{role:"user"}},
      {type:"message_completed",content:"완료 답변",metadata:{role:"agent"}}
    ] as any[];
    const live=[
      {type:"task_started",content:"worker started",eventId:"stream:1",sequence:1},
      {type:"tool_progress",content:"Claude hook_started event.",eventId:"stream:2",sequence:2,metadata:{nativeType:"system",subtype:"hook_started"}},
      {type:"tool_progress",content:"Claude hook_response event.",eventId:"stream:3",sequence:3,metadata:{nativeType:"system",subtype:"hook_response"}},
      {type:"message_completed",content:"완료 답변",eventId:"stream:4",sequence:4,metadata:{role:"agent"}}
    ] as any[];
    const merged=mergeTerminalSnapshot(snapshot,live);
    expect(merged.map(event=>event.content)).toEqual(["요청","worker started","Claude hook_started event.","Claude hook_response event.","완료 답변"]);
    const turn=organizeConversation(merged,"",false)[0];
    expect(turn.timeline.at(-1)).toMatchObject({kind:"event",event:{content:"완료 답변"}});
  });

  it("deduplicates persisted hooks that lost their SSE identities",()=>{
    const snapshot=[
      {type:"tool_progress",content:"Claude hook_started event.",metadata:{nativeType:"system",subtype:"hook_started"}},
      {type:"tool_progress",content:"Claude hook_response event.",metadata:{nativeType:"system",subtype:"hook_response"}}
    ] as any[];
    const live=[
      {...snapshot[0],eventId:"stream:2",sequence:2},
      {...snapshot[1],eventId:"stream:3",sequence:3}
    ] as any[];
    const merged=mergeTerminalSnapshot(snapshot,live);
    expect(merged.map(event=>event.content)).toEqual(["Claude hook_started event.","Claude hook_response event."]);
    expect(merged).toEqual([expect.objectContaining({eventId:"stream:2"}),expect.objectContaining({eventId:"stream:3"})]);
  });

  it("pairs a scoped live hook with the newest anonymous snapshot occurrence",()=>{
    const hook={type:"tool_progress",content:"Claude hook_started event.",metadata:{nativeType:"system",subtype:"hook_started"}} as any;
    const snapshot=[hook,{type:"message",content:"다음 턴",metadata:{role:"user"}},{...hook}] as any[];
    const live=[{...hook,threadId:"root",eventId:"stream:new",sequence:9}] as any[];
    const merged=mergeTerminalSnapshot(snapshot,live);
    expect(merged).toHaveLength(3);
    expect(merged[0]).not.toHaveProperty("eventId");
    expect(merged.at(-1)).toMatchObject({eventId:"stream:new",threadId:"root"});
  });

  it("retains prior turns when a follow-up fails before producing output",()=>{
    const snapshot=[
      {type:"message",content:"이전 요청",metadata:{role:"user",turnId:"turn-1",itemId:"user-1"}},
      {type:"message_completed",content:"이전 답변",metadata:{role:"agent",phase:"final_answer",turnId:"turn-1",itemId:"answer-1"}},
      {type:"message",content:"실패한 후속 요청",metadata:{role:"user",turnId:"turn-2",itemId:"user-2"}}
    ] as any[];
    const live=[
      {type:"message",content:"실패한 후속 요청",metadata:{role:"user",section:"request"}},
      {type:"task_failed",content:"sandbox bootstrap failed",threadId:"root",turnId:"turn-2",terminal:true}
    ] as any[];
    const merged=mergeTerminalSnapshot(snapshot,live);
    expect(merged.map(event=>event.content)).toEqual(["이전 요청","이전 답변","실패한 후속 요청","sandbox bootstrap failed"]);
    expect(merged.filter(event=>event.content==="실패한 후속 요청")).toHaveLength(1);
  });

  it("deduplicates one Codex response even when history and SSE assign different item IDs",()=>{
    const snapshot=[
      {type:"message_completed",content:"수정해서 반영했습니다.",metadata:{role:"agent",phase:"final_answer",turnId:"turn-real",itemId:"item-1308"}}
    ] as any[];
    const live=[
      {type:"message_completed",content:"원인을 확인했습니다.",turnId:"turn-real",itemId:"msg-commentary-1",metadata:{role:"agent",phase:"commentary"}},
      {type:"message_completed",content:"DB 반영도 완료했습니다.",turnId:"turn-real",itemId:"msg-commentary-2",metadata:{role:"agent",phase:"commentary"}},
      {type:"message_completed",content:"수정해서 반영했습니다.",turnId:"turn-real",itemId:"msg-0f951e079d3a1e80016a5eedeec4b8819181a2bffef457b183",metadata:{role:"agent",phase:"final_answer"}}
    ] as any[];
    const merged=mergeTerminalSnapshot(snapshot,live);
    expect(merged.map(event=>event.content)).toEqual(["원인을 확인했습니다.","DB 반영도 완료했습니다.","수정해서 반영했습니다."]);
    expect(merged.at(-1)?.itemId).toBe("msg-0f951e079d3a1e80016a5eedeec4b8819181a2bffef457b183");
  });

  it("deduplicates the same completed response when history omits its phase",()=>{
    const snapshot=[{type:"message_completed",content:"간헐적으로 두 번 보이던 출력",turnId:"turn-3",itemId:"history-item",metadata:{role:"agent"}}] as any[];
    const live=[{type:"message_completed",content:"간헐적으로 두 번 보이던 출력",turnId:"turn-3",itemId:"live-item",metadata:{role:"agent",phase:"final_answer"}}] as any[];
    expect(mergeTerminalSnapshot(snapshot,live)).toHaveLength(1);
  });

  it("deduplicates an anonymous Claude transcript answer against its scoped SSE copy",()=>{
    const snapshot=[{type:"message_completed",content:"간헐적으로 복제되던 Claude 최종 출력",metadata:{}}] as any[];
    const live=[{type:"message_completed",content:"간헐적으로 복제되던 Claude 최종 출력",threadId:"claude-session",itemId:"msg_42:0",eventId:"stream:42",sequence:42,metadata:{nativeType:"assistant"}}] as any[];
    const merged=mergeTerminalSnapshot(snapshot,live);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({eventId:"stream:42",threadId:"claude-session"});
  });

  it("pairs an anonymous Claude transcript answer with identified live deltas and completion",()=>{
    const content="동일 블록으로 합쳐지는 Claude 최종 출력";
    const snapshot=[{type:"message_completed",content,metadata:{}}] as any[];
    const live=[
      {type:"message_delta",content:"동일 블록으로 합쳐지는 ",threadId:"claude-session",itemId:"msg_42:0",eventId:"stream:41",sequence:41},
      {type:"message_completed",content,threadId:"claude-session",itemId:"msg_42:0",eventId:"stream:42",sequence:42,metadata:{nativeType:"assistant"}}
    ] as any[];
    expect(mergeTerminalSnapshot(snapshot,live).filter(event=>event.type==="message_completed")).toEqual([expect.objectContaining({content,itemId:"msg_42:0"})]);
  });

  it("retains restored provider history when the first live event arrives",()=>{
    const history=Array.from({length:900},(_,index)=>({type:"message",content:`history-${index}`,eventId:`history:${index}`})) as any[];
    const merged=mergeLiveEvents(history,[{type:"task_started",content:"new turn",eventId:"live:1"}] as any[]);
    expect(merged).toHaveLength(901);
    expect(merged[0].content).toBe("history-0");
  });

  it("preserves intentional repeated anonymous Claude answers by occurrence",()=>{
    const repeated={type:"message_completed",content:"같은 답변",metadata:{}} as any;
    const live=[{...repeated,eventId:"stream:1"},{...repeated,eventId:"stream:2"}] as any[];
    expect(mergeTerminalSnapshot([repeated,repeated],live)).toHaveLength(2);
  });

  it("deduplicates a Claude compaction boundary without moving its snapshot position",()=>{
    const snapshot=[
      {type:"message",content:"before",timestamp:"2026-07-28T00:00:01.000Z",metadata:{role:"user"}},
      {type:"context_compaction",content:"Context compacted.",timestamp:"2026-07-28T00:00:02.000Z",metadata:{threadId:"thread",itemId:"compact-1",trigger:"auto"}},
      {type:"message_completed",content:"after",timestamp:"2026-07-28T00:00:03.000Z",metadata:{role:"agent"}}
    ] as any[];
    const live=[
      {type:"context_compaction",content:"Context compacted.",timestamp:"2026-07-28T00:00:02.000Z",threadId:"thread",itemId:"compact-1",eventId:"stream:20",sequence:20,metadata:{trigger:"auto"}}
    ] as any[];
    const merged=mergeTerminalSnapshot(snapshot,live);
    expect(merged.map(event=>event.type)).toEqual(["message","context_compaction","message_completed"]);
    expect(merged.filter(event=>event.type==="context_compaction")).toHaveLength(1);
  });

  it("ignores a replayed SSE event id before rendering",()=>{
    const event={type:"message_completed",content:"한 번만",eventId:"stream:8",sequence:8,metadata:{role:"agent"}} as any;
    expect(mergeLiveEvents([event],[event])).toEqual([event]);
  });

  it("does not append a repeated live image from the same turn and path",()=>{
    const first={type:"tool_completed",content:"imageView",turnId:"turn",itemId:"view-1",eventId:"stream:1",metadata:{mediaKind:"image",mediaPath:"out/a.png",mediaPathBase:"task-cwd"}} as any;
    const repeated={...first,itemId:"view-2",eventId:"stream:2"};
    expect(mergeLiveEvents([first],[repeated])).toEqual([expect.objectContaining({itemId:"view-2"})]);
  });

  it("deduplicates snapshot and live image ids but preserves a later turn",()=>{
    const snapshot={type:"tool_completed",content:"imageView",turnId:"turn-1",itemId:"history-view",metadata:{mediaKind:"image",mediaPath:"out/a.png",mediaPathBase:"task-cwd"}} as any;
    const live={...snapshot,itemId:"live-view",eventId:"stream:2"};
    expect(mergeTerminalSnapshot([snapshot],[live])).toHaveLength(1);
    expect(mergeTerminalSnapshot([snapshot],[live,{...live,turnId:"turn-2",itemId:"later-view",eventId:"stream:3"}])).toHaveLength(2);
  });

  it("replaces anonymous snapshot hooks when their identified SSE copies flush later",()=>{
    const hook={type:"tool_progress",content:"Claude hook_started event.",metadata:{nativeType:"system",subtype:"hook_started"}} as any;
    const snapshot=[hook,{...hook}] as any[];
    const merged=mergeLiveEvents(snapshot,[{...hook,eventId:"stream:2"},{...hook,eventId:"stream:3"}] as any[]);
    expect(merged).toHaveLength(2);
    expect(merged.map(event=>event.eventId).sort()).toEqual(["stream:2","stream:3"]);
  });

  it("does not duplicate anonymous prior turns during a queued-turn terminal handoff",()=>{
    const prior={type:"message_completed",content:"이전 작업 최종 출력",metadata:{role:"agent",phase:"final_answer"}} as any;
    const snapshot=[prior,{type:"message",content:"큐 입력",metadata:{role:"user"}}] as any[];
    const rendered=[prior,{type:"message",content:"큐 입력",metadata:{role:"user"}},{type:"message_completed",content:"새 작업 최종 출력",metadata:{role:"agent",phase:"final_answer"}}] as any[];
    expect(mergeTerminalSnapshot(snapshot,rendered).map(event=>event.content)).toEqual(["이전 작업 최종 출력","큐 입력","새 작업 최종 출력"]);
  });

  it("preserves intentional repeated anonymous rows by occurrence",()=>{
    const repeated={type:"command_completed",content:"pnpm test"} as any;
    expect(mergeTerminalSnapshot([repeated,repeated],[repeated,repeated])).toHaveLength(2);
  });

  // A long session's transcript is read from a bounded tail, so the terminal
  // snapshot can start after the turn the browser already rendered. Those older
  // live rows matched nothing in the snapshot and were appended after it, which
  // put the opening request and answer below the newest final answer.
  it("keeps live rows older than a truncated snapshot in front of it",()=>{
    const live=[
      {type:"message",content:"첫 요청",timestamp:"2026-08-08T03:05:14.000Z",metadata:{role:"user",section:"request"}},
      {type:"task_started",content:"Claude worker started.",timestamp:"2026-08-08T03:05:15.000Z"},
      {type:"tool_progress",content:"Claude hook_started event.",timestamp:"2026-08-08T03:05:17.000Z",metadata:{nativeType:"system",subtype:"hook_started"}},
      {type:"message_completed",content:"첫 답변",timestamp:"2026-08-08T03:05:19.000Z",metadata:{role:"agent",phase:"final_answer"}},
      {type:"message",content:"후속 요청",timestamp:"2026-08-08T03:09:51.000Z",metadata:{role:"user",section:"request"}},
      {type:"message_completed",content:"후속 답변",timestamp:"2026-08-08T03:11:44.000Z",metadata:{role:"agent",phase:"final_answer"}}
    ] as any[];
    // The transcript tail dropped everything before the follow-up turn, and it
    // keeps an anonymous hook whose signature also occurs in the live prefix.
    const snapshot=[
      {type:"message",content:"후속 요청",timestamp:"2026-08-08T03:09:51.000Z",metadata:{role:"user",section:"request"}},
      {type:"tool_progress",content:"Claude hook_started event.",timestamp:"2026-08-08T03:10:02.000Z",metadata:{nativeType:"system",subtype:"hook_started"}},
      {type:"message_completed",content:"후속 답변",timestamp:"2026-08-08T03:11:44.000Z",metadata:{role:"agent",phase:"final_answer"}}
    ] as any[];
    const merged=mergeTerminalSnapshot(snapshot,live);
    expect(merged.filter(event=>event.type.startsWith("message")).map(event=>event.content))
      .toEqual(["첫 요청","첫 답변","후속 요청","후속 답변"]);
    expect(merged.filter(event=>event.content==="후속 요청")).toHaveLength(1);
    expect(organizeConversation(merged,"첫 요청",false,null,"2026-08-08T03:05:14.000Z").map(turn=>turn.request[0]?.content))
      .toEqual(["첫 요청","후속 요청"]);
  });

  // A long running session's live buffer can push the merged result past the
  // cap. A raw tail slice then evicted the oldest rows -- the earlier turns'
  // requests and answers -- leaving a reopened session with no past output
  // cards. The budget must reserve conversation rows before process events.
  it("keeps earlier turns' request and answer cards when a large live buffer exceeds the limit",()=>{
    const pastTurns=[
      {type:"message",content:"첫 요청",timestamp:"2026-08-08T03:05:14.000Z",taskId:"ollama:t1",metadata:{role:"user",section:"request"}},
      {type:"message_completed",content:"첫 답변",timestamp:"2026-08-08T03:05:19.000Z",taskId:"ollama:t1",eventId:"t1:mc"},
      {type:"message",content:"둘째 요청",timestamp:"2026-08-08T03:09:51.000Z",taskId:"ollama:t2",metadata:{role:"user",section:"request"}},
      {type:"message_completed",content:"둘째 답변",timestamp:"2026-08-08T03:11:44.000Z",taskId:"ollama:t2",eventId:"t2:mc"}
    ] as any[];
    // The current task's live buffer is large enough that snapshot + live would
    // exceed the 1500 cap, so a naive tail slice would drop the past turns.
    const currentTask="ollama:t3";
    const live=Array.from({length:1600},(_,i)=>({type:"tool_progress",content:`step ${i}`,sequence:i+1,eventId:`live:${i}`,taskId:currentTask})) as any[];
    live.push({type:"message_completed",content:"현재 답변",taskId:currentTask,eventId:"t3:mc"});
    const snapshot=[...pastTurns,...live] as any[];
    const merged=mergeTerminalSnapshot(snapshot,live);
    expect(merged.length).toBeLessThanOrEqual(1500);
    // The past turns' request and answer cards must survive the truncation.
    expect(merged.filter(event=>event.content==="첫 요청")).toHaveLength(1);
    expect(merged.filter(event=>event.content==="첫 답변")).toHaveLength(1);
    expect(merged.filter(event=>event.content==="둘째 요청")).toHaveLength(1);
    expect(merged.filter(event=>event.content==="둘째 답변")).toHaveLength(1);
    expect(merged.filter(event=>event.content==="현재 답변")).toHaveLength(1);
    // The current task's process rows still fill the remainder of the budget.
    expect(merged.filter(event=>event.type==="tool_progress").length).toBeGreaterThan(1400);
  });
});
