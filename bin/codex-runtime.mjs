#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const root=process.env.CLAUDEX_WORKHOUSE_ROOT??path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const binDir=path.join(root,"runtime","codex-bin");
const legacyBinary=path.join(binDir,process.platform==="win32"?"codex.exe":"codex");
const codexHome=path.join(root,"runtime","codex-home");
const releasesDir=path.join(codexHome,"packages","standalone","releases");
const stateFile=path.join(root,"runtime","codex-runtime.json");
const temporaryRoot=path.join(root,"runtime","tmp");
const command=process.argv[2]??"status";
const executable=(file)=>{try{fs.accessSync(file,fs.constants.X_OK);return fs.lstatSync(file).isFile();}catch{return false;}};
const regularDirectory=(directory)=>{try{const stat=fs.lstatSync(directory);return stat.isDirectory()&&!stat.isSymbolicLink();}catch{return false;}};
const run=(file,args,options={})=>new Promise((resolve,reject)=>execFile(file,args,{cwd:options.cwd??root,env:options.env??process.env,timeout:options.timeout??300000,maxBuffer:2*1024*1024,windowsHide:true},(error,stdout,stderr)=>error?reject(new Error(String(stderr||error.message).trim().slice(-2000))):resolve({stdout:String(stdout),stderr:String(stderr)})));
const parsedVersion=(output)=>output.match(/\d+\.\d+\.\d+(?:-(?:alpha|beta)(?:\.\d+){0,2})?/)?.[0]??null;
const validVersion=(value)=>typeof value==="string"&&/^[0-9]+\.[0-9]+\.[0-9]+(?:-(?:alpha|beta)(?:\.\d+){0,2})?$/.test(value);
const validDigest=(value)=>typeof value==="string"&&/^sha256:[a-f0-9]{64}$/i.test(value);
const sha256=(value)=>crypto.createHash("sha256").update(value).digest("hex");

function state(){
  try{
    const value=JSON.parse(fs.readFileSync(stateFile,"utf8"));
    if(value?.schema!==1||value.source!=="openai-standalone"||!validVersion(value.version)||typeof value.binary!=="string"||!/^([a-f0-9]{64})$/.test(value.sha256))return null;
    const binary=path.resolve(root,value.binary),releaseRoot=`${path.resolve(releasesDir)}${path.sep}`;
    if(!binary.startsWith(releaseRoot)||path.basename(binary).toLowerCase()!==(process.platform==="win32"?"codex.exe":"codex")||!regularDirectory(releasesDir)||!executable(binary))return null;
    return{...value,binary};
  }catch{return null;}
}
function legacyManaged(){return regularDirectory(binDir)&&executable(legacyBinary);}
function managedBinary(){return state()?.binary??(legacyManaged()?legacyBinary:null);}
async function version(file=managedBinary()){if(!file||!executable(file))return null;return parsedVersion((await run(file,["--version"],{timeout:15000})).stdout);}

