import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFile } from "node:child_process";
import { readClaudeRuntime } from "./claude-runtime.js";
import { managedCodexBinary,managedCodexRuntime,managedCodexRuntimeFault } from "./codex-runtime.js";
import { sanitizeSensitiveText } from "./sensitive-data.js";
import type { ProviderId } from "./types.js";

export type RuntimeProvider="codex"|"claude";
export type RuntimeManagement="managed"|"external"|"api";
export type RuntimeUpdateStatus={
  provider:ProviderId;name:string;current:string|null;latest:string|null;
  updateAvailable:boolean|null;managed:boolean;source:string;checkedAt:string|null;canUpdate:boolean;checksum:string|null;
  management:RuntimeManagement;dependsOn:RuntimeProvider|null;configured:boolean|null;
  /** What `checksum` digests, so a binary digest is never shown as a package digest. */
  checksumSource?:"package"|"binary"|null;
  /** Why a recorded managed runtime is unusable, when it is. */
  fault?:string|null;
};
export type ManagedRuntimeUpdateStatus=RuntimeUpdateStatus&{provider:RuntimeProvider};
export const MANAGED_RUNTIME_PROVIDERS:readonly RuntimeProvider[]=["codex","claude"];
export const isManagedRuntimeStatus=(item:RuntimeUpdateStatus):item is ManagedRuntimeUpdateStatus=>item.provider==="codex"||item.provider==="claude";

const updating=new Set<RuntimeProvider>();
const executable=(file:string)=>{try{fs.accessSync(file,fs.constants.X_OK);return true;}catch{return false;}};
const hostJoin=(platform:NodeJS.Platform,...parts:string[])=>(platform==="win32"?path.win32:path.posix).join(...parts);
export const managedRuntimeBinary=(dataRoot:string,provider:RuntimeProvider,platform:NodeJS.Platform=process.platform)=>provider==="codex"?managedCodexBinary(dataRoot,platform):hostJoin(platform,dataRoot,"runtime","claude-bin",platform==="win32"?"claude.exe":"claude");
// `CLAUDEX_WORKHOUSE_CODEX_BIN` is the documented way to point at an
// externally provisioned Codex, and every launch path already honours it. This
// one did not, so an install using the override reported update state for
// `/usr/local/bin/codex` — a path it never runs — and showed Codex as missing
// or stuck at the wrong version. The deliberate absence of a PATH fallback
// stays: an older global npm install must not silently replace a managed
// runtime.
export const codexBinary=(dataRoot:string,platform:NodeJS.Platform=process.platform)=>process.env.CLAUDEX_WORKHOUSE_CODEX_BIN?.trim()||managedCodexRuntime(dataRoot,platform)?.binary||(platform==="win32"?null:"/usr/local/bin/codex");

export function versionFromOutput(output:string){return output.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/)?.[0]??null;}
export function codexVersionFromTag(tag:unknown){if(typeof tag!=="string")return null;const match=tag.match(/^rust-v(\d+\.\d+\.\d+(?:-(?:alpha|beta)(?:\.\d+)?)?)$/);return match?.[1]??null;}
export function updateAvailable(current:string|null,latest:string|null){return current&&latest?current!==latest:null;}

function run(file:string,args:string[],options:{cwd:string;env?:NodeJS.ProcessEnv;timeout?:number}){
  return new Promise<{stdout:string;stderr:string}>((resolve,reject)=>execFile(file,args,{cwd:options.cwd,env:options.env??process.env,timeout:options.timeout??300000,maxBuffer:2*1024*1024,windowsHide:true},(error,stdout,stderr)=>{
    if(error)return reject(Object.assign(new Error(sanitizeSensitiveText(String(stderr||error.message)).trim().slice(-2000)),{cause:sanitizeSensitiveText(error.message)}));
    resolve({stdout:sanitizeSensitiveText(String(stdout)),stderr:sanitizeSensitiveText(String(stderr))});
  }));
}

async function binaryVersion(file:string|null,root:string){if(!file||!executable(file))return null;return versionFromOutput((await run(file,["--version"],{cwd:root,timeout:15000})).stdout);}

