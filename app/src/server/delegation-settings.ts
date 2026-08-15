import { z } from "zod";
import type {ClaudeModelCatalogItem} from "./claude-model-catalog.js";
import type {GlobalModelSettings} from "./global-model-settings.js";
import type {ProviderId} from "./types.js";

export const delegationLaunchModeSchema=z.enum(["managed","direct"]);
export const claudeDelegationModelSchema=z.string().trim().min(3).max(100).refine(value=>/^claude-[a-z0-9][a-z0-9._-]{1,90}(?:\[1m\])?$/i.test(value),"Invalid Claude model id.");
export const claudeDelegationEffortSchema=z.enum(["default","low","medium","high","xhigh","max"]);

const claudeDelegationSchema=z.object({
  launchMode:delegationLaunchModeSchema,
  model:claudeDelegationModelSchema,
  reasoningEffort:claudeDelegationEffortSchema
}).strict();
const codexDelegationSchema=z.object({
  launchMode:delegationLaunchModeSchema,
  model:z.string().trim().min(1).max(100).nullable(),
  reasoningEffort:z.string().trim().min(1).max(30).regex(/^[a-z][a-z0-9-]{0,29}$/i).nullable(),
  serviceTier:z.enum(["priority"]).nullable().default(null)
}).strict();
const managedDelegationSchema=z.object({
  launchMode:z.literal("managed"),
  model:z.string().trim().min(1).max(120).nullable(),
  reasoningEffort:z.string().trim().min(1).max(30).nullable()
}).strict();

const compatibleDefaultSchema=z.object({
  model:z.string().trim().min(1).max(120).nullable(),
  reasoningEffort:z.string().trim().min(1).max(30).nullable()
}).strict();

export const compatibleDelegationDefaultsSchema=z.object({
  deepseek:compatibleDefaultSchema,
  ollama:compatibleDefaultSchema,
  antigravity:compatibleDefaultSchema
  ,grok:compatibleDefaultSchema
}).strict();

export const delegationSettingsSchema=z.object({
  version:z.literal(3),
  claude:claudeDelegationSchema,
  codex:codexDelegationSchema,
  deepseek:managedDelegationSchema,
  ollama:managedDelegationSchema,
  antigravity:managedDelegationSchema
  ,grok:managedDelegationSchema
}).strict();

export type DelegationLaunchMode=z.infer<typeof delegationLaunchModeSchema>;
export type DelegationSettings=z.infer<typeof delegationSettingsSchema>;
export type DelegationProviderSettings=DelegationSettings["claude"]|DelegationSettings["codex"];
export type DelegationCodexModel={id:string;hidden?:boolean;isDefault?:boolean;defaultReasoningEffort:string;supportedReasoningEfforts:Array<{reasoningEffort:string}>;serviceTiers?:Array<{id:string}>};
export type CompatibleDelegationDefaults=z.infer<typeof compatibleDelegationDefaultsSchema>;

export const DEFAULT_DELEGATION_SETTINGS:DelegationSettings={
  version:3,
  claude:{launchMode:"managed",model:"claude-opus-5",reasoningEffort:"default"},
  codex:{launchMode:"managed",model:null,reasoningEffort:null,serviceTier:null},
  deepseek:{launchMode:"managed",model:null,reasoningEffort:null},
  ollama:{launchMode:"managed",model:null,reasoningEffort:null},
  antigravity:{launchMode:"managed",model:null,reasoningEffort:null},
  grok:{launchMode:"managed",model:null,reasoningEffort:null}
};

const mode=(value:unknown):DelegationLaunchMode=>value==="direct"?"direct":"managed";
export function normalizeDelegationSettings(value:unknown):DelegationSettings{
  const parsed=delegationSettingsSchema.safeParse(value);
  if(parsed.success)return parsed.data;
  const source=value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,any>:{};
  const legacy=typeof source.codex==="string"||typeof source.claude==="string";
  const claude=legacy?{}:source.claude&&typeof source.claude==="object"?source.claude:{};
  const codex=legacy?{}:source.codex&&typeof source.codex==="object"?source.codex:{};
  return{
    version:3,
    claude:{
      launchMode:mode(legacy?source.claude:claude.launchMode),
      model:claudeDelegationModelSchema.safeParse(claude.model).success?claude.model:DEFAULT_DELEGATION_SETTINGS.claude.model,
      reasoningEffort:claudeDelegationEffortSchema.safeParse(claude.reasoningEffort).success?claude.reasoningEffort:DEFAULT_DELEGATION_SETTINGS.claude.reasoningEffort
    },
    codex:{
      launchMode:mode(legacy?source.codex:codex.launchMode),
      model:typeof codex.model==="string"&&codex.model.trim()?codex.model.trim():null,
      reasoningEffort:typeof codex.reasoningEffort==="string"&&codexDelegationSchema.shape.reasoningEffort.safeParse(codex.reasoningEffort).success?codex.reasoningEffort.trim():null,
      serviceTier:codex.serviceTier==="priority"?"priority":null
    },
    ...Object.fromEntries((["deepseek","ollama","antigravity","grok"] as const).map(provider=>{const selected=source[provider]&&typeof source[provider]==="object"?source[provider]:{};return[provider,{launchMode:"managed" as const,model:typeof selected.model==="string"&&selected.model.trim()?selected.model.trim():null,reasoningEffort:typeof selected.reasoningEffort==="string"&&selected.reasoningEffort.trim()?selected.reasoningEffort.trim():null}];})) as Pick<DelegationSettings,"deepseek"|"ollama"|"antigravity"|"grok">
  };
}

