import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {afterEach,describe,expect,it} from "vitest";
import {automaticBackupRetentionPlan,createAutomaticDatabaseBackup} from "../../src/server/database-backup.js";

const created:string[]=[];afterEach(()=>{for(const item of created.splice(0))fs.rmSync(item,{recursive:true,force:true});});
function seedDb(root:string){const db=path.join(root,"data","claudex-workhouse.sqlite");fs.mkdirSync(path.dirname(db),{recursive:true});const seed=spawnSync("python3",["-c",'import sqlite3,sys; d=sqlite3.connect(sys.argv[1]); d.execute("create table sample(value text)"); d.execute("insert into sample values (\'preserved\')"); d.commit(); d.close()',db],{encoding:"utf8"});expect(seed.status,seed.stderr).toBe(0);return db;}
describe("automatic database backup",()=>{
  it("creates a verified daily snapshot and reuses the same day",()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),"claudex-workhouse-backup-"));created.push(root);const db=seedDb(root),date=new Date("2026-07-16T01:02:03.000Z"),backup=createAutomaticDatabaseBackup(root,db,date)!;expect(backup.reused).toBe(false);expect(JSON.parse(fs.readFileSync(path.join(backup.directory,"manifest.json"),"utf8"))).toMatchObject({quickCheck:"ok",source:"daily-first-start"});const check=spawnSync("python3",["-c",'import sqlite3,sys; print(sqlite3.connect(sys.argv[1]).execute("select value from sample").fetchone()[0])',backup.database],{encoding:"utf8"});expect(check.stdout.trim()).toBe("preserved");expect(createAutomaticDatabaseBackup(root,db,new Date("2026-07-16T22:00:00Z"))?.reused).toBe(true);});
  it("plans daily and weekly retention without deleting pinned backups",()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),"claudex-workhouse-retention-"));created.push(root);for(let i=0;i<40;i++){const dir=path.join(root,String(i));fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,"manifest.json"),JSON.stringify({createdAt:new Date(Date.UTC(2026,6,16-i)).toISOString()}));if(i===39)fs.writeFileSync(path.join(dir,"PINNED"),"");}const plan=automaticBackupRetentionPlan(root,7,4);expect(plan.keep).toContain(path.join(root,"39"));expect(plan.keep.length).toBeGreaterThanOrEqual(8);expect(plan.remove).not.toContain(path.join(root,"39"));});
});
