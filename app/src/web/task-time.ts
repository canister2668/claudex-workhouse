const MIN_REASONABLE_TIMESTAMP=Date.UTC(2000,0,1);
const MAX_FUTURE_SKEW_MS=5*60_000;

export function normalizeTimestamp(value:unknown,now=Date.now()):number|undefined{
  if(value===null||value===undefined||value==="")return undefined;
  let parsed:number;
  if(typeof value==="number")parsed=value;
  else if(typeof value==="string"&&/^\d+(?:\.\d+)?$/.test(value.trim()))parsed=Number(value);
  else parsed=Date.parse(String(value));
  if(!Number.isFinite(parsed))return undefined;
  if(parsed>0&&parsed<1e12)parsed*=1000;
  if(parsed<MIN_REASONABLE_TIMESTAMP||parsed>now+MAX_FUTURE_SKEW_MS)return undefined;
  return Math.min(now,parsed);
}

export function timestampAge(value:unknown,now=Date.now()){
  const timestamp=normalizeTimestamp(value,now);
  return timestamp===undefined?undefined:Math.max(0,now-timestamp);
}
