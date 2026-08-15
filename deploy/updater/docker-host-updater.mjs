#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SHA256=/^[a-f0-9]{64}$/,DIGEST=/^sha256:[a-f0-9]{64}$/,UUID=/^[0-9a-f-]{36}$/i;
function bounded(file,maximum){const resolved=path.resolve(file),status=fs.lstatSync(resolved);if(status.isSymbolicLink()||!status.isFile()||status.size<1||status.size>maximum)throw new Error(`${path.basename(file)} is not a bounded regular file.`);return fs.readFileSync(resolved);}
function jsonFile(file,maximum){return JSON.parse(bounded(file,maximum).toString("utf8"));}
function hash(bytes){return crypto.createHash("sha256").update(bytes).digest("hex");}
function runDocker(args){const result=spawnSync("docker",args,{encoding:"utf8",shell:false,timeout:10*60_000,maxBuffer:4*1024*1024});if(result.error||result.status!==0)throw new Error(`docker ${args.slice(0,3).join(" ")} failed: ${(result.stderr||result.stdout||result.error?.message||`exit ${result.status}`).trim().slice(0,500)}`);}
function atomicWrite(file,bytes,mode=0o600){fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const temporary=`${file}.${process.pid}.${crypto.randomUUID()}.tmp`;fs.writeFileSync(temporary,bytes,{mode,flag:"wx"});fs.renameSync(temporary,file);}
function refreshAsset(composeDirectory,source,destination,maximum){const temporary=`${destination}.${process.pid}.${crypto.randomUUID()}.tmp`;try{runDocker(["compose","--project-directory",composeDirectory,"--env-file",path.join(composeDirectory,".env"),"-f",path.join(composeDirectory,"compose.yaml"),"cp",`claudex-workhouse:${source}`,temporary]);const bytes=bounded(temporary,maximum);atomicWrite(destination,bytes,destination.endsWith(".mjs")?0o700:0o600);}finally{fs.rmSync(temporary,{force:true});}}
function updateEnv(source,values){const lines=source.split(/\r?\n/),seen=new Set();const output=lines.map(line=>{const match=/^([A-Z][A-Z0-9_]*)=/.exec(line);if(!match||!(match[1] in values))return line;if(seen.has(match[1]))throw new Error(`Duplicate ${match[1]} in deployment .env.`);seen.add(match[1]);return`${match[1]}=${values[match[1]]}`;});for(const[key,value]of Object.entries(values))if(!seen.has(key))output.push(`${key}=${value}`);return`${output.filter((line,index)=>line||index<output.length-1).join("\n").replace(/\n+$/,"")}\n`;}
async function healthy(origin,timeoutMs){const end=Date.now()+timeoutMs;while(Date.now()<end){try{for(const route of["/api/health/live","/api/health/ready"]){const response=await fetch(`${origin}${route}`,{redirect:"error",signal:AbortSignal.timeout(3000)});if(!response.ok)throw new Error(String(response.status));}return true;}catch{}await new Promise(resolve=>setTimeout(resolve,1000));}return false;}
async function download(url,maximum){let current=new URL(url);for(let redirects=0;redirects<=5;redirects++){if(current.protocol!=="https:"||current.username||current.password)throw new Error("Release metadata URLs must use HTTPS without credentials.");const response=await fetch(current,{redirect:"manual",signal:AbortSignal.timeout(30_000)});if([301,302,303,307,308].includes(response.status)){const location=response.headers.get("location");if(!location)throw new Error("Release metadata redirect has no location.");current=new URL(location,current);continue;}if(!response.ok)throw new Error(`Release metadata download failed with HTTP ${response.status}.`);const declared=Number(response.headers.get("content-length")||"0");if(declared>maximum)throw new Error("Release metadata exceeds its allowed size.");const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length<1||bytes.length>maximum)throw new Error("Release metadata is empty or exceeds its allowed size.");return bytes;}throw new Error("Release metadata exceeded the redirect limit.");}
function resultFile(requestFile,id){return path.join(path.dirname(path.dirname(requestFile)),"results",`${id}.json`);}

