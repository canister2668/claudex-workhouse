import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { FastifyRequest } from "fastify";
import type { DeckDatabase } from "../db/client.js";

export const OWNER_CLAIM_PROTOCOL_VERSION=1;
export const OWNER_CLAIM_COOKIE="claudex_owner";
const OWNER_CLAIM_TTL_MS=10*60_000;
const OWNER_COOKIE_MAX_AGE_SECONDS=365*24*60*60;
const OWNER_RECOVERY_PROOF_TTL_MS=60_000;

export type HostRole="main-server"|"worker";
export type BootstrapEnrollment={
  id:string;
  scope:"server-owner"|"worker";
  tokenHash:string;
  expiresAt:string;
  consumedAt:string|null;
  createdAt:string;
  intendedRoles:HostRole[];
};
export type OwnerClaimQrPayload={
  type:"claudex-owner-claim";
  version:1;
  enrollmentId:string;
  serverUrl:string;
  claimToken:string;
  serverFingerprint:string;
  expiresAt:string;
};
export type OwnerRecoveryProof={issuedAt:number;nonce:string;signature:string};
type ServerIdentity={
  version:1;
  installationId:string;
  publicKeyPem:string;
  privateKeyPem:string;
  fingerprint:string;
  createdAt:string;
};
type OwnerSetting={
  claimed:true;
  claimedAt:string;
  fingerprint:string;
  installationId:string;
  credentialHash:string|null;
  migrated?:boolean;
  protocolVersion:1;
};

function sha256(value:string|Buffer){return crypto.createHash("sha256").update(value).digest("hex");}
function safeEqual(left:string,right:string){
  const a=Buffer.from(left),b=Buffer.from(right);
  return a.length===b.length&&crypto.timingSafeEqual(a,b);
}
function identityFile(root:string){return path.join(root,"data","infrastructure","server-identity.json");}
function verifiedIdentity(value:ServerIdentity,installationId:string):ServerIdentity|null{
  try{
    if(value.version!==1||value.installationId!==installationId||typeof value.publicKeyPem!=="string"||typeof value.privateKeyPem!=="string"||!/^[a-f0-9]{64}$/.test(value.fingerprint))return null;
    const publicKey=crypto.createPublicKey(value.publicKeyPem),privateKey=crypto.createPrivateKey(value.privateKeyPem);
    if(publicKey.asymmetricKeyType!=="ed25519"||privateKey.asymmetricKeyType!=="ed25519")return null;
    const publicDer=publicKey.export({type:"spki",format:"der"}),derivedDer=crypto.createPublicKey(privateKey).export({type:"spki",format:"der"});
    if(!Buffer.from(publicDer).equals(Buffer.from(derivedDer))||value.fingerprint!==sha256(publicDer))return null;
    return value;
  }catch{return null;}
}
function ensureIdentity(root:string,installationId:string,now:()=>Date):ServerIdentity{
  const file=identityFile(root);
  try{
    const value=JSON.parse(fs.readFileSync(file,"utf8")) as ServerIdentity;
    const verified=verifiedIdentity(value,installationId);
    if(verified)return verified;
  }catch{/* A missing or incomplete identity is replaced before enrollment starts. */}
  const directory=path.dirname(file);fs.mkdirSync(directory,{recursive:true,mode:0o700});fs.chmodSync(directory,0o700);
  const pair=crypto.generateKeyPairSync("ed25519"),publicKeyPem=pair.publicKey.export({type:"spki",format:"pem"}).toString(),privateKeyPem=pair.privateKey.export({type:"pkcs8",format:"pem"}).toString(),publicDer=pair.publicKey.export({type:"spki",format:"der"});
  const value:ServerIdentity={version:1,installationId,publicKeyPem,privateKeyPem,fingerprint:sha256(publicDer),createdAt:now().toISOString()};
  const temporary=path.join(directory,`.server-identity-${process.pid}-${crypto.randomUUID()}.tmp`);
  fs.writeFileSync(temporary,`${JSON.stringify(value,null,2)}\n`,{encoding:"utf8",mode:0o600,flag:"wx"});
  fs.renameSync(temporary,file);fs.chmodSync(file,0o600);
  return value;
}
function normalizedServerUrls(values:string[]){
  const urls:string[]=[];
  for(const raw of values)try{const url=new URL(raw);url.hash="";url.search="";const value=url.origin;if(!urls.includes(value))urls.push(value);}catch{}
  return urls;
}
function cookieValue(raw:string|undefined,name:string){
  if(!raw)return null;
  for(const part of raw.split(";")){
    const index=part.indexOf("=");if(index<0)continue;
    if(part.slice(0,index).trim()!==name)continue;
    try{return decodeURIComponent(part.slice(index+1).trim());}catch{return null;}
  }
  return null;
}
function credentialFromRequest(request:Pick<FastifyRequest,"headers">){
  const authorization=request.headers.authorization;
  if(typeof authorization==="string"&&authorization.startsWith("Claudex-Owner "))return authorization.slice("Claudex-Owner ".length).trim();
  return cookieValue(typeof request.headers.cookie==="string"?request.headers.cookie:undefined,OWNER_CLAIM_COOKIE);
}
function ownerSetting(value:unknown):OwnerSetting|null{
  if(!value||typeof value!=="object"||Array.isArray(value))return null;
  const item=value as Record<string,unknown>,credentialHash=item.credentialHash;
  if(item.claimed!==true||item.protocolVersion!==1||typeof item.claimedAt!=="string"||!Number.isFinite(Date.parse(item.claimedAt))||typeof item.installationId!=="string"||!/^[a-f0-9]{64}$/.test(String(item.fingerprint??"")))return null;
  const migrated=item.migrated===true;
  if(credentialHash===null&&!migrated)return null;
  if(credentialHash!==null&&(typeof credentialHash!=="string"||!/^[a-f0-9]{64}$/.test(credentialHash)))return null;
  return item as unknown as OwnerSetting;
}
export function ownerRecoveryMessage(installationId:string,issuedAt:number,nonce:string){
  return `claudex-owner-recovery:v1:${installationId}:${issuedAt}:${nonce}`;
}

