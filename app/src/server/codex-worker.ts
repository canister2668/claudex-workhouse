import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CodexAppServerClient, connectCodexAppServerWithRetry } from "./codex/app-server.js";
import { StreamSpool } from "./stream-events.js";
import { normalizeCodexChange, relativePathInfo } from "./diff.js";
import { claudexWorkhouseCollaborationInstructions, turnLifecycleEvent } from "./codex-collaboration.js";
import { cleanupApprovalFiles, codexApprovalRecord, persistPendingApproval, waitForApprovalDecision } from "./approval-bridge.js";
import { cleanupUserInputFiles, persistUserInput, userInputRecord, waitForUserInput } from "./user-input-bridge.js";
import { codexContextUsage, codexTaskOutputUsage, compactedContext, type CodexOutputUsageBaseline, type ProviderContextUsage } from "./provider-context.js";
import {ApprovalLoopError,approvalRequestDisposition,assertCodexPolicy,sandboxBootstrapErrorCategory,type ExecutionPolicy} from "./execution-policy.js";
import {executionPolicyTurnInstructions} from "./automation-level.js";
import {beginWorkerEmotion,codexEmotionForItem,updateWorkerEmotion} from "./worker-emotion.js";
import { sanitizeSensitiveValue } from "./sensitive-data.js";
import {mergePersistedImageOutputs} from "./image-outputs.js";
import {conversationAttachmentInstruction,parseConversationAttachments} from "./conversation-attachments.js";
import{CONVERSATION_EMOTION_INSTRUCTION}from"./emotion-mcp-policy.js";
import {captureTaskImageOutput} from "./task-image-output.js";

const [stateFile, taskId, mode, cwd, marker, sourceThreadId, prompt, settingsJson] = process.argv.slice(2);
if (!stateFile || !taskId || !mode || !cwd || !marker || !prompt) process.exit(2);
const settings = JSON.parse(settingsJson || "{}");
let effectiveCwd=cwd;
const startedAt = new Date().toISOString();
let client: CodexAppServerClient | null = null;
let threadId: string | null = sourceThreadId || null;
let turnId: string | null = null;
let finished = false;
let finalAgentMessage: { id:string|null; text:string } | null = null;
let finalAgentMessageSpooled = false;
const approvalAbort = new AbortController();
const root = path.resolve(path.dirname(stateFile), "../..");
const spool = new StreamSpool(root, taskId, "codex");
const automationLevel = settings.automationLevel === "full" || settings.automationLevel === "confirm" || settings.automationLevel === "read" ? settings.automationLevel : "auto";
const executionPolicy=settings.executionPolicy as ExecutionPolicy;
let policyContract:{sandbox:"read-only"|"workspace-write"|"danger-full-access";approvalPolicy:"never"|"on-request"}|null=null;
let approvalCircuitBroken=false;
let codexOutputBaseline:CodexOutputUsageBaseline|null=null;

// Child-thread roll-up for the session list, which reads task metadata instead
// of subscribing to the event stream.
type ChildAgentStatus="running"|"waiting"|"completed"|"failed";
const childAgents=new Map<string,ChildAgentStatus>();
let childAgentTally="";
function trackChildAgent(id:unknown,status:ChildAgentStatus){
  const childId=typeof id==="string"?id.trim():"";
  if(!childId||!threadId||childId===threadId)return;
  const previous=childAgents.get(childId);
  if(previous===status||previous==="failed"&&status==="completed")return;
  childAgents.set(childId,status);
  const values=[...childAgents.values()];
  const parallelAgents={
    total:values.length,
    running:values.filter(value=>value==="running").length,
    waiting:values.filter(value=>value==="waiting").length,
    failed:values.filter(value=>value==="failed").length,
    completed:values.filter(value=>value==="completed").length
  };
  const serialized=JSON.stringify(parallelAgents);
  if(serialized===childAgentTally)return;
  childAgentTally=serialized;
  write({parallelAgents});
}

function optionalNativeString(value:unknown){
  return typeof value==="string"&&!["","undefined","null"].includes(value.trim())?value.trim():undefined;
}
function optionalNativeStringArray(value:unknown){
  if(!Array.isArray(value))return undefined;
  const values=value.map(optionalNativeString).filter((item):item is string=>Boolean(item));
  return values.length?values:undefined;
}

