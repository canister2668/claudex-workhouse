// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Claudex Workhouse.

import fs from"node:fs";
import path from"node:path";
import{fileURLToPath}from"node:url";
import{buildWindowsPayloadManifest,verifyWindowsPayload}from"../dist-server/windows/payload.js";
import{buildWindowsSingleExe,WINDOWS_AVATAR_ART_BUDGET_BYTES,WINDOWS_AVATAR_ART_PREFIX,WINDOWS_PROGRAM_BUDGET_BYTES}from"../dist-server/windows/single-exe.js";
import{createPortableZip}from"../dist-server/windows/portable-zip.js";
import crypto from"node:crypto";

const appRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),".."),repoRoot=path.dirname(appRoot),packageJson=JSON.parse(fs.readFileSync(path.join(appRoot,"package.json"),"utf8")),version=String(packageJson.version);
const commitSha=process.env.CLAUDEX_WORKHOUSE_COMMIT_SHA?.trim()||"unknown";
if(commitSha!=="unknown"&&!/^[a-f0-9]{7,64}$/i.test(commitSha))throw new Error("CLAUDEX_WORKHOUSE_COMMIT_SHA must be a hexadecimal commit identifier.");
const nodeSource=process.env.CLAUDEX_WORKHOUSE_WINDOWS_NODE_EXE?.trim(),modulesSource=process.env.CLAUDEX_WORKHOUSE_WINDOWS_NODE_MODULES?.trim(),launcherSource=process.env.CLAUDEX_WORKHOUSE_WINDOWS_LAUNCHER_EXE?.trim();
for(const[name,value]of[["CLAUDEX_WORKHOUSE_WINDOWS_NODE_EXE",nodeSource],["CLAUDEX_WORKHOUSE_WINDOWS_NODE_MODULES",modulesSource],["CLAUDEX_WORKHOUSE_WINDOWS_LAUNCHER_EXE",launcherSource]])if(!value)throw new Error(`${name} is required.`);
for(const[name,file]of[["Windows Node runtime",nodeSource],["Windows launcher",launcherSource]])if(!fs.statSync(path.resolve(file)).isFile())throw new Error(`${name} is not a file.`);
// The ConPTY bridge is built next to the launcher by the same CMake project.
const bridgeSource=path.resolve(process.env.CLAUDEX_WORKHOUSE_WINDOWS_CONPTY_BRIDGE_EXE?.trim()||path.join(path.dirname(path.resolve(launcherSource)),"claudex-conpty-bridge.exe"));
if(!fs.existsSync(bridgeSource)||!fs.statSync(bridgeSource).isFile())throw new Error(`Windows ConPTY bridge is missing: ${bridgeSource}. Build launcher/windows or set CLAUDEX_WORKHOUSE_WINDOWS_CONPTY_BRIDGE_EXE.`);
if(!fs.statSync(path.resolve(modulesSource)).isDirectory())throw new Error("Windows production node_modules is not a directory.");
if(!fs.existsSync(path.join(path.resolve(modulesSource),"better-sqlite3","build","Release","better_sqlite3.node")))throw new Error("Windows production node_modules does not contain the pinned better-sqlite3 native binding.");

