import type { AgentEvent } from "./events";

function anonymousLifecycleSignature(event:AgentEvent){
  if(!event.content.trim()||event.type==="message"||event.type==="message_delta"||event.type==="message_completed")return "";
  return JSON.stringify([event.type,String(event.metadata?.nativeType??""),String(event.metadata?.subtype??""),event.content.trim()]);
}

function imageEventKey(event:AgentEvent){
  if(event.metadata?.mediaKind!=="image"||typeof event.metadata.mediaPath!=="string"||!event.metadata.mediaPath.trim())return "";
  const turnId=eventIdentity(event,"turnId");
  const sourceTaskId=String(event.metadata?.sourceTaskId??event.taskId??"");
  const scope=turnId?`turn:${turnId}`:`task:${sourceTaskId}`;
  return JSON.stringify([scope,String(event.metadata.mediaPathBase??""),event.metadata.mediaPath]);
}

export function mergeLiveEvents(current:AgentEvent[],incoming:AgentEvent[],limit=1500){
  let next=[...current];
  const eventIds=new Set(current.map(event=>event.eventId).filter((value):value is string=>Boolean(value)));
  for(const event of incoming){
    if(event.eventId&&eventIds.has(event.eventId))continue;
    if(event.eventId)eventIds.add(event.eventId);
    const imageKey=imageEventKey(event);
    if(imageKey){
      const match=next.findIndex(candidate=>imageEventKey(candidate)===imageKey);
      if(match>=0){next[match]={...next[match]!,...event,metadata:{...next[match]!.metadata,...event.metadata}};continue;}
    }
    const signature=event.eventId?anonymousLifecycleSignature(event):"";
    // A terminal HTTP snapshot may win the race and render an anonymous hook
    // before its identified SSE copy leaves the browser queue. Replace the
    // newest matching anonymous occurrence instead of appending a duplicate.
    // Repeated hooks remain repeated because each replacement consumes one
    // still-anonymous occurrence.
    if(signature){
      let match=-1;
      for(let index=next.length-1;index>=0;index--){
        const candidate=next[index]!;
        if(!candidate.eventId&&anonymousLifecycleSignature(candidate)===signature){match=index;break;}
      }
      if(match>=0){next[match]=event;continue;}
    }
    const last=next.at(-1);
    if(event.type==="message_delta"&&last?.type==="message_delta"&&last.itemId===event.itemId)next=[...next.slice(0,-1),{...last,content:`${last.content}${event.content}`,sequence:event.sequence,eventId:event.eventId}];
    else next.push(event);
    if(next.length>limit)next=preserveConversationCards(next,limit);
  }
  return next;
}

function snapshotFamily(event:AgentEvent){
  if(["message_delta","message_completed"].includes(event.type)||(event.type==="message"&&event.metadata?.role==="agent"))return "message";
  if(event.type.startsWith("command_"))return "command";
  if(event.type.startsWith("file_change_"))return "file";
  if(event.type.startsWith("tool_")||event.type.startsWith("mcp_"))return "tool";
  if(event.type.startsWith("agent_"))return "agent";
  return event.type;
}

function eventIdentity(event:AgentEvent,key:"threadId"|"turnId"|"itemId"){
  const direct=event[key],nested=event.metadata?.[key];
  return typeof direct==="string"&&direct?direct:typeof nested==="string"&&nested?nested:"";
}

