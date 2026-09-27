export type QuotaWindow = {
  pct: number | null;
  resetsAt: string | null;
  resetLabel?: string | null;
  durationMins: number | null;
};

export type CodexQuotaPool = {
  limitId: string;
  label: string;
  modelIds: string[];
  fiveHour: QuotaWindow | null;
  sevenDay: QuotaWindow | null;
  plan?: string | null;
  exhausted?: boolean;
  status: "ok" | "partial";
};

export type ProviderQuota = {
  fiveHour: QuotaWindow | null;
  sevenDay: QuotaWindow | null;
  plan?: string | null;
  exhausted?: boolean;
  error?: string | null;
  status: "ok" | "partial";
  modelPools?: CodexQuotaPool[];
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

// App-server currently exposes the Spark bucket under an internal product
// identifier. Keep that translation at the provider boundary: the rest of the
// application should reason about public model ids, never codename strings.
const CODEX_LIMIT_MODELS:Record<string,{label:string;modelIds:string[]}>= {
  codex_bengalfox:{label:"Spark",modelIds:["gpt-5.3-codex-spark"]}
};

function codexQuotaSnapshot(snapshots:any[]):Omit<ProviderQuota,"modelPools"> {
  const windows=snapshots.flatMap(limits=>[codexWindow(limits.primary),codexWindow(limits.secondary)]).filter((window):window is QuotaWindow=>Boolean(window));
  let fiveHour:QuotaWindow|null=null,sevenDay:QuotaWindow|null=null;
  for(const window of windows){
    if(window.durationMins===null)continue;
    if(window.durationMins>=240&&window.durationMins<=360)fiveHour??=window;
    if(window.durationMins>=9000&&window.durationMins<=11000)sevenDay??=window;
  }
  const fallbackPrimary=codexWindow(snapshots[0]?.primary),fallbackSecondary=codexWindow(snapshots[0]?.secondary);
  if(!fiveHour&&fallbackPrimary?.durationMins===null)fiveHour=fallbackPrimary;
  if(!sevenDay&&fallbackSecondary?.durationMins===null)sevenDay=fallbackSecondary;
  return{
    fiveHour,sevenDay,
    plan:snapshots.map(limits=>limits.planType).find(value=>typeof value==="string")??null,
    exhausted:snapshots.some(limits=>typeof limits.rateLimitReachedType==="string"&&limits.rateLimitReachedType.length>0),
    status:fiveHour&&sevenDay?"ok":"partial"
  };
}

export function codexQuotaPoolForModel(quota:ProviderQuota|null|undefined,model:unknown){
  const id=typeof model==="string"?model.trim().toLowerCase():"";
  return id?quota?.modelPools?.find(pool=>pool.modelIds.some(modelId=>modelId.toLowerCase()===id))??null:null;
}

export function codexQuotaForModel(quota:ProviderQuota|null|undefined,model:unknown):ProviderQuota|undefined{
  if(!quota)return undefined;
  const pool=codexQuotaPoolForModel(quota,model);
  if(!pool)return quota;
  const fiveHour=pool.fiveHour??quota.fiveHour,sevenDay=pool.sevenDay??quota.sevenDay;
  return{...quota,fiveHour,sevenDay,plan:pool.plan??quota.plan,exhausted:pool.exhausted??quota.exhausted,status:fiveHour&&sevenDay?"ok":"partial"};
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
    compatibleLimits
  ].filter((value,index,values)=>value&&typeof value==="object"&&values.indexOf(value)===index) as any[];
  if (!snapshots.length) return null;
  const modelPools=supplementalCodexEntries.map(([limitId,value])=>{
    const mapped=codexQuotaSnapshot([value]),identity=CODEX_LIMIT_MODELS[String(limitId).toLowerCase()];
    return{limitId:String(limitId),label:identity?.label??String(limitId),modelIds:identity?.modelIds??[],...mapped};
  });
  return{...codexQuotaSnapshot(snapshots),...(modelPools.length?{modelPools}:{})};
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


// A restart drops the in-memory Claude reading, so a throttled usage endpoint
// leaves the panel with nothing to show at all. Persisting the last good
// reading keeps it visible, but only while it is still meaningful: the session
// window moves fast, so it is dropped first, and an hour-old reading is dropped
// entirely rather than presented as current.
export const CLAUDE_QUOTA_RESTORE_MAX_AGE_MS=60*60_000;
export const CLAUDE_QUOTA_RESTORE_FIVE_HOUR_MAX_AGE_MS=15*60_000;

export function restorableClaudeQuota(stored:unknown,now=Date.now()):ProviderQuota|null{
  if(!stored||typeof stored!=="object")return null;
  const record=stored as {quota?:unknown;at?:unknown};
  const at=typeof record.at==="string"?Date.parse(record.at):NaN;
  if(!Number.isFinite(at))return null;
  const age=now-at;
  if(age<0||age>CLAUDE_QUOTA_RESTORE_MAX_AGE_MS)return null;
  if(!record.quota||typeof record.quota!=="object")return null;
  const quota=record.quota as ProviderQuota;
  if(!quota.fiveHour&&!quota.sevenDay)return null;
  return age>CLAUDE_QUOTA_RESTORE_FIVE_HOUR_MAX_AGE_MS?{...quota,fiveHour:null,status:"partial"}:quota;
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
