import type { AgentEvent } from "./events";
import { assertUniqueKeys } from "./identity-selectors";
import { translate } from "./i18n";

export type DisplayEvent = AgentEvent & { _stream?: boolean };
export type ConversationTimelineBlock =
  | { kind:"process"; id:string; events:DisplayEvent[]; active:boolean }
  | { kind:"event"; id:string; event:DisplayEvent };
export type ConversationTurn = {
  id: string;
  request: DisplayEvent[];
  process: DisplayEvent[];
  result: DisplayEvent[];
  timeline: ConversationTimelineBlock[];
  active: boolean;
  outputUsage: TurnOutputUsage | null;
};
export type TurnOutputUsage = {
  tokens: number;
  exact: boolean;
  inputTokens: number | null;
  outputTokens: number;
  cachedInputTokens: number | null;
  cacheWriteInputTokens: number | null;
  reasoningTokens: number | null;
  requestCount: number | null;
  updatedAt: string | null;
};
// Cache reads are the only discounted leg, so "billable" counts everything the
// turn actually burned: fresh input, cache writes, and output. The cached total
// stays out of it and is reframed as the reason the billable number is small.
export type TurnUsageSummary={
  billable:number|null;billableInput:number|null;output:number;reasoning:number|null;
  cacheRead:number|null;cacheWrite:number|null;savedPercent:number|null;
  processed:number|null;requestCount:number|null;exact:boolean;
};

export function turnUsageLabelKey(usage:TurnOutputUsage){
  return usage.exact?"tokens.answerExact":"tokens.answerEstimated";
}

export function processedUsageTokens(usage:TurnOutputUsage){
  return usage.inputTokens===null?null:Math.max(0,usage.inputTokens)+Math.max(0,usage.outputTokens);
}

export function turnUsageSummary(usage:TurnOutputUsage):TurnUsageSummary{
  const output=Math.max(0,usage.outputTokens);
  const input=usage.inputTokens===null?null:Math.max(0,usage.inputTokens);
  const cacheRead=usage.cachedInputTokens===null?null:Math.max(0,usage.cachedInputTokens);
  const cacheWrite=usage.cacheWriteInputTokens===null?null:Math.max(0,usage.cacheWriteInputTokens);
  const billableInput=input===null?null:Math.max(0,input-(cacheRead??0));
  return{
    billable:billableInput===null?null:billableInput+output,
    billableInput,
    output,
    reasoning:usage.reasoningTokens===null?null:Math.max(0,usage.reasoningTokens),
    cacheRead,
    cacheWrite,
    savedPercent:input&&cacheRead?Math.round((cacheRead/input)*100):null,
    processed:processedUsageTokens(usage),
    requestCount:usage.requestCount===null?null:Math.max(0,usage.requestCount),
    exact:usage.exact
  };
}

export function persistedTurnOutputUsage(value:unknown):TurnOutputUsage|null{
  if(!value||typeof value!=="object")return null;
  const item=value as Record<string,unknown>,finite=(raw:unknown)=>{const number=Number(raw);return raw!==null&&raw!==undefined&&Number.isFinite(number)&&number>=0?number:null;};
  const outputTokens=finite(item.outputTokens);
  if(outputTokens===null)return null;
  const inputTokens=finite(item.inputTokens),reportedTotal=finite(item.totalTokens);
  return{
    tokens:inputTokens===null?reportedTotal??outputTokens:inputTokens+outputTokens,
    exact:true,
    inputTokens,
    outputTokens,
    cachedInputTokens:finite(item.cachedInputTokens),
    cacheWriteInputTokens:finite(item.cacheWriteInputTokens),
    reasoningTokens:finite(item.reasoningTokens),
    requestCount:finite(item.requestCount),
    updatedAt:typeof item.updatedAt==="string"?item.updatedAt:null
  };
}

export function restoreLatestTurnOutputUsage(turns:ConversationTurn[],persisted:unknown):ConversationTurn[]{
  const stored=persistedTurnOutputUsage(persisted);
  if(!stored||!turns.length||turns.at(-1)?.outputUsage?.exact)return turns;
  return turns.map((turn,index)=>index===turns.length-1?{...turn,outputUsage:stored}:turn);
}

export function aggregateTurnOutputUsage(usages:ReadonlyArray<TurnOutputUsage>):TurnOutputUsage|null{
  if(!usages.length)return null;
  const inputComplete=usages.every(usage=>usage.inputTokens!==null);
  const sumOptional=(field:"cachedInputTokens"|"cacheWriteInputTokens"|"reasoningTokens"|"requestCount")=>{
    const values=usages.map(usage=>usage[field]).filter((value):value is number=>value!==null);
    return values.length?values.reduce((sum,value)=>sum+Math.max(0,value),0):null;
  };
  const outputTokens=usages.reduce((sum,usage)=>sum+Math.max(0,usage.outputTokens),0);
  const inputTokens=inputComplete?usages.reduce((sum,usage)=>sum+Math.max(0,usage.inputTokens??0),0):null;
  return{
    tokens:inputTokens===null?outputTokens:inputTokens+outputTokens,
    exact:usages.every(usage=>usage.exact),
    inputTokens,
    outputTokens,
    cachedInputTokens:inputComplete?sumOptional("cachedInputTokens"):null,
    cacheWriteInputTokens:inputComplete?sumOptional("cacheWriteInputTokens"):null,
    reasoningTokens:sumOptional("reasoningTokens"),
    requestCount:sumOptional("requestCount"),
    updatedAt:usages.map(usage=>usage.updatedAt).filter((value):value is string=>Boolean(value)).sort().at(-1)??null
  };
}

