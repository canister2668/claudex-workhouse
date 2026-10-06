import {z} from "zod";
import type {DeckDatabase} from "./db/client.js";
import {normalizeDelegationSettings,claudeDelegationEffortSchema, type DelegationSettings} from "./delegation-settings.js";
import type {GlobalModelSettings} from "./global-model-settings.js";

export const EXECUTION_DEFAULTS_KEY="execution.defaults";
const providers=["codex","claude","deepseek","ollama","antigravity","grok"] as const;
const shape:Record<string,z.ZodTypeAny>={defaultProvider:z.enum(providers).optional(),codexTier:z.enum(["priority"]).nullable().optional()};
for(const provider of providers){
  shape[`${provider}Model`]=z.string().trim().max(120).optional();
  shape[`${provider}Effort`]=z.string().trim().max(30).optional();
  shape[`${provider}WorkMode`]=z.enum(["default","plan"]).optional();
  shape[`${provider}Automation`]=z.enum(["read","confirm","auto","full"]).optional();
  shape[`${provider}Permission`]=z.string().max(80).optional();
}
// Existing display/notification settings are shared as well. Unknown legacy
// fields are stripped; credentials and arbitrary localStorage never enter DB.
for(const field of ["showAvatars","showSpeech","collapseCompleted","notifications","vibration","rememberLast","enterToSend","avatarAutoCollapse","scrollAutoSwitch","immersiveScroll","hideLocalPaths","allowPaidCredits"])shape[field]=z.boolean().optional();
shape.codexAvatar=z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/).optional();
shape.avatarCollapseDelayMs=z.number().int().min(0).max(600000).optional();
shape.claudeEffort=claudeDelegationEffortSchema.optional();
export const executionDefaultsSchema=z.object(shape);
export type ExecutionDefaults=z.infer<typeof executionDefaultsSchema>;

export function applyExecutionDefaults(settings:DelegationSettings,value:unknown):DelegationSettings{
  const defaults=executionDefaultsSchema.parse(value??{}),result=structuredClone(settings);
  for(const provider of providers){
    const model=defaults[`${provider}Model`],effort=defaults[`${provider}Effort`];
    if(model)result[provider].model=model;
    if(effort!==undefined)result[provider].reasoningEffort=effort|| (provider==="claude"?"default":null);
  }
  if(Object.hasOwn(defaults,"codexTier"))result.codex.serviceTier=defaults.codexTier??null;
  return result;
}

export function assertExecutionModels(value:unknown,global:GlobalModelSettings){
  const defaults=executionDefaultsSchema.parse(value);
  for(const provider of providers){
    const model=defaults[`${provider}Model`];
    if(!model||model==="default"||global[provider].models.some(item=>item.id===model))continue;
    if(provider!=="codex"&&provider!=="claude"){defaults[`${provider}Model`]=global[provider].models[0]?.id??"";defaults[`${provider}Effort`]="default";continue;}
    throw Object.assign(new Error(`${provider}: execution default ${model} is disabled or unavailable. Select an enabled model in Execution defaults; no replacement was selected.`),{statusCode:400,code:"EXECUTION_DEFAULT_UNAVAILABLE"});
  }
  return defaults;
}

export async function effectiveDelegationSettings(db:Pick<DeckDatabase,"getSystemSetting">,base?:DelegationSettings){
  const settings=base??normalizeDelegationSettings((await db.getSystemSetting("delegation.launch-modes"))?.value);
  const defaults=(await db.getSystemSetting(EXECUTION_DEFAULTS_KEY))?.value,result=applyExecutionDefaults(settings,defaults);
  {
    const global=(await db.getSystemSetting("models.global-catalog"))?.value as GlobalModelSettings|undefined;
    for(const provider of ["deepseek","ollama","antigravity","grok"] as const){
      if(global?.[provider]?.models&&(!result[provider].model||!global[provider].models.some(item=>item.id===result[provider].model)))result[provider]={...result[provider],model:global[provider].models[0]?.id??null,reasoningEffort:null};
    }
  }
  return result;
}

export async function saveExecutionDefaults(db:Pick<DeckDatabase,"getSystemSetting"|"putSystemSettingIfUpdated">,input:{settings:unknown;baseUpdatedAt:string|null;migrate?:boolean},global:GlobalModelSettings){
  const current=await db.getSystemSetting(EXECUTION_DEFAULTS_KEY);
  // A second browser must never replace a completed one-time migration.
  if(input.migrate&&current)return{settings:executionDefaultsSchema.parse(current.value),updatedAt:current.updatedAt,migrated:false};
  const settings=input.migrate?executionDefaultsSchema.parse(input.settings):assertExecutionModels(input.settings,global),updatedAt=new Date(Math.max(Date.now(),Date.parse(current?.updatedAt??"")+1||0)).toISOString();
  if(input.migrate&&!providers.some(provider=>Boolean(settings[`${provider}Model`])))return{settings:null,updatedAt:null,migrated:false};
  const saved=await db.putSystemSettingIfUpdated(EXECUTION_DEFAULTS_KEY,settings,updatedAt,input.migrate?null:input.baseUpdatedAt);
  if(!saved.updated){if(input.migrate&&saved.current)return{settings:executionDefaultsSchema.parse(saved.current.value),updatedAt:saved.current.updatedAt,migrated:false};throw Object.assign(new Error("Execution defaults changed on another device. Reload before saving."),{statusCode:409,code:"EXECUTION_DEFAULTS_CONFLICT"});}
  return{settings,updatedAt,migrated:input.migrate===true};
}
