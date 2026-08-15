import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { sqliteMaintenanceInvocation } from "./db/sqlite-platform.js";
import type { ApplicationInstallMetadata, ApplicationUpdateSnapshot } from "./application-updates.js";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function sha256(file:string){return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");}
function syncDirectory(directory:string){try{const descriptor=fs.openSync(directory,"r");try{fs.fsyncSync(descriptor);}finally{fs.closeSync(descriptor);}}catch{/* Some filesystems reject directory fsync. */}}

export function createApplicationUpdateSnapshot(input:{attemptId:string;snapshotRoot:string;dataRoot:string;dbPath:string;metadata:ApplicationInstallMetadata;now?:Date;platform?:NodeJS.Platform;appRoot?:string;nodeBinary?:string;pythonBinary?:string}):ApplicationUpdateSnapshot{
  if(!UUID.test(input.attemptId))throw new Error("Application update attempt id is invalid.");
  const now=input.now??new Date();if(!Number.isFinite(now.getTime()))throw new Error("Application update snapshot time is invalid.");
  const parent=path.join(path.resolve(input.snapshotRoot),"application-updates"),staging=path.join(parent,`.staging-${input.attemptId}`),final=path.join(parent,input.attemptId);
  fs.mkdirSync(parent,{recursive:true,mode:0o700});fs.chmodSync(parent,0o700);
  if(fs.existsSync(staging)||fs.existsSync(final))throw new Error("Application update recovery snapshot already exists.");
  fs.mkdirSync(staging,{mode:0o700});fs.chmodSync(staging,0o700);
  try{
    const database=path.join(staging,"claudex-workhouse.sqlite"),launch=sqliteMaintenanceInvocation({operation:"backup",source:path.resolve(input.dbPath),destination:database,platform:input.platform,appRoot:input.appRoot,nodeBinary:input.nodeBinary,pythonBinary:input.pythonBinary});
    const result=spawnSync(launch.command,launch.args,{encoding:"utf8",shell:false,windowsHide:true,timeout:120_000,maxBuffer:1024*1024});
    if(result.status!==0)throw new Error(`Application update database snapshot failed: ${(result.stderr||result.stdout||`exit ${result.status}`).trim().slice(0,300)}`);
    fs.chmodSync(database,0o600);
    const files=[database],configRoot=path.join(path.resolve(input.dataRoot),"config");
    for(const name of["claudex-workhouse.json","projects.json"]){
      const source=path.join(configRoot,name);if(!fs.existsSync(source))continue;const status=fs.lstatSync(source);if(status.isSymbolicLink()||!status.isFile()||status.size>16*1024*1024)throw new Error(`Application update snapshot input is unsafe: ${name}`);
      const destination=path.join(staging,name);fs.copyFileSync(source,destination,fs.constants.COPYFILE_EXCL);fs.chmodSync(destination,0o600);files.push(destination);
    }
    const metadataFile=path.join(staging,"installation-metadata.json");fs.writeFileSync(metadataFile,`${JSON.stringify(input.metadata,null,2)}\n`,{mode:0o600,flag:"wx"});files.push(metadataFile);
    const manifest={schemaVersion:1,id:input.attemptId,kind:"application-update-recovery",createdAt:now.toISOString(),verification:"verified",quickCheck:"ok",sourceVersion:input.metadata.version,installMethod:input.metadata.installMethod,files:Object.fromEntries(files.map(file=>[path.basename(file),{size:fs.statSync(file).size,sha256:sha256(file)}]))};
    const manifestFile=path.join(staging,"manifest.json");fs.writeFileSync(manifestFile,`${JSON.stringify(manifest,null,2)}\n`,{mode:0o600,flag:"wx"});
    const complete=path.join(staging,"COMPLETE");fs.writeFileSync(complete,`${manifest.createdAt}\n`,{mode:0o600,flag:"wx"});syncDirectory(staging);fs.renameSync(staging,final);syncDirectory(parent);
    return{id:input.attemptId,directory:final};
  }catch(error){try{fs.rmSync(staging,{recursive:true,force:true});}catch{}throw error;}
}