export type QuotaObservationRange={startPct:number;endPct:number};
export function observedQuotaRange(events:ReadonlyArray<DisplayEvent>,durationMins:number):QuotaObservationRange|null{
  const points:Array<{pct:number;at:number;order:number}>=[];
  for(const event of events){
    if(event.metadata?.nativeMethod!=="account/rateLimits/updated")continue;
    const payload=(event.metadata as any)?.payload,limits=payload?.rateLimits;
    const windows=[limits?.primary,limits?.secondary].filter((window:any)=>window&&Number(window.windowDurationMins)===durationMins);
    for(const window of windows){
      const pct=Number(window.usedPercent);
      if(Number.isFinite(pct)&&pct>=0&&pct<=100){
        const parsed=typeof event.timestamp==="string"?Date.parse(event.timestamp):NaN;
        points.push({pct,at:Number.isFinite(parsed)?parsed:Number.MAX_SAFE_INTEGER,order:points.length});
      }
    }
  }
  if(!points.length)return null;
  points.sort((left,right)=>left.at-right.at||left.order-right.order);
  return{startPct:points[0]!.pct,endPct:points.at(-1)!.pct};
}
export type ProcessEventGroup = {
  kind:"group";
  id:string;
  group:"command"|"file"|"tool"|"hook"|"usage"|"internal";
  label:string;
  events:DisplayEvent[];
  latest:string;
  failed:boolean;
};
export type ProcessEventRow = { kind:"event"; id:string; event:DisplayEvent } | ProcessEventGroup;
export type CollaborationProcessRow = { id:string; event:DisplayEvent; summary:string };
export type CollaborationTurnPresentation = { process:CollaborationProcessRow[]; final:DisplayEvent|null; failed:boolean };

const AGENT_EVENTS = new Set(["agent_started","agent_progress","agent_completed","agent_failed"]);
const SHORT_AGENT_NAMES=["Ada","Ben","Cora","Dean","Ella","Finn","Gina","Hugo","Iris","Jack","Kara","Liam","Maya","Noah","Owen","Ruby"] as const;
export const isParallelAgentEvent = (event: AgentEvent) => AGENT_EVENTS.has(event.type);
const cleanNativeString=(value:unknown)=>typeof value==="string"&&!['','undefined','null'].includes(value.trim())?value.trim():"";
export const compactAgentId=(value:string)=>value.replace(/[^A-Za-z0-9]/g,"").slice(-6)||value.slice(-6);
export function shortAgentName(index:number){const safe=Math.max(0,Math.floor(index)),base=SHORT_AGENT_NAMES[safe%SHORT_AGENT_NAMES.length],cycle=Math.floor(safe/SHORT_AGENT_NAMES.length);return cycle?`${base} ${cycle+1}`:base;}


const processGroupLabel=(group:ProcessEventGroup["group"])=>translate(`process.group.${group}`);
// Operational folds always occupy the same slots. In particular the three
// noisy provider-internal groups stay above command/file/tool activity, so a
// newly arriving event can update a summary without moving the surrounding UI.
const PROCESS_GROUP_ORDER:ProcessEventGroup["group"][]=["usage","hook","internal","command","file","tool"];

function nativeMethod(event:AgentEvent){
  if(typeof event.metadata?.nativeMethod==="string")return event.metadata.nativeMethod;
  if(event.metadata?.nativeType==="system"){
    if(event.metadata?.subtype==="hook_started")return"hook/started";
    if(event.metadata?.subtype==="hook_response")return"hook/completed";
  }
  return"";
}
function processGroup(event:AgentEvent):ProcessEventGroup["group"]|null{
  const method=nativeMethod(event);
  if(method.startsWith("hook/"))return "hook";
  if(["command_started","command_output","command_completed","command"].includes(event.type))return "command";
  if(["file_change_started","file_change_completed","file_write"].includes(event.type))return "file";
  if(["tool_started","tool_progress","tool_completed","mcp_tool_call","mcp_tool_result","file_read"].includes(event.type))return "tool";
  if(event.type==="context_compaction")return null;
  if(event.type!=="unknown")return null;
  if(method==="thread/tokenUsage/updated"||method==="claude/contextUsage/updated"||method==="claude/outputUsage/updated"||method==="account/rateLimits/updated")return "usage";
  return "internal";
}

export function compactText(value:unknown,max=110){
  const text=String(value??"").replace(/\s+/g," ").trim();
  return text.length>max?`${text.slice(0,max-1)}…`:text;
}

