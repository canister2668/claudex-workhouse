import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type{WindowsProviderBinaryRecord,WindowsProviderId}from"../windows/provider-discovery.js";

export type WorkerRoot={id:string;displayName:string;canonicalPath:string;allowCreate:boolean;allowRegister:boolean;allowClone:boolean;allowDelete:boolean};
export type WorkerWorkspace={id:string;projectId:string;hostId:string;rootId:string;relativePath:string;canonicalPath:string;displayName:string;workspaceType:"existing"|"empty"|"git-init"|"git-clone"|"git-worktree";createdAt:string;updatedAt:string};
export type WorkerTask={id:string;provider:"claude"|"codex";workspaceId:string;stateFile:string;pid:number|null;marker:string;processStart?:string|null;executablePath?:string|null;createdAt:string;updatedAt:string;status:string;threadId:string|null;lastForwardedSequence:number;interruptionCause?:string|null;interruptionDetectedAt?:string|null};
export type WorkerConfig={schemaVersion:1;serverUrl:string|null;hostId:string|null;credential:string|null;credentialVersion:number;previousCredential?:string|null;previousCredentialExpiresAt?:string|null;entryKey:string;roots:WorkerRoot[];workspaces:WorkerWorkspace[];tasks:WorkerTask[];claudeBinary:string;codexBinary:string;providerBinaries?:Partial<Record<WindowsProviderId,WindowsProviderBinaryRecord>>;managedLocal?:boolean;installationId?:string|null;runtimeHome?:string|null};

export function workerHome(){
  const configured=process.env.CLAUDEX_WORKHOUSE_WORKER_HOME;
  if(configured)return configured;
  return path.join(os.homedir(),".claudex-workhouse-worker");
}
export function workerConfigFile(home=workerHome()){return path.join(home,"config.json");}
export function emptyConfig():WorkerConfig{return{schemaVersion:1,serverUrl:null,hostId:null,credential:null,credentialVersion:0,previousCredential:null,previousCredentialExpiresAt:null,entryKey:crypto.randomBytes(32).toString("base64url"),roots:[],workspaces:[],tasks:[],claudeBinary:process.env.CLAUDE_BIN??"claude",codexBinary:process.env.CODEX_BIN??"codex"};}
export function loadWorkerConfig(home=workerHome()){try{return{...emptyConfig(),...JSON.parse(fs.readFileSync(workerConfigFile(home),"utf8")),runtimeHome:home} as WorkerConfig;}catch{return{...emptyConfig(),runtimeHome:home};}}
export function saveWorkerConfig(config:WorkerConfig,home=config.runtimeHome??workerHome()){
  fs.mkdirSync(home,{recursive:true,mode:0o700});try{fs.chmodSync(home,0o700);}catch{}
  const file=workerConfigFile(home),temporary=`${file}.${process.pid}.tmp`;fs.writeFileSync(temporary,`${JSON.stringify({...config,runtimeHome:home},null,2)}\n`,{encoding:"utf8",mode:0o600});try{fs.chmodSync(temporary,0o600);}catch{}
  if(process.platform==="win32"){
    const identity=[process.env.USERDOMAIN,process.env.USERNAME].filter(Boolean).join("\\")||os.userInfo().username;
    const result=identity&&!/[\u0000-\u001f":]/.test(identity)?spawnSync("icacls",[temporary,"/inheritance:r","/grant:r",`${identity}:F`],{shell:false,encoding:"utf8",windowsHide:true}):null;
    if(!result||result.error||result.status!==0){fs.rmSync(temporary,{force:true});throw new Error("Failed to protect the Worker credential file.");}
  }
  fs.renameSync(temporary,file);
}
export function redactConfig(config:WorkerConfig){return{schemaVersion:config.schemaVersion,serverUrl:config.serverUrl?new URL(config.serverUrl).origin:null,hostId:config.hostId,paired:Boolean(config.credential),credentialVersion:config.credentialVersion,roots:config.roots.map(item=>({id:item.id,displayName:item.displayName,path:path.basename(item.canonicalPath)})),workspaces:config.workspaces.length,tasks:config.tasks.map(item=>({id:item.id,provider:item.provider,status:item.status,updatedAt:item.updatedAt}))};}
