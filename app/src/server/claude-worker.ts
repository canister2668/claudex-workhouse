import fs from "node:fs";
import path from "node:path";
import {conversationAttachmentInstruction,parseConversationAttachments} from "./conversation-attachments.js";
import { spawn } from "node:child_process";
import readline from "node:readline";
import { StreamSpool } from "./stream-events.js";
import { relativePath, relativePathInfo, unifiedLineDiff } from "./diff.js";
import { claudeContextUsageFromStreamEvent, claudeContextWindow, claudeOutputUsageFromStreamEvent, compactedContext, type ProviderContextUsage, type ProviderOutputUsage } from "./provider-context.js";
import { delegationDeveloperInstructions, normalizeDelegationSettings } from "./delegation-settings.js";
import {automationLevel,executionPolicyTurnInstructions} from "./automation-level.js";
import {beginWorkerEmotion,claudeEmotionForTool,updateWorkerEmotion} from "./worker-emotion.js";
import { sanitizeSensitiveValue } from "./sensitive-data.js";
import {createTextDeltaBatcher} from "./text-delta-batcher.js";
import {ProviderOutputBlockTracker} from "./provider-output-block.js";
import {persistProviderSystemEvent} from "./provider-system-events.js";
import {EXTERNAL_MCP_BUNDLE_ENV,externalMcpForClaude,readExternalMcpBundle} from "./external-mcp-bundle.js";
import {CONVERSATION_EMOTION_INSTRUCTION,EMOTION_MCP_PROFILE_HEADER,EMOTION_MCP_SERVER_ID,EMOTION_MCP_SESSION_HEADER,EMOTION_MCP_TASK_HEADER,EMOTION_MCP_TOOL_NAME,validatedEmotionMcpUrl,type EmotionMcpProvider} from "./emotion-mcp-policy.js";

const [, , statePath, taskId, claudeBinary, mode, cwd, marker, permissionProfile = ":read-only", model = "default", ...workerArgs] = process.argv;
const EFFORTS = new Set(["default", "low", "medium", "high", "xhigh", "max"]);
const WORK_MODES = new Set(["default", "plan"]);
// A production build replaces the detached worker file before the long-lived
// Fastify process is restarted. During that small rolling window an older
// provider still sends the pre-effort argv layout. Accept both layouts so a
// session ID can never be mistaken for an effort value.
const hasEffortArg = EFFORTS.has(workerArgs[0] ?? "");
const effort = hasEffortArg ? workerArgs[0] : "default";
const hasWorkModeArg = hasEffortArg && WORK_MODES.has(workerArgs[1] ?? "");
// Older providers did not pass work mode separately and always coupled
// Claude read-only execution to plan mode. Preserve that inference only for
// the rolling-restart compatibility layout.
const workMode = hasWorkModeArg ? workerArgs[1] : permissionProfile === ":read-only" ? "plan" : "default";
const sessionIndex = hasWorkModeArg ? 2 : hasEffortArg ? 1 : 0;
const sessionId = workerArgs[sessionIndex] ?? "";
const promptParts = workerArgs.slice(sessionIndex + 1);
const prompt = promptParts.join(" ");
const compactOperation = prompt.trim().split(/\s+/,1)[0] === "/compact";