function fileChangeSummary(event:AgentEvent){
  const metadata=event.metadata??{};
  const changes=Array.isArray(metadata.changes)?metadata.changes.filter((change):change is Record<string,unknown>=>Boolean(change)&&typeof change==="object"):[];
  const latest=changes.at(-1);
  const path=String(metadata.path??latest?.path??latest?.file??latest?.filePath??"").trim();
  const additions=Number(metadata.additions);
  const deletions=Number(metadata.deletions);
  const stats=[Number.isFinite(additions)&&additions>0?`+${additions}`:"",Number.isFinite(deletions)&&deletions>0?`-${deletions}`:""].filter(Boolean).join(" ");
  const target=path||(changes.length?translate("process.fileCount",{count:changes.length}):translate("conversation.file"));
  return translate("process.fileChanged",{target,others:changes.length>1&&path?translate("process.otherFiles",{count:changes.length-1}):"",stats:stats?` · ${stats}`:""});
}

export function processEventSummary(event:AgentEvent){
  const method=nativeMethod(event);
  const payload=event.metadata?.payload&&typeof event.metadata.payload==="object"?event.metadata.payload as Record<string,any>:{};
  if(method.startsWith("hook/")){
    const run=payload.run&&typeof payload.run==="object"?payload.run as Record<string,any>:{};
    const name=String(run.eventName??"hook");
    const status=String(run.status??(method.endsWith("completed")?"completed":"running"));
    const statusLabel=["completed","running","failed"].includes(status)?translate(`task.status.${status}`):status;
    const hasDuration=run.durationMs!==null&&run.durationMs!==undefined&&Number.isFinite(Number(run.durationMs));
    return `${name} · ${statusLabel}${hasDuration?` · ${run.durationMs}ms`:""}`;
  }
  if(method==="account/rateLimits/updated"){
    const limit=payload.rateLimits?.primary;
    const duration=Number(limit?.windowDurationMins);
    const label=duration===10080?translate("quota.weekly"):duration===300?translate("quota.fiveHours"):translate("quota.label");
    const hasUsage=limit?.usedPercent!==null&&limit?.usedPercent!==undefined&&Number.isFinite(Number(limit.usedPercent));
    return hasUsage?translate("quota.usage",{label,value:limit.usedPercent}):translate("quota.updated");
  }
  if(method==="thread/tokenUsage/updated"||method==="claude/contextUsage/updated"||method==="claude/outputUsage/updated")return translate("context.usageUpdated");
  if(method==="thread/status/changed")return translate("session.statusChanged",{status:payload.status?.type??translate("common.changed")});
  if(event.type.startsWith("command_")||event.type==="command")return compactText(event.metadata?.command??event.content) || translate("process.commandRan");
  if(event.type.startsWith("file_change_")||event.type==="file_write")return fileChangeSummary(event);
  if(event.type.startsWith("tool_")||event.type.startsWith("mcp_")||event.type==="file_read")return compactText([event.serverName,event.toolName,event.content].filter(Boolean).join(" · "))||translate("process.toolRan");
  if(event.type==="context_compaction")return translate("context.compacted");
  return compactText(method||event.content)||translate("event.internal");
}

function processEventFailed(event:AgentEvent){
  const payload=event.metadata?.payload&&typeof event.metadata.payload==="object"?event.metadata.payload as Record<string,any>:{};
  return event.status==="failed"||payload.run?.status==="failed";
}

function eventRowIdentity(event:AgentEvent){
  const sequence=Number(event.sequence);
  if(Number.isSafeInteger(sequence)&&sequence>=0)return `event:sequence:${sequence}`;
  if(event.eventId)return `event:id:${event.eventId}`;
  const operation=collaborationOperation(event),nativeId=String(event.itemId??event.metadata?.itemId??"");
  if(operation&&nativeId)return `${operation}:item:${nativeId}`;
  return `event:fallback:${event.type}:${event.threadId??""}:${event.turnId??""}:${nativeId}:${event.timestamp??""}:${event.content??""}`;
}

// Keep conversationally important rows in place. Repetitive operational
// events become one folded group per kind, with the newest activity in the
// summary; expanding the group still exposes the complete diagnostic trail.
export function groupProcessEvents(events:DisplayEvent[]):ProcessEventRow[]{
  const rows:ProcessEventRow[]=[];
  const groups=new Map<ProcessEventGroup["group"],ProcessEventGroup>();
  for(const event of events){
    const group=processGroup(event);
    if(!group){const id=eventRowIdentity(event),index=rows.findIndex(row=>row.id===id);if(index<0)rows.push({kind:"event",id,event});else rows[index]={kind:"event",id,event};continue;}
    const existing=groups.get(group);
    if(existing){existing.events.push(event);existing.latest=processEventSummary(event);existing.failed ||= processEventFailed(event);continue;}
    const created:ProcessEventGroup={kind:"group",id:`group-${group}`,group,label:processGroupLabel(group),events:[event],latest:processEventSummary(event),failed:processEventFailed(event)};
    groups.set(group,created);
  }
  return [...PROCESS_GROUP_ORDER.flatMap(group=>groups.has(group)?[groups.get(group)!]:[]),...rows];
}

