type ShareRequest={method:string;url:string;headers:Record<string,unknown>};

export function nativeShareTargetNavigation(request:ShareRequest,allowedOrigins:Set<string>){
  let pathname="";try{pathname=new URL(request.url,"http://claudex.invalid").pathname;}catch{return false;}
  if(request.method!=="POST"||pathname!=="/api/share-target"||!String(request.headers["content-type"]??"").toLowerCase().startsWith("multipart/form-data"))return false;
  const origin=typeof request.headers.origin==="string"?request.headers.origin:null,site=String(request.headers["sec-fetch-site"]??""),mode=String(request.headers["sec-fetch-mode"]??""),dest=String(request.headers["sec-fetch-dest"]??"");
  if(site==="same-origin"&&origin!==null&&allowedOrigins.has(origin))return true;
  if(site==="none"&&mode==="navigate"&&dest==="document"&&(origin===null||origin==="null"))return true;
  return false;
}

export function consumeShareTargetPayload<T extends {expiresAt:number;consumed:boolean}>(payload:T|undefined,now=Date.now()){
  if(!payload||payload.consumed||payload.expiresAt<now)return null;
  payload.consumed=true;
  return payload;
}
