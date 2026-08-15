import type {DeckDatabase} from "./db/client.js";

export type RuntimeModel={id:string;displayName:string;source:"runtime"};
export type RuntimeModelCatalogSnapshot<T extends RuntimeModel=RuntimeModel>={models:T[];fetchedAt:string;stale:boolean;source:string;error?:string};

const FRESH_MS=5*60_000;
const FAILED_REFRESH_RETRY_MS=60_000;

export class RuntimeModelCatalog<T extends RuntimeModel>{
  private memory:RuntimeModelCatalogSnapshot<T>|null=null;
  private inflight:Promise<RuntimeModelCatalogSnapshot<T>>|null=null;
  private lastAttemptAt=0;
  constructor(private db:DeckDatabase,private key:string,private source:string,private load:()=>Promise<T[]>){ }

  async get(force=false){
    if(force)return this.refresh();
    if(!this.memory)this.memory=await this.readStored();
    if(this.memory){
      if(this.expired(this.memory)){if(!this.memory.stale)this.memory={...this.memory,stale:true};this.refreshInBackground();}
      return this.memory;
    }
    return this.refresh();
  }

  private expired(snapshot:RuntimeModelCatalogSnapshot<T>){const at=Date.parse(snapshot.fetchedAt);return snapshot.stale||!Number.isFinite(at)||Date.now()-at>=FRESH_MS;}
  private async readStored():Promise<RuntimeModelCatalogSnapshot<T>|null>{
    const cached=await this.db.getCache(this.key).catch(()=>null) as any;
    if(!Array.isArray(cached?.value?.models)||!cached.value.models.length)return null;
    const fetchedAt=typeof cached.value.fetchedAt==="string"?cached.value.fetchedAt:cached.fetchedAt;
    return{...cached.value,fetchedAt,stale:!Number.isFinite(Date.parse(fetchedAt))||Date.now()-Date.parse(fetchedAt)>=FRESH_MS};
  }
  private refreshInBackground(){if(this.inflight||Date.now()-this.lastAttemptAt<FAILED_REFRESH_RETRY_MS)return;void this.refresh().catch(()=>{});}
  private async refresh(){
    if(this.inflight)return this.inflight;
    this.lastAttemptAt=Date.now();const loading=this.loadFresh();this.inflight=loading;
    try{return await loading;}finally{if(this.inflight===loading)this.inflight=null;}
  }
  private async loadFresh():Promise<RuntimeModelCatalogSnapshot<T>>{
    try{
      const models=await this.load();if(!models.length)throw new Error("The runtime returned an empty model catalog.");
      const snapshot:RuntimeModelCatalogSnapshot<T>={models,fetchedAt:new Date().toISOString(),stale:false,source:this.source};this.memory=snapshot;
      await this.db.putCache(this.key,snapshot,snapshot.fetchedAt,new Date(Date.now()+86_400_000).toISOString(),"1").catch(()=>false);return snapshot;
    }catch(error){
      const cached=this.memory??await this.readStored();if(cached){const snapshot={...cached,stale:true,error:error instanceof Error?error.message:String(error)};this.memory=snapshot;return snapshot;}
      throw error;
    }
  }
}
