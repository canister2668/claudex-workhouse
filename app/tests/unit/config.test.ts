import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(()=>{
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("configured projects", () => {
  it("loads configured accessible directories without an approval identity", async() => {
    const root=fs.mkdtempSync(path.join(os.tmpdir(),"claudex-workhouse-load-config-")),configDir=path.join(root,"config"),projectsDir=path.join(root,"projects");
    const claudeBinary=path.join(root,"runtime","bin","claude");
    fs.mkdirSync(configDir,{recursive:true});fs.mkdirSync(projectsDir,{recursive:true});fs.mkdirSync(path.dirname(claudeBinary),{recursive:true});fs.writeFileSync(claudeBinary,"#!/bin/sh\nexit 0\n",{mode:0o700});
    fs.writeFileSync(path.join(configDir,"claudex-workhouse.json"),JSON.stringify({
      host:"127.0.0.1",port:3410,externalOrigin:"http://127.0.0.1:3410",allowedEmail:"admin@example.com",teamDomain:"",audience:"",authMode:"local",promptMaxLength:50000,commandTimeoutMs:60000,commandOutputLimit:1048576,claudeBinary:"runtime/bin/claude"
    }));
    fs.writeFileSync(path.join(configDir,"projects.json"),JSON.stringify({projects:[
      {id:"fixture",name:"Fixture",path:projectsDir},
      {id:"claudex-workhouse",name:"Claudex Workhouse",path:"/ignored-for-owned-root"}
    ]}));
    vi.stubEnv("CLAUDEX_WORKHOUSE_APP_ROOT","");vi.stubEnv("CLAUDEX_WORKHOUSE_DATA_ROOT","");vi.stubEnv("CLAUDEX_WORKHOUSE_ROOT",root);vi.stubEnv("CLAUDEX_WORKHOUSE_CLAUDE_BIN",claudeBinary);vi.resetModules();
    const{loadConfig}=await import("../../src/server/config.js");
    const config = loadConfig();
    try{
      expect(config.root).toBe(root);
      expect(config.appRoot).toBe(root);
      expect(config.dataRoot).toBe(root);
      expect(config.claudeBinary).toBe(path.join(root,"runtime","bin","claude"));
      expect(config.claudeBinary).not.toContain(".vscode-server");
      expect(config.emotionStateFile).toBe(path.join(root,"data","emotion","state.json"));
      // The catalog reads the directory the static server publishes as
      // `/emoticons`, which is `app/dist`. Neither directory exists in this
      // fixture, so the resolver names the built path it will serve from.
      expect(config.emotionAssetsDir).toBe(path.join(root,"app","dist","emoticons"));
      expect(config.emotionAssetBaseUrl).toBe(new URL(config.externalOrigin).origin);
      expect(config.projects.map((item) => item.id)).toEqual(["fixture","claudex-workhouse"]);
      expect(config.projects.every(item=>item.enabled&&item.realPath===item.path)).toBe(true);
    }finally{fs.rmSync(root,{recursive:true,force:true});}
  });

  it("loads immutable application files separately from mutable data",async()=>{
    const appRoot=fs.mkdtempSync(path.join(os.tmpdir(),"claudex-workhouse-app-root-")),dataRoot=fs.mkdtempSync(path.join(os.tmpdir(),"claudex-workhouse-data-root-")),configDir=path.join(dataRoot,"config"),claudeBinary=path.join(dataRoot,"runtime","bin","claude");
    fs.mkdirSync(configDir,{recursive:true});fs.mkdirSync(path.dirname(claudeBinary),{recursive:true});fs.writeFileSync(claudeBinary,"#!/bin/sh\nexit 0\n",{mode:0o700});
    fs.writeFileSync(path.join(configDir,"claudex-workhouse.json"),JSON.stringify({host:"127.0.0.1",port:3410,externalOrigin:"http://127.0.0.1:3410",allowedEmail:"admin@example.com",teamDomain:"",audience:"",authMode:"local",promptMaxLength:50000,commandTimeoutMs:60000,commandOutputLimit:1048576,claudeBinary:"runtime/bin/claude"}));
    fs.writeFileSync(path.join(configDir,"projects.json"),JSON.stringify({projects:[{id:"claudex-workhouse",name:"Claudex Workhouse",path:appRoot}]}));
    vi.stubEnv("CLAUDEX_WORKHOUSE_APP_ROOT",appRoot);vi.stubEnv("CLAUDEX_WORKHOUSE_DATA_ROOT",dataRoot);vi.stubEnv("CLAUDEX_WORKHOUSE_ROOT","");vi.stubEnv("CLAUDEX_WORKHOUSE_CLAUDE_BIN",claudeBinary);vi.resetModules();
    const{loadConfig}=await import("../../src/server/config.js");
    try{
      const config=loadConfig();
      expect(config.root).toBe(appRoot);
      expect(config.appRoot).toBe(appRoot);
      expect(config.dataRoot).toBe(dataRoot);
      expect(config.dbPath).toBe(path.join(dataRoot,"data","claudex-workhouse.sqlite"));
      expect(config.emotionAssetsDir).toBe(path.join(appRoot,"app","dist","emoticons"));
      expect(config.projects[0]?.realPath).toBe(appRoot);
    }finally{fs.rmSync(appRoot,{recursive:true,force:true});fs.rmSync(dataRoot,{recursive:true,force:true});}
  });

  it("creates all writable directories required by a fresh deployment", async() => {
    const{ensureRuntimeDirectories}=await import("../../src/server/config.js");
    const root=fs.mkdtempSync(path.join(os.tmpdir(),"claudex-workhouse-config-"));
    const config={
      dataDir:path.join(root,"data"),
      snapshotDir:path.join(root,"snapshots"),
      logDir:path.join(root,"logs"),
      runDir:path.join(root,"run"),
      tempDir:path.join(root,"runtime","tmp"),
      cacheDir:path.join(root,"runtime","cache"),
      emotionStateFile:path.join(root,"data","emotion","state.json")
    };
    try{
      ensureRuntimeDirectories(config);
      for(const directory of [config.dataDir,config.snapshotDir,config.logDir,config.runDir,config.tempDir,path.join(config.cacheDir,"npm"),path.join(config.cacheDir,"pnpm"),path.dirname(config.emotionStateFile)]){
        expect(fs.statSync(directory).isDirectory()).toBe(true);
      }
    }finally{
      fs.rmSync(root,{recursive:true,force:true});
    }
  });

  it("removes inherited broad Windows ACLs and grants only the current user through icacls",async()=>{
    const{applyWindowsDataAcl}=await import("../../src/server/config.js"),calls:Array<{command:string;args:string[]}>=[],run=(command:string,args:string[])=>{calls.push({command,args});return{status:0};};
    expect(applyWindowsDataAcl("C:\\Users\\Owner\\AppData\\Local\\Claudex Workhouse",{platform:"win32",identity:"DESKTOP\\Owner",run})).toEqual({applied:true,reason:null});
    expect(calls).toHaveLength(14);
    expect(calls[0]).toEqual({command:"icacls",args:["C:\\Users\\Owner\\AppData\\Local\\Claudex Workhouse","/grant:r","DESKTOP\\Owner:(OI)(CI)F","/Q"]});
    expect(calls[1]).toEqual({command:"icacls",args:["C:\\Users\\Owner\\AppData\\Local\\Claudex Workhouse","/inheritance:d","/remove:g","*S-1-1-0","*S-1-5-11","*S-1-5-32-545","/Q"]});
    expect(calls.filter(call=>call.args.some(value=>value.startsWith("/inheritance"))).every(call=>call.args.includes("/inheritance:d"))).toBe(true);
    expect(calls.slice(2).every(call=>call.args.includes("/T"))).toBe(true);
    expect(calls.some(call=>call.args[0]?.endsWith("\\server"))).toBe(false);
    expect(calls.flatMap(call=>call.args)).not.toContain("/C");
    expect(()=>applyWindowsDataAcl("relative",{platform:"win32",identity:"Owner",run})).toThrow("absolute Windows data root");
    expect(()=>applyWindowsDataAcl("C:\\Data",{platform:"win32",identity:"Owner",run:()=>({status:5})})).toThrow("restrict");
    expect(()=>applyWindowsDataAcl("C:\\Data",{platform:"win32",identity:"Owner",run:()=>({status:0,stdout:"Successfully processed 3 files; Failed processing 1 files"})})).toThrow("restrict");
    expect(applyWindowsDataAcl("/tmp/data",{platform:"linux",run})).toEqual({applied:false,reason:"not-windows"});
  });

  it("keeps Windows local mode bound to loopback while leaving authenticated LAN modes available",async()=>{
    const{assertPlatformControlPlaneConfig}=await import("../../src/server/config.js");
    expect(()=>assertPlatformControlPlaneConfig({host:"127.0.0.1",externalOrigin:"http://127.0.0.1:3410",authMode:"local"},"win32")).not.toThrow();
    expect(()=>assertPlatformControlPlaneConfig({host:"0.0.0.0",externalOrigin:"http://192.168.1.20:3410",authMode:"local"},"win32")).toThrow("loopback");
    expect(()=>assertPlatformControlPlaneConfig({host:"0.0.0.0",externalOrigin:"https://workhouse.example.com",authMode:"cloudflare"},"win32")).not.toThrow();
    expect(()=>assertPlatformControlPlaneConfig({host:"0.0.0.0",externalOrigin:"http://127.0.0.1:3410",authMode:"local"},"linux")).not.toThrow();
  });
});
