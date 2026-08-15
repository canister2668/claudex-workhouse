import type { AgentEvent, AgentEventKind, DeckTask } from "./types.js";
import { normalizeCodexChange, relativePathInfo } from "./diff.js";
import { isSensitiveKey, sanitizeSensitiveText, sanitizeSensitiveValue } from "./sensitive-data.js";
import {mergePersistedImageOutputs,persistedImageOutputEvents,persistedImageOutputsFromEvents} from "./image-outputs.js";
import {captureTaskImageOutput} from "./task-image-output.js";

export const MAX_EVENT_METADATA_BYTES = 8192;
const MAX_EVENT_CONTENT = 100000;
const EVENT_KINDS = new Set<AgentEventKind>(["task_started","turn_started","message_delta","message_completed","command_started","command_output","command_completed","file_change_started","file_change_completed","tool_started","tool_progress","tool_completed","agent_started","agent_progress","agent_completed","agent_failed","approval_required","approval_resolved","user_input_required","user_input_resolved","context_compaction","task_completed","task_failed","task_stopped","message","command","file_read","file_write","error","mcp_tool_call","mcp_tool_result","unknown"]);

function plainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// A collaboration turn only exposes the events its timeline can render, but Codex
// reports token usage solely on its own "unknown" notification events. Filtering by
// type alone therefore hid usage for every Codex turn while Claude's survived on
// message_completed. Usage carriers hold numbers-only metadata and never render, so
// they pass on their metadata instead of their type.
const collaborationPublicEventTypes = new Set(["message_delta","message_completed","command_started","command_completed","file_change_started","file_change_completed","tool_started","tool_progress","tool_completed","agent_started","agent_progress","agent_completed","agent_failed","mcp_tool_call","mcp_tool_result","approval_required","user_input_required","context_compaction","task_failed","task_stopped","error"]);
const carriesUsage = (event: any) => Boolean(event?.metadata?.outputUsage || event?.metadata?.contextUsage);
export function collaborationPublicEvents(events: any[]) {
  return events.filter(event =>
    (collaborationPublicEventTypes.has(event.type) || carriesUsage(event))
    && !(event.type === "tool_progress" && event.metadata?.deltaType === "thinking_delta")
    && !["reasoning","analysis"].includes(String(event.metadata?.phase ?? event.metadata?.section ?? "").toLowerCase()));
}

export function redactSensitiveText(value: string) {
  return sanitizeSensitiveText(value,{preserveSourceIdentifiers:true});
}

function sanitizeJson(value: unknown, key = "", depth = 0): unknown {
  if (isSensitiveKey(key) || key === "environment" || key === "env") return "[REDACTED]";
  if (depth > 6) return "[TRUNCATED]";
  return sanitizeSensitiveValue(value,{maxDepth:6-depth,maxEntries:100,maxStringLength:2000,preserveSourceIdentifiers:true});
}

export function sanitizeEventMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!plainObject(value)) return undefined;
  try {
    if (Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_EVENT_METADATA_BYTES) return { truncated: true };
  } catch {
    return { truncated: true };
  }
  const sanitized = sanitizeJson(value) as Record<string, unknown>;
  if (Buffer.byteLength(JSON.stringify(sanitized), "utf8") > MAX_EVENT_METADATA_BYTES) return { truncated: true };
  return sanitized;
}

export function normalizeAgentEvent(value: unknown, fallbackProvider?: DeckTask["provider"]): AgentEvent {
  const source = plainObject(value) ? value : {};
  const type = typeof source.type === "string" && EVENT_KINDS.has(source.type as AgentEventKind) ? source.type as AgentEventKind : "unknown";
  const event: AgentEvent = {
    type,
    content: redactSensitiveText(typeof source.content === "string" ? source.content : String(source.content ?? "Unsupported event payload.")).slice(0, MAX_EVENT_CONTENT)
  };
  const provider = source.provider === "codex" || source.provider === "claude" ? source.provider : fallbackProvider;
  if (provider) event.provider = provider;
  for (const key of ["serverName", "toolName", "status", "timestamp"] as const) {
    if (typeof source[key] === "string") event[key] = redactSensitiveText(source[key]).slice(0, 200);
  }
  const metadata = sanitizeEventMetadata(source.metadata);
  if (metadata) event.metadata = metadata;
  return event;
}

