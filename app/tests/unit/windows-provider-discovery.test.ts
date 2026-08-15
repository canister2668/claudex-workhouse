import{describe,expect,it}from"vitest";
import fs from"node:fs";
import os from"node:os";
import path from"node:path";
import{discoverWindowsProvider,windowsProviderFileInfo,windowsProviderReadyState,type WindowsProviderDiscoveryDependencies}from"../../src/server/windows/provider-discovery.js";

const info=(realPath:string,reparse=false)=>({regular:true,reparse,realPath});
const dependencies=(files:Record<string,{realPath?:string;reparse?:boolean}>,where:string[]=[]):WindowsProviderDiscoveryDependencies=>({
  environment:{LOCALAPPDATA:"C:\\Users\\테스트\\AppData\\Local",USERPROFILE:"C:\\Users\\테스트"},
  homeDir:"C:\\Users\\테스트",
  fileInfo:file=>files[file.toLowerCase()]?info(files[file.toLowerCase()].realPath??file,files[file.toLowerCase()].reparse):null,
  run:async file=>({exitCode:0,stdout:`${file.includes("claude")?"Claude Code":"codex-cli"} 1.2.3`,stderr:""}),
  where:async()=>where,
  now:()=>"2026-07-30T00:00:00.000Z"
});

describe("Windows Provider discovery",()=>{
  it("honors a verified user selection before every ambient candidate",async()=>{
    const selected="C:\\도구 모음\\codex.exe",ambient="C:\\Path\\codex.exe",seen:string[]=[];
    const deps=dependencies({[selected.toLowerCase()]:{},[ambient.toLowerCase()]:{}},[ambient]);
    deps.run=async(file,args)=>{seen.push(`${file} ${args.join(" ")}`);return{exitCode:0,stdout:"codex-cli 4.5.6",stderr:""};};
    const result=await discoverWindowsProvider({provider:"codex",selectedPath:selected,dependencies:deps});
    expect(result.discovery).toMatchObject({presenceDetected:true,runtimeAvailable:true,appInterfaceAvailable:true,binaryPath:selected,source:"user-selected",version:"4.5.6"});
    expect(result.record).toMatchObject({selectedPath:selected,verifiedPath:selected,source:"user-selected",verifiedAt:"2026-07-30T00:00:00.000Z"});
    expect(seen).toEqual([`${selected} --version`]);
  });

  it("fails a stale selection closed instead of silently switching binaries",async()=>{
    const ambient="C:\\Path\\claude.exe";
    const result=await discoverWindowsProvider({provider:"claude",record:{selectedPath:"C:\\Missing\\claude.exe",verifiedPath:ambient},dependencies:dependencies({[ambient.toLowerCase()]:{}},[ambient])});
    expect(result.discovery).toMatchObject({appInterfaceAvailable:false,errorCategory:"not-regular-file"});
    expect(result.record.selectedPath).toBe("C:\\Missing\\claude.exe");
  });

  it("rejects UNC, reparse, wrong-name, and versionless candidates",async()=>{
    for(const[selectedPath,files,run]of[
      ["\\\\server\\share\\codex.exe",{},undefined],
      ["//server/share/codex.exe",{},undefined],
      ["\\Work\\codex.exe",{},undefined],
      ["/Work/codex.exe",{},undefined],
      ["C:\\Tools\\codex.exe",{"c:\\tools\\codex.exe":{reparse:true}},undefined],
      ["C:\\Tools\\renamed.exe",{"c:\\tools\\renamed.exe":{}},undefined],
      ["C:\\Tools\\codex.exe",{"c:\\tools\\codex.exe":{}},async()=>({exitCode:0,stdout:"unknown",stderr:""})]
    ]as const){
      const deps=dependencies(files as any);if(run)deps.run=run;
      const result=await discoverWindowsProvider({provider:"codex",selectedPath,dependencies:deps});
      expect(result.discovery.appInterfaceAvailable).toBe(false);
    }
  });

  it("rejects a managed installer junction just like every other reparse point",async()=>{
    const selected="C:\\Workhouse\\runtime\\codex-bin\\codex.exe",real="C:\\Workhouse\\runtime\\codex-home\\packages\\standalone\\current\\bin\\codex.exe";
    const result=await discoverWindowsProvider({provider:"codex",selectedPath:selected,dependencies:dependencies({[selected.toLowerCase()]:{realPath:real,reparse:true}})});
    expect(result.discovery).toMatchObject({appInterfaceAvailable:false,binaryPath:null,errorCategory:"reparse-point"});
    expect(result.record.verifiedPath).toBeNull();
  });

  it("distinguishes an official desktop app from a callable interface without reading credential stores",async()=>{
    const app="C:\\Users\\테스트\\AppData\\Local\\Programs\\Claude\\Claude.exe",inspected:string[]=[];
    const deps=dependencies({[app.toLowerCase()]:{}});
    const original=deps.fileInfo!;deps.fileInfo=file=>{inspected.push(file);return original(file);};
    const result=await discoverWindowsProvider({provider:"claude",dependencies:deps});
    expect(result.discovery).toMatchObject({presenceDetected:true,runtimeAvailable:false,officialAppDetected:true,appInterfaceAvailable:false,errorCategory:"app-interface-unavailable"});
    expect(inspected.some(file=>/credential|token|\\.claude[/\\]|\\.codex[/\\]/i.test(file))).toBe(false);
  });

  it("separates installed, login, diagnostic, and task-ready states",async()=>{
    const discovery=(await discoverWindowsProvider({provider:"codex",selectedPath:"C:\\Tools\\codex.exe",dependencies:dependencies({"c:\\tools\\codex.exe":{}})})).discovery;
    expect(windowsProviderReadyState({discovery,accountState:"disconnected",workspaceAccessible:true,executionPolicyReady:true})).toBe("login-required");
    expect(windowsProviderReadyState({discovery,accountState:"connected",workspaceAccessible:false,executionPolicyReady:true})).toBe("diagnostic-required");
    expect(windowsProviderReadyState({discovery,accountState:"connected",workspaceAccessible:true,executionPolicyReady:false})).toBe("diagnostic-required");
    expect(windowsProviderReadyState({discovery,accountState:"connected",workspaceAccessible:true,executionPolicyReady:true})).toBe("ready");
    expect(windowsProviderReadyState({discovery:{...discovery,appInterfaceAvailable:false,officialAppDetected:false},accountState:"unknown",workspaceAccessible:true,executionPolicyReady:true})).toBe("not-found");
  });

  it("accepts a managed binary reached through a junctioned ancestor directory and reports its physical path",async()=>{
    // A relocated data root or redirected user profile puts a junction above
    // the managed runtime. Rejecting that as a reparse point reported
    // `runtime-unavailable` for a Codex executable that was present and
    // runnable, which is what the Windows managed-CLI status showed.
    const linked="C:\\Data\\link\\runtime\\codex-bin\\codex.exe",real="C:\\Data\\real\\runtime\\codex-bin\\codex.exe";
    const result=await discoverWindowsProvider({provider:"codex",selectedPath:linked,dependencies:dependencies({[linked.toLowerCase()]:{realPath:real}})});
    expect(result.discovery).toMatchObject({runtimeAvailable:true,appInterfaceAvailable:true,binaryPath:real,errorCategory:null});
    expect(result.record.verifiedPath).toBe(real);
  });

  it("still refuses a candidate that is itself a reparse point",async()=>{
    const link="C:\\Tools\\codex.exe";
    const result=await discoverWindowsProvider({provider:"codex",selectedPath:link,dependencies:dependencies({[link.toLowerCase()]:{realPath:"C:\\Real\\codex.exe",reparse:true}})});
    expect(result.discovery).toMatchObject({runtimeAvailable:false,binaryPath:null,errorCategory:"reparse-point"});
  });

  it("classifies real symlinked parents and symlinked binaries the same way on disk",()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),"provider-discovery-"));
    try{
      const real=path.join(root,"real");fs.mkdirSync(real);
      const binary=path.join(real,"codex.exe");fs.writeFileSync(binary,"#!/bin/sh\n",{mode:0o700});
      fs.symlinkSync(real,path.join(root,"link"),"dir");
      const throughJunction=windowsProviderFileInfo(path.join(root,"link","codex.exe"));
      expect(throughJunction).toMatchObject({regular:true,reparse:false});
      expect(fs.realpathSync(throughJunction!.realPath)).toBe(fs.realpathSync(binary));
      // A redirected leaf (file symlink, or a Windows AppExecLink alias that
      // lstat still reports as a regular file) stays rejected.
      fs.symlinkSync(binary,path.join(root,"aliased.exe"));
      expect(windowsProviderFileInfo(path.join(root,"aliased.exe"))).toBeNull();
      const other=path.join(real,"other.exe");fs.writeFileSync(other,"#!/bin/sh\n",{mode:0o700});
      expect(windowsProviderFileInfo(other)).toMatchObject({regular:true,reparse:false});
    }finally{fs.rmSync(root,{recursive:true,force:true});}
  });
});
