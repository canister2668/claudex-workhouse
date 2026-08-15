import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readStreamEvents, streamFile } from "./stream-events.js";
import type { DeckTask, ProviderId, UnifiedStatus } from "./types.js";

const DEFAULT_RECENT_GRACE_MS=10*60_000;
const MAX_TREE_ENTRIES=250_000;
const MAX_LINKED_SESSIONS=8;
const MAX_LINK_TASKS=250;
const MAX_STREAM_SOURCE_BYTES=16*1024*1024;
const DEFAULT_CACHE_TTL_MS=5*60_000;
export const TEMP_TASK_RETENTION_MS=30*60_000;
export const TEMP_RETENTION_MS=24*60*60_000;
export const TEMP_STORAGE_MAX_BYTES=10*1024*1024*1024;
export const TEMP_SWEEP_INTERVAL_MS=60*60_000;
const ACTIVE_STATUSES=new Set<UnifiedStatus>(["pending","queued","running","waiting","unknown"]);
const taskEntry=(name:string)=>/^(?:codex-|claude-)?task-/.test(name);

export type TempBlockedReason="different-owner"|"special-file"|"recent"|"open"|"cross-device"|"scan-limit"|"unrecognized";

export interface TempSessionLink{
  taskId:string;
  threadId:string|null;
  provider:ProviderId;
  title:string;
  status:UnifiedStatus;
  updatedAt:string;
  active:boolean;
  source:"task-record"|"recent-event";
}

export interface TempStorageEntry{
  id:string;
  name:string;
  kind:"file"|"directory"|"other";
  category:"session-artifact"|"package-cache"|"system"|"unknown";
  sizeBytes:number;
  fileCount:number;
  modifiedAt:string;
  ownerUid:number;
  serviceOwned:boolean;
  deletable:boolean;
  blockedReason:TempBlockedReason|null;
  sessionLinks:TempSessionLink[];
}

export interface TempStorageOverview{
  root:string;
  generatedAt:string;
  filesystem:{totalBytes:number;usedBytes:number;freeBytes:number};
  serviceUid:number;
  serviceOwnedBytes:number;
  deletableBytes:number;
  protectedBytes:number;
  entries:TempStorageEntry[];
  linkage:{bestEffort:true;scannedTaskCount:number;scannedEventBytes:number};
}

export interface TempStorageScanStatus{
  root:string;
  managedRoot:boolean;
  policy:{taskRetentionMs:number;retentionMs:number;maxBytes:number;sweepIntervalMs:number};
  state:"idle"|"running"|"ready"|"failed";
  startedAt:string|null;
  completedAt:string|null;
  stale:boolean;
  overview:TempStorageOverview|null;
  error:string|null;
}

interface TreeStats{
  sizeBytes:number;
  fileCount:number;
  crossDevice:boolean;
  limitReached:boolean;
}

interface TempStorageOptions{
  root?:string;
  workhouseRoot:string;
  managedRoot?:boolean;
  serviceUid?:number;
  recentGraceMs?:number;
  now?:()=>number;
  openNames?:()=>Set<string>;
  cacheTtlMs?:number;
  ignoredNames?:Iterable<string>;
}

function identityId(name:string,stat:fs.Stats){
  return crypto.createHash("sha256").update(`${name}\0${stat.dev}\0${stat.ino}\0${stat.birthtimeMs}\0${stat.mtimeMs}\0${stat.size}`).digest("hex");
}

function category(name:string):TempStorageEntry["category"]{
  if(name===".pnpm-store"||name.startsWith("npm-")||name.startsWith("yarn-"))return"package-cache";
  if(/^(task-|risu|gks-|agent-|codex-|claude-|playwright-|tmp\.|repo-)/i.test(name))return"session-artifact";
  if(name.startsWith(".X")||name.includes("socket")||name.includes("systemd"))return"system";
  return"unknown";
}

function managedCategory(name:string,managedRoot:boolean):TempStorageEntry["category"]{
  const value=category(name);
  return managedRoot&&value==="unknown"?"session-artifact":value;
}

function kindOf(stat:fs.Stats):TempStorageEntry["kind"]{
  if(stat.isFile())return"file";
  if(stat.isDirectory())return"directory";
  return"other";
}

function allocatedBytes(stat:fs.Stats){
  return Number.isFinite(stat.blocks)?stat.blocks*512:stat.size;
}

function topLevelName(root:string,target:string){
  const prefix=`${root}${path.sep}`;
  if(!target.startsWith(prefix))return null;
  const relative=target.slice(prefix.length);
  const name=relative.split(path.sep)[0];
  return name&&name!=="."&&name!==".."?name:null;
}

