import { describe,expect,it } from "vitest";
import { claudeCallCostUsd,claudeModelPrice } from "../../src/server/claude-pricing.js";

describe("Claude call pricing",()=>{
  it("charges Opus 5.5 cache reads at $0.20 and 1h cache writes at 2x input",()=>{
    const cost=claudeCallCostUsd("claude-opus-5-5",{input_tokens:1000,output_tokens:2000,cache_read_input_tokens:300_000,cache_creation_input_tokens:10_000,cache_creation:{ephemeral_5m_input_tokens:0,ephemeral_1h_input_tokens:10_000}});
    // 1000*4 + 2000*20 + 300000*0.2 + 10000*8 = 184000 -> $0.184
    expect(cost).toBeCloseTo(0.184,6);
  });

  it("treats uncategorized cache writes as 5-minute writes and doubles fast mode",()=>{
    expect(claudeCallCostUsd("claude-opus-5-5",{cache_creation_input_tokens:1_000_000})).toBeCloseTo(5,6);
    expect(claudeCallCostUsd("claude-opus-5-5[1m]",{output_tokens:1_000_000,speed:"fast"})).toBeCloseTo(40,6);
  });

  it("uses the long-prompt Haiku 5.5 rate above 100K tokens and errs high for unknown models",()=>{
    expect(claudeCallCostUsd("claude-haiku-5-5",{input_tokens:50_000})).toBeCloseTo(0.005,6);
    expect(claudeCallCostUsd("claude-haiku-5-5",{input_tokens:200_000})).toBeCloseTo(0.1,6);
    expect(claudeModelPrice("claude-something-new").known).toBe(false);
    expect(claudeCallCostUsd("claude-something-new",{input_tokens:1_000_000})).toBeCloseTo(5,6);
  });
});