// Claude permission profiles -> CLI flags. In headless (-p) mode there is no human
// to approve tool use, so the mode itself must grant capability:
//   :read-only        read/search tools only; work mode selects plan vs normal
//   :workspace-write  auto-accept edits; commands still gated
//   :danger-full-access  bypass all permission checks (edit + write + Bash)
const PROFILES: Record<string, { mode: string; tools: string[] }> = {
  ":read-only": { mode: "plan", tools: ["Read", "Glob", "Grep", "WebSearch", "WebFetch"] },
  ":workspace-write": { mode: "acceptEdits", tools: ["default"] },
  ":danger-full-access": { mode: "bypassPermissions", tools: ["default"] }
};
const productEnv=(name:string)=>process.env[`CLAUDEX_WORKHOUSE_${name}`]??process.env[`CLAUDEX_WORKHOUSE_${name}`];
const configuredProvider=String(productEnv("PROVIDER_ID")??"claude");
const providerId:EmotionMcpProvider=configuredProvider==="deepseek"||configuredProvider==="ollama"?configuredProvider:"claude";
const providerLabel=String(productEnv("PROVIDER_LABEL")??(providerId==="claude"?"Claude":providerId==="deepseek"?"DeepSeek":"Ollama")).replace(/[^a-zA-Z0-9 ._-]/g,"").slice(0,40)||"Claude";
const baseProfile = PROFILES[permissionProfile] ?? PROFILES[":read-only"];
const profile = permissionProfile === ":read-only" && workMode === "default"
  ? { mode: "dontAsk", tools: baseProfile.tools }
  : baseProfile;
const configuredEmotionMcpUrl=String(productEnv("EMOTION_MCP_URL")??"").trim();
const emotionMcpUrl=validatedEmotionMcpUrl(providerId,configuredEmotionMcpUrl);
const requestedRuntimeProfile=productEnv("RUNTIME_PROFILE");
const runtimeProfile=requestedRuntimeProfile==="conversation"||requestedRuntimeProfile==="browser"?requestedRuntimeProfile:"default";
const configuredManagedMcpUrl=String(productEnv("MANAGED_PROVIDER_MCP_URL")??"").trim();
let managedMcpUrl=runtimeProfile!=="conversation"&&/^http:\/\/(?:127\.0\.0\.1|localhost):\d+\/mcp\/claudex-workhouse$/.test(configuredManagedMcpUrl)&&productEnv("CURRENT_TASK_ID")&&productEnv("MANAGED_PROVIDER_TOKEN")?configuredManagedMcpUrl:"";
const externalMcpBundle=runtimeProfile==="default"?readExternalMcpBundle(process.env[EXTERNAL_MCP_BUNDLE_ENV],taskId):null;
const externalMcp=externalMcpBundle?externalMcpForClaude(externalMcpBundle):{mcpServers:{},allowedTools:[],environment:{}};
const configuredSwitchModelsOnFlag=productEnv("CLAUDE_SWITCH_MODELS_ON_FLAG");
const switchModelsOnFlag=configuredSwitchModelsOnFlag==="true"?true:configuredSwitchModelsOnFlag==="false"?false:null;
const configuredSessionId=String(productEnv("CLAUDE_SESSION_ID")??"").trim();
const requestedSessionId=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(configuredSessionId)?configuredSessionId:"";
const startedAt = new Date().toISOString();
const root = path.resolve(path.dirname(statePath), "../..");
const spool = new StreamSpool(root, taskId, providerId);

function procStart(pid: number) {
  try { return fs.readFileSync(`/proc/${pid}/stat`, "utf8").split(" ")[21] ?? null; } catch { return null; }
}
function atomicWrite(value: unknown) {
  const temp = `${statePath}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(sanitizeSensitiveValue(value,{preserveSourceIdentifiers:true}))}\n`, "utf8");
  fs.renameSync(temp, statePath);
}