export function taskEvents(task: DeckTask): AgentEvent[] {
  if (task.events?.length) return task.events.map((event) => normalizeAgentEvent(event, task.provider));
  const events: AgentEvent[] = [];
  if (task.prompt) events.push(normalizeAgentEvent({ type: "message", content: task.prompt, status: task.status, timestamp: task.createdAt, metadata: { role: "user", section: "request" } }, task.provider));
  if (task.log) events.push(normalizeAgentEvent({ type: "unknown", content: task.log, status: task.status, timestamp: task.updatedAt, metadata: { section: "log" } }, task.provider));
  events.push(...persistedImageOutputEvents(task.metadata?.imageOutputs));
  if (task.result) events.push(normalizeAgentEvent({ type: "message", content: task.result, status: task.status, timestamp: task.updatedAt, metadata: { role: "agent", section: "result", ...(task.metadata?.grounding?{grounding:task.metadata.grounding}:{}) } }, task.provider));
  if (task.error) events.push(normalizeAgentEvent({ type: "error", content: task.error, status: task.status, timestamp: task.updatedAt, metadata: { section: "error" } }, task.provider));
  return events;
}

export function providerThreadEvents(turns:Array<{task:DeckTask;events:AgentEvent[]}>,limit=1500){
  const ordered=[...turns].sort((left,right)=>left.task.createdAt.localeCompare(right.task.createdAt)||left.task.id.localeCompare(right.task.id));
  const result:AgentEvent[]=[];
  for(const {task,events} of ordered){
    if(!events.length){result.push(...taskEvents(task));continue;}
    const hasPrompt=events.some(event=>event.type==="message"&&event.metadata?.role==="user"&&event.content.trim()===task.prompt.trim());
    if(task.prompt&&!hasPrompt){
      const prompt=normalizeAgentEvent({type:"message",content:task.prompt,status:task.status,timestamp:task.createdAt,metadata:{role:"user",sourceTaskId:task.id}},task.provider);
      result.push({...prompt,taskId:task.id} as AgentEvent);
    }
    result.push(...events);
  }
  const boundedLimit=Math.max(1,limit);
  if(result.length<=boundedLimit)return result;
  const eventTask=(event:AgentEvent)=>String((event as AgentEvent&{taskId?:string}).taskId??event.metadata?.sourceTaskId??"");
  const outputCall=(event:AgentEvent)=>String((event as AgentEvent&{itemId?:string|null}).itemId??event.metadata?.itemId??event.metadata?.outputCallId??"");
  const completedCalls=new Set(result.filter(event=>event.type==="message_completed").map(event=>`${eventTask(event)}:${outputCall(event)}`).filter(key=>!key.endsWith(":")));
  const cardEvent=(event:AgentEvent)=>event.type==="message"&&event.metadata?.role==="user"
    ||event.type==="message_completed"
    ||event.type==="message_delta"&&!completedCalls.has(`${eventTask(event)}:${outputCall(event)}`)
    ||event.type==="context_compaction"
    ||event.type==="error"||event.type==="task_failed"||event.type==="task_stopped"
    ||event.metadata?.mediaKind==="image";
  const essential=new Set(result.map((event,index)=>cardEvent(event)?index:-1).filter(index=>index>=0));
  // Grok can emit thousands of thinking/tool updates in one turn. A raw tail
  // slice lets that newest process log evict every earlier request and answer,
  // leaving a reopened session with no input/output cards. Reserve the bounded
  // window for conversation rows first, then spend the remainder on the newest
  // process events while preserving their original order.
  if(essential.size>=boundedLimit)return result.filter((_event,index)=>essential.has(index)).slice(-boundedLimit);
  let remaining=boundedLimit-essential.size;
  for(let index=result.length-1;index>=0&&remaining>0;index--)if(!essential.has(index)){essential.add(index);remaining--;}
  return result.filter((_event,index)=>essential.has(index));
}

