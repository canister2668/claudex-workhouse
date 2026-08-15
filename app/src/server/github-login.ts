import crypto from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { runCommand, type CommandResult } from "./process.js";

type Attempt={id:string;child:ChildProcess;createdAt:number;status:"running"|"completed"|"failed";output:string;exitCode:number|null};
export type GitHubTokenConnection={username:string;name:string|null;protocol:"https"|"ssh"};
const LIMIT=32*1024;
const GITHUB_USERNAME=/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const PERSONAL_ACCESS_TOKEN=/^(?:ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})$/;
export function sanitizedGitHubAuthText(value:string){return value.replace(/\b(?:gh[a-z]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,})\b/gi,"[REDACTED]").replace(/(token|authorization|password)\s*[:=]\s*\S+/gi,"$1=[REDACTED]");}
function githubCliEnv(token?:string){
  const env={...process.env};
  for(const key of ["GH_TOKEN","GITHUB_TOKEN","GH_ENTERPRISE_TOKEN","GITHUB_ENTERPRISE_TOKEN"])delete env[key];
  env.GH_PROMPT_DISABLED="1";
  if(token)env.GH_TOKEN=token;
  return env;
}
function githubCliBinary(){return process.env.CLAUDEX_WORKHOUSE_GH_BIN??"gh";}
function authFailure(message:string,code:string,statusCode:number,result?:CommandResult){
  const detail=result?sanitizedGitHubAuthText(result.stderr||result.stdout).trim().slice(0,1000):"";
  return Object.assign(new Error(detail||message),{code,statusCode});
}
function parseAccount(result:CommandResult){
  if(result.exitCode!==0)throw authFailure("GitHub token is invalid or cannot read the account.","GITHUB_TOKEN_INVALID",401,result);
  try{
    const parsed=JSON.parse(result.stdout);
    if(typeof parsed?.login!=="string"||!GITHUB_USERNAME.test(parsed.login))throw new Error("invalid login");
    return{username:parsed.login,name:typeof parsed.name==="string"&&parsed.name.trim()?parsed.name:null};
  }catch{throw authFailure("GitHub returned an invalid account response.","GITHUB_ACCOUNT_RESPONSE_INVALID",502);}
}

export class GitHubLoginManager{
  private attempts=new Map<string,Attempt>();
  private tokenBusy=false;
  start(cwd:string,protocol:"https"|"ssh"="https"){
    for(const attempt of this.attempts.values())if(attempt.status==="running")return this.public(attempt);
    const id=crypto.randomUUID(),child=spawn(githubCliBinary(),["auth","login","--hostname","github.com","--git-protocol",protocol,"--web",...(protocol==="https"?["--skip-ssh-key"]:[])],{cwd,shell:false,windowsHide:true,env:{...process.env,GH_PROMPT_DISABLED:"1",BROWSER:"echo"},stdio:["ignore","pipe","pipe"]});
    const attempt:Attempt={id,child,createdAt:Date.now(),status:"running",output:"",exitCode:null};this.attempts.set(id,attempt);
    const append=(chunk:Buffer)=>{attempt.output=sanitizedGitHubAuthText(`${attempt.output}${chunk.toString("utf8")}`).slice(-LIMIT);};child.stdout?.on("data",append);child.stderr?.on("data",append);child.once("error",error=>{attempt.status="failed";attempt.output=sanitizedGitHubAuthText(error.message);});child.once("close",code=>{attempt.exitCode=code;attempt.status=code===0?"completed":"failed";});
    setTimeout(()=>{if(attempt.status==="running"){attempt.status="failed";attempt.output="GitHub login timed out.";child.kill("SIGTERM");}},10*60_000).unref();this.cleanup();return this.public(attempt);
  }
  get(id:string){const attempt=this.attempts.get(id);return attempt?this.public(attempt):null;}
  async connectToken(cwd:string,input:{token:string;username:string;protocol:"https"|"ssh"}):Promise<GitHubTokenConnection>{
    if(this.tokenBusy)throw Object.assign(new Error("Another GitHub token connection is already running."),{statusCode:409,code:"GITHUB_TOKEN_CONNECT_BUSY"});
    const token=input.token.trim(),expected=input.username.trim();
    if(!GITHUB_USERNAME.test(expected))throw Object.assign(new Error("Enter a valid GitHub username."),{statusCode:400,code:"GITHUB_USERNAME_INVALID"});
    if(token.length>1024||!PERSONAL_ACCESS_TOKEN.test(token))throw Object.assign(new Error("Enter a valid GitHub personal access token."),{statusCode:400,code:"GITHUB_TOKEN_INVALID_FORMAT"});
    this.tokenBusy=true;
    try{
      let probe:CommandResult;
      try{probe=await runCommand(githubCliBinary(),["api","user","--jq","{login: .login, name: .name}"],{cwd,timeoutMs:20_000,outputLimit:64*1024,env:githubCliEnv(token)});}
      catch{throw authFailure("GitHub CLI is not installed on this host.","GITHUB_CLI_NOT_INSTALLED",409);}
      const account=parseAccount(probe);
      if(account.username.toLowerCase()!==expected.toLowerCase())throw Object.assign(new Error(`The token belongs to ${account.username}, not ${expected}.`),{statusCode:409,code:"GITHUB_ACCOUNT_MISMATCH"});
      let login:CommandResult;
      try{login=await runCommand(githubCliBinary(),["auth","login","--hostname","github.com","--git-protocol",input.protocol,"--with-token",...(input.protocol==="https"?["--skip-ssh-key"]:[])],{cwd,timeoutMs:60_000,outputLimit:64*1024,env:githubCliEnv(),input:`${token}\n`});}
      catch{throw authFailure("GitHub CLI could not start token authentication.","GITHUB_CLI_NOT_INSTALLED",409);}
      if(login.exitCode!==0)throw authFailure("GitHub CLI could not store the token on this host.","GITHUB_TOKEN_STORE_FAILED",409,login);
      const switched=await runCommand(githubCliBinary(),["auth","switch","--hostname","github.com","--user",account.username],{cwd,timeoutMs:15_000,outputLimit:64*1024,env:githubCliEnv()}).catch(()=>null);
      if(!switched||switched.exitCode!==0)throw authFailure("GitHub CLI stored the account but could not make it active.","GITHUB_ACCOUNT_SWITCH_FAILED",409,switched??undefined);
      const verified=await runCommand(githubCliBinary(),["api","user","--jq","{login: .login, name: .name}"],{cwd,timeoutMs:20_000,outputLimit:64*1024,env:githubCliEnv()}).catch(()=>null);
      if(!verified)throw authFailure("GitHub CLI could not verify the stored account.","GITHUB_TOKEN_VERIFY_FAILED",409);
      const active=parseAccount(verified);
      if(active.username.toLowerCase()!==account.username.toLowerCase())throw Object.assign(new Error("GitHub CLI activated a different account than the verified token."),{statusCode:409,code:"GITHUB_ACCOUNT_SWITCH_FAILED"});
      return{...active,protocol:input.protocol};
    }finally{this.tokenBusy=false;}
  }
  private public(attempt:Attempt){return{id:attempt.id,status:attempt.status,output:attempt.output,exitCode:attempt.exitCode,createdAt:new Date(attempt.createdAt).toISOString()};}
  private cleanup(){const cutoff=Date.now()-60*60_000;for(const[id,attempt]of this.attempts)if(attempt.createdAt<cutoff&&attempt.status!=="running")this.attempts.delete(id);}
  close(){for(const attempt of this.attempts.values())if(attempt.status==="running")attempt.child.kill("SIGTERM");this.attempts.clear();}
}