function linuxOpenNames(root:string,uid:number){
  const result=new Set<string>();
  if(process.platform!=="linux")return result;
  let processes:string[]=[];
  try{processes=fs.readdirSync("/proc").filter(name=>/^\d+$/.test(name));}catch{return result;}
  for(const pid of processes){
    const processPath=path.join("/proc",pid);
    try{if(fs.statSync(processPath).uid!==uid)continue;}catch{continue;}
    let descriptors:string[]=[];
    try{descriptors=fs.readdirSync(path.join(processPath,"fd"));}catch{continue;}
    for(const descriptor of descriptors){
      try{
        const target=fs.readlinkSync(path.join(processPath,"fd",descriptor)).replace(/ \(deleted\)$/,"");
        const name=topLevelName(root,target);
        if(name)result.add(name);
      }catch{}
    }
  }
  return result;
}

async function treeStats(target:string,rootDevice:number):Promise<TreeStats>{
  let sizeBytes=0,fileCount=0,crossDevice=false,limitReached=false;
  async function visit(current:string){
    if(limitReached)return;
    let stat:fs.Stats;
    try{stat=await fs.promises.lstat(current);}catch{return;}
    fileCount+=1;
    if(fileCount>MAX_TREE_ENTRIES){limitReached=true;return;}
    sizeBytes+=allocatedBytes(stat);
    if(stat.dev!==rootDevice){crossDevice=true;return;}
    if(!stat.isDirectory()||stat.isSymbolicLink())return;
    let directory:fs.Dir;
    try{directory=await fs.promises.opendir(current);}catch{return;}
    for await(const item of directory)await visit(path.join(current,item.name));
  }
  await visit(target);
  return{sizeBytes,fileCount,crossDevice,limitReached};
}

function boundedText(value:unknown){
  if(typeof value==="string")return value.slice(0,1_000_000);
  try{return JSON.stringify(value).slice(0,1_000_000);}catch{return"";}
}

function mentionedEntryNames(source:string,root:string,names:Set<string>){
  const result=new Set<string>(),marker=`${root}${path.sep}`;
  let offset=source.indexOf(marker);
  while(offset>=0){
    const start=offset+marker.length;
    let end=start;
    while(end<source.length&&source[end]!==path.sep&&!/[\s"'`),;\]}]/.test(source[end]))end+=1;
    const name=source.slice(start,end);
    if(names.has(name))result.add(name);
    offset=source.indexOf(marker,start);
  }
  return result;
}

function sessionLink(task:DeckTask,source:TempSessionLink["source"]):TempSessionLink{
  return{
    taskId:task.id,
    threadId:task.threadId,
    provider:task.provider,
    title:task.title||task.prompt.slice(0,80)||task.id,
    status:task.status,
    updatedAt:task.updatedAt,
    active:ACTIVE_STATUSES.has(task.status),
    source
  };
}

function addLink(links:Map<string,TempSessionLink[]>,entryName:string,link:TempSessionLink){
  const current=links.get(entryName)??[];
  const existing=current.findIndex(item=>item.taskId===link.taskId);
  if(existing>=0){
    if(current[existing].source==="task-record"&&link.source==="recent-event")current[existing]=link;
  }else if(current.length<MAX_LINKED_SESSIONS)current.push(link);
  links.set(entryName,current);
}

function taskRecordSource(task:DeckTask){
  return[
    boundedText(task.prompt),
    boundedText(task.result),
    boundedText(task.log),
    boundedText(task.events),
    boundedText(task.metadata)
  ].join("\n");
}

const yieldToEventLoop=()=>new Promise<void>(resolve=>setImmediate(resolve));

async function linkSessions(entries:TempStorageEntry[],tasks:DeckTask[],root:string,workhouseRoot:string,managedRoot:boolean){
  const links=new Map<string,TempSessionLink[]>(),names=new Set(entries.map(item=>item.name));
  const localTasks=tasks
    .filter(task=>!task.executionHostId||task.executionHostId==="local")
    .sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt))
    .slice(0,MAX_LINK_TASKS);
  for(const task of localTasks){
    const configured=typeof task.metadata?.tempDirectory==="string"?topLevelName(root,path.resolve(task.metadata.tempDirectory)):null;
    if(configured&&names.has(configured))addLink(links,configured,sessionLink(task,"task-record"));
  }
  // Managed task directories record their owner directly in task metadata.
  // Legacy event scanning is intentionally avoided here: reading up to 16 MiB
  // of NDJSON on every UI scan is unnecessary for the isolated runtime root.
  if(managedRoot){
    for(const entry of entries)entry.sessionLinks=(links.get(entry.name)??[]).sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt));
    return{scannedTaskCount:localTasks.length,scannedEventBytes:0};
  }
  for(let index=0;index<localTasks.length;index++){
    const task=localTasks[index];
    const source=taskRecordSource(task);
    for(const name of mentionedEntryNames(source,root,names))addLink(links,name,sessionLink(task,"task-record"));
    if(index%25===24)await yieldToEventLoop();
  }
  let scannedEventBytes=0;
  for(let index=0;index<localTasks.length;index++){
    const task=localTasks[index];
    const current=streamFile(workhouseRoot,task.id),rotated=`${current}.1`;
    let sourceBytes=0;
    for(const file of[rotated,current])try{sourceBytes+=fs.statSync(file).size;}catch{}
    if(!sourceBytes||scannedEventBytes+sourceBytes>MAX_STREAM_SOURCE_BYTES)continue;
    scannedEventBytes+=sourceBytes;
    const events=readStreamEvents(workhouseRoot,task.id,0,2_000).events;
    const source=events.map(event=>`${boundedText(event.content)}\n${boundedText(event.metadata)}`).join("\n");
    for(const name of mentionedEntryNames(source,root,names))addLink(links,name,sessionLink(task,"recent-event"));
    if(index%10===9)await yieldToEventLoop();
  }
  for(const entry of entries)entry.sessionLinks=(links.get(entry.name)??[]).sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt));
  return{scannedTaskCount:localTasks.length,scannedEventBytes};
}

