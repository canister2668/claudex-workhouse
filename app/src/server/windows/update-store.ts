import crypto from"node:crypto";
import fs from"node:fs";
import path from"node:path";
import{isDeepStrictEqual}from"node:util";
import{acceptWindowsUpdateAfterFailure,beginWindowsUpdate,completeWindowsRollback,confirmWindowsUpdateHealth,createWindowsUpdateState,expireWindowsUpdateHealth,failWindowsUpdateHealth,parseWindowsUpdateState,rollbackConfirmedWindowsUpdate,type WindowsUpdateState}from"./update-state.js";

type VersionJournal={schemaVersion:1;operation:"activate"|"rollback";previous:WindowsUpdateState;next:WindowsUpdateState;databaseRestoreRequired?:boolean;createdAt:string};
type StoreOptions={
  installRoot:string;
  snapshotRoot:string;
  activeVersion:()=>string;
  activateVersion:(version:string)=>void|Promise<void>;
  recoverVersion?:(version:string)=>void;
  createSnapshot:()=>{database:string;verified:boolean}|Promise<{database:string;verified:boolean}>;
  restoreSnapshot?:(database:string)=>void|Promise<void>;
  settleDatabaseRestore?:(decision:"commit"|"revert")=>void;
  now?:()=>Date;
  leaseStaleMs?:number;
};

function syncDirectory(directory:string){try{const fd=fs.openSync(directory,"r");try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}catch{/* Windows may reject directory fsync */}}
function atomicJson(file:string,value:unknown){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const temporary=`${file}.${process.pid}.${crypto.randomUUID()}.tmp`,fd=fs.openSync(temporary,"wx",0o600);
  let failure:unknown=null;try{fs.writeFileSync(fd,`${JSON.stringify(value,null,2)}\n`);fs.fsyncSync(fd);}catch(error){failure=error;}finally{fs.closeSync(fd);}if(failure){try{fs.rmSync(temporary,{force:true});}catch{}throw failure;}
  try{fs.renameSync(temporary,file);syncDirectory(path.dirname(file));}catch(error){try{fs.rmSync(temporary,{force:true});}catch{}throw error;}
}
function removeDurable(file:string){try{fs.unlinkSync(file);syncDirectory(path.dirname(file));}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}}
function readJson(file:string){return JSON.parse(fs.readFileSync(file,"utf8")) as unknown;}
function sameState(left:WindowsUpdateState,right:WindowsUpdateState){return isDeepStrictEqual(left,right);}
function processAlive(pid:unknown){if(!Number.isInteger(pid)||Number(pid)<=0)return false;try{process.kill(Number(pid),0);return true;}catch(error){return(error as NodeJS.ErrnoException).code!=="ESRCH";}}

