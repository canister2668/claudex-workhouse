import fs from"node:fs";
import os from"node:os";
import path from"node:path";
import{spawnSync}from"node:child_process";
import{afterEach,describe,expect,it}from"vitest";
import{createPortableZip,PORTABLE_ZIP_MAX_ENTRY_PATH}from"../../src/server/windows/portable-zip.js";
import{inspectWindowsUpdateZip}from"../../src/server/windows/portable-updater.js";
import{holdWorkerLiveness,markWorkerStateStopped,stopRequestFile,watchStopRequest,workerLivenessHeld}from"../../src/server/worker-liveness.js";
import{refreshWindowsDirectProviders}from"../../src/server/windows/direct-providers.js";
import{buildWindowsBootstrapStatus}from"../../src/server/windows/bootstrap-status.js";
import{projectSlug}from"../../src/server/claude-transcript.js";
import{managedLocalWorkerEnabled}from"../../src/server/managed-local-worker.js";
import{managedCodexBinary}from"../../src/server/codex-runtime.js";

const roots:string[]=[];
const temporary=()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),"workhouse-windows-direct-"));roots.push(root);return root;};
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});

function portableTree(){
  const root=temporary(),source=path.join(root,"folder");
  fs.mkdirSync(path.join(source,"payload","1.0.0","app"),{recursive:true});
  fs.writeFileSync(path.join(source,"Claudex Workhouse.exe"),"MZ launcher");
  fs.writeFileSync(path.join(source,"current.json"),"{}\n");
  fs.writeFileSync(path.join(source,"payload","1.0.0","app","start.mjs"),"x".repeat(4096));
  fs.writeFileSync(path.join(source,"payload","1.0.0","node.exe"),Buffer.from([0,1,2,3]));
  return{root,source};
}

describe("portable Windows ZIP",()=>{
  it("writes one root folder with forward-slash ASCII names that the updater and unzip accept",()=>{
    const{root,source}=portableTree(),output=path.join(root,"portable.zip");
    const result=createPortableZip({sourceRoot:source,rootName:"Claudex Workhouse",output,date:new Date("2026-01-02T03:04:06Z")});
    expect(result.entries.map(item=>item.name)).toEqual(["Claudex Workhouse/Claudex Workhouse.exe","Claudex Workhouse/current.json","Claudex Workhouse/payload/1.0.0/app/start.mjs","Claudex Workhouse/payload/1.0.0/node.exe"]);
    expect(result.entries.find(item=>item.name.endsWith("start.mjs"))?.method).toBe(8);
    expect(()=>inspectWindowsUpdateZip(output)).not.toThrow();
    const unzip=spawnSync("unzip",["-tq",output],{encoding:"utf8"});
    if(!unzip.error)expect(unzip.status,unzip.stdout+unzip.stderr).toBe(0);
  });

  it("is byte-for-byte reproducible for the same tree and date",()=>{
    const{root,source}=portableTree(),date=new Date("2026-01-02T03:04:06Z");
    createPortableZip({sourceRoot:source,rootName:"Claudex Workhouse",output:path.join(root,"a.zip"),date});
    createPortableZip({sourceRoot:source,rootName:"Claudex Workhouse",output:path.join(root,"b.zip"),date});
    expect(fs.readFileSync(path.join(root,"a.zip")).equals(fs.readFileSync(path.join(root,"b.zip")))).toBe(true);
  });

  it("refuses names Explorer could not extract",()=>{
    const{root,source}=portableTree();
    fs.writeFileSync(path.join(source,"snow ☃.txt"),"x");
    expect(()=>createPortableZip({sourceRoot:source,rootName:"Claudex Workhouse",output:path.join(root,"ascii.zip")})).toThrow(/not printable ASCII/);
    fs.rmSync(path.join(source,"snow ☃.txt"));
    const deep=path.join(source,"d".repeat(60),"e".repeat(60));fs.mkdirSync(deep,{recursive:true});fs.writeFileSync(path.join(deep,"f".repeat(40)),"x");
    expect(()=>createPortableZip({sourceRoot:source,rootName:"Claudex Workhouse",output:path.join(root,"long.zip")})).toThrow(new RegExp(`exceeds ${PORTABLE_ZIP_MAX_ENTRY_PATH} characters`));
    expect(fs.existsSync(path.join(root,"long.zip"))).toBe(false);
  });

  it("refuses symbolic links",()=>{
    const{root,source}=portableTree();
    fs.symlinkSync(path.join(source,"current.json"),path.join(source,"link.json"));
    expect(()=>createPortableZip({sourceRoot:source,rootName:"Claudex Workhouse",output:path.join(root,"link.zip")})).toThrow(/symbolic link/);
  });
});