const state: any = { marker, pid: process.pid, pgid: process.pid, processStart: procStart(process.pid), sessionId: requestedSessionId || sessionId || null, status: "running", startedAt, updatedAt: startedAt, result: null, error: null, log: "" };
let stateWriteTimer:ReturnType<typeof setTimeout>|null=null,stateWritePending=false;
function flushStateWrite(){if(stateWriteTimer)clearTimeout(stateWriteTimer);stateWriteTimer=null;if(!stateWritePending)return;stateWritePending=false;atomicWrite(state);}
function scheduleStateWrite(){stateWritePending=true;if(stateWriteTimer)return;stateWriteTimer=setTimeout(flushStateWrite,100);stateWriteTimer.unref?.();}
const outputBlocks=new ProviderOutputBlockTracker();
const textDeltas=createTextDeltaBatcher<{nativeType:string;index:unknown;outputCallId:string|null;itemId:string|null}>((content,metadata)=>spool.append({type:"message_delta",content,threadId:state.sessionId,itemId:metadata?.itemId??null,metadata}),{intervalMs:80,maxChars:192});
let compatibleTextBlockId:string|null=null;
let compatibleProgressReported=false;
let postResultFinalization:Promise<void>|null=null;
const outputUsageByCall=new Map<string,ProviderOutputUsage>();
function recordOutputUsage(callId:string|null,usage:ProviderOutputUsage){
  const key=callId||"legacy-current",previous=outputUsageByCall.get(key);
  const maximum=(left:number|null|undefined,right:number|null|undefined)=>left===null||left===undefined?right??null:right===null||right===undefined?left:Math.max(left,right);
  outputUsageByCall.set(key,{
    totalTokens:maximum(previous?.totalTokens,usage.totalTokens),
    inputTokens:maximum(previous?.inputTokens,usage.inputTokens),
    cachedInputTokens:maximum(previous?.cachedInputTokens,usage.cachedInputTokens),
    cacheWriteInputTokens:maximum(previous?.cacheWriteInputTokens,usage.cacheWriteInputTokens),
    outputTokens:Math.max(previous?.outputTokens??0,usage.outputTokens),
    reasoningTokens:maximum(previous?.reasoningTokens,usage.reasoningTokens),
    updatedAt:usage.updatedAt
  });
  const values=[...outputUsageByCall.values()],sum=(field:"inputTokens"|"cachedInputTokens"|"cacheWriteInputTokens"|"reasoningTokens")=>{
    const items=values.map(value=>value[field]);
    return items.every((value):value is number=>value!==null)?items.reduce((total,value)=>total+value,0):null;
  },inputTokens=sum("inputTokens"),outputTokens=values.reduce((total,value)=>total+value.outputTokens,0);
  state.outputUsage={totalTokens:inputTokens===null?null:inputTokens+outputTokens,inputTokens,cachedInputTokens:sum("cachedInputTokens"),cacheWriteInputTokens:sum("cacheWriteInputTokens"),outputTokens,reasoningTokens:sum("reasoningTokens"),requestCount:values.length,updatedAt:usage.updatedAt};
}
atomicWrite(state);
spool.append({ type:"task_started", content:`Claudex Workhouse ${providerLabel} worker started.`, threadId:state.sessionId });

