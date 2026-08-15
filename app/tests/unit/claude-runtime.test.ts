import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readClaudeRuntime } from "../../src/server/claude-runtime.js";

describe("Claude runtime metadata",()=>{
  it("returns only verified managed metadata",()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),"deck-runtime-"));
    fs.mkdirSync(path.join(root,"runtime","claude-bin"),{recursive:true});
    fs.writeFileSync(path.join(root,"runtime","claude-bin","claude-runtime.json"),JSON.stringify({source:"anthropic-official",version:"2.1.207",checksum:"a".repeat(64),platform:"linux-x64",channel:"latest",buildDate:"2026-07-10T21:39:38Z",verifiedAt:"2026-07-13T15:44:06Z",ignored:{secret:"no"}}));
    expect(readClaudeRuntime(root)).toEqual({managed:true,version:"2.1.207",checksum:"a".repeat(64),platform:"linux-x64",channel:"latest",source:"anthropic-official",buildDate:"2026-07-10T21:39:38Z",verifiedAt:"2026-07-13T15:44:06Z"});
    fs.rmSync(root,{recursive:true,force:true});
  });
  it("fails closed when metadata is missing",()=>{
    expect(readClaudeRuntime("/missing/claudex-workhouse")).toMatchObject({managed:false,version:null,checksum:null});
  });
});
