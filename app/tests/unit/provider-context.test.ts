import { describe, expect, it } from "vitest";
import { claudeContextUsage, claudeContextUsageFromStreamEvent, claudeContextWindow, claudeOutputUsageFromStreamEvent, codexContextUsage, codexOutputUsage, codexTaskOutputUsage, compactedContext } from "../../src/server/provider-context";

describe("provider context usage", () => {
  it("normalizes Codex token usage against the reported context window", () => {
    expect(codexContextUsage({last:{totalTokens:64000},modelContextWindow:128000},"2026-01-01T00:00:00.000Z")).toEqual({usedTokens:64000,windowTokens:128000,percent:50,updatedAt:"2026-01-01T00:00:00.000Z"});
  });

  it("normalizes exact provider output usage",()=>{
    expect(codexOutputUsage({last:{totalTokens:4200,inputTokens:3000,cachedInputTokens:500,cacheWriteInputTokens:100,outputTokens:1200,reasoningOutputTokens:300}},"now")).toEqual({totalTokens:4200,inputTokens:3000,cachedInputTokens:500,cacheWriteInputTokens:100,outputTokens:1200,reasoningTokens:300,updatedAt:"now"});
    expect(claudeOutputUsageFromStreamEvent({type:"stream_event",event:{type:"message_delta",usage:{output_tokens:456}}},"now")).toEqual({totalTokens:null,inputTokens:null,cachedInputTokens:null,cacheWriteInputTokens:null,outputTokens:456,reasoningTokens:null,updatedAt:"now"});
    expect(claudeOutputUsageFromStreamEvent({type:"assistant",message:{usage:{input_tokens:100,cache_creation_input_tokens:20,cache_read_input_tokens:30,output_tokens:789}}},"now")).toEqual({totalTokens:939,inputTokens:150,cachedInputTokens:30,cacheWriteInputTokens:20,outputTokens:789,reasoningTokens:null,updatedAt:"now"});
  });

  it("derives one task's exact usage from Codex thread totals across tool-loop requests",()=>{
    const first=codexTaskOutputUsage({
      total:{totalTokens:10800,inputTokens:10000,cachedInputTokens:7000,outputTokens:800,reasoningOutputTokens:200},
      last:{totalTokens:1800,inputTokens:1500,cachedInputTokens:1000,outputTokens:300,reasoningOutputTokens:80}
    },null,"first");
    expect(first.usage).toMatchObject({totalTokens:1800,inputTokens:1500,outputTokens:300,cachedInputTokens:1000,reasoningTokens:80});
    const second=codexTaskOutputUsage({
      total:{totalTokens:13600,inputTokens:12400,cachedInputTokens:8500,outputTokens:1200,reasoningOutputTokens:310},
      last:{totalTokens:2800,inputTokens:2400,cachedInputTokens:1500,outputTokens:400,reasoningOutputTokens:110}
    },first.baseline,"second");
    expect(second.usage).toMatchObject({totalTokens:4600,inputTokens:3900,outputTokens:700,cachedInputTokens:2500,reasoningTokens:190});
  });

  it("counts Claude cache tokens and preserves explicit 1M models", () => {
    expect(claudeContextWindow("claude-opus-4-6[1m]")).toBe(1_000_000);
    expect(claudeContextWindow("claude-opus-5")).toBe(1_000_000);
    expect(claudeContextUsage({input_tokens:1000,cache_creation_input_tokens:2000,cache_read_input_tokens:7000},"claude-opus-4-6[1m]","2026-01-01T00:00:00.000Z")?.percent).toBe(1);
  });

  it("marks post-compaction usage unknown until the next provider response", () => {
    expect(compactedContext({usedTokens:90000,windowTokens:200000,percent:45,updatedAt:"old"},"auto","now")).toMatchObject({usedTokens:null,windowTokens:200000,percent:null,lastCompactedAt:"now",compactionTrigger:"auto"});
  });

  it("ignores cumulative Claude result usage after compaction",()=>{
    const cumulative={type:"result",usage:{input_tokens:90000,cache_creation_input_tokens:30000,cache_read_input_tokens:120000}};
    expect(claudeContextUsageFromStreamEvent(cumulative,"claude-opus-4-6","now")).toBeNull();
    expect(claudeContextUsageFromStreamEvent({type:"assistant",message:{model:"claude-opus-5",usage:{input_tokens:1000,cache_creation_input_tokens:2000,cache_read_input_tokens:7000}}},"default","now")).toEqual({usedTokens:10000,windowTokens:1000000,percent:1,updatedAt:"now"});
  });
});
