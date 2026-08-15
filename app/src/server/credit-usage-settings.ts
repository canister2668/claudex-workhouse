import { z } from "zod";
import type { ProviderQuota } from "./quota.js";

export const creditUsageSettingsSchema=z.object({
  version:z.literal(1).default(1),
  allowPaidCredits:z.boolean().default(false)
});

export type CreditUsageSettings=z.infer<typeof creditUsageSettingsSchema>;

export const DEFAULT_CREDIT_USAGE_SETTINGS:CreditUsageSettings={version:1,allowPaidCredits:false};

export function normalizeCreditUsageSettings(value:unknown):CreditUsageSettings{
  const parsed=creditUsageSettingsSchema.safeParse(value);
  return parsed.success?parsed.data:{...DEFAULT_CREDIT_USAGE_SETTINGS};
}

export function providerQuotaExhausted(value:ProviderQuota|null|undefined){
  return value?.exhausted===true||[value?.fiveHour?.pct,value?.sevenDay?.pct].some(pct=>typeof pct==="number"&&pct>=100);
}

export type ProviderQuotaState="available"|"exhausted"|"unknown";

export function providerQuotaState(value:ProviderQuota|null|undefined):ProviderQuotaState{
  if(providerQuotaExhausted(value))return"exhausted";
  if(!value||value.error)return"unknown";
  return[value.fiveHour?.pct,value.sevenDay?.pct].some(pct=>typeof pct==="number")?"available":"unknown";
}

// A probe that did not finish is not evidence that the included quota ran out.
// The provider usage probes are far slower than their budgets on this host
// (measured: ~30s for the Claude CLI probe, 38-81s for a cold `codex
// app-server` initialize), so "unknown" was the normal outcome rather than the
// exceptional one. Blocking on it armed the paid-credit prompt permanently
// while both plans still had most of their quota left. Only an observed
// exhausted window blocks now; an unverifiable one is reported but allowed.
export function quotaStateBlocksPaidCredits(state:ProviderQuotaState){return state==="exhausted";}

export class PaidCreditConsentRequiredError extends Error{
  statusCode=402;
  code="PAID_CREDITS_CONFIRMATION_REQUIRED";
  constructor(public providers:Array<"codex"|"claude"|"grok">,public reasons:Partial<Record<"codex"|"claude"|"grok",Exclude<ProviderQuotaState,"available">>>){
    super("Included provider quota is exhausted or could not be verified. Paid-credit approval is required.");
    this.name="PaidCreditConsentRequiredError";
  }
}

export function isPaidCreditConsentRequired(error:unknown):error is PaidCreditConsentRequiredError{
  return(error as any)?.code==="PAID_CREDITS_CONFIRMATION_REQUIRED";
}
