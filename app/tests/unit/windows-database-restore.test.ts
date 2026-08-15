import crypto from"node:crypto";
import fs from"node:fs";
import os from"node:os";
import path from"node:path";
import{execFileSync}from"node:child_process";
import{afterEach,describe,expect,it}from"vitest";
import{restoreVerifiedDatabaseSnapshot,settleVerifiedDatabaseRestore}from"../../src/server/windows/database-restore.js";

const roots:string[]=[];
function sha256(file:string){return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");}
function database(file:string,value:string){
  execFileSync("python3",["-c","import sqlite3,sys\np,v=sys.argv[1:]\ndb=sqlite3.connect(p)\ndb.execute('CREATE TABLE values_table(value TEXT NOT NULL)')\ndb.execute('INSERT INTO values_table(value) VALUES (?)',(v,))\ndb.commit();db.close()",file,value]);
}
function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"workhouse-db-restore-"));roots.push(root);
  const snapshotRoot=path.join(root,"snapshots"),snapshotDirectory=path.join(snapshotRoot,"objects",crypto.randomUUID()),snapshotDatabase=path.join(snapshotDirectory,"claudex-workhouse.sqlite"),liveDatabase=path.join(root,"live.sqlite");
  fs.mkdirSync(snapshotDirectory,{recursive:true});database(snapshotDatabase,"snapshot");database(liveDatabase,"live");
  fs.writeFileSync(path.join(snapshotDirectory,"manifest.json"),JSON.stringify({formatVersion:1,id:path.basename(snapshotDirectory),kind:"database",origin:"test",createdAt:new Date().toISOString(),verification:"verified",database:path.basename(snapshotDatabase),quickCheck:"ok",files:{[path.basename(snapshotDatabase)]:sha256(snapshotDatabase)}}));
  fs.writeFileSync(path.join(snapshotDirectory,"COMPLETE"),"complete\n");
  return{root,snapshotRoot,snapshotDirectory,snapshotDatabase,liveDatabase};
}
function value(file:string){return execFileSync("python3",["-c","import sqlite3,sys\ndb=sqlite3.connect(sys.argv[1]);print(db.execute('SELECT value FROM values_table ORDER BY rowid LIMIT 1').fetchone()[0]);db.close()",file],{encoding:"utf8"}).trim();}
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});

describe("verified Windows database restore",()=>{
  it("stops the database, restores through a verified temporary copy, and preserves the prior live database",async()=>{
    const item=fixture(),events:string[]=[];
    const result=await restoreVerifiedDatabaseSnapshot({...item,withDatabaseStopped:async operation=>{events.push("stopped");const value=await operation();events.push("released");return value;},platform:"linux"});
    expect(events).toEqual(["stopped","released"]);
    expect(value(item.liveDatabase)).toBe("snapshot");
    expect(value(result.previousDatabase)).toBe("live");
    expect(fs.existsSync(result.recoveryFile)).toBe(true);
    expect(path.dirname(result.previousDatabase)).toBe(path.dirname(item.liveDatabase));
    expect(fs.readdirSync(item.root).filter(name=>name.includes(".restore-"))).toEqual([]);
  });
  it("reverts a completed restore from its durable journal",async()=>{
    const item=fixture(),result=await restoreVerifiedDatabaseSnapshot({...item,withDatabaseStopped:async operation=>operation(),platform:"linux"});
    expect(value(item.liveDatabase)).toBe("snapshot");
    expect(settleVerifiedDatabaseRestore({liveDatabase:item.liveDatabase,decision:"revert"})).toEqual({settled:true,previousDatabase:null});
    expect(value(item.liveDatabase)).toBe("live");
    expect(fs.existsSync(result.recoveryFile)).toBe(false);
  });
  it("commits a completed restore while retaining the previous database",async()=>{
    const item=fixture(),result=await restoreVerifiedDatabaseSnapshot({...item,withDatabaseStopped:async operation=>operation(),platform:"linux"});
    expect(settleVerifiedDatabaseRestore({liveDatabase:item.liveDatabase,decision:"commit"})).toEqual({settled:true,previousDatabase:result.previousDatabase});
    expect(value(item.liveDatabase)).toBe("snapshot");
    expect(value(result.previousDatabase)).toBe("live");
    expect(fs.existsSync(result.recoveryFile)).toBe(false);
  });
  it("preserves an original WAL left in place by a crash after only the main database moved",async()=>{
    const item=fixture();fs.writeFileSync(`${item.liveDatabase}-wal`,"original-wal");
    const result=await restoreVerifiedDatabaseSnapshot({...item,withDatabaseStopped:async operation=>operation(),platform:"linux"});
    fs.rmSync(item.liveDatabase);
    fs.renameSync(`${result.previousDatabase}-wal`,`${item.liveDatabase}-wal`);
    expect(settleVerifiedDatabaseRestore({liveDatabase:item.liveDatabase,decision:"revert"})).toEqual({settled:true,previousDatabase:null});
    expect(fs.readFileSync(`${item.liveDatabase}-wal`,"utf8")).toBe("original-wal");
    fs.rmSync(`${item.liveDatabase}-wal`);
    expect(value(item.liveDatabase)).toBe("live");
  });
  it("reports an installed restore with a missing previous base as incomplete",async()=>{
    const item=fixture(),result=await restoreVerifiedDatabaseSnapshot({...item,withDatabaseStopped:async operation=>operation(),platform:"linux"});
    fs.rmSync(result.previousDatabase);
    expect(()=>settleVerifiedDatabaseRestore({liveDatabase:item.liveDatabase,decision:"revert"})).toThrow(expect.objectContaining({code:"RESTORE_PREVIOUS_INCOMPLETE"}));
    expect(value(item.liveDatabase)).toBe("snapshot");
    expect(fs.existsSync(result.recoveryFile)).toBe(true);
    expect(settleVerifiedDatabaseRestore({liveDatabase:item.liveDatabase,decision:"commit"})).toEqual({settled:true,previousDatabase:null});
    expect(fs.existsSync(result.recoveryFile)).toBe(false);
  });
  it("rejects a modified snapshot before stopping the live database",async()=>{
    const item=fixture(),withDatabaseStopped=async()=>{throw new Error("must not stop");};
    execFileSync("python3",["-c","import sqlite3,sys\ndb=sqlite3.connect(sys.argv[1]);db.execute(\"INSERT INTO values_table(value) VALUES ('tampered')\");db.commit();db.close()",item.snapshotDatabase]);
    await expect(restoreVerifiedDatabaseSnapshot({...item,withDatabaseStopped,platform:"linux"})).rejects.toThrow(/digest/);
    expect(value(item.liveDatabase)).toBe("live");
  });
  it("moves crash sidecars with the prior database and leaves none beside the restored database",async()=>{
    const item=fixture();for(const suffix of["-wal","-shm","-journal"])fs.writeFileSync(`${item.liveDatabase}${suffix}`,suffix);
    const result=await restoreVerifiedDatabaseSnapshot({...item,withDatabaseStopped:async operation=>operation(),platform:"linux"});
    expect(value(item.liveDatabase)).toBe("snapshot");
    expect(result.previousSidecars.map(file=>fs.readFileSync(file,"utf8"))).toEqual(["-wal","-shm","-journal"]);
    for(const suffix of["-wal","-shm","-journal"])expect(fs.existsSync(`${item.liveDatabase}${suffix}`)).toBe(false);
  });
});
