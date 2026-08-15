import crypto from"node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AppConfig } from "../config.js";

export function isLoopbackAddress(address: string | null | undefined) {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

export async function verifyAccessToken(token: string, jwks: JWTVerifyGetKey, issuer: string, audience: string, allowedEmail: string) {
  let payload;
  try {
    ({ payload } = await jwtVerify(token, jwks, { issuer, audience }));
  } catch {
    throw Object.assign(new Error("Invalid Cloudflare Access JWT."), { statusCode: 403 });
  }
  if (payload.email !== allowedEmail) throw Object.assign(new Error("Cloudflare identity is not allowed."), { statusCode: 403 });
  return payload.email;
}

const sha256=(value:string)=>crypto.createHash("sha256").update(value).digest();
const safeEqual=(left:Buffer|null,right:Buffer)=>Boolean(left&&left.length===right.length&&crypto.timingSafeEqual(left,right));
const validEntryToken=(value:string)=>/^[0-9a-f]{64}$/i.test(value)||(/^[A-Za-z0-9_-]{43}$/.test(value)&&Buffer.from(value,"base64url").length===32);
function cookieValue(request:Pick<FastifyRequest,"headers">,name:string){
  const raw=request.headers.cookie;if(typeof raw!=="string")return null;
  for(const item of raw.split(";")){const index=item.indexOf("=");if(index<0)continue;if(item.slice(0,index).trim()===name)return decodeURIComponent(item.slice(index+1).trim());}
  return null;
}

export class LocalEntryAuth {
  static readonly cookieName="claudex_local_entry";
  readonly required:boolean;
  private entryHash:Buffer|null;
  private sessionHash:Buffer|null=null;
  private consumed=false;

  constructor(input:{platform?:NodeJS.Platform;authMode:string;entryToken?:string}){
    this.required=(input.platform??process.platform)==="win32"&&input.authMode==="local";
    const token=input.entryToken?.trim()??"";
    if(this.required&&token&&!validEntryToken(token))throw new Error("Windows local entry token must contain exactly 256 bits.");
    this.entryHash=this.required&&token?sha256(token):null;
  }

  exchange(token:string,address:string|null|undefined){
    if(!this.required)throw Object.assign(new Error("Local entry exchange is not enabled."),{statusCode:404,code:"LOCAL_ENTRY_DISABLED"});
    if(!isLoopbackAddress(address))throw Object.assign(new Error("Local entry exchange requires loopback."),{statusCode:403,code:"LOCAL_ENTRY_LOOPBACK_REQUIRED"});
    if(!this.entryHash)throw Object.assign(new Error(this.consumed?"Local entry token was already consumed.":"Windows local entry token is not configured."),{statusCode:this.consumed?409:503,code:this.consumed?"LOCAL_ENTRY_TOKEN_CONSUMED":"LOCAL_ENTRY_TOKEN_REQUIRED"});
    if(!safeEqual(this.entryHash,sha256(token)))throw Object.assign(new Error("Local entry token is invalid."),{statusCode:403,code:"LOCAL_ENTRY_TOKEN_INVALID"});
    const session=crypto.randomBytes(32).toString("base64url");
    this.entryHash=null;this.sessionHash=sha256(session);this.consumed=true;
    return session;
  }

  authenticate(request:Pick<FastifyRequest,"headers"|"ip">){
    if(!this.required)return"local-admin";
    if(!isLoopbackAddress(request.ip))throw Object.assign(new Error("Windows local authentication requires loopback."),{statusCode:403,code:"LOCAL_ENTRY_LOOPBACK_REQUIRED"});
    const session=cookieValue(request,LocalEntryAuth.cookieName);
    if(!session||!safeEqual(this.sessionHash,sha256(session)))throw Object.assign(new Error("Local entry session is required."),{statusCode:403,code:"LOCAL_ENTRY_SESSION_REQUIRED"});
    return"local-admin";
  }

  cookie(session:string,secure=false){
    return`${LocalEntryAuth.cookieName}=${encodeURIComponent(session)}; Path=/; HttpOnly; SameSite=Strict${secure?"; Secure":""}`;
  }

  snapshot(){return{required:this.required,configured:Boolean(this.entryHash)||this.consumed,consumed:this.consumed,sessionActive:Boolean(this.sessionHash)};}
}

export function localEntryPublicRequest(request:{method:string;url:string;ip?:string;raw?:{socket?:{remoteAddress?:string}}}){
  let pathname:string;try{pathname=new URL(request.url,"http://claudex.invalid").pathname;}catch{pathname=request.url.split("?")[0]??request.url;}
  const loopback=isLoopbackAddress(request.ip??request.raw?.socket?.remoteAddress);
  return loopback&&((request.method==="GET"&&(pathname==="/api/bootstrap/status"||pathname==="/api/about"))||(request.method==="POST"&&pathname==="/api/local-entry/exchange"));
}

export async function authorizeLocalOwnerRequest(
  request:FastifyRequest,
  input:{
    entryRequired:boolean;
    authenticate:(request:FastifyRequest)=>Promise<string>;
    access:"public"|"blocked"|"normal";
    ownerAuthenticate:(request:FastifyRequest)=>string|null;
    ownerHasCredential:()=>boolean;
  }
){
  const entryActor=input.entryRequired?await input.authenticate(request):null;
  if(input.access==="public")return null;
  if(input.access==="blocked")throw Object.assign(new Error("Complete the one-time owner claim before using the management API."),{statusCode:428,code:"OWNER_CLAIM_REQUIRED"});
  const ownerActor=input.ownerAuthenticate(request);
  if(ownerActor)return ownerActor;
  if(input.ownerHasCredential())throw Object.assign(new Error("Owner credential is required."),{statusCode:403,code:"OWNER_CREDENTIAL_REQUIRED"});
  return entryActor??await input.authenticate(request);
}

export function registerLocalEntryRoutes(app:FastifyInstance,input:{auth:LocalEntryAuth;externalOrigin:string;snapshot:()=>Record<string,unknown>|Promise<Record<string,unknown>>}){
  app.get("/api/bootstrap/status",async(request,reply)=>{
    if(!isLoopbackAddress(request.ip||(request.raw.socket.remoteAddress??"")))throw Object.assign(new Error("Bootstrap status is available only through loopback."),{statusCode:403,code:"BOOTSTRAP_STATUS_LOCAL_ONLY"});
    reply.header("Cache-Control","no-store");
    return{schemaVersion:1,...await input.snapshot(),localEntry:input.auth.snapshot()};
  });
  app.post("/api/local-entry/exchange",{config:{rateLimit:{max:10,timeWindow:"10 minutes"}}},async(request,reply)=>{
    const token=(request.body as any)?.token;
    if(typeof token!=="string"||token.length<32||token.length>256)throw Object.assign(new Error("A bounded local entry token is required."),{statusCode:400,code:"LOCAL_ENTRY_TOKEN_INVALID"});
    const session=input.auth.exchange(token,request.ip||(request.raw.socket.remoteAddress??""));
    reply.header("Cache-Control","no-store");
    reply.header("Set-Cookie",input.auth.cookie(session,new URL(input.externalOrigin).protocol==="https:"));
    return{authenticated:true};
  });
}

export function createAuthenticator(config: AppConfig,options:{jwks?:JWTVerifyGetKey;allowCloudflareInTest?:boolean;localEntry?:LocalEntryAuth}={}) {
  const configured = Boolean(config.teamDomain && config.audience);
  const issuer = config.teamDomain.replace(/\/$/, "");
  const jwks = options.jwks??(configured ? createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`)) : null);

  return async (request: FastifyRequest) => {
    if(config.authMode==="local"){
      const hostname=new URL(config.externalOrigin).hostname;
      if(!["127.0.0.1","localhost","::1"].includes(hostname))throw Object.assign(new Error("Local authentication requires a loopback external origin."),{statusCode:503,code:"LOCAL_AUTH_LOOPBACK_REQUIRED"});
      if(options.localEntry?.required)return options.localEntry.authenticate(request);
      return "local-admin";
    }
    if(config.authMode==="tailscale"){
      const configuredOrigin=new URL(config.externalOrigin),host=String(request.headers.host??"").toLowerCase();
      const expectedHost=configuredOrigin.host.toLowerCase();
      if(!isLoopbackAddress(request.ip||(request.raw.socket.remoteAddress??"")))throw Object.assign(new Error("Tailscale Serve authentication requires a loopback backend connection."),{statusCode:403,code:"TAILSCALE_BACKEND_NOT_LOOPBACK"});
      if(host!==expectedHost)throw Object.assign(new Error("Tailscale Serve host does not match the configured external origin."),{statusCode:403,code:"TAILSCALE_HOST_MISMATCH"});
      if(typeof request.headers.origin==="string"&&request.headers.origin!==configuredOrigin.origin)throw Object.assign(new Error("Tailscale Serve origin does not match the configured external origin."),{statusCode:403,code:"TAILSCALE_ORIGIN_MISMATCH"});
      const login=request.headers["tailscale-user-login"];
      if(typeof login!=="string"||!login.trim())throw Object.assign(new Error("Tailscale Serve user identity is required."),{statusCode:403,code:"TAILSCALE_IDENTITY_REQUIRED"});
      const allowed=(config.tailscaleAllowedEmail??config.allowedEmail).trim();
      if(login!==allowed)throw Object.assign(new Error("Tailscale identity is not allowed."),{statusCode:403,code:"TAILSCALE_IDENTITY_NOT_ALLOWED"});
      return login;
    }
    if (config.authMode === "test") {
      if ((process.env.CLAUDEX_WORKHOUSE_TEST_MODE) !== "1" || !isLoopbackAddress(request.ip)) throw Object.assign(new Error("Test authentication is not available."), { statusCode: 403 });
      const email = request.headers["x-claudex-workhouse-test-user"];
      if (email === config.allowedEmail) return email;
      const allowCloudflare=options.allowCloudflareInTest??(process.env.CLAUDEX_WORKHOUSE_TEST_ALLOW_CLOUDFLARE)==="1",token=request.headers["cf-access-jwt-assertion"];
      if(allowCloudflare&&configured&&jwks&&typeof token==="string")return verifyAccessToken(token,jwks,issuer,config.audience,config.allowedEmail);
      throw Object.assign(new Error("Invalid test identity."), { statusCode: 403 });
    }
    if (!configured || !jwks) throw Object.assign(new Error("Cloudflare Access is not configured."), { statusCode: 503, code: "ACCESS_SETUP_REQUIRED" });
    const token = request.headers["cf-access-jwt-assertion"];
    if (typeof token !== "string") throw Object.assign(new Error("Missing Cloudflare Access JWT."), { statusCode: 403 });
    return verifyAccessToken(token, jwks, issuer, config.audience, config.allowedEmail);
  };
}
