import { get } from "svelte/store";
import { en } from "./i18n/en";
import { ja } from "./i18n/ja";
import { ko } from "./i18n/ko";
import { locale } from "./i18n/locale-store";

export type ApiRequestCategory="quick"|"database"|"provider"|"execution";
export type ApiRequestOptions={category?:ApiRequestCategory;caller?:string;timeoutMs?:number;requestId?:string;retry?:boolean};

export const API_REQUEST_TIMEOUTS:Record<ApiRequestCategory,number>={
  quick:15_000,
  database:60_000,
  provider:120_000,
  execution:60_000
};

export function apiRequestCategory(path:string,method="GET"):ApiRequestCategory{
  const verb=method.toUpperCase(),url=new URL(path,"http://claudex.local"),pathname=url.pathname;
  if(verb!=="GET"&&verb!=="HEAD")return "execution";
  if(pathname==="/api/health"||pathname==="/api/health/live"||pathname.startsWith("/api/system-settings/")||pathname==="/api/setup"||pathname==="/api/runtime-updates/settings"||pathname==="/api/application-updates"||pathname==="/api/push/vapid-public-key")return "quick";
  if(url.searchParams.get("refresh")==="true"||pathname.startsWith("/api/provider-connections")||pathname.startsWith("/api/providers/")&&/(permissions|models|sessions|sync)/.test(pathname))return "provider";
  return "database";
}

function requestId(){return globalThis.crypto?.randomUUID?.()??`web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;}
function screenName(){return typeof globalThis.location==="undefined"?"unknown-screen":`${globalThis.location.pathname}${globalThis.location.search}`;}
const TRANSIENT_READ_STATUSES=new Set([502,504,520,521,522,523,524]);
// A supervised Workhouse restart can leave the HTTP port unavailable for tens
// of seconds while the server runtime boots. Keep idempotent reads pending
// across that ordinary window instead of letting every polling widget publish
// the same transient outage independently.
const RETRY_DELAYS_MS=[250,750,1_500,3_000,5_000,8_000,12_000,12_000];
export function isTransientApiError(error:unknown){return (error as {code?:unknown}|null)?.code==="TRANSIENT_GATEWAY_ERROR";}
function translated(key:"error.REQUEST_TIMEOUT"|"error.TRANSIENT_GATEWAY"|"error.INVALID_API_RESPONSE"){
  return {en,ko,ja}[get(locale)][key];
}
// The server sends English text plus a stable code. When the dictionary knows the
// code, its translation wins; otherwise the server's own message is shown. Errors
// that name a specific value send it in errorParams for the {placeholder}.
function translatedFailure(code:unknown,fallback:string,params:unknown){
  if(typeof code!=="string")return fallback;
  const key=`error.${code}` as keyof typeof en;
  const template=(({en,ko,ja}[get(locale)] as Record<string,string>)[key])??(en as Record<string,string>)[key];
  if(!template)return fallback;
  if(!params||typeof params!=="object")return template;
  return template.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g,(match,name)=>{
    const value=(params as Record<string,unknown>)[name];
    return value===undefined||value===null?match:String(value);
  });
}
function retryableNetworkError(error:unknown){
  return error instanceof TypeError||typeof DOMException!=="undefined"&&error instanceof DOMException&&error.name==="NetworkError";
}
function waitForRetry(delayMs:number,signal:AbortSignal){
  return new Promise<void>((resolve,reject)=>{
    if(signal.aborted){reject(signal.reason);return;}
    const timer=setTimeout(done,delayMs);
    function done(){signal.removeEventListener("abort",aborted);resolve();}
    function aborted(){clearTimeout(timer);signal.removeEventListener("abort",aborted);reject(signal.reason);}
    signal.addEventListener("abort",aborted,{once:true});
  });
}

export async function requestJson(path:string,init:RequestInit={},options:ApiRequestOptions={}){
  const headers=new Headers(init.headers);headers.set("Accept","application/json");if(init.body)headers.set("Content-Type","application/json");
  const method=(init.method??"GET").toUpperCase(),id=options.requestId??requestId(),category=options.category??apiRequestCategory(path,method),caller=options.caller??screenName(),startedAt=Date.now(),timeoutMs=options.timeoutMs??API_REQUEST_TIMEOUTS[category];
  headers.set("X-Claudex-Request-Id",id);headers.set("X-Claudex-Request-Caller",caller.slice(0,200));if(method!=="GET")headers.set("X-Claudex-Workhouse-Request","1");
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(new DOMException("Request timed out","TimeoutError")),timeoutMs),abort=()=>controller.abort(init.signal?.reason);
  if(init.signal){if(init.signal.aborted)abort();else init.signal.addEventListener("abort",abort,{once:true});}
  const retryReads=options.retry!==false&&(method==="GET"||method==="HEAD");
  try{
    for(let attempt=0;;attempt++){
      headers.set("X-Claudex-Request-Attempt",String(attempt+1));
      try{
        const response=await fetch(path,{...init,headers,signal:controller.signal});
        if(retryReads&&TRANSIENT_READ_STATUSES.has(response.status)&&attempt<RETRY_DELAYS_MS.length){
          try{await response.body?.cancel();}catch{}
          await waitForRetry(RETRY_DELAYS_MS[attempt],controller.signal);
          continue;
        }
        let body:any;
        try{body=await response.json();}
        catch{
          if(response.ok)throw Object.assign(new Error(translated("error.INVALID_API_RESPONSE")),{code:"INVALID_API_RESPONSE",status:response.status,method,url:path,requestId:id,caller});
          body={};
        }
        if(!response.ok){
          const details=body&&typeof body==="object"?body as Record<string,unknown>:{};
          if(TRANSIENT_READ_STATUSES.has(response.status))throw Object.assign(new Error(translated("error.TRANSIENT_GATEWAY")),{code:"TRANSIENT_GATEWAY_ERROR",status:response.status,details,method,url:path,requestId:id,caller});
          const fallback=typeof details.error==="string"?details.error:`HTTP ${response.status}`;
          throw Object.assign(new Error(translatedFailure(details.code,fallback,details.errorParams)),{code:typeof details.code==="string"?details.code:"REQUEST_FAILED",status:response.status,details,method,url:path,requestId:id,caller});
        }
        return body;
      }catch(error){
        if(controller.signal.aborted)throw error;
        if(retryReads&&retryableNetworkError(error)&&attempt<RETRY_DELAYS_MS.length){
          await waitForRetry(RETRY_DELAYS_MS[attempt],controller.signal);
          continue;
        }
        if(retryReads&&retryableNetworkError(error))throw Object.assign(new Error(translated("error.TRANSIENT_GATEWAY")),{code:"TRANSIENT_GATEWAY_ERROR",status:0,method,url:path,requestId:id,caller,cause:error});
        throw error;
      }
    }
  }
  catch(error){if(controller.signal.aborted&&!init.signal?.aborted){const elapsedMs=Date.now()-startedAt,summary=translated("error.REQUEST_TIMEOUT").replace("{seconds}",String(Math.round(timeoutMs/1000))),message=`${summary} [${method} ${path} · ${(elapsedMs/1000).toFixed(1)}s · requestId=${id} · caller=${caller}]`;throw Object.assign(new Error(message),{code:"REQUEST_TIMEOUT",method,url:path,elapsedMs,requestId:id,caller,category,timeoutMs});}throw error;}
  finally{clearTimeout(timeout);init.signal?.removeEventListener("abort",abort);}
}
