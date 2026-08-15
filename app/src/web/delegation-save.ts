export type DelegationSelection = {
  version:3;
  claude:{model:string};
  codex:{model:string|null};
  deepseek:{model:string|null;reasoningEffort:string|null};
  ollama:{model:string|null;reasoningEffort:string|null};
  antigravity:{model:string|null;reasoningEffort:string|null};
  grok:{model:string|null;reasoningEffort:string|null};
};

export type CompatibleProvider="deepseek"|"ollama"|"antigravity"|"grok";
export const COMPATIBLE_PROVIDERS:CompatibleProvider[]=["deepseek","ollama","antigravity","grok"];

type EnabledModels=Record<"claude"|"codex"|CompatibleProvider,{models:Array<{id:string}>}>;

export function reconcileDelegationAfterModelSave<T extends DelegationSelection>(
  pending:T,
  server:T,
  enabled:EnabledModels
):T{
  const claude=enabled.claude.models.some(item=>item.id===pending.claude.model)?pending.claude:server.claude;
  const codex=pending.codex.model===null||enabled.codex.models.some(item=>item.id===pending.codex.model)?pending.codex:server.codex;
  const compatible=Object.fromEntries(COMPATIBLE_PROVIDERS.map(provider=>[provider,pending[provider].model&&enabled[provider].models.some(item=>item.id===pending[provider].model)?pending[provider]:server[provider]]));
  return{...server,...compatible,version:pending.version,claude,codex} as T;
}

export function compatibleDefaultsFromUi<T extends DelegationSelection>(settings:T,models:Record<CompatibleProvider,string>,efforts:Record<CompatibleProvider,string>):T{
  const compatible=Object.fromEntries(COMPATIBLE_PROVIDERS.map(provider=>[provider,{...settings[provider],model:models[provider]||null,reasoningEffort:efforts[provider]&&efforts[provider]!=="default"?efforts[provider]:null}]));
  return{...settings,...compatible};
}

export function compatibleUiFromDelegation(settings:DelegationSelection,currentModels:Record<CompatibleProvider,string>,currentEfforts:Record<CompatibleProvider,string>){
  return{
    models:Object.fromEntries(COMPATIBLE_PROVIDERS.map(provider=>[provider,currentModels[provider]||settings[provider].model||""])) as Record<CompatibleProvider,string>,
    efforts:Object.fromEntries(COMPATIBLE_PROVIDERS.map(provider=>[provider,currentModels[provider]?currentEfforts[provider]:settings[provider].reasoningEffort??"default"])) as Record<CompatibleProvider,string>
  };
}

export function compatibleDefaultsPayload(settings:DelegationSelection){
  return Object.fromEntries(COMPATIBLE_PROVIDERS.map(provider=>[provider,{model:settings[provider].model,reasoningEffort:settings[provider].reasoningEffort}])) as Record<CompatibleProvider,{model:string|null;reasoningEffort:string|null}>;
}