const HIDDEN = new Set(["turn_started", "task_started"]);
const isUser = (event: DisplayEvent) => event.type === "message" && event.metadata?.role === "user";
const isAssistant = (event: DisplayEvent) => event.type === "message_completed" || (event.type === "message" && event.metadata?.role === "agent");
export const isRootThreadEvent = (event: Pick<AgentEvent,"threadId">, rootThreadId:string|null|undefined) => !rootThreadId || !event.threadId || event.threadId === rootThreadId;
const isRootUserEvent = (event: DisplayEvent,rootThreadId:string|null|undefined) => isUser(event) && isRootThreadEvent(event,rootThreadId);
export const isRootAssistantEvent = (event: DisplayEvent, rootThreadId:string|null|undefined) => isAssistant(event) && isRootThreadEvent(event,rootThreadId);
// Codex labels final and commentary messages explicitly. Other providers can
// omit phase metadata, so only their last root assistant message before the
// terminal task event is treated as final output.
export const isFinalAssistantOutput=(event:DisplayEvent,rootThreadId:string|null|undefined,events:DisplayEvent[]=[event],taskSettled=false)=>{
  if(event.type!=="message_completed"||!isRootAssistantEvent(event,rootThreadId))return false;
  const phase=String(event.metadata?.phase??"");
  if(phase==="final_answer"||event.metadata?.section==="result")return true;
  const nativeType=String(event.metadata?.nativeType??"");
  if(phase||nativeType&&nativeType!=="assistant")return false;
  const identity=eventRowIdentity(event);
  const index=events.findIndex(candidate=>candidate===event||eventRowIdentity(candidate)===identity);if(index<0)return false;
  const nextTerminal=events.findIndex((candidate,candidateIndex)=>candidateIndex>index&&candidate.type==="task_completed");
  const end=nextTerminal>=0?nextTerminal:taskSettled?events.length:-1;
  if(end<0)return false;
  return !events.slice(index+1,end).some(candidate=>{
    if(candidate.type!=="message_completed"||!isRootAssistantEvent(candidate,rootThreadId)||candidate.metadata?.phase)return false;
    const candidateNativeType=String(candidate.metadata?.nativeType??"");
    return !candidateNativeType||candidateNativeType==="assistant";
  });
};

export function estimateOutputTokens(value:string){
  let ascii=0,nonAscii=0;
  for(const character of value){
    if((character.codePointAt(0)??0)>127)nonAscii++;
    else ascii++;
  }
  return value.trim()?Math.max(1,Math.round(ascii/4+nonAscii*.8)):0;
}

// Claude readings are per-request running totals, while current Codex workers
// publish a task-cumulative delta from the provider's thread total. Readings
// sharing an outputCallId therefore use their peak; distinct Claude request IDs
// are summed. Historical spools without IDs fall back to an output drop as the
// request boundary.
export function summarizeTurnOutputUsage(events:DisplayEvent[],rootThreadId:string|null|undefined):TurnOutputUsage|null{
  let committedTotal=0,committedOutput=0,committedInput=0,committedCached=0,committedCacheWrite=0,committedReasoning=0;
  let currentTotal:number|null=null,currentOutput=0,currentInput:number|null=null,currentCached:number|null=null,currentCacheWrite:number|null=null,currentReasoning=0;
  let seen=false,totalComplete=true,inputSeen=false,cachedSeen=false,cacheWriteSeen=false,updatedAt:string|null=null,currentCallId="",requestCount=0;
  const commit=()=>{
    if(!seen)return;
    requestCount+=1;
    const segmentTotal=currentInput!==null?currentInput+currentOutput:currentTotal;
    if(segmentTotal===null)totalComplete=false;
    else committedTotal+=segmentTotal;
    committedOutput+=currentOutput;
    if(currentInput!==null){committedInput+=currentInput;inputSeen=true;}
    else if(segmentTotal!==null){committedInput+=Math.max(0,segmentTotal-currentOutput);inputSeen=true;}
    if(currentCached!==null){committedCached+=currentCached;cachedSeen=true;}
    if(currentCacheWrite!==null){committedCacheWrite+=currentCacheWrite;cacheWriteSeen=true;}
    committedReasoning+=currentReasoning;
  };

  for(const event of events){
    if(!isRootThreadEvent(event,rootThreadId))continue;
    const raw=event.metadata?.outputUsage;
    if(!raw||typeof raw!=="object")continue;
    const item=raw as Record<string,unknown>;
    const tokens=Number(item.outputTokens);
    if(!Number.isFinite(tokens)||tokens<0)continue;
    const finiteOrNull=(value:unknown)=>{const number=Number(value);return value!==null&&value!==undefined&&Number.isFinite(number)&&number>=0?number:null;};
    const reportedTotal=finiteOrNull(item.totalTokens),input=finiteOrNull(item.inputTokens),cached=finiteOrNull(item.cachedInputTokens),cacheWrite=finiteOrNull(item.cacheWriteInputTokens);
    const reasoningRaw=item.reasoningTokens;
    const reasoningValue=reasoningRaw===null||reasoningRaw===undefined?null:Number(reasoningRaw);
    const reasoning=reasoningValue!==null&&Number.isFinite(reasoningValue)&&reasoningValue>=0?reasoningValue:0;
    const reportedCallId=typeof event.metadata?.outputCallId==="string"?event.metadata.outputCallId.trim():"";
    const callChanged=Boolean(seen&&reportedCallId&&reportedCallId!==currentCallId);
    if(callChanged||(seen&&!reportedCallId&&!currentCallId&&tokens<currentOutput)){
      commit();
      currentTotal=null;currentOutput=0;currentInput=null;currentCached=null;currentCacheWrite=null;currentReasoning=0;
    }
    if(reportedCallId)currentCallId=reportedCallId;
    currentOutput=Math.max(currentOutput,tokens);
    if(reportedTotal!==null)currentTotal=Math.max(currentTotal??0,reportedTotal);
    if(input!==null)currentInput=Math.max(currentInput??0,input);
    if(cached!==null)currentCached=Math.max(currentCached??0,cached);
    if(cacheWrite!==null)currentCacheWrite=Math.max(currentCacheWrite??0,cacheWrite);
    currentReasoning=Math.max(currentReasoning,reasoning);
    seen=true;
    if(typeof item.updatedAt==="string")updatedAt=item.updatedAt;
  }

  commit();
  if(seen&&committedOutput>0){
    const hasTotal=totalComplete&&committedTotal>0;
    return{tokens:hasTotal?committedTotal:committedOutput,exact:true,inputTokens:hasTotal&&inputSeen?committedInput:null,outputTokens:committedOutput,cachedInputTokens:cachedSeen?committedCached:null,cacheWriteInputTokens:cacheWriteSeen?committedCacheWrite:null,reasoningTokens:committedReasoning>0?committedReasoning:null,requestCount,updatedAt};
  }

  const text=events
    .filter(event=>isRootAssistantEvent(event,rootThreadId))
    .map(event=>event.content)
    .join("");
  const estimated=estimateOutputTokens(text);
  return estimated?{tokens:estimated,exact:false,inputTokens:null,outputTokens:estimated,cachedInputTokens:null,cacheWriteInputTokens:null,reasoningTokens:null,requestCount:null,updatedAt:null}:null;
}

