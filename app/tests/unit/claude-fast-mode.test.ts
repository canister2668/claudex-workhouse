import { describe,expect,it } from "vitest";
import { claudeModelSupportsFastMode } from "../../src/server/claude-fast-mode.js";
import { claudeFastModeModel } from "../../src/web/claude-fast-mode.js";

describe("Claude fast mode",()=>{
  it("applies only to the Opus models that support it, on server and web alike",()=>{
    for(const model of ["default","opus","claude-opus-5-5","claude-opus-5","claude-opus-4-8","claude-opus-5-5[1m]",null]){expect(claudeModelSupportsFastMode(model)).toBe(true);expect(claudeFastModeModel(model)).toBe(true);}
    for(const model of ["claude-opus-4-7","claude-sonnet-5-5","claude-haiku-5-5","claude-fable-5-1"]){expect(claudeModelSupportsFastMode(model)).toBe(false);expect(claudeFastModeModel(model)).toBe(false);}
  });
});
