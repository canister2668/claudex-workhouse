import type { ProviderId } from "./types.js";

export type AutomationLevel="full"|"auto"|"confirm"|"read";
const LEVELS=new Set<AutomationLevel>(["full","auto","confirm","read"]);
const CLAUDE_PROFILES=new Set([":read-only",":workspace-write",":danger-full-access"]);
const PERMISSION_PROFILES:Record<ProviderId,ReadonlySet<string>>={codex:new Set([":read-only",":workspace",":danger-full-access"]),claude:CLAUDE_PROFILES,deepseek:CLAUDE_PROFILES,ollama:CLAUDE_PROFILES,antigravity:CLAUDE_PROFILES,grok:CLAUDE_PROFILES};

export function platformAutomationDefault(provider:ProviderId,platform:string):AutomationLevel{
  return provider==="codex"&&platform==="win32"?"confirm":"auto";
}

export function isPermissionProfile(provider:ProviderId,value:unknown):value is string{
  return typeof value==="string"&&PERMISSION_PROFILES[provider].has(value);
}

export type ExecutionSettingsSnapshot={
  requestedModel?:string|null;
  requestedReasoningEffort?:string|null;
  requestedServiceTier?:string|null;
  permissionProfile?:string|null;
  settingsUpdatedAt?:string|null;
  metadata?:Record<string,unknown>|null;
};

export function automationLevel(value:unknown,permission?:string|null):AutomationLevel{
  // The executable permission is authoritative.  Older task metadata can be
  // replayed after a thread setting was changed, so never render or execute a
  // danger-full-access profile as ordinary workspace automation (or vice
  // versa for read-only).
  if(permission===":danger-full-access")return"full";
  if(permission===":read-only")return"read";
  if(typeof value==="string"&&LEVELS.has(value as AutomationLevel))return value as AutomationLevel;
  return"auto";
}

/** Grok's persisted permission profile is the executable authority. Unlike
 * Codex, its workspace profile has no distinct confirmation transport, so a
 * stale/corrupt logical level must never upgrade it to bypassPermissions. */
export function grokAutomationLevel(value:unknown,permission?:string|null):AutomationLevel{
  if(permission===":danger-full-access")return"full";
  if(permission===":read-only")return"read";
  return"auto";
}

export function automationLevelForNewTask(provider:ProviderId,value:unknown,permission:string|null|undefined,platform:NodeJS.Platform=process.platform):AutomationLevel{
  // Codex :workspace is shared by automatic and confirmation modes, so it
  // cannot override the safer Windows default without an explicit logical
  // automation level. Read-only and full-access profiles remain unambiguous.
  if(value===undefined&&(!permission||(provider==="codex"&&permission===":workspace")))return platformAutomationDefault(provider,platform);
  return automationLevel(value,permission);
}

export function permissionForAutomation(provider:ProviderId,level:AutomationLevel){
  if(level==="full")return":danger-full-access";
  if(level==="read")return":read-only";
  return provider==="codex"?":workspace":":workspace-write";
}

export function executionPolicyTurnInstructions(provider:ProviderId,level:AutomationLevel,workspaceRoot?:string){
  const scope=level==="full"?"This turn has explicit full access: no filesystem sandbox and no approval prompt.":level==="read"?"This turn is read-only. Do not write files or claim write capability.":level==="confirm"?"This turn uses workspace access with approval when the provider requests it.":"This turn has automatic access within the selected workspace.";
  const workspace=workspaceRoot?`- Workspace root: ${JSON.stringify(workspaceRoot)}`:null;
  return[`# Claudex Workhouse effective execution policy for this turn`,`- Provider: ${provider}`,`- Automation: ${level}`,workspace,`- ${scope}`,"Treat `here`, `this project`, and unqualified repository or file references as the current workspace root. Do not select a different target by scanning parent or sibling directories, unrelated processes, or other sessions unless the user explicitly names that external path or asks for cross-workspace work.","Full filesystem access changes capability, not task scope. It does not authorize searching unrelated workspaces for a more likely target.","This per-turn policy supersedes permission assumptions and sandbox failures remembered from earlier turns in the same provider session.","When the request requires local files or commands, run a minimal current-turn probe such as pwd or a requested file read before claiming that local execution is unavailable.","Local file links work only for files below the current session workspace root on the local execution host; move artifacts from outside paths such as `/tmp` into that workspace before linking, and do not emit file links for remote execution hosts. Use a normal absolute-path link for documents, source files, HTML, images, media, and other reviewable output so Workhouse opens its viewer; the viewer already provides Download. Use `?download=1` for archives, installers, executable or package artifacts, and when the user explicitly requests direct download.","Report SANDBOX_BOOTSTRAP_FAILED or another execution blocker only when it occurs in this turn. Do not repeat an earlier bwrap failure as the current state without re-probing."].filter((line):line is string=>Boolean(line)).join("\n");
}

/** Ordering used only to compare requested against granted authority. `confirm`
 * ranks below `auto` because it cannot act without an approval, and `full`
 * ranks highest because it removes the sandbox. */
const AUTOMATION_RANK:Record<AutomationLevel,number>={read:0,confirm:1,auto:2,full:3};
export function automationRank(level:AutomationLevel){return AUTOMATION_RANK[level];}

/**
 * The source task's automation is a ceiling, not a fixed value. A caller may ask
 * for anything at or below it — read for analysis, full/write for
 * implementation — but never above it.
 */
export function assertAutomationWithinSource(requested:AutomationLevel,source:AutomationLevel){
  if(automationRank(requested)>automationRank(source))throw Object.assign(new Error(`Requested automation "${requested}" exceeds this source task's "${source}" authority.`),{statusCode:403,code:"AUTOMATION_LEVEL_ESCALATION_DENIED"});
  return requested;
}

export function assertAutomationSupported(provider:ProviderId,level:AutomationLevel){
  if(provider!=="codex"&&level==="confirm")throw Object.assign(new Error(`${provider} confirm-then-run is not supported by the compatible runtime.`),{statusCode:409,code:"AUTOMATION_LEVEL_UNSUPPORTED"});
}
export function fullAccessAcknowledgementValid(value:{dangerConfirmation?:unknown;fullAccessAcknowledged?:unknown;acknowledgementVersion?:unknown}){return value.dangerConfirmation===true&&value.fullAccessAcknowledged===true&&value.acknowledgementVersion===1;}

function settingsTime(value:string|null|undefined){
  if(!value)return 0;
  const parsed=Date.parse(value);
  return Number.isFinite(parsed)?parsed:0;
}

export function newestExecutionSettings<T extends ExecutionSettingsSnapshot>(persisted:T|null|undefined,incoming:T):T{
  if(!persisted)return incoming;
  const persistedAt=settingsTime(persisted.settingsUpdatedAt),incomingAt=settingsTime(incoming.settingsUpdatedAt);
  if(persistedAt>incomingAt)return persisted;
  if(incomingAt>persistedAt)return incoming;
  // A legacy task can have the same or no settings timestamp. Never let its
  // inferred workspace profile erase an explicitly persisted full-access mode.
  if(automationLevel(persisted.metadata?.automationLevel,persisted.permissionProfile)==="full"&&automationLevel(incoming.metadata?.automationLevel,incoming.permissionProfile)!=="full")return persisted;
  return incoming;
}