export function ownerClaimApiAccess(pathname:string,claimed:boolean){
  const publicPaths=new Set([
    "/api/bootstrap/owner-claim/status",
    "/api/bootstrap/owner-claim/complete",
    "/api/bootstrap/owner-claim/local",
    "/api/bootstrap/owner-claim/renew",
    "/api/bootstrap/owner-claim/recover"
  ]);
  if(publicPaths.has(pathname))return"public" as const;
  return claimed?"normal" as const:"blocked" as const;
}

export function isStrictLoopbackBootstrapRequest(request:Pick<FastifyRequest,"ip"|"headers"|"raw">){
  const address=request.ip||request.raw.socket.remoteAddress||"",host=String(request.headers.host??"").toLowerCase();
  const forwarded=["forwarded","x-forwarded-for","x-forwarded-host","x-forwarded-proto","x-real-ip","cf-connecting-ip"].some(name=>Boolean(request.headers[name]));
  const loopbackAddress=["127.0.0.1","::1","::ffff:127.0.0.1"].includes(address);
  const loopbackHost=/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host);
  return loopbackAddress&&loopbackHost&&!forwarded;
}

export class OwnerClaimManager{
  private identity:ServerIdentity;
  private owner:OwnerSetting|null=null;
  private currentEnrollment:{record:BootstrapEnrollment;token:string}|null=null;
  private recoveryNonces=new Map<string,number>();
  private operationTail:Promise<void>=Promise.resolve();
  constructor(private options:{
    root:string;
    db:DeckDatabase;
    installationId:string;
    serverUrls:string[];
    forceRequired:boolean;
    existingInstallation:boolean;
    intendedRoles?:HostRole[];
    now?:()=>Date;
    ttlMs?:number;
  }){
    this.now=options.now??(()=>new Date());
    this.identity=ensureIdentity(options.root,options.installationId,this.now);
  }
  private now:()=>Date;