export function codexTurnEvents(turns: any[], cwd?: string | null,imageContext?:{root:string;taskId:string;threadId:string|null}): AgentEvent[] {
  const events:AgentEvent[]=[];
  for(const turn of [...turns].reverse())for(const item of turn.items??[]){
    if(item.type==="userMessage")events.push(normalizeAgentEvent({type:"message",content:(item.content??[]).map((part:any)=>part.text??"").filter(Boolean).join("\n"),status:turn.status,metadata:{role:"user",turnId:turn.id,itemId:item.id}},"codex"));
    else if(item.type==="agentMessage")events.push(normalizeAgentEvent({type:"message_completed",content:item.text??"",status:turn.status,metadata:{role:"agent",phase:item.phase,turnId:turn.id,itemId:item.id}},"codex"));
    else if(item.type==="commandExecution"){const exitCode=Number.isFinite(item.exitCode)?Number(item.exitCode):null,ok=exitCode!==null?exitCode===0:item.status==="completed"?true:item.status==="failed"?false:null;events.push(normalizeAgentEvent({type:"command_completed",content:item.aggregatedOutput??item.command??"",status:item.status,metadata:{command:item.command,exitCode,ok,source:"provider",turnId:turn.id,itemId:item.id}},"codex"));}
    else if(item.type==="fileChange")for(const change of Array.isArray(item.changes)?item.changes:[]){const d=normalizeCodexChange(change,cwd);events.push(normalizeAgentEvent({type:"file_change_started",content:d.text,status:item.status,metadata:{path:d.path,pathBase:d.pathBase,tool:"codex",additions:d.additions,deletions:d.deletions,kind:d.kind,turnId:turn.id,itemId:item.id}},"codex"));}
    else if(item.type==="mcpToolCall")events.push(normalizeAgentEvent({type:"mcp_tool_result",content:item.error?.message??JSON.stringify(item.result??item.arguments??{}),status:item.status,serverName:item.server,toolName:item.tool,metadata:{turnId:turn.id,itemId:item.id}},"codex"));
    else if(item.type==="collabAgentToolCall")events.push(normalizeAgentEvent({type:item.status==="completed"?"agent_completed":item.status==="failed"?"agent_failed":"agent_started",content:item.prompt??item.tool??"Parallel agent",status:item.status,metadata:{itemType:item.type,tool:item.tool,senderThreadId:item.senderThreadId,receiverThreadIds:item.receiverThreadIds,prompt:item.prompt,model:item.model,reasoningEffort:item.reasoningEffort,agentsStates:item.agentsStates,turnId:turn.id,itemId:item.id}},"codex"));
    else if(item.type==="subAgentActivity")events.push(normalizeAgentEvent({type:"agent_progress",content:item.kind??"Subagent activity",status:item.status,metadata:{itemType:item.type,kind:item.kind,agentThreadId:item.agentThreadId,agentPath:item.agentPath,turnId:turn.id,itemId:item.id}},"codex"));
    else if(item.type==="imageView"||item.type==="imageGeneration"){
      const nativePath=item.type==="imageView"?item.path:item.savedPath,resolved=relativePathInfo(nativePath,cwd);
      const generated=item.type==="imageGeneration"&&imageContext?captureTaskImageOutput({...imageContext,item}):{};
      events.push(normalizeAgentEvent({type:"tool_completed",content:item.type,status:item.status,metadata:{itemType:item.type,turnId:turn.id,itemId:item.id,...(resolved.pathBase==="task-cwd"?{mediaKind:"image",mediaPath:resolved.path,mediaPathBase:resolved.pathBase}:generated)}},"codex"));
    }
    else if(item.type==="webSearch")events.push(normalizeAgentEvent({type:"tool_completed",content:item.query??"Web search",status:item.status,metadata:{itemType:item.type,turnId:turn.id,itemId:item.id}},"codex"));
    else if(item.type==="contextCompaction")events.push(normalizeAgentEvent({type:"context_compaction",content:"Context compacted.",status:turn.status,metadata:{turnId:turn.id,itemId:item.id}},"codex"));
    else events.push(normalizeAgentEvent({type:"unknown",content:JSON.stringify(item),status:turn.status,metadata:{itemType:item.type,turnId:turn.id,itemId:item.id}},"codex"));
  }
  return events.filter((event)=>event.content.length>0);
}

