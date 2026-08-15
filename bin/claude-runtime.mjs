#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFile } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

const root=process.env.CLAUDEX_WORKHOUSE_ROOT??path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const runtimeDir=path.join(root,"runtime","claude-bin");
const binary=path.join(runtimeDir,process.platform==="win32"?"claude.exe":"claude");
const stateFile=path.join(runtimeDir,"claude-runtime.json");
const lockFile=path.join(runtimeDir,".claude-update.lock");
const backupDir=path.join(root,"backups","claude-runtime");
const base="https://downloads.claude.ai/claude-code-releases";
const command=process.argv[2]??"status";
const target=process.argv[3]??"latest";

const json=(value)=>`${JSON.stringify(value,null,2)}\n`;
const validTarget=(value)=>/^(latest|stable|\d+\.\d+\.\d+(?:-[^\s/]+)?)$/.test(value);
const sha256=async(file)=>new Promise((resolve,reject)=>{const hash=crypto.createHash("sha256");const stream=fs.createReadStream(file);stream.on("error",reject);stream.on("data",chunk=>hash.update(chunk));stream.on("end",()=>resolve(hash.digest("hex")));});
const run=(file,args,timeout=15000)=>new Promise((resolve,reject)=>execFile(file,args,{timeout,maxBuffer:1024*1024,windowsHide:true,env:{...process.env,DISABLE_AUTOUPDATER:"1"}},(error,stdout,stderr)=>error?reject(Object.assign(error,{stdout,stderr})):resolve({stdout:String(stdout).trim(),stderr:String(stderr).trim()})));
const fetchResponse=async(url)=>{const response=await fetch(url,{redirect:"follow",signal:AbortSignal.timeout(300000),headers:{"User-Agent":"Claudex-Workhouse-Claude-Runtime/1"}});if(!response.ok)throw new Error(`Download failed (${response.status}): ${url}`);return response;};
const fetchText=async(url)=>(await fetchResponse(url)).text();
const fetchJson=async(url)=>JSON.parse(await fetchText(url));
const currentVersion=async(file=binary)=>{const result=await run(file,["--version"]);const match=result.stdout.match(/\d+\.\d+\.\d+(?:-[^\s]+)?/);if(!match)throw new Error(`Unexpected Claude version output: ${result.stdout}`);return match[0];};
const writeState=(value)=>{const temporary=`${stateFile}.${process.pid}.tmp`;fs.writeFileSync(temporary,json(value),{mode:0o600});fs.chmodSync(temporary,0o600);fs.renameSync(temporary,stateFile);fs.chmodSync(stateFile,0o600);};
const readState=()=>{try{return JSON.parse(fs.readFileSync(stateFile,"utf8"));}catch{return null;}};
const timestamp=()=>new Date().toISOString().replaceAll(":","-");

function platform(){
  const os=process.platform==="darwin"?"darwin":process.platform==="linux"?"linux":process.platform==="win32"?"win32":null;
  const arch=process.arch==="x64"?"x64":process.arch==="arm64"?"arm64":null;
  if(!os||!arch)throw new Error(`Unsupported platform: ${process.platform}-${process.arch}`);
  if(os==="linux"){
    const report=process.report?.getReport?.();
    const glibc=report&&typeof report==="object"&&"header" in report?report.header?.glibcVersionRuntime:null;
    const musl=!glibc||fs.existsSync(`/lib/libc.musl-${arch==="x64"?"x86_64":"aarch64"}.so.1`);
    if(musl)return `${os}-${arch}-musl`;
  }
  return `${os}-${arch}`;
}

async function release(requested){
  if(!validTarget(requested))throw new Error("Target must be latest, stable, or an exact version.");
  const version=/^\d/.test(requested)?requested:(await fetchText(`${base}/${requested}`)).trim();
  if(!/^\d+\.\d+\.\d+(?:-[^\s/]+)?$/.test(version))throw new Error(`Invalid release version: ${version}`);
  const manifest=await fetchJson(`${base}/${version}/manifest.json`);
  if(manifest.version!==version)throw new Error("Release manifest version mismatch.");
  const platformId=platform();
  const artifact=manifest.platforms?.[platformId];
  if(!artifact||!/^[a-f0-9]{64}$/.test(artifact.checksum)||!Number.isSafeInteger(artifact.size))throw new Error(`No verified artifact for ${platformId}.`);
  const artifactName=typeof artifact.binary==="string"&&/^[A-Za-z0-9._-]+$/.test(artifact.binary)?artifact.binary:(platformId.startsWith("win32-")?"claude.exe":"claude");
  return{version,platform:platformId,checksum:artifact.checksum,size:artifact.size,commit:manifest.commit??null,buildDate:manifest.buildDate??null,url:`${base}/${version}/${platformId}/${artifactName}`,channel:requested};
}

async function download(info,destination){
  const response=await fetchResponse(info.url);
  if(!response.body)throw new Error("Release response had no body.");
  await pipeline(Readable.fromWeb(response.body),fs.createWriteStream(destination,{mode:0o700,flags:"wx"}));
  const stat=fs.statSync(destination);if(stat.size!==info.size)throw new Error(`Artifact size mismatch: expected ${info.size}, got ${stat.size}`);
  const checksum=await sha256(destination);if(checksum!==info.checksum)throw new Error(`Artifact checksum mismatch: expected ${info.checksum}, got ${checksum}`);
  fs.chmodSync(destination,0o755);
  const version=await currentVersion(destination);if(version!==info.version)throw new Error(`Artifact version mismatch: expected ${info.version}, got ${version}`);
}

