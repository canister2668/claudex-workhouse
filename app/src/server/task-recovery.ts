import crypto from "node:crypto";
import { automationLevel, permissionForAutomation, type AutomationLevel } from "./automation-level.js";
import type { DeckTask } from "./types.js";

export const RECOVERABLE_INTERRUPTION_CAUSES=["worker-process-lost","worker-host-restarted"] as const;
export type RecoverableInterruptionCause=typeof RECOVERABLE_INTERRUPTION_CAUSES[number];

export type TaskRecoveryEligibility={
  eligible:boolean;
  cause:RecoverableInterruptionCause|null;
  reason:"eligible"|"not-owned"|"not-interrupted"|"missing-thread"|"missing-workspace"|"already-resumed";
};

export function taskRecoveryEligibility(task:DeckTask):TaskRecoveryEligibility{
  const managedMarker=task.commandMarker?.startsWith("claudex-workhouse-codex:")||task.commandMarker?.startsWith("claudex-workhouse:");
  const managedRemote=Boolean(task.remoteWorkerId&&task.hostTaskId);
  if(!task.owned||task.ownership==="external"||task.source==="cli"||task.source==="vscode"||(!managedMarker&&!managedRemote&&task.ownership!=="claudex-workhouse"))return{eligible:false,cause:null,reason:"not-owned"};
  if(task.metadata?.recoveryState==="resumed")return{eligible:false,cause:null,reason:"already-resumed"};
  const cause=typeof task.metadata?.interruptionCause==="string"&&RECOVERABLE_INTERRUPTION_CAUSES.includes(task.metadata.interruptionCause as RecoverableInterruptionCause)
    ?task.metadata.interruptionCause as RecoverableInterruptionCause:null;
  if(task.status!=="stopped"||!cause)return{eligible:false,cause:null,reason:"not-interrupted"};
  if(!task.threadId)return{eligible:false,cause,reason:"missing-thread"};
  if(!task.workspaceId||!task.executionHostId)return{eligible:false,cause,reason:"missing-workspace"};
  return{eligible:true,cause,reason:"eligible"};
}

// The recovery prompt is prefilled into an editable field and then sent to the
// provider, so it follows the stored UI language.
const RECOVERY_COPY={
  en:{
    intro:"This task did not finish because the worker connection or its process was interrupted.",
    checkpoint:(value:string)=>`Last confirmed checkpoint: ${value}`,
    noCheckpoint:"Check the saved conversation and the workspace state.",
    instruction:"Safely finish the remaining work in the same workspace as the original session."
  },
  ko:{
    intro:"이 작업은 Worker 연결 또는 프로세스 중단으로 완료되지 못했습니다.",
    checkpoint:(value:string)=>`마지막 확인 지점: ${value}`,
    noCheckpoint:"저장된 대화와 작업공간 상태를 확인하세요.",
    instruction:"기존 세션과 같은 작업공간에서 남은 작업을 안전하게 이어서 완료하세요."
  },
  ja:{
    intro:"このタスクはWorkerの接続またはプロセスの中断により完了しませんでした。",
    checkpoint:(value:string)=>`最後に確認できた地点: ${value}`,
    noCheckpoint:"保存された会話とワークスペースの状態を確認してください。",
    instruction:"元のセッションと同じワークスペースで、残りの作業を安全に完了してください。"
  }
} as const;

export function defaultRecoveryPrompt(task:DeckTask,locale:"en"|"ko"|"ja"="ko"){
  const checkpoint=String(task.result??task.error??task.metadata?.activity??"").trim().replace(/\s+/g," ").slice(0,500);
  const copy=RECOVERY_COPY[locale];
  return [copy.intro,checkpoint?copy.checkpoint(checkpoint):copy.noCheckpoint,copy.instruction].join("\n\n");
}

export function recoveryPromptHash(prompt:string){
  return crypto.createHash("sha256").update(prompt).digest("hex");
}

export function assertRecoveryThread(expectedThreadId:string,actualThreadId:string|null|undefined){
  if(actualThreadId!==expectedThreadId)throw Object.assign(new Error("Provider resume did not preserve the confirmed source thread."),{statusCode:409,code:"TASK_RECOVERY_THREAD_MISMATCH"});
}

export function retryableRecoveryPrelaunchFailure(error:unknown){
  const code=typeof (error as any)?.code==="string"?(error as any).code:"";
  return code==="AUTOMATIC_EXECUTION_BLOCKED"||code==="TASK_RECOVERY_SOURCE_ACTIVE"||code==="TASK_RECOVERY_SOURCE_ADVANCED"||code==="TASK_RECOVERY_NOT_ELIGIBLE";
}

export function taskRecoveryBoundary(task:DeckTask,host:{id:string}|null,workspace:{id:string;hostId:string;projectId:string}|null,hostOnline:boolean){
  if(!host||host.id!==task.executionHostId)return{valid:false,reason:"host-missing" as const};
  if(host.id!=="local"&&!hostOnline)return{valid:false,reason:"host-offline" as const};
  if(!workspace)return{valid:false,reason:"workspace-unavailable" as const};
  if(workspace.id!==task.workspaceId||workspace.hostId!==host.id||workspace.projectId!==task.projectId)return{valid:false,reason:"workspace-source-mismatch" as const};
  return{valid:true,reason:"valid" as const};
}

export function taskRecoveryPermission(task:DeckTask,supportedLevels:unknown){
  const originalLevel=automationLevel(task.metadata?.automationLevel,task.permissionProfile);
  const supported=Array.isArray(supportedLevels)?supportedLevels.filter((value):value is AutomationLevel=>["full","auto","confirm","read"].includes(String(value))):null;
  const effectiveLevel=supported&&!supported.includes(originalLevel)?supported.includes("read")?"read":null:originalLevel;
  if(!effectiveLevel)return{available:false,originalLevel,effectiveLevel:null,originalPermission:task.permissionProfile??permissionForAutomation(task.provider,originalLevel),effectivePermission:null,downgraded:false};
  const originalPermission=task.permissionProfile??permissionForAutomation(task.provider,originalLevel),effectivePermission=permissionForAutomation(task.provider,effectiveLevel);
  return{available:true,originalLevel,effectiveLevel,originalPermission,effectivePermission,downgraded:effectivePermission!==originalPermission};
}
