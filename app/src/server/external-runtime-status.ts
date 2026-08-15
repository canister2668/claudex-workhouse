import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFile } from "node:child_process";
import { antigravityBinary } from "./antigravity-environment.js";
import { compatibleProviderPublicSettings,type CompatibleProviderId } from "./compatible-provider-config.js";
import { resolveGrokBinary } from "./config.js";
import { versionFromOutput,type RuntimeUpdateStatus } from "./runtime-updates.js";

// Providers whose CLI Workhouse does not install or update. The runtime screen still has to
// report their real state so "six providers" never reads as "six managed runtimes".
const EXTERNAL_CLI_PROVIDERS=[{provider:"antigravity" as const,name:"Gemini Antigravity CLI"},{provider:"grok" as const,name:"Grok CLI"}];
const API_PROVIDERS=[{provider:"deepseek" as const,name:"DeepSeek"},{provider:"ollama" as const,name:"Ollama Cloud"}];

function executablePath(value:string):string|null{
  const candidates=/[\\/]/.test(value)?[value]:(process.env.PATH??"").split(path.delimiter).filter(Boolean).map(directory=>path.join(directory,value));
  for(const candidate of candidates){try{fs.accessSync(candidate,fs.constants.X_OK);return candidate;}catch{/* try the next candidate */}}
  return null;
}

function binaryVersion(file:string){
  return new Promise<string|null>(resolve=>execFile(file,["--version"],{timeout:10_000,maxBuffer:262_144,windowsHide:true},(error,stdout)=>resolve(error?null:versionFromOutput(String(stdout)))));
}

async function externalCliStatus(provider:"antigravity"|"grok",name:string,binary:string):Promise<RuntimeUpdateStatus>{
  const file=executablePath(binary),current=file?await binaryVersion(file).catch(()=>null):null;
  return{
    provider,name,current,latest:null,updateAvailable:null,managed:false,
    source:file?(current?"external-cli":"external-cli:version-unavailable"):"external-cli:not-installed",
    checkedAt:null,canUpdate:false,checksum:null,management:"external",dependsOn:null,configured:Boolean(file),
  };
}

function apiStatus(provider:CompatibleProviderId,name:string,dataRoot:string,claude:RuntimeUpdateStatus|undefined):RuntimeUpdateStatus{
  let configured=false;
  try{configured=compatibleProviderPublicSettings(provider,dataRoot).secretConfigured;}catch{configured=false;}
  return{
    provider,name,current:claude?.current??null,latest:null,updateAvailable:null,managed:false,
    source:configured?"api-key-configured":"api-key-missing",
    checkedAt:null,canUpdate:false,checksum:null,management:"api",dependsOn:"claude",configured,
  };
}

/**
 * Status rows for the providers that `localRuntimeStatuses` cannot manage: the externally
 * installed CLIs and the Anthropic-compatible API providers, which run on the managed Claude
 * Code runtime with a different base URL.
 */
export async function externalRuntimeStatuses(appRoot:string,dataRoot:string,managed:RuntimeUpdateStatus[]):Promise<RuntimeUpdateStatus[]>{
  const claude=managed.find(item=>item.provider==="claude");
  const binaries:Record<"antigravity"|"grok",string>={antigravity:antigravityBinary({root:appRoot,dataRoot}),grok:resolveGrokBinary()};
  const clis=await Promise.all(EXTERNAL_CLI_PROVIDERS.map(item=>externalCliStatus(item.provider,item.name,binaries[item.provider]).catch(()=>({
    provider:item.provider,name:item.name,current:null,latest:null,updateAvailable:null,managed:false,
    source:"external-cli:not-installed",checkedAt:null,canUpdate:false,checksum:null,management:"external" as const,dependsOn:null,configured:false,
  }))));
  return[...clis,...API_PROVIDERS.map(item=>apiStatus(item.provider,item.name,dataRoot,claude))];
}