const emotionTool=`mcp__${EMOTION_MCP_SERVER_ID}__${EMOTION_MCP_TOOL_NAME}`,managedTools=["mcp__claudex-workhouse__managed_provider_task_create","mcp__claudex-workhouse__managed_provider_task_get","mcp__claudex-workhouse__managed_provider_task_wait","mcp__claudex-workhouse__managed_provider_task_resume"];
const restrictedTools=profile.tools[0]!=="default",extraTools=[...(emotionMcpUrl?[emotionTool]:[]),...(managedMcpUrl?managedTools:[]),...externalMcp.allowedTools];
// A conversation keeps every file tool off. The exception is a file the user
// attached to this very turn: its path is already in the prompt, and without
// Read the model is told to look at a screenshot it has no way to open. Read
// alone cannot search, list or run anything, and the sandbox root added below
// is the uploads directory rather than the workspace.
const conversationAttachments=runtimeProfile==="conversation"?parseConversationAttachments(productEnv("CONVERSATION_ATTACHMENTS")):[];
const conversationReadTools=conversationAttachments.length?["Read"]:[];
let tools=runtimeProfile==="conversation"?[...(emotionMcpUrl?[emotionTool]:[]),...conversationReadTools]:restrictedTools?[...profile.tools,...extraTools]:profile.tools,allowedTools=runtimeProfile==="conversation"?tools:restrictedTools?[...profile.tools,...extraTools]:extraTools;
let isolatedRuntime=runtimeProfile==="conversation";
const args = ["-p", "--output-format", "stream-json", "--include-partial-messages", "--verbose", "--permission-mode", profile.mode];
if(isolatedRuntime)args.push("--safe-mode","--no-chrome","--strict-mcp-config","--tools",...(tools.length?tools:[""]));
else args.push("--tools",...tools,"--setting-sources","user,project,local");
for(const directory of new Set(conversationAttachments.map(item=>path.dirname(item))))args.push("--add-dir",directory);
if(switchModelsOnFlag!==null)args.push("--settings",JSON.stringify({switchModelsOnFlag}));
const mcpServers:Record<string,unknown>={};
if(emotionMcpUrl)mcpServers[EMOTION_MCP_SERVER_ID]={type:"http",url:emotionMcpUrl,headers:{[EMOTION_MCP_TASK_HEADER]:"${CLAUDEX_WORKHOUSE_CURRENT_TASK_ID}",[EMOTION_MCP_SESSION_HEADER]:"${CLAUDEX_WORKHOUSE_CURRENT_SESSION_ID}",[EMOTION_MCP_PROFILE_HEADER]:"${CLAUDEX_WORKHOUSE_RUNTIME_PROFILE}"}};
if(managedMcpUrl)mcpServers["claudex-workhouse"]={type:"http",url:managedMcpUrl,headers:{Authorization:"Bearer ${CLAUDEX_WORKHOUSE_MANAGED_PROVIDER_TOKEN}","X-Claudex-Workhouse-Task-Id":"${CLAUDEX_WORKHOUSE_CURRENT_TASK_ID}"}};
Object.assign(mcpServers,externalMcp.mcpServers);
if(Object.keys(mcpServers).length)args.push("--mcp-config",JSON.stringify({mcpServers}));
if(allowedTools.length)args.push("--allowedTools",...allowedTools);
let delegationSettings:unknown;try{delegationSettings=JSON.parse(productEnv("DELEGATION_SETTINGS")??"null");}catch{delegationSettings=null;}
let systemPrompt=runtimeProfile==="conversation"?[conversationAttachments.length?"Claudex Workhouse conversation-only runtime: respond to the supplied conversation prompt. Do not modify files, run commands, browse, delegate work, or turn the exchange into an implementation task.":"Claudex Workhouse conversation-only runtime: respond to the supplied conversation prompt. Do not inspect or modify files, run commands, browse, delegate work, or turn the exchange into an implementation task.",conversationAttachmentInstruction(conversationAttachments),CONVERSATION_EMOTION_INSTRUCTION].filter(Boolean).join("\n\n"):`${delegationDeveloperInstructions(normalizeDelegationSettings(delegationSettings),providerId)}\n\n${executionPolicyTurnInstructions(providerId,automationLevel(undefined,permissionProfile),cwd)}`;
args.push("--append-system-prompt",systemPrompt);
if (permissionProfile === ":danger-full-access") args.push("--dangerously-skip-permissions");
if (model && model !== "default") args.push("--model", model);
if (effort && effort !== "default") args.push("--effort", effort);
if (mode === "resume" || mode === "fork") args.push("--resume", sessionId);
if (mode === "fork") args.push("--fork-session");
if ((mode === "new" || mode === "fork") && requestedSessionId) args.push("--session-id", requestedSessionId);
args.push(prompt);

