import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {describe,expect,it} from "vitest";
import {managedCodexBinary,managedCodexRuntime} from "../../src/server/codex-runtime.js";
import {managedRuntimeBinary} from "../../src/server/runtime-updates.js";

const repoRoot=path.resolve("..");
const contains=(parent:string,child:string)=>child.toLowerCase()===parent.toLowerCase()||child.toLowerCase().startsWith(`${parent.toLowerCase()}${path.win32.sep}`);

/** Providers share one `runtime/` tree, so a runtime install or update must be
 * confined to its own provider-owned directory. Nothing here may be relaxed
 * into a shared `runtime/bin` slot or a junction that one installer can point
 * somewhere else and another installer can then delete. */
describe("managed provider runtime path isolation",()=>{
  it("gives Codex and Claude disjoint physical Windows directories",()=>{
    const dataRoot="C:\\ProgramData\\Claudex Workhouse";
    const codex=managedRuntimeBinary(dataRoot,"codex","win32"),claude=managedRuntimeBinary(dataRoot,"claude","win32");
    expect(codex).toBe("C:\\ProgramData\\Claudex Workhouse\\runtime\\codex-bin\\codex.exe");
    expect(claude).toBe("C:\\ProgramData\\Claudex Workhouse\\runtime\\claude-bin\\claude.exe");
    expect(contains(path.win32.dirname(codex),claude)).toBe(false);
    expect(contains(path.win32.dirname(claude),codex)).toBe(false);
    // Neither provider resolves into the shared `runtime\bin` fallback slot.
    for(const binary of[codex,claude])expect(contains("C:\\ProgramData\\Claudex Workhouse\\runtime\\bin",binary)).toBe(false);
  });

  it("keeps the verified Codex release inside the Codex-owned releases tree",()=>{
    const dataRoot="C:\\Data",binary=managedCodexBinary(dataRoot,"win32");
    expect(contains("C:\\Data\\runtime",binary)).toBe(true);
    expect(binary.toLowerCase()).not.toContain("claude");
  });

  it("refuses a Codex runtime whose release directory is a link",()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),"codex-runtime-"));
    try{
      const releases=path.join(root,"runtime","codex-home","packages","standalone","releases");
      const real=path.join(root,"elsewhere","1.0.0-x86_64","bin");fs.mkdirSync(real,{recursive:true});
      const binary=path.join(real,"codex");fs.writeFileSync(binary,"#!/bin/sh\n",{mode:0o700});
      fs.mkdirSync(releases,{recursive:true});
      fs.symlinkSync(path.join(root,"elsewhere","1.0.0-x86_64"),path.join(releases,"1.0.0-x86_64"),"dir");
      const state={schema:1,source:"openai-standalone",version:"1.0.0",binary:"runtime/codex-home/packages/standalone/releases/1.0.0-x86_64/bin/codex",sha256:"a".repeat(64)};
      fs.writeFileSync(path.join(root,"runtime","codex-runtime.json"),JSON.stringify(state));
      expect(managedCodexRuntime(root,"linux")).toBeNull();
    }finally{fs.rmSync(root,{recursive:true,force:true});}
  });

  it("accepts a Codex runtime that lives in regular directories under the releases root",()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),"codex-runtime-"));
    try{
      const releaseBin=path.join(root,"runtime","codex-home","packages","standalone","releases","1.0.0-x86_64","bin");
      fs.mkdirSync(releaseBin,{recursive:true});
      const binary=path.join(releaseBin,"codex");fs.writeFileSync(binary,"#!/bin/sh\n",{mode:0o700});
      const state={schema:1,source:"openai-standalone",version:"1.0.0",binary:"runtime/codex-home/packages/standalone/releases/1.0.0-x86_64/bin/codex",sha256:"a".repeat(64)};
      fs.writeFileSync(path.join(root,"runtime","codex-runtime.json"),JSON.stringify(state));
      expect(managedCodexRuntime(root,"linux")).toMatchObject({binary,source:"openai-standalone",version:"1.0.0"});
    }finally{fs.rmSync(root,{recursive:true,force:true});}
  });

  it("limits the Codex installer's link cleanup to Codex-owned entries",()=>{
    const installer=fs.readFileSync(path.join(repoRoot,"bin","codex-runtime.mjs"),"utf8");
    const body=installer.slice(installer.indexOf("function removeInstallerLinks"),installer.indexOf("async function installStandalone"));
    // Only the Codex visible-bin entry, the Codex bin directory and the Codex
    // `current` link may be removed — never the shared directory itself and
    // never another provider's managed runtime.
    expect(body).toContain('path.join(root,"runtime","bin",process.platform==="win32"?"codex.exe":"codex")');
    expect(body).toContain("for(const link of[oldVisible,binDir,current])");
    expect(body).toContain("if(!stat.isSymbolicLink())continue;");
    expect(body).toContain("Refusing to remove an unowned Codex link");
    for(const foreign of["claude-bin","claude.exe","agy","grok","proton-drive"])expect(body,foreign).not.toContain(foreign);
  });

  it("bootstraps each provider from its own managed directory",()=>{
    const bootstrap=fs.readFileSync(path.join(repoRoot,"bin","runtime-bootstrap.mjs"),"utf8");
    expect(bootstrap).toContain('path.join(dataRoot,"runtime","claude-bin",process.platform==="win32"?"claude.exe":"claude")');
    expect(bootstrap).toContain('path.join(dataRoot,"runtime","codex-bin",process.platform==="win32"?"codex.exe":"codex")');
    expect(bootstrap).not.toMatch(/ensure\("(claude|codex)"[^\n]*"runtime","bin"/);
  });
});
