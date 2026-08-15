import {describe,expect,it} from "vitest";
import {quotaIsStale,quotaNeedsRetry,quotaRetryDelay} from "../../src/web/quota-retry";

describe("quota retry",()=>{
  it("retries missing and transient provider results",()=>{
    expect(quotaNeedsRetry(null)).toBe(true);
    expect(quotaNeedsRetry({claude:{error:null}})).toBe(true);
    expect(quotaNeedsRetry({claude:{error:"unavailable"},codex:{error:null}})).toBe(true);
    expect(quotaNeedsRetry({claude:{error:null},codex:{error:null}})).toBe(false);
    expect(quotaNeedsRetry({claude:{error:null},codex:{error:null},ollama:{error:"unavailable"}})).toBe(true);
    expect(quotaNeedsRetry({claude:{error:null},codex:{error:null},ollama:{error:null}})).toBe(false);
  });

  it("backs off retries and slows rate-limit retries",()=>{
    expect(quotaRetryDelay(0,null)).toBe(2_000);
    expect(quotaRetryDelay(3,null)).toBe(30_000);
    expect(quotaRetryDelay(20,null)).toBe(60_000);
    expect(quotaRetryDelay(0,{codex:{error:"rate_limited"}})).toBe(60_000);
  });

  it("refreshes stale quota data after returning to the tab",()=>{
    const now=Date.parse("2026-07-19T10:00:00Z");
    expect(quotaIsStale({fetchedAt:"2026-07-19T09:59:30Z"},now)).toBe(false);
    expect(quotaIsStale({fetchedAt:"2026-07-19T09:58:59Z"},now)).toBe(true);
  });
});
