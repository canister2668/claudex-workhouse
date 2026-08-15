import type { AppConfig } from "../config.js";
import { DeckDatabase } from "../db/client.js";
import { withCodexAppServer } from "./app-server.js";

export type ModelInfo = {
  id: string; model: string; displayName: string; hidden: boolean; isDefault: boolean;
  defaultReasoningEffort: string; supportedReasoningEfforts: Array<{reasoningEffort:string;description:string}>;
  inputModalities: string[]; supportsPersonality: boolean;
  additionalSpeedTiers: string[]; serviceTiers: Array<{id:string;name:string;description:string}>;
  defaultServiceTier: string | null;
};
export type PermissionInfo = { id:string; description:string|null; allowed:boolean };
type CodexCatalogSnapshot={models:ModelInfo[];permissions:PermissionInfo[];fetchedAt:string;stale:boolean;error?:string};
const CATALOG_FRESH_MS=300000;
const FAILED_REFRESH_RETRY_MS=60000;

export class CodexCatalog {
  private memory:CodexCatalogSnapshot|null=null;
  private inflight:Promise<CodexCatalogSnapshot>|null=null;
  private lastAttemptAt=0;
  constructor(private config: AppConfig, private db: DeckDatabase) {}

  async get(force = false) {
    if(force)return this.refresh();
    if(!this.memory)this.memory=await this.readStored();
    if(this.memory){
      if(this.expired(this.memory)){
        if(!this.memory.stale)this.memory={...this.memory,stale:true};
        this.refreshInBackground();
      }
      return this.memory;
    }
    return this.refresh();
  }

  private expired(snapshot:CodexCatalogSnapshot){
    const fetchedAt=Date.parse(snapshot.fetchedAt);
    return snapshot.stale||!Number.isFinite(fetchedAt)||Date.now()-fetchedAt>=CATALOG_FRESH_MS;
  }

  private async readStored():Promise<CodexCatalogSnapshot|null>{
    const cached=await this.db.getCache("codex-catalog").catch(()=>null) as any;
    if(!cached?.value?.models||!Array.isArray(cached.value.models)||!cached.value.models.length)return null;
    const fetchedAt=typeof cached.value.fetchedAt==="string"?cached.value.fetchedAt:cached.fetchedAt;
    const stale=!Number.isFinite(Date.parse(fetchedAt))||Date.now()-Date.parse(fetchedAt)>=CATALOG_FRESH_MS;
    return{...cached.value,fetchedAt,stale};
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

  private async loadFresh() {
    try {
      const result = await withCodexAppServer(this.config.root, 30000, async (client) => {
        const [models, permissions] = await Promise.all([client.request("model/list", { limit: 100 }), client.request("permissionProfile/list", { limit: 100 })]);
        return { models: models.data as ModelInfo[], permissions: (permissions.data as PermissionInfo[]).filter((item) => item.allowed), fetchedAt: new Date().toISOString(), stale: false };
      });
      this.memory = result;
      await this.db.putCache("codex-catalog", result, result.fetchedAt, new Date(Date.now()+86400000).toISOString(), "0.144.1").catch(() => false);
      return result;
    } catch (error) {
      const cached=this.memory??await this.readStored();
      if(cached){const snapshot={...cached,stale:true,error:error instanceof Error?error.message:String(error)};this.memory=snapshot;return snapshot;}
      throw error;
    }
  }

  async validate(input: {model?:string|null;reasoningEffort?:string|null;serviceTier?:string|null;permissionProfile?:string|null}) {
    const catalog = await this.get();
    const models = catalog.models as ModelInfo[];
    const permissions = catalog.permissions as PermissionInfo[];
    let model = input.model ? models.find((item:ModelInfo) => item.id === input.model && !item.hidden) : models.find((item:ModelInfo) => item.isDefault && !item.hidden);
    if(!model&&input.model){const setting=await this.db.getSystemSetting("models.global-catalog").catch(()=>null),custom=(setting?.value as any)?.codex?.models?.find((item:any)=>item?.id===input.model&&item?.source==="custom"),base=models.find((item:ModelInfo)=>item.isDefault&&!item.hidden)??models.find((item:ModelInfo)=>!item.hidden);if(custom&&base)model={...base,id:input.model,model:input.model,displayName:custom.displayName,isDefault:false};}
    if (!model) throw Object.assign(new Error("Selected Codex model is unavailable."), { statusCode: 400 });
    const effort = input.reasoningEffort ?? model.defaultReasoningEffort;
    if (!model.supportedReasoningEfforts.some((item:{reasoningEffort:string}) => item.reasoningEffort === effort)) throw Object.assign(new Error("Reasoning effort is not supported by the selected model."), { statusCode: 400 });
    const tier = input.serviceTier ?? null;
    if (tier !== null && !model.serviceTiers.some((item:{id:string}) => item.id === tier)) throw Object.assign(new Error("Service tier is not supported by the selected model."), { statusCode: 400 });
    const permission = input.permissionProfile ?? ":workspace";
    if (!permissions.some((item:PermissionInfo) => item.id === permission && item.allowed)) throw Object.assign(new Error("Permission profile is unavailable."), { statusCode: 400 });
    return { model: model.id, reasoningEffort: effort, serviceTier: tier, permissionProfile: permission, catalog };
  }
}
