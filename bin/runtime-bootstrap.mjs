#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFile } from "node:child_process";

const legacyRoot=process.env.CLAUDEX_WORKHOUSE_ROOT??path.resolve(new URL("..",import.meta.url).pathname);
const appRoot=process.env.CLAUDEX_WORKHOUSE_APP_ROOT??legacyRoot,dataRoot=process.env.CLAUDEX_WORKHOUSE_DATA_ROOT??legacyRoot;
const executable=(file)=>{try{fs.accessSync(file,fs.constants.X_OK);return true;}catch{return false;}};
const run=(file,args)=>new Promise((resolve,reject)=>execFile(file,args,{cwd:appRoot,env:{...process.env,CLAUDEX_WORKHOUSE_ROOT:dataRoot,CLAUDEX_WORKHOUSE_APP_ROOT:appRoot,CLAUDEX_WORKHOUSE_DATA_ROOT:dataRoot},timeout:600000,maxBuffer:2*1024*1024,windowsHide:true},(error,stdout,stderr)=>error?reject(new Error(String(stderr||error.message).trim().slice(-2000))):resolve(String(stdout).trim())));

async function ensure(name,override,managed,script,alwaysVerify=false){
  if(override){
    if(!executable(override))throw new Error(`${name} override is not executable: ${override}`);
    return{provider:name,changed:false,source:"environment"};
  }
  if(executable(managed)&&!alwaysVerify)return{provider:name,changed:false,source:"managed"};
  const output=await run(process.execPath,[script,"ensure"]);
  const result=JSON.parse(output);
  return{provider:name,changed:Boolean(result.changed),source:result.changed?"official-installer":"managed",result};
}

const results=[];
results.push(await ensure("claude",process.env.CLAUDEX_WORKHOUSE_CLAUDE_BIN,path.join(dataRoot,"runtime","claude-bin",process.platform==="win32"?"claude.exe":"claude"),path.join(appRoot,"bin","claude-runtime.mjs")));
results.push(await ensure("codex",process.env.CLAUDEX_WORKHOUSE_CODEX_BIN,path.join(dataRoot,"runtime","codex-bin",process.platform==="win32"?"codex.exe":"codex"),path.join(appRoot,"bin","codex-runtime.mjs"),true));
console.log(JSON.stringify({ok:true,runtimes:results}));
