export type AutomationLevel="full"|"auto"|"confirm"|"read";

type Provider="codex"|"claude"|"deepseek"|"ollama"|"antigravity"|"grok";
export function platformAutomationDefault(provider:Provider,platform:string):AutomationLevel{
  return provider==="codex"&&platform==="win32"?"confirm":"auto";
}

export function shouldApplyPlatformAutomationDefault(platform:string,recommended:unknown,persistedValues:unknown[]){
  return platform==="win32"&&recommended==="confirm"&&!persistedValues.some(value=>typeof value==="string"&&value.length>0);
}

export function automationLevelOf(permission:string|null|undefined,metadata:Record<string,unknown>|null|undefined):AutomationLevel{
  // permissionProfile is what the provider actually receives.  Prefer it to
  // stale metadata restored from an older turn.
  if(permission===":danger-full-access")return"full";
  if(permission===":read-only")return"read";
  const explicit=metadata?.automationLevel;
  if(explicit==="full"||explicit==="auto"||explicit==="confirm"||explicit==="read")return explicit;
  return"auto";
}

export function permissionForAutomation(provider:Provider,level:AutomationLevel){
  if(level==="full")return":danger-full-access";
  if(level==="read")return":read-only";
  return provider==="codex"?":workspace":":workspace-write";
}
export const automationLevelLabel=(level:AutomationLevel)=>translate(level==="full"?"permission.fullAccess":level==="auto"?"permission.automatic":level==="confirm"?"permission.confirm":"permission.readOnly");
import { translate } from "./i18n";