export class TempStorageManager{
  readonly root:string;
  readonly workhouseRoot:string;
  readonly managedRoot:boolean;
  readonly serviceUid:number;
  readonly recentGraceMs:number;
  readonly now:()=>number;
  readonly openNames:()=>Set<string>;
  readonly cacheTtlMs:number;
  readonly ignoredNames:Set<string>;
  private scanPromise:Promise<TempStorageOverview>|null=null;
  private snapshot:TempStorageOverview|null=null;
  private scanState:TempStorageScanStatus["state"]="idle";
  private scanStartedAt:string|null=null;
  private scanCompletedAt:string|null=null;
  private scanError:string|null=null;
  private snapshotStale=false;

  constructor(options:TempStorageOptions){
    this.root=path.resolve(options.root??os.tmpdir());
    this.workhouseRoot=options.workhouseRoot;
    this.managedRoot=options.managedRoot??false;
    this.serviceUid=options.serviceUid??process.getuid?.()??-1;
    this.recentGraceMs=options.recentGraceMs??DEFAULT_RECENT_GRACE_MS;
    this.now=options.now??Date.now;
    this.openNames=options.openNames??(()=>linuxOpenNames(this.root,this.serviceUid));
    this.cacheTtlMs=options.cacheTtlMs??DEFAULT_CACHE_TTL_MS;
    this.ignoredNames=new Set(options.ignoredNames??[]);
  }

  status():TempStorageScanStatus{
    const expired=Boolean(this.snapshot&&this.scanCompletedAt&&this.now()-Date.parse(this.scanCompletedAt)>this.cacheTtlMs);
    return{
      root:this.root,
      managedRoot:this.managedRoot,
      policy:{
        taskRetentionMs:TEMP_TASK_RETENTION_MS,
        retentionMs:TEMP_RETENTION_MS,
        maxBytes:TEMP_STORAGE_MAX_BYTES,
        sweepIntervalMs:TEMP_SWEEP_INTERVAL_MS
      },
      state:this.scanState,
      startedAt:this.scanStartedAt,
      completedAt:this.scanCompletedAt,
      stale:this.snapshotStale||expired,
      overview:this.snapshot,
      error:this.scanError
    };
  }

  startScan(loadTasks:()=>Promise<DeckTask[]>){
    const started=!this.scanPromise;
    void this.launchScan(loadTasks).catch(()=>{});
    return{started,status:this.status()};
  }

  async overview(tasks:DeckTask[]){
    return this.launchScan(async()=>tasks);
  }

  private launchScan(loadTasks:()=>Promise<DeckTask[]>){
    if(this.scanPromise)return this.scanPromise;
    this.scanState="running";
    this.scanStartedAt=new Date(this.now()).toISOString();
    this.scanError=null;
    const operation=(async()=>{
      try{
        const value=await this.scanOverview(await loadTasks());
        this.snapshot=value;
        this.snapshotStale=false;
        this.scanState="ready";
        this.scanCompletedAt=value.generatedAt;
        return value;
      }catch(error){
        this.scanState="failed";
        this.scanCompletedAt=new Date(this.now()).toISOString();
        this.scanError="Temporary storage scan failed.";
        throw error;
      }
    })();
    this.scanPromise=operation;
    void operation.finally(()=>{if(this.scanPromise===operation)this.scanPromise=null;}).catch(()=>{});
    return operation;
  }

