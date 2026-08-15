import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { runCommand, stripAnsi, type CommandResult } from "./process.js";
import { sanitizeSensitiveText } from "./sensitive-data.js";
import { PROTON_PATH_AMBIGUOUS, protonDirectoryEntries, resolveProtonPath } from "./proton-drive-path.js";

const OUTPUT_LIMIT=64*1024;
const LOGIN_LIMIT=32*1024;
const SAFE_LOGIN_HOSTS=new Set(["proton.me","account.proton.me"]);

export type ProtonCliState="ready"|"not-installed"|"incompatible"|"unavailable";
export type ProtonCliStatus={state:ProtonCliState;binary:string|null;version:string|null;detail:string|null};
export type ProtonLoginAttempt={id:string;status:"running"|"completed"|"failed"|"cancelled"|"timeout";createdAt:string;finishedAt:string|null;loginUrl:string|null;output:string;exitCode:number|null};

function safeText(value:string){return sanitizeSensitiveText(stripAnsi(value)).replace(/(access[_ -]?token|refresh[_ -]?token|authorization|password|session)\s*[:=]\s*\S+/gi,"$1=[REDACTED]").slice(-LOGIN_LIMIT);}
function safeLoginUrl(value:string){
  for(const match of value.matchAll(/https:\/\/[^\s<>"']+/gi))try{const url=new URL(match[0].replace(/[),.;]+$/g,""));if(SAFE_LOGIN_HOSTS.has(url.hostname.toLowerCase()))return url.toString();}catch{}
  return null;
}
function executable(candidate:string){try{fs.accessSync(candidate,fs.constants.X_OK);return candidate;}catch{return null;}}
export function escapeProtonLocalGlobPath(value:string){return value.replace(/[*?[\]{}]/g,"\\$&");}

function protonDriveEnvironment(roots:{appRoot:string;dataRoot:string}){
  const dataDir=path.join(roots.dataRoot,"data","proton-drive"),runtimeBin=path.join(roots.dataRoot,"runtime","bin");
  const env:NodeJS.ProcessEnv={...process.env,PATH:[runtimeBin,process.env.PATH].filter(Boolean).join(path.delimiter),PROTON_DRIVE_CACHE_DIR:dataDir,PROTON_DRIVE_LOG_LEVEL:"ERROR"};
  const managedPass=process.platform!=="win32"?executable(path.join(runtimeBin,"pass")):null;
  if(managedPass){
    env.PROTON_DRIVE_CREDENTIALS_STORE="pass";
    env.PASSWORD_STORE_DIR=path.join(dataDir,"password-store");
    env.GNUPGHOME=path.join(dataDir,"gnupg");
  }
  return env;
}

export function resolveProtonDriveBinary(input:{appRoot:string;dataRoot:string}){
  const configured=process.env.CLAUDEX_WORKHOUSE_PROTON_BIN?.trim();
  if(configured)return executable(path.isAbsolute(configured)?configured:path.resolve(input.dataRoot,configured))??configured;
  const managed=executable(path.join(input.dataRoot,"runtime","bin",process.platform==="win32"?"proton-drive.exe":"proton-drive"));
  if(managed)return managed;
  for(const directory of(process.env.PATH??"").split(path.delimiter).filter(Boolean)){const found=executable(path.join(directory,process.platform==="win32"?"proton-drive.exe":"proton-drive"));if(found)return found;}
  return null;
}

function resultError(result:CommandResult){return safeText(result.stderr||result.stdout).trim().slice(0,1000);}

export class ProtonDriveCli{
  readonly binary:string|null;
  constructor(private roots:{appRoot:string;dataRoot:string},binary?:string|null){this.binary=binary===undefined?resolveProtonDriveBinary(roots):binary;}
  private async run(args:string[],timeoutMs=30_000){
    if(!this.binary)throw Object.assign(new Error("Proton Drive CLI is not installed."),{statusCode:409,code:"PROTON_CLI_NOT_INSTALLED"});
    let result:CommandResult;
    try{result=await runCommand(this.binary,args,{cwd:this.roots.appRoot,timeoutMs,outputLimit:OUTPUT_LIMIT,env:protonDriveEnvironment(this.roots)});}
    catch(error){throw Object.assign(new Error("Proton Drive CLI could not start."),{statusCode:409,code:"PROTON_CLI_NOT_INSTALLED",cause:error});}
    if(result.timedOut)throw Object.assign(new Error("Proton Drive CLI timed out."),{statusCode:504,code:"PROTON_CLI_TIMEOUT"});
    return result;
  }
  async status():Promise<ProtonCliStatus>{
    if(!this.binary)return{state:"not-installed",binary:null,version:null,detail:null};
    try{
      const result=await this.run(["version"],10_000),detail=resultError(result);
      if(result.exitCode!==0)return{state:result.signal==="SIGILL"||result.exitCode===132?"incompatible":"unavailable",binary:this.binary,version:null,detail:detail||`exit ${result.exitCode}`};
      return{state:"ready",binary:this.binary,version:safeText(result.stdout).trim().slice(0,200)||null,detail:null};
    }catch(error){return{state:"unavailable",binary:this.binary,version:null,detail:error instanceof Error?error.message:String(error)};}
  }
  async connection(remoteRoot="/my-files"){
    const status=await this.status();if(status.state!=="ready")return{...status,connected:false};
    const result=await this.run(["filesystem","list",remoteRoot,"--json"],30_000);
    return{...status,connected:result.exitCode===0,detail:result.exitCode===0?null:resultError(result)||"Authentication is required."};
  }
  async logout(){const result=await this.run(["auth","logout"],30_000);if(result.exitCode!==0)throw Object.assign(new Error(resultError(result)||"Proton Drive logout failed."),{statusCode:409,code:"PROTON_LOGOUT_FAILED"});return{loggedOut:true};}
  private async rawList(remotePath:string){
    const result=await this.run(["filesystem","list",remotePath,"--json"],60_000);
    if(result.exitCode!==0)throw Object.assign(new Error(resultError(result)||"Proton Drive listing failed."),{statusCode:502,code:"PROTON_VERIFY_FAILED"});
    let value:unknown=null;try{value=JSON.parse(result.stdout);}catch{}
    return{value,output:safeText(result.stdout).trim().slice(0,4000)};
  }
  // Proton keeps the spelling a folder was created with and the CLI matches it
  // literally, so a path that differs only by letter case or Unicode
  // composition fails even though it names the same place. Resolve it onto the
  // spelling that exists rather than making every caller guess.
  private async canonicalPath(remotePath:string,{probeExists=false}={}){
    return resolveProtonPath(remotePath,{
      ...(probeExists?{exists:async(candidate:string)=>{try{await this.rawList(candidate);return true;}catch{return false;}}}:{}),
      listDirectory:async(directory:string)=>protonDirectoryEntries((await this.rawList(directory)).value)
    });
  }
  async upload(source:string,remoteDirectory:string,timeoutMs=60*60_000){
    const target=(await this.canonicalPath(remoteDirectory,{probeExists:true}).catch(error=>{
      if((error as{code?:string})?.code===PROTON_PATH_AMBIGUOUS)throw error;
      return null;
    }))?.path??remoteDirectory;
    const result=await this.run(["filesystem","upload",escapeProtonLocalGlobPath(source),target,"--conflict-strategy","skip","--json"],timeoutMs);
    if(result.exitCode!==0)throw Object.assign(new Error(resultError(result)||"Proton Drive upload failed."),{statusCode:502,code:"PROTON_UPLOAD_FAILED"});
    let value:unknown=null;try{value=JSON.parse(result.stdout);}catch{}
    return{value,output:safeText(result.stdout).trim().slice(0,4000)};
  }
  // Only a failed literal lookup pays for resolution, so a correct path keeps
  // costing exactly one call.
  async list(remotePath:string){
    try{return await this.rawList(remotePath);}
    catch(error){
      const canonical=await this.canonicalPath(remotePath);
      if(!canonical.corrected)throw error;
      return this.rawList(canonical.path);
    }
  }
  // `filesystem download path... localFolder` writes the remote file into a
  // directory under its own name, so the caller owns an empty staging folder and
  // reads back whatever landed there.
  async download(remotePath:string,localFolder:string,timeoutMs=60*60_000){
    const canonical=(await this.canonicalPath(remotePath).catch(error=>{
      if((error as{code?:string})?.code===PROTON_PATH_AMBIGUOUS)throw error;
      return null;
    }))?.path??remotePath;
    const result=await this.run(["filesystem","download","--conflict-strategy","replace",canonical,localFolder],timeoutMs);
    if(result.exitCode!==0)throw Object.assign(new Error(resultError(result)||"Proton Drive download failed."),{statusCode:502,code:"PROTON_DOWNLOAD_FAILED"});
    return{remotePath:canonical,output:safeText(result.stdout).trim().slice(0,4000)};
  }
  async entries(remotePath:string){return protonDirectoryEntries((await this.list(remotePath)).value);}
  private async rawInfo(remotePath:string){
    const result=await this.run(["filesystem","info",remotePath,"--json"],60_000);
    if(result.exitCode!==0)throw Object.assign(new Error(resultError(result)||"Proton Drive verification failed."),{statusCode:502,code:"PROTON_VERIFY_FAILED"});
    let value:unknown=null;try{value=JSON.parse(result.stdout);}catch{}
    return{value,output:safeText(result.stdout).trim().slice(0,4000)};
  }
  async info(remotePath:string){
    try{return await this.rawInfo(remotePath);}
    catch(error){
      const canonical=await this.canonicalPath(remotePath);
      if(!canonical.corrected)throw error;
      return this.rawInfo(canonical.path);
    }
  }
}

type InternalAttempt=ProtonLoginAttempt&{child:ChildProcess};
export class ProtonDriveLoginManager{
  private attempts=new Map<string,InternalAttempt>();
  constructor(private cli:ProtonDriveCli,private roots:{appRoot:string;dataRoot:string}){}
  start(id:string){
    for(const attempt of this.attempts.values())if(attempt.status==="running")return this.public(attempt);
    if(!this.cli.binary)throw Object.assign(new Error("Proton Drive CLI is not installed."),{statusCode:409,code:"PROTON_CLI_NOT_INSTALLED"});
    const createdAt=new Date().toISOString(),child=spawn(this.cli.binary,["auth","login"],{cwd:this.roots.appRoot,shell:false,windowsHide:true,env:{...protonDriveEnvironment(this.roots),BROWSER:"echo"},stdio:["ignore","pipe","pipe"]});
    const attempt:InternalAttempt={id,child,status:"running",createdAt,finishedAt:null,loginUrl:null,output:"",exitCode:null};this.attempts.set(id,attempt);
    const append=(chunk:Buffer)=>{attempt.output=safeText(`${attempt.output}${chunk.toString("utf8")}`);attempt.loginUrl??=safeLoginUrl(attempt.output);};child.stdout?.on("data",append);child.stderr?.on("data",append);
    child.once("error",error=>{attempt.status="failed";attempt.finishedAt=new Date().toISOString();attempt.output=safeText(error.message);});
    child.once("close",code=>{if(attempt.status!=="running")return;attempt.exitCode=code;attempt.status=code===0?"completed":"failed";attempt.finishedAt=new Date().toISOString();});
    const timer=setTimeout(()=>{if(attempt.status!=="running")return;attempt.status="timeout";attempt.finishedAt=new Date().toISOString();child.kill("SIGTERM");},10*60_000);timer.unref();child.once("close",()=>clearTimeout(timer));return this.public(attempt);
  }
  get(id:string){const attempt=this.attempts.get(id);return attempt?this.public(attempt):null;}
  cancel(id:string){const attempt=this.attempts.get(id);if(!attempt)return null;if(attempt.status==="running"){attempt.status="cancelled";attempt.finishedAt=new Date().toISOString();attempt.child.kill("SIGTERM");}return this.public(attempt);}
  close(){for(const attempt of this.attempts.values())if(attempt.status==="running")attempt.child.kill("SIGTERM");}
  private public(attempt:InternalAttempt):ProtonLoginAttempt{const{child:_,...value}=attempt;return value;}
}