export function summarizeDisplayedOutputUsage(
  events:DisplayEvent[],
  rootThreadId:string|null|undefined,
  output:string,
  persisted?:unknown,
):TurnOutputUsage|null{
  const reported=summarizeTurnOutputUsage(events,rootThreadId);
  if(reported?.exact)return reported;
  const stored=persistedTurnOutputUsage(persisted);
  if(stored)return stored;
  const tokens=estimateOutputTokens(output);
  return tokens>0?{tokens,exact:false,inputTokens:null,outputTokens:tokens,cachedInputTokens:null,cacheWriteInputTokens:null,reasoningTokens:null,requestCount:null,updatedAt:null}:reported;
}

export function collaborationUsageThreadId(provider:"codex"|"claude",task:any){
  return provider==="claude"
    ?task?.providerSessionId??task?.threadId??null
    :task?.threadId??task?.providerSessionId??null;
}

const isOutcome = (event: DisplayEvent) => event.type === "task_failed" || event.type === "task_stopped" || event.type === "error";
const isGenericCompletion = (content: string) => /^(?:Codex turn|Claude task).*(?:completed|완료)/i.test(content.trim());
const POST_FINAL_HOUSEKEEPING_METHODS=new Set([
  "thread/tokenUsage/updated",
  "claude/contextUsage/updated",
  "claude/outputUsage/updated",
  "account/rateLimits/updated",
  "turn/diff/updated",
  "thread/status/changed"
]);
function postFinalNativeMethod(event:DisplayEvent){
  const method=nativeMethod(event);
  if(method)return method;
  return /^Codex notification:\s*(\S+)/.exec(event.content.trim())?.[1]??"";
}
const isPostFinalHousekeeping=(event:DisplayEvent)=>event.type==="unknown"&&POST_FINAL_HOUSEKEEPING_METHODS.has(postFinalNativeMethod(event));
const messageTurn=(event:AgentEvent)=>String(event.turnId??event.metadata?.turnId??"");
const eventThread=(event:AgentEvent)=>cleanNativeString(event.threadId)||cleanNativeString(event.metadata?.agentThreadId);
const sameEventScope=(left:AgentEvent,right:AgentEvent)=>{
  const leftThread=eventThread(left),rightThread=eventThread(right);
  if((leftThread||rightThread)&&leftThread!==rightThread)return false;
  const leftTurn=messageTurn(left),rightTurn=messageTurn(right);
  if((leftTurn||rightTurn)&&leftTurn!==rightTurn)return false;
  return true;
};
const hasEventScope=(event:AgentEvent)=>Boolean(eventThread(event)||messageTurn(event));
const sameMessageStream=(left:DisplayEvent,right:AgentEvent)=>{
  if(left.itemId||right.itemId)return Boolean(left.itemId&&right.itemId&&left.itemId===right.itemId&&sameEventScope(left,right));
  if(!hasEventScope(left)&&!hasEventScope(right))return false;
  return sameEventScope(left,right);
};
const latestRootTurnEvent=(events:AgentEvent[],rootThreadId:string|null)=>{
  for(let index=events.length-1;index>=0;index--){
    const event=events[index],turnId=messageTurn(event);
    if(turnId&&isRootThreadEvent(event,rootThreadId))return event;
  }
  return null;
};
const sameCompletedOutput=(left:DisplayEvent,right:AgentEvent)=>{
  if(!isAssistant(left)||!isAssistant(right)||left.content.trim()!==right.content.trim())return false;
  return (hasEventScope(left)||hasEventScope(right))&&sameEventScope(left,right);
};
const adjacentCompletedOutput=(left:DisplayEvent|undefined,right:AgentEvent)=>Boolean(left&&isAssistant(left)&&isAssistant(right)&&left.content.trim()===right.content.trim()&&sameEventScope(left,right));
const completedOutputIndex=(rows:DisplayEvent[],event:AgentEvent)=>{
  for(let index=rows.length-1;index>=0;index--)if(sameCompletedOutput(rows[index],event))return index;
  return -1;
};
const sameFinalTurn=(left:AgentEvent,right:AgentEvent)=>{
  const leftTurn=messageTurn(left),rightTurn=messageTurn(right);
  if(leftTurn&&rightTurn)return leftTurn===rightTurn;
  return sameEventScope(left,right);
};
const supersededFinalDraft=(candidate:DisplayEvent,finalEvent:DisplayEvent)=>{
  if(candidate===finalEvent||!isAssistant(candidate))return false;
  const candidateContent=candidate.content.trim(),finalContent=finalEvent.content.trim();
  if(!candidateContent||!finalContent)return false;
  // While a session remains open, the accumulated message_delta and the
  // completed history item can briefly use different native item IDs. Once an
  // explicit final answer exists, discard only its exact duplicate or the
  // unfinished streamed prefix. Genuine commentary remains in the process
  // fold, while the final answer has one stable card outside it.
  if(candidateContent===finalContent)return true;
  return sameFinalTurn(candidate,finalEvent)&&Boolean(candidate._stream&&finalContent.startsWith(candidateContent));
};
const messageStreamIndex=(rows:DisplayEvent[],event:AgentEvent)=>{
  for(let index=rows.length-1;index>=0;index--)if(rows[index]._stream&&sameMessageStream(rows[index],event))return index;
  return -1;
};

