// Claude Code runs a subagent through its Agent tool (named Task in older CLIs).
// The parallel-agent roster renders agent_* lifecycle events keyed by
// metadata.agentThreadId, so each subagent is keyed by the tool_use id that
// spawned it: the stream's system task_* events, the subagent's own messages
// (parent_tool_use_id) and the transcript's task notifications all carry it.

type AgentLifecycleKind="agent_started"|"agent_progress"|"agent_completed"|"agent_failed";

export const isClaudeAgentTool=(name:unknown)=>name==="Agent"||name==="Task";

const text=(value:unknown)=>typeof value==="string"&&value.trim()?value.trim():"";
const FAILED_STATUSES=new Set(["failed","error","errored","killed"]);
const STOPPED_STATUSES=new Set(["stopped","cancelled","canceled","interrupted"]);

function resultText(content:unknown){
  if(typeof content==="string")return content;
  if(Array.isArray(content))return content.map((part:any)=>typeof part?.text==="string"?part.text:"").filter(Boolean).join("\n");
  return"";
}

export function claudeAgentStartedEvent(part:any,time:{timestamp?:string}={}){
  const input=part?.input??{},id=typeof part?.id==="string"?part.id:null;
  const description=text(input.description),subagentType=text(input.subagent_type);
  return{type:"agent_started" as AgentLifecycleKind,content:description||subagentType||"Parallel agent",status:"running",toolName:part?.name??"Agent",itemId:id,...time,
    metadata:{agentThreadId:id,prompt:text(input.prompt),description:description||null,subagentType:subagentType||null,background:input.run_in_background===true?true:undefined,source:"provider"}};
}

// A background launch returns at once with a fixed notice; only a foreground
// call's tool_result is the subagent's actual outcome.
export function claudeAgentToolResultEvent(part:any,toolUseResult:any,time:{timestamp?:string}={}){
  const id=typeof part?.tool_use_id==="string"?part.tool_use_id:null,content=resultText(part?.content);
  const launched=toolUseResult?.status==="async_launched"||toolUseResult?.isAsync===true||/^Async agent launched/.test(content);
  const agentId=text(toolUseResult?.agentId)||/agentId:\s*([A-Za-z0-9]+)/.exec(content)?.[1]||null;
  if(launched)return{type:"agent_progress" as AgentLifecycleKind,content:"Running in the background.",status:"running",itemId:id,...time,metadata:{agentThreadId:id,agentId,kind:"launched",source:"provider"}};
  const failed=Boolean(part?.is_error);
  return{type:(failed?"agent_failed":"agent_completed") as AgentLifecycleKind,content:content||(failed?"Agent failed.":"Agent completed."),status:failed?"failed":"completed",itemId:id,...time,metadata:{agentThreadId:id,agentId,kind:"result",isError:failed,source:"provider"}};
}

function terminalStatus(status:string){
  if(FAILED_STATUSES.has(status))return"failed";
  if(STOPPED_STATUSES.has(status))return"interrupted";
  return"completed";
}

// task_started / task_progress / task_notification from `--output-format
// stream-json`. Background shell commands use the same records, so only ids
// already known as Agent calls become roster rows.
export function claudeAgentSystemEvent(event:any,agentToolIds:ReadonlySet<string>){
  if(event?.type!=="system")return null;
  const id=text(event.tool_use_id);
  if(!id||!agentToolIds.has(id))return null;
  const base={agentThreadId:id,agentId:text(event.task_id)||null,nativeType:event.type,subtype:event.subtype,usage:event.usage&&typeof event.usage==="object"?event.usage:undefined,source:"provider"};
  if(event.subtype==="task_started")return{type:"agent_progress" as AgentLifecycleKind,content:text(event.description)||"Agent started.",status:"running",itemId:id,metadata:{...base,kind:"started",prompt:text(event.prompt)||undefined}};
  if(event.subtype==="task_progress")return{type:"agent_progress" as AgentLifecycleKind,content:text(event.description)||(text(event.last_tool_name)?`Using ${text(event.last_tool_name)}`:"Agent working."),status:"running",itemId:id,metadata:{...base,kind:"progress",lastToolName:text(event.last_tool_name)||undefined}};
  if(event.subtype==="task_notification"){
    const status=terminalStatus(text(event.status).toLowerCase());
    return{type:(status==="completed"?"agent_completed":"agent_failed") as AgentLifecycleKind,content:text(event.summary)||`Agent ${status}.`,status,itemId:id,metadata:{...base,kind:"notification"}};
  }
  return null;
}

const tagValues=(source:string,tag:string)=>[...source.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`,"g"))].map(match=>match[1]!.trim()).filter(Boolean);

// The transcript records a background agent's end as a <task-notification>
// user row. It names the tool_use id directly, or, for a batch "stopped"
// notice, only the agent ids returned by the launch.
export function claudeAgentNotificationEvents(content:string,agentToolByAgentId:ReadonlyMap<string,string>,agentToolIds:ReadonlySet<string>,time:{timestamp?:string}={}){
  if(!content.startsWith("<task-notification>"))return[];
  const ids=new Set<string>();
  for(const id of tagValues(content,"tool-use-id"))if(agentToolIds.has(id))ids.add(id);
  if(!ids.size)for(const agentId of tagValues(content,"task-id")){const id=agentToolByAgentId.get(agentId);if(id)ids.add(id);}
  if(!ids.size)return[];
  const status=terminalStatus((tagValues(content,"status")[0]??"").toLowerCase());
  const summary=tagValues(content,"result")[0]||tagValues(content,"summary")[0]||`Agent ${status}.`;
  return[...ids].map(id=>({type:(status==="completed"?"agent_completed":"agent_failed") as AgentLifecycleKind,content:summary,status,itemId:id,...time,metadata:{agentThreadId:id,kind:"notification",source:"provider"}}));
}