  private async scanOverview(tasks:DeckTask[]):Promise<TempStorageOverview>{
    const rootStat=await fs.promises.lstat(this.root);
    if(!rootStat.isDirectory()||rootStat.isSymbolicLink())throw new Error("Managed temporary storage root is not a regular directory.");
    const names=(await fs.promises.readdir(this.root)).filter(name=>!this.ignoredNames.has(name));
    const open=names.length?this.openNames():new Set<string>(),entries:TempStorageEntry[]=[];
    for(const name of names){
      const target=path.join(this.root,name);
      let stat:fs.Stats;
      try{stat=await fs.promises.lstat(target);}catch{continue;}
      const kind=kindOf(stat),serviceOwned=stat.uid===this.serviceUid,entryCategory=managedCategory(name,this.managedRoot);
      const tree=kind==="file"
        ?{sizeBytes:allocatedBytes(stat),fileCount:1,crossDevice:stat.dev!==rootStat.dev,limitReached:false}
        :kind==="directory"
          ?await treeStats(target,rootStat.dev)
          :{sizeBytes:allocatedBytes(stat),fileCount:1,crossDevice:stat.dev!==rootStat.dev,limitReached:false};
      let blockedReason:TempBlockedReason|null=null;
      if(!serviceOwned)blockedReason="different-owner";
      else if(kind==="other"||stat.isSymbolicLink())blockedReason="special-file";
      else if(tree.crossDevice)blockedReason="cross-device";
      else if(tree.limitReached)blockedReason="scan-limit";
      else if(entryCategory!=="session-artifact")blockedReason="unrecognized";
      else if(open.has(name))blockedReason="open";
      else if(this.now()-stat.mtimeMs<this.recentGraceMs)blockedReason="recent";
      entries.push({
        id:identityId(name,stat),
        name,
        kind,
        category:entryCategory,
        sizeBytes:tree.sizeBytes,
        fileCount:tree.fileCount,
        modifiedAt:stat.mtime.toISOString(),
        ownerUid:stat.uid,
        serviceOwned,
        deletable:blockedReason===null,
        blockedReason,
        sessionLinks:[]
      });
    }
    const linkage=await linkSessions(entries,tasks,this.root,this.workhouseRoot,this.managedRoot);
    entries.sort((a,b)=>b.sizeBytes-a.sizeBytes||a.name.localeCompare(b.name));
    const filesystemStat=fs.statfsSync(this.root),totalBytes=filesystemStat.blocks*filesystemStat.bsize,freeBytes=filesystemStat.bavail*filesystemStat.bsize;
    const serviceOwnedBytes=entries.filter(item=>item.serviceOwned).reduce((sum,item)=>sum+item.sizeBytes,0);
    const deletableBytes=entries.filter(item=>item.deletable).reduce((sum,item)=>sum+item.sizeBytes,0);
    return{
      root:this.root,
      generatedAt:new Date(this.now()).toISOString(),
      filesystem:{totalBytes,usedBytes:totalBytes-freeBytes,freeBytes},
      serviceUid:this.serviceUid,
      serviceOwnedBytes,
      deletableBytes,
      protectedBytes:entries.reduce((sum,item)=>sum+(item.deletable?0:item.sizeBytes),0),
      entries,
      linkage:{bestEffort:true,...linkage}
    };
  }

