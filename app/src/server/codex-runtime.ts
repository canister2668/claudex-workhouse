import fs from "node:fs";
import path from "node:path";
import process from "node:process";

/**
 * `checksumSource` says what `checksum` is the digest *of*: the upstream
 * package archive an install downloaded, or the binary itself when the state
 * file was rebuilt offline from a release already on disk. The two are not
 * comparable, so nothing may present one as the other.
 */
export type ManagedCodexRuntime={binary:string;version:string|null;checksum:string|null;checksumSource:"package"|"binary"|null;source:"openai-standalone"|"workhouse-legacy"};

const pathApi=(platform:NodeJS.Platform)=>(platform==="win32"?path.win32:path.posix);
const regularFile=(file:string)=>{try{const stat=fs.lstatSync(file);return stat.isFile()&&!stat.isSymbolicLink();}catch{return false;}};
const regularDirectory=(directory:string)=>{try{const stat=fs.lstatSync(directory);return stat.isDirectory()&&!stat.isSymbolicLink();}catch{return false;}};
const regularDescendants=(root:string,directory:string,api:path.PlatformPath)=>{const relative=api.relative(root,directory);if(relative.startsWith("..")||api.isAbsolute(relative))return false;let current=root;for(const part of relative.split(api.sep).filter(Boolean)){current=api.join(current,part);if(!regularDirectory(current))return false;}return true;};

/**
 * Distinguishes "no managed runtime was ever installed" from "a managed
 * runtime is recorded but its state no longer describes a usable binary".
 * Collapsing the two into `null` is what let a damaged managed installation
 * degrade quietly into whichever `codex` happened to be reachable, so a user
 * who had updated the managed runtime could still be running an older global
 * npm build without any indication that had happened.
 */
export type ManagedCodexRuntimeState=
  |{status:"ok";runtime:ManagedCodexRuntime}
  |{status:"absent"}
  |{status:"corrupt";reason:string};

export function managedCodexRuntimeState(dataRoot:string,platform:NodeJS.Platform=process.platform):ManagedCodexRuntimeState{
  const api=pathApi(platform),runtimeRoot=api.join(dataRoot,"runtime"),stateFile=api.join(runtimeRoot,"codex-runtime.json");
  let state:any=null,recorded=false;
  try{state=JSON.parse(fs.readFileSync(stateFile,"utf8"));recorded=true;}
  catch(error:any){if(error?.code!=="ENOENT")return{status:"corrupt",reason:"The Codex runtime state file could not be read."};}
  if(recorded){
    if(state?.schema!==1||state?.source!=="openai-standalone"||typeof state.version!=="string"||!/^[0-9]+\.[0-9]+\.[0-9]+(?:-(?:alpha|beta)(?:\.[0-9]+){0,2})?$/.test(state.version)||typeof state.binary!=="string"||typeof state.sha256!=="string"||!/^[a-f0-9]{64}$/.test(state.sha256))return{status:"corrupt",reason:"The Codex runtime state file is not a valid managed runtime record."};
    const relative=state.binary.replaceAll("/",api.sep);
    if(api.isAbsolute(relative)||relative.split(api.sep).includes(".."))return{status:"corrupt",reason:"The Codex runtime state file records an unsafe binary path."};
    const binary=api.resolve(dataRoot,relative),releasesRoot=api.resolve(runtimeRoot,"codex-home","packages","standalone","releases");
    if(!binary.toLowerCase().startsWith(`${releasesRoot.toLowerCase()}${api.sep}`)||api.basename(binary).toLowerCase()!==(platform==="win32"?"codex.exe":"codex")||!regularDescendants(releasesRoot,api.dirname(binary),api))return{status:"corrupt",reason:"The Codex runtime state file points outside the managed release directory."};
    if(!regularFile(binary))return{status:"corrupt",reason:`The managed Codex ${state.version} binary recorded in the runtime state file is missing.`};
    return{status:"ok",runtime:{binary,version:state.version,checksum:state.sha256,checksumSource:state.digestSource==="binary"?"binary":"package",source:"openai-standalone"}};
  }
  const legacy=api.join(runtimeRoot,"codex-bin",platform==="win32"?"codex.exe":"codex");
  if(regularDirectory(api.dirname(legacy))&&regularFile(legacy))return{status:"ok",runtime:{binary:legacy,version:null,checksum:null,checksumSource:null,source:"workhouse-legacy"}};
  return{status:"absent"};
}

export function managedCodexRuntime(dataRoot:string,platform:NodeJS.Platform=process.platform):ManagedCodexRuntime|null{
  const state=managedCodexRuntimeState(dataRoot,platform);
  return state.status==="ok"?state.runtime:null;
}

/**
 * The reason a recorded managed runtime is unusable, or null when there is
 * nothing wrong with it. Every path that is about to launch Codex asks this
 * first: `managedCodexBinary()` answers a path even when the state is corrupt,
 * and launching that path turns a diagnosable installation fault into an
 * ENOENT from a child process.
 */
export function managedCodexRuntimeFault(dataRoot:string,platform:NodeJS.Platform=process.platform):string|null{
  const state=managedCodexRuntimeState(dataRoot,platform);
  return state.status==="corrupt"?state.reason:null;
}

export function managedCodexBinary(dataRoot:string,platform:NodeJS.Platform=process.platform){
  return managedCodexRuntime(dataRoot,platform)?.binary??pathApi(platform).join(dataRoot,"runtime","codex-bin",platform==="win32"?"codex.exe":"codex");
}
