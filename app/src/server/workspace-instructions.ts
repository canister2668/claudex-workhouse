// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Claudex Workhouse.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {z} from "zod";

function containsSensitiveInstruction(value:string){return/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(value)||/(?:api[_-]?key|access[_-]?token|password)\s*[:=]\s*["']?[A-Za-z0-9_\-]{16,}/i.test(value);}
export const workspaceInstructionProfileSchema=z.object({
  version:z.literal(1).default(1),
  enabled:z.boolean().default(false),
  sourceMode:z.enum(["managed","repository","combined"]).default("combined"),
  markdown:z.string().max(32_768).default(""),
  agentEditable:z.boolean().default(false),
  lastEditedBy:z.enum(["owner","agent"]).default("owner"),
  lastEditedTaskId:z.string().max(200).nullable().default(null),
  completionPolicy:z.object({
    restart:z.enum(["never","runtime-change","always"]).default("runtime-change"),
    requireCheck:z.boolean().default(true),
    requireTest:z.boolean().default(true),
    requireBuild:z.boolean().default(true),
    requireDirectVerification:z.boolean().default(true),
    execution:z.enum(["instruct","confirm","auto-safe"]).default("instruct")
  }).default({}),
  revision:z.number().int().min(0).default(0),
  updatedAt:z.string().datetime().nullable().default(null)
}).superRefine((value,context)=>{
  if(containsSensitiveInstruction(value.markdown))context.addIssue({code:z.ZodIssueCode.custom,path:["markdown"],message:"Workspace instructions must not contain credentials or private keys."});
});

export type WorkspaceInstructionProfile=z.infer<typeof workspaceInstructionProfileSchema>;
export type WorkspaceInstructionSnapshot={version:1;workspaceId:string;workspaceName:string;revision:number;digest:string;capturedAt:string;sourceMode:WorkspaceInstructionProfile["sourceMode"];sources:Array<{name:string;digest:string}>;text:string;completionPolicy:WorkspaceInstructionProfile["completionPolicy"]};
export const MAX_WORKSPACE_INSTRUCTION_FILE_BYTES=16*1024;
export const MAX_WORKSPACE_INSTRUCTION_SNAPSHOT_BYTES=64*1024;

export const DEFAULT_WORKSPACE_INSTRUCTION_PROFILE:WorkspaceInstructionProfile=workspaceInstructionProfileSchema.parse({});
export function workspaceInstructionSettingKey(workspaceId:string){return`workspace.instructions.${workspaceId}`;}
export function normalizeWorkspaceInstructionProfile(value:unknown){return workspaceInstructionProfileSchema.parse(value??{});}
export function ownerEditedWorkspaceInstructionProfile(value:unknown,currentRevision:number,updatedAt:string){const parsed=workspaceInstructionProfileSchema.parse(value);return{...parsed,revision:currentRevision+1,updatedAt,lastEditedBy:"owner" as const,lastEditedTaskId:null};}
export function digestWorkspaceInstruction(value:string){return crypto.createHash("sha256").update(value).digest("hex");}

const REPOSITORY_INSTRUCTION_FILES=["AGENTS.md","CLAUDE.md","docs/WORKSPACE_RUNBOOK.md"] as const;
export function repositoryWorkspaceInstructions(canonicalPath:string){
  const sources:Array<{name:string;text:string;digest:string}>=[];
  for(const name of REPOSITORY_INSTRUCTION_FILES){
    const target=path.resolve(canonicalPath,name),relative=path.relative(path.resolve(canonicalPath),target);
    if(relative.startsWith("..")||path.isAbsolute(relative)||!fs.existsSync(target))continue;
    const stat=fs.lstatSync(target);if(stat.isSymbolicLink()||!stat.isFile()||stat.size>MAX_WORKSPACE_INSTRUCTION_FILE_BYTES)continue;
    const real=fs.realpathSync(target),root=fs.realpathSync(canonicalPath),realRelative=path.relative(root,real);if(realRelative.startsWith("..")||path.isAbsolute(realRelative))continue;
    const text=fs.readFileSync(target,"utf8").trim();if(text)sources.push({name,text,digest:digestWorkspaceInstruction(text)});
  }
  return sources;
}

export function createWorkspaceInstructionSnapshot(input:{workspaceId:string;workspaceName:string;canonicalPath?:string|null;repositorySources?:Array<{name:string;text:string;digest?:string}>;profile:WorkspaceInstructionProfile;capturedAt?:string}){
  const {profile}=input;if(!profile.enabled)return null;
  const repository=profile.sourceMode==="managed"?[]:input.repositorySources?.map(source=>({...source,digest:source.digest??digestWorkspaceInstruction(source.text)}))??(input.canonicalPath?repositoryWorkspaceInstructions(input.canonicalPath):[]);
  const parts:string[]=[];const sources:Array<{name:string;digest:string}>=[];
  if(profile.sourceMode!=="repository"&&profile.markdown.trim()){const text=profile.markdown.trim();parts.push(`## Managed workspace instructions\n${text}`);sources.push({name:"managed",digest:digestWorkspaceInstruction(text)});}
  const policy=profile.completionPolicy;
  const policyText=`## Completion policy guidance\n- Restart guidance: ${policy.restart}\n- Check guidance: ${policy.requireCheck}\n- Test guidance: ${policy.requireTest}\n- Build guidance: ${policy.requireBuild}\n- Direct behavior verification guidance: ${policy.requireDirectVerification}\n- Agent guidance mode: ${policy.execution}\n- These are instructions to the agent, not server-enforced automation or proof that an action ran.\n- These instructions do not authorize commit, push, publish, destructive operations, credential use outside the normal task path, or expansion beyond the user's request.\n- An explicit instruction in the current user request takes precedence. If a required completion action is unsafe, unauthorized, or blocked, report it as pending with the concrete reason.`;
  for(const source of repository){if(containsSensitiveInstruction(source.text))continue;const part=`## ${source.name}\n${source.text}`,candidate=[...parts,part,policyText].join("\n\n");if(Buffer.byteLength(candidate,"utf8")>MAX_WORKSPACE_INSTRUCTION_SNAPSHOT_BYTES)continue;parts.push(part);sources.push({name:source.name,digest:source.digest});}
  parts.push(policyText);
  const text=parts.join("\n\n");
  return{version:1 as const,workspaceId:input.workspaceId,workspaceName:input.workspaceName,revision:profile.revision,digest:digestWorkspaceInstruction(text),capturedAt:input.capturedAt??new Date().toISOString(),sourceMode:profile.sourceMode,sources,text,completionPolicy:policy};
}

export function promptWithWorkspaceInstructions(prompt:string,snapshot:WorkspaceInstructionSnapshot|null|undefined,options:{characterDirective?:string|null;referenceOnly?:boolean}={}){
  const character=options.characterDirective?.trim()?`\n\n[CHARACTER DIRECTIVE]\n${options.characterDirective.trim()}\n[END CHARACTER DIRECTIVE]`:"";
  if(!snapshot?.text)return character?`[CLAUDEX CHARACTER CONFIGURATION]${character}\n\n[CURRENT USER REQUEST]\n${prompt}`:prompt;
  const prefix=options.referenceOnly?`[CLAUDEX WORKSPACE INSTRUCTION SNAPSHOT ${snapshot.digest.slice(0,12)} REMAINS IN EFFECT]`:`[CLAUDEX WORKSPACE INSTRUCTIONS — immutable session snapshot ${snapshot.digest.slice(0,12)}]\n${snapshot.text}\n[END CLAUDEX WORKSPACE INSTRUCTIONS]${character}`;
  return`${prefix}\n\n[CURRENT USER REQUEST]\n${prompt}`;
}

export function workspaceInstructionSnapshotFromMetadata(metadata:Record<string,unknown>|undefined){
  const value=metadata?.workspaceInstructionSnapshot;if(!value||typeof value!=="object")return null;
  const snapshot=value as Partial<WorkspaceInstructionSnapshot>;
  return snapshot.version===1&&typeof snapshot.text==="string"&&typeof snapshot.digest==="string"?snapshot as WorkspaceInstructionSnapshot:null;
}
export function workspaceInstructionFollowUpMetadata(source:Record<string,unknown>|undefined,next:Record<string,unknown>|undefined){
  // A new provider turn keeps session configuration but must not inherit the
  // previous task's terminal/runtime state. Otherwise a completed follow-up can
  // still claim it was user-stopped and briefly render stale output counters.
  const{
    terminationCause:_terminationCause,terminatedAt:_terminatedAt,activity:_activity,
    modelTurnStarted:_modelTurnStarted,contextUsage:_contextUsage,outputUsage:_outputUsage,
    finalMessageId:_finalMessageId,errorCategory:_errorCategory,approvalLoop:_approvalLoop,
    interruptionCause:_interruptionCause,interruptionDetectedAt:_interruptionDetectedAt,
    ...sessionMetadata
  }=source??{};
  return{...sessionMetadata,...next,workspaceInstructionPendingInjection:false};
}
export function workspaceInstructionRecoveryMetadata(source:Record<string,unknown>|undefined,next:Record<string,unknown>|undefined){const merged:Record<string,unknown>=workspaceInstructionFollowUpMetadata(source,next),{interruptionCause:_cause,interruptionDetectedAt:_detected,recoveryState:_state,...metadata}=merged;return metadata;}
export function workspaceInstructionCompactionMetadata(source:Record<string,unknown>|undefined,next:Record<string,unknown>|undefined){const metadata={...source,...next};return{...metadata,workspaceInstructionPendingInjection:Boolean(workspaceInstructionSnapshotFromMetadata(metadata))};}
export function workspaceInstructionTaskTitle(prompt:string,title?:string|null){return title??prompt.replace(/\s+/g," ").slice(0,80);}