  async remove(entryIds:string[]){
    if(this.scanPromise)throw Object.assign(new Error("Temporary storage is still being scanned."),{code:"TEMP_STORAGE_SCAN_RUNNING",statusCode:409});
    const before=this.snapshot;
    if(!before)throw Object.assign(new Error("Scan temporary storage before deleting entries."),{code:"TEMP_STORAGE_SCAN_REQUIRED",statusCode:409});
    const requested=new Set(entryIds),open=this.openNames(),rootStat=await fs.promises.lstat(this.root),deleted:TempStorageEntry[]=[],failed:{id:string;name:string|null;reason:string}[]=[];
    if(!rootStat.isDirectory()||rootStat.isSymbolicLink())throw new Error("Managed temporary storage root is not a regular directory.");
    for(const id of requested){
      const entry=before.entries.find(item=>item.id===id);
      if(!entry){failed.push({id,name:null,reason:"not-found-or-changed"});continue;}
      if(!entry.deletable){failed.push({id,name:entry.name,reason:entry.blockedReason??"protected"});continue;}
      const target=path.join(this.root,entry.name);
      try{
        const stat=await fs.promises.lstat(target);
        if(identityId(entry.name,stat)!==entry.id)throw new Error("not-found-or-changed");
        if(stat.uid!==this.serviceUid)throw new Error("different-owner");
        if(open.has(entry.name))throw new Error("open");
        if(this.now()-stat.mtimeMs<this.recentGraceMs)throw new Error("recent");
        if(stat.isSymbolicLink()||(!stat.isFile()&&!stat.isDirectory()))throw new Error("special-file");
        if(managedCategory(entry.name,this.managedRoot)!=="session-artifact")throw new Error("unrecognized");
        if(stat.dev!==rootStat.dev)throw new Error("cross-device");
        if(stat.isDirectory()){
          const tree=await treeStats(target,rootStat.dev);
          if(tree.crossDevice)throw new Error("cross-device");
          if(tree.limitReached)throw new Error("scan-limit");
          await fs.promises.rm(target,{recursive:true,maxRetries:2,retryDelay:50});
        }
        else await fs.promises.unlink(target);
        deleted.push(entry);
      }catch(error){failed.push({id,name:entry.name,reason:error instanceof Error?error.message:String(error)});}
    }
    const deletedIds=new Set(deleted.map(item=>item.id)),entries=before.entries.filter(item=>!deletedIds.has(item.id));
    const filesystemStat=fs.statfsSync(this.root),totalBytes=filesystemStat.blocks*filesystemStat.bsize,freeBytes=filesystemStat.bavail*filesystemStat.bsize;
    const overview:TempStorageOverview={
      ...before,
      generatedAt:new Date(this.now()).toISOString(),
      filesystem:{totalBytes,usedBytes:totalBytes-freeBytes,freeBytes},
      serviceOwnedBytes:entries.filter(item=>item.serviceOwned).reduce((sum,item)=>sum+item.sizeBytes,0),
      deletableBytes:entries.filter(item=>item.deletable).reduce((sum,item)=>sum+item.sizeBytes,0),
      protectedBytes:entries.reduce((sum,item)=>sum+(item.deletable?0:item.sizeBytes),0),
      entries
    };
    this.snapshot=overview;
    this.snapshotStale=true;
    this.scanState="ready";
    this.scanCompletedAt=overview.generatedAt;
    return{
      deleted:deleted.map(item=>({id:item.id,name:item.name,sizeBytes:item.sizeBytes})),
      failed,
      freedBytes:deleted.reduce((sum,item)=>sum+item.sizeBytes,0),
      overview
    };
  }

  async sweep(tasks:DeckTask[],options:{retentionMs?:number;taskRetentionMs?:number;maxBytes?:number}={}){
    if(this.scanPromise)return{skipped:"scan-running" as const,deleted:[],failed:[],freedBytes:0};
    const retentionMs=options.retentionMs??TEMP_RETENTION_MS;
    const taskRetentionMs=options.taskRetentionMs??TEMP_TASK_RETENTION_MS;
    const maxBytes=options.maxBytes??TEMP_STORAGE_MAX_BYTES;
    const overview=await this.overview(tasks);
    const safe=overview.entries
      .filter(entry=>entry.deletable&&!entry.sessionLinks.some(link=>link.active))
      .sort((a,b)=>Date.parse(a.modifiedAt)-Date.parse(b.modifiedAt));
    const lastActivity=(entry:TempStorageEntry)=>Math.max(
      Date.parse(entry.modifiedAt),
      ...entry.sessionLinks.map(link=>Date.parse(link.updatedAt)).filter(Number.isFinite)
    );
    const selected=new Set(
      safe
        .filter(entry=>this.now()-lastActivity(entry)>=(taskEntry(entry.name)?taskRetentionMs:retentionMs))
        .map(entry=>entry.id)
    );
    let retainedBytes=overview.serviceOwnedBytes-safe.filter(entry=>selected.has(entry.id)).reduce((sum,entry)=>sum+entry.sizeBytes,0);
    if(retainedBytes>maxBytes){
      for(const entry of safe){
        if(selected.has(entry.id))continue;
        if(!taskEntry(entry.name)&&this.now()-lastActivity(entry)<retentionMs)continue;
        selected.add(entry.id);
        retainedBytes-=entry.sizeBytes;
        if(retainedBytes<=maxBytes)break;
      }
    }
    if(!selected.size)return{skipped:null,deleted:[],failed:[],freedBytes:0};
    const result=await this.remove([...selected]);
    return{skipped:null,deleted:result.deleted,failed:result.failed,freedBytes:result.freedBytes};
  }
}