function snapshotEventKey(event:AgentEvent,index:number,source:"snapshot"|"live"){
  const threadId=eventIdentity(event,"threadId"),turnId=eventIdentity(event,"turnId"),itemId=eventIdentity(event,"itemId");
  const scopeId=turnId||threadId;
  const completed=event.type==="message_completed"||(event.type==="message"&&event.metadata?.role==="agent");
  const imageKey=imageEventKey(event);
  if(imageKey)return `image:${imageKey}`;
  if(completed&&!turnId&&event.content.trim())return `fallback:completed:${event.content.trim()}`;
  if(itemId){
    const family=snapshotFamily(event);
    // A command's started/output/completed rows share one native item id, but
    // they are not interchangeable. Collapsing them to one key can let a
    // polling snapshot replace command_started with command_output, making an
    // in-flight build card lose its command and disappear. Keep lifecycle
    // phases distinct; identical output chunks still deduplicate by occurrence.
    if(family==="command")return `item:${scopeId}:${itemId}:${family}:${event.type}:${event.type==="command_output"?event.content:""}`;
    return `item:${scopeId}:${itemId}:${family}`;
  }
  if(completed&&event.content.trim()){
    // Claude transcript rows are anonymous while the matching SSE row carries
    // a stream event ID (and sometimes a thread ID). Pair equal occurrences by
    // content before event identity so terminal reconciliation keeps the
    // larger source multiplicity instead of rendering snapshot + live copies.
    // Occurrence pairing preserves intentional repeated answers across turns.
    if(turnId)return `completed:${turnId}:${event.content.trim()}`;
    return `fallback:completed:${event.content.trim()}`;
  }
  // A request is keyed by when it was asked, not only by its words. Both copies
  // of one request -- the snapshot's and the browser's optimistic one -- carry
  // the turn's timestamp, while the same words asked again in a later turn carry
  // a different one. Keying on content alone silently merged those turns.
  if(event.type==="message"&&event.metadata?.role==="user"&&event.content.trim())
    return `request:${scopeId}:${event.timestamp??""}:${event.content.trim()}`;
  if(event.type==="context_compaction"&&event.timestamp)return `context:${scopeId}:${event.timestamp}:${String(event.metadata?.trigger??"")}`;
  const lifecycleSignature=anonymousLifecycleSignature(event);
  if(lifecycleSignature){
    // Terminal provider snapshots often strip stream IDs from hooks and other
    // lifecycle rows. Match those rows semantically across snapshot/SSE, then
    // let the occurrence suffix below preserve genuinely repeated events.
    return `fallback:event:${lifecycleSignature}`;
  }
  if(event.eventId)return `id:${event.eventId}`;
  const sequence=Number(event.sequence);
  if(Number.isSafeInteger(sequence)&&sequence>=0)return `sequence:${sequence}`;
  // Old history responses did not lift Codex item identities out of metadata.
  // Keep an identical source-independent fallback so a terminal snapshot can
  // replace the copy already rendered from the previous task. The source and
  // index are retained only as a final guard for content-free events.
  const role=String(event.metadata?.role??""),phase=String(event.metadata?.phase??event.metadata?.section??"");
  return event.content?`fallback:${event.type}:${scopeId}:${role}:${phase}:${event.content}`:`${source}:${index}:${event.type}:${event.timestamp??""}`;
}

function completedAgentMessageKey(event:AgentEvent){
  const completed=event.type==="message_completed"||(event.type==="message"&&event.metadata?.role==="agent");
  if(!completed||!event.content)return "";
  const turnId=eventIdentity(event,"turnId");
  if(!turnId)return "";
  return JSON.stringify([turnId,event.content.trim()]);
}

// Codex app-server history assigns durable item-* IDs while its live SSE
// stream emits msg_* IDs for the same completed response. Item identity alone
// therefore cannot remove a history/live duplicate. Keep the later copy so the
// live event stays in its chronological position after intervening commentary.
function deduplicateCompletedAgentMessages(events:AgentEvent[]){
  const seen=new Set<string>(),kept:AgentEvent[]=[];
  for(let index=events.length-1;index>=0;index--){
    const event=events[index],key=completedAgentMessageKey(event);
    if(key&&seen.has(key))continue;
    if(key)seen.add(key);
    kept.push(event);
  }
  return kept.reverse();
}

const isUserMessage=(event:AgentEvent)=>event.type==="message"&&event.metadata?.role==="user";
const isAssistantMessage=(event:AgentEvent)=>event.type==="message_completed"||(event.type==="message"&&event.metadata?.role==="agent");

// A new task can briefly fall back to task.prompt before Codex publishes its
// native userMessage. Terminal reconciliation then sees the same request once
// without a turn id and once with one. Preserve the first visual position, but
// prefer the scoped copy so it joins the correct turn. Identical requests in
// two different scoped turns remain distinct.
function deduplicateUserMessages(events:AgentEvent[]){
  const kept:AgentEvent[]=[];
  for(const event of events){
    if(!isUserMessage(event)||!event.content.trim()){kept.push(event);continue;}
    const content=event.content.trim(),turnId=eventIdentity(event,"turnId");
    let match=-1;
    for(let index=kept.length-1;index>=0;index--){
      const candidate=kept[index]!;
      if(!isUserMessage(candidate)||candidate.content.trim()!==content)continue;
      const candidateTurn=eventIdentity(candidate,"turnId");
      if(candidate.taskId&&event.taskId&&candidate.taskId!==event.taskId)continue;
      if(candidateTurn&&turnId&&candidateTurn!==turnId)continue;
      // A modern optimistic request already names its task. Do not merge it
      // into an older same-text history row merely because only that row has a
      // provider turn id. The matching current history row carries the same
      // task id after server reconciliation.
      if(Boolean(candidateTurn)!==Boolean(turnId)){
        const withoutTurn=candidateTurn?event:candidate,withTurn=candidateTurn?candidate:event;
        if(withoutTurn.taskId&&withTurn.taskId!==withoutTurn.taskId)continue;
      }
      // Providers that have no turn id still scope a request to its task. Two
      // copies of one request -- the snapshot's and the browser's optimistic
      // one -- are the same row, while the same words asked again in a later
      // turn carry a different task and stay distinct.
      if(!candidateTurn&&!turnId&&!(candidate.taskId&&event.taskId&&candidate.taskId===event.taskId))continue;
      match=index;break;
    }
    if(match<0){kept.push(event);continue;}
    const previous=kept[match]!,previousTurn=eventIdentity(previous,"turnId");
    if(!previousTurn&&turnId)kept[match]=event;
    else if(previousTurn===turnId&&(event.eventId||event.threadId))kept[match]=event;
    else if(!previousTurn&&!turnId&&!previous.timestamp&&event.timestamp)kept[match]=event;
  }
  return kept;
}

