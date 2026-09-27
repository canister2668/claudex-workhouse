import type { GlobalModelSettings } from "./global-model-settings.js";
import type { ProviderId } from "./types.js";

// Resolve only within the owner's enabled catalog. Never guess a version or
// silently replace a requested provider/model with the configured default.
export function resolveManagedModel(settings:GlobalModelSettings,provider:ProviderId,requested:string){
  const models=settings[provider].models;
  if(models.some(item=>item.id===requested))return requested;
  const normalize=(value:string)=>value.trim().toLowerCase().replace(/\s+/g," ");
  const label=normalize(requested);
  let matches=models.filter(item=>normalize(item.id)===label||normalize(item.displayName)===label);
  if(!matches.length&&provider==="claude"){
    const key=(value:string)=>normalize(value).replace(/^claude[- ]/,"").replace(/[ .]+/g,"-");
    // An omitted context qualifier may select a unique enabled variant. An
    // explicit qualifier must match; two variants require an exact choice.
    const requestedKey=key(requested);
    matches=models.filter(item=>key(item.id)===requestedKey||(!requested.includes("[")&&key(item.id.replace(/\[1m\]$/i,""))===requestedKey));
  }
  if(matches.length===1)return matches[0].id;
  const available=models.map(item=>item.id);
  throw Object.assign(new Error(`${provider} model ${JSON.stringify(requested)} ${matches.length?"is ambiguous":"is not enabled"}. Enabled model IDs: ${available.join(", ")||"(none)"}. Use managed_provider_models before creating a task; no replacement was selected.`),{statusCode:400,code:matches.length?"MODEL_AMBIGUOUS":"MODEL_NOT_ENABLED",errorParams:{provider,model:requested,available}});
}

export type ManagedModelCatalog={settings:GlobalModelSettings;updatedAt:string|null};
