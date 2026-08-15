import {describe,expect,it} from "vitest";
import {DEFAULT_CLAUDE_EXECUTION_SETTINGS,normalizeClaudeExecutionSettings} from "../../src/server/claude-execution-settings.js";

describe("Claude execution settings",()=>{
  it("enables flagged-message model switching by default",()=>{
    expect(normalizeClaudeExecutionSettings(null)).toEqual(DEFAULT_CLAUDE_EXECUTION_SETTINGS);
    expect(DEFAULT_CLAUDE_EXECUTION_SETTINGS.switchModelsOnFlag).toBe(true);
  });

  it("preserves an explicit disabled setting and rejects malformed values",()=>{
    expect(normalizeClaudeExecutionSettings({version:1,switchModelsOnFlag:false})).toEqual({version:1,switchModelsOnFlag:false});
    expect(normalizeClaudeExecutionSettings({version:1,switchModelsOnFlag:"false"})).toEqual(DEFAULT_CLAUDE_EXECUTION_SETTINGS);
  });
});