// Provider history can expose the final item before live-only commentary has
// reached the same terminal snapshot. The final answer is semantically the last
// assistant message of its turn, regardless of which source arrived first.
function placeFinalAnswersAfterCommentary(events:AgentEvent[]){
  const ordered=[...events];
  const turns=new Set(ordered.filter(event=>event.metadata?.phase==="final_answer").map(event=>eventIdentity(event,"turnId")).filter(Boolean));
  for(const turnId of turns){
    const finalIndex=ordered.findIndex(event=>eventIdentity(event,"turnId")===turnId&&event.metadata?.phase==="final_answer");
    if(finalIndex<0)continue;
    let lastCommentary=-1;
    for(let index=finalIndex+1;index<ordered.length;index++){
      const event=ordered[index]!;
      if(eventIdentity(event,"turnId")===turnId&&isAssistantMessage(event)&&event.metadata?.phase==="commentary")lastCommentary=index;
    }
    if(lastCommentary<0)continue;
    const [finalEvent]=ordered.splice(finalIndex,1);
    const shiftedCommentary=lastCommentary-1;
    ordered.splice(shiftedCommentary+1,0,finalEvent!);
  }
  return ordered;
}

// Provider history can lag a few hundred milliseconds behind the terminal SSE
// event. Merge the terminal snapshot with the already rendered live stream so
// a stale history response cannot erase the final commentary until re-entry.
// Matching native items keep their original position while the live version
// wins, which also replaces accumulated deltas with message_completed.
export function mergeTerminalSnapshot(snapshot:AgentEvent[],live:AgentEvent[],limit=1500){
  const rows=new Map<string,AgentEvent>();
  const keys=(events:AgentEvent[],source:"snapshot"|"live")=>{
    const bases=events.map((event,index)=>snapshotEventKey(event,index,source)),totals=new Map<string,number>();
    for(const base of bases)if(base.startsWith("fallback:event:"))totals.set(base,(totals.get(base)??0)+1);
    const occurrences=new Map<string,number>();
    return events.map((event,index)=>{
      const base=bases[index]!,occurrence=occurrences.get(base)??0;
      occurrences.set(base,occurrence+1);
      // Lifecycle snapshots can contain the same anonymous hook in many prior
      // turns while the live buffer contains only the newest turn. Pair these
      // occurrences from the end so the current hook replaces the current
      // snapshot row instead of an older historical one.
      const pairedOccurrence=base.startsWith("fallback:event:")?(totals.get(base)??1)-occurrence-1:occurrence;
      return{key:base.startsWith("fallback:")?`${base}:occurrence:${pairedOccurrence}`:base,event};
    });
  };
  const snapshotRows=keys(snapshot,"snapshot"),liveRows=keys(live,"live"),snapshotKeys=new Set(snapshotRows.map(row=>row.key));
  for(const row of snapshotRows)rows.set(row.key,row.event);
  for(const row of liveRows)rows.set(row.key,row.event);

  // A provider transcript is read from a bounded tail, so a long session starts
  // mid-conversation: every live row older than the snapshot's first row is
  // history the snapshot no longer covers. Anchoring those rows to a later
  // match (or appending the leftovers) put the request and the opening answer
  // below the final answer. Peel that contiguous older prefix and keep it in
  // front of the snapshot instead.
  const eventTime=(event:AgentEvent)=>{const parsed=Date.parse(event.timestamp??"");return Number.isFinite(parsed)?parsed:null;};
  // The first timestamped row, not the minimum: history merging appends
  // non-visual usage rows that still carry their original (older) timestamps.
  const snapshotStart=snapshotRows.map(row=>eventTime(row.event)).find((value):value is number=>value!==null)??null;
  let prefixLength=0;
  if(snapshotStart!==null)while(prefixLength<liveRows.length){
    const time=eventTime(liveRows[prefixLength]!.event);
    if(time===null||time>=snapshotStart)break;
    prefixLength++;
  }
  // A row older than every snapshot row cannot be the same row as one of them,
  // so give it a key of its own. Anonymous lifecycle rows otherwise pair by
  // signature with an unrelated snapshot row and would take over its position.
  const olderThanSnapshot=liveRows.slice(0,prefixLength).map((row,index)=>({key:`older:${index}:${row.key}`,event:row.event}));
  for(const row of olderThanSnapshot)rows.set(row.key,row.event);

  // History is the durable backbone, but it omits live-only lifecycle rows.
  // Insert each such block immediately before its next history-backed live
  // event. Appending all of them after history made a task-start hook appear
  // between (or below) the completed answer during terminal reconciliation.
  const order=[...new Set([...olderThanSnapshot.map(row=>row.key),...snapshotRows.map(row=>row.key)])],pending:string[]=[],scheduled=new Set(order);
  for(const row of liveRows.slice(prefixLength)){
    if(!snapshotKeys.has(row.key)){if(!scheduled.has(row.key)){pending.push(row.key);scheduled.add(row.key);}continue;}
    if(!pending.length)continue;
    const anchor=order.indexOf(row.key);
    if(anchor>=0)order.splice(anchor,0,...pending);
    else order.push(...pending);
    pending.length=0;
  }
  order.push(...pending);
  const assistants=deduplicateCompletedAgentMessages(order.map(key=>rows.get(key)!).filter(Boolean));
  return preserveConversationCards(placeFinalAnswersAfterCommentary(deduplicateUserMessages(assistants)),limit);
}

