export type AgentEventKind = "task_started" | "turn_started" | "message_delta" | "message_completed" | "command_started" | "command_output" | "command_completed" | "file_change_started" | "file_change_completed" | "tool_started" | "tool_progress" | "tool_completed" | "agent_started" | "agent_progress" | "agent_completed" | "agent_failed" | "approval_required" | "approval_resolved" | "user_input_required" | "user_input_resolved" | "context_compaction" | "task_completed" | "task_failed" | "task_stopped" | "message" | "command" | "file_read" | "file_write" | "error" | "mcp_tool_call" | "mcp_tool_result" | "unknown";
export type AgentEvent = { type:AgentEventKind; content:string; provider?:"codex"|"claude"|"deepseek"|"ollama"|"antigravity"|"grok"; serverName?:string; toolName?:string; status?:string; timestamp?:string; metadata?:Record<string,unknown>;sequence?:number;eventId?:string;taskId?:string;threadId?:string|null;turnId?:string|null;itemId?:string|null;terminal?:boolean };
export type EventPresentation = { label:string; className:"user"|"agent"|"log"|"error" };

type EventRenderer = (event: AgentEvent) => EventPresentation;

const messageRenderer: EventRenderer = (event) => {
  if (event.metadata?.role === "user") return { label:translate("conversation.request"), className:"user" };
  if (event.metadata?.section === "result" || event.metadata?.role === "agent") return { label:translate("conversation.result"), className:"agent" };
  return { label:translate("event.message"), className:"agent" };
};
const errorRenderer: EventRenderer = () => ({ label:translate("event.error"), className:"error" });
const unknownRenderer: EventRenderer = (event) => {
  const method=typeof event.metadata?.nativeMethod==="string"?event.metadata.nativeMethod:"";
  const label=event.metadata?.section === "log"?translate("event.progress"):translate("event.internal");
  return {label,className:"log"};
};
const genericRenderer: EventRenderer = (event) => ({ label:event.type === "mcp_tool_call" ? "MCP tool call" : event.type === "mcp_tool_result" ? "MCP tool result" : translate("event.task"), className:"log" });
const liveRenderer: EventRenderer = (event) => {
  return {label:translate(`event.${event.type}`),className:event.type==="task_failed"?"error":event.type.startsWith("message_")||event.type==="task_completed"?"agent":"log"};
};

export const eventRendererRegistry: Partial<Record<AgentEventKind, EventRenderer>> = {
  message: messageRenderer,
  error: errorRenderer,
  unknown: unknownRenderer,
  command: genericRenderer,
  file_read: genericRenderer,
  file_write: genericRenderer,
  mcp_tool_call: genericRenderer,
  mcp_tool_result: genericRenderer
};
for(const type of ["task_started","turn_started","message_delta","message_completed","command_started","command_output","command_completed","file_change_started","file_change_completed","tool_started","tool_progress","tool_completed","agent_started","agent_progress","agent_completed","agent_failed","approval_required","approval_resolved","user_input_required","user_input_resolved","context_compaction","task_completed","task_failed","task_stopped"] as AgentEventKind[])eventRendererRegistry[type]=liveRenderer;

export function presentEvent(event: AgentEvent): EventPresentation {
  return (eventRendererRegistry[event.type] ?? unknownRenderer)(event);
}
import { translate } from "./i18n";