export async function localRuntimeStatuses(appRoot:string,dataRoot=appRoot,platform:NodeJS.Platform=process.platform):Promise<RuntimeUpdateStatus[]>{
  const claude=readClaudeRuntime(dataRoot),codex=managedCodexRuntime(dataRoot,platform),codexFile=codex?.binary??codexBinary(dataRoot,platform),managed=codex!==null;
  const codexFault=managedCodexRuntimeFault(dataRoot,platform);
  const codexCurrent=await binaryVersion(codexFile,appRoot).catch(()=>null);
  return[
    {provider:"codex",name:"Codex CLI",current:codexCurrent,latest:null,updateAvailable:null,managed,source:codexFault?"corrupt":codex?.source??(platform==="win32"?"unavailable":"global-fallback"),checkedAt:null,canUpdate:managed,checksum:codex?.checksum??null,checksumSource:codex?.checksumSource??null,fault:codexFault,management:"managed",dependsOn:null,configured:null},
    {provider:"claude",name:"Claude Code",current:claude.version,latest:null,updateAvailable:null,managed:claude.managed,source:claude.source??"unmanaged",checkedAt:null,canUpdate:claude.managed,checksum:claude.checksum,management:"managed",dependsOn:null,configured:null},
  ];
}

async function latestCodex(){
  const response=await fetch("https://api.github.com/repos/openai/codex/releases/latest",{headers:{Accept:"application/vnd.github+json","User-Agent":"Claudex-Workhouse-Runtime-Updater/1"},signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error(`Codex release check failed (${response.status}).`);
  const version=codexVersionFromTag((await response.json() as any).tag_name);if(!version)throw new Error("Codex release response had an invalid tag.");return version;
}

async function latestClaude(root:string){
  const result=await run(process.execPath,[path.join(root,"bin","claude-runtime.mjs"),"check","latest"],{cwd:root});
  const parsed=JSON.parse(result.stdout);const version=parsed?.release?.version;
  if(typeof version!=="string")throw new Error("Claude release response had no version.");return version;
}

export async function checkRuntimeUpdates(appRoot:string,dataRoot=appRoot):Promise<RuntimeUpdateStatus[]>{
  const local=await localRuntimeStatuses(appRoot,dataRoot);const checkedAt=new Date().toISOString();
  const latest=await Promise.allSettled([latestCodex(),latestClaude(appRoot)]);
  return local.map((item,index)=>{
    const result=latest[index];
    if(result.status==="rejected")return{...item,checkedAt,source:`${item.source}:check-failed`};
    return{...item,latest:result.value,updateAvailable:updateAvailable(item.current,result.value),checkedAt};
  });
}

export async function applyRuntimeUpdate(appRoot:string,provider:RuntimeProvider,dataRoot=appRoot){
  if(updating.has(provider))throw Object.assign(new Error(`${provider} update is already running.`),{statusCode:409});
  updating.add(provider);
  try{
    if(provider==="claude")await run(process.execPath,[path.join(appRoot,"bin","claude-runtime.mjs"),"update","latest"],{cwd:appRoot,env:{...process.env,CLAUDEX_WORKHOUSE_ROOT:dataRoot}});
    else{
      const binary=managedRuntimeBinary(dataRoot,"codex");if(!executable(binary))throw Object.assign(new Error("Managed Codex standalone runtime is not installed."),{statusCode:503});
      await run(process.execPath,[path.join(appRoot,"bin","codex-runtime.mjs"),"update"],{cwd:appRoot,env:{...process.env,CLAUDEX_WORKHOUSE_ROOT:dataRoot}});
    }
    return checkRuntimeUpdates(appRoot,dataRoot);
  }finally{updating.delete(provider);}
}

export async function installRuntime(appRoot:string,provider:RuntimeProvider,dataRoot=appRoot){
  if(updating.has(provider))throw Object.assign(new Error(`${provider} installation is already running.`),{statusCode:409});
  updating.add(provider);
  try{
    const result=await run(process.execPath,[path.join(appRoot,"bin",`${provider}-runtime.mjs`),"ensure"],{cwd:appRoot,env:{...process.env,CLAUDEX_WORKHOUSE_ROOT:dataRoot},timeout:15*60_000});
    const parsed=JSON.parse(result.stdout);
    if(parsed?.ok!==true)throw new Error(`${provider} installer did not report success.`);
    return localRuntimeStatuses(appRoot,dataRoot);
  }catch(error){
    if((error as any)?.statusCode)throw error;
    const detail=sanitizeSensitiveText(error instanceof Error?error.message:String(error));
    throw Object.assign(new Error(`${provider==="claude"?"Claude Code":"Codex"} 설치에 실패했습니다. 인터넷 연결과 디스크 여유 공간을 확인해 주세요.`),{statusCode:503,code:"RUNTIME_INSTALL_FAILED",detail,errorParams:{detail}});
  }finally{updating.delete(provider);}
}