export function validateDelegationSettings(settings:DelegationSettings,models:DelegationCodexModel[],fallback=false,claudeModels?:Pick<ClaudeModelCatalogItem,"id">[]):DelegationSettings{
  let normalized=settings;
  if(claudeModels){
    const available=new Set(claudeModels.filter(item=>item.id!=="default").map(item=>item.id));
    if(!available.has(normalized.claude.model)){
      if(!fallback)throw Object.assign(new Error("Selected Claude delegation model is unavailable."),{statusCode:400});
      const replacement=available.has(DEFAULT_DELEGATION_SETTINGS.claude.model)?DEFAULT_DELEGATION_SETTINGS.claude.model:[...available][0];
      if(replacement)normalized={...normalized,claude:{...normalized.claude,model:replacement}};
    }
  }
  const visible=models.filter(item=>!item.hidden),selected=normalized.codex.model?visible.find(item=>item.id===normalized.codex.model):visible.find(item=>item.isDefault);
  if(!selected){
    if(fallback)return{...normalized,codex:{...normalized.codex,model:null,reasoningEffort:null,serviceTier:null}};
    throw Object.assign(new Error("Selected Codex delegation model is unavailable."),{statusCode:400});
  }
  const effort=normalized.codex.reasoningEffort;
  if(effort&&!selected.supportedReasoningEfforts.some(item=>item.reasoningEffort===effort)){
    if(fallback)return{...normalized,codex:{...normalized.codex,reasoningEffort:null}};
    throw Object.assign(new Error("Reasoning effort is not supported by the selected Codex delegation model."),{statusCode:400});
  }
  if(normalized.codex.serviceTier&&!selected.serviceTiers?.some(item=>item.id===normalized.codex.serviceTier)){
    if(fallback)return{...normalized,codex:{...normalized.codex,serviceTier:null}};
    throw Object.assign(new Error("Service tier is not supported by the selected Codex delegation model."),{statusCode:400});
  }
  return normalized;
}

export function delegationProviderSettings(settings:DelegationSettings,provider:ProviderId){
  return settings[provider];
}

export function applyGlobalDelegationModels(settings:DelegationSettings,global:GlobalModelSettings,codexModels:DelegationCodexModel[],compatibleDefaults?:CompatibleDelegationDefaults):DelegationSettings{
  const claudeIds=new Set(global.claude.models.map(item=>item.id)),codexIds=new Set(global.codex.models.map(item=>item.id));
  const claudeModel=claudeIds.has(settings.claude.model)?settings.claude.model:global.claude.models[0]?.id??settings.claude.model;
  const codexDefault=codexModels.find(item=>item.isDefault&&codexIds.has(item.id))?.id??global.codex.models[0]?.id??null;
  const codexModel=settings.codex.model&&codexIds.has(settings.codex.model)?settings.codex.model:codexDefault;
  const compatible=Object.fromEntries((['deepseek','ollama','antigravity','grok'] as const).map(provider=>{
    const ids=new Set(global[provider].models.map(item=>item.id)),preferred=compatibleDefaults?.[provider]??settings[provider];
    const model=preferred.model&&ids.has(preferred.model)?preferred.model:global[provider].models[0]?.id??null;
    return[provider,{...settings[provider],model,reasoningEffort:model===preferred.model?preferred.reasoningEffort:null}];
  })) as Pick<DelegationSettings,"deepseek"|"ollama"|"antigravity"|"grok">;
  return{...settings,...compatible,claude:{...settings.claude,model:claudeModel},codex:{...settings.codex,model:codexModel,reasoningEffort:codexModel===settings.codex.model?settings.codex.reasoningEffort:null,serviceTier:codexModel===settings.codex.model?settings.codex.serviceTier:null}};
}

function directCommand(provider:"codex"|"claude",settings:DelegationSettings){
  if(provider==="claude"){
    const selected=settings.claude;
    const argv=["claude","-p","--no-session-persistence","--model",selected.model,...(selected.reasoningEffort==="default"?[]:["--effort",selected.reasoningEffort]),"--","<prompt>"];
    return JSON.stringify(argv);
  }
  const selected=settings.codex;
  const argv=["codex","exec","--ephemeral",...(selected.model?["--model",selected.model]:[]),...(selected.reasoningEffort?["-c",`model_reasoning_effort="${selected.reasoningEffort}"`]:[]),...(selected.serviceTier?["-c",`service_tier="${selected.serviceTier}"`]:[]),"--","<prompt>"];
  return JSON.stringify(argv);
}

