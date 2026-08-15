import fs from "node:fs";
import path from "node:path";
import { describe,expect,it } from "vitest";
import { codexBinary,codexVersionFromTag,managedRuntimeBinary,updateAvailable,versionFromOutput } from "../../src/server/runtime-updates.js";

describe("runtime update parsing",()=>{
  it("parses provider versions without accepting arbitrary tags",()=>{
    expect(versionFromOutput("codex-cli 0.144.3")).toBe("0.144.3");
    expect(versionFromOutput("2.1.207 (Claude Code)")).toBe("2.1.207");
    expect(codexVersionFromTag("rust-v0.144.3")).toBe("0.144.3");
    expect(codexVersionFromTag("nightly-latest")).toBeNull();
  });
  it("reports update state for the configured Codex, never a path it does not run",()=>{
    const previous=process.env.CLAUDEX_WORKHOUSE_CODEX_BIN;
    try{
      delete process.env.CLAUDEX_WORKHOUSE_CODEX_BIN;
      // No PATH fallback: an older global npm install must not stand in for a
      // managed runtime.
      expect(codexBinary("/var/lib/claudex","linux")).toBe("/usr/local/bin/codex");
      process.env.CLAUDEX_WORKHOUSE_CODEX_BIN="/opt/provisioned/bin/codex";
      expect(codexBinary("/var/lib/claudex","linux")).toBe("/opt/provisioned/bin/codex");
      expect(codexBinary("C:\\data","win32")).toBe("/opt/provisioned/bin/codex");
    }finally{
      if(previous===undefined)delete process.env.CLAUDEX_WORKHOUSE_CODEX_BIN;else process.env.CLAUDEX_WORKHOUSE_CODEX_BIN=previous;
    }
  });

  it("distinguishes unchecked, current, and update-available states",()=>{
    expect(updateAvailable("0.144.1",null)).toBeNull();
    expect(updateAvailable("0.144.3","0.144.3")).toBe(false);
    expect(updateAvailable("0.144.1","0.144.3")).toBe(true);
  });
  it("isolates each managed provider without sharing a runtime directory",()=>{
    const root="C:\\Users\\Alice\\AppData\\Local\\Claudex Workhouse";
    expect(managedRuntimeBinary(root,"codex","win32")).toBe(`${root}\\runtime\\codex-bin\\codex.exe`);
    expect(managedRuntimeBinary(root,"claude","win32")).toBe(`${root}\\runtime\\claude-bin\\claude.exe`);
  });
  it("installs verified standalone packages without a junction",()=>{
    const source=fs.readFileSync(path.resolve("..","bin","codex-runtime.mjs"),"utf8");
    expect(source).toContain('path.join(root,"runtime","codex-home")');
    expect(source).toContain('path.join(root,"runtime","codex-bin")');
    expect(source).toContain('"https://releases.openai.com/codex/channels/latest"');
    expect(source).toContain('releaseAsset(metadata,"codex-package_SHA256SUMS")');
    expect(source).toContain("Codex package hashes disagreed between release metadata and checksum manifest.");
    expect(source).toContain('path.join(releaseDir,"bin",executableName)');
    expect(source).toContain('process.platform==="win32"?"codex.exe":"codex"');
    expect(source).toContain('process.platform==="win32"?"tar.exe":"tar"');
    expect(source).toContain('source:"openai-standalone"');
    expect(source).not.toContain("install.sh");
  });
  it("supports the verified official Claude Windows artifact",()=>{
    const source=fs.readFileSync(path.resolve("..","bin","claude-runtime.mjs"),"utf8");
    expect(source).toContain('process.platform==="win32"?"claude.exe":"claude"');
    expect(source).toContain('process.platform==="win32"?"win32"');
    expect(source).toContain("artifact.binary");
    expect(source).toContain('path.join(root,"runtime","claude-bin")');
  });
});