export class WindowsUpdateStore{
  private readonly stateFile:string;
  private readonly journalFile:string;
  private readonly leaseFile:string;
  private readonly leaseStaleMs:number;
  private leaseHeld=false;
  private leaseHeartbeat:ReturnType<typeof setInterval>|null=null;
  constructor(private readonly options:StoreOptions){
    this.stateFile=path.join(options.installRoot,"update-state.json");
    this.journalFile=path.join(options.installRoot,"update-activation.json");
    this.leaseFile=path.join(options.installRoot,"update.lock");
    this.leaseStaleMs=options.leaseStaleMs??300_000;if(this.leaseStaleMs<240_000)throw new Error("Windows update lease stale timeout must cover the snapshot operation timeout.");
  }
  initialize(){
    fs.mkdirSync(this.options.installRoot,{recursive:true});
    this.rejectForeignLease();
    this.recoverActivation();
    let state=fs.existsSync(this.stateFile)?parseWindowsUpdateState(readJson(this.stateFile)):createWindowsUpdateState(this.options.activeVersion(),this.iso());
    if(state.currentVersion!==this.options.activeVersion())throw new Error("Windows update state does not match the active payload.");
    if(state.phase==="pending-health"){
      const expired=expireWindowsUpdateHealth(state,this.iso());
      if(expired!==state){state=expired;this.writeState(state);}
    }
    if(!fs.existsSync(this.stateFile))this.writeState(state);
    this.validateSnapshotReferences(state);
    return state;
  }
  load(){const state=parseWindowsUpdateState(readJson(this.stateFile));this.validateSnapshotReferences(state);return state;}
  async activate(input:{version:string;fromSchema:number;toSchema:number;schemaReversible:boolean;healthTimeoutMs:number}){
    const release=this.acquireLease();try{
      const previous=this.initialize();if(!Number.isSafeInteger(input.healthTimeoutMs)||input.healthTimeoutMs<=0)throw new Error("Windows update health timeout is invalid.");
      const snapshot=await this.options.createSnapshot();if(!snapshot.verified)throw new Error("A verified database snapshot file is required before activation.");this.validateSnapshot(snapshot.database,true);
      const activatedAt=this.iso(),healthDeadline=new Date(Date.parse(activatedAt)+input.healthTimeoutMs).toISOString(),next=beginWindowsUpdate(previous,{...input,databaseSnapshot:snapshot.database,activatedAt,healthDeadline});
      return await this.commitVersionChange("activate",previous,next,()=>this.options.activateVersion(input.version));
    }finally{release();}
  }
  confirmHealth(){
    const release=this.acquireLease();try{return this.writeState(confirmWindowsUpdateHealth(this.initialize(),this.iso()));}finally{release();}
  }
  failHealth(reason:string){
    const release=this.acquireLease();try{return this.writeState(failWindowsUpdateHealth(this.initialize(),reason,this.iso()));}finally{release();}
  }
  acceptFailure(operatorConfirmed:boolean){
    const release=this.acquireLease();try{return this.writeState(acceptWindowsUpdateAfterFailure(this.initialize(),{operatorConfirmed,now:this.iso()}));}finally{release();}
  }
  rollbackFailed(){return this.rollback("failed");}
  rollbackConfirmed(){return this.rollback("confirmed");}
  private async rollback(kind:"failed"|"confirmed"){
    const release=this.acquireLease();try{
      const previous=this.initialize(),availability=this.rollbackSnapshotAvailability(previous);
      if(!availability.canRollback)throw new Error(`Windows rollback is unavailable: ${availability.reason}.`);
      if(availability.required&&!this.options.restoreSnapshot)throw new Error("Windows rollback requires a database restore implementation.");
      if(availability.required&&!this.options.settleDatabaseRestore)throw new Error("Windows rollback requires durable database restore recovery.");
      if(availability.required&&!this.options.recoverVersion)throw new Error("Windows rollback requires a synchronous payload recovery implementation.");
      const migration=previous.pending??previous.lastMigration;
      if(!migration)throw new Error("No Windows migration is available to roll back.");
      const next=kind==="failed"
        ?completeWindowsRollback(previous,{snapshotRestored:availability.required,now:this.iso()})
        :rollbackConfirmedWindowsUpdate(previous,{snapshotRestored:availability.required,now:this.iso()});
      return await this.commitVersionChange("rollback",previous,next,async()=>{
        if(availability.required)await this.options.restoreSnapshot!(migration.databaseSnapshot);
        await this.options.activateVersion(next.currentVersion);
      },availability.required);
    }finally{release();}
  }
  private recoverActivation(){
    if(!fs.existsSync(this.journalFile))return;
    const value=readJson(this.journalFile) as VersionJournal;
    if(value?.schemaVersion!==1||(value.operation!=="activate"&&value.operation!=="rollback")||(value.databaseRestoreRequired!==undefined&&typeof value.databaseRestoreRequired!=="boolean")||(value.databaseRestoreRequired===true&&value.operation!=="rollback")||(value.operation==="rollback"&&value.databaseRestoreRequired===true&&(!this.options.settleDatabaseRestore||!this.options.recoverVersion)))throw new Error("Windows update activation journal is invalid.");
    const previous=parseWindowsUpdateState(value.previous),next=parseWindowsUpdateState(value.next),active=this.options.activeVersion(),persisted=fs.existsSync(this.stateFile)?parseWindowsUpdateState(readJson(this.stateFile)):previous;
    if(!sameState(persisted,previous)&&!sameState(persisted,next))throw new Error("Windows update activation journal does not match persisted state.");
    if(active===next.currentVersion){this.writeState(next);if(value.databaseRestoreRequired)this.options.settleDatabaseRestore!("commit");}
    else if(active===previous.currentVersion){
      if(value.databaseRestoreRequired)try{this.options.settleDatabaseRestore!("revert");}
      catch(error){
        if((error as{code?:string}).code!=="RESTORE_PREVIOUS_INCOMPLETE"||!this.options.recoverVersion)throw error;
        this.options.recoverVersion(next.currentVersion);
        if(this.options.activeVersion()!==next.currentVersion)throw new Error("Windows payload recovery did not select the rollback version.",{cause:error});
        this.writeState(next);this.options.settleDatabaseRestore!("commit");
      }
    }
    else throw new Error("Windows update activation journal cannot be reconciled with the active payload.");
    removeDurable(this.journalFile);
  }
  private async commitVersionChange(operation:"activate"|"rollback",previous:WindowsUpdateState,next:WindowsUpdateState,switchVersion:()=>void|Promise<void>,databaseRestoreRequired=false){
    const journal:VersionJournal={schemaVersion:1,operation,previous,next,databaseRestoreRequired,createdAt:this.iso()};atomicJson(this.journalFile,journal);
    try{await switchVersion();if(this.options.activeVersion()!==next.currentVersion)throw new Error("Windows payload switch did not select the requested version.");this.writeState(next);if(databaseRestoreRequired)this.options.settleDatabaseRestore!("commit");removeDurable(this.journalFile);return next;}
    catch(error){
      if(this.options.activeVersion()===previous.currentVersion){
        if(databaseRestoreRequired)try{this.options.settleDatabaseRestore!("revert");}catch(settlementError){throw new AggregateError([error,settlementError],"Windows rollback failed and database restore reversion also failed.",{cause:error});}
        removeDurable(this.journalFile);
      }
      throw error;
    }
  }
  private writeState(state:WindowsUpdateState){const parsed=parseWindowsUpdateState(state);if(parsed.currentVersion!==this.options.activeVersion())throw new Error("Windows update state cannot select an inactive payload.");this.validateSnapshotReferences(parsed);atomicJson(this.stateFile,parsed);return parsed;}
  private validateSnapshotReferences(state:WindowsUpdateState){for(const snapshot of [state.pending?.databaseSnapshot,state.lastMigration?.databaseSnapshot])if(snapshot)this.validateSnapshot(snapshot,false);}
  private validateSnapshot(file:string,required:boolean){if(!fs.existsSync(this.options.snapshotRoot)){if(required)throw new Error("Windows update snapshot root is missing.");return false;}const root=fs.realpathSync(this.options.snapshotRoot),candidate=path.resolve(file),relative=path.relative(root,candidate);if(!relative||relative===".."||relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative))throw new Error("Windows update snapshot escaped its verified root.");if(!fs.existsSync(candidate)){if(required)throw new Error("Windows update snapshot file is missing.");return false;}const link=fs.lstatSync(candidate);if(link.isSymbolicLink()||!link.isFile()||fs.realpathSync(candidate)!==candidate)throw new Error("Windows update snapshot is not a verified regular file.");return true;}
  rollbackSnapshotAvailability(state?:WindowsUpdateState){const current=state??this.initialize(),migration=current.pending??current.lastMigration;if(!migration)return{required:false,snapshotPresent:false,canRollback:false,reason:"no-migration"};const required=migration.toSchema>migration.fromSchema&&!migration.schemaReversible,snapshotPresent=this.validateSnapshot(migration.databaseSnapshot,false);return{required,snapshotPresent,canRollback:!required||snapshotPresent,reason:snapshotPresent?null:"snapshot-missing"};}
  private acquireLease(){fs.mkdirSync(this.options.installRoot,{recursive:true});for(let attempt=0;attempt<2;attempt++){try{const fd=fs.openSync(this.leaseFile,"wx",0o600);try{fs.writeFileSync(fd,JSON.stringify({pid:process.pid,createdAt:this.iso()}));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}this.leaseHeld=true;const interval=Math.max(1000,Math.floor(this.leaseStaleMs/3));this.leaseHeartbeat=setInterval(()=>{try{const now=new Date();fs.utimesSync(this.leaseFile,now,now);}catch{}},interval);this.leaseHeartbeat.unref?.();return()=>{if(this.leaseHeartbeat)clearInterval(this.leaseHeartbeat);this.leaseHeartbeat=null;this.leaseHeld=false;removeDurable(this.leaseFile);};}catch(error){if((error as NodeJS.ErrnoException).code!=="EEXIST")throw error;let owner:any=null;try{owner=readJson(this.leaseFile);}catch{}if(attempt===0&&(!processAlive(owner?.pid)||this.leaseExpired())){removeDurable(this.leaseFile);continue;}throw new Error("Another Windows update operation is running.");}}throw new Error("Windows update operation is busy.");}
  private rejectForeignLease(){if(this.leaseHeld||!fs.existsSync(this.leaseFile))return;let owner:any=null;try{owner=readJson(this.leaseFile);}catch{}if(processAlive(owner?.pid)&&!this.leaseExpired())throw new Error("Another Windows update operation is running.");removeDurable(this.leaseFile);}
  private leaseExpired(){try{return Date.now()-fs.statSync(this.leaseFile).mtimeMs>this.leaseStaleMs;}catch{return true;}}
  private iso(){return(this.options.now?.()??new Date()).toISOString();}
}