const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);
function toolSummary(name: string, input: any): string {
  if (name === "Read" || name === "NotebookRead") return relativePath(input.file_path, cwd);
  if (name === "Grep" || name === "Glob") return `${input.pattern ?? ""}${input.path ? ` · ${relativePath(input.path, cwd)}` : ""}`;
  if (name === "WebFetch") return String(input.url ?? "");
  if (name === "WebSearch") return String(input.query ?? "");
  if (name === "Task") return String(input.description ?? input.subagent_type ?? "");
  if (name === "TodoWrite") return "Update the todo list";
  if (name === "Bash") return String(input.command ?? "");
  return "";
}
const bashCommandsByToolId=new Map<string,string>();
function emitToolUse(part: any) {
  const name = part.name || "tool"; const input = part.input || {}; const id = part.id ?? null;
  const emotion=claudeEmotionForTool(name);if(emotion)updateWorkerEmotion(root,providerId,emotion,state.sessionId);
  if (EDIT_TOOLS.has(name)) {
    const changes = name === "MultiEdit" ? (input.edits || []).map((e: any) => ({ file: input.file_path, old: e.old_string, new: e.new_string }))
      : name === "Write" ? [{ file: input.file_path, old: "", new: input.content ?? "" }]
      : [{ file: input.file_path, old: input.old_string ?? "", new: input.new_string ?? "" }];
    for (const ch of changes) {
      const d = unifiedLineDiff(ch.old, ch.new);
      const resolved=relativePathInfo(ch.file,cwd);spool.append({ type: "file_change_started", content: d.text, threadId: state.sessionId, itemId: id, toolName: name, metadata: { path: resolved.path, pathBase:resolved.pathBase, tool: name, additions: d.additions, deletions: d.deletions } });
    }
    return;
  }
  if (name === "Bash") {
    const command=String(input.command??"");
    if(typeof id==="string"&&id&&command)bashCommandsByToolId.set(id,command);
    spool.append({ type:"command_started", content:command, threadId:state.sessionId, itemId:id, toolName:name, metadata:{command,description:input.description??null,source:"provider"} });
    return;
  }
  const detail = toolSummary(name, input);
  spool.append({ type: "tool_started", content: detail ? `${name}: ${detail}` : name, threadId: state.sessionId, itemId: id, toolName: name, metadata: {} });
}

