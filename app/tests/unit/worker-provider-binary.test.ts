import fs from "node:fs";
import path from "node:path";
import {describe,expect,it} from "vitest";
import {workerProviderBinary} from "../../src/server/desktop-worker/tasks.js";
import type {WorkerConfig} from "../../src/server/desktop-worker/config.js";

const config=(overrides:Partial<WorkerConfig>={}):WorkerConfig=>({
  schemaVersion:1,serverUrl:null,hostId:"local",credential:null,credentialVersion:0,entryKey:"k",
  roots:[],workspaces:[],tasks:[],claudeBinary:"claude",codexBinary:"codex",...overrides
});

const record=(verifiedPath:string|null,lastError:string|null=null)=>({
  selectedPath:null,verifiedPath,source:"official-cli" as const,interfaceKind:"cli" as const,
  version:"1.2.3",verifiedAt:"2026-08-14T00:00:00.000Z",lastError
});

/** The managed-CLI status a Windows user reads and the executable a Worker
 * task launches must be the same value. */
describe("Worker provider binary resolution",()=>{
  it("uses the verified Windows path over the configured fallback",()=>{
    const value=config({claudeBinary:"claude",providerBinaries:{claude:record("C:\\Users\\t\\.local\\bin\\claude.exe")}});
    expect(workerProviderBinary(value,"claude","win32")).toBe("C:\\Users\\t\\.local\\bin\\claude.exe");
  });

  it("keeps reporting and launching the same retained path after a failed re-probe",()=>{
    // Discovery keeps `verifiedPath` when a re-probe fails, and a launch would
    // still run it. Status must describe that binary rather than claim the
    // runtime is unavailable while the Worker silently launches it.
    const value=config({codexBinary:"C:\\Data\\runtime\\codex-bin\\codex.exe",providerBinaries:{codex:record("C:\\Data\\runtime\\codex-bin\\codex.exe","runtime-unavailable")}});
    expect(workerProviderBinary(value,"codex","win32")).toBe("C:\\Data\\runtime\\codex-bin\\codex.exe");
  });

  it("falls back to the configured binary when nothing was ever verified",()=>{
    expect(workerProviderBinary(config({providerBinaries:{codex:record(null)}}),"codex","win32")).toBe("codex");
    expect(workerProviderBinary(config({providerBinaries:{codex:record("   ")}}),"codex","win32")).toBe("codex");
    expect(workerProviderBinary(config(),"codex","win32")).toBe("codex");
  });

  it("ignores the Windows-only record on other platforms",()=>{
    const value=config({codexBinary:"/usr/local/bin/codex",providerBinaries:{codex:record("C:\\Tools\\codex.exe")}});
    expect(workerProviderBinary(value,"codex","linux")).toBe("/usr/local/bin/codex");
  });

  it("is the single resolver used by launch, status, sessions and the sandbox probe",()=>{
    const source=fs.readFileSync(path.resolve("src/server/desktop-worker/tasks.ts"),"utf8");
    expect(source).not.toMatch(/this\.config\.(claudeBinary|codexBinary)/);
    expect(source).not.toMatch(/useCodexBinary\(config\.codexBinary\)/);
    expect(source.match(/workerProviderBinary\(/g)?.length).toBeGreaterThanOrEqual(7);
  });
});
