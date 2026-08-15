import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { TEMP_STORAGE_MAX_BYTES, TEMP_SWEEP_INTERVAL_MS, TEMP_TASK_RETENTION_MS, TEMP_RETENTION_MS, TempStorageManager, type TempStorageEntry, type TempStorageOverview, type TempStorageScanStatus } from "./temp-storage.js";
import type { DeckTask, Workspace } from "./types.js";
import { workspaceTempRoot } from "./workspace-temp.js";

type LocalWorkspace=Pick<Workspace,"id"|"displayName"|"canonicalPath"|"hostId">;

export interface RuntimeTempCandidate{
  pid:number;
  tempRoot:string;
  locations:string[];
  command:string;
}

export interface RuntimeTempKnownRoot{
  root:string;
  workspaceIds:string[];
}

export interface RuntimeTempWorkspace{
  id:string;
  displayName:string;
  canonicalPath:string;
}

export interface RuntimeTempRootOverview{
  id:string;
  root:string;
  source:"workhouse"|"workspace-managed"|"workspace-runtime";
  managedRoot:boolean;
  workspaces:RuntimeTempWorkspace[];
  overview:TempStorageOverview;
}

export interface RuntimeTempOverview{
  generatedAt:string;
  serviceOwnedBytes:number;
  deletableBytes:number;
  protectedBytes:number;
  roots:RuntimeTempRootOverview[];
}

export interface RuntimeTempScanStatus extends Omit<TempStorageScanStatus,"root"|"managedRoot"|"overview">{
  rootCount:number;
  overview:RuntimeTempOverview|null;
}

type RootDescriptor=Omit<RuntimeTempRootOverview,"overview">;

const ACTIVE_COMMAND=/(?:^|[\/\s-])(codex|claude|claudex|agent|app-server-broker)(?:$|[\/\s-])/i;
const SCAN_CONCURRENCY=4;
const SWEEP_CONCURRENCY=2;

function normalized(value:string){
  return path.resolve(value).replace(/[\\/]+$/,"");
}

function inside(parent:string,target:string){
  const relative=path.relative(parent,target);
  return relative===""||(!relative.startsWith("..")&&!path.isAbsolute(relative));
}

function rootId(root:string){
  return crypto.createHash("sha256").update(normalized(root)).digest("hex").slice(0,24);
}

