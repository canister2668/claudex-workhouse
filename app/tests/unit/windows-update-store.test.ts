import crypto from"node:crypto";
import fs from"node:fs";
import os from"node:os";
import path from"node:path";
import{execFileSync}from"node:child_process";
import{afterEach,describe,expect,it,vi}from"vitest";
import{WindowsUpdateStore}from"../../src/server/windows/update-store.js";
import{beginWindowsUpdate}from"../../src/server/windows/update-state.js";
import{restoreVerifiedDatabaseSnapshot,settleVerifiedDatabaseRestore}from"../../src/server/windows/database-restore.js";

const roots:string[]=[];afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
function sqliteDatabase(file:string,value:string){execFileSync("python3",["-c","import sqlite3,sys\np,v=sys.argv[1:]\ndb=sqlite3.connect(p);db.execute('CREATE TABLE data(value TEXT NOT NULL)');db.execute('INSERT INTO data(value) VALUES (?)',(v,));db.commit();db.close()",file,value]);}
function sqliteValue(file:string){return execFileSync("python3",["-c","import sqlite3,sys\ndb=sqlite3.connect(sys.argv[1]);print(db.execute('SELECT value FROM data').fetchone()[0]);db.close()",file],{encoding:"utf8"}).trim();}
function fixture(now="2026-07-30T00:00:00.000Z"){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"windows-update-store-"));roots.push(root);let active="1.0.0";
  const snapshotRoot=path.join(root,"snapshots"),snapshot=path.join(snapshotRoot,"snapshot.sqlite");fs.mkdirSync(snapshotRoot);fs.writeFileSync(snapshot,"verified");
  const options={installRoot:path.join(root,"server"),snapshotRoot,activeVersion:()=>active,activateVersion:vi.fn((version:string)=>{active=version;}),recoverVersion:vi.fn((version:string)=>{active=version;}),createSnapshot:vi.fn(()=>({database:snapshot,verified:true})),restoreSnapshot:vi.fn(async()=>{}),settleDatabaseRestore:vi.fn(),now:()=>new Date(now)};
  return{root,options,get active(){return active;},set active(value:string){active=value;}};
}
describe("Windows update persistence",()=>{
  it("persists a verified snapshot decision around activation",async()=>{
    const value=fixture(),store=new WindowsUpdateStore(value.options),state=await store.activate({version:"1.1.0",fromSchema:4,toSchema:5,schemaReversible:false,healthTimeoutMs:120_000});
    expect(state).toMatchObject({phase:"pending-health",currentVersion:"1.1.0",pending:{databaseSnapshot:expect.stringContaining("snapshot.sqlite")}});
    expect(value.options.createSnapshot).toHaveBeenCalledBefore(value.options.activateVersion);
    expect(fs.existsSync(path.join(value.options.installRoot,"update-activation.json"))).toBe(false);
    expect(new WindowsUpdateStore(value.options).initialize()).toMatchObject({currentVersion:"1.1.0"});
  });
  it("does not activate when snapshot verification fails",async()=>{
    const value=fixture();value.options.createSnapshot=vi.fn(()=>({database:path.join(value.root,"missing"),verified:false}));
    await expect(new WindowsUpdateStore(value.options).activate({version:"1.1.0",fromSchema:4,toSchema:4,schemaReversible:true,healthTimeoutMs:1000})).rejects.toThrow(/verified/);
    expect(value.options.activateVersion).not.toHaveBeenCalled();expect(value.active).toBe("1.0.0");
  });
  it("recovers a journal committed after payload activation",async()=>{
    const value=fixture(),store=new WindowsUpdateStore(value.options);
    await expect(store.activate({version:"1.1.0",fromSchema:4,toSchema:4,schemaReversible:true,healthTimeoutMs:1000})).resolves.toBeTruthy();
    const state=store.load(),journal={schemaVersion:1,operation:"activate",previous:{...state,currentVersion:"1.0.0",previousVersion:null,phase:"stable",pending:null},next:state,createdAt:"2026-07-30T00:00:00Z"};
    fs.writeFileSync(path.join(value.options.installRoot,"update-activation.json"),JSON.stringify(journal));
    expect(new WindowsUpdateStore(value.options).initialize().currentVersion).toBe("1.1.0");
    expect(fs.existsSync(path.join(value.options.installRoot,"update-activation.json"))).toBe(false);
  });
  it("expires pending health during boot",async()=>{
    const value=fixture(),store=new WindowsUpdateStore(value.options);await store.activate({version:"1.1.0",fromSchema:4,toSchema:4,schemaReversible:true,healthTimeoutMs:1000});
    value.options.now=()=>new Date("2026-07-30T00:00:02.000Z");
    expect(new WindowsUpdateStore(value.options).initialize()).toMatchObject({phase:"rollback-required",lastFailure:"health deadline expired"});
  });
  it("rejects snapshot paths outside the verified root and symbolic links",async()=>{
    const value=fixture(),outside=path.join(os.tmpdir(),`outside-${process.pid}.sqlite`);fs.writeFileSync(outside,"outside");
    try{value.options.createSnapshot=vi.fn(()=>({database:outside,verified:true}));await expect(new WindowsUpdateStore(value.options).activate({version:"1.1.0",fromSchema:4,toSchema:4,schemaReversible:true,healthTimeoutMs:1000})).rejects.toThrow(/escaped/);
      const link=path.join(value.options.snapshotRoot,"linked.sqlite");fs.symlinkSync(outside,link);value.options.createSnapshot=vi.fn(()=>({database:link,verified:true}));await expect(new WindowsUpdateStore(value.options).activate({version:"1.1.0",fromSchema:4,toSchema:4,schemaReversible:true,healthTimeoutMs:1000})).rejects.toThrow(/verified regular/);
    }finally{fs.rmSync(outside,{force:true});}
  });
  it("rejects a stale journal and a live concurrent lease",()=>{
    const value=fixture(),store=new WindowsUpdateStore(value.options),state=store.initialize(),foreign={...state,updatedAt:"2026-07-29T00:00:00Z"},next=beginWindowsUpdate(foreign,{version:"1.1.0",databaseSnapshot:path.join(value.root,"snapshot.sqlite"),fromSchema:4,toSchema:4,schemaReversible:true,activatedAt:"2026-07-30T00:00:00Z",healthDeadline:"2026-07-30T00:01:00Z"});
    fs.writeFileSync(path.join(value.options.installRoot,"update-activation.json"),JSON.stringify({schemaVersion:1,operation:"activate",previous:foreign,next,createdAt:"2026-07-30T00:00:00Z"}));
    expect(()=>new WindowsUpdateStore(value.options).initialize()).toThrow(/does not match persisted/);
    fs.rmSync(path.join(value.options.installRoot,"update-activation.json"));fs.writeFileSync(path.join(value.options.installRoot,"update.lock"),JSON.stringify({pid:process.pid}));
    expect(()=>new WindowsUpdateStore(value.options).initialize()).toThrow(/Another/);
  });
  it("keeps boot available when a retained rollback snapshot expires",async()=>{
    const value=fixture(),store=new WindowsUpdateStore(value.options);await store.activate({version:"1.1.0",fromSchema:4,toSchema:5,schemaReversible:false,healthTimeoutMs:1000});
    fs.rmSync(path.join(value.options.snapshotRoot,"snapshot.sqlite"));
    expect(store.load()).toMatchObject({phase:"pending-health",currentVersion:"1.1.0"});
    expect(store.rollbackSnapshotAvailability()).toEqual({required:true,snapshotPresent:false,canRollback:false,reason:"snapshot-missing"});
    expect(new WindowsUpdateStore(value.options).initialize()).toMatchObject({currentVersion:"1.1.0"});
  });
  it("removes a stale lease even when its pid has been reused",()=>{
    const value=fixture();fs.mkdirSync(value.options.installRoot,{recursive:true});const lock=path.join(value.options.installRoot,"update.lock");fs.writeFileSync(lock,JSON.stringify({pid:process.pid}));fs.utimesSync(lock,new Date(0),new Date(0));
    expect(new WindowsUpdateStore(value.options).initialize()).toMatchObject({currentVersion:"1.0.0"});
  });
  it("keeps boot available when the entire snapshot root expires",async()=>{
    const value=fixture(),store=new WindowsUpdateStore(value.options);await store.activate({version:"1.1.0",fromSchema:4,toSchema:5,schemaReversible:false,healthTimeoutMs:1000});
    fs.rmSync(value.options.snapshotRoot,{recursive:true,force:true});
    expect(store.load()).toMatchObject({currentVersion:"1.1.0"});
    expect(store.rollbackSnapshotAvailability()).toMatchObject({required:true,snapshotPresent:false,canRollback:false});
  });
  it("binds an irreversible failed rollback to snapshot restore, payload switch, and durable settlement",async()=>{
    const value=fixture(),store=new WindowsUpdateStore(value.options);
    await store.activate({version:"1.1.0",fromSchema:4,toSchema:5,schemaReversible:false,healthTimeoutMs:1000});
    expect(store.failHealth("health probe failed").phase).toBe("blocked-schema");
    const rolled=await store.rollbackFailed();
    expect(rolled).toMatchObject({phase:"stable",currentVersion:"1.0.0",pendingCleanup:["1.1.0"]});
    expect(value.options.restoreSnapshot).toHaveBeenCalledWith(expect.stringContaining("snapshot.sqlite"));
    expect(value.options.restoreSnapshot.mock.invocationCallOrder[0]).toBeLessThan(value.options.activateVersion.mock.invocationCallOrder.at(-1)!);
    expect(value.options.settleDatabaseRestore).toHaveBeenLastCalledWith("commit");
    expect(fs.existsSync(path.join(value.options.installRoot,"update-activation.json"))).toBe(false);
  });
  it("reverts a durable database restore when payload switching fails",async()=>{
    const value=fixture(),store=new WindowsUpdateStore(value.options);
    await store.activate({version:"1.1.0",fromSchema:4,toSchema:5,schemaReversible:false,healthTimeoutMs:1000});store.failHealth("failed");
    value.options.activateVersion.mockImplementationOnce(()=>{throw new Error("switch failed");});
    await expect(store.rollbackFailed()).rejects.toThrow(/switch failed/);
    expect(value.options.restoreSnapshot).toHaveBeenCalledOnce();
    expect(value.options.settleDatabaseRestore).toHaveBeenLastCalledWith("revert");
    expect(value.active).toBe("1.1.0");
    expect(store.load()).toMatchObject({phase:"blocked-schema",currentVersion:"1.1.0"});
  });
  it("reports both payload switching and database reversion failures without deleting the transaction journal",async()=>{
    const value=fixture(),store=new WindowsUpdateStore(value.options);
    await store.activate({version:"1.1.0",fromSchema:4,toSchema:5,schemaReversible:false,healthTimeoutMs:1000});store.failHealth("failed");
    value.options.activateVersion.mockImplementationOnce(()=>{throw new Error("switch failed");});
    value.options.settleDatabaseRestore.mockImplementationOnce(()=>{throw new Error("revert failed");});
    const error=await store.rollbackFailed().catch(error=>error);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors.map(item=>String(item))).toEqual([expect.stringContaining("switch failed"),expect.stringContaining("revert failed")]);
    expect(fs.existsSync(path.join(value.options.installRoot,"update-activation.json"))).toBe(true);
  });
  it("recovers a rollback journal according to the payload selected at the crash boundary",async()=>{
    const value=fixture(),store=new WindowsUpdateStore(value.options);
    await store.activate({version:"1.1.0",fromSchema:4,toSchema:5,schemaReversible:false,healthTimeoutMs:1000});const previous=store.failHealth("failed"),next={...previous,phase:"stable",currentVersion:"1.0.0",previousVersion:null,pending:null,lastMigration:null,pendingCleanup:["1.1.0"],lastFailure:null};
    const journal=path.join(value.options.installRoot,"update-activation.json");
    fs.writeFileSync(journal,JSON.stringify({schemaVersion:1,operation:"rollback",previous,next,databaseRestoreRequired:true,createdAt:"2026-07-30T00:00:00Z"}));
    expect(new WindowsUpdateStore(value.options).initialize()).toMatchObject({currentVersion:"1.1.0",phase:"blocked-schema"});
    expect(value.options.settleDatabaseRestore).toHaveBeenLastCalledWith("revert");
    fs.writeFileSync(journal,JSON.stringify({schemaVersion:1,operation:"rollback",previous,next,databaseRestoreRequired:true,createdAt:"2026-07-30T00:00:00Z"}));value.active="1.0.0";
    expect(new WindowsUpdateStore(value.options).initialize()).toMatchObject({currentVersion:"1.0.0",phase:"stable"});
    expect(value.options.settleDatabaseRestore).toHaveBeenLastCalledWith("commit");
  });
  it("finishes the snapshot rollback when damaged previous sidecars make database reversion impossible",async()=>{
    const value=fixture(),store=new WindowsUpdateStore(value.options);
    await store.activate({version:"1.1.0",fromSchema:4,toSchema:5,schemaReversible:false,healthTimeoutMs:1000});const previous=store.failHealth("failed"),next={...previous,phase:"stable",currentVersion:"1.0.0",previousVersion:null,pending:null,lastMigration:null,pendingCleanup:["1.1.0"],lastFailure:null};
    fs.writeFileSync(path.join(value.options.installRoot,"update-activation.json"),JSON.stringify({schemaVersion:1,operation:"rollback",previous,next,databaseRestoreRequired:true,createdAt:"2026-07-30T00:00:00Z"}));
    value.options.settleDatabaseRestore.mockImplementationOnce(()=>{throw Object.assign(new Error("previous sidecar missing"),{code:"RESTORE_PREVIOUS_INCOMPLETE"});});
    expect(new WindowsUpdateStore(value.options).initialize()).toMatchObject({currentVersion:"1.0.0",phase:"stable"});
    expect(value.options.recoverVersion).toHaveBeenCalledWith("1.0.0");
    expect(value.options.settleDatabaseRestore).toHaveBeenLastCalledWith("commit");
    expect(fs.existsSync(path.join(value.options.installRoot,"update-activation.json"))).toBe(false);
  });
  it("rolls a confirmed irreversible N-1 update back through the same transaction",async()=>{
    const value=fixture(),store=new WindowsUpdateStore(value.options);
    await store.activate({version:"1.1.0",fromSchema:4,toSchema:5,schemaReversible:false,healthTimeoutMs:1000});store.confirmHealth();
    await expect(store.rollbackConfirmed()).resolves.toMatchObject({currentVersion:"1.0.0",previousVersion:null});
    expect(value.options.restoreSnapshot).toHaveBeenCalledOnce();
    expect(value.options.settleDatabaseRestore).toHaveBeenLastCalledWith("commit");
  });
  it("round-trips an actual verified SQLite snapshot through the rollback store transaction",async()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),"windows-update-integration-"));roots.push(root);let active="1.0.0";
    const snapshotRoot=path.join(root,"snapshots"),snapshotDirectory=path.join(snapshotRoot,"objects",crypto.randomUUID()),snapshot=path.join(snapshotDirectory,"claudex-workhouse.sqlite"),live=path.join(root,"live.sqlite"),installRoot=path.join(root,"server");
    fs.mkdirSync(snapshotDirectory,{recursive:true});sqliteDatabase(snapshot,"before-update");sqliteDatabase(live,"before-update");
    const digest=crypto.createHash("sha256").update(fs.readFileSync(snapshot)).digest("hex");
    fs.writeFileSync(path.join(snapshotDirectory,"manifest.json"),JSON.stringify({formatVersion:1,id:path.basename(snapshotDirectory),kind:"database",origin:"test",createdAt:new Date().toISOString(),verification:"verified",database:path.basename(snapshot),quickCheck:"ok",files:{[path.basename(snapshot)]:digest}}));fs.writeFileSync(path.join(snapshotDirectory,"COMPLETE"),"complete\n");
    const options={
      installRoot,snapshotRoot,activeVersion:()=>active,activateVersion:(version:string)=>{active=version;},recoverVersion:(version:string)=>{active=version;},createSnapshot:()=>({database:snapshot,verified:true}),
      restoreSnapshot:(database:string)=>restoreVerifiedDatabaseSnapshot({snapshotRoot,snapshotDatabase:database,liveDatabase:live,withDatabaseStopped:async operation=>operation(),platform:"linux"}).then(()=>{}),
      settleDatabaseRestore:(decision:"commit"|"revert")=>{settleVerifiedDatabaseRestore({liveDatabase:live,decision});},
      now:()=>new Date("2026-07-30T00:00:00Z"),
    };
    const store=new WindowsUpdateStore(options);await store.activate({version:"1.1.0",fromSchema:4,toSchema:5,schemaReversible:false,healthTimeoutMs:1000});
    fs.rmSync(live);sqliteDatabase(live,"after-update");store.failHealth("probe failed");
    await expect(store.rollbackFailed()).resolves.toMatchObject({currentVersion:"1.0.0",phase:"stable"});
    expect(sqliteValue(live)).toBe("before-update");
    expect(fs.existsSync(`${live}.restore.json`)).toBe(false);
  });
});
