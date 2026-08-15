import fs from"node:fs";
import os from"node:os";
import path from"node:path";
import{runCommand}from"../process.js";
import{isAbsoluteHostPath}from"../platform.js";

export type WindowsProviderId="codex"|"claude";
export type WindowsProviderBinarySource="user-selected"|"previously-verified"|"environment"|"path"|"official-cli"|"official-app-interface";
export type WindowsProviderInterfaceKind="cli"|"app-server";
export type WindowsProviderReadyState="not-found"|"login-required"|"diagnostic-required"|"ready";
export type WindowsProviderBinaryRecord={
  selectedPath:string|null;
  verifiedPath:string|null;
  source:WindowsProviderBinarySource|null;
  interfaceKind:WindowsProviderInterfaceKind|null;
  version:string|null;
  verifiedAt:string|null;
  lastError:string|null;
};
export type WindowsProviderDiscovery={
  provider:WindowsProviderId;
  platform:"win32";
  presenceDetected:boolean;
  runtimeAvailable:boolean;
  officialAppDetected:boolean;
  appInterfaceAvailable:boolean;
  binaryPath:string|null;
  source:WindowsProviderBinarySource|null;
  interfaceKind:WindowsProviderInterfaceKind|null;
  version:string|null;
  checkedAt:string;
  errorCategory:string|null;
};

type FileInfo={regular:boolean;reparse:boolean;realPath:string};
type ProbeResult={exitCode:number;stdout:string;stderr:string;timedOut?:boolean};
export type WindowsProviderDiscoveryDependencies={
  environment?:NodeJS.ProcessEnv;
  homeDir?:string;
  fileInfo?:(file:string)=>FileInfo|null;
  run?:(file:string,args:string[])=>Promise<ProbeResult>;
  where?:(name:string)=>Promise<string[]>;
  now?:()=>string;
};

const emptyRecord=():WindowsProviderBinaryRecord=>({selectedPath:null,verifiedPath:null,source:null,interfaceKind:null,version:null,verifiedAt:null,lastError:null});
export function normalizeWindowsProviderBinaryRecord(value:unknown):WindowsProviderBinaryRecord{
  if(!value||typeof value!=="object")return emptyRecord();
  const item=value as Record<string,unknown>;
  return{
    selectedPath:typeof item.selectedPath==="string"?item.selectedPath:null,
    verifiedPath:typeof item.verifiedPath==="string"?item.verifiedPath:null,
    source:["user-selected","previously-verified","environment","path","official-cli","official-app-interface"].includes(String(item.source))?item.source as WindowsProviderBinarySource:null,
    interfaceKind:item.interfaceKind==="cli"||item.interfaceKind==="app-server"?item.interfaceKind:null,
    version:typeof item.version==="string"?item.version:null,
    verifiedAt:typeof item.verifiedAt==="string"?item.verifiedAt:null,
    lastError:typeof item.lastError==="string"?item.lastError:null
  };
}

/** `reparse` means the candidate *itself* is a reparse point, which is the
 * redirectable target the selection rules reject. An ancestor directory being
 * a junction is not: a relocated Workhouse data root, a redirected user
 * profile and a mapped install directory are all ordinary Windows layouts, and
 * treating them as reparse points made every managed provider binary report
 * `runtime-unavailable` while the executable was present and runnable. The
 * physical path is resolved either way and `binaryPath` is always the resolved
 * one, so nothing downstream executes through the link. */
export function windowsProviderFileInfo(file:string):FileInfo|null{
  try{
    const stat=fs.lstatSync(file);
    if(!stat.isFile())return null;
    const realPath=fs.realpathSync.native(file);
    // Resolve the directory separately so only a redirected *leaf* — a file
    // symlink or a Windows AppExecLink alias — counts as a reparse point.
    const leaf=path.join(fs.realpathSync.native(path.dirname(file)),path.basename(file));
    return{regular:true,reparse:stat.isSymbolicLink()||path.normalize(realPath).toLowerCase()!==path.normalize(leaf).toLowerCase(),realPath};
  }catch{return null;}
}
const defaultFileInfo=windowsProviderFileInfo;
async function defaultRun(file:string,args:string[]){
  return runCommand(file,args,{cwd:path.win32.dirname(file),timeoutMs:15_000,outputLimit:64*1024});
}
async function defaultWhere(name:string){
  const result=await runCommand("where.exe",[name],{cwd:process.env.SystemRoot?.trim()||process.cwd(),timeoutMs:10_000,outputLimit:64*1024}).catch(()=>null);
  return result?.exitCode===0?result.stdout.split(/\r?\n/).map(item=>item.trim()).filter(Boolean):[];
}

