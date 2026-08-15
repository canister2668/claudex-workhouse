import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach,describe,expect,it}from"vitest";
import{managedCodexBinary,managedCodexRuntime}from"../../src/server/codex-runtime.js";

const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
function root(){const value=fs.mkdtempSync(path.join(os.tmpdir(),"codex-runtime-state-"));roots.push(value);return value;}
function executable(file:string){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,"binary",{mode:0o700});}

describe("managed Codex runtime state",()=>{
  it("selects a verified versioned regular file",()=>{
    const dataRoot=root(),binary=path.join(dataRoot,"runtime","codex-home","packages","standalone","releases","0.147.0-x86_64","bin","codex");executable(binary);
    fs.writeFileSync(path.join(dataRoot,"runtime","codex-runtime.json"),JSON.stringify({schema:1,source:"openai-standalone",version:"0.147.0",binary:path.relative(dataRoot,binary),sha256:"a".repeat(64)}));
    expect(managedCodexRuntime(dataRoot,"linux")).toMatchObject({binary,version:"0.147.0",checksum:"a".repeat(64),source:"openai-standalone"});
    expect(managedCodexBinary(dataRoot,"linux")).toBe(binary);
  });

  it("does not treat a linked legacy directory as managed",()=>{
    const dataRoot=root(),target=path.join(dataRoot,"target");executable(path.join(target,"codex"));fs.mkdirSync(path.join(dataRoot,"runtime"),{recursive:true});fs.symlinkSync(target,path.join(dataRoot,"runtime","codex-bin"),"dir");
    expect(managedCodexRuntime(dataRoot,"linux")).toBeNull();
  });
});
