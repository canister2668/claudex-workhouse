import {applyRuntimeUpdate,checkRuntimeUpdates,isManagedRuntimeStatus,type ManagedRuntimeUpdateStatus,type RuntimeProvider,type RuntimeUpdateStatus} from "./runtime-updates.js";

export type RuntimeAutoUpdateSettings={version:1;providers:Record<RuntimeProvider,boolean>};
type RuntimeUpdateRecord=RuntimeAutoUpdateSettings&{notifications:{available:Record<RuntimeProvider,string|null>;completed:Record<RuntimeProvider,string|null>}};
export type RuntimeUpdateEvent={
  sequence:number;type:"update_available"|"auto_update_completed"|"auto_update_failed";
  provider:RuntimeProvider;name:string;current:string|null;latest:string|null;createdAt:string;detail?:string;
};

export const DEFAULT_RUNTIME_AUTO_UPDATE:RuntimeAutoUpdateSettings={version:1,providers:{codex:false,claude:false}};
const emptyVersions=():Record<RuntimeProvider,string|null>=>({codex:null,claude:null});

function normalizeVersions(value:unknown){
  const input=value&&typeof value==="object"?value as Record<string,unknown>:{};
  return{codex:typeof input.codex==="string"?input.codex:null,claude:typeof input.claude==="string"?input.claude:null};
}

export function normalizeRuntimeAutoUpdate(value:unknown):RuntimeAutoUpdateSettings{
  const input=value&&typeof value==="object"?value as any:{};
  return{version:1,providers:{codex:input?.providers?.codex===true,claude:input?.providers?.claude===true}};
}

function normalizeRecord(value:unknown):RuntimeUpdateRecord{
  const settings=normalizeRuntimeAutoUpdate(value),input=value&&typeof value==="object"?value as any:{};
  return{...settings,notifications:{available:normalizeVersions(input?.notifications?.available),completed:normalizeVersions(input?.notifications?.completed)}};
}

type CoordinatorOptions={
  root:string;
  dataRoot?:string;
  load:()=>Promise<unknown>;
  save:(value:RuntimeUpdateRecord)=>Promise<void>;
  check?:typeof checkRuntimeUpdates;
  apply?:typeof applyRuntimeUpdate;
  onUpdated?:(provider:RuntimeProvider)=>void|Promise<void>;
  startupDelayMs?:number;
  intervalMs?:number;
};

export class RuntimeUpdateCoordinator{
  private record:RuntimeUpdateRecord={...DEFAULT_RUNTIME_AUTO_UPDATE,providers:{...DEFAULT_RUNTIME_AUTO_UPDATE.providers},notifications:{available:emptyVersions(),completed:emptyVersions()}};
  private readonly listeners=new Set<(event:RuntimeUpdateEvent)=>void>();
  private readonly history:RuntimeUpdateEvent[]=[];
  private readonly automaticRunning=new Set<RuntimeProvider>();
  private sequence=0;
  private checkPromise:Promise<RuntimeUpdateStatus[]>|null=null;
  private startupTimer:ReturnType<typeof setTimeout>|null=null;
  private interval:ReturnType<typeof setInterval>|null=null;

  constructor(private readonly options:CoordinatorOptions){}

  async initialize(){
    this.record=normalizeRecord(await this.options.load().catch(()=>null));
    const delay=this.options.startupDelayMs??60_000,interval=this.options.intervalMs??6*60*60*1000;
    this.startupTimer=setTimeout(()=>{this.startupTimer=null;void this.checkNow().catch(()=>{});},delay);this.startupTimer.unref?.();
    this.interval=setInterval(()=>void this.checkNow().catch(()=>{}),interval);this.interval.unref?.();
  }

  settings():RuntimeAutoUpdateSettings{return{version:1,providers:{...this.record.providers}};}

  async setSettings(value:unknown){
    const settings=normalizeRuntimeAutoUpdate(value);
    this.record={...this.record,...settings,providers:{...settings.providers}};
    await this.options.save(this.record);
    void this.checkNow().catch(()=>{});
    return this.settings();
  }

  subscribe(afterSequence:number,listener:(event:RuntimeUpdateEvent)=>void){
    const freshAfter=Date.now()-24*60*60*1000;
    for(const event of this.history)if(event.sequence>afterSequence&&Date.parse(event.createdAt)>=freshAfter)listener(event);
    this.listeners.add(listener);return()=>this.listeners.delete(listener);
  }

  async checkNow(){
    if(this.checkPromise)return this.checkPromise;
    this.checkPromise=(async()=>{
      const statuses=await(this.options.check??checkRuntimeUpdates)(this.options.root,this.options.dataRoot??this.options.root);
      await this.announceAvailable(statuses);
      void this.applyAutomatic(statuses);
      return statuses;
    })().finally(()=>{this.checkPromise=null;});
    return this.checkPromise;
  }

  close(){
    if(this.startupTimer)clearTimeout(this.startupTimer);this.startupTimer=null;
    if(this.interval)clearInterval(this.interval);this.interval=null;this.listeners.clear();
  }

  private emit(event:Omit<RuntimeUpdateEvent,"sequence"|"createdAt">){
    const value:RuntimeUpdateEvent={...event,sequence:++this.sequence,createdAt:new Date().toISOString()};
    this.history.push(value);if(this.history.length>50)this.history.shift();
    for(const listener of this.listeners)listener(value);
  }

  private async announceAvailable(statuses:RuntimeUpdateStatus[]){
    const announcements=statuses.filter(isManagedRuntimeStatus).filter(item=>item.updateAvailable===true&&item.latest&&this.record.notifications.available[item.provider]!==item.latest);
    if(!announcements.length)return;
    for(const item of announcements)this.record.notifications.available[item.provider]=item.latest;
    await this.options.save(this.record);
    for(const item of announcements)this.emit({type:"update_available",provider:item.provider,name:item.name,current:item.current,latest:item.latest});
  }

  private async applyAutomatic(statuses:RuntimeUpdateStatus[]){
    for(const item of statuses.filter(isManagedRuntimeStatus)){
      if(!this.record.providers[item.provider]||item.updateAvailable!==true||!item.canUpdate||this.automaticRunning.has(item.provider))continue;
      this.automaticRunning.add(item.provider);
      void this.applyOne(item).finally(()=>this.automaticRunning.delete(item.provider));
    }
  }

  private async applyOne(item:ManagedRuntimeUpdateStatus){
    try{
      const statuses=await(this.options.apply??applyRuntimeUpdate)(this.options.root,item.provider,this.options.dataRoot??this.options.root);
      await this.options.onUpdated?.(item.provider);
      const updated=statuses.find(value=>value.provider===item.provider),version=updated?.current??item.latest;
      this.record.notifications.completed[item.provider]=version;
      await this.options.save(this.record);
      this.emit({type:"auto_update_completed",provider:item.provider,name:item.name,current:version,latest:version});
    }catch(error){
      if((error as any)?.statusCode===409)return;
      this.emit({type:"auto_update_failed",provider:item.provider,name:item.name,current:item.current,latest:item.latest,detail:error instanceof Error?error.message.slice(0,300):String(error).slice(0,300)});
    }
  }
}
