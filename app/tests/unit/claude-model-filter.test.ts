import {describe,expect,it} from "vitest";
import {claudeSelectionTransitions,isClaudeCatalogFallback} from "../../src/web/claude-model-filter.js";

describe("Claude model catalog filtering",()=>{
  it("describes every automatic model change caused by filtering",()=>{
    expect(claudeSelectionTransitions(
      {create:"claude-fable-5",conversation:"claude-fable-5",delegation:"claude-opus-4-8"},
      {create:"claude-opus-4-8",conversation:"claude-opus-4-8",delegation:"claude-opus-4-8"}
    )).toEqual([
      {scope:"create",from:"claude-fable-5",to:"claude-opus-4-8"},
      {scope:"conversation",from:"claude-fable-5",to:"claude-opus-4-8"}
    ]);
  });
  it("distinguishes a hardcoded fallback from a stale cached catalog",()=>{
    expect(isClaudeCatalogFallback({stale:true,source:"fallback:picker timed out"})).toBe(true);
    expect(isClaudeCatalogFallback({stale:true,source:"cache"})).toBe(false);
  });
});