// A terminal snapshot is already bounded to the same limit, but merging it with
// a large live buffer can push the combined result past the cap. A raw tail
// slice then evicts the oldest rows -- the earlier turns' requests and answers
// -- leaving a reopened long session with no past output cards. Reserve the
// bounded window for conversation rows first, then spend the remainder on the
// newest process events while preserving their original order. Mirrors the
// server-side providerThreadEvents budget so both sides agree on what survives.
function preserveConversationCards(events:AgentEvent[],limit:number){
  const boundedLimit=Math.max(1,limit);
  if(events.length<=boundedLimit)return events;
  const eventTask=(event:AgentEvent)=>String(event.taskId??event.metadata?.sourceTaskId??"");
  const outputCall=(event:AgentEvent)=>String(event.itemId??event.metadata?.itemId??event.metadata?.outputCallId??"");
  const completedCalls=new Set(events.filter(event=>event.type==="message_completed").map(event=>`${eventTask(event)}:${outputCall(event)}`).filter(key=>!key.endsWith(":")));
  const cardEvent=(event:AgentEvent)=>event.type==="message"&&event.metadata?.role==="user"
    ||event.type==="message_completed"
    ||event.type==="message_delta"&&!completedCalls.has(`${eventTask(event)}:${outputCall(event)}`)
    ||event.type==="context_compaction"
    ||event.type==="error"||event.type==="task_failed"||event.type==="task_stopped"
    ||event.metadata?.mediaKind==="image";
  const essential=new Set(events.map((event,index)=>cardEvent(event)?index:-1).filter(index=>index>=0));
  if(essential.size>=boundedLimit)return events.filter((_event,index)=>essential.has(index)).slice(-boundedLimit);
  let remaining=boundedLimit-essential.size;
  for(let index=events.length-1;index>=0&&remaining>0;index--)if(!essential.has(index)){essential.add(index);remaining--;}
  return events.filter((_event,index)=>essential.has(index));
}

// A live buffer only runs ahead of the snapshot for the task it streams from.
// Rows belonging to an earlier task are history the snapshot already owns, and
// carrying them into the next turn's merge stranded them below its request.
// Rows with no task (transcript history, an optimistic request) stay: they are
// anchored by the snapshot's own copy of the same row.
export function liveRowsForTask(events:AgentEvent[],taskId:string|null|undefined){
  if(!taskId)return events;
  return events.filter(event=>!event.taskId||event.taskId===taskId);
}

export function liveSnapshotSequence(value:unknown){
  const sequence=Number(value);
  return Number.isSafeInteger(sequence)&&sequence>=0?sequence:0;
}

// A snapshot request and the EventSource can resolve out of order. Never let
// an older HTTP response overwrite events that the live stream already added.
export function canApplyLiveSnapshot(currentSequence:number,snapshotSequence:unknown){
  return currentSequence<=liveSnapshotSequence(snapshotSequence);
}

const terminalStatuses=new Set(["completed","failed","stopped"]);

// A status request can resolve after the terminal SSE event. Accept completion
// from either source, but never let a stale active snapshot reopen the task.
export function canApplySnapshotStatus(currentStatus:string,nextStatus:unknown){
  if(typeof nextStatus!=="string"||!["pending","queued","running","waiting","completed","failed","stopped","unknown"].includes(nextStatus))return false;
  return !terminalStatuses.has(currentStatus)||terminalStatuses.has(nextStatus);
}
