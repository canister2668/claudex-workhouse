import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TempStorageManager } from "../../src/server/temp-storage.js";
import type { DeckTask } from "../../src/server/types.js";

const roots:string[]=[];

function root(){
  const value=fs.mkdtempSync(path.join(process.cwd(),".temp-storage-test-"));
  roots.push(value);
  return value;
}

function old(target:string){
  const timestamp=new Date(Date.now()-60*60_000);
  fs.utimesSync(target,timestamp,timestamp);
}

function task(id:string,prompt:string):DeckTask{
  const timestamp=new Date().toISOString();
  return{
    id,
    provider:"codex",
    nativeId:id,
    threadId:"019fa56c-aa44-7941-93b6-c48407b06c5f",
    projectId:"default",
    title:"Temporary analysis",
    prompt,
    status:"completed",
    createdAt:timestamp,
    updatedAt:timestamp,
    result:null,
    error:null,
    log:"",
    owned:true,
    pid:null,
    pgid:null,
    processStart:null,
    commandMarker:null,
    parentThreadId:null
  };
}

afterEach(()=>{
  for(const value of roots.splice(0))fs.rmSync(value,{recursive:true,force:true});
});

describe("TempStorageManager",()=>{
  it("shows linked sessions and protects recent, open, and symbolic-link entries",async()=>{
    const tempRoot=root(),uid=process.getuid?.()??1026;
    fs.mkdirSync(path.join(tempRoot,"codex-old-analysis"));
    fs.writeFileSync(path.join(tempRoot,"codex-old-analysis","candidate.sqlite"),"data");
    old(path.join(tempRoot,"codex-old-analysis","candidate.sqlite"));
    old(path.join(tempRoot,"codex-old-analysis"));
    fs.writeFileSync(path.join(tempRoot,"codex-recent.txt"),"recent");
    fs.writeFileSync(path.join(tempRoot,"codex-open.txt"),"open");
    old(path.join(tempRoot,"codex-open.txt"));
    fs.symlinkSync(path.join(tempRoot,"codex-old-analysis"),path.join(tempRoot,"linked"));
    const manager=new TempStorageManager({
      root:tempRoot,
      workhouseRoot:tempRoot,
      serviceUid:uid,
      recentGraceMs:10*60_000,
      openNames:()=>new Set(["codex-open.txt"])
    });
    const overview=await manager.overview([task("codex:linked",`Copied ${path.join(tempRoot,"codex-old-analysis","candidate.sqlite")}`)]);
    const oldEntry=overview.entries.find(item=>item.name==="codex-old-analysis");
    expect(oldEntry?.deletable).toBe(true);
    expect(oldEntry?.sessionLinks[0]).toMatchObject({taskId:"codex:linked",source:"task-record"});
    expect(overview.entries.find(item=>item.name==="codex-recent.txt")?.blockedReason).toBe("recent");
    expect(overview.entries.find(item=>item.name==="codex-open.txt")?.blockedReason).toBe("open");
    expect(overview.entries.find(item=>item.name==="linked")?.blockedReason).toBe("special-file");
    const result=await manager.remove([oldEntry!.id]);
    expect(result.failed).toEqual([]);
    expect(result.deleted[0].name).toBe("codex-old-analysis");
    expect(result.overview.entries.some(item=>item.name==="codex-old-analysis")).toBe(false);
    expect(manager.status().stale).toBe(true);
    expect(fs.existsSync(path.join(tempRoot,"codex-old-analysis"))).toBe(false);
    expect(fs.existsSync(path.join(tempRoot,"codex-recent.txt"))).toBe(true);
  });

  it("refuses an entry whose filesystem identity changed after scanning",async()=>{
    const tempRoot=root(),target=path.join(tempRoot,"codex-stale.txt"),uid=process.getuid?.()??1026;
    fs.writeFileSync(target,"before");
    old(target);
    const manager=new TempStorageManager({root:tempRoot,workhouseRoot:tempRoot,serviceUid:uid,recentGraceMs:0,openNames:()=>new Set()});
    const entry=(await manager.overview([])).entries[0];
    fs.unlinkSync(target);
    fs.writeFileSync(target,"after");
    const result=await manager.remove([entry.id]);
    expect(result.deleted).toEqual([]);
    expect(result.failed[0].reason).toBe("not-found-or-changed");
    expect(fs.readFileSync(target,"utf8")).toBe("after");
  });

  it("protects old same-owner entries that are not recognizable Workhouse session artifacts",async()=>{
    const tempRoot=root(),target=path.join(tempRoot,"personal-notes"),uid=process.getuid?.()??1026;
    fs.writeFileSync(target,"keep");
    old(target);
    const manager=new TempStorageManager({root:tempRoot,workhouseRoot:tempRoot,serviceUid:uid,recentGraceMs:0,openNames:()=>new Set()});
    const entry=(await manager.overview([])).entries[0];
    expect(entry).toMatchObject({deletable:false,blockedReason:"unrecognized"});
    const result=await manager.remove([entry.id]);
    expect(result.deleted).toEqual([]);
    expect(result.failed[0].reason).toBe("unrecognized");
    expect(fs.existsSync(target)).toBe(true);
  });

  it("coalesces background scans and exposes only cached status to readers",async()=>{
    const tempRoot=root(),uid=process.getuid?.()??1026;
    let release!:()=>void,calls=0;
    const gate=new Promise<void>(resolve=>release=resolve);
    const manager=new TempStorageManager({root:tempRoot,workhouseRoot:tempRoot,serviceUid:uid,openNames:()=>new Set()});
    const first=manager.startScan(async()=>{calls+=1;await gate;return[];});
    const second=manager.startScan(async()=>{calls+=1;return[];});
    expect(first.started).toBe(true);
    expect(second.started).toBe(false);
    expect(manager.status()).toMatchObject({state:"running",overview:null});
    expect(calls).toBe(1);
    await expect(manager.remove(["0".repeat(64)])).rejects.toMatchObject({code:"TEMP_STORAGE_SCAN_RUNNING",statusCode:409});
    release();
    await manager.overview([]);
    expect(manager.status()).toMatchObject({state:"ready",stale:false});
    expect(calls).toBe(1);
  });

  it("sweeps inactive task directories while preserving active and unattributed recent entries",async()=>{
    const tempRoot=root(),uid=process.getuid?.()??1026;
    const finished=path.join(tempRoot,"task-finished");
    const active=path.join(tempRoot,"task-active");
    const recentlyFinished=path.join(tempRoot,"task-recently-finished");
    const unattributed=path.join(tempRoot,"tool-output");
    for(const directory of[finished,active,recentlyFinished,unattributed]){
      fs.mkdirSync(directory);
      fs.writeFileSync(path.join(directory,"output.bin"),"temporary");
      old(path.join(directory,"output.bin"));
      old(directory);
    }
    const activeTask={...task("codex:active","active task"),status:"running" as const,metadata:{tempDirectory:active}};
    const recentlyFinishedTask={...task("codex:recent","recently finished"),metadata:{tempDirectory:recentlyFinished}};
    const manager=new TempStorageManager({root:tempRoot,workhouseRoot:tempRoot,managedRoot:true,serviceUid:uid,recentGraceMs:0,openNames:()=>new Set()});
    const result=await manager.sweep([activeTask,recentlyFinishedTask],{taskRetentionMs:30*60_000,retentionMs:24*60*60_000});
    expect(result.deleted.map(item=>item.name)).toEqual(["task-finished"]);
    expect(fs.existsSync(finished)).toBe(false);
    expect(fs.existsSync(active)).toBe(true);
    expect(fs.existsSync(recentlyFinished)).toBe(true);
    expect(fs.existsSync(unattributed)).toBe(true);
    expect(manager.status()).toMatchObject({
      root:tempRoot,
      managedRoot:true,
      policy:{taskRetentionMs:30*60_000,retentionMs:24*60*60_000,maxBytes:10*1024*1024*1024,sweepIntervalMs:60*60_000},
      overview:{linkage:{scannedEventBytes:0}}
    });
  });

  it("skips centrally managed workspace namespaces in the legacy root scan",async()=>{
    const tempRoot=root(),uid=process.getuid?.()??1026,managed=path.join(tempRoot,"workspaces");
    fs.mkdirSync(path.join(managed,"workspace","codex-task-old"),{recursive:true});
    fs.writeFileSync(path.join(managed,"workspace","codex-task-old","output.bin"),"data");
    const manager=new TempStorageManager({root:tempRoot,workhouseRoot:tempRoot,managedRoot:true,serviceUid:uid,ignoredNames:["workspaces"],openNames:()=>new Set()});
    const overview=await manager.overview([]);
    expect(overview.entries).toEqual([]);
  });
});