async function download(url,maxBytes){
  const trusted=value=>/^https:\/\/(?:releases\.openai\.com|github\.com)\//.test(value);
  if(!trusted(url))throw new Error("Codex release metadata returned an untrusted download URL.");
  const response=await fetch(url,{redirect:"follow",headers:{"User-Agent":"Claudex-Workhouse-Runtime-Updater/1"},signal:AbortSignal.timeout(5*60_000)});
  if(!response.ok)throw new Error(`Codex release download failed (${response.status}).`);if(!trusted(response.url))throw new Error("Codex release download redirected to an untrusted URL.");
  const length=Number(response.headers.get("content-length")??0);if(length>maxBytes)throw new Error("Codex release payload exceeded the size limit.");
  const value=Buffer.from(await response.arrayBuffer());if(value.length>maxBytes)throw new Error("Codex release payload exceeded the size limit.");return value;
}
function releaseAsset(metadata,name){
  const asset=metadata?.assets?.find(item=>item?.name===name);
  if(!asset||!validDigest(asset.digest)||typeof asset.browser_download_url!=="string")throw new Error(`Codex release metadata did not contain a verified ${name} asset.`);
  return{url:asset.browser_download_url,digest:asset.digest.slice(7).toLowerCase()};
}
function targetPlatform(metadata){
  const arch=process.arch==="arm64"?"aarch64":process.arch==="x64"?"x86_64":null;if(!arch)return null;
  if(process.platform==="win32")return`${arch}-pc-windows-msvc`;
  if(process.platform==="darwin")return`${arch}-apple-darwin`;
  if(process.platform==="linux"){
    const report=process.report?.getReport?.(),glibc=report&&typeof report==="object"&&"header"in report?report.header?.glibcVersionRuntime:null;
    const candidates=glibc?[`${arch}-unknown-linux-gnu`,`${arch}-unknown-linux-musl`]:[`${arch}-unknown-linux-musl`,`${arch}-unknown-linux-gnu`];
    return candidates.find(target=>metadata?.assets?.some(item=>item?.name===`codex-package-${target}.tar.gz`))??null;
  }
  return null;
}
function releaseComplete(directory){
  const executableName=process.platform==="win32"?"codex.exe":"codex",hostName=process.platform==="win32"?"codex-code-mode-host.exe":"codex-code-mode-host",rgName=process.platform==="win32"?"rg.exe":"rg";
  const required=["codex-package.json",path.join("bin",executableName),path.join("bin",hostName),path.join("codex-path",rgName),...(process.platform==="win32"?[path.join("codex-resources","codex-command-runner.exe"),path.join("codex-resources","codex-windows-sandbox-setup.exe")]:[])];
  return required.every(relative=>executable(path.join(directory,relative))||relative==="codex-package.json"&&fs.existsSync(path.join(directory,relative)));
}
function writeState(versionValue,target,digest,binary,digestSource="package"){
  const value={schema:1,source:"openai-standalone",version:versionValue,target,sha256:digest,digestSource,binary:path.relative(root,binary).split(path.sep).join("/"),installedAt:new Date().toISOString()};
  const temporary=`${stateFile}.${process.pid}.${Date.now()}.tmp`;fs.writeFileSync(temporary,`${JSON.stringify(value,null,2)}\n`,{mode:0o600,flag:"wx"});fs.renameSync(temporary,stateFile);
}
function removeInstallerLinks(){
  const current=path.join(codexHome,"packages","standalone","current"),oldVisible=path.join(root,"runtime","bin",process.platform==="win32"?"codex.exe":"codex"),allowed=path.resolve(releasesDir);
  for(const link of[oldVisible,binDir,current])try{
    const stat=fs.lstatSync(link);if(!stat.isSymbolicLink())continue;
    const raw=path.resolve(path.dirname(link),fs.readlinkSync(link)),currentRoot=path.resolve(current);let real=null;try{real=fs.realpathSync(link);}catch{}
    const owned=[raw,real].filter(Boolean).some(value=>value===allowed||value.startsWith(`${allowed}${path.sep}`)||value===currentRoot||value.startsWith(`${currentRoot}${path.sep}`));
    if(!owned)throw new Error(`Refusing to remove an unowned Codex link: ${link}`);
    fs.rmSync(link);
  }catch(error){if(error?.code!=="ENOENT")throw error;}
}
/**
 * Rebuilds the runtime state file from a complete release that is already on
 * disk. `runtime/codex-runtime.json` is the single contract that decides which
 * Codex binary every execution path selects, so losing that one file made a
 * fully installed runtime report `managed=false` and pushed callers toward
 * whatever `codex` happened to be on PATH. Recovering it must not require the
 * network: a portable install with no connectivity still has the release.
 *
 * The recorded digest is the SHA-256 of the recorded binary rather than of the
 * upstream package archive, which is not derivable offline. `digestSource`
 * records which of the two a reader is looking at so the two can never be
 * silently compared as if they were the same value.
 *
 * Recovery writes the state file and nothing else. It deliberately does not
 * run `removeInstallerLinks()`: that cleanup belongs to an install, which has
 * just replaced what the links pointed at, and running it here would let the
 * act of recovering a lost state file delete the `runtime/bin` entry a user's
 * own shell resolves `codex` through.
 */
async function recoverStateFromDisk(){
  if(!regularDirectory(releasesDir))return false;
  const executableName=process.platform==="win32"?"codex.exe":"codex";
  const candidates=fs.readdirSync(releasesDir,{withFileTypes:true})
    .filter(entry=>entry.isDirectory()&&!entry.name.startsWith("."))
    .map(entry=>entry.name)
    .sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}));
  for(const name of candidates){
    const releaseDir=path.join(releasesDir,name),binary=path.join(releaseDir,"bin",executableName);
    if(!releaseComplete(releaseDir))continue;
    const actual=await version(binary).catch(()=>null);
    if(!validVersion(actual))continue;
    // The directory name is `<version>-<target>`; trust the binary for the
    // version and take the target from the remainder of the directory name.
    const target=name.startsWith(`${actual}-`)?name.slice(actual.length+1):null;
    if(!target)continue;
    writeState(actual,target,sha256(fs.readFileSync(binary)),binary,"binary");
    return true;
  }
  return false;
}

