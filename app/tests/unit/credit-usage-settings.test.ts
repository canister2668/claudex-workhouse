import { describe, expect, it } from "vitest";
import { DEFAULT_CREDIT_USAGE_SETTINGS, normalizeCreditUsageSettings, providerQuotaExhausted, providerQuotaState, quotaStateBlocksPaidCredits } from "../../src/server/credit-usage-settings.js";

describe("paid credit usage settings",()=>{
  it("defaults to blocking automatic paid-credit use",()=>{
    expect(normalizeCreditUsageSettings(null)).toEqual(DEFAULT_CREDIT_USAGE_SETTINGS);
    expect(normalizeCreditUsageSettings({version:1,allowPaidCredits:true})).toEqual({version:1,allowPaidCredits:true});
  });

  it("requires an observed exhausted quota window",()=>{
    const quota=(pct:number|null)=>({fiveHour:pct===null?null:{pct,resetsAt:null,durationMins:300},sevenDay:null,status:"partial" as const});
    expect(providerQuotaExhausted(quota(99))).toBe(false);
    expect(providerQuotaExhausted(quota(100))).toBe(true);
    expect(providerQuotaExhausted({...quota(99),exhausted:true})).toBe(true);
    expect(providerQuotaExhausted(quota(null))).toBe(false);
    expect(providerQuotaExhausted(undefined)).toBe(false);
  });

  it("reports whether the included quota could be verified",()=>{
    const observed={fiveHour:{pct:42,resetsAt:null,durationMins:300},sevenDay:null,status:"partial" as const};
    expect(providerQuotaState(observed)).toBe("available");
    expect(providerQuotaState({...observed,fiveHour:{...observed.fiveHour,pct:100}})).toBe("exhausted");
    expect(providerQuotaState({fiveHour:null,sevenDay:null,status:"partial",error:"unavailable"})).toBe("unknown");
    expect(providerQuotaState(undefined)).toBe("unknown");
  });

  it("blocks only on an observed exhausted quota, not on a failed probe",()=>{
    expect(quotaStateBlocksPaidCredits("exhausted")).toBe(true);
    expect(quotaStateBlocksPaidCredits("available")).toBe(false);
    // A probe that timed out used to block here, which armed the paid-credit
    // prompt permanently on hosts where the probes are slower than their budget.
    expect(quotaStateBlocksPaidCredits("unknown")).toBe(false);
  });

  it("still blocks on a stale reading that observed exhaustion",()=>{
    // A failed refresh carries the last good windows forward with error set, so
    // prior evidence of exhaustion must survive losing the current probe.
    const staleExhausted={fiveHour:{pct:100,resetsAt:null,durationMins:300},sevenDay:null,status:"partial" as const,error:"unavailable"};
    expect(providerQuotaState(staleExhausted)).toBe("exhausted");
    expect(quotaStateBlocksPaidCredits(providerQuotaState(staleExhausted))).toBe(true);
  });
});