const expectedName=(provider:WindowsProviderId)=>`${provider}.exe`;
function validCandidatePath(provider:WindowsProviderId,file:string){
  if(!isAbsoluteHostPath(file,"win32")||!/^[A-Za-z]:[\\/]/.test(file))return false;
  return path.win32.basename(file).toLowerCase()===expectedName(provider);
}
function versionFromOutput(output:string){return output.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/)?.[0]??null;}
function pushCandidate(target:Array<{file:string;source:WindowsProviderBinarySource;kind:WindowsProviderInterfaceKind}>,seen:Set<string>,file:string|undefined,source:WindowsProviderBinarySource,kind:WindowsProviderInterfaceKind="cli"){
  if(!file)return;const normalized=path.win32.normalize(file.trim()),key=normalized.toLowerCase();if(!seen.has(key)){seen.add(key);target.push({file:normalized,source,kind});}
}
function officialCliCandidates(provider:WindowsProviderId,environment:NodeJS.ProcessEnv,homeDir:string){
  const local=environment.LOCALAPPDATA?.trim()||path.win32.join(homeDir,"AppData","Local");
  return[
    path.win32.join(homeDir,".local","bin",expectedName(provider)),
    path.win32.join(local,"Programs",provider==="claude"?"Claude Code":"OpenAI Codex CLI",expectedName(provider)),
    path.win32.join(local,"Programs",provider==="claude"?"Anthropic":"OpenAI",expectedName(provider))
  ];
}
function officialAppMarkers(provider:WindowsProviderId,environment:NodeJS.ProcessEnv,homeDir:string){
  const local=environment.LOCALAPPDATA?.trim()||path.win32.join(homeDir,"AppData","Local"),name=provider==="claude"?"Claude":"Codex";
  return[path.win32.join(local,"Programs",name,`${name}.exe`),path.win32.join(local,name,`${name}.exe`)];
}
function officialAppInterfaces(provider:WindowsProviderId,environment:NodeJS.ProcessEnv,homeDir:string){
  const local=environment.LOCALAPPDATA?.trim()||path.win32.join(homeDir,"AppData","Local"),name=provider==="claude"?"Claude":"Codex";
  return[
    path.win32.join(local,"Programs",name,"resources","bin",expectedName(provider)),
    path.win32.join(local,name,"resources","bin",expectedName(provider))
  ];
}

export async function discoverWindowsProvider(input:{
  provider:WindowsProviderId;
  record?:unknown;
  selectedPath?:string|null;
  dependencies?:WindowsProviderDiscoveryDependencies;
}):Promise<{discovery:WindowsProviderDiscovery;record:WindowsProviderBinaryRecord}>{
  const dependencies=input.dependencies??{},environment=dependencies.environment??process.env,homeDir=dependencies.homeDir??os.homedir(),fileInfo=dependencies.fileInfo??defaultFileInfo,run=dependencies.run??defaultRun,where=dependencies.where??defaultWhere,checkedAt=(dependencies.now??(()=>new Date().toISOString()))(),previous=normalizeWindowsProviderBinaryRecord(input.record);
  const candidates:Array<{file:string;source:WindowsProviderBinarySource;kind:WindowsProviderInterfaceKind}>=[],seen=new Set<string>();
  const selected=input.selectedPath===undefined?previous.selectedPath:input.selectedPath;
  if(selected)pushCandidate(candidates,seen,selected,"user-selected");
  else{
    pushCandidate(candidates,seen,previous.verifiedPath??undefined,"previously-verified",previous.interfaceKind??"cli");
    pushCandidate(candidates,seen,(input.provider==="codex"?environment.CODEX_BIN:environment.CLAUDE_BIN)?.trim(),"environment");
    for(const file of await where(expectedName(input.provider)))pushCandidate(candidates,seen,file,"path");
    for(const file of officialCliCandidates(input.provider,environment,homeDir))pushCandidate(candidates,seen,file,"official-cli");
    const declaredInterface=(input.provider==="codex"?environment.CLAUDEX_WORKHOUSE_CODEX_APP_INTERFACE:environment.CLAUDEX_WORKHOUSE_CLAUDE_APP_INTERFACE)?.trim();
    pushCandidate(candidates,seen,declaredInterface,"official-app-interface","app-server");
    for(const file of officialAppInterfaces(input.provider,environment,homeDir))pushCandidate(candidates,seen,file,"official-app-interface","app-server");
  }
  const officialAppDetected=officialAppMarkers(input.provider,environment,homeDir).some(file=>fileInfo(file)?.regular===true);
  let selectedFailure:string|null=null;
  for(const candidate of candidates){
    if(!validCandidatePath(input.provider,candidate.file)){if(candidate.source==="user-selected")selectedFailure="invalid-path";continue;}
    const info=fileInfo(candidate.file);
    if(!info?.regular||info.reparse){if(candidate.source==="user-selected")selectedFailure=info?.reparse?"reparse-point":"not-regular-file";continue;}
    const probe=await run(info.realPath,["--version"]).catch(()=>null),version=probe&&probe.exitCode===0&&!probe.timedOut?versionFromOutput(`${probe.stdout}\n${probe.stderr}`):null;
    if(!version){if(candidate.source==="user-selected")selectedFailure="version-probe-failed";continue;}
    const binaryPath=info.realPath,record:WindowsProviderBinaryRecord={selectedPath:selected??null,verifiedPath:info.realPath,source:candidate.source,interfaceKind:candidate.kind,version,verifiedAt:checkedAt,lastError:null};
    return{record,discovery:{provider:input.provider,platform:"win32",presenceDetected:true,runtimeAvailable:true,officialAppDetected,appInterfaceAvailable:true,binaryPath,source:candidate.source,interfaceKind:candidate.kind,version,checkedAt,errorCategory:null}};
  }
  const errorCategory=selectedFailure??(officialAppDetected?"app-interface-unavailable":"runtime-unavailable");
  return{
    record:{...previous,selectedPath:selected??null,lastError:errorCategory},
    discovery:{provider:input.provider,platform:"win32",presenceDetected:officialAppDetected,runtimeAvailable:false,officialAppDetected,appInterfaceAvailable:false,binaryPath:null,source:null,interfaceKind:null,version:null,checkedAt,errorCategory}
  };
}

export function windowsProviderReadyState(input:{discovery:WindowsProviderDiscovery;accountState:"unavailable"|"disconnected"|"unknown"|"connected";workspaceAccessible:boolean;executionPolicyReady:boolean}):WindowsProviderReadyState{
  if(!input.discovery.appInterfaceAvailable)return input.discovery.officialAppDetected?"diagnostic-required":"not-found";
  if(input.accountState==="disconnected"||input.accountState==="unavailable")return"login-required";
  if(input.accountState!=="connected"||!input.workspaceAccessible||!input.executionPolicyReady)return"diagnostic-required";
  return"ready";
}