export function mergeHistoricalFileChanges(history:AgentEvent[],replay:AgentEvent[]){
  const filePath=(event:AgentEvent)=>event.type==="file_change_started"||event.type==="file_change_completed"?String(event.metadata?.path??""):"";
  const present=new Set(history.map(filePath).filter(Boolean)),missingPaths=new Set(replay.map(filePath).filter(value=>value&&!present.has(value)));
  const eventItemId=(event:AgentEvent)=>String((event as AgentEvent&{itemId?:string|null}).itemId??event.metadata?.itemId??"");
  const eventTurnId=(event:AgentEvent)=>String((event as AgentEvent&{turnId?:string|null}).turnId??event.metadata?.turnId??"");
  const eventTaskId=(event:AgentEvent)=>String((event as AgentEvent&{taskId?:string|null}).taskId??event.metadata?.sourceTaskId??"");
  const imageOutput=(event:AgentEvent)=>event.metadata?.mediaKind==="image"&&typeof event.metadata.mediaPath==="string"&&Boolean(event.metadata.mediaPath.trim())&&(event.metadata.mediaPathBase==="workspace"||event.metadata.mediaPathBase==="task-cwd"||event.metadata.mediaPathBase==="task-output");
  const imageKey=(event:AgentEvent)=>{
    const turnId=eventTurnId(event),scope=turnId?`turn:${turnId}`:`task:${eventTaskId(event)}`;
    return`path:${scope}:${String(event.metadata?.mediaPathBase??"")}:${String(event.metadata?.mediaPath??"")}`;
  };
  const contextKey=(event:AgentEvent)=>{
    if(event.type!=="context_compaction")return"";
    const source=event as AgentEvent&{threadId?:string|null;itemId?:string|null};
    const threadId=String(source.threadId??event.metadata?.threadId??"");
    const itemId=String(source.itemId??event.metadata?.itemId??"");
    if(itemId)return`item:${threadId}:${itemId}`;
    if(event.timestamp)return`time:${threadId}:${event.timestamp}:${String(event.metadata?.trigger??"")}`;
    return"";
  };
  const seenCompactions=new Set(history.map(contextKey).filter(Boolean));
  const missingCompactions=replay.filter((event)=>{
    if(event.type!=="context_compaction")return false;
    const key=contextKey(event);
    if(key&&seenCompactions.has(key))return false;
    if(key)seenCompactions.add(key);
    return true;
  });
  const usageKey=(event:AgentEvent)=>{
    if(event.type!=="unknown"||!event.metadata?.outputUsage||typeof event.metadata.outputUsage!=="object")return"";
    const usage=event.metadata.outputUsage as Record<string,unknown>;
    return[
      String(event.metadata.nativeMethod??""),
      String((event as AgentEvent&{threadId?:string|null}).threadId??event.metadata.threadId??""),
      String(usage.updatedAt??event.timestamp??""),
      String(usage.totalTokens??""),
      String(usage.inputTokens??""),
      String(usage.cachedInputTokens??""),
      String(usage.cacheWriteInputTokens??""),
      String(usage.outputTokens??""),
      String(usage.reasoningTokens??"")
    ].join(":");
  };
  const seenUsage=new Set(history.map(usageKey).filter(Boolean));
  const missingUsage=replay.filter((event)=>{
    const key=usageKey(event);
    if(!key||seenUsage.has(key))return false;
    seenUsage.add(key);
    return true;
  });
  let merged=history;
  const historyImageKeys=new Set<string>();
  const uniqueHistory=history.filter(event=>{
    if(!imageOutput(event))return true;
    const key=imageKey(event);if(historyImageKeys.has(key))return false;
    historyImageKeys.add(key);return true;
  });
  if(uniqueHistory.length!==history.length)merged=uniqueHistory;
  const missingImages:AgentEvent[]=[],seenImageKeys=new Set<string>();
  for(const image of replay.filter(imageOutput)){
    const key=imageKey(image);if(seenImageKeys.has(key))continue;seenImageKeys.add(key);
    const itemId=eventItemId(image),turnId=eventTurnId(image);
    const match=merged.findIndex(event=>imageOutput(event)&&imageKey(event)===key||(itemId&&eventItemId(event)===itemId&&(!turnId||!eventTurnId(event)||eventTurnId(event)===turnId)));
    if(match>=0){
      if(!imageOutput(merged[match]!)){
        const current=merged[match]!;
        if(merged===history)merged=[...history];
        const media=mergePersistedImageOutputs(persistedImageOutputsFromEvents([image]))[0];
        if(media)merged[match]={...current,metadata:{...current.metadata,mediaKind:"image",mediaPath:media.mediaPath,mediaPathBase:media.mediaPathBase,sourceTaskId:media.sourceTaskId,mediaWorkspaceId:media.workspaceId}};
      }
      continue;
    }
    const knownTurnIds=new Set(merged.map(eventTurnId).filter(Boolean)),knownTaskIds=new Set(merged.map(eventTaskId).filter(Boolean));
    const sourceTaskId=eventTaskId(image),turnIsVisible=Boolean(turnId&&knownTurnIds.has(turnId)),taskIsVisible=Boolean(sourceTaskId&&knownTaskIds.has(sourceTaskId));
    // Durable thread metadata can outlive the bounded provider-history page.
    // If neither the source turn nor source task is present, inserting the
    // orphan before the last completed message makes an old image appear to
    // belong to the newest answer on every refresh. Leave it out until its
    // actual history page is present; never manufacture a new attachment.
    if((turnId||sourceTaskId)&&(knownTurnIds.size||knownTaskIds.size)&&!turnIsVisible&&!taskIsVisible)continue;
    missingImages.push(image);
  }
  if(!missingPaths.size&&!missingCompactions.length&&!missingUsage.length&&!missingImages.length&&merged===history)return history;
  if(missingPaths.size){
    const missing=replay.filter(event=>missingPaths.has(filePath(event)));
    let insertAt=merged.length;
    for(let index=merged.length-1;index>=0;index--)if(merged[index]?.type==="message_completed"){insertAt=index;break;}
    merged=[...merged.slice(0,insertAt),...missing,...merged.slice(insertAt)];
  }
  // App-server history may retain an image tool item but omit its local path,
  // or omit the item entirely after compaction. The worker replay owns the
  // bounded task-relative path, so restore it beside the output from the same
  // turn instead of dropping it during completed-session reconciliation.
  for(const image of missingImages){
    const turnId=eventTurnId(image),sourceTaskId=eventTaskId(image);
    let insertAt=turnId?merged.findIndex(event=>eventTurnId(event)===turnId&&event.type==="message_completed"&&event.metadata?.phase==="final_answer"):-1;
    if(insertAt<0&&turnId)for(let index=merged.length-1;index>=0;index--)if(eventTurnId(merged[index]!)===turnId){insertAt=index+1;break;}
    if(insertAt<0&&sourceTaskId){
      const sourceIndex=merged.findIndex(event=>eventTaskId(event)===sourceTaskId);
      if(sourceIndex>=0){
        const nextTask=merged.findIndex((event,index)=>index>sourceIndex&&eventTaskId(event)&&eventTaskId(event)!==sourceTaskId);
        if(nextTask>=0)insertAt=nextTask;
        else{
          const finalIndex=merged.findIndex((event,index)=>index>sourceIndex&&event.type==="message_completed");
          insertAt=finalIndex>=0?finalIndex:merged.length;
        }
      }
    }
    if(insertAt<0&&image.timestamp){
      const imageTime=Date.parse(image.timestamp);
      if(Number.isFinite(imageTime)){
        const later=merged.findIndex(event=>{const eventTime=Date.parse(event.timestamp??"");return Number.isFinite(eventTime)&&eventTime>imageTime;});
        insertAt=later>=0?later:merged.length;
      }
    }
    if(insertAt<0)for(let index=merged.length-1;index>=0;index--)if(merged[index]?.type==="message_completed"){insertAt=index;break;}
    if(insertAt<0)insertAt=merged.length;
    merged=[...merged.slice(0,insertAt),image,...merged.slice(insertAt)];
  }
  for(const boundary of missingCompactions){
    const boundaryTime=Date.parse(boundary.timestamp??"");
    const laterIndex=Number.isFinite(boundaryTime)?merged.findIndex((event)=>{
      const eventTime=Date.parse(event.timestamp??"");
      return Number.isFinite(eventTime)&&eventTime>boundaryTime;
    }):-1;
    const insertAt=laterIndex>=0?laterIndex:merged.length;
    merged=[...merged.slice(0,insertAt),boundary,...merged.slice(insertAt)];
  }
  // Completed provider transcripts contain the visible conversation but omit
  // the worker's usage notifications. Keep those non-visual replay events so
  // token totals remain exact after the live stream closes or the page reloads.
  // Do not retain replay message events here: the transcript already owns them.
  if(missingUsage.length)merged=[...merged,...missingUsage];
  return merged;
}

