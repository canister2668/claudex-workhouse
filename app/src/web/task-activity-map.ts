import type{AgentEvent}from"./events";
import{translate}from"./i18n";

export type TaskActivity={type:string;labelKey:string;detail:string;raw:string};
export type TaskEventClass="activity"|"telemetry";

const native=(event:AgentEvent)=>String(event.metadata?.nativeMethod??event.metadata?.itemType??event.type);
const compact=(value:unknown)=>String(value??"").replace(/\s+/g," ").trim().slice(0,240);
const claudeSessionInit=(provider:string,event:AgentEvent)=>provider==="claude"&&event.type==="turn_started"&&event.metadata?.nativeType==="system"&&event.metadata?.subtype==="init";

// Transport diagnostics are useful for connection health and logs, but must not
// replace the user-visible description of the work currently in progress.
export function classifyTaskEvent(provider:"codex"|"claude"|"deepseek"|"ollama"|"antigravity"|"grok",event:AgentEvent):TaskEventClass{
  void provider;
  return event.type==="tool_progress"||event.type==="command_output"||event.type==="unknown"||event.type.startsWith("agent_")?"telemetry":"activity";
}

export function mapActivityEvent(provider:"codex"|"claude"|"deepseek"|"ollama"|"antigravity"|"grok",event:AgentEvent):TaskActivity{
  const raw=native(event),detail=compact(event.content);
  if(event.type==="task_started"||claudeSessionInit(provider,event))return{type:"reasoning",labelKey:"liveness.activity.reasoning",detail:translate("progress.stage.starting"),raw};
  if(event.type==="approval_required")return{type:"approval",labelKey:"liveness.activity.approval",detail,raw};
  if(event.type==="user_input_required")return{type:"decision",labelKey:"liveness.activity.decision",detail,raw};
  if(event.type==="approval_resolved"||event.type==="user_input_resolved")return{type:"reasoning",labelKey:"liveness.activity.reasoning",detail:translate("progress.stage.thinking"),raw};
  if(event.type==="context_compaction")return{type:"reasoning",labelKey:"liveness.activity.reasoning",detail:translate("context.compacting"),raw};
  if(event.type==="file_change_started"||event.type==="file_change_completed"||event.type==="file_read"||event.type==="file_write"||raw.includes("diff")||raw.includes("patch"))return{type:"file",labelKey:"liveness.activity.file",detail:detail||compact(event.metadata?.path),raw};
  if(event.type.startsWith("command_")||event.type==="command")return{type:"command",labelKey:"liveness.activity.command",detail:detail||compact(event.metadata?.command),raw};
  if((event.type.startsWith("tool_")&&event.type!=="tool_progress")||event.type.startsWith("mcp_"))return{type:"tool",labelKey:"liveness.activity.tool",detail:detail||compact(event.toolName),raw};
  if(event.type==="message_delta"||event.type==="message_completed"||event.type==="message")return{type:"response",labelKey:"liveness.activity.response",detail:translate("progress.stage.response"),raw};
  if(event.type==="turn_started")return{type:"reasoning",labelKey:"liveness.activity.reasoning",detail:translate("progress.stage.thinking"),raw};
  if(event.type==="task_completed")return{type:"completed",labelKey:"liveness.activity.completed",detail:translate("liveness.activity.completed"),raw};
  if(event.type==="task_failed")return{type:"failed",labelKey:"liveness.activity.failed",detail:detail||translate("liveness.activity.failed"),raw};
  if(event.type==="task_stopped")return{type:"completed",labelKey:"event.task_stopped",detail:translate("event.task_stopped"),raw};
  if(event.type==="error")return{type:"failed",labelKey:"liveness.activity.failed",detail:detail||translate("liveness.activity.failed"),raw};
  return{type:"internal",labelKey:"liveness.activity.internal",detail,raw:`${{codex:"Codex",claude:"Claude",deepseek:"DeepSeek",ollama:"Ollama",antigravity:"Gemini",grok:"Grok"}[provider]} · ${raw}`};
}