export function hideConversationEvent(event: AgentEvent) {
  const phase=String(event.metadata?.phase??event.metadata?.section??"").toLowerCase();
  return HIDDEN.has(event.type)
    || (event.type === "tool_progress" && event.metadata?.deltaType === "thinking_delta")
    || phase === "reasoning"
    || phase === "analysis";
}

export function displayEvents(raw: AgentEvent[], request = "", busy = false, rootThreadId:string|null=null, requestTimestamp:string|null=null): DisplayEvent[] {
  const output: DisplayEvent[] = [];
  const syntheticRequest=(fields:Partial<DisplayEvent>={}):DisplayEvent=>({
    type:"message",
    content:request,
    metadata:{role:"user"},
    ...(requestTimestamp?{timestamp:requestTimestamp}:{}),
    ...fields
  });
  const activeRootEvent=busy?latestRootTurnEvent(raw,rootThreadId):null;
  const activeTurnId=activeRootEvent?messageTurn(activeRootEvent):"";
  const activeTaskId=activeRootEvent?.taskId??"";
  // During very early startup the HTTP fallback can contain task.prompt as an
  // unscoped user row before the SSE stream has published turn_started. Once
  // that lifecycle event arrives, do not synthesize the exact prompt again.
  const unscopedMatchingRequest=Boolean(request&&raw.some(event=>isRootUserEvent(event,rootThreadId)&&!messageTurn(event)&&event.content.trim()===request.trim()));
  const activeHasRequest=unscopedMatchingRequest||(activeTurnId
    ?raw.some(event=>isRootUserEvent(event,rootThreadId)&&messageTurn(event)===String(activeTurnId))
    :raw.some(event=>isRootUserEvent(event,rootThreadId)));
  let pendingRequest=Boolean(request&&!activeHasRequest);
  if(pendingRequest&&!activeTurnId){output.push(syntheticRequest());pendingRequest=false;}

  for (const event of raw) {
    // A long parallel run can rotate its stream while a child is noisy. The
    // replay then starts with child-thread rows and reaches the first surviving
    // root row later. Task identity lets the synthetic request precede that
    // whole replay suffix, keeping every child row in the parent's one fold.
    const reachedActiveTask=activeTaskId?event.taskId===activeTaskId:messageTurn(event)===String(activeTurnId);
    if(pendingRequest&&reachedActiveTask){
      output.push(syntheticRequest({taskId:activeTaskId||undefined,threadId:rootThreadId,turnId:String(activeTurnId),metadata:{role:"user",turnId:String(activeTurnId)}}));
      pendingRequest=false;
    }
    if (hideConversationEvent(event)) continue;
    if (event.type === "message_delta") {
      const streamIndex=messageStreamIndex(output,event);
      if(streamIndex>=0)output[streamIndex].content=`${output[streamIndex].content||""}${event.content||""}`;
      else if(!output.some(row=>!row._stream&&isAssistant(row)&&sameMessageStream(row,event)))output.push({ ...event, type:"message_completed", content:event.content || "", _stream:true });
      continue;
    }
    if (event.type === "message_completed") {
      const streamIndex=messageStreamIndex(output,event);
      if(streamIndex>=0)output[streamIndex]={ ...event };
      else{const duplicate=completedOutputIndex(output,event);if(duplicate>=0)output[duplicate]={...event};else if(adjacentCompletedOutput(output.at(-1),event))output[output.length-1]={...event};else output.push({ ...event });}
      continue;
    }
    if(isAssistant(event)){
      const duplicate=completedOutputIndex(output,event);
      if(duplicate>=0){output[duplicate]={...event};continue;}
      if(adjacentCompletedOutput(output.at(-1),event)){output[output.length-1]={...event};continue;}
    }
    const visibleEvent=isRootUserEvent(event,rootThreadId)
      &&!event.timestamp
      &&requestTimestamp
      &&event.content.trim()===request.trim()
      ?{...event,timestamp:requestTimestamp}
      :event;
    if(isRootUserEvent(visibleEvent,rootThreadId)&&output.some(row=>isRootUserEvent(row,rootThreadId)&&row.content.trim()===visibleEvent.content.trim()&&sameEventScope(row,visibleEvent)))continue;
    const last = output.at(-1);
    if (last && last.type === visibleEvent.type && last.content === visibleEvent.content && sameEventScope(last,visibleEvent) && !["file_change_started", "file_change_completed"].includes(visibleEvent.type)) continue;
    output.push({ ...visibleEvent });
  }
  return output;
}

