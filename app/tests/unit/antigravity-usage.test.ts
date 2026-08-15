import {describe,expect,it} from "vitest";
import {addAntigravityUsage,antigravityContextUsage,antigravityContextWindow,antigravityOutputUsage,antigravityStepUsage,antigravityUsageTotals} from "../../src/server/antigravity-usage";

// Counters copied from a real `agy --output-format stream-json` run.
const step={event:"step_update",step_update:{step_index:133,step_type:"agent_response",usage:{input_tokens:3775,output_tokens:73,thinking_tokens:0,cache_read_tokens:93502,total_tokens:3848}}};

describe("Antigravity usage adapters",()=>{
  it("normalizes the CLI's cache-exclusive input into the deck's inclusive convention",()=>{
    expect(antigravityUsageTotals(step.step_update.usage)).toEqual({inputTokens:97277,outputTokens:73,cachedInputTokens:93502,reasoningTokens:0});
    expect(antigravityUsageTotals({input_tokens:100,output_tokens:10,thinking_tokens:4})).toEqual({inputTokens:100,outputTokens:14,cachedInputTokens:0,reasoningTokens:4});
    expect(antigravityUsageTotals({})).toBeNull();
    expect(antigravityUsageTotals(null)).toBeNull();
  });
  it("emits the camelCase output usage the conversation and quota views read",()=>{
    const usage=antigravityOutputUsage(antigravityUsageTotals(step.step_update.usage),2,"2026-08-03T00:00:00.000Z");
    expect(usage).toEqual({totalTokens:97350,inputTokens:97277,cachedInputTokens:93502,cacheWriteInputTokens:null,outputTokens:73,reasoningTokens:0,requestCount:2,updatedAt:"2026-08-03T00:00:00.000Z"});
    expect(antigravityOutputUsage(null,1)).toBeNull();
  });
  it("accumulates per-step counters into a turn total",()=>{
    const totals=[step.step_update.usage,{input_tokens:2624,output_tokens:74,cache_read_tokens:97560}]
      .reduce<ReturnType<typeof antigravityUsageTotals>>((base,usage)=>addAntigravityUsage(base,antigravityUsageTotals(usage)),null);
    expect(totals).toEqual({inputTokens:197461,outputTokens:147,cachedInputTokens:191062,reasoningTokens:0});
    expect(addAntigravityUsage(null,null)).toBeNull();
  });
  it("reads step usage with its request identity",()=>{
    expect(antigravityStepUsage(step)).toEqual({totals:{inputTokens:97277,outputTokens:73,cachedInputTokens:93502,reasoningTokens:0},stepIndex:133});
    expect(antigravityStepUsage({event:"step_update",step_update:{step_type:"agent_response"}})).toBeNull();
  });
  it("derives context usage from one request rather than the cumulative result envelope",()=>{
    expect(antigravityContextUsage(step.step_update.usage,"gemini-3.6-flash-high","2026-08-03T00:00:00.000Z"))
      .toEqual({usedTokens:97277,windowTokens:1_000_000,percent:9.7,updatedAt:"2026-08-03T00:00:00.000Z"});
  });
  it("reports tokens without a percentage when the model window is unknown",()=>{
    expect(antigravityContextWindow("Gemini 3.5 Flash (High)")).toBe(1_000_000);
    expect(antigravityContextWindow("Claude Opus 4.6 (Thinking)")).toBe(200_000);
    expect(antigravityContextWindow("some-unlisted-model")).toBeNull();
    expect(antigravityContextUsage(step.step_update.usage,"some-unlisted-model")?.percent).toBeNull();
  });
});
