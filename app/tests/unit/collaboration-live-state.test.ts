import { describe,expect,it } from "vitest";
import { collaborationTurnPresentation } from "../../src/web/conversation.js";
import { activeTaskStreamTargets, mergeCollaborationRunEvents, taskStreamCursor, taskStreamKey, upsertCollaborationRunEvent } from "../../src/web/collaboration-live-state.js";
import { taskEventKey } from "../../src/web/collaboration-identity.js";

const participants=[{id:"codex-person",provider:"codex"},{id:"claude-person",provider:"claude"}];
const run=(index:number,status:string,provider=index%2?"codex":"claude")=>({id:`run-${index}`,participantId:`${provider}-person`,providerTaskId:`${provider}:task-${index}`,status,sequence:index,round:Math.ceil(index/2),generation:index});

describe("collaboration live run state",()=>{
  it("shows the first delta immediately and accumulates later deltas in one output",()=>{const first=collaborationTurnPresentation([{type:"message_delta",content:"첫",itemId:"answer",sequence:1}],true);expect(first.final?.content).toBe("첫");const accumulated=collaborationTurnPresentation([{type:"message_delta",content:"첫",itemId:"answer",sequence:1},{type:"message_delta",content:" 번째",itemId:"answer",sequence:2},{type:"message_delta",content:" 답변",itemId:"answer",sequence:3}],true);expect(accumulated.final?.content).toBe("첫 번째 답변");});

  it("converges to one completed output regardless of completion and terminal snapshot ordering",()=>{const live=[{type:"message_delta",content:"임시",itemId:"answer",sequence:1},{type:"message_completed",content:"완성",itemId:"answer",sequence:2,metadata:{role:"agent",phase:"final_answer"}}] as any[];expect(collaborationTurnPresentation(live,false).final?.content).toBe("완성");expect(collaborationTurnPresentation([...live].reverse(),false).final?.content).toBe("완성");});

  it("merges the production snapshot replay into one card with unique render keys",()=>{
    const productionRun={id:"81d8b68f-e7f7-45a5-b8e4-9de1a4a2b98a",providerTaskId:"codex:deck:8b5fc940-4a55-45db-812b-50b59f443190",generation:1};
    const delta={type:"message_delta",content:"임시 출력",itemId:"msg_0d3d1d4396ea24d8016a59e7eb67b08197b8b8ebafff282f6a",sequence:109,eventId:"03e351f3dee4daf9:109"} as any;
    const completed={type:"message_completed",content:"완성 출력",itemId:delta.itemId,sequence:110,eventId:"03e351f3dee4daf9:110",metadata:{role:"agent",phase:"commentary"}} as any;
    const merged=mergeCollaborationRunEvents(productionRun,[completed],[delta,completed]);
    expect(merged.map(event=>event.eventId)).toEqual([delta.eventId,completed.eventId]);
    const view=collaborationTurnPresentation(merged,true);
    expect(view.process).toHaveLength(0);
    expect(view.final?.content).toBe("완성 출력");
    expect(new Set(view.process.map(row=>row.id)).size).toBe(view.process.length);
  });

  it("opens only the current non-terminal task for a sequential conversation",()=>{const runs=[...Array.from({length:10},(_,index)=>run(index+1,"completed")),run(11,"running","codex")];const targets=activeTaskStreamTargets({session:{mode:"debate"},participants,runs});expect(targets).toHaveLength(1);expect(targets[0]).toMatchObject({runId:"run-11",taskId:"codex:task-11",generation:11,provider:"codex"});expect(targets[0].key).toBe(taskStreamKey(runs[10]));});

  it("opens no task stream when re-entering a completed conversation",()=>{const runs=Array.from({length:10},(_,index)=>run(index+1,"completed"));expect(activeTaskStreamTargets({session:{mode:"debate",status:"completed"},participants,runs})).toEqual([]);});

  it("keeps an already-open task stream during the terminal drain window",()=>{const completed=run(1,"completed","deepseek"),key=taskStreamKey(completed),compatibleParticipants=[...participants,{id:"deepseek-person",provider:"deepseek"}];expect(activeTaskStreamTargets({session:{mode:"debate",status:"completed"},participants:compatibleParticipants,runs:[completed]},new Set(),new Set([key]))).toMatchObject([{key,provider:"deepseek",taskId:"deepseek:task-1"}]);expect(activeTaskStreamTargets({session:{mode:"debate",status:"completed"},participants:compatibleParticipants,runs:[completed]},new Set([key]),new Set([key]))).toEqual([]);});

  it("does not reopen a generation after its provider terminal arrives before run completion",()=>{const active=run(1,"running","codex"),key=taskStreamKey(active);expect(activeTaskStreamTargets({session:{mode:"debate"},participants,runs:[active]},new Set([key]))).toEqual([]);expect(activeTaskStreamTargets({session:{mode:"debate"},participants,runs:[{...active,generation:2}]},new Set([key]))).toHaveLength(1);});

  it("keeps generations isolated even when a run reuses its provider task id",()=>{const before={...run(1,"running","codex"),providerTaskId:"codex:shared",generation:1},after={...before,generation:2};expect(taskStreamKey(before)).not.toBe(taskStreamKey(after));});

  it("upserts the same SSE event instead of appending it twice",()=>{const active=run(1,"running","codex"),event={type:"tool_completed",eventId:"task:4",sequence:4,content:"first"} as any,first=upsertCollaborationRunEvent(active,[],event),second=upsertCollaborationRunEvent(active,first.events,{...event,content:"latest"});expect(second.events).toHaveLength(1);expect(second.events[0].content).toBe("latest");expect(second.inserted).toBe(false);});

  it("uses run-scoped sequence as the canonical REST and SSE identity",()=>{const active=run(1,"running","codex"),snapshot={type:"tool_completed",eventId:"snapshot-id",sequence:7,content:"snapshot"} as any,live={...snapshot,eventId:"stream-id",content:"stream"};const merged=mergeCollaborationRunEvents(active,[snapshot],[live]);expect(merged).toHaveLength(1);expect(merged[0]).toMatchObject({eventId:"stream-id",content:"stream"});expect(taskStreamCursor(merged)).toBe(7);});

  it("keeps equal local sequences isolated by run, participant, and generation",()=>{const codex=run(1,"running","codex"),claude={...run(2,"running","claude"),sequence:1},event={type:"message_completed",sequence:1,content:"done"} as any;expect(taskEventKey(codex,event)).not.toBe(taskEventKey(claude,event));expect(taskEventKey(codex,event)).not.toBe(taskEventKey({...codex,generation:2},event));});

  it("does not select a terminal run for late stream events",()=>{const completed=run(1,"completed","codex");expect(activeTaskStreamTargets({session:{mode:"debate"},participants,runs:[completed]})).toEqual([]);});
});