const packageRoot=path.join(repoRoot,"packages","claudex-workhouse-server-windows-x64-folder"),payloadRoot=path.join(packageRoot,"payload",version),appPayload=path.join(payloadRoot,"app"),webPayload=path.join(appPayload,"dist");
fs.rmSync(packageRoot,{recursive:true,force:true});fs.mkdirSync(webPayload,{recursive:true});
const copy=(source,target,options)=>fs.cpSync(source,target,{recursive:true,dereference:true,errorOnExist:true,force:false,...options});
// A distributed payload must not carry the compiler's source maps. They are a
// developer artifact, they roughly double the server payload, and each one
// embeds the absolute path of the tree that compiled it — which is how a build
// machine's private checkout path reached a shipped archive.
copy(path.join(appRoot,"dist-server"),path.join(appPayload,"dist-server"),{filter:source=>!source.endsWith(".map")&&!/\.test\.[cm]?js$/.test(source)});
// The production node_modules come from a package-manager install, so they
// carry what a Windows payload must not or need not ship: `.bin` holds POSIX
// symbolic links (a verified payload rejects links), the pnpm state files and
// better-sqlite3's C sources are build inputs, and the Svelte UI packages are
// already compiled into dist/. Type declarations and source maps are never
// loaded at runtime. None of them is loaded by dist-server.
// Package test and example trees are never loaded at runtime, and they are
// where non-ASCII fixture names (`snow ☃`) and the longest paths come from.
const testDirectories=new Set(["test","tests","__tests__","example","examples"]);
const modulesRoot=path.resolve(modulesSource),skippedModules=new Set([".bin",".pnpm",".modules.yaml",".package-lock.json","better-sqlite3/deps","better-sqlite3/src","@lucide/svelte","svelte"]);
copy(modulesRoot,path.join(appPayload,"node_modules"),{filter:source=>{const relative=path.relative(modulesRoot,source).split(path.sep).join("/");if(!relative)return true;const parts=relative.split("/");const name=parts[parts.length-1];if(parts.includes(".bin")||parts.slice(1).some(part=>testDirectories.has(part))||/^\.pnpm-workspace-state/.test(name)||(/\.(?:d\.[cm]?ts|map)$/.test(name)&&fs.statSync(source).isFile()))return false;return !skippedModules.has(relative);}});
fs.mkdirSync(path.join(payloadRoot,"bin"),{recursive:true});
for(const name of["claude-runtime.mjs","codex-runtime.mjs"])fs.copyFileSync(path.join(repoRoot,"bin",name),path.join(payloadRoot,"bin",name));
// Windows has no python3 pty: the usage, model-picker, cloud-session and login
// helpers run as app/dist-server/pty-helpers/cli.js over this bridge.
fs.copyFileSync(bridgeSource,path.join(payloadRoot,"bin","claudex-conpty-bridge.exe"));
// Provider workers look for the prompt/activity hook below
// CLAUDEX_WORKHOUSE_APP_ROOT. A checkout has it at `<root>/hooks`, but the
// portable payload used to omit that directory entirely, so every Windows
// task silently fell back to the generic `thinking` state instead of running
// the same hook contract as the server distribution.
copy(path.join(repoRoot,"hooks","emotion"),path.join(payloadRoot,"hooks","emotion"));
fs.copyFileSync(path.resolve(nodeSource),path.join(payloadRoot,"node.exe"));
fs.copyFileSync(path.join(appRoot,"dist","index.html"),path.join(webPayload,"index.html"));
const html=fs.readFileSync(path.join(appRoot,"dist","index.html"),"utf8"),assetPaths=[...html.matchAll(/(?:src|href)="\/(assets\/[^"]+)"/g)].map(match=>match[1]);
const pending=[...new Set(assetPaths)],copied=new Set();
const dependencies=(relative,text)=>{
  const found=[];
  for(const match of text.matchAll(/\/assets\/([A-Za-z0-9._-]+)/g))found.push(`assets/${match[1]}`);
  for(const match of text.matchAll(/["'(]\.\/([A-Za-z0-9._-]+\.(?:js|css|woff2?|png|svg))/g))found.push(path.posix.join(path.posix.dirname(relative),match[1]));
  return found;
};
while(pending.length){
  const relative=pending.shift();if(copied.has(relative))continue;
  if(!/^assets\/[A-Za-z0-9._-]+$/.test(relative))throw new Error(`Unsafe generated web asset path: ${relative}`);
  const source=path.join(appRoot,"dist",...relative.split("/"));if(!fs.existsSync(source)||!fs.statSync(source).isFile())throw new Error(`Generated web asset dependency is missing: ${relative}`);
  const target=path.join(webPayload,...relative.split("/"));fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(source,target);copied.add(relative);
  if(/\.(?:js|css)$/.test(relative))for(const dependency of dependencies(relative,fs.readFileSync(source,"utf8")))if(!copied.has(dependency))pending.push(dependency);
}
for(const relative of copied)if(/\.(?:js|css)$/.test(relative))for(const dependency of dependencies(relative,fs.readFileSync(path.join(webPayload,...relative.split("/")),"utf8")))if(!copied.has(dependency))throw new Error(`Windows package omitted a generated web asset dependency: ${dependency}`);
for(const relative of["emoticons","icons","manifest.webmanifest","sw.js"]){const source=path.join(appRoot,"dist",relative);if(fs.existsSync(source))copy(source,path.join(webPayload,relative));}
const legalRoot=path.join(payloadRoot,"licenses");
fs.mkdirSync(legalRoot,{recursive:true});
for(const name of["LICENSE","LICENSE.ko.md","LICENSE.ja.md","NOTICE.md","NOTICE.ko.md","NOTICE.ja.md","THIRD_PARTY_NOTICES.md","THIRD_PARTY_NOTICES.ko.md","THIRD_PARTY_NOTICES.ja.md"])fs.copyFileSync(path.join(repoRoot,name),path.join(legalRoot,name));
const configuredNodeLicense=process.env.CLAUDEX_WORKHOUSE_WINDOWS_NODE_LICENSE_FILE?.trim(),nodeDirectory=path.dirname(path.resolve(nodeSource));
const nodeLicense=[configuredNodeLicense,path.join(nodeDirectory,"LICENSE"),path.join(nodeDirectory,"..","LICENSE")].filter(Boolean).find(candidate=>{try{return fs.statSync(path.resolve(candidate)).isFile();}catch{return false;}});
if(!nodeLicense)throw new Error("The redistributed Node.js runtime license was not found. Set CLAUDEX_WORKHOUSE_WINDOWS_NODE_LICENSE_FILE.");
fs.mkdirSync(path.join(legalRoot,"third-party","nodejs"),{recursive:true});
fs.copyFileSync(path.resolve(nodeLicense),path.join(legalRoot,"third-party","nodejs","LICENSE"));
fs.writeFileSync(path.join(appPayload,"package.json"),`${JSON.stringify({name:"claudex-workhouse-windows-server-payload",version,private:true,type:"module",license:"AGPL-3.0-only"},null,2)}\n`);
fs.writeFileSync(path.join(appPayload,"start.mjs"),`import fs from"node:fs";import path from"node:path";import{spawnSync}from"node:child_process";import{fileURLToPath}from"node:url";const appDirectory=path.dirname(fileURLToPath(import.meta.url)),appRoot=path.dirname(appDirectory),dataRoot=process.env.CLAUDEX_WORKHOUSE_DATA_ROOT||path.join(process.env.LOCALAPPDATA||appRoot,"Claudex Workhouse"),configDirectory=path.join(dataRoot,"config");fs.mkdirSync(configDirectory,{recursive:true});const protectedConfigs=["claudex-workhouse.json","projects.json"].map(name=>path.join(configDirectory,name));const repairLegacyAcl=()=>{let denied=false;for(const file of protectedConfigs)try{fs.readFileSync(file);}catch(error){if(error?.code==="EPERM"||error?.code==="EACCES"){denied=true;break;}if(error?.code!=="ENOENT")throw error;}if(!denied)return;const identity=spawnSync("whoami",["/user","/fo","csv","/nh"],{shell:false,encoding:"utf8",windowsHide:true}),sid=String(identity.stdout||"").match(/,"(S-1-[0-9-]+)"\\s*$/i)?.[1];if(!sid)throw new Error("Unable to identify the Windows user for ACL recovery.");const repair=(target,permission,recursive=false)=>{const args=[target,"/grant:r","*"+sid+":"+permission];if(recursive)args.push("/T");args.push("/Q");const result=spawnSync("icacls",args,{shell:false,encoding:"utf8",windowsHide:true});if(result.status!==0)throw new Error("Unable to recover access to the Windows data directory.");};repair(dataRoot,"(OI)(CI)F",true);for(const file of protectedConfigs)if(fs.existsSync(file))repair(file,"F");for(const file of protectedConfigs)if(fs.existsSync(file))fs.readFileSync(file);};repairLegacyAcl();const create=(name,value)=>{const target=path.join(configDirectory,name);try{fs.writeFileSync(target,JSON.stringify(value,null,2)+"\\n",{flag:"wx",mode:384});}catch(error){if(error?.code!=="EEXIST")throw error;}};create("claudex-workhouse.json",{host:"127.0.0.1",port:3410,externalOrigin:"http://127.0.0.1:3410",allowedEmail:"admin@example.com",teamDomain:"",audience:"",authMode:"local",promptMaxLength:50000,commandTimeoutMs:60000,commandOutputLimit:1048576,claudeBinary:"runtime/claude-bin/claude"});create("projects.json",{projects:[{id:"claudex-workhouse",name:"Claudex Workhouse",path:appRoot}]});process.env.CLAUDEX_WORKHOUSE_APP_ROOT=appRoot;process.env.CLAUDEX_WORKHOUSE_DATA_ROOT=dataRoot;process.env.CLAUDEX_WORKHOUSE_DISTRIBUTION_STATUS=process.env.CLAUDEX_WORKHOUSE_DISTRIBUTION_STATUS||"Official";process.env.CLAUDEX_WORKHOUSE_COMMIT_SHA=process.env.CLAUDEX_WORKHOUSE_COMMIT_SHA||${JSON.stringify(commitSha)};await import("./dist-server/index.js");\n`);
const manifest=buildWindowsPayloadManifest(payloadRoot,version);verifyWindowsPayload(payloadRoot,manifest);
const manifestBody=`${JSON.stringify(manifest,null,2)}\n`;
const versionedManifest=`payload-manifests/${version}.json`;
fs.mkdirSync(path.join(packageRoot,"payload-manifests"),{recursive:true});
fs.writeFileSync(path.join(packageRoot,"payload-manifest.json"),manifestBody);
fs.writeFileSync(path.join(packageRoot,...versionedManifest.split("/")),manifestBody);
fs.writeFileSync(path.join(packageRoot,"current.json"),`${JSON.stringify({schemaVersion:1,version,payloadDirectory:`payload/${version}`,payloadManifest:versionedManifest,previousVersion:null},null,2)}\n`);
fs.copyFileSync(path.resolve(launcherSource),path.join(packageRoot,"Claudex Workhouse.exe"));
const total=manifest.files.reduce((sum,item)=>sum+item.size,0)+fs.statSync(path.join(packageRoot,"Claudex Workhouse.exe")).size;
const avatarArtBytes=manifest.files.filter(item=>item.path.startsWith(WINDOWS_AVATAR_ART_PREFIX)).reduce((sum,item)=>sum+item.size,0),programBytes=total-avatarArtBytes;
if(programBytes>WINDOWS_PROGRAM_BUDGET_BYTES)throw new Error(`Windows server program payload exceeds the ${WINDOWS_PROGRAM_BUDGET_BYTES/1048576} MiB policy (${programBytes} bytes, avatar art excluded).`);
if(avatarArtBytes>WINDOWS_AVATAR_ART_BUDGET_BYTES)throw new Error(`Windows server avatar art exceeds the ${WINDOWS_AVATAR_ART_BUDGET_BYTES/1048576} MiB policy (${avatarArtBytes} bytes).`);
const singleExe=path.join(repoRoot,"packages","claudex-workhouse-server-windows-x64.exe"),single=buildWindowsSingleExe({launcher:path.resolve(launcherSource),payloadRoot,manifest,output:singleExe});
// The portable ZIP is the folder above under one root folder. It is written
// here rather than by the host archiver so every build machine produces the
// same entry names, attributes and timestamps, and so the Explorer path-length
// budget is enforced before anything is published.
const sourceDateEpoch=Number(process.env.SOURCE_DATE_EPOCH?.trim()||"");
const portableZip=path.join(repoRoot,"packages","claudex-workhouse-server-windows-x64-portable.zip");
const zip=createPortableZip({sourceRoot:packageRoot,rootName:"Claudex Workhouse",output:portableZip,date:Number.isSafeInteger(sourceDateEpoch)&&sourceDateEpoch>0?new Date(sourceDateEpoch*1000):undefined});
const zipSha=crypto.createHash("sha256").update(fs.readFileSync(portableZip)).digest("hex");
fs.writeFileSync(`${portableZip}.sha256`,`${zipSha}  ${path.basename(portableZip)}\n`);
process.stdout.write(`${packageRoot}\n${singleExe}\n${portableZip}\nfiles=${manifest.files.length}\nfolderBytes=${total}\nprogramBytes=${programBytes}\navatarArtBytes=${avatarArtBytes}\nsingleExeBytes=${single.totalSize}\nportableZipBytes=${zip.bytes}\nportableZipSha256=${zipSha}\nportableZipLongestPath=${zip.longestPath}\n`);
