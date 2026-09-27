import path from "node:path";
import {spawn} from "node:child_process";
import type {AppConfig} from "./config.js";
import type {DeckDatabase} from "./db/client.js";
import { sanitizeSensitiveText } from "./sensitive-data.js";
import{screenHelperCommand}from"./pty-helpers/command.js";

export type ClaudeModelCatalogItem={id:string;displayName:string;description:string;source:"runtime"|"custom"};
export type ClaudeModelCatalogSnapshot={models:ClaudeModelCatalogItem[];fetchedAt:string;stale:boolean;source:string};
const CATALOG_FRESH_MS=300_000;
const FAILED_REFRESH_RETRY_MS=300_000;

// Used only when the /model picker probe fails and no cached snapshot exists.
// Keep it aligned with the current picker rows so a failed probe does not
// silently hide the newest models.
export const CLAUDE_FALLBACK_MODELS:ClaudeModelCatalogItem[]=[
  {id:"default",displayName:"Default",description:"Claude Code runtime default model",source:"runtime"},
  {id:"claude-opus-5-5",displayName:"Opus 5.5",description:"Claude Code Opus 5.5",source:"runtime"},
  {id:"claude-opus-5[1m]",displayName:"Opus 5 · 1M",description:"Claude Code Opus 5 with 1M context",source:"runtime"},
  {id:"claude-fable-5-1",displayName:"Fable 5.1",description:"Claude Code Fable 5.1",source:"runtime"},
  {id:"claude-sonnet-5",displayName:"Sonnet 5",description:"Claude Code Sonnet 5",source:"runtime"},
  {id:"claude-haiku-4-5",displayName:"Haiku 4.5",description:"Claude Code Haiku 4.5",source:"runtime"}
];

function runtimeOnly(models:ClaudeModelCatalogItem[]){return models.filter(item=>item.source!=="custom");}

export class ClaudeModelCatalog{
  private memory:ClaudeModelCatalogSnapshot|null=null;
  private inflight:Promise<ClaudeModelCatalogSnapshot>|null=null;
  private lastAttemptAt=0;
  constructor(private config:AppConfig,private db:DeckDatabase){}
  async get(force=false){
    if(force)return this.refresh();
    if(!this.memory)this.memory=await this.readStored();
    if(this.memory){
      if(this.expired(this.memory)){
        const source=this.memory.source.startsWith("fallback:")?this.memory.source:"cache";
        if(!this.memory.stale||this.memory.source!==source)this.memory={...this.memory,stale:true,source};
        this.refreshInBackground();
      }
      return this.memory;
    }
    return this.refresh();
  }
  private expired(snapshot:ClaudeModelCatalogSnapshot){
    const fetchedAt=Date.parse(snapshot.fetchedAt);
    return snapshot.stale||!Number.isFinite(fetchedAt)||Date.now()-fetchedAt>=CATALOG_FRESH_MS;
  }
  private async readStored():Promise<ClaudeModelCatalogSnapshot|null>{
    const cached=await this.db.getCache("claude-model-catalog").catch(()=>null) as any;
    if(!cached?.value?.models||!Array.isArray(cached.value.models)||!cached.value.models.length)return null;
    const fetchedAt=typeof cached.value.fetchedAt==="string"?cached.value.fetchedAt:cached.fetchedAt;
    const stale=!Number.isFinite(Date.parse(fetchedAt))||Date.now()-Date.parse(fetchedAt)>=CATALOG_FRESH_MS;
    return{...cached.value,models:runtimeOnly(cached.value.models),fetchedAt,stale,source:"cache"};
  }
  private refreshInBackground(){
    if(this.inflight||Date.now()-this.lastAttemptAt<FAILED_REFRESH_RETRY_MS)return;
    void this.refresh().catch(()=>{});
  }
  private async refresh(){
    if(this.inflight)return this.inflight;
    this.lastAttemptAt=Date.now();
    const loading=this.loadFresh();this.inflight=loading;
    try{return await loading;}finally{if(this.inflight===loading)this.inflight=null;}
  }
  private async loadFresh():Promise<ClaudeModelCatalogSnapshot>{
    try{
      const probeDir=path.join(this.config.dataDir,"claude-model-probe"),helper=screenHelperCommand(this.config.appRoot,"claude-models",[this.config.claudeBinary,probeDir]),result=await new Promise<any>((resolve,reject)=>{
        const child=spawn(helper.command,helper.args,{cwd:this.config.appRoot,shell:false,windowsHide:true,env:{...process.env,DISABLE_AUTOUPDATER:"1"},stdio:["ignore","pipe","pipe"]});let stdout="",stderr="",settled=false;
        const finish=(error?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);if(error)reject(error);else try{resolve(JSON.parse(stdout));}catch{reject(new Error("Claude model resolver returned invalid JSON."));}};
        const timer=setTimeout(()=>{child.kill("SIGTERM");finish(new Error("Claude model resolver timed out."));},30_000);timer.unref?.();
        child.stdout.setEncoding("utf8");child.stderr.setEncoding("utf8");child.stdout.on("data",chunk=>stdout=`${stdout}${chunk}`.slice(-131072));child.stderr.on("data",chunk=>stderr=`${stderr}${chunk}`.slice(-2000));child.once("error",error=>finish(new Error(sanitizeSensitiveText(error.message))));child.once("exit",code=>code===0?finish():finish(new Error(`Claude model resolver failed (${code}): ${sanitizeSensitiveText(stderr)}`)));
      });
      // An unreadable picker row fails the probe instead of shortening the
      // catalog, so the last good snapshot stays in place until the parser is
      // taught the new layout.
      if(result?.error==="picker-parse-incomplete")throw new Error(`Claude model picker layout was not fully understood (${Array.isArray(result.unmapped)?result.unmapped.length:0} unmapped rows).`);
      if(!result?.ok||!Array.isArray(result.models)||!result.models.length)throw new Error("Claude model picker was unavailable.");
      const runtime:ClaudeModelCatalogItem[]=result.models.filter((item:any)=>typeof item?.id==="string"&&typeof item?.displayName==="string").map((item:any)=>({id:item.id,displayName:item.displayName,description:typeof item.description==="string"?item.description:"",source:"runtime"}));
      if(!runtime.some(item=>item.id!=="default"))throw new Error("Claude model picker returned no concrete models.");
      const snapshot={models:runtime,fetchedAt:new Date().toISOString(),stale:false,source:"claude-cli-model-picker"};this.memory=snapshot;await this.db.putCache("claude-model-catalog",snapshot,snapshot.fetchedAt,new Date(Date.now()+86_400_000).toISOString(),"2").catch(()=>false);return snapshot;
    }catch(error){
      const cached=this.memory??await this.readStored();if(cached){const snapshot={...cached,stale:true,source:cached.source.startsWith("fallback:")?cached.source:"cache"};this.memory=snapshot;return snapshot;}
      const snapshot={models:CLAUDE_FALLBACK_MODELS,fetchedAt:new Date().toISOString(),stale:true,source:error instanceof Error?`fallback:${error.message}`:"fallback"};this.memory=snapshot;return snapshot;
    }
  }
}