export function mergeActiveClaudeThreadEvents(transcript:AgentEvent[],replay:AgentEvent[],task:Pick<DeckTask,"id"|"prompt"|"createdAt"|"status">){
  const cutoff=Date.parse(task.createdAt);
  // Claude appends the current turn to the shared transcript after the task row
  // is created. Keep only earlier turns here; the current turn comes from the
  // live spool and would otherwise be rendered twice.
  const history=transcript.filter(event=>{
    const timestamp=Date.parse(event.timestamp??"");
    return !Number.isFinite(cutoff)||!Number.isFinite(timestamp)||timestamp<cutoff;
  });
  // The request row carries the task it belongs to, exactly like the one
  // providerThreadEvents synthesizes. Without that identity an optimistic copy
  // of the same prompt in the browser cannot be recognised as the same row, and
  // the turn ends up with two request cards in two different places.
  const prompt=normalizeAgentEvent({type:"message",content:task.prompt,status:task.status,timestamp:task.createdAt,metadata:{role:"user",section:"request"}},"claude");
  // The transcript reader already applies its bounded, turn-aligned event
  // budget. Slicing the merged array here could silently cut through the first
  // retained turn again when the current replay is tool-heavy.
  return[...history,{...prompt,taskId:task.id} as AgentEvent,...replay];
}

