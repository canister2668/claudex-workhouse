import fs from "node:fs";
import {conversationAttachmentInstruction,parseConversationAttachments} from "./conversation-attachments.js";
import path from "node:path";
import { spawn } from "node:child_process";
import readline from "node:readline";
import { StreamSpool } from "./stream-events.js";
import { relativePath, relativePathInfo, unifiedLineDiff } from "./diff.js";
import { claudeContextUsageFromStreamEvent as grokContextUsageFromStreamEvent, claudeContextWindow as grokContextWindow, claudeOutputUsageFromStreamEvent as grokOutputUsageFromStreamEvent, compactedContext, type ProviderContextUsage, type ProviderOutputUsage } from "./provider-context.js";
import { delegationDeveloperInstructions, normalizeDelegationSettings } from "./delegation-settings.js";
import {executionPolicyTurnInstructions,grokAutomationLevel} from "./automation-level.js";
import {beginWorkerEmotion,claudeEmotionForTool as grokEmotionForTool,updateWorkerEmotion} from "./worker-emotion.js";
import { sanitizeSensitiveValue } from "./sensitive-data.js";
import {createTextDeltaBatcher} from "./text-delta-batcher.js";
import {ProviderOutputBlockTracker} from "./provider-output-block.js";
import {persistProviderSystemEvent} from "./provider-system-events.js";
import {stripAnsi} from "./process.js";
import{CONVERSATION_EMOTION_INSTRUCTION}from"./emotion-mcp-policy.js";

const [, , statePath, taskId, grokBinary, mode, cwd, marker, permissionProfile = ":read-only", model = "default", effort="default",workMode="default",...workerArgs] = process.argv;
const AUTOMATION_LEVELS=new Set(["full","auto","confirm","read"]);
// A rolling deploy can briefly leave the old provider (which did not pass an
// automation argument) launching the new detached worker. Detect the new
// layout by its closed enum so source/requested session IDs never shift into
// the prompt or permission slot.
const hasAutomationArg=AUTOMATION_LEVELS.has(workerArgs[0]??"");
const requestedAutomationLevel=hasAutomationArg?workerArgs[0]:"";
const sourceSessionId=workerArgs[hasAutomationArg?1:0]??"";
const requestedSessionId=workerArgs[hasAutomationArg?2:1]??"";
const promptParts=workerArgs.slice(hasAutomationArg?3:2);
const prompt = promptParts.join(" ");
const compactOperation = prompt.trim().split(/\s+/,1)[0] === "/compact";

// Grok headless sessions cannot answer permission prompts. Its auto mode runs
// calls accepted by the safety classifier and explicitly reports blocked calls
// to the model, while acceptEdits incorrectly falls back to an unanswerable
// interactive prompt for shell writes.
const level=grokAutomationLevel(requestedAutomationLevel,permissionProfile);
const profile={
  mode:level==="read"?"plan":level==="full"?"bypassPermissions":"auto",
  tools:level==="read"?["Read","Glob","Grep","WebSearch","WebFetch"]:["default"]
};
const productEnv=(name:string)=>process.env[`CLAUDEX_WORKHOUSE_${name}`]??process.env[`CLAUDEX_WORKHOUSE_${name}`];
const providerId="grok" as const;
const providerLabel="Grok";
const requestedRuntimeProfile=productEnv("RUNTIME_PROFILE");
const runtimeProfile=requestedRuntimeProfile==="conversation"||requestedRuntimeProfile==="browser"?requestedRuntimeProfile:"default";
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

const state: any = { marker, pid: process.pid, pgid: process.pid, processStart: procStart(process.pid), sessionId: requestedSessionId || sourceSessionId || null, status: "running", startedAt, updatedAt: startedAt, result: null, error: null, log: "" };
let stateWriteTimer:ReturnType<typeof setTimeout>|null=null,stateWritePending=false;
function flushStateWrite(){if(stateWriteTimer)clearTimeout(stateWriteTimer);stateWriteTimer=null;if(!stateWritePending)return;stateWritePending=false;atomicWrite(state);}
function scheduleStateWrite(){stateWritePending=true;if(stateWriteTimer)return;stateWriteTimer=setTimeout(flushStateWrite,100);stateWriteTimer.unref?.();}
const outputBlocks=new ProviderOutputBlockTracker();
const textDeltas=createTextDeltaBatcher<{nativeType:string;index:unknown;outputCallId:string|null;itemId:string|null}>((content,metadata)=>spool.append({type:"message_delta",content,threadId:state.sessionId,itemId:metadata?.itemId??null,metadata}),{intervalMs:80,maxChars:192});
let compatibleTextBlockId:string|null=null;
let compatibleProgressReported=false;
let headlessApprovalFailure:string|null=null;
let providerStderrError:string|null=null;
let pendingResultFailure=false,postResultFinalization:Promise<void>|null=null;
let stopping=false;
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

