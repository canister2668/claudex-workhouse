import fs from"node:fs";
import os from"node:os";
import path from"node:path";
import{spawnSync}from"node:child_process";
import{describe,expect,it}from"vitest";

describe("runtime bootstrap roots",()=>{
  it("does not inherit an installer-owned provider path as a service override",()=>{
    const source=fs.readFileSync(path.resolve("..","bin","claudex-workhouse.mjs"),"utf8");
    expect(source).toContain('["CLAUDEX_WORKHOUSE_CODEX_BIN","CLAUDEX_WORKHOUSE_CLAUDE_BIN"]');
    expect(source).toContain('path.relative(path.join(dataRoot,"runtime")');
    expect(source).toContain("delete base[key]");
  });
  it("reads managed runtimes from dataRoot while running installers from appRoot",()=>{
    const fixture=fs.mkdtempSync(path.join(os.tmpdir(),"runtime-bootstrap-"));
    const appRoot=path.join(fixture,"app"),dataRoot=path.join(fixture,"data");
    try{
      fs.mkdirSync(path.join(appRoot,"bin"),{recursive:true});
      fs.mkdirSync(path.join(dataRoot,"runtime","claude-bin"),{recursive:true});
      fs.mkdirSync(path.join(dataRoot,"runtime","codex-bin"),{recursive:true});
      for(const provider of["claude","codex"]){
        const binary=path.join(dataRoot,"runtime",`${provider}-bin`,provider);
        fs.writeFileSync(binary,"#!/bin/sh\nexit 0\n");
        fs.chmodSync(binary,0o700);
      }
      fs.writeFileSync(path.join(appRoot,"bin","claude-runtime.mjs"),'throw new Error("managed Claude should not invoke installer");\n');
      fs.writeFileSync(path.join(appRoot,"bin","codex-runtime.mjs"),'console.log(JSON.stringify({changed:false,cwd:process.cwd(),root:process.env.CLAUDEX_WORKHOUSE_ROOT,appRoot:process.env.CLAUDEX_WORKHOUSE_APP_ROOT,dataRoot:process.env.CLAUDEX_WORKHOUSE_DATA_ROOT}));\n');
      const env={...process.env,CLAUDEX_WORKHOUSE_ROOT:fixture,CLAUDEX_WORKHOUSE_APP_ROOT:appRoot,CLAUDEX_WORKHOUSE_DATA_ROOT:dataRoot};
      delete env.CLAUDEX_WORKHOUSE_CLAUDE_BIN;
      delete env.CLAUDEX_WORKHOUSE_CODEX_BIN;
      const result=spawnSync(process.execPath,[path.resolve("..","bin","runtime-bootstrap.mjs")],{
        encoding:"utf8",
        env,
      });
      expect(result.status,result.stderr).toBe(0);
      const output=JSON.parse(result.stdout);
      expect(output.runtimes[0]).toMatchObject({provider:"claude",changed:false,source:"managed"});
      expect(output.runtimes[1].result).toMatchObject({cwd:appRoot,root:dataRoot,appRoot,dataRoot});
      expect(fs.existsSync(path.join(appRoot,"runtime"))).toBe(false);
    }finally{fs.rmSync(fixture,{recursive:true,force:true});}
  });
});
