import { describe, expect, it } from "vitest";
import { recentRunningConversationEvents, RUNNING_HISTORY_OUTPUT_LIMIT } from "../../src/web/running-history.js";

const turn=(index:number)=>[
  {type:"message",content:`입력 ${index}`,metadata:{role:"user"}},
  {type:"message_completed",content:`출력 ${index}`,metadata:{role:"agent",phase:"final_answer"}}
] as any[];

describe("running conversation history",()=>{
  it("keeps the current Claude turn plus the three latest completed output turns",()=>{
    const events=[...turn(1),...turn(2),...turn(3),...turn(4),...turn(5),{type:"message",content:"현재 입력",metadata:{role:"user"}},{type:"message_delta",content:"현재 출력",metadata:{role:"agent"}}] as any[];
    expect(RUNNING_HISTORY_OUTPUT_LIMIT).toBe(3);
    expect(recentRunningConversationEvents(events,false).map(event=>event.content)).toEqual(["현재 입력","현재 출력"]);
    expect(recentRunningConversationEvents(events,true).map(event=>event.content)).toEqual(["입력 3","출력 3","입력 4","출력 4","입력 5","출력 5","현재 입력","현재 출력"]);
  });

  it("does not count a previous turn without an assistant output",()=>{
    const events=[...turn(1),{type:"message",content:"중단된 입력",metadata:{role:"user"}},...turn(2),{type:"message",content:"현재 입력",metadata:{role:"user"}}] as any[];
    expect(recentRunningConversationEvents(events,true).map(event=>event.content)).toEqual(["입력 1","출력 1","입력 2","출력 2","현재 입력"]);
  });
});