async function backupCurrent(){
  if(!fs.existsSync(binary))return null;
  const version=await currentVersion();const checksum=await sha256(binary);
  fs.mkdirSync(backupDir,{recursive:true});
  const destination=path.join(backupDir,`claude-${version}-${checksum.slice(0,12)}-${timestamp()}`);
  fs.copyFileSync(binary,destination,fs.constants.COPYFILE_FICLONE);fs.chmodSync(destination,0o700);
  return{path:destination,version,checksum};
}

function pruneBackups(keep=4){
  let files=[];try{files=fs.readdirSync(backupDir).map(name=>path.join(backupDir,name)).filter(file=>fs.statSync(file).isFile()).sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs);}catch{return;}
  for(const file of files.slice(keep))fs.unlinkSync(file);
}

async function status(){
  const exists=fs.existsSync(binary);const version=exists?await currentVersion().catch(()=>null):null;const checksum=exists?await sha256(binary).catch(()=>null):null;
  console.log(json({ok:Boolean(exists&&version&&checksum),binary:path.relative(root,binary),version,checksum,state:readState()}));
}

async function check(){
  const info=await release(target);const version=fs.existsSync(binary)?await currentVersion().catch(()=>null):null;const checksum=fs.existsSync(binary)?await sha256(binary).catch(()=>null):null;
  console.log(json({ok:true,current:{version,checksum},release:info,upToDate:version===info.version&&checksum===info.checksum}));
}

async function update(){
  fs.mkdirSync(runtimeDir,{recursive:true});
  const info=await release(target);const existingVersion=fs.existsSync(binary)?await currentVersion().catch(()=>null):null;const existingChecksum=fs.existsSync(binary)?await sha256(binary).catch(()=>null):null;
  if(existingVersion===info.version&&existingChecksum===info.checksum){
    const backups=fs.existsSync(backupDir)?fs.readdirSync(backupDir).filter(name=>name.startsWith(`claude-${info.version}-${info.checksum.slice(0,12)}`)):[];
    if(!backups.length)await backupCurrent();
    writeState({version:info.version,checksum:info.checksum,platform:info.platform,channel:info.channel,source:"anthropic-official",commit:info.commit,buildDate:info.buildDate,verifiedAt:new Date().toISOString(),previousVersion:readState()?.version??null});
    pruneBackups();console.log(json({ok:true,changed:false,message:"Current Claude runtime matches the official release manifest.",version:info.version,checksum:info.checksum}));return;
  }
  const temporary=path.join(runtimeDir,`.claude-${info.version}-${crypto.randomUUID()}.tmp`);let backup=null;
  try{
    await download(info,temporary);backup=await backupCurrent();fs.renameSync(temporary,binary);
    try{await currentVersion(binary);}catch(error){if(backup){const restore=`${binary}.rollback-${process.pid}`;fs.copyFileSync(backup.path,restore);fs.chmodSync(restore,0o755);fs.renameSync(restore,binary);}throw error;}
    writeState({version:info.version,checksum:info.checksum,platform:info.platform,channel:info.channel,source:"anthropic-official",commit:info.commit,buildDate:info.buildDate,verifiedAt:new Date().toISOString(),previousVersion:backup?.version??null});
    pruneBackups();console.log(json({ok:true,changed:true,version:info.version,checksum:info.checksum,backup:backup?path.relative(root,backup.path):null}));
  }finally{try{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}catch{}}
}

async function ensure(){
  if(fs.existsSync(binary)){
    const version=await currentVersion();
    console.log(json({ok:true,changed:false,version,message:"Managed Claude runtime is already installed."}));
    return;
  }
  return update();
}

async function rollback(){
  fs.mkdirSync(runtimeDir,{recursive:true});
  let files=[];try{files=fs.readdirSync(backupDir).map(name=>path.join(backupDir,name)).filter(file=>fs.statSync(file).isFile()).sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs);}catch{}
  const requested=process.argv[3];const source=requested?path.resolve(backupDir,requested):files[0];
  if(!source||!source.startsWith(`${backupDir}${path.sep}`)||!fs.existsSync(source))throw new Error("No Claude runtime backup is available.");
  const temporary=path.join(runtimeDir,`.claude-rollback-${crypto.randomUUID()}.tmp`);const current=await backupCurrent();
  try{fs.copyFileSync(source,temporary);fs.chmodSync(temporary,0o755);const version=await currentVersion(temporary);const checksum=await sha256(temporary);fs.renameSync(temporary,binary);writeState({version,checksum,platform:platform(),channel:"rollback",source:"local-backup",verifiedAt:new Date().toISOString(),previousVersion:current?.version??null});pruneBackups();console.log(json({ok:true,version,checksum,restored:path.relative(root,source)}));}finally{try{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}catch{}}
}

async function main(){
  if(command==="status")return status();
  if(command==="check")return check();
  if(command==="ensure")return ensure();
  if(!["update","rollback"].includes(command))throw new Error("Usage: claude-runtime.mjs status|check [latest|stable|VERSION]|ensure|update [latest|stable|VERSION]|rollback [BACKUP]");
  fs.mkdirSync(runtimeDir,{recursive:true});let lock;
  try{lock=fs.openSync(lockFile,"wx",0o600);fs.writeFileSync(lock,`${process.pid}\n`);return command==="update"?await update():await rollback();}
  finally{if(lock!==undefined)fs.closeSync(lock);try{fs.unlinkSync(lockFile);}catch{}}
}

main().catch(error=>{console.error(json({ok:false,error:error instanceof Error?error.message:String(error)}));process.exit(1);});
