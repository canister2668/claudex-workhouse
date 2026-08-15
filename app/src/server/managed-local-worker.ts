import crypto from"node:crypto";
import path from"node:path";
import type{DeckDatabase}from"./db/client.js";
import{loadWorkerConfig,saveWorkerConfig,type WorkerConfig,type WorkerRoot,type WorkerWorkspace}from"./desktop-worker/config.js";
import type{Workspace,WorkspaceRoot}from"./types.js";

export const MANAGED_LOCAL_WORKER_HOST_ID="local";
export function managedLocalWorkerEnabled(platform:NodeJS.Platform=process.platform){return platform==="win32";}
export function executionHostUsesWorker(hostId:string,platform:NodeJS.Platform=process.platform){return hostId!==MANAGED_LOCAL_WORKER_HOST_ID||managedLocalWorkerEnabled(platform);}

const digest=(value:string)=>crypto.createHash("sha256").update(value).digest("hex");
const credentialVersion=(value:any)=>Number(value?.credentialVersion??value?.credential_version??0);
const credentialHash=(value:any)=>String(value?.credentialHash??value?.credential_hash??"");
const credentialRevoked=(value:any)=>Boolean(value?.revokedAt??value?.revoked_at);

export function managedLocalWorkerHome(dataRoot:string){return path.join(dataRoot,"runtime","local-worker");}

export function syncManagedLocalWorkerConfig(config:WorkerConfig,roots:WorkspaceRoot[],workspaces:Workspace[]){
  config.roots=roots.filter(item=>item.hostId===MANAGED_LOCAL_WORKER_HOST_ID&&!item.disabledAt).map<WorkerRoot>(item=>({
    id:item.id,
    displayName:item.displayName,
    canonicalPath:item.canonicalPath,
    allowCreate:item.allowCreate,
    allowRegister:item.allowRegister,
    allowClone:item.allowClone,
    allowDelete:item.allowDelete
  }));
  const rootIds=new Set(config.roots.map(item=>item.id));
  config.workspaces=workspaces.filter(item=>item.hostId===MANAGED_LOCAL_WORKER_HOST_ID&&!item.archivedAt&&rootIds.has(item.rootId)).map<WorkerWorkspace>(item=>({
    id:item.id,
    projectId:item.projectId,
    hostId:MANAGED_LOCAL_WORKER_HOST_ID,
    rootId:item.rootId,
    relativePath:item.relativePath,
    canonicalPath:item.canonicalPath,
    displayName:item.displayName,
    workspaceType:item.workspaceType,
    createdAt:item.createdAt,
    updatedAt:item.updatedAt
  }));
  return config;
}

export async function prepareManagedLocalWorker(input:{
  dataRoot:string;
  installationId:string;
  serverUrl:string;
  claudeBinary:string;
  codexBinary:string;
  roots:WorkspaceRoot[];
  workspaces:Workspace[];
  db:Pick<DeckDatabase,"getWorkerCredential"|"putWorkerCredential">;
}){
  const url=new URL(input.serverUrl);
  if(url.protocol!=="http:"||url.hostname!=="127.0.0.1")throw new Error("Managed local Worker requires a loopback HTTP server URL.");
  const home=managedLocalWorkerHome(input.dataRoot),config=loadWorkerConfig(home);
  if(config.installationId&&config.installationId!==input.installationId)throw new Error("Managed local Worker identity belongs to another installation.");
  if(config.hostId&&config.hostId!==MANAGED_LOCAL_WORKER_HOST_ID)throw new Error("Managed local Worker storage contains a remote pairing.");
  const reused=Boolean(config.managedLocal&&config.installationId===input.installationId&&config.credential);
  if(!config.credential)config.credential=crypto.randomBytes(32).toString("base64url");
  if(config.credentialVersion<1)config.credentialVersion=1;
  config.managedLocal=true;
  config.installationId=input.installationId;
  config.runtimeHome=home;
  config.serverUrl=url.origin;
  config.hostId=MANAGED_LOCAL_WORKER_HOST_ID;
  if(!config.providerBinaries?.claude?.verifiedPath)config.claudeBinary=input.claudeBinary;
  if(!config.providerBinaries?.codex?.verifiedPath)config.codexBinary=input.codexBinary;
  syncManagedLocalWorkerConfig(config,input.roots,input.workspaces);

  const stored=await input.db.getWorkerCredential(MANAGED_LOCAL_WORKER_HOST_ID);
  if(stored&&credentialRevoked(stored))throw Object.assign(new Error("Managed local Worker credential is revoked."),{code:"LOCAL_WORKER_CREDENTIAL_REVOKED"});
  const nextHash=digest(config.credential);
  if(stored&&credentialHash(stored)!==nextHash){
    if(config.credentialVersion<=credentialVersion(stored))throw Object.assign(new Error("Managed local Worker credential state does not match the server."),{code:"LOCAL_WORKER_CREDENTIAL_MISMATCH"});
  }
  // Persist the recoverable secret before publishing its hash. If the process
  // stops between these writes, the next boot can recreate the missing DB row
  // from this installation-owned file. The inverse order can strand the
  // installation with a hash whose credential no longer exists.
  saveWorkerConfig(config,home);
  if(!stored||credentialHash(stored)!==nextHash||credentialVersion(stored)!==config.credentialVersion){
    const timestamp=new Date().toISOString();
    await input.db.putWorkerCredential({hostId:MANAGED_LOCAL_WORKER_HOST_ID,credentialHash:nextHash,credentialVersion:config.credentialVersion,createdAt:timestamp,rotatedAt:stored?timestamp:null});
  }
  return{config,home,reused,credentialHash:nextHash};
}