function itemKind(item: any, completed = false) {
  if (item?.type === "agentMessage") return completed ? "message_completed" : null;
  if (item?.type === "commandExecution") return completed ? "command_completed" : "command_started";
  if (item?.type === "fileChange") return completed ? "file_change_completed" : "file_change_started";
  if (item?.type === "mcpToolCall") return completed ? "mcp_tool_result" : "mcp_tool_call";
  if (item?.type === "collabAgentToolCall") return completed ? (item.status === "failed" ? "agent_failed" : "agent_completed") : "agent_started";
  if (item?.type === "subAgentActivity") return "agent_progress";
  if (["dynamicToolCall","webSearch","imageGeneration","imageView","sleep"].includes(item?.type)) return completed ? "tool_completed" : "tool_started";
  if (item?.type === "contextCompaction") return "context_compaction";
  return completed ? "tool_completed" : "tool_started";
}
function itemContent(item: any) {
  if (!item) return "";
  if (item.type === "agentMessage") return item.text ?? "";
  if (item.type === "commandExecution") return item.aggregatedOutput ?? item.command ?? "";
  if (item.type === "fileChange") return JSON.stringify(item.changes ?? []);
  if (item.type === "mcpToolCall") return `${item.server ?? "mcp"}/${item.tool ?? "tool"}`;
  if (item.type === "webSearch") return item.query ?? "Web search";
  if (item.type === "collabAgentToolCall") return optionalNativeString(item.prompt) ?? optionalNativeString(item.tool) ?? "Parallel agent";
  if (item.type === "subAgentActivity") return optionalNativeString(item.kind) ?? "Subagent activity";
  return item.type ?? "Codex item";
}
function itemImageMetadata(item:any){
  const nativePath=item?.type==="imageView"?item.path:item?.type==="imageGeneration"?item.savedPath:null;
  if(typeof nativePath==="string"&&nativePath.trim()){
    const resolved=relativePathInfo(nativePath,cwd);
    if(resolved.pathBase==="task-cwd")return{mediaKind:"image" as const,mediaPath:resolved.path,mediaPathBase:resolved.pathBase};
  }
  return captureTaskImageOutput({root,taskId,threadId,item});
}
function persistImageOutput(item:any){
  const media=itemImageMetadata(item);
  if(media.mediaKind!=="image")return;
  let previous:Record<string,unknown>={};try{previous=JSON.parse(fs.readFileSync(stateFile,"utf8"));}catch{}
  const imageOutputs=mergePersistedImageOutputs(previous.imageOutputs,[{itemId:optionalNativeString(item?.id),turnId,threadId,itemType:item?.type==="imageGeneration"?"imageGeneration":"imageView",mediaPath:media.mediaPath,mediaPathBase:media.mediaPathBase,sourceTaskId:taskId,workspaceId:optionalNativeString(settings.workspaceId),timestamp:new Date().toISOString()}]);
  write({imageOutputs});
}
function appendNotification(message: {method:string;params?:any}) {
  const p = message.params ?? {};
  const eventThreadId=p.threadId ?? p.thread?.id ?? threadId;
  const isRoot=!threadId||!eventThreadId||eventThreadId===threadId;
  const base = { threadId:eventThreadId, turnId:p.turnId ?? p.turn?.id ?? turnId, itemId:p.itemId ?? p.item?.id ?? null, metadata:{ nativeMethod:message.method, nativeStatus:p.item?.status ?? p.turn?.status ?? p.status } };
  if (message.method !== "item/agentMessage/delta" && !message.method.endsWith("outputDelta")) write({activity:message.method});
  if(!isRoot){
    const nativeStatus=String(p.turn?.status??p.item?.status??"");
    if(message.method==="thread/closed")trackChildAgent(eventThreadId,"completed");
    else if(message.method==="error"&&!p.willRetry)trackChildAgent(eventThreadId,"failed");
    else if(message.method==="turn/completed")trackChildAgent(eventThreadId,["failed","errored","interrupted"].includes(nativeStatus)?"failed":"completed");
    else trackChildAgent(eventThreadId,"running");
  }
  if (message.method === "thread/started") return spool.append({ ...base, type:"task_started", content:"Codex thread started." });
  if (message.method === "thread/closed") return spool.append({ ...base, type:isRoot?"task_stopped":"agent_completed", content:isRoot?"Codex thread closed.":"Subagent thread closed.", terminal:isRoot, metadata:{...base.metadata,agentThreadId:isRoot?undefined:eventThreadId} });
  if (message.method === "turn/started") return spool.append({ ...base, type:isRoot?"turn_started":"agent_progress", content:isRoot?"Codex turn started.":"Subagent turn started.", metadata:{...base.metadata,agentThreadId:isRoot?undefined:eventThreadId,kind:isRoot?undefined:"turn_started"} });
  if (message.method === "turn/completed") {
    const status=p.turn?.status;
    const lifecycle=turnLifecycleEvent(threadId,eventThreadId,status);
    // Publish root completion only after the final result is persisted below.
    // Some app-server versions omit item/completed while still returning the
    // agent message on the completed turn; an early terminal event would make
    // clients close SSE before that fallback message reaches the spool.
    if(lifecycle.isRoot&&mode!=="compact")return;
    return spool.append({ ...base, type:mode==="compact"&&lifecycle.isRoot?"tool_progress":lifecycle.type, content:p.turn?.error?.message ?? (mode==="compact"&&lifecycle.isRoot?"Codex context compaction turn completed.":lifecycle.isRoot?`Codex turn ${status ?? "completed"}.`:`Subagent turn ${status ?? "completed"}.`), status, terminal:mode==="compact"?false:lifecycle.terminal, metadata:{...base.metadata,agentThreadId:lifecycle.isRoot?undefined:eventThreadId,kind:lifecycle.isRoot?undefined:"turn_completed"} });
  }
  if (message.method === "item/started" || message.method === "item/completed") {
    const completed=message.method === "item/completed";
    if(!completed){const emotion=codexEmotionForItem(p.item);if(emotion)updateWorkerEmotion(root,"codex",emotion,threadId);}
    if(completed&&isRoot&&p.item?.type==="agentMessage"&&typeof p.item.text==="string"&&p.item.text.trim()){finalAgentMessage={id:typeof p.item.id==="string"?p.item.id:null,text:p.item.text.trim()};finalAgentMessageSpooled=true;}
    if (p.item?.type === "fileChange") {
      if (!completed) return; // emit once, on completion, matching Claude
      for (const change of Array.isArray(p.item.changes) ? p.item.changes : []) {
        const d = normalizeCodexChange(change, cwd);
        spool.append({ ...base, type:"file_change_started", content:d.text, toolName:"fileChange", metadata:{ ...base.metadata, path:d.path, pathBase:d.pathBase, tool:"codex", additions:d.additions, deletions:d.deletions, kind:d.kind } });
      }
      return;
    }
    const type=itemKind(p.item,completed);
    if (!type) return;
    if(completed&&(p.item?.type==="imageView"||p.item?.type==="imageGeneration"))persistImageOutput(p.item);
    if(p.item?.type==="contextCompaction"){
      if(!completed)return spool.append({...base,type:"tool_progress",content:"Codex context compaction started.",metadata:{...base.metadata,itemType:p.item?.type,operation:"context_compaction"}});
      let previous:ProviderContextUsage|undefined;try{previous=JSON.parse(fs.readFileSync(stateFile,"utf8")).contextUsage;}catch{}
      const contextUsage=compactedContext(previous,mode==="compact"?"manual":null);
      write({contextUsage});
      return spool.append({ ...base, type, content:itemContent(p.item), status:p.item?.status, metadata:{...base.metadata,itemType:p.item?.type,contextUsage} });
    }
    const exitCode=Number.isFinite(p.item?.exitCode)?Number(p.item.exitCode):null,ok=p.item?.type==="commandExecution"?(exitCode!==null?exitCode===0:p.item?.status==="completed"?true:p.item?.status==="failed"?false:null):undefined;
    return spool.append({ ...base, type, content:itemContent(p.item), status:p.item?.status, serverName:p.item?.server, toolName:p.item?.tool, metadata:{...base.metadata,itemType:p.item?.type,phase:p.item?.phase,command:p.item?.command,...(p.item?.type==="commandExecution"?{exitCode,ok,source:"provider"}:{}),changes:p.item?.changes,tool:optionalNativeString(p.item?.tool),senderThreadId:optionalNativeString(p.item?.senderThreadId),receiverThreadIds:optionalNativeStringArray(p.item?.receiverThreadIds),prompt:optionalNativeString(p.item?.prompt),model:optionalNativeString(p.item?.model),reasoningEffort:optionalNativeString(p.item?.reasoningEffort),agentsStates:p.item?.agentsStates,kind:optionalNativeString(p.item?.kind),agentThreadId:optionalNativeString(p.item?.agentThreadId),agentPath:optionalNativeString(p.item?.agentPath),...(completed?itemImageMetadata(p.item):{})} });
  }
  if (message.method === "item/agentMessage/delta") return spool.append({ ...base, type:"message_delta", content:p.delta ?? "" });
  if (message.method === "item/commandExecution/outputDelta" || message.method === "command/exec/outputDelta" || message.method === "process/outputDelta") return spool.append({ ...base, type:"command_output", content:String(p.delta ?? "").slice(-8000), metadata:{...base.metadata,stream:p.stream} });
  if (message.method === "item/fileChange/patchUpdated") return spool.append({ ...base, type:"tool_progress", content:"File patch updated.", metadata:{...base.metadata,changes:p.changes} });
  if (message.method === "item/mcpToolCall/progress") return spool.append({ ...base, type:"tool_progress", content:p.message ?? "MCP tool progress." });
  if (message.method === "thread/tokenUsage/updated") {
    if(!isRoot)return spool.append({...base,type:"agent_progress",content:"Codex subagent usage updated.",metadata:{...base.metadata,agentThreadId:eventThreadId,kind:"token_usage"}});
    const contextUsage=codexContextUsage(p.tokenUsage),taskUsage=codexTaskOutputUsage(p.tokenUsage,codexOutputBaseline),outputUsage=taskUsage.usage;
    codexOutputBaseline=taskUsage.baseline;
    if(contextUsage||outputUsage)write({...(contextUsage?{contextUsage}:{}),...(outputUsage?{outputUsage}:{})});
    return spool.append({...base,type:"unknown",content:"Codex context usage updated.",metadata:{...base.metadata,nativeMethod:message.method,usageScope:"task-cumulative-delta",outputCallId:taskId,contextUsage,outputUsage}});
  }
  if (message.method === "thread/compacted") {
    let previous:ProviderContextUsage|undefined;try{previous=JSON.parse(fs.readFileSync(stateFile,"utf8")).contextUsage;}catch{}
    const contextUsage=compactedContext(previous,null);write({contextUsage});
    return spool.append({ ...base, type:"context_compaction", content:"Context compacted.",metadata:{...base.metadata,contextUsage} });
  }
  if (message.method === "error") return spool.append({ ...base, type:p.willRetry ? "tool_progress" : isRoot?"task_failed":"agent_failed", content:p.error?.message ?? "Codex error.", terminal:isRoot&&!p.willRetry, metadata:{...base.metadata,willRetry:Boolean(p.willRetry),agentThreadId:isRoot?undefined:eventThreadId} });
  return spool.append({ ...base, type:"unknown", content:`Codex notification: ${message.method}`, metadata:{ nativeMethod:message.method, payload:p } });
}