function providerName(provider:ProviderId){return{codex:"Codex",claude:"Claude Code",deepseek:"DeepSeek",ollama:"Ollama",antigravity:"Gemini/Antigravity",grok:"Grok"}[provider];}
function providerRule(provider:ProviderId,settings:DelegationSettings){
  const name=providerName(provider),selected=settings[provider];
  if(selected.launchMode==="managed")return `- Named ${name} delegation defaults to a tracked, persistent Claudex Workhouse/background session. Use the managed_provider_task_create/get/wait/resume tools when available. Claudex Workhouse applies the global target model and reasoning settings and gives the managed task a durable execution deadline. Choose the target's access with managed_provider_task_create's automationLevel: read for analysis or review, full/auto for implementation. Omitting it inherits the current source task's effective mode, so a full-auto source task creates a full-auto managed target task; do not describe it as read-only or plan mode unless the source task is actually read-only. A level above this source task's own authority is refused. Several managed sessions, including several writers, may run against one workspace at the same time, so an active writer never blocks creating another; parallel writers are instructed to re-read before editing, preserve unrelated uncommitted changes, and stop only on a real conflict in the same region. The wait timeout is observation-only: a running result is not a failure, and you should get or wait again instead of resuming or creating a replacement. Resume only after a verified terminal failure with a confirmed thread ID. Later turns in the same source provider thread may continue using the confirmed task ID. Verify provider/ownership/source/workspace/taskId/threadId/status, and do not replace it with an untracked one-shot CLI process.`;
  return `- Named ${name} delegation defaults to a direct one-shot CLI process without Claudex Workhouse session tracking or persistence. Use this global argv shape: ${directCommand(provider as "codex"|"claude",settings)}. Replace "<prompt>" with one argv value and execute the array directly; do not reconstruct it as a shell string. These explicit model/reasoning flags override project or user defaults. State clearly that it will not appear as a separate resumable session.`;
}

export function delegationDeveloperInstructions(settings:DelegationSettings,activeProvider:ProviderId){
  return [`# Claudex Workhouse named-provider delegation`,
    `These global defaults apply installation-wide, across every workspace, only when the user names a provider but does not choose an execution form. An explicit request for a managed/tracked/background session or a direct/one-shot/temporary CLI always overrides the launch mode, while the global target model and reasoning settings still apply.`,
    providerRule("codex",settings),providerRule("claude",settings),providerRule("deepseek",settings),providerRule("ollama",settings),providerRule("antigravity",settings),providerRule("grok",settings),
    `- The active provider is ${providerName(activeProvider)}. Provider identity has priority: never substitute the active provider or its native subagents when the user explicitly names another provider.`,
    `- If the selected execution mechanism or configured model is unavailable, report that limitation instead of silently switching provider, model, or persistence mode.`,
    `\n# Turn boundary`,
    `- A Claudex Workhouse task is a single non-interactive turn. The provider process exits when you end the turn, so nothing re-invokes you afterwards: background shells, monitors, scheduled wakeups, watchers, and completion notifications cannot fire once the turn is over, and whatever they were going to report is lost.`,
    `- Therefore never end a turn with a promise to report later. Poll the work to completion inside the turn, or end with what you actually verified and state plainly which part is still unfinished and how the user can check it.`,
    ...(activeProvider==="claude"?[`
# Claude Code native subagents
- After launching native Agent subagents, wait for every requested agent to reach a terminal state, reconcile failures, and synthesize their completed results before finishing. Do not describe a failed or completed agent as still running, and do not claim findings from an agent whose result was unavailable. Only leave agents running when the user explicitly requests fire-and-forget background work.
- The same turn boundary applies to the Monitor tool, \`run_in_background\` shells, and task notifications: their re-invocation promises assume an interactive session and do not hold here.`]:[]),
    `\n# Git execution policy`,
    `- Read-only Git inspection, diff, log, status, branch listing, staging, fetch, and branch creation/switching may be performed when they are ordinary steps within the user's requested work.`,
    `- Create a commit only when the user explicitly asks to commit. Push only when the user explicitly asks to push; a commit request alone never authorizes push.`,
    `- Force push, branch or tag deletion, history rewrite, hard reset, clean, remote branch deletion, and discarding the working tree require a separate destructive-operation confirmation.`,
    `- Never put credentials in a remote URL, logs, prompts, session metadata, or task metadata. Use the host credential helper, SSH agent, or existing gh authentication.`,
    `- After an explicitly requested commit or push, report the branch, commit SHA and message, push result, remote/upstream, and remaining changed files.`].join("\n");
}
