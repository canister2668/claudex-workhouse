import {z} from "zod";
import type {ModelInfo} from "./codex/catalog.js";
import type {ClaudeModelCatalogItem} from "./claude-model-catalog.js";

export const globalModelIdSchema=z.string().trim().min(2).max(120).refine(value=>/^[a-z0-9][a-z0-9 ._:/()+-]{0,118}(?:\[1m\])?$/i.test(value),"Invalid model id.");
const modelEntrySchema=z.object({id:globalModelIdSchema,displayName:z.string().trim().min(1).max(80),source:z.enum(["runtime","custom"]),validatedAt:z.string().datetime().nullable().default(null)}).strict();
const providerModels=(minimum=1)=>z.object({models:z.array(modelEntrySchema).min(minimum).max(100)}).strict();
export const globalModelSettingsSchema=z.object({version:z.literal(1),claude:providerModels(),codex:providerModels(),deepseek:providerModels(0),ollama:providerModels(0),antigravity:providerModels(0),grok:providerModels(0)}).strict();
export type GlobalModelEntry=z.infer<typeof modelEntrySchema>;
export type GlobalModelSettings=z.infer<typeof globalModelSettingsSchema>;

export function modelCandidates(codexModels:ModelInfo[],claudeModels:ClaudeModelCatalogItem[],deepseekModels:Array<{id:string;displayName:string;source:"runtime"}>=[],ollamaModels:Array<{id:string;displayName:string;source:"runtime"}>=[],antigravityModels:Array<{id:string;displayName:string;source:"runtime"}>=[],grokModels:Array<{id:string;displayName:string;source:"runtime"}>=[]){
  return{
    codex:codexModels.filter(item=>!item.hidden).map(item=>({id:item.id,displayName:item.displayName,source:"runtime" as const,validatedAt:null})),
    claude:claudeModels.filter(item=>item.id!=="default").map(item=>({id:item.id,displayName:item.displayName,source:item.source,validatedAt:null})),
    deepseek:deepseekModels.map(item=>({...item,validatedAt:null})),
    ollama:ollamaModels.map(item=>({...item,validatedAt:null})),
    antigravity:antigravityModels.map(item=>({...item,validatedAt:null})),
    grok:grokModels.map(item=>({...item,validatedAt:null}))
  };
}

function mergeStored(stored:GlobalModelEntry[]|undefined,candidates:GlobalModelEntry[],preserveRuntimeWhenUnavailable=false){
  if(!stored?.length)return candidates;
  if(preserveRuntimeWhenUnavailable&&!candidates.length)return stored;
  const available=new Map(candidates.map(item=>[item.id,item])),result:GlobalModelEntry[]=[];
  for(const item of stored){
    if(item.source==="custom")result.push(item);
    else{const current=available.get(item.id);if(current)result.push({...current,validatedAt:item.validatedAt});}
  }
  return result.length?result:candidates.slice(0,1);
}

type ModelCandidates=Record<"codex"|"claude"|"deepseek"|"ollama",GlobalModelEntry[]>&{antigravity?:GlobalModelEntry[];grok?:GlobalModelEntry[]};
export function normalizeGlobalModelSettings(value:unknown,candidates:ModelCandidates):GlobalModelSettings{
  const parsed=globalModelSettingsSchema.safeParse(value),previous=z.object({version:z.literal(1),claude:providerModels(),codex:providerModels(),deepseek:providerModels(),ollama:providerModels(0),antigravity:providerModels(0)}).strict().safeParse(value),legacy=z.object({version:z.literal(1),claude:providerModels(),codex:providerModels()}).strict().safeParse(value),stored=parsed.success?parsed.data:previous.success?{...previous.data,grok:{models:[]}}:legacy.success?{...legacy.data,deepseek:{models:[]},ollama:{models:[]},antigravity:{models:[]},grok:{models:[]}}:null,malformed=value!==null&&value!==undefined&&!parsed.success&&!previous.success&&!legacy.success;
  // A missing setting means a fresh install and exposes the full runtime
  // catalog. A malformed persisted value is different: fail closed to one
  // valid runtime choice per provider instead of silently widening access.
  const codexCandidates=malformed?candidates.codex.slice(0,1):candidates.codex,claudeCandidates=malformed?candidates.claude.slice(0,1):candidates.claude;
  const antigravityCatalog=candidates.antigravity??[],grokCatalog=candidates.grok??[],deepseekCandidates=malformed?candidates.deepseek.slice(0,1):candidates.deepseek,ollamaCandidates=malformed?candidates.ollama.slice(0,1):candidates.ollama,antigravityCandidates=malformed?antigravityCatalog.slice(0,1):antigravityCatalog,grokCandidates=malformed?grokCatalog.slice(0,1):grokCatalog;
  return{version:1,codex:{models:mergeStored(stored?.codex.models,codexCandidates)},claude:{models:mergeStored(stored?.claude.models,claudeCandidates)},deepseek:{models:mergeStored(stored?.deepseek.models,deepseekCandidates,true)},ollama:{models:mergeStored(stored?.ollama.models,ollamaCandidates,true)},antigravity:{models:mergeStored(stored?.antigravity.models,antigravityCandidates,true)},grok:{models:mergeStored(stored?.grok.models,grokCandidates,true)}};
}

export function validateGlobalModelSettings(value:unknown,candidates:ModelCandidates):GlobalModelSettings{
  const settings=globalModelSettingsSchema.parse(value);
  for(const provider of ["codex","claude","deepseek","ollama","antigravity","grok"] as const){
    const catalog=candidates[provider]??[],available=new Set(catalog.map(item=>item.id)),seen=new Set<string>();
    for(const item of settings[provider].models){
      if(seen.has(item.id))throw Object.assign(new Error(`Duplicate ${provider} model: ${item.id}`),{statusCode:400});
      if(item.source==="runtime"&&!available.has(item.id)&&!((provider==="deepseek"||provider==="ollama"||provider==="antigravity"||provider==="grok")&&!catalog.length))throw Object.assign(new Error(`Runtime ${provider} model is no longer available: ${item.id}`),{statusCode:400});
      seen.add(item.id);
    }
  }
  return settings;
}

export function modelEnabled(settings:GlobalModelSettings,provider:"codex"|"claude"|"deepseek"|"ollama"|"antigravity"|"grok",model:string|null|undefined){return !model||model==="default"||settings[provider].models.some(item=>item.id===model);}

export function requireEnabledModels(settings:GlobalModelSettings,selections:Array<{provider:"codex"|"claude"|"deepseek"|"ollama"|"antigravity"|"grok";model:string|null|undefined}>){
  for(const{provider,model}of selections){
    if(modelEnabled(settings,provider,model))continue;
    throw Object.assign(new Error(`${provider} model is not enabled in the global model catalog: ${model}`),{statusCode:400,code:"MODEL_NOT_ENABLED",errorParams:{provider,model}});
  }
}