export function latestOutputRunId<T extends { id: string }>(runs: T[], outputFor: (run: T) => string) {
  return [...runs].reverse().find((run) => outputFor(run).trim().length > 0)?.id ?? null;
}

export function firstConversationOutput(...values: Array<string | null | undefined>) {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0) ?? "";
}

export function organizeConversation(raw: AgentEvent[], request = "", busy = false, rootThreadId:string|null=null, requestTimestamp:string|null=null): ConversationTurn[] {
  const rows = displayEvents(raw, request, busy, rootThreadId, requestTimestamp);
  const buckets: DisplayEvent[][] = [];
  let current: DisplayEvent[] = [];
  for (const event of rows) {
    if (isRootUserEvent(event,rootThreadId) && current.length) {
      const requestTurn=messageTurn(event);
      // A current turn can start streaming after an older completed turn but
      // before its userMessage reaches the transcript. Locate the first root
      // event from that turn and peel the whole trailing prelude (including
      // child-thread events with their own turn IDs) away from the old turn.
      const preludeStart=requestTurn
        ?current.findIndex(row=>isRootThreadEvent(row,rootThreadId)&&messageTurn(row)===requestTurn)
        :-1;
      const prelude=preludeStart>=0?current.slice(preludeStart):[];
      const sameTurnPrelude=prelude.length>0
        &&prelude.every(row=>!isRootUserEvent(row,rootThreadId)
          &&(!isRootThreadEvent(row,rootThreadId)||!messageTurn(row)||messageTurn(row)===requestTurn));
      // A live provider can publish any part of a turn, including its final
      // answer and terminal event, before its userMessage reaches the UI.
      // Turn identity is authoritative: keep the late request at the visual
      // start of that turn instead of leaving a transient card below output.
      if(sameTurnPrelude){
        if(preludeStart>0)buckets.push(current.slice(0,preludeStart));
        current=[event,...prelude];
        continue;
      }
      buckets.push(current); current = [];
    }
    current.push(event);
  }
  if (current.length) buckets.push(current);

  return buckets.map((events, turnIndex) => {
    const rootFinalArrived=events.some(event=>isFinalAssistantOutput(event,rootThreadId,events,!busy));
    const active = busy && turnIndex === buckets.length - 1 && !rootFinalArrived;
    // Child-agent messages and root commentary stay in the process collection.
    // The process fold is open while a turn is active and collapses when it
    // finishes, so only the explicit root final answer belongs in the result
    // area. Promoting every root commentary row made live sessions accumulate
    // work-in-progress output alongside (and sometimes below) the final answer.
    const assistants = events.map((event, index) => ({ event, index })).filter(({ event }) => isRootAssistantEvent(event,rootThreadId));
    const explicitFinal = [...assistants].reverse().find(({ event }) => isFinalAssistantOutput(event,rootThreadId,events,!busy));
    const finalAssistant = explicitFinal ?? (!active ? assistants.at(-1) : undefined);
    // Codex emits token usage, quota, diff and idle notifications after the
    // final answer but before task_completed. They are useful while live, yet
    // making them a new completed process segment leaves a transient
    // "작업 N개" fold below the answer that disappears after re-entry.
    const postFinalHousekeeping=!active&&explicitFinal
      ?new Set(events.slice(explicitFinal.index+1).filter(isPostFinalHousekeeping))
      :new Set<DisplayEvent>();
    const supersededFinalDrafts=explicitFinal
      ?new Set(assistants.filter(({event})=>supersededFinalDraft(event,explicitFinal.event)).map(({event})=>event))
      :new Set<DisplayEvent>();
    const visibleEvents=postFinalHousekeeping.size||supersededFinalDrafts.size
      ?events.filter(event=>!postFinalHousekeeping.has(event)&&!supersededFinalDrafts.has(event))
      :events;
    const requestRows = visibleEvents.filter(event=>isRootUserEvent(event,rootThreadId));
    const resultEvents = new Set(visibleEvents.filter((event)=>isOutcome(event)||event.type==="context_compaction"));
    if (finalAssistant) resultEvents.add(finalAssistant.event);
    let fallbackCompletion:DisplayEvent|undefined;
    let fallbackResult:DisplayEvent|undefined;
    if (!active && !finalAssistant && assistants.length===0) {
      fallbackCompletion = [...visibleEvents].reverse().find((event) => event.type === "task_completed" && event.content && !isGenericCompletion(event.content));
      if (fallbackCompletion) fallbackResult={ ...fallbackCompletion, type:"message_completed", metadata:{ ...fallbackCompletion.metadata, role:"agent", section:"result" } };
    }
    // Keep visible result rows in their native timeline order. In particular,
    // a compaction boundary must stay before the answer/events produced after
    // compaction instead of being appended below the final answer.
    const presentedResult=(event:DisplayEvent)=>{
      // Completed Claude history comes from the native transcript, which has
      // neither phase nor nativeType metadata. Once turn organization has
      // selected an assistant message as the result, persist that semantic
      // decision on the display row so every provider uses the same card UI.
      return event===finalAssistant?.event&&event.type==="message_completed"
        ?{...event,metadata:{...event.metadata,role:"agent",section:"result"}}
        :event;
    };
    const resultRows:DisplayEvent[]=visibleEvents.flatMap((event)=>{
      if(event===fallbackCompletion&&fallbackResult)return[fallbackResult];
      return resultEvents.has(event)?[presentedResult(event)]:[];
    });

    const selected = new Set([...requestRows, ...resultEvents]);
    const processRows = visibleEvents.filter((event) => !selected.has(event) && event.type !== "task_completed");
    const processEvents=new Set(processRows),timeline:ConversationTimelineBlock[]=[];
    let processSegment:DisplayEvent[]=[];
    const flushProcess=()=>{
      if(!processSegment.length)return;
      const segment=processSegment;
      processSegment=[];
      timeline.push({kind:"process",id:`process-${timeline.length}-${eventRowIdentity(segment[0])}`,events:segment,active:false});
    };
    for(const event of visibleEvents){
      const resultEvent=event===fallbackCompletion?fallbackResult:resultEvents.has(event)?presentedResult(event):undefined;
      if(resultEvent){
        flushProcess();
        timeline.push({kind:"event",id:`event-${timeline.length}-${eventRowIdentity(event)}`,event:resultEvent});
      }else if(processEvents.has(event))processSegment.push(event);
    }
    flushProcess();
    if(active){
      const last=timeline.at(-1);
      if(last?.kind==="process")last.active=true;
      else timeline.push({kind:"process",id:"process-active",events:[],active:true});
    }
    return {
      // One provider turn can open more than one bucket: a request followed by
      // its attachment rows is two root user events in the same turn. Keying the
      // rendered list on the turn id alone then produced duplicate keys and
      // Svelte tore the whole conversation down with each_key_duplicate.
      id:`${events[0]?.turnId ?? events[0]?.metadata?.turnId ?? "turn"}#${turnIndex}`,
      request:requestRows,
      process:processRows,
      result:resultRows,
      timeline,
      active,
      outputUsage:summarizeTurnOutputUsage(events,rootThreadId)
    };
  });
}