  /**
   * Owner enrollment mutations span both SQLite state and this manager's
   * in-memory credential/enrollment state. Keep them in one process-local
   * critical section so a renewal cannot overwrite a claim that completed
   * while its transaction was in flight.
   */
  private exclusive<T>(operation:()=>Promise<T>):Promise<T>{
    const result=this.operationTail.then(operation,operation);
    this.operationTail=result.then(()=>undefined,()=>undefined);
    return result;
  }

  async initialize(){
    const stored=await this.options.db.getSystemSetting("owner.claim").catch(()=>null),value=ownerSetting(stored?.value);
    if(stored){
      if(value&&value.installationId===this.options.installationId&&value.fingerprint===this.identity.fingerprint){this.owner=value;return this.publicStatus();}
      const timestamp=this.now().toISOString();
      await this.options.db.appendAudit({createdAt:timestamp,actor:"system",action:"owner-claim-recovery-required",provider:null,taskId:null,projectId:null,outcome:"failed",detail:"Stored owner identity was invalid or did not match the current server identity."}).catch(()=>{});
      const{token,record}=this.newEnrollment();
      await this.options.db.recoverOwnerBootstrapEnrollment({
        enrollment:record,
        recovery:{
          claimed:false,
          recoveryStartedAt:record.createdAt,
          installationId:this.options.installationId,
          fingerprint:this.identity.fingerprint,
          protocolVersion:1
        }
      });
      this.owner=null;
      this.currentEnrollment={record,token};
      return this.publicStatus();
    }
    if(this.options.existingInstallation&&!this.options.forceRequired){
      const timestamp=this.now().toISOString();
      this.owner={claimed:true,claimedAt:timestamp,fingerprint:this.identity.fingerprint,installationId:this.options.installationId,credentialHash:null,migrated:true,protocolVersion:1};
      await this.options.db.putSystemSetting("owner.claim",this.owner,timestamp);
      await this.options.db.appendAudit({createdAt:timestamp,actor:"system",action:"owner-claim-existing-installation-migrated",provider:null,taskId:null,projectId:null,outcome:"success",detail:"Existing authenticated installation retained; no bootstrap credential issued."});
      return this.publicStatus();
    }
    await this.rotate();
    return this.publicStatus();
  }

  isClaimed(){return this.owner?.claimed===true;}
  hasCredential(){return typeof this.owner?.credentialHash==="string"&&this.owner.credentialHash.length===64;}
  fingerprint(){return this.identity.fingerprint;}
  publicKey(){return this.identity.publicKeyPem;}

  publicStatus(){
    const record=this.currentEnrollment?.record??null,expired=Boolean(record&&new Date(record.expiresAt).getTime()<=this.now().getTime());
    return{
      required:!this.isClaimed(),
      claimed:this.isClaimed(),
      protocolVersion:OWNER_CLAIM_PROTOCOL_VERSION,
      serverFingerprint:this.identity.fingerprint,
      serverPublicKey:this.identity.publicKeyPem,
      serverUrls:normalizedServerUrls(this.options.serverUrls),
      enrollment:record?{id:record.id,scope:record.scope,expiresAt:record.expiresAt,consumedAt:record.consumedAt,intendedRoles:record.intendedRoles,expired}:null
    };
  }

  async rotate(){
    return this.exclusive(()=>this.rotateUnlocked());
  }

