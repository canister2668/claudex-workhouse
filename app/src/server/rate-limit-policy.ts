export type RateLimitRequest={url:string;ip:string;actor?:unknown};

export function bypassGlobalRateLimit(request:RateLimitRequest){
  return !request.url.startsWith("/api/")||request.url.startsWith("/api/health");
}

export function globalRateLimitKey(request:RateLimitRequest){
  return String(request.actor??request.ip);
}
