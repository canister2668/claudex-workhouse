import crypto from"node:crypto";
import fs from"node:fs";
import path from"node:path";
import{spawnSync}from"node:child_process";
import{sqliteMaintenanceInvocation}from"../db/sqlite-platform.js";

type RestoreOptions={
  snapshotRoot:string;
  snapshotDatabase:string;
  liveDatabase:string;
  withDatabaseStopped:<T>(operation:()=>Promise<T>)=>Promise<T>;
  platform?:NodeJS.Platform;
  appRoot?:string;
  nodeBinary?:string;
  pythonBinary?:string;
};

type SnapshotManifest={
  formatVersion:1;
  id:string;
  kind:"database";
  verification:"verified";
  database:string;
  quickCheck:"ok";
  files:Record<string,string>;
};
type RestoreJournal={
  schemaVersion:1;
  liveDatabase:string;
  snapshotDatabase:string;
  temporaryDatabase:string;
  previousDatabase:string;
  previousSidecars:string[];
  restoredDigest:string;
  createdAt:string;
};

function inside(root:string,target:string){
  const relative=path.relative(root,target);
  return relative!==""&&relative!==".."&&!relative.startsWith(`..${path.sep}`)&&!path.isAbsolute(relative);
}
function sha256(file:string){
  const hash=crypto.createHash("sha256"),buffer=Buffer.allocUnsafe(1024*1024),fd=fs.openSync(file,"r");
  try{for(let offset=0;;){const read=fs.readSync(fd,buffer,0,buffer.length,offset);if(!read)break;hash.update(buffer.subarray(0,read));offset+=read;}}
  finally{fs.closeSync(fd);}
  return hash.digest("hex");
}
function syncDirectory(directory:string){
  try{const fd=fs.openSync(directory,"r");try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
  catch{/* Windows may reject directory fsync */}
}
function atomicJson(file:string,value:unknown){
  const temporary=`${file}.${process.pid}.${crypto.randomUUID()}.tmp`,fd=fs.openSync(temporary,"wx",0o600);
  try{fs.writeFileSync(fd,`${JSON.stringify(value,null,2)}\n`);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  try{fs.renameSync(temporary,file);syncDirectory(path.dirname(file));}catch(error){try{fs.rmSync(temporary,{force:true});}catch{}throw error;}
}
function removeDurable(file:string){try{fs.unlinkSync(file);syncDirectory(path.dirname(file));}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}}
function regularFile(file:string,label:string){
  const entry=fs.lstatSync(file);
  if(entry.isSymbolicLink()||!entry.isFile())throw new Error(`${label} is not a regular file.`);
  return entry;
}
function readVerifiedSnapshot(rootInput:string,databaseInput:string){
  const lexicalRoot=path.resolve(rootInput);
  if(fs.realpathSync(lexicalRoot)!==lexicalRoot)throw new Error("Windows update snapshot root cannot be a symbolic link.");
  const root=fs.realpathSync(lexicalRoot),lexicalDatabase=path.resolve(databaseInput);
  if(!inside(root,lexicalDatabase))throw new Error("Windows update snapshot escaped its verified root.");
  const initial=regularFile(lexicalDatabase,"Windows update snapshot database");
  const database=fs.realpathSync(lexicalDatabase);
  if(database!==lexicalDatabase||!inside(root,database))throw new Error("Windows update snapshot database escaped its verified root.");
  const directory=path.dirname(database),manifestFile=path.join(directory,"manifest.json"),completeFile=path.join(directory,"COMPLETE");
  regularFile(manifestFile,"Windows update snapshot manifest");
  regularFile(completeFile,"Windows update snapshot completion marker");
  const manifest=JSON.parse(fs.readFileSync(manifestFile,"utf8")) as SnapshotManifest;
  if(manifest?.formatVersion!==1||manifest.kind!=="database"||manifest.verification!=="verified"||manifest.quickCheck!=="ok"||manifest.database!==path.basename(database)||typeof manifest.files?.[manifest.database]!=="string")throw new Error("Windows update snapshot manifest is not a verified database snapshot.");
  const digest=sha256(database);
  if(digest!==manifest.files[manifest.database])throw new Error("Windows update snapshot database digest does not match its manifest.");
  return{root,database,directory,digest,device:initial.dev,inode:initial.ino};
}
function assertSnapshotIdentity(snapshot:ReturnType<typeof readVerifiedSnapshot>){
  const entry=regularFile(snapshot.database,"Windows update snapshot database");
  if(fs.realpathSync(snapshot.database)!==snapshot.database||entry.dev!==snapshot.device||entry.ino!==snapshot.inode||sha256(snapshot.database)!==snapshot.digest)throw new Error("Windows update snapshot identity changed during restore.");
}
function restoreJournalFile(liveDatabase:string){return`${path.resolve(liveDatabase)}.restore.json`;}
function readRestoreJournal(liveDatabase:string){
  const live=path.resolve(liveDatabase),file=restoreJournalFile(live);
  regularFile(file,"Database restore journal");
  const value=JSON.parse(fs.readFileSync(file,"utf8")) as RestoreJournal,directory=path.dirname(live),prefix=`.${path.basename(live)}.`;
  const allowedSidecars=new Set(["-wal","-shm","-journal"].map(suffix=>`${value?.previousDatabase}${suffix}`));
  if(value?.schemaVersion!==1||value.liveDatabase!==live||path.dirname(value.temporaryDatabase)!==directory||path.dirname(value.previousDatabase)!==directory||!path.basename(value.temporaryDatabase).startsWith(`${prefix}restore-`)||!path.basename(value.previousDatabase).startsWith(`${prefix}pre-restore-`)||!Array.isArray(value.previousSidecars)||new Set(value.previousSidecars).size!==value.previousSidecars.length||value.previousSidecars.some(item=>!allowedSidecars.has(item))||!value.restoredDigest?.match(/^[0-9a-f]{64}$/))throw new Error("Database restore journal is invalid.");
  return{file,value};
}
export function settleVerifiedDatabaseRestore(input:{liveDatabase:string;decision:"commit"|"revert"}){
  const live=path.resolve(input.liveDatabase),journalFile=restoreJournalFile(live);
  if(!fs.existsSync(journalFile))return{settled:false,previousDatabase:null};
  const{value}=readRestoreJournal(live),directory=path.dirname(live);
  if(input.decision==="commit"){
    if(!fs.existsSync(live)||sha256(live)!==value.restoredDigest)throw new Error("Completed database restore does not match its journal.");
    if(fs.existsSync(value.temporaryDatabase))fs.rmSync(value.temporaryDatabase,{force:true});
    removeDurable(journalFile);
    return{settled:true,previousDatabase:fs.existsSync(value.previousDatabase)?value.previousDatabase:null};
  }
  const discard=`${value.temporaryDatabase}.discard`,discarded:Array<{current:string;target:string}>=[],restored:Array<{previous:string;current:string}>=[];
  try{
    const restoreInstalled=fs.existsSync(live)&&sha256(live)===value.restoredDigest;
    if(restoreInstalled&&!fs.existsSync(value.previousDatabase))throw Object.assign(new Error("Completed database restore is missing its preserved previous database."),{code:"RESTORE_PREVIOUS_INCOMPLETE"});
    if(fs.existsSync(value.previousDatabase)){
      for(const suffix of["","-wal","-shm","-journal"]){
        const current=`${live}${suffix}`,previous=`${value.previousDatabase}${suffix}`,wasMoved=suffix===""||value.previousSidecars.includes(previous);
        if(restoreInstalled&&wasMoved&&!fs.existsSync(previous))throw Object.assign(new Error("Completed database restore is missing a preserved previous file."),{code:"RESTORE_PREVIOUS_INCOMPLETE"});
        if(fs.existsSync(current)&&(restoreInstalled||fs.existsSync(previous))){const target=`${discard}${suffix}`;regularFile(current,suffix?"Restored database sidecar":"Restored database");fs.renameSync(current,target);discarded.push({current,target});}
      }
      for(const suffix of["","-wal","-shm","-journal"]){
        const previous=`${value.previousDatabase}${suffix}`,current=`${live}${suffix}`;
        if((suffix===""||value.previousSidecars.includes(previous))&&fs.existsSync(previous)){regularFile(previous,suffix?"Previous database sidecar":"Previous database");if(fs.existsSync(current))throw new Error("Database restore rollback destination already exists.");fs.renameSync(previous,current);restored.push({previous,current});}
      }
      syncDirectory(directory);
    }
    if(fs.existsSync(value.temporaryDatabase))fs.rmSync(value.temporaryDatabase,{force:true});
    for(const item of discarded)if(fs.existsSync(item.target))fs.rmSync(item.target,{force:true});
    removeDurable(journalFile);
    return{settled:true,previousDatabase:null};
  }catch(error){
    for(const item of [...restored].reverse())if(fs.existsSync(item.current)&&!fs.existsSync(item.previous))try{fs.renameSync(item.current,item.previous);}catch{}
    for(const item of [...discarded].reverse())if(fs.existsSync(item.target)&&!fs.existsSync(item.current))try{fs.renameSync(item.target,item.current);}catch{}
    syncDirectory(directory);throw error;
  }
}

export async function restoreVerifiedDatabaseSnapshot(options:RestoreOptions){
  const snapshot=readVerifiedSnapshot(options.snapshotRoot,options.snapshotDatabase);
  return options.withDatabaseStopped(async()=>{
    const live=path.resolve(options.liveDatabase),liveEntry=regularFile(live,"Live database"),directory=path.dirname(live),liveIdentity={device:liveEntry.dev,inode:liveEntry.ino};
    const token=crypto.randomUUID(),temporary=path.join(directory,`.${path.basename(live)}.restore-${token}.tmp`),previous=path.join(directory,`.${path.basename(live)}.pre-restore-${token}`),journalFile=restoreJournalFile(live);
    if(fs.existsSync(journalFile))throw new Error("A database restore decision is already pending.");
    const launch=sqliteMaintenanceInvocation({operation:"restore",source:snapshot.database,destination:temporary,platform:options.platform,appRoot:options.appRoot,nodeBinary:options.nodeBinary,pythonBinary:options.pythonBinary});
    const moved:Array<{source:string;destination:string}>=[];
    const restoreMoved=()=>{for(const item of [...moved].reverse())if(fs.existsSync(item.destination)&&!fs.existsSync(item.source))fs.renameSync(item.destination,item.source);moved.length=0;syncDirectory(directory);};
    try{
      const result=spawnSync(launch.command,launch.args,{encoding:"utf8",shell:false,windowsHide:true,timeout:120_000,maxBuffer:1024*1024});
      if(result.error)throw new Error(`Verified database restore helper failed: ${result.error.message}`,{cause:result.error});
      if(result.status!==0){
        const reason=(result.stderr||result.stdout||result.signal&&`signal ${result.signal}`||`exit ${result.status}`).trim().slice(0,300);
        throw new Error(`Verified database restore failed: ${reason}`);
      }
      assertSnapshotIdentity(snapshot);
      const restored=regularFile(temporary,"Restored database"),currentLive=regularFile(live,"Live database");
      if(currentLive.dev!==liveIdentity.device||currentLive.ino!==liveIdentity.inode)throw new Error("Live database identity changed while restore was prepared.");
      const restoredDigest=sha256(temporary);fs.chmodSync(temporary,liveEntry.mode&0o777);
      const fd=fs.openSync(temporary,"r");try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
      if(restored.size<=0)throw new Error("Restored database is empty.");
      const sidecars=["-wal","-shm","-journal"].filter(suffix=>fs.existsSync(`${live}${suffix}`));
      const journal:RestoreJournal={schemaVersion:1,liveDatabase:live,snapshotDatabase:snapshot.database,temporaryDatabase:temporary,previousDatabase:previous,previousSidecars:sidecars.map(suffix=>`${previous}${suffix}`),restoredDigest,createdAt:new Date().toISOString()};
      atomicJson(journalFile,journal);
      for(const suffix of["",...sidecars]){
        const source=`${live}${suffix}`,destination=`${previous}${suffix}`;
        if(!fs.existsSync(source))continue;
        regularFile(source,suffix?"Live database sidecar":"Live database");
        fs.renameSync(source,destination);moved.push({source,destination});
      }
      syncDirectory(directory);
      try{fs.renameSync(temporary,live);syncDirectory(directory);}
      catch(error){restoreMoved();throw error;}
      return{database:live,previousDatabase:previous,previousSidecars:moved.slice(1).map(item=>item.destination),snapshotDatabase:snapshot.database,recoveryFile:journalFile};
    }catch(error){
      try{if(fs.existsSync(temporary))fs.rmSync(temporary,{force:true});}catch{}
      if(fs.existsSync(journalFile))try{settleVerifiedDatabaseRestore({liveDatabase:live,decision:"revert"});}catch{}
      else if(!fs.existsSync(live)&&moved.length)try{restoreMoved();}catch{}
      throw error;
    }
  });
}