const restrictedTools=profile.tools[0]!=="default";
const args = ["--single",prompt,"--output-format","streaming-messages-json","--include-partial-messages","--permission-mode",profile.mode,"--no-auto-update","--no-memory","--no-subagents"];
// The one file a conversation may open is the attachment the user added to
// this turn; its path is already in the prompt. Grok's MCP meta-tools stay
// available under --tools, while the task home exposes only the scoped emotion
// server in conversation mode.
const conversationAttachments=runtimeProfile==="conversation"?parseConversationAttachments(productEnv("CONVERSATION_ATTACHMENTS")):[];
if(runtimeProfile==="conversation")args.push("--disable-web-search","--tools",conversationAttachments.length?"read_file,search_tool,use_tool":"search_tool,use_tool");
else if(restrictedTools)args.push("--tools",profile.tools.join(","));
// Grok's plan tools need an interactive client to approve the plan. In a
// headless single-turn session exit_plan_mode fails with a disconnected
// client and cancels the whole run, so keep them out of the default tool set.
// `--no-plan` does not remove them, and the restricted profiles above already
// exclude them.
else args.push("--disallowed-tools","enter_plan_mode,exit_plan_mode");
let delegationSettings:unknown;try{delegationSettings=JSON.parse(productEnv("DELEGATION_SETTINGS")??"null");}catch{delegationSettings=null;}
const sandboxNotice=level==="full"?"Grok is running with explicit full access and no OS filesystem sandbox.":level==="read"?"Grok is restricted to the listed read/search tools; this is a provider tool restriction, not an OS filesystem sandbox.":"Grok auto mode applies its provider safety checks, but this host does not enforce an OS filesystem sandbox.";
args.push("--rules",runtimeProfile==="conversation"?[conversationAttachments.length?"Claudex Workhouse conversation-only runtime: respond to the supplied conversation prompt. Do not modify files, run commands, browse, delegate work, or turn the exchange into an implementation task.":"Claudex Workhouse conversation-only runtime: respond to the supplied conversation prompt. Do not inspect or modify files, run commands, browse, delegate work, or turn the exchange into an implementation task.",conversationAttachmentInstruction(conversationAttachments),CONVERSATION_EMOTION_INSTRUCTION].filter(Boolean).join("\n\n"):`${delegationDeveloperInstructions(normalizeDelegationSettings(delegationSettings),providerId)}\n\n${executionPolicyTurnInstructions(providerId,level,cwd)}\n${sandboxNotice}`);
if (model && model !== "default") args.push("--model", model);
if (effort && effort !== "default") args.push("--effort", effort);
if (mode === "resume" || mode === "fork") args.push("--resume", sourceSessionId);
if (mode === "fork") args.push("--fork-session");
if ((mode === "new" || mode === "fork") && requestedSessionId) args.push("--session-id", requestedSessionId);

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
  const emotion=grokEmotionForTool(name);if(emotion)updateWorkerEmotion(root,providerId,emotion,state.sessionId);
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
const childEnvironment={...process.env};
// The task contract is encoded above. Do not let a service-level Grok setting
// silently add or change an unreported sandbox mode for detached workers.
delete childEnvironment.GROK_SANDBOX;
// Single-turn Grok has no MCP injection surface. Keep the unsupported state
// explicit and never pass a task bundle capability to the provider process.
delete childEnvironment.CLAUDEX_WORKHOUSE_EXTERNAL_MCP_BUNDLE_FILE;
// Isolated profiles must not discover project-local MCP, plugins, rules, or
// agents. UUID resume remains backed by the shared sessions link in GROK_HOME.
const isolatedCwd=runtimeProfile==="conversation"||runtimeProfile==="browser"?String(process.env.CLAUDEX_WORKHOUSE_GROK_ISOLATED_CWD??""):"",providerCwd=isolatedCwd&&path.isAbsolute(isolatedCwd)?isolatedCwd:cwd;
const child = spawn(grokBinary, args, { cwd:providerCwd, shell: false, windowsHide:true, stdio: ["ignore", "pipe", "pipe"],env:childEnvironment });
const lines = readline.createInterface({ input: child.stdout });
let sawCompactionBoundary=false;
let currentOutputCallId:string|null=null;
let wireText="";
const wireTools=new Map<number,{id:string|null;name:string;json:string}>();
lines.on("line", (line) => {
  try {
    const event = JSON.parse(line);
    if(stopping)return;
    if (event.session_id) state.sessionId = event.session_id;
    state.activity=`${event.type}${event.subtype?`/${event.subtype}`:""}`;
    if(event.type==="message_start"){
      currentOutputCallId=typeof event.message?.id==="string"?event.message.id:currentOutputCallId;
      if(event.message?.model)state.model=event.message.model;
      spool.append({type:"turn_started",content:"Grok session initialized.",threadId:state.sessionId,metadata:{nativeType:event.type}});
    }else if(event.type==="content_block_start"){
      const block=event.content_block??{},index=Number(event.index??0);
      if(block.type==="tool_use"){const item={id:typeof block.id==="string"?block.id:null,name:String(block.name??"tool"),json:""};wireTools.set(index,item);emitToolUse({id:item.id,name:item.name,input:block.input??{}});}
    }else if(event.type==="content_block_delta"){
      const delta=event.delta??{},index=Number(event.index??0);
      if(delta.type==="text_delta"&&typeof delta.text==="string"){wireText+=delta.text;textDeltas.push(delta.text,{nativeType:event.type,index,outputCallId:currentOutputCallId,itemId:outputBlocks.streamed(currentOutputCallId,index)});}
      else if(delta.type==="input_json_delta"&&wireTools.has(index))wireTools.get(index)!.json+=String(delta.partial_json??"");
      else spool.append({type:"tool_progress",content:String(delta.thinking??delta.partial_json??"Grok is thinking."),threadId:state.sessionId,metadata:{nativeType:event.type,deltaType:delta.type,index}});
    }else if(event.type==="content_block_stop"){
      const item=wireTools.get(Number(event.index??0));if(item){wireTools.delete(Number(event.index??0));spool.append({type:"tool_completed",content:item.json,threadId:state.sessionId,itemId:item.id,toolName:item.name,metadata:{nativeType:event.type}});}
    }else if(event.type==="message_stop"){
      textDeltas.flush();if(wireText){state.log+=`${wireText}\n`;state.result=wireText;spool.append({type:"message_completed",content:wireText,threadId:state.sessionId,itemId:outputBlocks.completed(currentOutputCallId),metadata:{nativeType:event.type,outputCallId:currentOutputCallId}});wireText="";}
      state.status="completed";updateWorkerEmotion(root,providerId,"done",state.sessionId);spool.append({type:"task_completed",content:state.result??"Grok task completed.",threadId:state.sessionId,terminal:true,metadata:{nativeType:event.type}});
    }
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
      state.contextUsage=compactedContext(previous??{usedTokens:null,windowTokens:grokContextWindow(state.model??model),percent:null,updatedAt:at},trigger,at);
      spool.append({ type:"context_compaction", content:`${providerLabel} context ${trigger==="auto"?"automatically ":""}compacted.`, threadId:state.sessionId, itemId:nativeItemId, timestamp:at, metadata:{nativeType:event.type,subtype:event.subtype,trigger:trigger==="auto"?"auto":trigger==="manual"?"manual":null,preTokens:Number.isFinite(Number(compactMetadata.preTokens??compactMetadata.pre_tokens))?Number(compactMetadata.preTokens??compactMetadata.pre_tokens):null,contextUsage:state.contextUsage} });
    } else if (event.type === "system"&&persistProviderSystemEvent(providerId,event.subtype)) spool.append({ type:"tool_progress", content:`${providerLabel} ${event.subtype ?? "system"} event.`, threadId:state.sessionId, metadata:{nativeType:event.type,subtype:event.subtype} });
    if (event.type === "stream_event") {
      const native=event.event ?? {};
      const delta=native.delta ?? {};
      if(native.type==="message_start"&&typeof native.message?.id==="string")currentOutputCallId=native.message.id;
      if(native.type==="content_block_start"&&providerId!=="grok")compatibleProgressReported=false;
      if (native.type === "content_block_delta" && delta.type === "text_delta") {
        const itemId=outputBlocks.streamed(currentOutputCallId,native.index);
        if(providerId==="grok")spool.append({ type:"message_delta", content:delta.text ?? "", threadId:state.sessionId, itemId, metadata:{nativeType:native.type,index:native.index,outputCallId:currentOutputCallId} });
        else{if(itemId!==compatibleTextBlockId){textDeltas.flush();compatibleTextBlockId=itemId;}textDeltas.push(delta.text??"",{nativeType:native.type,index:native.index,outputCallId:currentOutputCallId,itemId});}
      } else if (native.type === "content_block_delta") {
        if(providerId==="grok")spool.append({ type:"tool_progress", content:delta.partial_json ?? delta.thinking ?? `${providerLabel} tool progress.`, threadId:state.sessionId, metadata:{nativeType:native.type,deltaType:delta.type,index:native.index} });
        else if(!compatibleProgressReported){compatibleProgressReported=true;spool.append({type:"tool_progress",content:`${providerLabel} is thinking.`,threadId:state.sessionId,metadata:{nativeType:native.type,deltaType:delta.type,index:native.index}});}
      }
      const streamOutputUsage=grokOutputUsageFromStreamEvent(event);
      if(streamOutputUsage){recordOutputUsage(currentOutputCallId,streamOutputUsage);spool.append({type:"unknown",content:"Grok output usage updated.",threadId:state.sessionId,metadata:{nativeMethod:"grok/outputUsage/updated",outputCallId:currentOutputCallId,outputUsage:streamOutputUsage}});}
    }
    const parts = event.message?.content ?? [];
    if(event.type==="assistant"&&typeof event.message?.id==="string")currentOutputCallId=event.message.id;
    const usage=grokContextUsageFromStreamEvent(event,state.model??model),outputUsage=grokOutputUsageFromStreamEvent(event);
    if(outputUsage)recordOutputUsage(currentOutputCallId,outputUsage);
    if(usage){state.contextUsage={...usage,lastCompactedAt:state.contextUsage?.lastCompactedAt??null,compactionTrigger:state.contextUsage?.compactionTrigger??null};spool.append({type:"unknown",content:"Grok context usage updated.",threadId:state.sessionId,metadata:{nativeMethod:"grok/contextUsage/updated",usageScope:"message",outputCallId:currentOutputCallId,contextUsage:state.contextUsage,outputUsage}});}
    for (const part of parts) {
      if (part.type === "text" && part.text && !compactOperation) { state.log += `${part.text}\n`; if(event.type === "assistant"){textDeltas.flush();compatibleTextBlockId=null;spool.append({ type:"message_completed", content:part.text, threadId:state.sessionId, itemId:outputBlocks.completed(currentOutputCallId), metadata:{nativeType:event.type,outputCallId:currentOutputCallId,outputUsage} });} }
      if (part.type === "tool_use") { state.log += `[tool] ${part.name}\n`; emitToolUse(part); }
      if (part.type === "tool_result") {
        const itemId=typeof part.tool_use_id==="string"?part.tool_use_id:null,command=itemId?bashCommandsByToolId.get(itemId):undefined,isError=Boolean(part.is_error);
        if(itemId)bashCommandsByToolId.delete(itemId);
        const content=typeof part.content==="string"?part.content:JSON.stringify(part.content??"");
        if(isError&&/User cancelled the execution for tool/i.test(content))headlessApprovalFailure="Grok tool approval was unavailable in the headless session.";
        else if(isError&&/Plan approval could not be completed/i.test(content))headlessApprovalFailure="Grok plan approval was unavailable in the headless session.";
        if(command)spool.append({type:"command_completed",content,threadId:state.sessionId,itemId,toolName:"Bash",status:isError?"failed":"completed",metadata:{nativeType:event.type,command,isError,ok:!isError,source:"provider"}});
        else spool.append({type:"tool_completed",content,threadId:state.sessionId,itemId,metadata:{nativeType:event.type,isError}});
      }
    }
    if (event.type === "result") {
      textDeltas.flush();
      if(compactOperation&&!event.is_error&&!sawCompactionBoundary){
        const at=new Date().toISOString();
        state.contextUsage=compactedContext(state.contextUsage??{usedTokens:null,windowTokens:grokContextWindow(state.model??model),percent:null,updatedAt:at},"manual",at);
        spool.append({type:"context_compaction",content:"Grok context compacted.",threadId:state.sessionId,metadata:{nativeType:event.type,trigger:"manual",contextUsage:state.contextUsage}});
      }
      const eventResult=typeof event.result==="string"&&event.result.trim()?event.result:null;
      const resolvedError=event.is_error?eventResult??headlessApprovalFailure??providerStderrError:null;
      state.result = compactOperation&&!event.is_error ? "Context compacted." : eventResult;
      pendingResultFailure=Boolean(event.is_error&&!resolvedError);
      state.status = pendingResultFailure?"running":event.is_error ? "failed" : "completed";
      state.error = event.is_error ? resolvedError : null;
      if(!pendingResultFailure){updateWorkerEmotion(root,providerId,event.is_error?"disappointed":"done",state.sessionId);spool.append({ type:event.is_error ? "task_failed" : "task_completed", content:compactOperation&&!event.is_error ? `${providerLabel} context compaction completed.` : eventResult ?? (event.is_error ? state.error : `${providerLabel} task completed.`), threadId:state.sessionId, terminal:true, metadata:{nativeType:event.type,subtype:event.subtype,operation:compactOperation?"context_compaction":undefined} });}
    }
    state.updatedAt = new Date().toISOString();
    if(event.type==="result"){stateWritePending=true;flushStateWrite();}else scheduleStateWrite();
  } catch {
    state.log += `${line}\n`;
    spool.append({ type:"unknown", content:line, threadId:state.sessionId, metadata:{nativeType:"unparsed_stdout"} });
  }
});
child.stderr.on("data", (chunk) => { const content=chunk.toString("utf8"),plain=stripAnsi(content),candidate=plain.split(/\r?\n/).map(line=>line.trim()).filter(Boolean).reverse().find(line=>/\b(?:error|rate limit|usage limit|too many requests)\b/i.test(line));if(candidate)providerStderrError=candidate.slice(0,2000);state.log += content; state.updatedAt = new Date().toISOString(); scheduleStateWrite();spool.append({type:"unknown",content,threadId:state.sessionId,metadata:{nativeType:"stderr"}}); });
child.once("error", (error) => { textDeltas.flush();state.status = "failed"; state.error = error.message; state.updatedAt = new Date().toISOString(); spool.append({type:"task_failed",content:error.message,threadId:state.sessionId,terminal:true});stateWritePending=true;flushStateWrite(); });
child.once("close", async(code, signal) => {
  textDeltas.flush();
  if(postResultFinalization)await postResultFinalization;
  const transitioned=["pending","queued","running","waiting"].includes(state.status);
  if (transitioned) {
    state.status = stopping||signal ? "stopped" : pendingResultFailure||code!==0 ? "failed" : "completed";
    if (state.status==="failed") state.error = headlessApprovalFailure??providerStderrError??(code!==0?`${providerLabel} exited with code ${code}`:"Grok task failed");
    updateWorkerEmotion(root,providerId,state.status==="completed"?"done":state.status==="failed"?"disappointed":"neutral",state.sessionId);
  }
  state.updatedAt = new Date().toISOString();
  if(transitioned){if(state.status==="stopped")spool.append({type:"task_stopped",content:`Claudex Workhouse stopped the ${providerLabel} task.`,threadId:state.sessionId,terminal:true});else if(state.status==="completed")spool.append({type:"task_completed",content:state.result??`${providerLabel} task completed.`,threadId:state.sessionId,terminal:true});else spool.append({type:"task_failed",content:state.error??`${providerLabel} task failed.`,threadId:state.sessionId,terminal:true});}
  stateWritePending=true;flushStateWrite();
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    if(stopping)return;
    stopping=true;
    textDeltas.flush();
    state.status="stopped";state.error=null;state.updatedAt=new Date().toISOString();
    updateWorkerEmotion(root,providerId,"neutral",state.sessionId);
    spool.append({type:"task_stopped",content:`Claudex Workhouse stopped the ${providerLabel} task.`,threadId:state.sessionId,terminal:true,metadata:{signal}});
    stateWritePending=true;flushStateWrite();
    child.kill("SIGTERM");setTimeout(()=>child.kill("SIGKILL"),3000).unref();
  });
}
