import fs from"node:fs";
import os from"node:os";
import path from"node:path";
import{afterEach,describe,expect,it}from"vitest";
import{DeckDatabase}from"../../src/server/db/client.js";

const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
async function fixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),"prompt-presets-"));roots.push(root);const db=new DeckDatabase(path.resolve("src/server/db/sqlite-worker.py"),path.join(root,"db.sqlite"));await db.ping();return db;}

describe("prompt preset compare-and-swap persistence",()=>{
  it("allows one device revision and rejects a stale competing revision without overwriting it",async()=>{
    const db=await fixture(),first={version:1,presets:[{id:"one",label:"One",prompt:"first"}]},second={version:1,presets:[{id:"two",label:"Two",prompt:"second"}]};
    expect(await db.putSystemSettingIfUpdated("ui.prompt-presets",first,"2026-07-29T10:00:00.000Z",null)).toMatchObject({updated:true});
    const [winner,loser]=await Promise.all([
      db.putSystemSettingIfUpdated("ui.prompt-presets",second,"2026-07-29T10:01:00.000Z","2026-07-29T10:00:00.000Z"),
      db.putSystemSettingIfUpdated("ui.prompt-presets",{version:1,presets:[]},"2026-07-29T10:02:00.000Z","2026-07-29T10:00:00.000Z")
    ]);
    expect([winner,loser].filter(result=>result.updated)).toHaveLength(1);
    const stored=await db.getSystemSetting("ui.prompt-presets");
    expect(stored?.updatedAt).toMatch(/^2026-07-29T10:0[12]:/);
    expect(stored?.value.presets).toHaveLength(winner.updated?1:0);
    await db.close();
  });
});
