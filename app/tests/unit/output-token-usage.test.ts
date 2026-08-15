import { describe, expect, it } from "vitest";
import { aggregateTurnOutputUsage, collaborationUsageThreadId, estimateOutputTokens, observedQuotaRange, organizeConversation, persistedTurnOutputUsage, processedUsageTokens, restoreLatestTurnOutputUsage, summarizeDisplayedOutputUsage, summarizeTurnOutputUsage, turnUsageLabelKey, turnUsageSummary } from "../../src/web/conversation.js";

describe("turn output token usage", () => {
  it("estimates live ASCII and Korean output without reporting empty content", () => {
    expect(estimateOutputTokens("")).toBe(0);
    expect(estimateOutputTokens("abcd")).toBe(1);
    expect(estimateOutputTokens("안녕하세요")).toBe(4);
  });

  it("prefers complete exact provider usage over the text estimate", () => {
    const usage=summarizeTurnOutputUsage([
      {type:"message_completed",content:"작성 중인 답변",threadId:"root",metadata:{role:"agent"}},
      {type:"unknown",content:"usage",threadId:"root",metadata:{outputUsage:{totalTokens:142,outputTokens:42,reasoningTokens:10,updatedAt:"now"}}}
    ],"root");
    expect(usage).toEqual({tokens:142,exact:true,inputTokens:100,outputTokens:42,cachedInputTokens:null,cacheWriteInputTokens:null,reasoningTokens:10,requestCount:1,updatedAt:"now"});
  });

  it("ignores child-agent usage and estimates only the root response", () => {
    const usage=summarizeTurnOutputUsage([
      {type:"message_completed",content:"root answer",threadId:"root",metadata:{role:"agent"}},
      {type:"unknown",content:"usage",threadId:"child",metadata:{outputUsage:{totalTokens:1900,outputTokens:900,reasoningTokens:null,updatedAt:"later"}}}
    ],"root");
    expect(usage).toEqual({tokens:3,exact:false,inputTokens:null,outputTokens:3,cachedInputTokens:null,cacheWriteInputTokens:null,reasoningTokens:null,requestCount:null,updatedAt:null});
  });

  it("keeps the estimate when a provider has only reported zero so far", () => {
    const usage=summarizeTurnOutputUsage([
      {type:"message_completed",content:"streaming",threadId:"root",metadata:{role:"agent"}},
      {type:"unknown",content:"usage",threadId:"root",metadata:{outputUsage:{totalTokens:null,outputTokens:0,reasoningTokens:null,updatedAt:"now"}}}
    ],"root");
    expect(usage).toMatchObject({tokens:2,exact:false});
  });

  it("uses output tokens when the provider has not reported a total",()=>{
    const usage=summarizeTurnOutputUsage([
      {type:"unknown",content:"usage",threadId:"root",metadata:{outputUsage:{totalTokens:null,outputTokens:77,reasoningTokens:12,updatedAt:"now"}}}
    ],"root");
    expect(usage).toEqual({tokens:77,exact:true,inputTokens:null,outputTokens:77,cachedInputTokens:null,cacheWriteInputTokens:null,reasoningTokens:12,requestCount:1,updatedAt:"now"});
  });

  it("uses the complete displayed conversation output when run events lack exact usage",()=>{
    expect(summarizeDisplayedOutputUsage([],"root","대화 모드의 최종 답변입니다.")).toEqual({
      tokens:11,
      exact:false,
      inputTokens:null,
      outputTokens:11,
      cachedInputTokens:null,
      cacheWriteInputTokens:null,
      reasoningTokens:null,
      requestCount:null,
      updatedAt:null
    });
  });

  it("keeps exact provider usage for a conversation run",()=>{
    expect(summarizeDisplayedOutputUsage([
      {type:"unknown",content:"usage",threadId:"root",metadata:{outputUsage:{totalTokens:177,outputTokens:77,reasoningTokens:12,updatedAt:"now"}}}
    ],"root","짧은 답변")).toEqual({tokens:177,exact:true,inputTokens:100,outputTokens:77,cachedInputTokens:null,cacheWriteInputTokens:null,reasoningTokens:12,requestCount:1,updatedAt:"now"});
  });

  it("restores exact usage from task metadata after the short-lived event spool expires",()=>{
    const stored={totalTokens:177,inputTokens:100,cachedInputTokens:30,cacheWriteInputTokens:5,outputTokens:77,reasoningTokens:12,updatedAt:"now"};
    expect(persistedTurnOutputUsage(stored)).toEqual({tokens:177,exact:true,inputTokens:100,outputTokens:77,cachedInputTokens:30,cacheWriteInputTokens:5,reasoningTokens:12,requestCount:null,updatedAt:"now"});
    expect(summarizeDisplayedOutputUsage([],"root","짧은 답변",stored)).toMatchObject({tokens:177,exact:true,outputTokens:77});
  });

  it("restores persisted task usage only onto the latest turn without overriding live exact usage",()=>{
    const turns=organizeConversation([
      {type:"message",content:"첫 질문",threadId:"root",turnId:"turn-1",metadata:{role:"user"}},
      {type:"message_completed",content:"첫 답변",threadId:"root",turnId:"turn-1",metadata:{role:"agent",phase:"final_answer"}},
      {type:"message",content:"둘째 질문",threadId:"root",turnId:"turn-2",metadata:{role:"user"}},
      {type:"message_completed",content:"둘째 답변",threadId:"root",turnId:"turn-2",metadata:{role:"agent",phase:"final_answer"}}
    ] as any,"",false,"root");
    const restored=restoreLatestTurnOutputUsage(turns,{inputTokens:100,outputTokens:77,totalTokens:177,updatedAt:"now"});
    expect(restored[0].outputUsage?.exact).toBe(false);
    expect(restored[1].outputUsage).toMatchObject({tokens:177,exact:true,outputTokens:77});
    expect(restoreLatestTurnOutputUsage([{...turns[1],outputUsage:{tokens:10,exact:true,inputTokens:4,outputTokens:6,cachedInputTokens:null,cacheWriteInputTokens:null,reasoningTokens:null,requestCount:1,updatedAt:"live"}}],{inputTokens:100,outputTokens:77})[0].outputUsage?.tokens).toBe(10);
  });

  it("uses the provider-native session id for Claude conversation usage",()=>{
    expect(collaborationUsageThreadId("claude",{threadId:"task-thread",providerSessionId:"claude-session"})).toBe("claude-session");
    expect(collaborationUsageThreadId("codex",{threadId:"codex-thread",providerSessionId:"fallback"})).toBe("codex-thread");
  });

  it("separates the tokens a turn actually burned from the cache reads that were only reused",()=>{
    const total={tokens:142,exact:true,inputTokens:100,outputTokens:42,cachedInputTokens:30,cacheWriteInputTokens:5,reasoningTokens:10,requestCount:3,updatedAt:"now"};
    const summary=turnUsageSummary(total);
    expect(summary).toEqual({billable:112,billableInput:70,output:42,reasoning:10,cacheRead:30,cacheWrite:5,savedPercent:30,processed:142,requestCount:3,exact:true});
    expect(summary.billableInput+summary.cacheRead!).toBe(total.inputTokens);
    expect(processedUsageTokens(total)).toBe(total.tokens);
    expect(turnUsageSummary({...total,inputTokens:null,cachedInputTokens:null,cacheWriteInputTokens:null})).toMatchObject({billable:null,billableInput:null,savedPercent:null,processed:null,output:42});
    expect(turnUsageSummary({...total,cachedInputTokens:0})).toMatchObject({billableInput:100,savedPercent:null});
    expect(turnUsageLabelKey(total)).toBe("tokens.answerExact");
    expect(turnUsageLabelKey({...total,tokens:42,exact:false,inputTokens:null,cachedInputTokens:null,cacheWriteInputTokens:null})).toBe("tokens.answerEstimated");
  });

  it("aggregates one provider without mixing estimated output into an exact processed total",()=>{
    const exact={tokens:142,exact:true,inputTokens:100,outputTokens:42,cachedInputTokens:30,cacheWriteInputTokens:5,reasoningTokens:10,requestCount:1,updatedAt:"2026-01-01T00:00:00Z"};
    expect(aggregateTurnOutputUsage([exact,{...exact,tokens:8,exact:false,inputTokens:null,outputTokens:8,cachedInputTokens:null,cacheWriteInputTokens:null,reasoningTokens:null,updatedAt:null}])).toEqual({
      tokens:50,exact:false,inputTokens:null,outputTokens:50,cachedInputTokens:null,cacheWriteInputTokens:null,reasoningTokens:10,requestCount:2,updatedAt:"2026-01-01T00:00:00Z"
    });
  });

  it("uses the free Codex rate-limit stream as a rounded observation, not a token conversion",()=>{
    const event=(pct:number,timestamp:string)=>({type:"unknown",content:"quota",timestamp,metadata:{nativeMethod:"account/rateLimits/updated",payload:{rateLimits:{primary:{usedPercent:pct,windowDurationMins:10080}}}}});
    expect(observedQuotaRange([event(71,"2026-01-02T00:00:00Z"),event(70,"2026-01-01T00:00:00Z")] as any,10080)).toEqual({startPct:70,endPct:71});
  });

  it("attaches a provider usage event arriving after the final answer to the same output card",()=>{
    const turns=organizeConversation([
      {type:"message",content:"질문",threadId:"root",turnId:"turn-1",metadata:{role:"user"}},
      {type:"message_completed",content:"짧은 답변",threadId:"root",turnId:"turn-1",metadata:{role:"agent",phase:"final_answer"}},
      {type:"unknown",content:"usage",threadId:"root",turnId:"turn-1",metadata:{nativeMethod:"thread/tokenUsage/updated",outputUsage:{totalTokens:2048,inputTokens:1970,cachedInputTokens:1800,cacheWriteInputTokens:0,outputTokens:78,reasoningTokens:25,updatedAt:"now"}}},
      {type:"task_completed",content:"done",threadId:"root",turnId:"turn-1",metadata:{}}
    ] as any,"",false,"root");
    expect(turns).toHaveLength(1);
    expect(turns[0].outputUsage).toMatchObject({tokens:2048,inputTokens:1970,outputTokens:78,reasoningTokens:25,exact:true});
  });
});