describe("Windows worker liveness and stop requests",()=>{
  it("is inert outside Windows and reports a missing lock as not running",()=>{
    const state=path.join(temporary(),"task.json");
    holdWorkerLiveness(state,"linux");
    expect(fs.existsSync(`${state}.alive`)).toBe(false);
    expect(workerLivenessHeld(state)).toBe(false);
    expect(watchStopRequest(state,()=>{throw new Error("must not run");},"linux")).toBeTypeOf("function");
  });

  it("runs the worker's own stop path once when a stop is requested",async()=>{
    const state=path.join(temporary(),"task.json");let stops=0;
    const cancel=watchStopRequest(state,()=>{stops++;},"win32",10);
    fs.writeFileSync(stopRequestFile(state),"now\n");
    for(let attempt=0;attempt<100&&!stops;attempt++)await new Promise(resolve=>setTimeout(resolve,10));
    fs.writeFileSync(stopRequestFile(state),"again\n");
    await new Promise(resolve=>setTimeout(resolve,60));cancel();
    expect(stops).toBe(1);
  });

  it("records a forced stop as stopped and leaves terminal states alone",()=>{
    const directory=temporary(),running=path.join(directory,"running.json"),completed=path.join(directory,"completed.json");
    fs.writeFileSync(running,JSON.stringify({status:"running",error:"x",sessionId:"s"}));
    fs.writeFileSync(completed,JSON.stringify({status:"completed",result:"done"}));
    markWorkerStateStopped(running);markWorkerStateStopped(completed);
    expect(JSON.parse(fs.readFileSync(running,"utf8"))).toMatchObject({status:"stopped",error:null,sessionId:"s"});
    expect(JSON.parse(fs.readFileSync(completed,"utf8"))).toEqual({status:"completed",result:"done"});
  });
});

describe("Windows direct provider execution",()=>{
  it("no longer routes local execution through a managed Worker",()=>{
    expect(managedLocalWorkerEnabled("win32")).toBe(false);
  });

  it("applies discovered CLIs without overriding a managed runtime or a user setting",async()=>{
    const dataRoot=temporary(),config={claudeBinary:"C:\\missing\\claude.exe"},environment:NodeJS.ProcessEnv={};
    const discover=async({provider}:{provider:"claude"|"codex"})=>({record:{selectedPath:null,verifiedPath:`C:\\cli\\${provider}.exe`,source:"official-cli" as const,interfaceKind:"cli" as const,version:"1.0.0",verifiedAt:"t",lastError:null},discovery:{provider,platform:"win32" as const,presenceDetected:true,runtimeAvailable:true,officialAppDetected:false,appInterfaceAvailable:true,binaryPath:`C:\\cli\\${provider}.exe`,source:"official-cli" as const,interfaceKind:"cli" as const,version:"1.0.0",checkedAt:"t",errorCategory:null}});
    await refreshWindowsDirectProviders({dataRoot,config,environment,discover:discover as any});
    expect(config.claudeBinary).toBe("C:\\cli\\claude.exe");
    expect(environment.CLAUDEX_WORKHOUSE_CODEX_BIN).toBe("C:\\cli\\codex.exe");
    expect(JSON.parse(fs.readFileSync(path.join(dataRoot,"config","windows-provider-binaries.json"),"utf8")).codex.verifiedPath).toBe("C:\\cli\\codex.exe");
    // A runtime installed from the in-app setup takes over, and the value this
    // module set is withdrawn rather than left to shadow it.
    fs.mkdirSync(path.join(dataRoot,"runtime","claude-bin"),{recursive:true});fs.writeFileSync(path.join(dataRoot,"runtime","claude-bin","claude.exe"),"");
    const managedCodex=managedCodexBinary(dataRoot);fs.mkdirSync(path.dirname(managedCodex),{recursive:true});fs.writeFileSync(managedCodex,"");
    await refreshWindowsDirectProviders({dataRoot,config,environment,discover:discover as any});
    expect(config.claudeBinary).toBe(path.join(dataRoot,"runtime","claude-bin","claude.exe"));
    expect(environment.CLAUDEX_WORKHOUSE_CODEX_BIN).toBeUndefined();
    // An explicit user choice is never replaced.
    const userEnvironment:NodeJS.ProcessEnv={CLAUDEX_WORKHOUSE_CODEX_BIN:"D:\\mine\\codex.exe",CLAUDEX_WORKHOUSE_CLAUDE_BIN:"D:\\mine\\claude.exe"},userConfig={claudeBinary:"D:\\mine\\claude.exe"};
    await refreshWindowsDirectProviders({dataRoot:temporary(),config:userConfig,environment:userEnvironment,discover:discover as any});
    expect(userEnvironment.CLAUDEX_WORKHOUSE_CODEX_BIN).toBe("D:\\mine\\codex.exe");
    expect(userConfig.claudeBinary).toBe("D:\\mine\\claude.exe");
  });

  it("builds the launcher status without a Worker stage",()=>{
    const status=buildWindowsBootstrapStatus({payloadReady:true,dataReady:true,databaseReady:true,serverReady:true,providers:{claude:"ready",codex:"not-found"},workspaceCount:1,internalUrl:"http://127.0.0.1:3410",externalUrl:null});
    expect(status.stages.map(item=>item.id)).toEqual(["payload","data","database","server","provider","workspace"]);
    expect(status.overall).toBe("ready");
  });

  it("derives Claude Code's Windows project folder name",()=>{
    expect(projectSlug("C:\\Users\\me\\my proj.v2","win32")).toBe("C--Users-me-my-proj-v2");
    expect(projectSlug("/home/me/proj","linux")).toBe("-home-me-proj");
  });
});
