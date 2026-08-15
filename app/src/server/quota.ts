export type QuotaWindow = {
  pct: number | null;
  resetsAt: string | null;
  resetLabel?: string | null;
  durationMins: number | null;
};

export type ProviderQuota = {
  fiveHour: QuotaWindow | null;
  sevenDay: QuotaWindow | null;
  plan?: string | null;
  exhausted?: boolean;
  error?: string | null;
  status: "ok" | "partial";
};

export type ProviderBalance = {
  currency: string;
  total: number;
  granted: number;
  toppedUp: number;
  available: boolean;
};

export const QUOTA_CACHE_OK_MS=60_000;
export const QUOTA_CACHE_TRANSIENT_MS=10_000;

type CodexQuotaRequest=(method:string,params:Record<string,unknown>,timeoutMs?:number)=>Promise<any>;

// A pooled app-server can outlive a ChatGPT subscription change. Refresh the
// account before asking for limits so a Pro tier change is reflected without
// waiting for that long-lived process to be replaced. A refresh failure must
// not hide an otherwise usable quota response.
export async function readFreshCodexRateLimits(request:CodexQuotaRequest,timeoutMs=45_000){
  try{await request("account/read",{refreshToken:true},timeoutMs);}catch{/* best effort */}
  return request("account/rateLimits/read",{},timeoutMs);
}