function processStart() {
  try { return fs.readFileSync(`/proc/${process.pid}/stat`, "utf8").split(" ")[21]; } catch { return null; }
}
function write(patch: Record<string, unknown>) {
  let previous: Record<string, unknown> = {};
  try { previous = JSON.parse(fs.readFileSync(stateFile, "utf8")); } catch {}
  const next = { ...previous, ...patch, marker, pid: process.pid, pgid: process.pid, processStart: processStart(), threadId, turnId, updatedAt: new Date().toISOString() };
  const temporary = `${stateFile}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(sanitizeSensitiveValue(next,{preserveSourceIdentifiers:true})));
  fs.renameSync(temporary, stateFile);
}

async function stop() {
  if (finished) return;
  if (client && threadId && turnId) await client.request("turn/interrupt", { threadId, turnId }, 5000).catch(() => {});
  approvalAbort.abort();
  write({ status: "stopped", error: null, completedAt: new Date().toISOString() });
  spool.append({ type:"task_stopped", content:"Claudex Workhouse stopped the Codex task.", threadId, turnId, terminal:true });
  await client?.close().catch(() => {});
  process.exit(0);
}
process.once("SIGTERM", () => { void stop(); });
process.once("SIGINT", () => { void stop(); });

try {
  write({ status: "running", activity:"runtime_initializing", modelTurnStarted:false, createdAt: startedAt, log: "Claudex Workhouse Codex worker started." });
  spool.append({ type:"task_started", content:"Claudex Workhouse Codex worker started.", threadId, turnId });
  client = await connectCodexAppServerWithRetry(effectiveCwd,{onRetry:(error,attempt)=>{write({activity:"runtime_retrying",log:`${error.message} Retrying initialize (${attempt+1}/3).`});spool.append({type:"tool_progress",content:"Codex runtime cold start failed; retrying.",threadId,turnId,metadata:{operation:"app_server_initialize_retry",attempt:attempt+1}});}});
  write({activity:"session_initializing",log:"Codex runtime initialized; preparing session."});
  client.onServerRequest = async (message) => {
    const p=message.params ?? {};
    if(message.method==="item/tool/requestUserInput"){
      const input=userInputRecord(taskId,p);persistUserInput(stateFile,input);
      write({status:"waiting",pendingUserInputId:input.id,activity:"user_input_required"});
      spool.append({type:"user_input_required",content:input.questions.map(item=>item.question).join(" · "),threadId:input.threadId||threadId,turnId:input.turnId||turnId,itemId:input.itemId,metadata:{requestId:input.id,questions:input.questions,expiresAt:input.expiresAt}});
      const answers=await waitForUserInput(stateFile,input,approvalAbort.signal);
      write({status:"running",pendingUserInputId:null,activity:"user_input_resolved"});
      spool.append({type:"user_input_resolved",content:"User input submitted.",threadId:input.threadId||threadId,turnId:input.turnId||turnId,itemId:input.itemId,metadata:{requestId:input.id,answered:Object.keys(answers).length}});
      return{answers};
    }
    if(!["item/commandExecution/requestApproval","item/fileChange/requestApproval"].includes(message.method))throw new Error("This provider request is not supported by Claudex Workhouse.");
    const approval=codexApprovalRecord({taskId,hostId:settings.executionHostId??"local",workspaceId:settings.workspaceId??null,cwd,method:message.method,params:p,providerRequestId:message.id});
    if(!executionPolicy||approvalRequestDisposition(executionPolicy)==="circuit-break"){
      const reason=p.networkApprovalContext?"workspace-outside-or-network":message.method.includes("fileChange")?"mapping-or-sandbox-file-escalation":"sandbox-escalation";
      approvalCircuitBroken=true;
      spool.append({type:"task_failed",content:"Execution stopped before an unexpected Provider approval could be shown or accepted.",threadId:approval.threadId??threadId,turnId:approval.turnId??turnId,itemId:approval.itemId,terminal:true,metadata:{code:"approval-loop-detected",reason,approvalId:approval.id,providerRequestId:approval.providerRequestId,popupSuppressed:true,autoAccepted:false,executionBackend:executionPolicy?.executionBackend}});
      write({status:"failed",activity:"approval-loop-detected",pendingApprovalId:null,approvalLoop:{reason,approvalId:approval.id,providerRequestId:approval.providerRequestId,fingerprint:approval.fingerprint,detectedAt:new Date().toISOString()},error:`Execution stopped before an unexpected Provider approval: ${reason}`});
      throw new ApprovalLoopError(reason,approval.id);
    }
    const persisted=persistPendingApproval(stateFile,approval);
    if(persisted.resolvedDecision)return{decision:persisted.resolvedDecision};
    if(persisted.created){write({status:"waiting",pendingApprovalId:approval.id,activity:"approval_required"});trackChildAgent(approval.threadId,"waiting");spool.append({ type:"approval_required", content:approval.summary, threadId:approval.threadId??threadId, turnId:approval.turnId??turnId, itemId:approval.itemId, metadata:{approvalId:approval.id,providerRequestId:approval.providerRequestId,fingerprint:approval.fingerprint,kind:approval.kind,risk:approval.risk,access:approval.access,paths:approval.paths,command:approval.command,availableDecisions:approval.availableDecisions,expiresAt:approval.expiresAt,hostId:approval.hostId,workspaceId:approval.workspaceId} });}
    const decision=await waitForApprovalDecision(stateFile,approval,approvalAbort.signal);
    write({status:"running",pendingApprovalId:null,activity:"approval_resolved"});trackChildAgent(approval.threadId,"running");
    spool.append({type:"approval_resolved",content:decision==="accept"||decision==="acceptForSession"?"Approval granted.":"Approval denied.",threadId:approval.threadId??threadId,turnId:approval.turnId??turnId,itemId:approval.itemId,metadata:{approvalId:approval.id,providerRequestId:approval.providerRequestId,decision}});
    return {decision};
  };
  const permission = settings.permissionProfile ?? ":workspace";
  policyContract=assertCodexPolicy(executionPolicy);
  let sandbox=policyContract.sandbox,approvalPolicy=policyContract.approvalPolicy;
  const configuredDelegation=process.env.CLAUDEX_WORKHOUSE_DELEGATION_SETTINGS;
  let delegationSettings:unknown;try{delegationSettings=JSON.parse(configuredDelegation??"null");}catch{delegationSettings=null;}
  const runtimeProfile=settings.runtimeProfile==="conversation"||settings.runtimeProfile==="browser"?settings.runtimeProfile:"default";
  const runtimeWorkspaceRoots=[effectiveCwd];
  const writableRoots=[effectiveCwd];
  const sandboxPolicy=sandbox==="danger-full-access"?{type:"dangerFullAccess"}:sandbox==="read-only"?{type:"readOnly",networkAccess:false}:{type:"workspaceWrite",writableRoots,networkAccess:false,excludeTmpdirEnvVar:false,excludeSlashTmp:false};
  let restrictedRuntimeConfig:Record<string,unknown>|null=null;
  // A file the user attached to this turn is the one thing a conversation may
  // open: the path is already in the prompt, and a screenshot the model cannot
  // view is worse than no attachment at all. The read-only sandbox still
  // forbids every write, and the uploads directory is added as its own root
  // rather than widening the workspace.
  const conversationAttachments=runtimeProfile==="conversation"?parseConversationAttachments(process.env.CLAUDEX_WORKHOUSE_CONVERSATION_ATTACHMENTS):[];
  for(const directory of new Set(conversationAttachments.map(item=>path.dirname(item))))if(!runtimeWorkspaceRoots.includes(directory))runtimeWorkspaceRoots.push(directory);
  let developerInstructions=runtimeProfile==="conversation"?[conversationAttachments.length?"Claudex Workhouse conversation-only runtime: answer only the supplied conversation prompt. Do not modify files, run commands, browse, delegate work, or turn the exchange into an implementation task.":"Claudex Workhouse conversation-only runtime: answer only the supplied conversation prompt. Do not inspect or modify files, run commands, browse, delegate work, or turn the exchange into an implementation task.",conversationAttachmentInstruction(conversationAttachments),CONVERSATION_EMOTION_INSTRUCTION].filter(Boolean).join("\n\n"):`${claudexWorkhouseCollaborationInstructions(delegationSettings)}\n\n${executionPolicyTurnInstructions("codex",automationLevel,cwd)}`;
  const common = { cwd:effectiveCwd, runtimeWorkspaceRoots, model: settings.model ?? null, approvalPolicy, sandbox, config:restrictedRuntimeConfig, developerInstructions };
  const response = mode === "resume" || mode === "compact"
    ? await client.request("thread/resume", { threadId: sourceThreadId, ...common }, 30000)
    : await client.request("thread/start", { ...common, serviceTier: settings.serviceTier ?? null, ephemeral: false, experimentalRawEvents: false }, 30000);
  threadId = response.thread?.id;
  if (!threadId) throw new Error("Codex app-server returned no thread ID.");
  beginWorkerEmotion(root,"codex",prompt,threadId);
  write({ status: "running", threadId, activity:"model_starting", log: "Codex thread ready.",requestedAutomation:executionPolicy.requestedAutomation,effectiveSandbox:executionPolicy.effectiveSandbox,effectiveApprovalPolicy:approvalPolicy,executionBackend:executionPolicy.executionBackend });
  const completion = new Promise<any>((resolve, reject) => {
    client!.onClose=reject;
    client!.onNotification = (message) => {
      appendNotification(message);
      if (message.method === "turn/started" && message.params?.threadId === threadId) {
        turnId = message.params.turn?.id ?? turnId; write({ turnId, status: "running",activity:"model_thinking",modelTurnStarted:true });
      }
      if (mode!=="compact"&&message.method === "turn/completed" && message.params?.threadId === threadId && (!turnId || message.params.turn?.id === turnId)) resolve(message.params.turn);
      if(mode==="compact"&&message.params?.threadId===threadId&&((message.method==="item/completed"&&message.params?.item?.type==="contextCompaction")||message.method==="thread/compacted"))resolve({status:"completed"});
      if (message.method === "error" && message.params?.threadId === threadId) reject(new Error(message.params.error?.message ?? "Codex turn failed."));
    };
  });
  if(mode==="compact"){
    await client.request("thread/compact/start",{threadId},30000);
    await Promise.race([completion,new Promise((_,reject)=>setTimeout(()=>reject(new Error("Codex context compaction timed out.")),120000))]);
    spool.append({type:"task_completed",content:"Codex context compaction completed.",threadId,terminal:true,metadata:{operation:"context_compaction"}});
    finished=true;write({status:"completed",completedAt:new Date().toISOString(),result:"Context compacted.",error:null});
  } else {
  let outputSchema:Record<string,unknown>|null=null;
  const turn = await client.request("turn/start", {
    threadId,
    input: [{ type: "text", text: prompt, text_elements: [] }],
    model: settings.model ?? null,
    effort: settings.reasoningEffort ?? null,
    serviceTier: settings.serviceTier ?? null,
    cwd:effectiveCwd,
    runtimeWorkspaceRoots,
    approvalPolicy,
    sandboxPolicy,
    collaborationMode: settings.workMode === "plan" ? { mode:"plan", settings:{ model:settings.model, reasoning_effort:settings.reasoningEffort ?? null, developer_instructions:null } } : null,
    outputSchema
  }, 30000);
  turnId = turn.turn?.id ?? turnId;
  write({ turnId, status: "running",activity:"model_thinking",modelTurnStarted:true });
  const finalTurn = turn.turn?.status && turn.turn.status !== "inProgress" ? turn.turn : await completion;
  if(Array.isArray(finalTurn?.items)){const item=[...finalTurn.items].reverse().find((value:any)=>value?.type==="agentMessage"&&typeof value.text==="string"&&value.text.trim());if(item){const recovered={id:typeof item.id==="string"?item.id:null,text:item.text.trim()},previous=finalAgentMessage as {id:string|null;text:string}|null;if(!previous||previous.text!==recovered.text){finalAgentMessage=recovered;finalAgentMessageSpooled=false;}else if(!previous.id&&recovered.id)finalAgentMessage=recovered;}}
  const completed=finalTurn?.status === "completed";
  if(completed&&finalAgentMessage&&!finalAgentMessageSpooled){spool.append({type:"message_completed",content:finalAgentMessage.text,threadId,turnId,itemId:finalAgentMessage.id,metadata:{role:"agent",phase:"final_answer",recoveredFromCompletedTurn:true}});finalAgentMessageSpooled=true;}
  finished = true;
  spool.append({type:completed?"task_completed":"task_failed",content:completed?"Codex turn completed.":finalTurn?.error?.message??"Codex turn failed.",threadId,turnId,terminal:true});
  write({ status: completed ? "completed" : "failed", activity:completed?"completed":"failed", completedAt: new Date().toISOString(), result: finalAgentMessage?.text??null, finalMessageId:finalAgentMessage?.id??null, error: finalTurn?.error?.message ?? null });
  updateWorkerEmotion(root,"codex",completed?"done":"disappointed",threadId);
  }
} catch (error) {
  finished = true;
  updateWorkerEmotion(root,"codex","disappointed",threadId);
  if(error instanceof ApprovalLoopError||approvalCircuitBroken){
    write({status:"failed",activity:"approval-loop-detected",completedAt:new Date().toISOString(),error:error instanceof Error?error.message:String(error)});
  }else{
    const message=error instanceof Error?error.message:String(error),errorCategory=sandboxBootstrapErrorCategory(error);
    spool.append({type:"task_failed",content:message,threadId,turnId,terminal:true,metadata:errorCategory?{errorCategory}:undefined});
    write({status:"failed",activity:errorCategory?"sandbox-bootstrap-failed":"failed",completedAt:new Date().toISOString(),error:message,errorCategory});
  }
} finally {
  approvalAbort.abort();
  cleanupApprovalFiles(stateFile);
  cleanupUserInputFiles(stateFile);
  await client?.close().catch(() => {});
}
