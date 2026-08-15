import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApplicationUpdateSnapshot } from "../../src/server/application-update-snapshot.js";
import { normalizeApplicationInstallMetadata } from "../../src/server/application-updates.js";
import { DeckDatabase } from "../../src/server/db/client.js";

const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
describe("application update recovery snapshot",()=>{
  it("uses SQLite online backup and records only the approved config allowlist",async()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),"application-update-snapshot-"));roots.push(root);const dataRoot=path.join(root,"data-root"),config=path.join(dataRoot,"config"),dbPath=path.join(dataRoot,"data","workhouse.sqlite");fs.mkdirSync(config,{recursive:true});fs.mkdirSync(path.dirname(dbPath),{recursive:true});
    fs.writeFileSync(path.join(config,"claudex-workhouse.json"),"{}\n");fs.writeFileSync(path.join(config,"projects.json"),"{\"projects\":[]}\n");fs.writeFileSync(path.join(config,"secret-token.txt"),"must not copy\n");
    const db=new DeckDatabase(path.resolve("src/server/db/sqlite-worker.py"),dbPath);await db.ping();await db.putSystemSetting("fixture",{ok:true},new Date().toISOString());await db.close();
    const attemptId=crypto.randomUUID(),snapshot=createApplicationUpdateSnapshot({attemptId,snapshotRoot:path.join(dataRoot,"snapshots"),dataRoot,dbPath,metadata:normalizeApplicationInstallMetadata({version:"1.0.0",installMethod:"docker-compose",platform:"linux",architecture:"x64",imageDigest:`sha256:${"a".repeat(64)}`,updaterProtocolVersion:1})});
    expect(path.basename(snapshot.directory)).toBe(attemptId);expect(fs.readdirSync(snapshot.directory).sort()).toEqual(["COMPLETE","claudex-workhouse.json","claudex-workhouse.sqlite","installation-metadata.json","manifest.json","projects.json"]);
    expect(fs.statSync(snapshot.directory).mode&0o777).toBe(0o700);for(const name of fs.readdirSync(snapshot.directory))expect(fs.statSync(path.join(snapshot.directory,name)).mode&0o777).toBe(0o600);
    const verify=new DeckDatabase(path.resolve("src/server/db/sqlite-worker.py"),path.join(snapshot.directory,"claudex-workhouse.sqlite"));try{expect((await verify.getSystemSetting("fixture"))?.value).toEqual({ok:true});}finally{await verify.close();}
    expect(JSON.parse(fs.readFileSync(path.join(snapshot.directory,"manifest.json"),"utf8"))).toMatchObject({verification:"verified",quickCheck:"ok",sourceVersion:"1.0.0"});
  });
});
