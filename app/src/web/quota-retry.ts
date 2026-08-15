const RETRY_DELAYS_MS=[2_000,5_000,10_000,30_000,60_000] as const;

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
