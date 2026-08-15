import type { AgentEvent } from "./events";
import { recentRunningConversationEvents } from "./running-history";
import { translate } from "./i18n";

function textContent(item:any){
  if(typeof item?.text==="string")return item.text;
  if(Array.isArray(item?.content))return item.content.map((part:any)=>part?.text??part?.content??"").filter(Boolean).join("\n");
  return "";
}

function nativeImageMetadata(item:any,cwd?:string|null){
  const value=item?.type==="imageView"?item.path:item?.type==="imageGeneration"?item.savedPath:null;
  if(typeof value!=="string"||!value.trim())return{};
  const target=value.trim().replace(/\\/g,"/"),base=String(cwd??"").trim().replace(/\\/g,"/").replace(/\/+$/,"");
  const absolute=/^(?:\/|[A-Za-z]:\/|\/\/)/.test(target);
  if(!absolute)return{mediaKind:"image",mediaPath:target,mediaPathBase:"task-cwd"};
  const windows=/^[A-Za-z]:\//.test(target),sameBase=windows?target.toLowerCase().startsWith(`${base.toLowerCase()}/`):Boolean(base&&target.startsWith(`${base}/`));
  return sameBase?{mediaKind:"image",mediaPath:target.slice(base.length+1),mediaPathBase:"task-cwd"}:{};
}

function itemEvent(item:any,turn:any,index:number,lastAgentIndex:number,cwd?:string|null):AgentEvent|null{
  const base={provider:"codex" as const,turnId:turn?.id??null,itemId:item?.id??`${turn?.id??"turn"}:${index}`,status:item?.status,metadata:{nativeItemType:item?.type,nativeStatus:item?.status}};
  if(item?.type==="userMessage")return {...base,type:"message",content:textContent(item),metadata:{...base.metadata,role:"user"}};
  if(item?.type==="agentMessage")return {...base,type:"message_completed",content:textContent(item),metadata:{...base.metadata,role:"agent",phase:index===lastAgentIndex?"final_answer":"commentary"}};
  if(item?.type==="commandExecution")return {...base,type:"command_completed",content:item.aggregatedOutput??item.command??"",metadata:{...base.metadata,command:item.command}};
  if(item?.type==="fileChange")return {...base,type:"file_change_completed",content:JSON.stringify(item.changes??[],null,2),toolName:"fileChange",metadata:{...base.metadata,changes:item.changes}};
  if(item?.type==="mcpToolCall")return {...base,type:"mcp_tool_result",content:item.result?.content??`${item.server??"mcp"}/${item.tool??"tool"}`,serverName:item.server,toolName:item.tool};
  if(item?.type==="contextCompaction")return {...base,type:"context_compaction",content:translate("context.compactedSentence")};
  if(item?.type==="collabAgentToolCall")return {...base,type:item.status==="failed"?"agent_failed":"agent_completed",content:item.prompt??item.tool??translate("conversation.parallelAgent"),metadata:{...base.metadata,receiverThreadIds:item.receiverThreadIds,prompt:item.prompt,agentsStates:item.agentsStates}};
  if(item?.type==="subAgentActivity")return {...base,type:"agent_progress",content:item.message??item.kind??translate("conversation.parallelAgentProgress"),metadata:{...base.metadata,agentThreadId:item.agentThreadId,agentPath:item.agentPath,kind:item.kind}};
  if(["reasoning","webSearch","dynamicToolCall","imageGeneration","imageView","sleep"].includes(item?.type))return {...base,type:"tool_completed",content:item.query??item.tool??item.type,toolName:item.tool,metadata:{...base.metadata,...nativeImageMetadata(item,cwd)}};
  return {...base,type:"unknown",content:translate("conversation.codexRecord",{type:item?.type??"unknown"}),metadata:{...base.metadata,payload:item}};
}

// Native app-server history and live AgentEvent streams now share the same
// Conversation renderer. Provider-specific fields stay in metadata for the
// expandable diagnostics UI instead of leaking raw JSON into the main view.
export function codexTurnsToEvents(turns:any[],cwd?:string|null):AgentEvent[]{
  const events:AgentEvent[]=[];
  for(const turn of turns??[]){
    const items=Array.isArray(turn?.items)?turn.items:[];
    let lastAgentIndex=-1;for(let index=0;index<items.length;index++)if(items[index]?.type==="agentMessage")lastAgentIndex=index;
    for(let index=0;index<items.length;index++){const event=itemEvent(items[index],turn,index,lastAgentIndex,cwd);if(event)events.push(event);}
  }
  return events;
}

export function codexConversationEvents(history:AgentEvent[],current:AgentEvent[],includeHistory:boolean):AgentEvent[]{
  if(!current.length)return history;
  if(!includeHistory||!history.length)return current;
  const currentTurnIds=new Set(current.map(event=>event.turnId).filter((id):id is string=>Boolean(id)));
  const currentItemIds=new Set(current.map(event=>event.itemId).filter((id):id is string=>Boolean(id)));
  const prior=history.filter(event=>!(event.turnId&&currentTurnIds.has(event.turnId))&&!(event.itemId&&currentItemIds.has(event.itemId)));
  const combined=[...prior,...current];
  return recentRunningConversationEvents(combined,true);
}
