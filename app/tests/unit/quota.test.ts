import { describe, expect, it } from "vitest";
import { mapAntigravityQuotaError, mapClaudeQuota, mapCodexQuota, mapDeepseekBalance, mapGrokQuota, mapOllamaPlan, mapOllamaQuota, quotaCacheDuration, readFreshCodexRateLimits, QUOTA_CACHE_OK_MS, QUOTA_CACHE_TRANSIENT_MS } from "../../src/server/quota.js";

describe("quota mapping", () => {
  it("refreshes the Codex account before reading limits after a plan change",async()=>{
    const calls:Array<{method:string;params:Record<string,unknown>;timeoutMs:number|undefined}>=[],limits={rateLimits:{planType:"prolite"}};
    const result=await readFreshCodexRateLimits(async(method,params,timeoutMs)=>{calls.push({method,params,timeoutMs});return method==="account/read"?{account:{planType:"prolite"}}:limits;});
    expect(result).toBe(limits);
    expect(calls).toEqual([
      {method:"account/read",params:{refreshToken:true},timeoutMs:45_000},
      {method:"account/rateLimits/read",params:{},timeoutMs:45_000}
    ]);
  });

  it("still reads Codex limits when the account refresh fails",async()=>{
    const calls:string[]=[],limits={rateLimits:{primary:{usedPercent:49,windowDurationMins:10080}}};
    const result=await readFreshCodexRateLimits(async method=>{calls.push(method);if(method==="account/read")throw new Error("refresh unavailable");return limits;});
    expect(result).toBe(limits);
    expect(calls).toEqual(["account/read","account/rateLimits/read"]);
  });

  it("keeps successful usage cached but releases transient failures quickly",()=>{
    expect(quotaCacheDuration({claude:{error:null},codex:{error:null}})).toBe(QUOTA_CACHE_OK_MS);
    expect(quotaCacheDuration({claude:{error:null}})).toBe(QUOTA_CACHE_TRANSIENT_MS);
    expect(quotaCacheDuration({claude:{error:"unavailable"},codex:{error:null}})).toBe(QUOTA_CACHE_TRANSIENT_MS);
    expect(quotaCacheDuration({claude:{error:"rate_limited"},codex:{error:null}})).toBe(QUOTA_CACHE_OK_MS);
    expect(quotaCacheDuration({claude:{error:"rate_limited"},codex:{error:"unavailable"}})).toBe(QUOTA_CACHE_TRANSIENT_MS);
  });
  it("maps a lone Codex weekly primary by duration instead of position", () => {
    const quota = mapCodexQuota({ rateLimits:{ planType:"pro", primary:{ usedPercent:17, windowDurationMins:10080, resetsAt:1784491650 }, secondary:null } });
    expect(quota?.fiveHour).toBeNull();
    expect(quota?.sevenDay?.pct).toBe(17);
    expect(quota?.sevenDay?.durationMins).toBe(10080);
    expect(quota?.status).toBe("partial");
  });

  it("maps both Codex windows even when their slots are reversed", () => {
    const quota = mapCodexQuota({ rateLimits:{ primary:{ usedPercent:42, windowDurationMins:10080 }, secondary:{ usedPercent:9, windowDurationMins:300 } } });
    expect(quota?.fiveHour?.pct).toBe(9);
    expect(quota?.sevenDay?.pct).toBe(42);
    expect(quota?.status).toBe("ok");
  });

  it("maps the Codex five-hour window from the new keyed multi-limit response",()=>{
    const quota=mapCodexQuota({
      rateLimits:{primary:{usedPercent:27,windowDurationMins:10080}},
      rateLimitsByLimitId:{
        other:{primary:{usedPercent:88,windowDurationMins:60}},
        codex:{primary:{usedPercent:14,windowDurationMins:300,resetsAt:1785510000}}
      }
    });
    expect(quota?.fiveHour).toMatchObject({pct:14,durationMins:300});
    expect(quota?.fiveHour?.resetsAt).toBe("2026-07-31T15:00:00.000Z");
    expect(quota?.sevenDay?.pct).toBe(27);
    expect(quota?.status).toBe("ok");
  });

  it("keeps Codex's explicit hard-limit signal even when usage is rounded below 100",()=>{
    const quota=mapCodexQuota({rateLimits:{rateLimitReachedType:"weekly",primary:{usedPercent:99,windowDurationMins:10080}}});
    expect(quota?.exhausted).toBe(true);
  });

  it("ignores unrelated keyed products when mapping Codex quota",()=>{
    const quota=mapCodexQuota({
      rateLimits:{planType:"pro",primary:{usedPercent:31,windowDurationMins:10080}},
      rateLimitsByLimitId:{
        other:{planType:"other-plan",rateLimitReachedType:"weekly",primary:{usedPercent:100,windowDurationMins:300}}
      }
    });
    expect(quota?.fiveHour).toBeNull();
    expect(quota?.sevenDay?.pct).toBe(31);
    expect(quota?.plan).toBe("pro");
    expect(quota?.exhausted).toBe(false);
  });

  it("prefers the canonical Codex limit over supplemental Codex products",()=>{
    const quota=mapCodexQuota({
      rateLimits:{planType:"pro",primary:{usedPercent:60,windowDurationMins:10080,resetsAt:1785903045}},
      rateLimitsByLimitId:{
        codex_bengalfox:{planType:"pro",primary:{usedPercent:0,windowDurationMins:10080,resetsAt:1786047408}},
        codex:{planType:"pro",primary:{usedPercent:60,windowDurationMins:10080,resetsAt:1785903045}}
      }
    });
    expect(quota?.sevenDay).toMatchObject({pct:60,durationMins:10080});
    expect(quota?.sevenDay?.resetsAt).toBe("2026-08-05T04:10:45.000Z");
  });

  it("keeps compatibility with app-server responses lacking durations", () => {
    const quota = mapCodexQuota({ rateLimits:{ primary:{ usedPercent:10 }, secondary:{ usedPercent:20 } } });
    expect(quota?.fiveHour?.pct).toBe(10);
    expect(quota?.sevenDay?.pct).toBe(20);
  });

  // Payload shape captured from a live https://ollama.com/api/usage response.
  it("maps Ollama Cloud session and weekly limit utilization", () => {
    const quota = mapOllamaQuota({ activity:{ cost:"0.00000" }, limits:{ session:{ usage:0, models:[] }, weekly:{ usage:0.002, models:[{ name:"deepseek-v4-flash:0731", request_count:32 }] } } });
    expect(quota?.fiveHour).toMatchObject({ pct:0, durationMins:300 });
    expect(quota?.sevenDay).toMatchObject({ pct:0.2, durationMins:10080 });
    expect(quota?.status).toBe("ok");
    expect(quota?.exhausted).toBe(false);
  });

  it("flags an exhausted Ollama window and tolerates percentage-valued readings", () => {
    expect(mapOllamaQuota({ limits:{ session:{ usage:1 }, weekly:{ usage:0.5 } } })?.exhausted).toBe(true);
    expect(mapOllamaQuota({ limits:{ session:{ usage:42 }, weekly:{ usage:0.5 } } })?.fiveHour?.pct).toBe(42);
    expect(mapOllamaQuota({ limits:{ weekly:{ usage:0.5 } } })?.status).toBe("partial");
    expect(mapOllamaQuota({ activity:{ cost:"0.00000" } })).toBeNull();
    expect(mapOllamaQuota(null)).toBeNull();
  });

  it("promotes Antigravity's exhausted-bucket countdown into a quota window",()=>{
    const quota=mapAntigravityQuotaError("Individual quota reached. Resets in 160h59m22s.",Date.parse("2026-08-03T11:16:05.000Z"));
    expect(quota).toMatchObject({fiveHour:null,sevenDay:{pct:100,durationMins:10080},exhausted:true,status:"partial"});
    expect(quota?.sevenDay?.resetsAt).toBe("2026-08-10T04:15:27.000Z");
    expect(mapAntigravityQuotaError("Individual quota reached. Resets in 4h30m.",0)?.fiveHour).toMatchObject({pct:100,durationMins:300});
    expect(mapAntigravityQuotaError("ordinary runtime failure",0)).toBeNull();
  });

  // /api/me answers with the whole profile; only the plan may leave this mapper.
  it("lifts only the plan name out of the Ollama account profile", () => {
    expect(mapOllamaPlan({ ID:"1798ce8a", Email:"someone@example.com", Name:"someone", Plan:"pro" })).toBe("pro");
    expect(mapOllamaPlan({ plan:"max" })).toBe("max");
    expect(mapOllamaPlan({ Email:"someone@example.com" })).toBeNull();
    expect(mapOllamaPlan({ Plan:"<script>" })).toBeNull();
    expect(mapOllamaPlan(null)).toBeNull();
  });

  it("retries a transient Ollama reading as quickly as Claude and Codex", () => {
    const ok = { claude:{}, codex:{}, ollama:{} };
    expect(quotaCacheDuration(ok)).toBe(QUOTA_CACHE_OK_MS);
    expect(quotaCacheDuration({ ...ok, ollama:{ error:"unavailable" } })).toBe(QUOTA_CACHE_TRANSIENT_MS);
  });

  // Payload shape captured from a live https://api.deepseek.com/user/balance response.
  it("maps the DeepSeek prepaid balance", () => {
    const balance = mapDeepseekBalance({ is_available:true, balance_infos:[{ currency:"USD", total_balance:"4.99", granted_balance:"0.00", topped_up_balance:"4.99" }] });
    expect(balance).toEqual({ currency:"USD", total:4.99, granted:0, toppedUp:4.99, available:true });
  });

  it("marks an emptied or unusable DeepSeek balance and rejects unusable payloads", () => {
    expect(mapDeepseekBalance({ is_available:true, balance_infos:[{ currency:"cny", total_balance:"0.00" }] })).toEqual({ currency:"CNY", total:0, granted:0, toppedUp:0, available:false });
    expect(mapDeepseekBalance({ is_available:false, balance_infos:[{ currency:"USD", total_balance:"1.20" }] })?.available).toBe(false);
    expect(mapDeepseekBalance({ is_available:true, balance_infos:[{ currency:"USD" }] })).toBeNull();
    expect(mapDeepseekBalance({ is_available:true, balance_infos:[] })).toBeNull();
    expect(mapDeepseekBalance(null)).toBeNull();
  });

  it("maps Claude utilization fields", () => {
    const quota = mapClaudeQuota({ plan:"Max", five_hour:{ utilization:7, resets_at:"2026-07-13T12:00:00Z" }, seven_day:{ utilization:31, resets_at:"2026-07-20T12:00:00Z" } });
    expect(quota.fiveHour?.pct).toBe(7);
    expect(quota.sevenDay?.pct).toBe(31);
    expect(quota.status).toBe("ok");
    expect(quota.plan).toBe("Max");
  });

  it("maps Grok's unified weekly quota and prepaid credits",()=>{
    const quota=mapGrokQuota({plan:"SuperGrok",seven_day:{utilization:72.5,resets_at:"2026-08-17T12:00:00Z",reset_label:"Aug 17, 9:00 PM"},prepaid_balance:4.25});
    expect(quota).toMatchObject({
      fiveHour:null,
      sevenDay:{pct:72.5,resetsAt:"2026-08-17T12:00:00Z",resetLabel:"Aug 17, 9:00 PM",durationMins:10080},
      plan:"SuperGrok",
      balance:{currency:"USD",total:4.25,granted:0,toppedUp:4.25,available:true},
      exhausted:false,
      status:"partial"
    });
  });

  it("rejects identity-like plan fields and handles an exhausted Grok account",()=>{
    expect(mapGrokQuota({plan:"user@example.com",seven_day:{utilization:100},prepaid_balance:0})).toMatchObject({plan:null,exhausted:true,balance:{total:0,available:false}});
    expect(mapGrokQuota({})).toBeNull();
    expect(mapGrokQuota(null)).toBeNull();
  });
});
