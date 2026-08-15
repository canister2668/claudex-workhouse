import { describe, expect, it } from "vitest";
import { LIVE_WORK_REDESIGN_KEY, liveWorkRedesignEnabled } from "../../src/web/ui-feature-flags";

describe("live work redesign feature flag",()=>{
  it("defaults on and can fall back to the session list",()=>{
    expect(liveWorkRedesignEnabled(null)).toBe(true);
    expect(liveWorkRedesignEnabled({getItem:key=>key===LIVE_WORK_REDESIGN_KEY?"false":null})).toBe(false);
    expect(liveWorkRedesignEnabled({getItem:()=>"true"})).toBe(true);
  });
});