function collaborationOperation(event:DisplayEvent){
  if(event.type.startsWith("command_")||event.type==="command")return "command";
  if(event.type.startsWith("file_change_")||event.type==="file_write")return "file";
  if(event.type.startsWith("tool_")||event.type.startsWith("mcp_")||event.type==="file_read")return "tool";
  if(event.type.startsWith("agent_"))return "agent";
  return null;
}

// Friend conversations use one compact, chronological process fold. Provider
// start/progress/completed rows for the same native item occupy one stable row,
// while public commentary remains separate. This prevents stream deltas from
// duplicating the completed event without discarding the diagnostic timeline.
export function collaborationTurnPresentation(raw:AgentEvent[],busy=false,completedOutputsOnly=false):CollaborationTurnPresentation{
  const turn=organizeConversation(raw,"",busy).at(-1);
  if(!turn)return{process:[],final:null,failed:false};
  const final=turn.result.find(event=>isAssistant(event))??(busy?[...turn.process].reverse().find(event=>isAssistant(event))??null:null);
  const process:CollaborationProcessRow[]=[];
  const stableRows=new Map<string,number>();
  const publiclyUseful=(event:DisplayEvent)=>isAssistant(event)||event.type==="tool_completed"||event.type==="mcp_tool_result"||event.metadata?.public===true;
  for(const event of turn.process.filter(event=>(completedOutputsOnly?isAssistant(event):publiclyUseful(event))&&event!==final)){
    const operation=collaborationOperation(event);
    const nativeId=String(event.itemId??event.metadata?.itemId??"");
    const key=operation&&nativeId?`${operation}:item:${nativeId}`:eventRowIdentity(event);
    const row={id:key,event,summary:event.type==="message_completed"||event.type==="message"?event.content:processEventSummary(event)};
    const previous=stableRows.get(key);
    if(previous!==undefined)process[previous]=row;
    else{stableRows.set(key,process.length);process.push(row);}
  }
  const failed=turn.result.some(isOutcome)||raw.some(isOutcome);
  if(import.meta.env?.DEV)assertUniqueKeys("ConversationProcessFold rows",process,row=>row.id);
  return{process,final,failed};
}
