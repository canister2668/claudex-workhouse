const RETRY_DELAYS_MS=[2_000,5_000,10_000,30_000,60_000] as const;

export type ProviderQuotaWindow={pct:number|null;resetsAt:string|null;resetLabel?:string|null;durationMins?:number|null};
export type ModelQuotaPool={limitId:string;label:string;modelIds:string[];fiveHour?:ProviderQuotaWindow|null;sevenDay?:ProviderQuotaWindow|null;plan?:string|null;exhausted?:boolean;status?:"ok"|"partial"};
export type WebProviderQuota={
  fiveHour?:ProviderQuotaWindow|null;
  sevenDay?:ProviderQuotaWindow|null;
  plan?:string|null;
  exhausted?:boolean;
  status?:"ok"|"partial";
  modelPools?:ModelQuotaPool[];
  quotaMode?:"vertex-credit";
  projectId?:string;
  location?:string;
  balance?:{total:number;currency:string;granted?:number;toppedUp?:number;available?:boolean}|null;
  [key:string]:unknown;
};

export function modelQuotaPool(quota:WebProviderQuota|null|undefined,provider:string,model:unknown){
  if(provider!=="codex"||typeof model!=="string"||!model.trim())return null;
  const id=model.trim().toLowerCase();
  return quota?.modelPools?.find(pool=>pool.modelIds.some(modelId=>modelId.toLowerCase()===id))??null;
}

export function quotaForProviderModel(quota:WebProviderQuota|null|undefined,provider:string,model:unknown):{quota:WebProviderQuota|null;pool:ModelQuotaPool|null}{
  const pool=modelQuotaPool(quota,provider,model);
  if(!quota||!pool)return{quota:quota??null,pool:null};
  const fiveHour=pool.fiveHour??quota.fiveHour??null,sevenDay=pool.sevenDay??quota.sevenDay??null;
  return{quota:{...quota,fiveHour,sevenDay,plan:pool.plan??quota.plan,exhausted:pool.exhausted??quota.exhausted,status:fiveHour&&sevenDay?"ok":"partial"},pool};
}

export function quotaNeedsRetry(value:unknown){
  if(!value||typeof value!=="object")return true;
  const quota=value as Record<string,any>;
  // Ollama reports real account limits, but only payloads that actually carry it
  // are judged on it — an older reading without the field is not a failure.
  return [quota.claude,quota.codex,...(quota.ollama===undefined?[]:[quota.ollama])].some(provider=>!provider||provider.error==="unavailable"||provider.error==="rate_limited");
}

export function quotaRetryDelay(attempt:number,value:unknown){
  const quota=value&&typeof value==="object"?value as Record<string,any>:null;
  if([quota?.claude,quota?.codex,quota?.ollama].some(provider=>provider?.error==="rate_limited"))return 60_000;
  return RETRY_DELAYS_MS[Math.min(Math.max(0,attempt),RETRY_DELAYS_MS.length-1)];
}

export function quotaIsStale(value:unknown,now=Date.now(),maxAgeMs=60_000){
  if(!value||typeof value!=="object")return true;
  const fetchedAt=Date.parse(String((value as Record<string,unknown>).fetchedAt??""));
  return !Number.isFinite(fetchedAt)||now-fetchedAt>=maxAgeMs;
}