// Completed provider history owns the visible request, while the worker replay
// owns the Workhouse task identity. Join those two views before the browser
// reconciles them: provider-native history timestamps are not the task creation
// timestamp, so time/content keys alone cannot identify the same request.
export function withTaskRequestIdentity(
  history:AgentEvent[],
  replay:AgentEvent[],
  task:Pick<DeckTask,"id"|"prompt"|"createdAt">
){
  const prompt=task.prompt.trim();
  if(!prompt)return history;
  const request=(event:AgentEvent)=>event.type==="message"&&event.metadata?.role==="user"&&event.content.trim()===prompt;
  const turnId=(event:AgentEvent)=>String((event as AgentEvent&{turnId?:string|null}).turnId??event.metadata?.turnId??"");
  const replayTurn=replay.find(event=>event.type==="turn_started"&&turnId(event))??replay.find(event=>turnId(event));
  const currentTurn=replayTurn?turnId(replayTurn):"";
  let match=currentTurn?history.findIndex(event=>request(event)&&turnId(event)===currentTurn):-1;
  if(match<0){
    const taskTime=Date.parse(task.createdAt),windowMs=10*60_000;
    let distance=Number.POSITIVE_INFINITY;
    for(let index=0;index<history.length;index++){
      const event=history[index]!;if(!request(event))continue;
      const eventTime=Date.parse(event.timestamp??"");
      if(!Number.isFinite(taskTime)||!Number.isFinite(eventTime))continue;
      const candidate=Math.abs(eventTime-taskTime);
      if(candidate<=windowMs&&candidate<distance){match=index;distance=candidate;}
    }
  }
  if(match<0){
    const candidates=history.map((event,index)=>request(event)?index:-1).filter(index=>index>=0);
    if(candidates.length===1)match=candidates[0]!;
  }
  if(match<0||(history[match] as AgentEvent&{taskId?:string}|undefined)?.taskId===task.id)return history;
  const identified=[...history];identified[match]={...identified[match]!,taskId:task.id} as AgentEvent;return identified;
}