export async function runDockerHostUpdate(environment=process.env){
  const envRequired=name=>{const value=environment[name]?.trim();if(!value)throw new Error(`${name} is required.`);return value;};
  const requestInput=environment.WORKHOUSE_UPDATE_REQUEST_FILE?.trim()||process.argv[2];if(!requestInput)throw new Error("WORKHOUSE_UPDATE_REQUEST_FILE or a request-file argument is required.");
  const requestFile=path.resolve(requestInput),keyRingFile=path.resolve(envRequired("WORKHOUSE_RELEASE_KEY_RING_FILE")),composeDirectory=path.resolve(envRequired("WORKHOUSE_COMPOSE_DIRECTORY")),healthOrigin=environment.WORKHOUSE_HEALTH_ORIGIN?.trim()||"http://127.0.0.1:3410";
  const healthTimeoutMs=Number(environment.WORKHOUSE_HEALTH_TIMEOUT_MS?.trim()||"120000");if(!Number.isSafeInteger(healthTimeoutMs)||healthTimeoutMs<100||healthTimeoutMs>600_000)throw new Error("WORKHOUSE_HEALTH_TIMEOUT_MS is invalid.");
  const health=new URL(healthOrigin);if(health.protocol!=="http:"||!["127.0.0.1","localhost","::1"].includes(health.hostname)||health.username||health.password||health.pathname!=="/"||health.search||health.hash)throw new Error("WORKHOUSE_HEALTH_ORIGIN must be a loopback HTTP origin.");
  const request=jsonFile(requestFile,1024*1024);if(request?.schemaVersion!==1||request.installMethod!=="docker-compose"||!UUID.test(request.attemptId)||!SHA256.test(request.manifestSha256)||typeof request.sourceVersion!=="string"||typeof request.targetVersion!=="string"||request.artifact?.repository===undefined||!DIGEST.test(request.artifact?.digest)||typeof request.manifest?.url!=="string"||typeof request.manifest?.signatureUrl!=="string")throw new Error("Docker application update request is invalid.");
  const outputFile=resultFile(requestFile,request.attemptId),startedAt=new Date().toISOString(),lock=path.join(composeDirectory,".application-update.lock"),envFile=path.join(composeDirectory,".env"),composeFile=path.join(composeDirectory,"compose.yaml");let previousEnv=null,changed=false;
  if(!fs.lstatSync(composeDirectory).isDirectory()||!fs.lstatSync(composeFile).isFile())throw new Error("Docker Compose deployment directory is invalid.");
  fs.mkdirSync(lock,{mode:0o700});
  try{
    const [manifestBytes,signature]=await Promise.all([download(request.manifest.url,1024*1024),download(request.manifest.signatureUrl,64*1024)]),ring=jsonFile(keyRingFile,1024*1024),manifest=JSON.parse(manifestBytes.toString("utf8"));
    if(hash(manifestBytes)!==request.manifestSha256)throw new Error("Update request manifest SHA-256 does not match the supplied manifest bytes.");
    const key=ring?.schemaVersion===1&&Array.isArray(ring.keys)?ring.keys.find(item=>item?.keyId===manifest?.signing?.keyId):null,now=Date.now();
    if(!key||key.algorithm!=="rsa-sha256"||key.revoked!==false||Date.parse(key.notBefore)>now||Date.parse(key.expiresAt)<=now)throw new Error("Release signing key is unavailable, inactive, or revoked.");
    if(!crypto.verify("RSA-SHA256",manifestBytes,{key:key.publicKeyPem,padding:crypto.constants.RSA_PKCS1_PADDING},signature))throw new Error("Release manifest signature verification failed.");
    if(manifest.schemaVersion!==3||manifest.version!==request.targetVersion||manifest.server?.image!==request.artifact.repository||manifest.server?.digest!==request.artifact.digest||manifest.server?.minimumUpdaterProtocolVersion!==1)throw new Error("Signed release manifest does not match the Docker update request.");
    previousEnv=bounded(envFile,1024*1024);const previousText=previousEnv.toString("utf8"),versions=previousText.split(/\r?\n/).filter(line=>line.startsWith("CLAUDEX_WORKHOUSE_VERSION="));if(versions.length!==1||versions[0]!==`CLAUDEX_WORKHOUSE_VERSION=${request.sourceVersion}`)throw new Error("Update request source version does not match the installed deployment.");
    const imageReference=`${request.artifact.repository}@${request.artifact.digest}`;runDocker(["pull",imageReference]);const updated=updateEnv(previousText,{CLAUDEX_WORKHOUSE_VERSION:request.targetVersion,CLAUDEX_WORKHOUSE_IMAGE_DIGEST:request.artifact.digest,CLAUDEX_WORKHOUSE_IMAGE_REFERENCE:imageReference,CLAUDEX_WORKHOUSE_UPDATER_PROTOCOL_VERSION:"1"});
    const backup=path.join(composeDirectory,`.env.update-${request.attemptId}.previous`);atomicWrite(backup,previousEnv);atomicWrite(envFile,updated);changed=true;
    runDocker(["compose","--project-directory",composeDirectory,"--env-file",envFile,"-f",composeFile,"up","-d"]);
    if(!await healthy(health.origin,healthTimeoutMs))throw new Error("Updated container did not become ready before the deadline.");
    refreshAsset(composeDirectory,"/opt/claudex-workhouse/deploy/updater/docker-host-updater.mjs",environment.WORKHOUSE_UPDATER_FILE?.trim()?path.resolve(environment.WORKHOUSE_UPDATER_FILE):fileURLToPath(import.meta.url),1024*1024);
    refreshAsset(composeDirectory,"/opt/claudex-workhouse/deploy/release-key-ring.json",keyRingFile,1024*1024);
    const result={schemaVersion:1,attemptId:request.attemptId,state:"completed",sourceVersion:request.sourceVersion,targetVersion:request.targetVersion,manifestSha256:request.manifestSha256,rollbackPerformed:false,startedAt,completedAt:new Date().toISOString(),error:null};atomicWrite(outputFile,`${JSON.stringify(result,null,2)}\n`);return result;
  }catch(error){
    let rollbackError=null,rollbackPerformed=false;
    if(changed&&previousEnv){try{atomicWrite(envFile,previousEnv);runDocker(["compose","--project-directory",composeDirectory,"--env-file",envFile,"-f",composeFile,"up","-d"]);if(!await healthy(health.origin,healthTimeoutMs))throw new Error("Previous container did not become ready after rollback.");rollbackPerformed=true;}catch(rollback){rollbackError=rollback instanceof Error?rollback.message:String(rollback);}}
    const message=error instanceof Error?error.message:String(error),result={schemaVersion:1,attemptId:request.attemptId,state:rollbackPerformed?"rolled-back":"failed",sourceVersion:request.sourceVersion,targetVersion:request.targetVersion,manifestSha256:request.manifestSha256,rollbackPerformed,startedAt,completedAt:new Date().toISOString(),error:rollbackError?`${message}; rollback: ${rollbackError}`:message};atomicWrite(outputFile,`${JSON.stringify(result,null,2)}\n`);throw Object.assign(new Error(result.error),{result});
  }finally{try{fs.rmdirSync(lock);}catch{}}
}

const invoked=process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked)runDockerHostUpdate().then(result=>process.stdout.write(`${JSON.stringify(result)}\n`)).catch(error=>{process.stderr.write(`${error instanceof Error?error.message:String(error)}\n`);process.exitCode=1;});
