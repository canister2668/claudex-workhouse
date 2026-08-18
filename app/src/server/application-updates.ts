import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { VerifiedRelease } from "./deployment/release-manifest.js";

const SEMVER=/^([0-9]+)\.([0-9]+)\.([0-9]+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
const SHA256=/^[a-f0-9]{64}$/;
const IMAGE_DIGEST=/^sha256:[a-f0-9]{64}$/;

export type ApplicationUpdateState="unconfigured"|"checking"|"up-to-date"|"available"|"blocked-active-tasks"|"staging"|"applying"|"verifying"|"completed"|"rollback-running"|"rolled-back"|"failed";
export type ApplicationInstallMethod="source-checkout"|"docker-compose"|"windows-portable"|"node-package"|"unknown";

export interface ApplicationInstallMetadata{
  readonly schemaVersion:1;
  readonly version:string;
  readonly installMethod:ApplicationInstallMethod;
  readonly platform:"linux"|"windows";
  readonly architecture:"x64"|"arm64";
  readonly imageDigest:string|null;
  readonly packageSha256:string|null;
  readonly updaterProtocolVersion:number;
}

export interface ApplicationUpdateAttempt{
  readonly id:string;
  readonly state:ApplicationUpdateState;
  readonly sourceVersion:string;
  readonly targetVersion:string;
  readonly manifestSha256:string;
  readonly installMethod:ApplicationInstallMethod;
  readonly platform:string;
  readonly architecture:string;
  readonly snapshotId:string|null;
  readonly requestPath:string|null;
  readonly rollbackPerformed:boolean;
  readonly error:string|null;
  readonly createdAt:string;
  readonly updatedAt:string;
  readonly completedAt:string|null;
}

export interface ApplicationUpdateStore{
  createApplicationUpdateAttempt(attempt:ApplicationUpdateAttempt):Promise<ApplicationUpdateAttempt>;
  updateApplicationUpdateAttempt(attempt:ApplicationUpdateAttempt):Promise<ApplicationUpdateAttempt>;
  getActiveApplicationUpdateAttempt():Promise<ApplicationUpdateAttempt|null>;
  listApplicationUpdateAttempts(limit?:number):Promise<ApplicationUpdateAttempt[]>;
}

export interface ApplicationUpdateBlocker{readonly kind:"provider-task"|"collaboration"|"maintenance"|"update";readonly id:string;readonly status:string;}
export interface ApplicationUpdateSnapshot{readonly id:string;readonly directory:string;}
export interface ApplicationUpdateRequest{
  readonly schemaVersion:1;
  readonly attemptId:string;
  readonly installMethod:"docker-compose"|"windows-portable"|"node-package";
  readonly sourceVersion:string;
  readonly targetVersion:string;
  readonly manifestSha256:string;
  readonly snapshotId:string;
  readonly artifact:{readonly repository?:string;readonly digest?:string;readonly url?:string;readonly filename?:string;readonly size?:number;readonly sha256?:string;readonly registry?:string;readonly name?:string};
  readonly manifest:{readonly url:string;readonly signatureUrl:string;readonly signingPublicKeyPem:string;readonly signingPublicKeySha256:string;readonly keyId:string};
  readonly createdAt:string;
}

export interface ApplicationUpdateStatus{
  readonly state:ApplicationUpdateState;
  readonly current:ApplicationInstallMetadata;
  readonly target:{readonly version:string;readonly publishedAt:string;readonly manifestSha256:string;readonly keyId:string}|null;
  readonly updateAvailable:boolean;
  readonly reason:string|null;
  readonly blockers:readonly ApplicationUpdateBlocker[];
  readonly recentAttempts:readonly ApplicationUpdateAttempt[];
}

export function applicationUpdateBlockers(input:{
  tasks:readonly {id:string;status:string}[];
  sessions:readonly {id:string;status:string}[];
  maintenance?:{active?:unknown;status?:unknown}|null;
  activeUpdate?:{id:string;state:string}|null;
}):ApplicationUpdateBlocker[]{
  const blockers:ApplicationUpdateBlocker[]=[];
  for(const task of input.tasks)if(["pending","queued","running","waiting","unknown"].includes(task.status))blockers.push({kind:"provider-task",id:task.id,status:task.status});
  // A waiting-user collaboration is durably paused. Any provider process that
  // is still active is independently covered by the task blockers above.
  for(const session of input.sessions)if(["draft","starting","running","cancel-requested"].includes(session.status))blockers.push({kind:"collaboration",id:session.id,status:session.status});
  if(input.maintenance?.active===true)blockers.push({kind:"maintenance",id:"infrastructure.maintenance",status:String(input.maintenance.status??"active")});
  if(input.activeUpdate)blockers.push({kind:"update",id:input.activeUpdate.id,status:input.activeUpdate.state});
  return blockers;
}

function semverParts(value:string){
  const match=SEMVER.exec(value);if(!match)throw Object.assign(new Error(`Invalid application version: ${value}`),{code:"APPLICATION_VERSION_INVALID"});
  const core=match.slice(1,4).map(Number);if(core.some(item=>!Number.isSafeInteger(item)))throw Object.assign(new Error(`Application version exceeds the safe integer range: ${value}`),{code:"APPLICATION_VERSION_INVALID"});
  return{core,prerelease:match[4]?.split(".")??[]};
}
export function compareApplicationVersions(left:string,right:string){
  const a=semverParts(left),b=semverParts(right);
  for(let index=0;index<3;index++){const leftPart=a.core[index]!,rightPart=b.core[index]!;if(leftPart!==rightPart)return leftPart<rightPart?-1:1;}
  if(!a.prerelease.length||!b.prerelease.length)return a.prerelease.length===b.prerelease.length?0:a.prerelease.length?-1:1;
  for(let index=0;index<Math.max(a.prerelease.length,b.prerelease.length);index++){
    const av=a.prerelease[index],bv=b.prerelease[index];if(av===undefined)return-1;if(bv===undefined)return 1;if(av===bv)continue;
    const an=/^[0-9]+$/.test(av),bn=/^[0-9]+$/.test(bv);if(an&&bn)return Number(av)<Number(bv)?-1:1;if(an!==bn)return an?-1:1;return av<bv?-1:1;
  }
  return 0;
}

function architecture(value:string):"x64"|"arm64"{if(value==="x64"||value==="amd64")return"x64";if(value==="arm64"||value==="aarch64")return"arm64";throw Object.assign(new Error(`Unsupported application architecture: ${value}`),{code:"APPLICATION_ARCHITECTURE_UNSUPPORTED"});}
export function normalizeApplicationInstallMetadata(input:{version:string;installMethod:string;platform:string;architecture:string;imageDigest?:string|null;packageSha256?:string|null;updaterProtocolVersion?:number}):ApplicationInstallMetadata{
  semverParts(input.version);
  const method=(["source-checkout","docker-compose","windows-portable","node-package","unknown"] as const).includes(input.installMethod as ApplicationInstallMethod)?input.installMethod as ApplicationInstallMethod:"unknown";
  const platform=input.platform==="win32"||input.platform==="windows"?"windows":input.platform==="linux"?"linux":null;if(!platform)throw Object.assign(new Error(`Unsupported application platform: ${input.platform}`),{code:"APPLICATION_PLATFORM_UNSUPPORTED"});
  const imageDigest=input.imageDigest?.trim().toLowerCase()||null,packageSha256=input.packageSha256?.trim().toLowerCase()||null;
  if(imageDigest&&!IMAGE_DIGEST.test(imageDigest))throw Object.assign(new Error("Installed image digest is invalid."),{code:"APPLICATION_METADATA_INVALID"});
  if(packageSha256&&!SHA256.test(packageSha256))throw Object.assign(new Error("Installed package SHA-256 is invalid."),{code:"APPLICATION_METADATA_INVALID"});
  const protocol=input.updaterProtocolVersion??1;if(!Number.isSafeInteger(protocol)||protocol<1||protocol>1_000_000)throw Object.assign(new Error("Installed updater protocol version is invalid."),{code:"APPLICATION_METADATA_INVALID"});
  return Object.freeze({schemaVersion:1,version:input.version,installMethod:method,platform,architecture:architecture(input.architecture),imageDigest,packageSha256,updaterProtocolVersion:protocol});
}

function targetBinding(current:ApplicationInstallMetadata,release:VerifiedRelease){
  if(release.manifest.schemaVersion!==3)return{supported:false,reason:"manifest-updater-contract-missing",protocol:null,identity:null};
  if(current.installMethod==="docker-compose")return current.platform==="linux"?{supported:true,reason:null,protocol:release.manifest.server.minimumUpdaterProtocolVersion??null,identity:release.manifest.server.digest}:{supported:false,reason:"install-platform-mismatch",protocol:null,identity:null};
  if(current.installMethod==="windows-portable")return current.platform==="windows"&&current.architecture==="x64"&&release.manifest.windowsPortable?{supported:true,reason:null,protocol:release.manifest.windowsPortable.minimumUpdaterProtocolVersion,identity:release.manifest.windowsPortable.sha256}:{supported:false,reason:"install-platform-mismatch",protocol:null,identity:null};
  // The npm distribution is platform independent: one signed tarball serves
  // every platform and architecture, so only the artifact identity matters.
  // A manifest published before the record carried its own protocol floor
  // cannot state the contract, and is refused rather than assumed compatible.
  if(current.installMethod==="node-package")return release.manifest.nodePackage?.minimumUpdaterProtocolVersion===undefined?{supported:false,reason:"manifest-updater-contract-missing",protocol:null,identity:null}:{supported:true,reason:null,protocol:release.manifest.nodePackage.minimumUpdaterProtocolVersion,identity:release.manifest.nodePackage.sha256};
  return{supported:false,reason:current.installMethod==="source-checkout"?"source-checkout-not-updatable":"install-method-unsupported",protocol:null,identity:null};
}

export function evaluateApplicationUpdate(current:ApplicationInstallMetadata,release:VerifiedRelease):Pick<ApplicationUpdateStatus,"state"|"target"|"updateAvailable"|"reason">{
  const target={version:release.manifest.version,publishedAt:release.manifest.publishedAt,manifestSha256:release.manifestSha256,keyId:release.keyId},binding=targetBinding(current,release);
  if(!binding.supported)return{state:"unconfigured",target,updateAvailable:false,reason:binding.reason};
  if(binding.protocol===null||binding.protocol>current.updaterProtocolVersion)return{state:"failed",target,updateAvailable:false,reason:"updater-protocol-too-old"};
  const order=compareApplicationVersions(current.version,release.manifest.version);
  if(order<0)return{state:"available",target,updateAvailable:true,reason:null};
  if(order>0)return{state:"up-to-date",target,updateAvailable:false,reason:"installed-version-newer-than-stable"};
  const identity=current.installMethod==="docker-compose"?current.imageDigest:current.packageSha256;
  if(!identity)return{state:"failed",target,updateAvailable:false,reason:"installed-artifact-identity-missing"};
  return identity===binding.identity?{state:"up-to-date",target,updateAvailable:false,reason:null}:{state:"failed",target,updateAvailable:false,reason:"installed-artifact-mismatch"};
}

export function writeApplicationUpdateRequest(directory:string,request:ApplicationUpdateRequest){
  const resolved=path.resolve(directory);fs.mkdirSync(resolved,{recursive:true,mode:0o700});fs.chmodSync(resolved,0o700);
  const file=path.join(resolved,`${request.attemptId}.json`),temporary=`${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary,`${JSON.stringify(request,null,2)}\n`,{mode:0o600,flag:"wx"});fs.renameSync(temporary,file);return file;
}

export interface ApplicationUpdateCoordinatorOptions{
  readonly current:ApplicationInstallMetadata;
  readonly release:()=>Promise<VerifiedRelease>;
  readonly store:ApplicationUpdateStore;
  readonly blockers:()=>Promise<readonly ApplicationUpdateBlocker[]>;
  readonly snapshot:(attemptId:string,current:ApplicationInstallMetadata)=>Promise<ApplicationUpdateSnapshot>;
  readonly writeRequest:(request:ApplicationUpdateRequest)=>Promise<string>|string;
}

export class ApplicationUpdateCoordinator{
  private checking:Promise<ApplicationUpdateStatus>|null=null;
  private applying=false;
  constructor(private readonly options:ApplicationUpdateCoordinatorOptions){}
  check(){
    if(this.checking)return this.checking;
    this.checking=this.performCheck().finally(()=>{this.checking=null;});return this.checking;
  }
  private async performCheck():Promise<ApplicationUpdateStatus>{
    const release=await this.options.release(),evaluated=evaluateApplicationUpdate(this.options.current,release),[blockers,recentAttempts]=await Promise.all([this.options.blockers(),this.options.store.listApplicationUpdateAttempts(10)]);
    const active=recentAttempts.find(item=>["staging","applying","verifying","rollback-running"].includes(item.state));
    return{...evaluated,current:this.options.current,blockers,recentAttempts,state:active?.state??(evaluated.state==="available"&&blockers.length?"blocked-active-tasks":evaluated.state)};
  }
  async apply(input:{targetVersion:string;manifestSha256:string;confirm:true}){
    if(input.confirm!==true)throw Object.assign(new Error("Explicit update confirmation is required."),{statusCode:400,code:"APPLICATION_UPDATE_CONFIRMATION_REQUIRED"});
    if(!SHA256.test(input.manifestSha256))throw Object.assign(new Error("Manifest SHA-256 is invalid."),{statusCode:400,code:"APPLICATION_UPDATE_MANIFEST_INVALID"});
    if(this.applying||await this.options.store.getActiveApplicationUpdateAttempt())throw Object.assign(new Error("Another application update is already active."),{statusCode:409,code:"APPLICATION_UPDATE_ACTIVE"});
    this.applying=true;
    const now=new Date().toISOString(),id=crypto.randomUUID();let attempt:ApplicationUpdateAttempt|null=null;
    try{
      const release=await this.options.release();
      if(release.manifest.version!==input.targetVersion||release.manifestSha256!==input.manifestSha256)throw Object.assign(new Error("The confirmed update target no longer matches the verified release."),{statusCode:409,code:"APPLICATION_UPDATE_TARGET_CHANGED"});
      const evaluated=evaluateApplicationUpdate(this.options.current,release);if(!evaluated.updateAvailable)throw Object.assign(new Error(`Application update cannot be applied: ${evaluated.reason??evaluated.state}.`),{statusCode:409,code:"APPLICATION_UPDATE_NOT_AVAILABLE"});
      const blockers=await this.options.blockers();if(blockers.length)throw Object.assign(new Error("Application update is blocked by active work."),{statusCode:409,code:"APPLICATION_UPDATE_BLOCKED",blockers});
      attempt={id,state:"staging",sourceVersion:this.options.current.version,targetVersion:release.manifest.version,manifestSha256:release.manifestSha256,installMethod:this.options.current.installMethod,platform:this.options.current.platform,architecture:this.options.current.architecture,snapshotId:null,requestPath:null,rollbackPerformed:false,error:null,createdAt:now,updatedAt:now,completedAt:null};
      attempt=await this.options.store.createApplicationUpdateAttempt(attempt);
      const snapshot=await this.options.snapshot(id,this.options.current);
      const artifact=this.options.current.installMethod==="docker-compose"?{repository:release.manifest.server.image,digest:release.manifest.server.digest}:this.options.current.installMethod==="node-package"?{registry:release.manifest.nodePackage!.registry,name:release.manifest.nodePackage!.name,url:release.manifest.nodePackage!.url,filename:release.manifest.nodePackage!.filename,size:release.manifest.nodePackage!.size,sha256:release.manifest.nodePackage!.sha256}:{url:release.manifest.windowsPortable!.url,filename:release.manifest.windowsPortable!.filename,size:release.manifest.windowsPortable!.size,sha256:release.manifest.windowsPortable!.sha256};
      const request:ApplicationUpdateRequest={schemaVersion:1,attemptId:id,installMethod:this.options.current.installMethod as "docker-compose"|"windows-portable"|"node-package",sourceVersion:this.options.current.version,targetVersion:release.manifest.version,manifestSha256:release.manifestSha256,snapshotId:snapshot.id,artifact,manifest:{url:release.manifestUrl,signatureUrl:release.signatureUrl,signingPublicKeyPem:release.signingPublicKeyPem,signingPublicKeySha256:release.signingPublicKeySha256,keyId:release.keyId},createdAt:new Date().toISOString()};
      const requestPath=await this.options.writeRequest(request);attempt={...attempt,state:"applying",snapshotId:snapshot.id,requestPath,updatedAt:new Date().toISOString()};
      return await this.options.store.updateApplicationUpdateAttempt(attempt);
    }catch(error){
      if(attempt)await this.options.store.updateApplicationUpdateAttempt({...attempt,state:"failed",error:error instanceof Error?error.message:String(error),updatedAt:new Date().toISOString(),completedAt:new Date().toISOString()}).catch(()=>{});
      throw error;
    }finally{this.applying=false;}
  }
}