export function quotaCacheDuration(value:unknown){
  if(!value||typeof value!=="object")return QUOTA_CACHE_TRANSIENT_MS;
  const quota=value as Record<string,any>;
  // Ollama only joins the account-limit providers when the payload carries it,
  // so a reading from before it had a quota probe is not treated as a failure.
  const providers=[quota.claude,quota.codex,...(quota.ollama===undefined?[]:[quota.ollama])];
  return providers.some(provider=>!provider||provider.error==="unavailable")?QUOTA_CACHE_TRANSIENT_MS:QUOTA_CACHE_OK_MS;
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isoFromEpoch(value: unknown): string | null {
  const epoch = finiteNumber(value);
  return epoch === null ? null : new Date(epoch * 1000).toISOString();
}

function codexWindow(value: any): QuotaWindow | null {
  if (!value || typeof value !== "object") return null;
  const used = finiteNumber(value.usedPercent);
  const durationMins = finiteNumber(value.windowDurationMins);
  return {
    pct: used === null ? null : Math.max(0, Math.min(100, used)),
    resetsAt: isoFromEpoch(value.resetsAt),
    durationMins
  };
}

// Codex has changed which physical slot contains each limit. In particular,
// `primary` can be the seven-day window while `secondary` is absent. Prefer
// the explicit duration and use the old positional convention only when a
// server does not report durations at all.
export function mapCodexQuota(result: any): ProviderQuota | null {
  const compatibleLimits = result?.rateLimits;
  const keyedLimits = result?.rateLimitsByLimitId;
  const keyedEntries = keyedLimits && typeof keyedLimits === "object" && !Array.isArray(keyedLimits)
    ? Object.entries(keyedLimits).filter(([,value])=>value&&typeof value==="object")
    : [];
  const canonicalCodexEntries = keyedEntries.filter(([limitId])=>String(limitId).toLowerCase()==="codex");
  const supplementalCodexEntries = keyedEntries.filter(([limitId])=>{
    const normalized=String(limitId).toLowerCase();
    return normalized!=="codex"&&normalized.includes("codex");
  });
  const snapshots = [
    ...canonicalCodexEntries.map(([,value])=>value),
    compatibleLimits,
    ...supplementalCodexEntries.map(([,value])=>value)
  ].filter((value,index,values)=>value&&typeof value==="object"&&values.indexOf(value)===index) as any[];
  if (!snapshots.length) return null;

  const windows = snapshots.flatMap(limits=>[codexWindow(limits.primary),codexWindow(limits.secondary)]).filter((window):window is QuotaWindow=>Boolean(window));
  let fiveHour: QuotaWindow | null = null;
  let sevenDay: QuotaWindow | null = null;

  for (const window of windows) {
    if (window.durationMins === null) continue;
    if (window.durationMins >= 240 && window.durationMins <= 360) fiveHour ??= window;
    if (window.durationMins >= 9000 && window.durationMins <= 11000) sevenDay ??= window;
  }

  const fallbackPrimary = codexWindow(snapshots[0]?.primary);
  const fallbackSecondary = codexWindow(snapshots[0]?.secondary);
  if (!fiveHour && fallbackPrimary?.durationMins === null) fiveHour = fallbackPrimary;
  if (!sevenDay && fallbackSecondary?.durationMins === null) sevenDay = fallbackSecondary;

  return {
    fiveHour,
    sevenDay,
    plan: snapshots.map(limits=>limits.planType).find(value=>typeof value==="string") ?? null,
    exhausted:snapshots.some(limits=>typeof limits.rateLimitReachedType==="string"&&limits.rateLimitReachedType.length>0),
    status: fiveHour && sevenDay ? "ok" : "partial"
  };
}

function claudeWindow(value: any, durationMins: number): QuotaWindow | null {
  if (!value || typeof value !== "object") return null;
  const used = finiteNumber(value.utilization);
  return {
    pct: used === null ? null : Math.max(0, Math.min(100, used)),
    resetsAt: typeof value.resets_at === "string" ? value.resets_at : null,
    resetLabel: typeof value.reset_label === "string" ? value.reset_label : null,
    durationMins
  };
}

// Ollama Cloud subscriptions are metered on GPU utilization against a session
// window that resets every 5 hours and a weekly window that resets every 7 days,
// which is the same shape Claude and Codex report. `/api/usage` publishes each
// window as a 0..1 fraction of the plan limit; tolerate a percentage-valued
// reading too, since the endpoint is undocumented and may change units.
function ollamaWindow(value: any, durationMins: number): QuotaWindow | null {
  if (!value || typeof value !== "object") return null;
  const used = finiteNumber(value.usage);
  return { pct: used === null ? null : Math.max(0, Math.min(100, used <= 1 ? used * 100 : used)), resetsAt: null, durationMins };
}

/**
 * `/api/me` answers with the whole profile — id, email, display name. Only the
 * plan name is wanted here, so lift exactly that and let the rest fall away
 * rather than carrying account identity into the quota payload.
 */
export function mapOllamaPlan(body: any): string | null {
  const plan = String(body?.Plan ?? body?.plan ?? "").trim();
  return /^[a-zA-Z0-9 _-]{1,24}$/.test(plan) ? plan : null;
}

export function mapOllamaQuota(body: any): ProviderQuota | null {
  const limits = body?.limits;
  if (!limits || typeof limits !== "object") return null;
  const fiveHour = ollamaWindow(limits.session, 300), sevenDay = ollamaWindow(limits.weekly, 10080);
  if (!fiveHour && !sevenDay) return null;
  return { fiveHour, sevenDay, plan: typeof body?.plan === "string" ? body.plan : null, exhausted:[fiveHour?.pct,sevenDay?.pct].some(pct=>typeof pct==="number"&&pct>=100), status: fiveHour && sevenDay ? "ok" : "partial" };
}

// Antigravity's public CLI does not expose a quota subcommand, but its normal
// result envelope reports an exact reset countdown when an account bucket is
// exhausted. Promote that provider-owned signal into the quota UI instead of
// leaving it buried in the task log. A short countdown is the session bucket;
// a longer countdown is the weekly bucket.
export function mapAntigravityQuotaError(value: unknown, observedAt=Date.now()): ProviderQuota | null {
  const text=typeof value==="string"?value:"",matches=[...text.matchAll(/Individual quota reached[\s\S]{0,240}?Resets in\s*(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/gi)],match=matches.at(-1);
  if(!match)return null;
  const hours=Number(match[1]??0),minutes=Number(match[2]??0),seconds=Number(match[3]??0),remainingMs=((hours*60+minutes)*60+seconds)*1000;
  if(!Number.isFinite(remainingMs)||remainingMs<=0)return null;
  const durationMins=remainingMs<=6*60*60_000?300:10080,window={pct:100,resetsAt:new Date(observedAt+remainingMs).toISOString(),durationMins};
  return{fiveHour:durationMins===300?window:null,sevenDay:durationMins===10080?window:null,exhausted:true,status:"partial"};
}

/**
 * DeepSeek is prepaid rather than plan-limited, so there is no window to fill a
 * percentage bar with. `/user/balance` reports one entry per currency; take the
 * first, which is the account's settlement currency.
 */
export function mapDeepseekBalance(body: any): ProviderBalance | null {
  const entry = Array.isArray(body?.balance_infos) ? body.balance_infos.find((item: any) => item && typeof item === "object") : null;
  if (!entry) return null;
  const currency = typeof entry.currency === "string" && /^[A-Za-z]{3}$/.test(entry.currency.trim()) ? entry.currency.trim().toUpperCase() : "";
  const total = finiteNumber(entry.total_balance);
  if (!currency || total === null) return null;
  return { currency, total, granted: finiteNumber(entry.granted_balance) ?? 0, toppedUp: finiteNumber(entry.topped_up_balance) ?? 0, available: body?.is_available !== false && total > 0 };
}

export function mapClaudeQuota(body: any): ProviderQuota {
  const fiveHour = claudeWindow(body?.five_hour, 300);
  const sevenDay = claudeWindow(body?.seven_day, 10080);
  return { fiveHour, sevenDay, plan:typeof body?.plan==="string"?body.plan:null, exhausted:[fiveHour?.pct,sevenDay?.pct].some(pct=>typeof pct==="number"&&pct>=100), status: fiveHour && sevenDay ? "ok" : "partial" };
}

export function mapGrokQuota(body: any): (ProviderQuota & { balance?: ProviderBalance | null }) | null {
  if (!body || typeof body !== "object") return null;
  const sevenDay = claudeWindow(body.seven_day, 10080);
  const prepaid = finiteNumber(body.prepaid_balance);
  const plan = typeof body.plan === "string" && /^[a-zA-Z0-9 _-]{1,32}$/.test(body.plan.trim()) ? body.plan.trim() : null;
  if (!sevenDay && prepaid === null && !plan) return null;
  const balance = prepaid === null ? null : {
    currency:"USD",
    total:Math.max(0,prepaid),
    granted:0,
    toppedUp:Math.max(0,prepaid),
    available:prepaid>0
  };
  return {
    fiveHour:null,
    sevenDay,
    plan,
    balance,
    exhausted:sevenDay?.pct !== null && sevenDay?.pct !== undefined && sevenDay.pct >= 100,
    status:"partial"
  };
}
