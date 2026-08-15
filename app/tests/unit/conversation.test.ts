import { describe, expect, it } from "vitest";
import { collaborationTurnPresentation, displayEvents, firstConversationOutput, groupProcessEvents, isFinalAssistantOutput, latestOutputRunId, organizeConversation, shortAgentName } from "../../src/web/conversation.js";
import { parallelAgentCards } from "../../src/web/parallel-agents.js";

describe("conversation presentation", () => {
  it("recognizes provider-neutral completed output without styling commentary as final",()=>{
    const final={type:"message_completed",content:"Claude-compatible final",threadId:"root",metadata:{role:"agent",nativeType:"assistant"}} as any;
    expect(isFinalAssistantOutput(final,"root",[final,{type:"task_completed",content:"done"}] as any[])).toBe(true);
    expect(isFinalAssistantOutput({type:"message_completed",content:"Codex commentary",threadId:"root",metadata:{role:"agent",phase:"commentary"}} as any,"root")).toBe(false);
    expect(isFinalAssistantOutput({type:"message_completed",content:"child final",threadId:"child",metadata:{role:"agent"}} as any,"root")).toBe(false);
    const transcript={type:"message_completed",content:"Claude transcript final",threadId:"root",metadata:{threadId:"root"}} as any;
    expect(isFinalAssistantOutput(transcript,"root",[transcript,{type:"task_completed",content:"done"}] as any[])).toBe(true);
  });

  it("uses only the last provider-neutral assistant message before task completion",()=>{
    const draft={type:"message_completed",content:"중간 보고",threadId:"root",metadata:{role:"agent",nativeType:"assistant"}} as any;
    const final={type:"message_completed",content:"최종 보고",threadId:"root",metadata:{role:"agent",nativeType:"assistant"}} as any;
    const rows=[draft,final,{type:"task_completed",content:"done"}] as any[];
    expect(isFinalAssistantOutput(draft,"root",rows)).toBe(false);
    expect(isFinalAssistantOutput(final,"root",rows)).toBe(true);
    expect(isFinalAssistantOutput({...final},"root",rows)).toBe(true);
  });

  it("finishes a busy provider-neutral turn as soon as message_completed arrives",()=>{
    const turn=organizeConversation([
      {type:"message",content:"요청",threadId:"root",metadata:{role:"user"}},
      {type:"message_completed",content:"phase 없는 최종 답변",threadId:"root",itemId:"answer",metadata:{role:"agent",nativeType:"assistant"}},
      {type:"task_completed",content:"done",threadId:"root"}
    ] as any[],"",true,"root")[0];
    expect(turn.active).toBe(false);
    expect(turn.result.map(event=>event.content)).toEqual(["phase 없는 최종 답변"]);
    expect(turn.process).toEqual([]);
  });

  it("marks a completed Claude transcript answer as a provider-neutral result",()=>{
    const turn=organizeConversation([
      {type:"message",content:"요청",threadId:"claude-thread",metadata:{role:"user"}},
      {type:"message_completed",content:"transcript 최종 답변",threadId:"claude-thread",itemId:"msg:0",metadata:{threadId:"claude-thread"}}
    ] as any[],"",false,null)[0];
    expect(turn.result).toHaveLength(1);
    expect(turn.result[0].metadata).toMatchObject({role:"agent",section:"result"});
    expect(isFinalAssistantOutput(turn.result[0],null,turn.result,true)).toBe(true);
  });

  it("assigns short A-B-C-D sequence names to generated agents",()=>{
    const names=Array.from({length:20},(_,index)=>shortAgentName(index));
    expect(names.slice(0,5)).toEqual(["Ada","Ben","Cora","Dean","Ella"]);
    expect(new Set(names).size).toBe(names.length);
    expect(names.every(name=>/^[A-Z][a-z]+(?: [2-9])?$/.test(name))).toBe(true);
  });

  it("scrolls to the newest run with output instead of a later waiting run", () => {
    const runs=[{id:"completed"},{id:"waiting"}];
    expect(latestOutputRunId(runs,(run)=>run.id==="completed"?"완료된 답변":"")).toBe("completed");
    expect(latestOutputRunId(runs,(run)=>run.id==="waiting"?"생성된 답변":"이전 답변")).toBe("waiting");
    expect(latestOutputRunId(runs,()=>" ")).toBeNull();
  });

  it("keeps streamed output visible during the terminal detail handoff",()=>{
    expect(firstConversationOutput(undefined,"", "스트림 완료 메시지")).toBe("스트림 완료 메시지");
    expect(firstConversationOutput("저장된 결과","태스크 결과","스트림 결과")).toBe("저장된 결과");
  });

  it("keeps live work expanded and moves messages into the process", () => {
    const turns = organizeConversation([
      { type:"message", content:"요청", metadata:{ role:"user" } },
      { type:"command_completed", content:"pnpm test" },
      { type:"message_delta", content:"작성 중" }
    ], "", true);
    expect(turns).toHaveLength(1);
    expect(turns[0].active).toBe(true);
    expect(turns[0].process.map((event) => event.content)).toEqual(["pnpm test", "작성 중"]);
    expect(turns[0].result).toEqual([]);
  });

  it("keeps late-arriving request input above live progress from the same turn",()=>{
    const turns=organizeConversation([
      {type:"message_completed",content:"원인을 확인하고 있습니다.",turnId:"turn-live",metadata:{role:"agent",phase:"commentary"}},
      {type:"tool_completed",content:"관련 파일 확인",turnId:"turn-live"},
      {type:"message",content:"UI 순서를 확인해 줘",turnId:"turn-live",metadata:{role:"user"}}
    ] as any[],"",true);
    expect(turns).toHaveLength(1);
    expect(turns[0].request.map(event=>event.content)).toEqual(["UI 순서를 확인해 줘"]);
    expect(turns[0].process.map(event=>event.content)).toEqual(["원인을 확인하고 있습니다.","관련 파일 확인"]);
  });

  it("keeps a terminal late-arriving request above the final output",()=>{
    const turns=organizeConversation([
      {type:"message_completed",content:"완료 결과",threadId:"root",turnId:"turn-live",metadata:{role:"agent",phase:"final_answer"}},
      {type:"task_completed",content:"Codex turn completed.",threadId:"root",turnId:"turn-live"},
      {type:"message",content:"이미지를 만들어 줘",threadId:"root",turnId:"turn-live",metadata:{role:"user"}}
    ] as any[],"",false,"root");
    expect(turns).toHaveLength(1);
    expect(turns[0].request.map(event=>event.content)).toEqual(["이미지를 만들어 줘"]);
    expect(turns[0].result.map(event=>event.content)).toEqual(["완료 결과"]);
  });

  it("keeps one agent fold when a current request arrives after agent progress and completed history",()=>{
    const turns=organizeConversation([
      {type:"message",content:"이전 요청",threadId:"root",turnId:"turn-old",metadata:{role:"user"}},
      {type:"message_completed",content:"이전 결과",threadId:"root",turnId:"turn-old",metadata:{role:"agent",phase:"final_answer"}},
      {type:"agent_started",content:"병렬 조사",threadId:"root",turnId:"turn-live",metadata:{receiverThreadIds:["child"],prompt:"UI를 조사해 줘"}},
      {type:"agent_progress",content:"서브에이전트 시작",threadId:"child",turnId:"child-turn",metadata:{agentThreadId:"child",kind:"turn_started"}},
      {type:"message",content:"현재 요청",threadId:"root",turnId:"turn-live",metadata:{role:"user"}},
      {type:"message_completed",content:"자식 결과",threadId:"child",turnId:"child-turn",metadata:{role:"agent",phase:"final_answer"}},
      {type:"agent_completed",content:"병렬 조사 완료",threadId:"root",turnId:"turn-live",metadata:{receiverThreadIds:["child"],agentsStates:{child:{status:"completed"}}}}
    ] as any[],"",true,"root");
    expect(turns).toHaveLength(2);
    expect(turns[0].request.map(event=>event.content)).toEqual(["이전 요청"]);
    expect(parallelAgentCards(turns[0].process,"root")).toEqual([]);
    expect(turns[1].request.map(event=>event.content)).toEqual(["현재 요청"]);
    expect(parallelAgentCards(turns[1].process,"root")).toMatchObject([
      {id:"child",status:"completed",events:[
        {type:"agent_started"},
        {type:"agent_progress"},
        {type:"message_completed"},
        {type:"agent_completed"}
      ]}
    ]);
  });

  it("keeps a truncated child-first stream replay in the active parent agent fold",()=>{
    const turns=organizeConversation([
      {type:"command_output",content:"child output before the surviving root rows",taskId:"task-current",threadId:"child",turnId:"child-turn",itemId:"child-command"},
      {type:"agent_progress",content:"자식 진행",taskId:"task-current",threadId:"child",turnId:"child-turn",metadata:{agentThreadId:"child",kind:"turn_started"}},
      {type:"agent_progress",content:"자식 응답 수신",taskId:"task-current",threadId:"root",turnId:"root-turn",metadata:{agentThreadId:"child",kind:"interacted",agentPath:"/root/child"}},
      {type:"tool_completed",content:"부모 검증",taskId:"task-current",threadId:"root",turnId:"root-turn"}
    ] as any[],"현재 부모 요청",true,"root");
    expect(turns).toHaveLength(1);
    expect(turns[0].request.map(event=>event.content)).toEqual(["현재 부모 요청"]);
    expect(parallelAgentCards(turns[0].process,"root")).toMatchObject([
      {id:"child",events:[
        {type:"command_output"},
        {type:"agent_progress"},
        {type:"agent_progress"}
      ]}
    ]);
  });

  it("keeps child-thread user messages inside the parent turn without suppressing its request",()=>{
    const turns=organizeConversation([
      {type:"agent_started",content:"병렬 조사",threadId:"root",turnId:"root-turn",metadata:{receiverThreadIds:["child"]}},
      {type:"message",content:"자식에게 전달된 지시",threadId:"child",turnId:"child-turn",metadata:{role:"user"}},
      {type:"message_completed",content:"자식 결과",threadId:"child",turnId:"child-turn",metadata:{role:"agent",phase:"final_answer"}},
      {type:"agent_completed",content:"완료",threadId:"root",turnId:"root-turn",metadata:{receiverThreadIds:["child"]}}
    ] as any[],"부모 요청",true,"root");
    expect(turns).toHaveLength(1);
    expect(turns[0].request.map(event=>event.content)).toEqual(["부모 요청"]);
    expect(turns[0].process.map(event=>event.content)).toContain("자식에게 전달된 지시");
    expect(parallelAgentCards(turns[0].process,"root")[0]?.events.map(event=>event.content)).toContain("자식에게 전달된 지시");
  });

  it("keeps the latest task prompt visible while the native user event is still missing",()=>{
    const createdAt="2026-07-27T05:30:00.000Z";
    const turns=organizeConversation([
      {type:"message_completed",content:"스트리밍 경과",turnId:"turn-live",metadata:{role:"agent",phase:"commentary"}}
    ] as any[],"현재 요청",true,null,createdAt);
    expect(turns).toHaveLength(1);
    expect(turns[0].request.map(event=>event.content)).toEqual(["현재 요청"]);
    expect(turns[0].request[0].timestamp).toBe(createdAt);
    expect(turns[0].process.map(event=>event.content)).toEqual(["스트리밍 경과"]);
  });

  it("adds the task creation timestamp to a matching native user event when its timestamp is missing",()=>{
    const createdAt="2026-07-27T06:47:00.000Z";
    const turns=organizeConversation([
      {type:"message",content:"이번엔 인풋에 안뜨는데?",turnId:"turn-live",metadata:{role:"user"}},
      {type:"message_completed",content:"확인했습니다.",timestamp:"2026-07-27T06:48:00.000Z",turnId:"turn-live",metadata:{role:"agent",phase:"final_answer"}}
    ] as any[],"이번엔 인풋에 안뜨는데?",false,null,createdAt);
    expect(turns[0].request[0].timestamp).toBe(createdAt);
    expect(turns[0].result[0].timestamp).toBe("2026-07-27T06:48:00.000Z");
  });

  it("places the immediately previous input at the latest turn instead of repeating the first input",()=>{
    const createdAt="2026-07-27T05:30:00.000Z";
    const turns=organizeConversation([
      {type:"message",content:"첫 입력",turnId:"turn-old",metadata:{role:"user"}},
      {type:"message_completed",content:"첫 결과",turnId:"turn-old",metadata:{role:"agent",phase:"final_answer"}},
      {type:"turn_started",content:"turn started",turnId:"turn-live"},
      {type:"tool_completed",content:"최신 작업 진행",turnId:"turn-live"}
    ] as any[],"바로 이전 입력",true,null,createdAt);
    expect(turns).toHaveLength(2);
    expect(turns[0].request.map(event=>event.content)).toEqual(["첫 입력"]);
    expect(turns[1].request.map(event=>event.content)).toEqual(["바로 이전 입력"]);
    expect(turns[1].request[0].timestamp).toBe(createdAt);
    expect(turns[1].process.map(event=>event.content)).toEqual(["최신 작업 진행"]);
  });

  it("shows the synthetic task prompt only during lifecycle-only startup",()=>{
    const turns=organizeConversation([
      {type:"task_started",content:"worker started"},
      {type:"turn_started",content:"turn started"}
    ] as any[],"현재 요청",true);
    expect(turns).toHaveLength(1);
    expect(turns[0].request.map(event=>event.content)).toEqual(["현재 요청"]);
    expect(turns[0].process).toEqual([]);
  });

  it("does not duplicate an unscoped startup prompt when turn identity arrives later",()=>{
    const turns=organizeConversation([
      {type:"message",content:"현재 요청",metadata:{role:"user",section:"request"}},
      {type:"unknown",content:"Codex thread ready.",metadata:{section:"log"}},
      {type:"turn_started",content:"turn started",turnId:"turn-live"},
      {type:"tool_completed",content:"최신 작업 진행",turnId:"turn-live"}
    ] as any[],"현재 요청",true);
    expect(turns).toHaveLength(1);
    expect(turns[0].request.map(event=>event.content)).toEqual(["현재 요청"]);
    expect(turns[0].process.map(event=>event.content)).toEqual(["Codex thread ready.","최신 작업 진행"]);
  });

  it("does not move a previous completed result below a later request",()=>{
    const turns=organizeConversation([
      {type:"message_completed",content:"이전 결과",turnId:"turn-old",metadata:{role:"agent",phase:"final_answer"}},
      {type:"message",content:"후속 요청",turnId:"turn-new",metadata:{role:"user"}},
      {type:"tool_completed",content:"후속 진행",turnId:"turn-new"}
    ] as any[],"",true);
    expect(turns).toHaveLength(2);
    expect(turns[0].result.map(event=>event.content)).toEqual(["이전 결과"]);
    expect(turns[1].request.map(event=>event.content)).toEqual(["후속 요청"]);
  });

  it("collapses completed work and preserves only the final answer as the result", () => {
    const turns = organizeConversation([
      { type:"message", content:"요청", metadata:{ role:"user" } },
      { type:"message_completed", content:"중간 설명", metadata:{ role:"agent", phase:"commentary" } },
      { type:"command_completed", content:"pnpm test" },
      { type:"message_completed", content:"최종 보고", metadata:{ role:"agent", phase:"final_answer" } },
      { type:"task_completed", content:"Codex turn completed." }
    ]);
    expect(turns[0].active).toBe(false);
    expect(turns[0].process.map((event) => event.content)).toEqual(["중간 설명", "pnpm test"]);
    expect(turns[0].result.map((event) => event.content)).toEqual(["최종 보고"]);
  });

  it("removes a superseded live final draft without removing real process commentary",()=>{
    const final="검토를 마쳤습니다.\n\n- 테스트 통과\n- 결과 정리";
    const turn=organizeConversation([
      {type:"message",content:"요청",threadId:"root",turnId:"turn",metadata:{role:"user"}},
      {type:"message_completed",content:"테스트 결과를 정리하고 있습니다.",threadId:"root",turnId:"turn",metadata:{role:"agent",phase:"commentary"}},
      {type:"message_delta",content:final,threadId:"root",turnId:"turn",itemId:"msg-live"},
      {type:"message_completed",content:final,turnId:"turn",itemId:"item-history",metadata:{role:"agent",phase:"final_answer"}},
      {type:"task_completed",content:"Codex turn completed.",threadId:"root",turnId:"turn"}
    ] as any[],"",false,"root")[0];
    expect(turn.process.map(event=>event.content)).toEqual(["테스트 결과를 정리하고 있습니다."]);
    expect(turn.result.map(event=>event.content)).toEqual([final]);
    expect(turn.timeline.map(block=>block.kind)).toEqual(["process","event"]);
  });

  it("deduplicates the same final output when one live copy has sparse identity",()=>{
    const turn=organizeConversation([
      {type:"message",content:"요청",threadId:"root",turnId:"turn",metadata:{role:"user"}},
      {type:"message",content:"같은 최종 결과",metadata:{role:"agent",section:"result"}},
      {type:"message_completed",content:"같은 최종 결과",threadId:"root",turnId:"turn",metadata:{role:"agent",phase:"final_answer"}}
    ] as any[],"",false,"root")[0];
    expect(turn.process).toEqual([]);
    expect(turn.result.map(event=>event.content)).toEqual(["같은 최종 결과"]);
  });

  it("removes an unfinished streamed prefix after the explicit final answer arrives",()=>{
    const final="완료했습니다. 수정 파일과 검증 결과를 정리했습니다.";
    const turn=organizeConversation([
      {type:"message",content:"요청",turnId:"turn",metadata:{role:"user"}},
      {type:"message_delta",content:"완료했습니다. 수정 파일과",turnId:"turn",itemId:"msg-live"},
      {type:"message_completed",content:final,turnId:"turn",itemId:"item-history",metadata:{role:"agent",phase:"final_answer"}},
      {type:"task_completed",content:"Codex turn completed.",turnId:"turn"}
    ] as any[],"",false)[0];
    expect(turn.process).toEqual([]);
    expect(turn.result.map(event=>event.content)).toEqual([final]);
    expect(turn.timeline.map(block=>block.kind)).toEqual(["event"]);
  });

  it("preserves public collaboration process rows chronologically and deduplicates native item completion",()=>{
    const view=collaborationTurnPresentation([
      {type:"message_delta",content:"중간",itemId:"commentary",metadata:{phase:"commentary"}},
      {type:"message_completed",content:"중간 설명",itemId:"commentary",metadata:{role:"agent",phase:"commentary"}},
      {type:"tool_progress",content:"비공개 추론",itemId:"thought",metadata:{deltaType:"thinking_delta"}},
      {type:"tool_started",content:"검색 시작",itemId:"tool-1",toolName:"search"},
      {type:"tool_progress",content:"검색 중",itemId:"tool-1",toolName:"search"},
      {type:"tool_completed",content:"검색 결과 1건",itemId:"tool-1",toolName:"search"},
      {type:"message_delta",content:"최종",itemId:"final",metadata:{phase:"final_answer"}},
      {type:"message_completed",content:"최종 답변",itemId:"final",metadata:{role:"agent",phase:"final_answer"}}
    ]);
    expect(view.final?.content).toBe("최종 답변");
    expect(view.process.map(row=>row.event.type)).toEqual(["message_completed","tool_completed"]);
    expect(view.process.map(row=>row.summary).join(" ")).not.toContain("비공개 추론");
    expect(view.failed).toBe(false);
  });

  it("keeps only additional completed outputs in casual-conversation process folds",()=>{
    const view=collaborationTurnPresentation([
      {type:"command_completed",content:"internal command",itemId:"cmd"},
      {type:"message_completed",content:"첫 번째 완성 출력",itemId:"message-1",metadata:{role:"agent",phase:"commentary"}},
      {type:"unknown",content:"broken internal token",metadata:{nativeMethod:"thread/status/changed"}},
      {type:"message_completed",content:"최종 출력",itemId:"message-2",metadata:{role:"agent",phase:"final_answer"}}
    ],false,true);
    expect(view.process.map(row=>row.summary)).toEqual(["첫 번째 완성 출력"]);
    expect(view.final?.content).toBe("최종 출력");
  });

  it("promotes the latest streaming output to the visible result while a casual turn is running",()=>{
    const view=collaborationTurnPresentation([
      {type:"message_completed",content:"앞선 완성 메시지",itemId:"message-1",metadata:{role:"agent",phase:"commentary"}},
      {type:"unknown",content:"internal status",metadata:{nativeMethod:"thread/status/changed"}},
      {type:"message_delta",content:"실시간 응답 중",itemId:"message-2",metadata:{role:"agent",phase:"final_answer"}}
    ],true,true);
    expect(view.final?.content).toBe("실시간 응답 중");
    expect(view.process.map(row=>row.summary)).toEqual(["앞선 완성 메시지"]);
  });

  it("keeps failed collaboration command noise out of the public process fold",()=>{
    const view=collaborationTurnPresentation([{type:"command_completed",content:"false",itemId:"cmd"},{type:"task_failed",content:"exit 1"}]);
    expect(view.process).toEqual([]);
    expect(view.failed).toBe(true);
  });

  it("organizes follow-up requests independently", () => {
    const turns = organizeConversation([
      { type:"message", content:"첫 요청", metadata:{ role:"user" } },
      { type:"message_completed", content:"첫 결과", metadata:{ role:"agent" } },
      { type:"message", content:"후속 요청", metadata:{ role:"user" } },
      { type:"tool_completed", content:"도구 결과" },
      { type:"message_completed", content:"후속 결과", metadata:{ role:"agent" } }
    ]);
    expect(turns.map((turn) => turn.result[0]?.content)).toEqual(["첫 결과", "후속 결과"]);
    expect(turns[1].process[0].content).toBe("도구 결과");
  });

  it("renders one output when legacy and completed event shapes describe the same answer",()=>{
    const turns=organizeConversation([
      {type:"message",content:"요청",turnId:"turn-dup",metadata:{role:"user"}},
      {type:"message",content:"중복되던 최종 출력",turnId:"turn-dup",itemId:"history",metadata:{role:"agent",section:"result"}},
      {type:"message_completed",content:"중복되던 최종 출력",turnId:"turn-dup",itemId:"live",metadata:{role:"agent",phase:"final_answer"}}
    ] as any[]);
    expect(turns[0].result.map(event=>event.content)).toEqual(["중복되던 최종 출력"]);
  });

  it("keeps interleaved parallel-agent message streams separate even when native item IDs collide", () => {
    const rows=displayEvents([
      {type:"message_delta",content:"A1",threadId:"agent-a",turnId:"turn-a",itemId:"message"},
      {type:"message_delta",content:"B1",threadId:"agent-b",turnId:"turn-b",itemId:"message"},
      {type:"message_delta",content:"A2",threadId:"agent-a",turnId:"turn-a",itemId:"message"},
      {type:"message_completed",content:"B done",threadId:"agent-b",turnId:"turn-b",itemId:"message"},
      {type:"message_completed",content:"A done",threadId:"agent-a",turnId:"turn-a",itemId:"message"}
    ]);
    expect(rows.map(event=>[event.threadId,event.content])).toEqual([["agent-a","A done"],["agent-b","B done"]]);
  });

  it("does not deduplicate identical completed output across agent threads",()=>{
    const rows=displayEvents([
      {type:"message_completed",content:"same result",threadId:"agent-a",turnId:"turn",itemId:"final"},
      {type:"message_completed",content:"same result",threadId:"agent-b",turnId:"turn",itemId:"final"}
    ] as any[]);
    expect(rows.map(event=>event.threadId)).toEqual(["agent-a","agent-b"]);
  });

  it("keeps child final answers and root commentary inside the process area",()=>{
    const events=[
      {type:"message",content:"요청",threadId:"root",metadata:{role:"user"}},
      {type:"agent_started",content:"병렬 조사",threadId:"root",itemId:"spawn",metadata:{receiverThreadIds:["child"],prompt:"테스트를 조사해 줘"}},
      {type:"message_completed",content:"서브에이전트 원문",threadId:"child",turnId:"child-turn",itemId:"child-final",metadata:{role:"agent",phase:"final_answer"}},
      {type:"agent_completed",content:"Subagent turn completed.",threadId:"child",metadata:{agentThreadId:"child",kind:"turn_completed"}},
      {type:"message_completed",content:"결과를 취합하고 있습니다.",threadId:"root",turnId:"root-turn",itemId:"root-commentary",metadata:{role:"agent",phase:"commentary"}},
      {type:"message_completed",content:"부모가 검증한 최종 답변",threadId:"root",turnId:"root-turn",itemId:"root-final",metadata:{role:"agent",phase:"final_answer"}},
      {type:"task_completed",content:"Codex turn completed.",threadId:"root"}
    ] as any[];
    const turn=organizeConversation(events,"",false,"root")[0];
    expect(turn.result.map(event=>[event.threadId,event.content])).toEqual([
      ["root","부모가 검증한 최종 답변"]
    ]);
    expect(turn.process.map(event=>event.content)).toContain("서브에이전트 원문");
    expect(turn.process.map(event=>event.content)).toContain("결과를 취합하고 있습니다.");
    expect(parallelAgentCards(turn.process)[0]?.events.map(event=>event.content)).toContain("서브에이전트 원문");
  });

  it("never promotes a child answer when the root turn completes without a final response",()=>{
    const turn=organizeConversation([
      {type:"message",content:"요청",threadId:"root",metadata:{role:"user"}},
      {type:"agent_started",content:"병렬 조사",threadId:"root",metadata:{receiverThreadIds:["child"]}},
      {type:"message_completed",content:"자식의 final_answer",threadId:"child",metadata:{role:"agent",phase:"final_answer"}},
      {type:"agent_completed",content:"완료",threadId:"child",metadata:{agentThreadId:"child",kind:"turn_completed"}},
      {type:"task_completed",content:"Codex turn completed.",threadId:"root"}
    ] as any[],"",false,"root")[0];
    expect(turn.result).toEqual([]);
    expect(turn.process.map(event=>event.content)).toContain("자식의 final_answer");
  });

  it("keeps root commentary in the open process area while subagents are running",()=>{
    const turn=organizeConversation([
      {type:"message",content:"요청",threadId:"root",metadata:{role:"user"}},
      {type:"message_completed",content:"두 영역을 병렬 확인하겠습니다.",threadId:"root",metadata:{role:"agent",phase:"commentary"}},
      {type:"agent_started",content:"병렬 조사",threadId:"root",metadata:{receiverThreadIds:["child"]}},
      {type:"message_completed",content:"자식 중간 결과",threadId:"child",metadata:{role:"agent",phase:"final_answer"}}
    ] as any[],"",true,"root")[0];
    expect(turn.result).toEqual([]);
    expect(turn.process.map(event=>event.content)).toContain("자식 중간 결과");
    expect(turn.process.map(event=>event.content)).toContain("두 영역을 병렬 확인하겠습니다.");
    expect(parallelAgentCards(turn.process)[0]?.events.map(event=>event.content)).toContain("자식 중간 결과");
  });

  it("moves a main-only briefing into the completed process fold",()=>{
    const events=[
      {type:"message",content:"요청",threadId:"root",metadata:{role:"user"}},
      {type:"message_completed",content:"검사를 시작했습니다.",threadId:"root",itemId:"brief",metadata:{role:"agent",phase:"commentary"}},
      {type:"command_completed",content:"pnpm test",threadId:"root"}
    ] as any[];
    const live=organizeConversation(events,"",true,"root")[0];
    expect(live.result).toEqual([]);
    expect(live.process.map(event=>event.content)).toEqual(["검사를 시작했습니다.","pnpm test"]);

    const completed=organizeConversation([
      ...events,
      {type:"message_completed",content:"검사가 끝났습니다.",threadId:"root",itemId:"final",metadata:{role:"agent",phase:"final_answer"}},
      {type:"task_completed",content:"Codex turn completed.",threadId:"root"}
    ] as any[],"",false,"root")[0];
    expect(completed.result.map(event=>event.content)).toEqual(["검사가 끝났습니다."]);
    expect(completed.process.map(event=>event.content)).toEqual(["검사를 시작했습니다.","pnpm test"]);
  });

  it("removes the trailing working card as soon as the root final answer arrives",()=>{
    const turn=organizeConversation([
      {type:"message",content:"요청",threadId:"root",turnId:"turn",metadata:{role:"user"}},
      {type:"command_completed",content:"pnpm test",threadId:"root",turnId:"turn"},
      {type:"message_completed",content:"최종 답변",threadId:"root",turnId:"turn",metadata:{role:"agent",phase:"final_answer"}}
    ] as any[],"",true,"root")[0];
    expect(turn.active).toBe(false);
    expect(turn.timeline.filter(block=>block.kind==="process")).toHaveLength(1);
    expect(turn.result.map(event=>event.content)).toEqual(["최종 답변"]);
  });

  it("does not leave live-only provider housekeeping in a fold below the final answer",()=>{
    const turn=organizeConversation([
      {type:"message",content:"요청",threadId:"root",turnId:"turn",metadata:{role:"user"}},
      {type:"command_completed",content:"pnpm test",threadId:"root",turnId:"turn"},
      {type:"message_completed",content:"최종 답변",threadId:"root",turnId:"turn",metadata:{role:"agent",phase:"final_answer"}},
      {type:"unknown",content:"Codex context usage updated.",threadId:"root",turnId:"turn",metadata:{nativeMethod:"thread/tokenUsage/updated"}},
      {type:"unknown",content:"Codex notification: account/rateLimits/updated",threadId:"root",turnId:"turn",metadata:{nativeMethod:"account/rateLimits/updated"}},
      {type:"unknown",content:"Codex notification: turn/diff/updated",threadId:"root",turnId:"turn",metadata:{truncated:true}},
      {type:"unknown",content:"Codex notification: thread/status/changed",threadId:"root",turnId:"turn",metadata:{nativeMethod:"thread/status/changed"}},
      {type:"task_completed",content:"Codex turn completed.",threadId:"root",turnId:"turn"}
    ] as any[],"",false,"root")[0];
    expect(turn.process.map(event=>event.content)).toEqual(["pnpm test"]);
    expect(turn.timeline.map(block=>block.kind==="process"
      ?`process:${block.events.map(event=>event.content).join(",")}`
      :`event:${block.event.content}`)).toEqual([
      "process:pnpm test",
      "event:최종 답변"
    ]);
  });

  it("reconstructs a child panel from thread ownership when spawn lifecycle history is missing",()=>{
    const events=[{type:"message_completed",content:"복원된 자식 결과",threadId:"child",metadata:{role:"agent",phase:"final_answer"}}] as any[];
    expect(parallelAgentCards(events,"root")).toMatchObject([{id:"child",status:"running",events:[{content:"복원된 자식 결과"}]}]);
  });

  it("keeps failures visible outside the folded process", () => {
    const turns = organizeConversation([
      { type:"message", content:"요청", metadata:{ role:"user" } },
      { type:"command_completed", content:"false" },
      { type:"task_failed", content:"exit 1" }
    ]);
    expect(turns[0].process[0].content).toBe("false");
    expect(turns[0].result[0].content).toBe("exit 1");
  });

  it("keeps context compaction visible outside folded internal events",()=>{
    const turns=organizeConversation([
      {type:"message",content:"요청",metadata:{role:"user"}},
      {type:"context_compaction",content:"Context compacted.",metadata:{trigger:"auto"}},
      {type:"task_completed",content:"Codex turn completed."}
    ]);
    expect(turns[0].process).toEqual([]);
    expect(turns[0].result).toMatchObject([{type:"context_compaction",metadata:{trigger:"auto"}}]);
  });

  it("keeps context compaction and final answers in their native timeline order",()=>{
    const compactedBeforeAnswer=organizeConversation([
      {type:"message",content:"요청",metadata:{role:"user"}},
      {type:"message_completed",content:"정리 전 진행",threadId:"root",metadata:{role:"agent",phase:"commentary"}},
      {type:"context_compaction",content:"Context compacted.",metadata:{trigger:"auto"}},
      {type:"command_completed",content:"정리 후 검사"},
      {type:"message_completed",content:"최종 답변",threadId:"root",metadata:{role:"agent",phase:"final_answer"}},
      {type:"task_completed",content:"Codex turn completed.",threadId:"root"}
    ] as any[],"",false,"root")[0];
    expect(compactedBeforeAnswer.timeline.map(block=>block.kind)).toEqual(["process","event","process","event"]);
    expect(compactedBeforeAnswer.timeline.flatMap(block=>block.kind==="process"?block.events.map(event=>[event.type,event.content]):[[block.event.type,block.event.content]])).toEqual([
      ["message_completed","정리 전 진행"],
      ["context_compaction","Context compacted."],
      ["command_completed","정리 후 검사"],
      ["message_completed","최종 답변"]
    ]);

    const compactedAfterAnswer=organizeConversation([
      {type:"message",content:"요청",metadata:{role:"user"}},
      {type:"message_completed",content:"최종 답변",threadId:"root",metadata:{role:"agent",phase:"final_answer"}},
      {type:"context_compaction",content:"Context compacted.",metadata:{trigger:"manual"}},
      {type:"task_completed",content:"Codex turn completed.",threadId:"root"}
    ] as any[],"",false,"root")[0];
    expect(compactedAfterAnswer.timeline.flatMap(block=>block.kind==="process"?block.events.map(event=>[event.type,event.content]):[[block.event.type,block.event.content]])).toEqual([
      ["message_completed","최종 답변"],
      ["context_compaction","Context compacted."]
    ]);
  });

  it("keeps every compaction boundary outside the adjacent process folds while active",()=>{
    const turn=organizeConversation([
      {type:"message",content:"요청",metadata:{role:"user"}},
      {type:"tool_completed",content:"first"},
      {type:"context_compaction",content:"auto",metadata:{trigger:"auto"}},
      {type:"command_completed",content:"second"},
      {type:"context_compaction",content:"manual",metadata:{trigger:"manual"}},
      {type:"tool_completed",content:"third"}
    ] as any[],"",true)[0];
    expect(turn.timeline.map(block=>block.kind==="process"
      ?`process:${block.events.map(event=>event.content).join(",")}:${block.active}`
      :`boundary:${block.event.content}`)).toEqual([
      "process:first:false",
      "boundary:auto",
      "process:second:false",
      "boundary:manual",
      "process:third:true"
    ]);
  });

  it("merges parallel subagent lifecycle events by thread", () => {
    const cards=parallelAgentCards([
      {type:"agent_started",content:"API 조사",itemId:"collab",metadata:{receiverThreadIds:["thread-a","thread-b"],prompt:"두 영역을 병렬 조사"}},
      {type:"agent_progress",content:"테스트 확인 중",metadata:{agentThreadId:"thread-a",agentPath:"workers/tests"}},
      {type:"command_completed",content:"pnpm test",threadId:"thread-a",metadata:{command:"pnpm test"}},
      {type:"file_change_completed",content:"+fixed",threadId:"thread-b",metadata:{path:"src/ui.ts",additions:1,deletions:0}},
      {type:"agent_started",content:"wait",itemId:"wait-call",metadata:{receiverThreadIds:[],tool:"wait"}},
      {type:"agent_progress",content:"interacted",threadId:"thread-a",metadata:{agentThreadId:"root-thread",agentPath:"/root",kind:"interacted"}},
      {type:"agent_progress",content:"started",metadata:{agentThreadId:"thread-c",agentPath:"undefined",kind:"started"}},
      {type:"agent_completed",content:"API 조사 완료",status:"completed",itemId:"collab",metadata:{receiverThreadIds:["thread-a"],agentsStates:{"thread-a":{status:"completed"}}}},
      {type:"agent_failed",content:"UI 조사 실패",status:"failed",itemId:"collab",metadata:{receiverThreadIds:["thread-b"]}}
    ]);
    expect(cards).toHaveLength(3);
    expect(cards.find(card=>card.id==="thread-a")).toMatchObject({name:"Ada",status:"completed",prompt:"두 영역을 병렬 조사"});
    expect(cards.find(card=>card.id==="thread-b")?.status).toBe("failed");
    expect(cards.find(card=>card.id==="thread-a")?.events.map(event=>event.type)).toContain("command_completed");
    expect(cards.find(card=>card.id==="thread-b")?.events.map(event=>event.type)).toContain("file_change_completed");
    expect(cards.find(card=>card.id==="thread-b")?.name).toBe("Ben");
    expect(cards.find(card=>card.id==="thread-c")?.name).toBe("Cora");
  });

  it("drops placeholder identities and gives each output event one agent owner",()=>{
    const outputA={type:"command_completed",content:"A output",threadId:"thread-a",metadata:{agentThreadId:"undefined"}} as any;
    const outputB={type:"message_completed",content:"B output",threadId:"thread-b",metadata:{role:"agent",phase:"final_answer",agentThreadId:"thread-a"}} as any;
    const cards=parallelAgentCards([
      {type:"agent_started",content:"spawn",metadata:{receiverThreadIds:["thread-a","thread-b"]}},
      outputA,
      outputB,
      {type:"agent_progress",content:"interacted",threadId:"thread-a",metadata:{agentThreadId:"thread-b",kind:"interacted"}}
    ] as any[],"root");
    expect(cards.some(card=>card.id==="undefined")).toBe(false);
    expect(cards.find(card=>card.id==="thread-a")?.events).toContain(outputA);
    expect(cards.find(card=>card.id==="thread-b")?.events).toContain(outputB);
    expect(cards.find(card=>card.id==="thread-a")?.events).not.toContain(outputB);
    expect(cards.find(card=>card.id==="thread-b")?.events).not.toContain(outputA);
  });

  it("maps native agent states without marking an in-progress wait as completed",()=>{
    const cards=parallelAgentCards([
      {type:"agent_completed",content:"wait completed",metadata:{receiverThreadIds:["running","errored"],agentsStates:{running:{status:"running",message:"still checking"},errored:{status:"errored",message:"test failed"}}}}
    ] as any[]);
    expect(cards.find(card=>card.id==="running")).toMatchObject({status:"running",activity:"still checking"});
    expect(cards.find(card=>card.id==="errored")).toMatchObject({status:"failed",activity:"test failed"});
  });

  it("folds repetitive process events by kind and keeps the latest summary", () => {
    const rows=groupProcessEvents([
      {type:"command_started",content:"pnpm test",metadata:{command:"pnpm test"}},
      {type:"unknown",content:"Codex notification: hook/started",metadata:{nativeMethod:"hook/started",payload:{run:{eventName:"preToolUse",status:"running"}}}},
      {type:"command_completed",content:"all tests passed",metadata:{command:"pnpm test"}},
      {type:"unknown",content:"Codex notification: hook/completed",metadata:{nativeMethod:"hook/completed",payload:{run:{eventName:"preToolUse",status:"completed",durationMs:160}}}},
      {type:"message_completed",content:"진행 보고",metadata:{role:"agent",phase:"commentary"}}
    ]);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({kind:"group",group:"hook",latest:"preToolUse · 완료 · 160ms"});
    expect(rows[0].kind==="group"&&rows[0].events).toHaveLength(2);
    expect(rows[1]).toMatchObject({kind:"group",group:"command",latest:"pnpm test"});
    expect(rows[2]).toMatchObject({kind:"event",event:{content:"진행 보고"}});
  });

  it("classifies Claude-compatible startup hook notifications as internal hooks",()=>{
    const rows=groupProcessEvents([
      {type:"tool_progress",content:"Claude hook_started event.",metadata:{nativeType:"system",subtype:"hook_started"}},
      {type:"tool_progress",content:"Claude hook_response event.",metadata:{nativeType:"system",subtype:"hook_response"}}
    ] as any[]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({kind:"group",group:"hook"});
    expect(rows[0].kind==="group"&&rows[0].events).toHaveLength(2);
  });

  it("keeps every folded group in a fixed slot regardless of arrival order",()=>{
    const rows=groupProcessEvents([
      {type:"tool_completed",content:"tool"},
      {type:"file_change_completed",content:"file",metadata:{path:"src/a.ts"}},
      {type:"unknown",content:"internal",metadata:{nativeMethod:"thread/status/changed"}},
      {type:"command_completed",content:"command"},
      {type:"unknown",content:"hook",metadata:{nativeMethod:"hook/completed"}},
      {type:"unknown",content:"usage",metadata:{nativeMethod:"thread/tokenUsage/updated"}}
    ]);
    expect(rows.map(row=>row.kind==="group"?row.group:"event")).toEqual(["usage","hook","internal","command","file","tool"]);
  });

  it("summarizes usage updates without exposing them as unknown events", () => {
    const rows=groupProcessEvents([
      {type:"unknown",content:"Codex notification: thread/tokenUsage/updated",metadata:{nativeMethod:"thread/tokenUsage/updated"}},
      {type:"unknown",content:"Codex notification: account/rateLimits/updated",metadata:{nativeMethod:"account/rateLimits/updated",payload:{rateLimits:{primary:{usedPercent:17,windowDurationMins:10080}}}}}
    ]);
    expect(rows).toMatchObject([{kind:"group",group:"usage",latest:"주간 사용률 17%"}]);
  });

  it("folds file modifications and shows only the latest change in the summary", () => {
    const rows=groupProcessEvents([
      {type:"file_change_started",content:"-old\n+new",metadata:{path:"src/old.ts",additions:1,deletions:1}},
      {type:"message_completed",content:"수정 확인 중",metadata:{role:"agent",phase:"commentary"}},
      {type:"file_change_completed",content:"+done",metadata:{path:"src/latest.ts",additions:3,deletions:0}}
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({kind:"group",group:"file",label:"파일 수정",latest:"src/latest.ts 수정 · +3"});
    expect(rows[0].kind==="group"&&rows[0].events).toHaveLength(2);
    expect(rows[1]).toMatchObject({kind:"event",event:{content:"수정 확인 중"}});
  });
});

describe("turn identity", () => {
  // A request plus its attachment rows are two root user events inside one
  // provider turn, so two buckets carried the same turn id and the keyed list
  // threw each_key_duplicate.
  it("gives every bucket of one turn a distinct id", () => {
    const turnId = "turn-1";
    const events = [
      { type: "message", content: "요청", turnId, metadata: { role: "user" } },
      { type: "message_completed", content: "중간 출력", turnId, metadata: { role: "agent" } },
      { type: "message", content: "[Image: shot.png]", turnId, metadata: { role: "user" } },
      { type: "message_completed", content: "최종 출력", turnId, metadata: { role: "agent", phase: "final_answer" } }
    ] as any[];
    const turns = organizeConversation(events, "", false, null);
    expect(turns.length).toBeGreaterThan(1);
    expect(new Set(turns.map((turn) => turn.id)).size).toBe(turns.length);
  });
});
