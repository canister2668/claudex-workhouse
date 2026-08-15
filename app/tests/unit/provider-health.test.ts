import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach,describe,expect,it,vi} from "vitest";
import {CodexProvider} from "../../src/server/providers/codex.js";

const roots:string[]=[];
afterEach(()=>{
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});
});

function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"provider-health-"));roots.push(root);
  const binary="/bin/echo";
  vi.stubEnv("CLAUDEX_WORKHOUSE_CODEX_BIN",binary);
  const provider=new CodexProvider({root,dataDir:root,projects:[]} as any,{} as any);
  return{root,binary,provider};
}

describe("Codex provider health",()=>{
  it("checks the runtime used by Workhouse and ignores unrelated legacy cx doctor state",async()=>{
    const{provider}=fixture(),legacy=vi.spyOn(provider as any,"cx").mockRejectedValue(new Error("stale broker"));
    await expect(provider.healthCheck()).resolves.toMatchObject({ok:true,detail:{category:"ready",source:"configured",version:expect.stringContaining("echo")}});
    expect(legacy).not.toHaveBeenCalled();
  });

  it("returns a structured runtime error when the configured executable is missing",async()=>{
    const{root,provider}=fixture();vi.stubEnv("CLAUDEX_WORKHOUSE_CODEX_BIN",path.join(root,"missing-codex"));
    await expect(provider.healthCheck()).resolves.toEqual({ok:false,detail:{category:"runtime_not_found",source:"configured",version:null,code:"ENOENT"}});
  });
});