async function installStandalone(){
  const response=await fetch("https://releases.openai.com/codex/channels/latest",{headers:{Accept:"application/json","User-Agent":"Claudex-Workhouse-Runtime-Updater/1"},signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error(`Codex release metadata download failed (${response.status}).`);
  const metadata=await response.json(),target=targetPlatform(metadata);if(!target)throw new Error(`Codex release metadata did not support ${process.platform}-${process.arch}.`);
  const versionValue=String(metadata?.tag_name??"").replace(/^rust-v/,"");if(!validVersion(versionValue))throw new Error("Codex release metadata contained an invalid version.");
  const executableName=process.platform==="win32"?"codex.exe":"codex",packageName=`codex-package-${target}.tar.gz`,packageAsset=releaseAsset(metadata,packageName),checksumsAsset=releaseAsset(metadata,"codex-package_SHA256SUMS"),releaseDir=path.join(releasesDir,`${versionValue}-${target}`),binary=path.join(releaseDir,"bin",executableName);
  if(releaseComplete(releaseDir)&&await version(binary)===versionValue){writeState(versionValue,target,packageAsset.digest,binary);removeInstallerLinks();return;}
  const checksums=await download(checksumsAsset.url,2*1024*1024);if(sha256(checksums)!==checksumsAsset.digest)throw new Error("Codex checksum manifest hash did not match release metadata.");
  const escaped=packageName.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),match=checksums.toString("utf8").match(new RegExp(`^\\s*([a-fA-F0-9]{64})\\s+${escaped}\\s*$`,"m"));
  if(!match)throw new Error("Codex checksum manifest did not contain the selected Windows package.");
  const expected=match[1].toLowerCase();if(expected!==packageAsset.digest)throw new Error("Codex package hashes disagreed between release metadata and checksum manifest.");
  const archive=await download(packageAsset.url,600*1024*1024);if(sha256(archive)!==expected)throw new Error("Downloaded Codex package hash did not match the verified release digest.");
  fs.mkdirSync(releasesDir,{recursive:true,mode:0o700});fs.mkdirSync(temporaryRoot,{recursive:true,mode:0o700});
  if(!regularDirectory(releasesDir)||!regularDirectory(temporaryRoot))throw new Error("Codex runtime directories must be regular directories.");
  const archivePath=path.join(temporaryRoot,`.codex-package-${process.pid}-${Date.now()}.tar.gz`),staging=path.join(releasesDir,`.staging-${versionValue}-${process.pid}-${Date.now()}`);
  try{
    fs.writeFileSync(archivePath,archive,{mode:0o600,flag:"wx"});fs.mkdirSync(staging,{mode:0o700});await run(process.platform==="win32"?"tar.exe":"tar",["-xzf",archivePath,"-C",staging],{timeout:10*60_000});
    const stagedBinary=path.join(staging,"bin",executableName);if(!releaseComplete(staging)||await version(stagedBinary)!==versionValue)throw new Error("Downloaded Codex package did not contain a complete, runnable standalone runtime.");
    if(fs.existsSync(releaseDir))fs.renameSync(releaseDir,`${releaseDir}.invalid-${Date.now()}`);fs.renameSync(staging,releaseDir);writeState(versionValue,target,expected,binary);
  }finally{try{fs.unlinkSync(archivePath);}catch{}try{fs.rmSync(staging,{recursive:true,force:true});}catch{}}
  // Remove only obsolete installer-owned junctions. Regular legacy content is
  // preserved for rollback and is never selected once verified state exists.
  removeInstallerLinks();
}
async function install(){await installStandalone();}

if(command==="status")console.log(JSON.stringify({ok:Boolean(managedBinary()),binary:managedBinary()?path.relative(root,managedBinary()):path.relative(root,legacyBinary),runtimeHome:path.relative(root,codexHome),local:Boolean(managedBinary()),version:await version(),checksum:state()?.sha256??null}));
else if(command==="ensure"){
  // Recover the contract from disk before reaching for the network. A complete
  // release with a missing state file is an installed runtime, not an absent
  // one, and treating it as absent is what made `ensure` depend on
  // connectivity and on release metadata it did not need.
  const before=await version();if(state()===null&&!(await recoverStateFromDisk()))await install();const after=await version();
  console.log(JSON.stringify({ok:true,changed:before!==after||before===null,version:after,binary:managedBinary()?path.relative(root,managedBinary()):null,checksum:state()?.sha256??null}));
}else if(command==="update"){
  const before=await version();await install();const after=await version();
  console.log(JSON.stringify({ok:true,changed:before!==after,version:after,previousVersion:before,binary:managedBinary()?path.relative(root,managedBinary()):null,checksum:state()?.sha256??null}));
}else throw new Error("Usage: codex-runtime.mjs status|ensure|update");