beginWorkerEmotion(root,providerId,prompt,state.sessionId);
const childEnvironment={...process.env,...externalMcp.environment};
const child = spawn(claudeBinary, args, { cwd, shell: false, windowsHide:true, stdio: ["ignore", "pipe", "pipe"],env:childEnvironment });
const lines = readline.createInterface({ input: child.stdout });
let sawCompactionBoundary=false;
let currentOutputCallId:string|null=null;
lines.on("line", (line) => {
  try {
    const event = JSON.parse(line);
    if (event.session_id) state.sessionId = event.session_id;
    state.activity=`${event.type}${event.subtype?`/${event.subtype}`:""}`;
    if (event.type === "system" && event.subtype === "init") {
      state.contextCapabilities={manualCompact:Array.isArray(event.slash_commands)&&event.slash_commands.includes("/compact"),contextCommand:Array.isArray(event.slash_commands)&&event.slash_commands.includes("/context")};
      if(event.model)state.model=event.model;
      spool.append({ type:"turn_started", content:`${providerLabel} session initialized.`, threadId:state.sessionId, metadata:{nativeType:event.type,subtype:event.subtype} });
    } else if ((event.type === "system" && event.subtype === "compact_boundary") || event.type === "compact_boundary") {
      sawCompactionBoundary=true;
      const compactMetadata=event.compactMetadata&&typeof event.compactMetadata==="object"?event.compactMetadata:event.compact_metadata??{};
      const at=typeof event.timestamp==="string"?event.timestamp:new Date().toISOString(),trigger=compactMetadata.trigger;
      const nativeItemId=typeof event.uuid==="string"&&event.uuid?event.uuid:typeof event.id==="string"&&event.id?event.id:null;
      const previous=state.contextUsage as ProviderContextUsage|undefined;
      state.contextUsage=compactedContext(previous??{usedTokens:null,windowTokens:claudeContextWindow(state.model??model),percent:null,updatedAt:at},trigger,at);
      spool.append({ type:"context_compaction", content:`${providerLabel} context ${trigger==="auto"?"automatically ":""}compacted.`, threadId:state.sessionId, itemId:nativeItemId, timestamp:at, metadata:{nativeType:event.type,subtype:event.subtype,trigger:trigger==="auto"?"auto":trigger==="manual"?"manual":null,preTokens:Number.isFinite(Number(compactMetadata.preTokens??compactMetadata.pre_tokens))?Number(compactMetadata.preTokens??compactMetadata.pre_tokens):null,contextUsage:state.contextUsage} });
    } else if (event.type === "system"&&persistProviderSystemEvent(providerId,event.subtype)) spool.append({ type:"tool_progress", content:`${providerLabel} ${event.subtype ?? "system"} event.`, threadId:state.sessionId, metadata:{nativeType:event.type,subtype:event.subtype} });
    if (event.type === "stream_event") {
      const native=event.event ?? {};
      const delta=native.delta ?? {};
      if(native.type==="message_start"&&typeof native.message?.id==="string")currentOutputCallId=native.message.id;
      if(native.type==="content_block_start"&&providerId!=="claude")compatibleProgressReported=false;
      if (native.type === "content_block_delta" && delta.type === "text_delta") {
        const itemId=outputBlocks.streamed(currentOutputCallId,native.index);
        if(providerId==="claude")spool.append({ type:"message_delta", content:delta.text ?? "", threadId:state.sessionId, itemId, metadata:{nativeType:native.type,index:native.index,outputCallId:currentOutputCallId} });
        else{if(itemId!==compatibleTextBlockId){textDeltas.flush();compatibleTextBlockId=itemId;}textDeltas.push(delta.text??"",{nativeType:native.type,index:native.index,outputCallId:currentOutputCallId,itemId});}
      } else if (native.type === "content_block_delta") {
        if(providerId==="claude"){
          const nativeProgress=delta.partial_json ?? delta.thinking;
          spool.append({ type:"tool_progress", content:nativeProgress ?? `${providerLabel} tool progress.`, threadId:state.sessionId, metadata:{nativeType:native.type,deltaType:delta.type,index:native.index,...(nativeProgress==null?{synthetic:true}:{})} });
        }
        else if(!compatibleProgressReported){compatibleProgressReported=true;spool.append({type:"tool_progress",content:`${providerLabel} is thinking.`,threadId:state.sessionId,metadata:{nativeType:native.type,deltaType:delta.type,index:native.index}});}
      }
      const streamOutputUsage=claudeOutputUsageFromStreamEvent(event);
      if(streamOutputUsage){recordOutputUsage(currentOutputCallId,streamOutputUsage);spool.append({type:"unknown",content:"Claude output usage updated.",threadId:state.sessionId,metadata:{nativeMethod:"claude/outputUsage/updated",outputCallId:currentOutputCallId,outputUsage:streamOutputUsage}});}
    }
    const parts = event.message?.content ?? [];
    if(event.type==="assistant"&&typeof event.message?.id==="string")currentOutputCallId=event.message.id;
    const usage=claudeContextUsageFromStreamEvent(event,state.model??model),outputUsage=claudeOutputUsageFromStreamEvent(event);
    if(outputUsage)recordOutputUsage(currentOutputCallId,outputUsage);
    if(usage){state.contextUsage={...usage,lastCompactedAt:state.contextUsage?.lastCompactedAt??null,compactionTrigger:state.contextUsage?.compactionTrigger??null};spool.append({type:"unknown",content:"Claude context usage updated.",threadId:state.sessionId,metadata:{nativeMethod:"claude/contextUsage/updated",usageScope:"message",outputCallId:currentOutputCallId,contextUsage:state.contextUsage,outputUsage}});}
    for (const part of parts) {
      if (part.type === "text" && part.text && !compactOperation) { state.log += `${part.text}\n`; if(event.type === "assistant"){textDeltas.flush();compatibleTextBlockId=null;spool.append({ type:"message_completed", content:part.text, threadId:state.sessionId, itemId:outputBlocks.completed(currentOutputCallId), metadata:{nativeType:event.type,outputCallId:currentOutputCallId,outputUsage} });} }
      if (part.type === "tool_use") { state.log += `[tool] ${part.name}\n`; emitToolUse(part); }
      if (part.type === "tool_result") {
        const itemId=typeof part.tool_use_id==="string"?part.tool_use_id:null,command=itemId?bashCommandsByToolId.get(itemId):undefined,isError=Boolean(part.is_error);
        if(itemId)bashCommandsByToolId.delete(itemId);
        const content=typeof part.content==="string"?part.content:JSON.stringify(part.content??"");
        if(command)spool.append({type:"command_completed",content,threadId:state.sessionId,itemId,toolName:"Bash",status:isError?"failed":"completed",metadata:{nativeType:event.type,command,isError,ok:!isError,source:"provider"}});
        else spool.append({type:"tool_completed",content,threadId:state.sessionId,itemId,metadata:{nativeType:event.type,isError}});
      }
    }
    if (event.type === "result") {
      textDeltas.flush();
      if(compactOperation&&!event.is_error&&!sawCompactionBoundary){
        const at=new Date().toISOString();
        state.contextUsage=compactedContext(state.contextUsage??{usedTokens:null,windowTokens:claudeContextWindow(state.model??model),percent:null,updatedAt:at},"manual",at);
        spool.append({type:"context_compaction",content:"Claude context compacted.",threadId:state.sessionId,metadata:{nativeType:event.type,trigger:"manual",contextUsage:state.contextUsage}});
      }
      const eventResult=typeof event.result==="string"&&event.result.trim()?event.result:null;
      state.result = compactOperation&&!event.is_error ? "Context compacted." : eventResult;
      state.status = event.is_error ? "failed" : "completed";
      state.error = event.is_error ? event.result ?? "Claude task failed" : null;
      updateWorkerEmotion(root,providerId,event.is_error?"disappointed":"done",state.sessionId);
      spool.append({ type:event.is_error ? "task_failed" : "task_completed", content:compactOperation&&!event.is_error ? `${providerLabel} context compaction completed.` : event.result ?? (event.is_error ? `${providerLabel} task failed.` : `${providerLabel} task completed.`), threadId:state.sessionId, terminal:true, metadata:{nativeType:event.type,subtype:event.subtype,operation:compactOperation?"context_compaction":undefined} });
    }
    state.updatedAt = new Date().toISOString();
    if(event.type==="result"){stateWritePending=true;flushStateWrite();}else scheduleStateWrite();
  } catch {
    state.log += `${line}\n`;
    spool.append({ type:"unknown", content:line, threadId:state.sessionId, metadata:{nativeType:"unparsed_stdout"} });
  }
});
child.stderr.on("data", (chunk) => { const content=chunk.toString("utf8");state.log += content; state.updatedAt = new Date().toISOString(); scheduleStateWrite();spool.append({type:"unknown",content,threadId:state.sessionId,metadata:{nativeType:"stderr"}}); });
child.once("error", (error) => { textDeltas.flush();state.status = "failed"; state.error = error.message; state.updatedAt = new Date().toISOString(); spool.append({type:"task_failed",content:error.message,threadId:state.sessionId,terminal:true});stateWritePending=true;flushStateWrite(); });
child.once("close", async(code, signal) => {
  textDeltas.flush();
  if(postResultFinalization)await postResultFinalization;
  const transitioned=["pending","queued","running","waiting"].includes(state.status);
  if (transitioned) {
    state.status = signal ? "stopped" : code === 0 ? "completed" : "failed";
    if (code !== 0 && !signal) state.error = `${providerLabel} exited with code ${code}`;
    updateWorkerEmotion(root,providerId,state.status==="completed"?"done":state.status==="failed"?"disappointed":"neutral",state.sessionId);
  }
  state.updatedAt = new Date().toISOString();
  if(transitioned){if(state.status==="stopped")spool.append({type:"task_stopped",content:`Claudex Workhouse stopped the ${providerLabel} task.`,threadId:state.sessionId,terminal:true});else if(state.status==="completed")spool.append({type:"task_completed",content:state.result??`${providerLabel} task completed.`,threadId:state.sessionId,terminal:true});else spool.append({type:"task_failed",content:state.error??`${providerLabel} task failed.`,threadId:state.sessionId,terminal:true});}
  stateWritePending=true;flushStateWrite();
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => { child.kill("SIGTERM"); setTimeout(() => child.kill("SIGKILL"), 3000).unref(); });
}