async function mapLimited<T,R>(items:T[],limit:number,operation:(item:T)=>Promise<R>){
  const results=new Array<R>(items.length);let cursor=0;
  const workers=Array.from({length:Math.min(limit,items.length)},async()=>{
    while(cursor<items.length){
      const index=cursor++;
      results[index]=await operation(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

function workspaceForLocation(location:string,workspaces:LocalWorkspace[]){
  const target=normalized(location);
  return workspaces
    .filter(item=>item.hostId==="local"&&inside(normalized(item.canonicalPath),target))
    .sort((a,b)=>b.canonicalPath.length-a.canonicalPath.length)[0]??null;
}

function procCandidates(serviceUid:number,procRoot="/proc"):RuntimeTempCandidate[]{
  if(process.platform!=="linux")return[];
  let names:string[]=[];
  try{names=fs.readdirSync(procRoot).filter(name=>/^\d+$/.test(name));}catch{return[];}
  const result:RuntimeTempCandidate[]=[];
  for(const name of names){
    const base=path.join(procRoot,name);
    try{if(fs.statSync(base).uid!==serviceUid)continue;}catch{continue;}
    let environment="",command="",cwd="";
    try{environment=fs.readFileSync(path.join(base,"environ"),"utf8");}catch{continue;}
    try{command=fs.readFileSync(path.join(base,"cmdline"),"utf8").replace(/\0/g," ").trim();}catch{}
    try{cwd=fs.readlinkSync(path.join(base,"cwd"));}catch{}
    if(!ACTIVE_COMMAND.test(command))continue;
    const variables=new Map(environment.split("\0").filter(Boolean).map(item=>{const index=item.indexOf("=");return index<0?[item,""]:[item.slice(0,index),item.slice(index+1)];}));
    const tempRoot=variables.get("TMPDIR")||variables.get("TMP")||variables.get("TEMP");
    if(!tempRoot||!path.isAbsolute(tempRoot))continue;
    const locations=[cwd];
    for(const match of command.matchAll(/(?:^|\s)--cwd(?:=|\s+)(?:"([^"]+)"|'([^']+)'|(\S+))/g))locations.push(match[1]||match[2]||match[3]||"");
    result.push({pid:Number(name),tempRoot,locations:locations.filter(Boolean),command});
  }
  return result;
}

function safeRuntimeRoot(root:string,serviceUid:number){
  const target=normalized(root),systemTempRoots=new Set(["/tmp","/var/tmp"].map(normalized));
  if(target===path.parse(target).root)return null;
  let stat:fs.Stats;
  try{stat=fs.lstatSync(target);}catch{return null;}
  if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==serviceUid)return null;
  return{root:target,dedicated:!systemTempRoots.has(target)};
}

export function discoverRuntimeTempRoots(primaryRoot:string,workspaces:LocalWorkspace[],options:{serviceUid?:number;candidates?:RuntimeTempCandidate[];knownRoots?:RuntimeTempKnownRoot[]}={}):RootDescriptor[]{
  const serviceUid=options.serviceUid??process.getuid?.()??-1;
  const primary=normalized(primaryRoot),byRoot=new Map<string,RootDescriptor>();
  byRoot.set(primary,{id:rootId(primary),root:primary,source:"workhouse",managedRoot:true,workspaces:[]});
  for(const workspace of workspaces.filter(item=>item.hostId==="local")){
    const root=workspaceTempRoot(primary,workspace.id),safe=safeRuntimeRoot(root,serviceUid);
    if(!safe)continue;
    byRoot.set(safe.root,{id:rootId(safe.root),root:safe.root,source:"workspace-managed",managedRoot:true,workspaces:[{id:workspace.id,displayName:workspace.displayName,canonicalPath:workspace.canonicalPath}]});
  }
  for(const known of options.knownRoots??[]){
    const safe=safeRuntimeRoot(known.root,serviceUid);
    if(!safe||safe.root===primary||inside(primary,safe.root))continue;
    const linked=workspaces.filter(item=>item.hostId==="local"&&known.workspaceIds.includes(item.id));
    if(!linked.length)continue;
    byRoot.set(safe.root,{id:rootId(safe.root),root:safe.root,source:"workspace-runtime",managedRoot:safe.dedicated,workspaces:linked.map(item=>({id:item.id,displayName:item.displayName,canonicalPath:item.canonicalPath}))});
  }
  for(const candidate of options.candidates??procCandidates(serviceUid)){
    if(!ACTIVE_COMMAND.test(candidate.command))continue;
    const safe=safeRuntimeRoot(candidate.tempRoot,serviceUid);
    if(!safe)continue;
    if(safe.root!==primary&&inside(primary,safe.root))continue;
    const linked=[...new Map(candidate.locations.map(location=>workspaceForLocation(location,workspaces)).filter((item):item is LocalWorkspace=>Boolean(item)).map(item=>[item.id,item])).values()];
    if(!linked.length)continue;
    const current=byRoot.get(safe.root)??{id:rootId(safe.root),root:safe.root,source:"workspace-runtime" as const,managedRoot:safe.dedicated,workspaces:[]};
    current.workspaces=[...new Map([...current.workspaces,...linked.map(item=>({id:item.id,displayName:item.displayName,canonicalPath:item.canonicalPath}))].map(item=>[item.id,item])).values()];
    byRoot.set(safe.root,current);
  }
  return[...byRoot.values()].sort((a,b)=>a.source.localeCompare(b.source)||a.root.localeCompare(b.root));
}

export class RuntimeTempStorageManager{
  readonly primaryRoot:string;
  readonly workhouseRoot:string;
  readonly serviceUid:number;
  readonly onRootsChanged:((roots:RuntimeTempKnownRoot[])=>void|Promise<void>)|null;
  private managers=new Map<string,TempStorageManager>();
  private descriptors:RootDescriptor[]=[];
  private snapshot:RuntimeTempOverview|null=null;
  private scanPromise:Promise<RuntimeTempOverview>|null=null;
  private state:RuntimeTempScanStatus["state"]="idle";
  private startedAt:string|null=null;
  private completedAt:string|null=null;
  private error:string|null=null;
  private stale=false;
  private lastTasks:DeckTask[]=[];
  private lastWorkspaces:LocalWorkspace[]=[];
  private lastKnownRoots:RuntimeTempKnownRoot[]=[];
  private entryLookup=new Map<string,{root:string;entryId:string}>();

  constructor(options:{primaryRoot:string;workhouseRoot:string;serviceUid?:number;onRootsChanged?:(roots:RuntimeTempKnownRoot[])=>void|Promise<void>}){
    this.primaryRoot=normalized(options.primaryRoot);
    this.workhouseRoot=options.workhouseRoot;
    this.serviceUid=options.serviceUid??process.getuid?.()??-1;
    this.onRootsChanged=options.onRootsChanged??null;
  }

  status():RuntimeTempScanStatus{
    return{
      rootCount:this.descriptors.length||1,
      policy:{taskRetentionMs:TEMP_TASK_RETENTION_MS,retentionMs:TEMP_RETENTION_MS,maxBytes:TEMP_STORAGE_MAX_BYTES,sweepIntervalMs:TEMP_SWEEP_INTERVAL_MS},
      state:this.state,
      startedAt:this.startedAt,
      completedAt:this.completedAt,
      stale:this.stale,
      overview:this.snapshot,
      error:this.error
    };
  }

  startScan(load:()=>Promise<{tasks:DeckTask[];workspaces:LocalWorkspace[];knownRoots?:RuntimeTempKnownRoot[]}>){
    const started=!this.scanPromise;
    void this.launch(load).catch(()=>{});
    return{started,status:this.status()};
  }

  overview(tasks:DeckTask[],workspaces:LocalWorkspace[],knownRoots:RuntimeTempKnownRoot[]=[]){
    return this.launch(async()=>({tasks,workspaces,knownRoots}));
  }

  private manager(descriptor:RootDescriptor){
    let manager=this.managers.get(descriptor.root);
    if(!manager){
      manager=new TempStorageManager({root:descriptor.root,workhouseRoot:this.workhouseRoot,managedRoot:descriptor.managedRoot,serviceUid:this.serviceUid,ignoredNames:descriptor.root===this.primaryRoot?["workspaces"]:[]});
      this.managers.set(descriptor.root,manager);
    }
    return manager;
  }

  private publicEntry(root:string,entry:TempStorageEntry){
    const id=crypto.createHash("sha256").update(`${root}\0${entry.id}`).digest("hex");
    this.entryLookup.set(id,{root,entryId:entry.id});
    return{...entry,id};
  }

  private async scan(load:()=>Promise<{tasks:DeckTask[];workspaces:LocalWorkspace[];knownRoots?:RuntimeTempKnownRoot[]}>){
    const {tasks,workspaces,knownRoots=[]}=await load();
    this.lastTasks=tasks;
    this.lastWorkspaces=workspaces;
    this.lastKnownRoots=knownRoots;
    this.descriptors=discoverRuntimeTempRoots(this.primaryRoot,workspaces,{serviceUid:this.serviceUid,knownRoots});
    void Promise.resolve(this.onRootsChanged?.(this.descriptors.filter(item=>item.source==="workspace-runtime").map(item=>({root:item.root,workspaceIds:item.workspaces.map(workspace=>workspace.id)})))).catch(()=>{});
    this.entryLookup.clear();
    const roots=await mapLimited(this.descriptors,SCAN_CONCURRENCY,async descriptor=>{
      const raw=await this.manager(descriptor).overview(tasks);
      return{...descriptor,overview:{...raw,entries:raw.entries.map(entry=>this.publicEntry(descriptor.root,entry))}};
    });
    const overview:RuntimeTempOverview={
      generatedAt:new Date().toISOString(),
      serviceOwnedBytes:roots.reduce((sum,item)=>sum+item.overview.serviceOwnedBytes,0),
      deletableBytes:roots.reduce((sum,item)=>sum+item.overview.deletableBytes,0),
      protectedBytes:roots.reduce((sum,item)=>sum+item.overview.protectedBytes,0),
      roots
    };
    this.snapshot=overview;
    this.completedAt=overview.generatedAt;
    this.stale=false;
    return overview;
  }

  private launch(load:()=>Promise<{tasks:DeckTask[];workspaces:LocalWorkspace[];knownRoots?:RuntimeTempKnownRoot[]}>){
    if(this.scanPromise)return this.scanPromise;
    this.state="running";
    this.startedAt=new Date().toISOString();
    this.error=null;
    const operation=this.scan(load).then(value=>{this.state="ready";return value;},error=>{this.state="failed";this.error="Temporary storage scan failed.";throw error;});
    this.scanPromise=operation;
    void operation.finally(()=>{if(this.scanPromise===operation)this.scanPromise=null;}).catch(()=>{});
    return operation;
  }

  async remove(entryIds:string[]){
    if(this.scanPromise)throw Object.assign(new Error("Temporary storage is still being scanned."),{code:"TEMP_STORAGE_SCAN_RUNNING",statusCode:409});
    if(!this.snapshot)throw Object.assign(new Error("Scan temporary storage before deleting entries."),{code:"TEMP_STORAGE_SCAN_REQUIRED",statusCode:409});
    const grouped=new Map<string,string[]>(),failed:{id:string;name:string|null;reason:string}[]=[];
    for(const id of entryIds){
      const found=this.entryLookup.get(id);
      if(!found){failed.push({id,name:null,reason:"not-found-or-changed"});continue;}
      grouped.set(found.root,[...(grouped.get(found.root)??[]),found.entryId]);
    }
    const deleted:Array<{id:string;name:string;sizeBytes:number;root:string}>=[];let freedBytes=0;
    for(const [root,ids] of grouped){
      const manager=this.managers.get(root);
      if(!manager)continue;
      const result=await manager.remove(ids);
      freedBytes+=result.freedBytes;
      deleted.push(...result.deleted.map(item=>({...item,root})));
      failed.push(...result.failed);
    }
    await this.scan(async()=>({tasks:this.lastTasks,workspaces:this.lastWorkspaces,knownRoots:this.lastKnownRoots}));
    this.stale=true;
    return{deleted,failed,freedBytes,overview:this.snapshot};
  }

  async sweep(tasks:DeckTask[],workspaces:LocalWorkspace[],knownRoots:RuntimeTempKnownRoot[]=[]){
    const descriptors=discoverRuntimeTempRoots(this.primaryRoot,workspaces,{serviceUid:this.serviceUid,knownRoots});
    void Promise.resolve(this.onRootsChanged?.(descriptors.filter(item=>item.source==="workspace-runtime").map(item=>({root:item.root,workspaceIds:item.workspaces.map(workspace=>workspace.id)})))).catch(()=>{});
    const deleted:Array<{id:string;name:string;sizeBytes:number}>=[],failed:{id:string;name:string|null;reason:string}[]=[];let freedBytes=0;
    const results=await mapLimited(descriptors,SWEEP_CONCURRENCY,descriptor=>this.manager(descriptor).sweep(tasks));
    for(const result of results){
      deleted.push(...result.deleted);
      failed.push(...result.failed);
      freedBytes+=result.freedBytes;
    }
    this.stale=true;
    return{deleted,failed,freedBytes};
  }
}
