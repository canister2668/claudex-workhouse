import { describe, expect, it } from "vitest";
import { codexConversationEvents, codexTurnsToEvents } from "../../src/web/codex-turns.js";
import { organizeConversation } from "../../src/web/conversation.js";

describe("Codex native turn presentation",()=>{
  it("converts native history into the shared conversation model",()=>{
    const events=codexTurnsToEvents([{id:"turn-1",status:"completed",items:[
      {id:"u1",type:"userMessage",content:[{type:"text",text:"요청"}]},
      {id:"c1",type:"commandExecution",command:"pnpm test",aggregatedOutput:"passed",status:"completed"},
      {id:"a1",type:"agentMessage",text:"완료했습니다"}
    ]}]);
    expect(events.map(event=>event.type)).toEqual(["message","command_completed","message_completed"]);
    const turns=organizeConversation(events);
    expect(turns[0].request[0].content).toBe("요청");
    expect(turns[0].process[0]).toMatchObject({type:"command_completed",content:"passed"});
    expect(turns[0].result[0].content).toBe("완료했습니다");
  });

  it("keeps provider-only items as folded diagnostics instead of raw transcript blocks",()=>{
    const [event]=codexTurnsToEvents([{id:"turn-2",items:[{type:"futureItem",value:1}]}]);
    expect(event).toMatchObject({type:"unknown",content:"Codex 기록 항목: futureItem",metadata:{nativeItemType:"futureItem"}});
  });

  it("keeps image view and generated image paths relative to the task cwd",()=>{
    const events=codexTurnsToEvents([{id:"turn-images",items:[
      {id:"view",type:"imageView",path:"/workspace/docs/preview.png"},
      {id:"generated",type:"imageGeneration",savedPath:"/workspace/out/generated.jpg",status:"completed"},
      {id:"outside",type:"imageView",path:"/private/secret.png"}
    ]}],"/workspace");
    expect(events.slice(0,2)).toMatchObject([
      {type:"tool_completed",metadata:{nativeItemType:"imageView",mediaKind:"image",mediaPath:"docs/preview.png",mediaPathBase:"task-cwd"}},
      {type:"tool_completed",metadata:{nativeItemType:"imageGeneration",mediaKind:"image",mediaPath:"out/generated.jpg",mediaPathBase:"task-cwd"}}
    ]);
    expect(events[2].metadata).not.toHaveProperty("mediaPath");
  });

  it("shows only the three most recent completed outputs with live output and removes the duplicated active turn",()=>{
    const priorTurns=Array.from({length:5},(_,index)=>({id:`turn-${index+1}`,items:[{id:`user-${index+1}`,type:"userMessage",content:[{type:"text",text:`이전 입력 ${index+1}`}]},{id:`answer-${index+1}`,type:"agentMessage",text:`이전 출력 ${index+1}`}] }));
    const history=codexTurnsToEvents([...priorTurns,
      {id:"turn-live",items:[{id:"live-user",type:"userMessage",content:[{type:"text",text:"현재 입력"}]},{id:"live-answer",type:"agentMessage",text:"임시 출력"}]}
    ]);
    const current=[
      {type:"message",content:"현재 입력",turnId:"turn-live",itemId:"live-user",metadata:{role:"user"}},
      {type:"message_delta",content:"현재 출력",turnId:"turn-live",itemId:"live-answer",metadata:{role:"agent"}}
    ] as any[];
    expect(codexConversationEvents(history,current,false)).toEqual(current);
    const combined=codexConversationEvents(history,current,true);
    expect(combined.map(event=>event.content)).toEqual(["이전 입력 3","이전 출력 3","이전 입력 4","이전 출력 4","이전 입력 5","이전 출력 5","현재 입력","현재 출력"]);
  });
});