  private async rotateUnlocked(){
    if(this.isClaimed())throw Object.assign(new Error("This server already has an owner."),{statusCode:409,code:"OWNER_ALREADY_CLAIMED"});
    const{token,record}=this.newEnrollment();
    await this.options.db.recoverOwnerBootstrapEnrollment({
      enrollment:record,
      recovery:{
        claimed:false,
        claimStartedAt:record.createdAt,
        installationId:this.options.installationId,
        fingerprint:this.identity.fingerprint,
        protocolVersion:OWNER_CLAIM_PROTOCOL_VERSION
      }
    });
    this.currentEnrollment={record,token};
    return this.localPayload();
  }

  private newEnrollment(){
    const token=crypto.randomBytes(32).toString("base64url"),createdAt=this.now(),expiresAt=new Date(createdAt.getTime()+(this.options.ttlMs??OWNER_CLAIM_TTL_MS)),record:BootstrapEnrollment={
      id:crypto.randomUUID(),scope:"server-owner",tokenHash:sha256(token),expiresAt:expiresAt.toISOString(),consumedAt:null,createdAt:createdAt.toISOString(),intendedRoles:this.options.intendedRoles??["main-server","worker"]
    };
    return{token,record};
  }

  private verifyRecoveryProof(proof:OwnerRecoveryProof){
    const timestamp=this.now().getTime();
    if(!Number.isSafeInteger(proof.issuedAt)||proof.issuedAt<timestamp-OWNER_RECOVERY_PROOF_TTL_MS||proof.issuedAt>timestamp+10_000)throw Object.assign(new Error("Owner recovery proof has expired."),{statusCode:401,code:"OWNER_RECOVERY_PROOF_INVALID"});
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(proof.nonce)||!/^[A-Za-z0-9_-]{80,100}$/.test(proof.signature))throw Object.assign(new Error("Owner recovery proof is invalid."),{statusCode:401,code:"OWNER_RECOVERY_PROOF_INVALID"});
    for(const[nonce,expiresAt]of this.recoveryNonces)if(expiresAt<timestamp)this.recoveryNonces.delete(nonce);
    if(this.recoveryNonces.has(proof.nonce))throw Object.assign(new Error("Owner recovery proof was already used."),{statusCode:409,code:"OWNER_RECOVERY_PROOF_REUSED"});
    const valid=crypto.verify(null,Buffer.from(ownerRecoveryMessage(this.options.installationId,proof.issuedAt,proof.nonce)),crypto.createPublicKey(this.identity.publicKeyPem),Buffer.from(proof.signature,"base64url"));
    if(!valid)throw Object.assign(new Error("Owner recovery proof is invalid."),{statusCode:401,code:"OWNER_RECOVERY_PROOF_INVALID"});
    this.recoveryNonces.set(proof.nonce,timestamp+OWNER_RECOVERY_PROOF_TTL_MS);
  }

  async recover(proof:OwnerRecoveryProof){
    return this.exclusive(()=>this.recoverUnlocked(proof));
  }

  private async recoverUnlocked(proof:OwnerRecoveryProof){
    this.verifyRecoveryProof(proof);
    const previous=this.owner,{token,record}=this.newEnrollment(),recovery={claimed:false,recoveryStartedAt:record.createdAt,installationId:this.options.installationId,fingerprint:this.identity.fingerprint,protocolVersion:1};
    this.owner=null;
    try{await this.options.db.recoverOwnerBootstrapEnrollment({enrollment:record,recovery});}
    catch(error){this.owner=previous;throw error;}
    this.currentEnrollment={record,token};
    void this.options.db.appendAudit({createdAt:record.createdAt,actor:"local-recovery",action:"owner-claim-recovery-started",provider:null,taskId:null,projectId:null,outcome:"success",detail:`enrollment=${record.id};previousCredentialRevoked=${Boolean(previous?.credentialHash)}`}).catch(()=>{});
    return this.localPayload();
  }

  localPayload(){
    const current=this.currentEnrollment;
    if(!current)throw Object.assign(new Error("Owner claim enrollment is unavailable."),{statusCode:409,code:"OWNER_CLAIM_UNAVAILABLE"});
    if(new Date(current.record.expiresAt).getTime()<=this.now().getTime())throw Object.assign(new Error("Owner claim enrollment has expired."),{statusCode:410,code:"OWNER_CLAIM_EXPIRED"});
    const serverUrl=normalizedServerUrls(this.options.serverUrls)[0];
    if(!serverUrl)throw Object.assign(new Error("No direct server URL is available for owner claim."),{statusCode:503,code:"OWNER_CLAIM_URL_UNAVAILABLE"});
    const qr:OwnerClaimQrPayload={type:"claudex-owner-claim",version:1,enrollmentId:current.record.id,serverUrl,claimToken:current.token,serverFingerprint:this.identity.fingerprint,expiresAt:current.record.expiresAt};
    const fragment=new URLSearchParams({enrollmentId:qr.enrollmentId,claimToken:qr.claimToken,serverFingerprint:qr.serverFingerprint,expiresAt:qr.expiresAt});
    return{...this.publicStatus(),claimUrl:`${serverUrl}/claim#${fragment.toString()}`,qr};
  }

  async complete(input:{enrollmentId:string;claimToken:string;serverFingerprint:string}){
    return this.exclusive(()=>this.completeUnlocked(input));
  }

  private async completeUnlocked(input:{enrollmentId:string;claimToken:string;serverFingerprint:string}){
    if(this.isClaimed())throw Object.assign(new Error("This server already has an owner."),{statusCode:409,code:"OWNER_ALREADY_CLAIMED"});
    if(!safeEqual(input.serverFingerprint,this.identity.fingerprint))throw Object.assign(new Error("Server fingerprint does not match."),{statusCode:409,code:"OWNER_FINGERPRINT_MISMATCH"});
    if(!/^[A-Za-z0-9_-]{43}$/.test(input.claimToken))throw Object.assign(new Error("Owner claim token is invalid or expired."),{statusCode:401,code:"OWNER_CLAIM_INVALID"});
    const ownerCredential=crypto.randomBytes(32).toString("base64url"),timestamp=this.now().toISOString(),owner:OwnerSetting={
      claimed:true,claimedAt:timestamp,fingerprint:this.identity.fingerprint,installationId:this.options.installationId,credentialHash:sha256(ownerCredential),protocolVersion:1
    };
    const consumed=await this.options.db.consumeOwnerBootstrapEnrollment({id:input.enrollmentId,tokenHash:sha256(input.claimToken),now:timestamp,owner});
    if(!consumed)throw Object.assign(new Error("Owner claim token is invalid, expired, or already used."),{statusCode:401,code:"OWNER_CLAIM_INVALID"});
    this.owner=owner;this.currentEnrollment=null;
    void this.options.db.appendAudit({createdAt:timestamp,actor:"bootstrap-owner",action:"owner-claim-complete",provider:null,taskId:null,projectId:null,outcome:"success",detail:`enrollment=${input.enrollmentId};fingerprint=${this.identity.fingerprint.slice(0,16)}`}).catch(()=>{});
    return{claimed:true,claimedAt:timestamp,ownerCredential,serverFingerprint:this.identity.fingerprint,protocolVersion:1 as const};
  }

  authenticate(request:Pick<FastifyRequest,"headers">){
    const expected=this.owner?.credentialHash,credential=credentialFromRequest(request);
    if(!expected||!credential||!/^[A-Za-z0-9_-]{43}$/.test(credential))return null;
    return safeEqual(sha256(credential),expected)?"owner":null;
  }

  ownerCookie(credential:string,secure:boolean){
    const attributes=[`${OWNER_CLAIM_COOKIE}=${encodeURIComponent(credential)}`,"Path=/","HttpOnly","SameSite=Strict",`Max-Age=${OWNER_COOKIE_MAX_AGE_SECONDS}`];
    if(secure)attributes.push("Secure");
    return attributes.join("; ");
  }
}
