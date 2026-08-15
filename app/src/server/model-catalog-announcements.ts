import type {ProviderId} from "./types.js";

export type ModelCatalogNotice={sequence:number;type:"models_discovered";provider:ProviderId;models:Array<{id:string;displayName:string}>;count:number;createdAt:string};
type RecordV1={version:1;providers:Partial<Record<ProviderId,{seenIds:string[];initializedAt:string;updatedAt:string}>>};
type Snapshot={models:Array<{id:string;displayName:string}>;stale:boolean;source:string};

export class ModelCatalogAnnouncementCoordinator{
  private record:RecordV1={version:1,providers:{}};
  private listeners=new Set<(event:ModelCatalogNotice)=>void>();
  private history:ModelCatalogNotice[]=[];
  private sequence=0;
  private savePromise:Promise<void>=Promise.resolve();
  constructor(private load:()=>Promise<unknown>,private save:(value:RecordV1)=>Promise<void>){ }
  async initialize(){const value=await this.load().catch(()=>null) as any;if(value?.version===1&&value.providers&&typeof value.providers==="object")this.record={version:1,providers:value.providers};}
  subscribe(afterSequence:number,listener:(event:ModelCatalogNotice)=>void){const freshAfter=Date.now()-24*60*60_000;for(const event of this.history)if(event.sequence>afterSequence&&Date.parse(event.createdAt)>=freshAfter)listener(event);this.listeners.add(listener);return()=>this.listeners.delete(listener);}
  async observe(provider:ProviderId,snapshot:Snapshot){
    if(snapshot.stale||snapshot.source.startsWith("fallback:")||!snapshot.models.length)return null;
    const models=[...new Map(snapshot.models.map(item=>[item.id,{id:item.id,displayName:item.displayName||item.id}])).values()],now=new Date().toISOString(),previous=this.record.providers[provider];
    if(!previous){this.record={...this.record,providers:{...this.record.providers,[provider]:{seenIds:models.map(item=>item.id),initializedAt:now,updatedAt:now}}};await this.persist();return null;}
    const seen=new Set(previous.seenIds),discovered=models.filter(item=>!seen.has(item.id));for(const item of models)seen.add(item.id);
    this.record={...this.record,providers:{...this.record.providers,[provider]:{...previous,seenIds:[...seen],updatedAt:now}}};await this.persist();
    if(!discovered.length)return null;
    const event:ModelCatalogNotice={sequence:++this.sequence,type:"models_discovered",provider,models:discovered.slice(0,10),count:discovered.length,createdAt:now};this.history.push(event);if(this.history.length>50)this.history.shift();for(const listener of this.listeners)listener(event);return event;
  }
  private persist(){const value=structuredClone(this.record);this.savePromise=this.savePromise.catch(()=>{}).then(()=>this.save(value));return this.savePromise;}
}
