import {describe,expect,it} from "vitest";
import {antigravityConversationId,antigravityFinalResponse,antigravityTextValue,normalizeAntigravityOutputEvents,parseAntigravityModels} from "../../src/server/antigravity-runtime";

describe("Antigravity runtime adapters",()=>{
  it("extracts conversation identity from structured init events",()=>{
    expect(antigravityConversationId({type:"init",conversation_id:"a1b2-c3"})).toBe("a1b2-c3");
    expect(antigravityConversationId({conversation:{id:"nested-id"}})).toBe("nested-id");
  });
  it("extracts text from result and nested message payloads",()=>{
    expect(antigravityTextValue({type:"result",result:{content:[{text:"done"}]}})).toBe("done");
    expect(antigravityTextValue({event:"result",result:{response:"안녕하세요"}})).toBe("안녕하세요");
  });
  it("extracts the final response from the real stream-json envelope",()=>{
    const output=[
      JSON.stringify({event:"init",conversation_id:"session-1",init:{model:"gemini"}}),
      JSON.stringify({event:"step_update",step_update:{step_type:"agent_response",text_delta:"중간 응답"}}),
      JSON.stringify({event:"result",result:{conversation_id:"session-1",status:"SUCCESS",response:"까꿍! 안녕하세요! 😊\n"}})
    ].join("\n");
    expect(antigravityFinalResponse(output)).toBe("까꿍! 안녕하세요! 😊");
    expect(normalizeAntigravityOutputEvents([{type:"message_completed",content:output}])).toEqual([{type:"message_completed",content:"까꿍! 안녕하세요! 😊"}]);
  });
  it("normalizes and deduplicates the CLI model catalog",()=>{
    expect(parseAntigravityModels("Available models\n- Gemini 3.5 Flash (High)\n• Gemini 3.5 Flash (High)\n- Claude Opus 4.6 (Thinking)\n")).toEqual([
      {id:"Gemini 3.5 Flash (High)",displayName:"Gemini 3.5 Flash (High)",source:"runtime"},
      {id:"Claude Opus 4.6 (Thinking)",displayName:"Claude Opus 4.6 (Thinking)",source:"runtime"}
    ]);
  });
});
