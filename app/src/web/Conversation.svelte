<script lang="ts">
  import { Activity, Bot, Check, ChevronDown, ChevronUp, ChevronsDown, ChevronsUp, CircleAlert, Clock3, Copy, ExternalLink, Eye, EyeOff, FileDiff, Image as ImageIcon, LoaderCircle, Pencil, Sparkles, SquareTerminal, Wrench, X } from "@lucide/svelte";
  import { afterUpdate, beforeUpdate, onDestroy, onMount, tick } from "svelte";
  import BuildProgressCard from "./BuildProgressCard.svelte";
  import { activeBuilds, BUILD_HISTORY_VISIBLE, buildDurationLabel, buildEventSet, buildHistory, buildProgressRows } from "./build-progress";
  import HeartbeatBar from "./HeartbeatBar.svelte";
  import { presentEvent, type AgentEvent } from "./events";
  import { groupProcessEvents, isFinalAssistantOutput, isParallelAgentEvent, isRootThreadEvent, organizeConversation, processEventSummary, restoreLatestTurnOutputUsage, type DisplayEvent, type ProcessEventGroup } from "./conversation";
  import { parallelAgentCards, parallelAgentTally, parallelAgentsActive, sortAgentsByAttention, type ParallelAgentCard } from "./parallel-agents";
  import { isMarkdownEvent, renderMarkdown, workspaceViewTarget } from "./markdown";
  import { followLatestAfterScroll, intentionalTopReach, readingRestoreNeedsMoreHeight, readingScrollRestoreTarget, scrollButtonMode, scrollPosition, shouldAutoFoldSessionChrome, shouldRestoreAutoFoldedPanel, topClampNeedsRestore } from "./scroll-navigation";
  import { earlierHistoryActionVisible, RUNNING_HISTORY_OUTPUT_LIMIT } from "./running-history";
  import { formatContextTokens } from "./context-usage";
  import TurnUsageDetails from "./TurnUsageDetails.svelte";
  import { formatCardDateTime, locale, t } from "./i18n";
  import { taskOutcomeSummary } from "./task-outcome";
  import { fileEventCanOpen, fileEventEditTarget, taskImageOutputHref, workspaceFilePreviewHref } from "./workspace-viewer-state";
  import { deriveTaskLiveness } from "./liveness";
  import { activeTurnStartedAt, taskProgressHeartbeat } from "./task-progress";
  import { IMMERSIVE_TOP_REVEAL, shouldRevealOnTap } from "./immersive-chrome";
  import { providerDisplayName } from "./provider-display";

  export let events: AgentEvent[] = [];
  export let provider:"codex"|"claude"|"deepseek"|"ollama"|"antigravity"|"grok"="codex";
  export let request = "";
  export let requestTimestamp:string|null=null;
  export let responseTimestamp:string|null=null;
  export let busy = false;   // task is actively running
  export let liveMode:"Live"|"Delayed"|"History"="History";
  export let rootThreadId:string|null=null;
  type ProviderQuotaWindow={pct:number|null;resetsAt:string|null;resetLabel?:string|null;durationMins?:number|null};
  export let providerQuota:{fiveHour?:ProviderQuotaWindow|null;sevenDay?:ProviderQuotaWindow|null}|null=null;
  export let persistedOutputUsage:unknown=null;
  export let scrollAutoSwitch = true;
  export let onScrollDirection:((direction:"down"|"up",scrollTop:number,nearBottom:boolean)=>void)|null=null;
  export let onRevealChrome:(()=>void)|null=null;
  export let onScrollActivity:((scrollTop:number,distanceToBottom:number,userInitiated:boolean)=>void)|null=null;
  export let runningHistoryVisible=false;
  export let runningHistoryExpanded=false;
  export let runningHistoryLoading=false;
  export let ontogglerunninghistory:(()=>void)|null=null;
  export let transcriptTruncated:{before:true;droppedTurns:number|null;droppedBytes:number}|null=null;
  export let transcriptHistoryLoading=false;
  export let transcriptCanLoadMore=false;
  export let onloadtranscripthistory:(()=>void)|null=null;
  export let workspaceId:string|null=null;
  export let workspacePath:string|null=null;
  export let executionHostId:string|null="local";
  export let workspaceTargets:Array<{id:string;canonicalPath:string;hostId:string}>=[];
  export let sourceTaskId:string|null=null;
  export let onopenfile:((file:{path:string;pathBase:"workspace"|"task-cwd";sourceTaskId?:string;workspaceId?:string;line?:number;initialEdit?:boolean})=>void)|null=null;
  let changedFilesCollapsed=true;
  let changedFileEntries:Array<[string,{add:number;del:number;pathBase:"workspace"|"task-cwd"|"unresolved"}]>=[];
  let finalRevealReady=false;
  let finalRevealSessionKey=`${sourceTaskId??""}:${requestTimestamp??""}:${request}`;
  let finalRevealTaskWasBusy=busy;
  let knownFinalEventKeys=new Set<string>();
  let revealingFinalEventKeys=new Set<string>();

  // "무슨 일을 하는 중"인지 마지막 실제 이벤트로 추정 (VSCode의 Running… 라벨).
  const busyLabel = (rows: AgentEvent[]) => {
    for (let i = rows.length - 1; i >= 0; i--) {
      const e = rows[i];
      if (e.type === "file_change_started" || e.type === "file_change_completed") return $t("conversation.editingFile",{file:(e.metadata as any)?.path ?? $t("conversation.file")});
      if (e.type === "command_started" || e.type === "command_completed") return $t("conversation.runningCommand");
      if (e.type === "tool_started") return $t("conversation.runningTool",{tool:e.content || "tool"});
      if (e.type === "message_completed" || e.type === "message_delta") return $t("conversation.writingResponse");
      if (e.type === "tool_completed") return $t("conversation.checkingResult");
    }
    return $t("conversation.thinking");
  };
  const processVisibility=(rows:AgentEvent[],currentProvider:"codex"|"claude"|"deepseek"|"ollama"|"antigravity"|"grok",taskId:string|null,currentLiveMode:"Live"|"Delayed"|"History")=>{
    const state=deriveTaskLiveness(rows,{provider:currentProvider,taskId:taskId??"",streamStatus:currentLiveMode==="Live"?"live":currentLiveMode==="Delayed"?"delayed":"connecting"});
    const max=Math.max(1,...state.buckets);
    return{
      summary:state.recentActivity?.detail||state.lastContent,
      raw:state.recentActivity?.raw??"",
      bars:state.buckets.map(count=>Math.max(7,Math.round(count/max*30))),
      commandCount:state.commandCount,
      fileCount:state.fileCount,
      toolCount:state.toolCount,
      internalCount:state.internalCount,
      lastAt:state.lastMeaningfulEventAt?new Date(state.lastMeaningfulEventAt).toISOString():null,
      lastEventAtMs:state.lastMeaningfulEventAt,
      eventKey:String(state.lastEventAt),
      phase:state.phase,
      activityType:state.recentActivity?.type??"",
      eventCount:state.eventCount,
      transport:state.transport
    };
  };
  // The elapsed clock has to advance while the model is still round-tripping
  // with its tools, so it is driven by a timer instead of by event arrival.
  // It only runs while the task is actually busy.
  let progressNow=Date.now(),progressTimer:ReturnType<typeof setInterval>|null=null;
  function stopProgressTimer(){if(progressTimer){clearInterval(progressTimer);progressTimer=null;}}
  $: if(busy&&!progressTimer){progressNow=Date.now();progressTimer=setInterval(()=>progressNow=Date.now(),1_000);}
  $: if(!busy)stopProgressTimer();
  onDestroy(stopProgressTimer);

  let logElement: HTMLElement;
  let contentElement: HTMLElement;
  let topSentinel: HTMLElement;
  let hasNewEvents = false;
  let nearTop = true;
  let nearBottom = true;
  let followLatest = true;
  let scrollingToLatest = false;
  let scrollingToTop = false;
  let userScrollIntent = false;
  // A layout resize can emit a scroll event in the opposite direction from
  // the reader's finger. Keep the physical input direction separately so an
  // auto-folded work panel cannot mistake its own height change for a request
  // to return to the bottom.
  let userScrollInputDirection:"down"|"up"|null=null;
  let userScrollTimer:ReturnType<typeof setTimeout>|null=null;
  let userScrollGestureMoved=false;
  let userScrollWatchFrame=0;
  function clearUserScrollIntent(){
    userScrollIntent=false;userScrollInputDirection=null;userScrollGestureMoved=false;
    if(userScrollTimer){clearTimeout(userScrollTimer);userScrollTimer=null;}
    if(userScrollWatchFrame){cancelAnimationFrame(userScrollWatchFrame);userScrollWatchFrame=0;}
  }
  function scheduleUserScrollIntentClear(){
    if(userScrollTimer)clearTimeout(userScrollTimer);
    userScrollTimer=setTimeout(()=>clearUserScrollIntent(),500);
  }
  let initialScrolled = false;
  let lastScrollTop = 0;
  let scrollDirection: "down"|"up"|null = null;
  let scrollDistance = 0;
  const defaultStatusPanelOpen=()=>typeof window!=="undefined"&&window.matchMedia("(min-width:761px)").matches;
  let statusPanelOpen=defaultStatusPanelOpen();
  // Scrolling may temporarily fold an open work panel, but it must not erase
  // the reader's explicit choice. Only an automatically folded panel is
  // restored when the conversation reaches its absolute end.
  let restoreStatusPanelAtBottom=false;
  function restoreAutoFoldedStatusPanel(direction:"down"|"up"|null,distanceToBottom:number){
    if(!restoreStatusPanelAtBottom||!shouldRestoreAutoFoldedPanel(direction,distanceToBottom))return false;
    statusPanelOpen=true;restoreStatusPanelAtBottom=false;followLatest=true;
    // Opening the panel reduces the log viewport. Keep the same absolute
    // bottom anchored after Svelte commits the new height.
    void tick().then(()=>requestAnimationFrame(()=>{if(!logElement)return;logElement.scrollTop=logElement.scrollHeight;lastScrollTop=logElement.scrollTop;updateScrollPosition();}));
    return true;
  }
  $: quotaWindow=providerQuota?.fiveHour??providerQuota?.sevenDay??null;
  $: quotaUsesFiveHour=Boolean(providerQuota?.fiveHour);
  $: quotaPercent=quotaWindow?.pct!==null&&quotaWindow?.pct!==undefined
    ?Math.max(0,Math.min(100,quotaWindow.pct))
    :null;
  $: quotaTitle=quotaUsesFiveHour?$t("quota.fiveHourAllowance"):`${$t("quota.weekly")} ${$t("quota.label")}`;
  $: quotaBadge=quotaPercent===null?"":quotaUsesFiveHour
    ?$t("quota.fiveHourAllowanceBadge",{value:Math.round(quotaPercent)})
    :$t("quota.usage",{label:$t("quota.weekly"),value:Math.round(quotaPercent)});
  $: quotaTone=quotaPercent!==null&&quotaPercent>=90?"critical":quotaPercent!==null&&quotaPercent>=75?"warning":"normal";
  let renderedRequest=request;
  $: if(request!==renderedRequest){renderedRequest=request;statusPanelOpen=defaultStatusPanelOpen();restoreStatusPanelAtBottom=false;}
  // Auto-stick must never fight the user's finger: snap to the bottom only
  // when the log was ALREADY at the bottom right before this update. (The old
  // "within 100px → snap on any reactive tick" kept yanking touch scrolls back
  // down on every 4s poll, which read as "scrolling is broken".)
  const eventIdentity=(event:AgentEvent|undefined)=>event?`${(event as any).eventId??""}:${(event as any).sequence??""}:${event.timestamp??""}:${event.type}:${event.content.length}:${event.content.slice(-32)}`:"";
  const eventAnchorIdentity=(event:AgentEvent|undefined)=>event?`${event.threadId??event.metadata?.threadId??""}:${event.turnId??event.metadata?.turnId??""}:${event.itemId??event.metadata?.itemId??event.eventId??event.sequence??""}:${event.type}:${event.metadata?.role??""}:${event.content.slice(0,32)}`:"";
  const isFinalOutputEvent=(event:AgentEvent)=>isFinalAssistantOutput(event as DisplayEvent,rootThreadId,events as DisplayEvent[],!busy);
  const latestLiveWritingKey=(rows:AgentEvent[])=>{
    if(!busy)return"";
    const latest=[...rows].reverse().find(event=>isRootThreadEvent(event,rootThreadId)&&(event.type==="message_delta"||event.type==="message_completed")&&event.metadata?.role!=="user");
    return latest&&!isFinalOutputEvent(latest)?eventAnchorIdentity(latest):"";
  };
  $: liveWritingEventKey=latestLiveWritingKey(events);
  const rootFinalEventKeys=(rows:AgentEvent[])=>new Set(rows.filter(event=>isFinalOutputEvent(event)).map(event=>eventAnchorIdentity(event)));
  $: {
    const sessionKey=`${sourceTaskId??""}:${requestTimestamp??""}:${request}`;
    const currentFinalKeys=rootFinalEventKeys(events);
    if(sessionKey!==finalRevealSessionKey){
      finalRevealSessionKey=sessionKey;
      finalRevealTaskWasBusy=busy;
      knownFinalEventKeys=currentFinalKeys;
      revealingFinalEventKeys=new Set();
    }else{
      if(finalRevealReady&&finalRevealTaskWasBusy){
        const added=[...currentFinalKeys].filter(key=>!knownFinalEventKeys.has(key));
        if(added.length)revealingFinalEventKeys=new Set([...revealingFinalEventKeys,...added]);
      }
      if(busy)finalRevealTaskWasBusy=true;
      knownFinalEventKeys=currentFinalKeys;
    }
  }
  $: earlierHistoryVisible=earlierHistoryActionVisible({truncatedBefore:Boolean(transcriptTruncated?.before),runningHistoryVisible,runningHistoryExpanded});
  $: firstEventToken=eventAnchorIdentity(events[0]);
  $: eventToken=`${events.length}:${firstEventToken}:${eventIdentity(events.at(-1))}:${busy}:${runningHistoryVisible}`;
  let renderedEventToken="";
  let readingAnchor:HTMLElement|null=null;
  let readingAnchorKey="";
  let readingAnchorTop=0;
  let readingScrollTop=0;
  let readingAtTop=true;
  let expectedRestoredScrollTop:number|null=null;
  let readingRestorePending=false;
  function updateScrollPosition(){if(!logElement)return;const next=scrollPosition(logElement.scrollTop,logElement.scrollHeight,logElement.clientHeight,56,{nearTop,nearBottom});if(next.nearTop!==nearTop)nearTop=next.nearTop;if(next.nearBottom!==nearBottom)nearBottom=next.nearBottom;if(next.nearBottom)hasNewEvents=false;}
  function commitReadingAtTop(){
    readingRestorePending=false;expectedRestoredScrollTop=0;readingScrollTop=0;readingAtTop=true;
    readingAnchor=null;readingAnchorKey="";readingAnchorTop=0;
  }
  function commitIntentionalTop(){
    followLatest=false;scrollingToLatest=false;scrollingToTop=false;
    commitReadingAtTop();clearUserScrollIntent();
  }
  function captureReadingAnchor(){
    // A terminal snapshot can temporarily be too short to represent the saved
    // reading coordinate. Keep that coordinate until a later resize restores
    // it; otherwise a second Svelte update captures the browser's clamp as the
    // reader's new position and permanently jumps to the top.
    if(readingRestorePending)return;
    if(!logElement||!contentElement||followLatest){readingAnchor=null;return;}
    const bounds=logElement.getBoundingClientRect();
    const stableCandidates=[...contentElement.querySelectorAll<HTMLElement>("[data-scroll-anchor]")];
    const fallbackCandidates=[...contentElement.querySelectorAll<HTMLElement>(".running-history-control,.conversation-turn details,.conversation-turn")];
    const candidates=[...stableCandidates,...fallbackCandidates];
    const visibleStable=stableCandidates.filter(element=>{const rect=element.getBoundingClientRect();return rect.bottom>bounds.top+1&&rect.top<bounds.bottom-1;});
    const center=bounds.top+bounds.height/2;
    const centerAnchor=visibleStable.sort((left,right)=>{const leftRect=left.getBoundingClientRect(),rightRect=right.getBoundingClientRect();return Math.abs(leftRect.top+leftRect.height/2-center)-Math.abs(rightRect.top+rightRect.height/2-center);})[0];
    readingAnchor=centerAnchor??candidates.find(element=>{const rect=element.getBoundingClientRect();return rect.bottom>bounds.top+1&&rect.top<bounds.bottom-1;})??null;
    readingAnchorKey=readingAnchor?.dataset.scrollAnchor??"";
    readingAnchorTop=readingAnchor?.getBoundingClientRect().top??0;
    readingScrollTop=logElement.scrollTop;
    readingAtTop=readingScrollTop<=IMMERSIVE_TOP_REVEAL;
  }
  function restoreReadingAnchor(){
    if(!logElement||!contentElement||followLatest)return;
    // Revealing the heading moves the log and every card down together. Near
    // the top that is chrome geometry, not a content insertion: preserving the
    // old absolute card coordinate would add the heading height to scrollTop
    // and immediately cross the hide threshold again.
    // Completion can replace the live DOM with a shorter persisted snapshot.
    // The browser may clamp the current scrollTop to zero before afterUpdate;
    // use the pre-update position or that transient clamp becomes a permanent
    // jump to the first message.
    if(readingAtTop){
      commitReadingAtTop();
      logElement.scrollTop=0;lastScrollTop=0;clearUserScrollIntent();
      onScrollActivity?.(0,Math.max(0,logElement.scrollHeight-logElement.clientHeight),false);return;
    }
    if(!readingAnchor?.isConnected&&readingAnchorKey)readingAnchor=[...contentElement.querySelectorAll<HTMLElement>("[data-scroll-anchor]")].find(element=>element.dataset.scrollAnchor===readingAnchorKey)??null;
    if(!readingAnchor?.isConnected){
      const target=readingScrollRestoreTarget(readingScrollTop,logElement.scrollHeight,logElement.clientHeight,false);
      readingRestorePending=readingRestoreNeedsMoreHeight(readingScrollTop,target);
      expectedRestoredScrollTop=target;logElement.scrollTop=target;
      lastScrollTop=logElement.scrollTop;updateScrollPosition();return;
    }
    const delta=readingAnchor.getBoundingClientRect().top-readingAnchorTop;
    const desired=Math.max(0,readingScrollTop+delta);
    const target=readingScrollRestoreTarget(desired,logElement.scrollHeight,logElement.clientHeight,false);
    readingRestorePending=readingRestoreNeedsMoreHeight(desired,target);
    if(Math.abs(logElement.scrollTop-target)>0.5){
      expectedRestoredScrollTop=target;
      logElement.scrollTop=target;
      lastScrollTop=logElement.scrollTop;
    }
    readingScrollTop=desired;
    readingAnchorTop=readingAnchor.getBoundingClientRect().top;
  }
  onMount(()=>{
    knownFinalEventKeys=rootFinalEventKeys(events);
    finalRevealReady=true;
    let resizeFrame=0;
    const topObserver=typeof IntersectionObserver==="undefined"?null:new IntersectionObserver(entries=>{
      if(!entries.some(entry=>entry.isIntersecting)||!logElement)return;
      if(intentionalTopReach(true,userScrollIntent,scrollingToTop))commitIntentionalTop();
      onScrollActivity?.(0,Math.max(0,logElement.scrollHeight-logElement.clientHeight),false);
    },{root:logElement,rootMargin:`${IMMERSIVE_TOP_REVEAL}px 0px 0px 0px`,threshold:0});
    topObserver?.observe(topSentinel);
    const observer=new ResizeObserver(()=>{
      if(resizeFrame)return;
      resizeFrame=requestAnimationFrame(()=>{
        resizeFrame=0;
        if(!logElement)return;
        if(followLatest){
          logElement.scrollTop=logElement.scrollHeight;
          lastScrollTop=logElement.scrollTop;
          updateScrollPosition();
        }else restoreReadingAnchor();
      });
    });
    observer.observe(logElement);
    observer.observe(contentElement);
    return()=>{topObserver?.disconnect();observer.disconnect();if(resizeFrame)cancelAnimationFrame(resizeFrame);};
  });
  beforeUpdate(() => {
    if(!logElement)return;
    if(!followLatest)captureReadingAnchor();
  });
  afterUpdate(() => {
    if (!logElement) return;
    const changed=eventToken!==renderedEventToken;
    if (!initialScrolled) { logElement.scrollTop = logElement.scrollHeight; lastScrollTop = logElement.scrollTop; initialScrolled = true; renderedEventToken=eventToken;hasNewEvents=false;updateScrollPosition();return; }
    if(changed){
      if(followLatest){
        logElement.scrollTop=logElement.scrollHeight;
        lastScrollTop=logElement.scrollTop;
      }
      if(followLatest)hasNewEvents=false;else hasNewEvents=true;
      renderedEventToken=eventToken;
    }
    if(!followLatest)restoreReadingAnchor();
    updateScrollPosition();
  });

  const isDiffEvent = (e: AgentEvent) => e.type === "file_change_started" || e.type === "file_change_completed";
  const isCommandEvent = (e: AgentEvent) => e.type === "command_started" || e.type === "command_completed";
  const lineClass = (l: string) => (l[0] === "+" ? "l-add" : l[0] === "-" ? "l-del" : "l-ctx");
  $: turns = restoreLatestTurnOutputUsage(organizeConversation(events, request, busy, rootThreadId, requestTimestamp),persistedOutputUsage);
  $: rows = turns.flatMap((turn) => [...turn.request,...turn.timeline.flatMap((block)=>block.kind==="process"?block.events:[block.event])]);
  $: processRows = turns.flatMap((turn)=>turn.process).filter((event)=>!isParallelAgentEvent(event)&&isRootThreadEvent(event,rootThreadId));
  $: builds=buildProgressRows(processRows);
  $: buildEvents=buildEventSet(builds);
  $: runningBuilds=activeBuilds(builds);
  $: finishedBuilds=buildHistory(builds);
  $: panelOutcome=taskOutcomeSummary({status:busy?"running":"completed"},events);
  $: completedValidationCount=panelOutcome.checks.filter(check=>check.status==="passed").length;
  $: failedValidationCount=panelOutcome.checks.filter(check=>check.status==="failed").length;
  $: detailedProcessRows=groupProcessEvents(processRows.filter(event=>event.type!=="message_delta"&&event.type!=="message_completed"&&!buildEvents.has(event)) as DisplayEvent[]);
  $: statusVisibility=processVisibility(processRows,provider,sourceTaskId,liveMode);
  $: agentName = providerDisplayName(events.find((event) => event.provider)?.provider ?? provider);
  // Compute the indicator label once per update (not per render); bottom-stick
  // is already handled by afterUpdate below, so no extra rAF loop here.
  $: busyText = busy ? busyLabel(rows) : "";
  $: progressStartedAt=activeTurnStartedAt(events,requestTimestamp);
  $: progress=taskProgressHeartbeat({
    status:busy?"running":"completed",
    phase:statusVisibility.phase,
    activity:statusVisibility.activityType,
    startedAt:progressStartedAt,
    now:progressNow,
    lastEventAt:statusVisibility.lastEventAtMs,
    eventCount:statusVisibility.eventCount,
    commandCount:statusVisibility.commandCount,
    fileCount:statusVisibility.fileCount,
    toolCount:statusVisibility.toolCount
  });
  $: progressElapsedText=$t(progress.elapsedLabel.key,progress.elapsedLabel.params);
  $: progressHeartbeatLabel=$t("progress.heartbeatLabel",{stage:$t(progress.stageKey),elapsed:$t("progress.elapsed",{time:progressElapsedText})})+(progress.quiet?` · ${$t("progress.quiet")}`:"");
  $: statusWarnings=[
    liveMode==="Delayed"?$t("conversation.connectionDelayed"):"",
    progress.quiet?$t("progress.quiet"):"",
    quotaTone!=="normal"?quotaBadge:""
  ].filter(Boolean).join(" · ");
  $: completionEvidence=[
    panelOutcome.files.length?$t("conversation.completedFileCount",{count:panelOutcome.files.length}):"",
    completedValidationCount?$t("conversation.validationPassedCount",{count:completedValidationCount}):"",
    failedValidationCount?$t("conversation.validationFailedCount",{count:failedValidationCount}):""
  ].filter(Boolean).join(" · ");
  const changedFiles = () => {
    const m = new Map<string, { add: number; del: number; pathBase:"workspace"|"task-cwd"|"unresolved" }>();
    for (const e of events) {
      if (!isDiffEvent(e)) continue;
      const p = String((e.metadata as any)?.path ?? ""); if (!p) continue;
      const rawBase=(e.metadata as any)?.pathBase,pathBase=rawBase==="workspace"||rawBase==="task-cwd"?rawBase:"unresolved",c = m.get(p) ?? { add: 0, del: 0, pathBase };
      c.add += Number((e.metadata as any)?.additions ?? 0);
      c.del += Number((e.metadata as any)?.deletions ?? 0);
      if(c.pathBase!==pathBase)c.pathBase="unresolved";
      m.set(p, c);
    }
    return [...m.entries()];
  };
  $: changedFileEntries=changedFiles();

  function onScroll() {
    if (!logElement) return;
    const top=logElement.scrollTop;
    const restoredScroll=expectedRestoredScrollTop!==null&&!userScrollIntent&&Math.abs(top-expectedRestoredScrollTop)<=1;
    if(restoredScroll)expectedRestoredScrollTop=null;
    const distanceToBottom=Math.max(0,logElement.scrollHeight-logElement.clientHeight-top);
    const reachedTop=top<=IMMERSIVE_TOP_REVEAL;
    const delta=top-lastScrollTop;
    // Only a deliberate gesture or the explicit jump button establishes a
    // new top reading position. A content/panel resize can also clamp the log
    // to zero; preserving that distinction lets ResizeObserver restore the
    // previous mid-log anchor when the full layout returns.
    if(intentionalTopReach(reachedTop,userScrollIntent,scrollingToTop))commitIntentionalTop();
    else if(topClampNeedsRestore(reachedTop,readingAtTop,followLatest,restoredScroll,delta))readingRestorePending=true;
    updateScrollPosition();
    if(!initialScrolled){lastScrollTop=top;if(reachedTop)onScrollActivity?.(top,distanceToBottom,false);return;}
    lastScrollTop=top;
    if(Math.abs(delta)<1){if(reachedTop)onScrollActivity?.(top,distanceToBottom,false);return;}
    // Browser layout clamping fires scroll before ResizeObserver. Mark the
    // restoration synchronously so the chrome update triggered below cannot
    // run beforeUpdate() and recapture the clamped coordinate as genuine.
    if(!reachedTop&&!userScrollIntent&&!scrollingToLatest&&!followLatest&&!restoredScroll&&delta<0)readingRestorePending=true;
    if(userScrollIntent){userScrollGestureMoved=true;scheduleUserScrollIntentClear();}
    if(scrollingToLatest&&nearBottom)scrollingToLatest=false;
    // Scroll events caused by restoration are layout bookkeeping, not an
    // instruction to resume following the latest output. In particular, a
    // short intermediate snapshot may have maxScrollTop=0 and look both at the
    // top and bottom.
    const inputAwareDelta=userScrollInputDirection==="up"?-Math.max(1,Math.abs(delta)):userScrollInputDirection==="down"?Math.max(1,Math.abs(delta)):delta;
    if(userScrollIntent&&!restoredScroll&&!readingRestorePending)followLatest=followLatestAfterScroll(followLatest,scrollingToLatest,true,nearBottom,inputAwareDelta);
    if(userScrollIntent&&!followLatest&&!restoredScroll)captureReadingAnchor();
    const direction=delta>0?"down":"up";
    if(direction!==scrollDirection){scrollDirection=direction;scrollDistance=0;}
    scrollDistance+=Math.abs(delta);
    const panelRestoreDirection=userScrollInputDirection??direction;
    restoreAutoFoldedStatusPanel(panelRestoreDirection,distanceToBottom);
    // A reader cannot scroll up and still be at the very end of the log. That
    // combination only happens when the log shrank — trimmed events, a folding
    // panel, the chrome sliding in — and the browser clamped scrollTop to the
    // new maximum, reporting the clamp as an upward scroll. Folding on it hid
    // the controls on conversations nobody had scrolled.
    if(direction==="up"&&distanceToBottom<=0){onScrollActivity?.(top,distanceToBottom,userScrollIntent);return;}
    if(scrollDistance>=24||(direction==="down"&&nearBottom)){
      if(shouldAutoFoldSessionChrome(direction,top,nearBottom)&&statusPanelOpen){statusPanelOpen=false;restoreStatusPanelAtBottom=true;}
      onScrollDirection?.(direction,top,nearBottom);scrollDistance=0;
    }
    // Report every scroll so the bottom drawer keeps tracking the distance
    // through momentum and auto-follow, but flag whether the reader actually
    // started this one — only a deliberate gesture may hide the chrome.
    onScrollActivity?.(top,distanceToBottom,userScrollIntent);
  }
  // Listen on pointerup so a drag that happens to start on inert text does not
  // count as a tap. The event is never cancelled, so the original interaction
  // still reaches links, copy buttons and the scroll-jump control.
  function revealOnTap(node:HTMLElement){
    const handle=(event:PointerEvent)=>{
      if(!onRevealChrome)return;
      // At the true end, distance tracking already requires the heading and
      // bottom drawer to be visible. Toggling them off on pointerup only lets
      // the next distance/resize callback turn them straight back on, which
      // appears as a flash on physical phones. Keep real controls working via
      // their own handlers, but make an inert end-of-log tap a no-op.
      const distanceToBottom=Math.max(0,node.scrollHeight-node.clientHeight-node.scrollTop);
      if(distanceToBottom<=1){clearUserScrollIntent();return;}
      if(!shouldRevealOnTap(event.target as Element|null))return;
      const dragged=userScrollGestureMoved;
      if(dragged)scheduleUserScrollIntentClear();
      else{clearUserScrollIntent();onRevealChrome();}
    };
    node.addEventListener("pointerup",handle);
    return{destroy:()=>node.removeEventListener("pointerup",handle)};
  }
  function markUserScrollIntent(direction:"down"|"up"|null=null){
    if(direction)userScrollInputDirection=direction;
    scrollingToLatest=false;scrollingToTop=false;readingRestorePending=false;userScrollIntent=true;
    scheduleUserScrollIntentClear();
    const watchTop=()=>{
      userScrollWatchFrame=0;
      if(!userScrollIntent||!logElement)return;
      if(userScrollGestureMoved&&logElement.scrollTop<=IMMERSIVE_TOP_REVEAL){
        const distance=Math.max(0,logElement.scrollHeight-logElement.clientHeight);
        commitIntentionalTop();onScrollActivity?.(0,distance,false);return;
      }
      userScrollWatchFrame=requestAnimationFrame(watchTop);
    };
    if(!userScrollWatchFrame)userScrollWatchFrame=requestAnimationFrame(watchTop);
  }
  function cancelFollowOnUserInput(node:HTMLElement){
    let lastTouchY:number|null=null;
    const pointer=(event:Event)=>{
      const target=event.target;
      if(target instanceof Element&&target.closest("button,a,input,textarea,select,summary"))return;
      userScrollGestureMoved=false;
      userScrollInputDirection=null;
      markUserScrollIntent();
    };
    const wheel=(event:WheelEvent)=>markUserScrollIntent(event.deltaY>0?"down":event.deltaY<0?"up":null);
    const touchstart=(event:TouchEvent)=>{lastTouchY=event.touches[0]?.clientY??null;pointer(event);};
    const touchmove=(event:TouchEvent)=>{
      const nextY=event.touches[0]?.clientY??null;
      if(nextY!==null&&lastTouchY!==null&&Math.abs(nextY-lastTouchY)>=0.5)markUserScrollIntent(nextY<lastTouchY?"down":"up");
      lastTouchY=nextY;
    };
    const touchend=()=>{lastTouchY=null;};
    node.addEventListener("wheel",wheel,{passive:true});
    node.addEventListener("touchstart",touchstart,{passive:true});
    node.addEventListener("touchmove",touchmove,{passive:true});
    node.addEventListener("touchend",touchend,{passive:true});
    node.addEventListener("touchcancel",touchend,{passive:true});
    node.addEventListener("pointerdown",pointer);
    const keyboard=(event:KeyboardEvent)=>{
      if(["ArrowUp","PageUp","Home"].includes(event.key)||(event.key===" "&&event.shiftKey))markUserScrollIntent("up");
      else if(["ArrowDown","PageDown","End"," "].includes(event.key))markUserScrollIntent("down");
    };
    node.addEventListener("keydown",keyboard);
    return{destroy(){node.removeEventListener("wheel",wheel);node.removeEventListener("touchstart",touchstart);node.removeEventListener("touchmove",touchmove);node.removeEventListener("touchend",touchend);node.removeEventListener("touchcancel",touchend);node.removeEventListener("pointerdown",pointer);node.removeEventListener("keydown",keyboard);if(userScrollTimer)clearTimeout(userScrollTimer);}};
  }
  function toLatest() { readingRestorePending=false;scrollingToTop=false;scrollingToLatest=true;followLatest=true;logElement?.scrollTo({ top: logElement.scrollHeight, behavior: "smooth" }); hasNewEvents = false; }
  function toTop() { readingRestorePending=false;scrollingToLatest=false;scrollingToTop=true;followLatest=false;logElement?.scrollTo({ top: 0, behavior: "smooth" }); }
  $: jumpMode=scrollButtonMode(scrollAutoSwitch,nearTop,nearBottom,scrollDirection,hasNewEvents);

  let copiedIndex: string | null = null;
  let openImagePreview:{href:string;path:string}|null=null;
  let copiedTimer: ReturnType<typeof setTimeout> | null = null;
  let expandedAgents = new Set<string>();
  let expandedGroups=new Set<string>();
  function setGroupOpen(id:string,open:boolean){
    if(expandedGroups.has(id)===open)return;
    const next=new Set(expandedGroups);if(open)next.add(id);else next.delete(id);expandedGroups=next;
  }
  let expandedInputs=new Set<string>();
  let foldableInputs=new Set<string>();
  function toggleInputFold(id:string){
    const next=new Set(expandedInputs);
    if(next.has(id))next.delete(id);else next.add(id);
    expandedInputs=next;
  }
  function measureInputFold(node:HTMLElement,params:{id:string;enabled:boolean;expanded:boolean}){
    let current=params;
    const check=()=>{
      if(!current.enabled||current.expanded)return;
      const overflow=node.scrollHeight>node.clientHeight+1;
      if(foldableInputs.has(current.id)===overflow)return;
      const next=new Set(foldableInputs);
      if(overflow)next.add(current.id);else next.delete(current.id);
      foldableInputs=next;
    };
    const observer=new ResizeObserver(check);
    observer.observe(node);
    requestAnimationFrame(check);
    return{update(next:typeof params){current=next;requestAnimationFrame(check);},destroy(){observer.disconnect();}};
  }
  function setAgentOpen(id:string,open:boolean){
    if(expandedAgents.has(id)===open)return;
    const next=new Set(expandedAgents);if(open)next.add(id);else next.delete(id);expandedAgents=next;
  }
  let lanesOpen=false;
  const agentRowId=(id:string)=>`agent-row-${id.replace(/[^A-Za-z0-9_-]/g,"")}`;
  // The pinned bar has to survive scrolling away from the turn that spawned the
  // children, so it reads the latest turn instead of the turn being rendered.
  $: liveAgents=sortAgentsByAttention(parallelAgentCards(turns.at(-1)?.process??[],rootThreadId));
  $: liveAgentTally=parallelAgentTally(liveAgents);
  $: fanoutBarVisible=parallelAgentsActive(liveAgents);
  $: if(!fanoutBarVisible&&lanesOpen)lanesOpen=false;
  const agentElapsed=(agent:ParallelAgentCard)=>{
    const seconds=Math.max(0,Math.floor(((busy?progressNow:Date.now())-(agent.startedAt??progressNow))/1_000));
    return seconds<60?$t("liveness.durationSeconds",{seconds}):$t("liveness.durationMinutes",{minutes:Math.floor(seconds/60),seconds:seconds%60});
  };
  const agentSteps=(agent:ParallelAgentCard)=>agent.events.filter(event=>!isParallelAgentEvent(event)).slice(-4).map(event=>processEventSummary(event));
  async function focusAgent(id:string){
    setAgentOpen(id,true);
    await tick();
    document.getElementById(agentRowId(id))?.scrollIntoView({block:"center",behavior:"smooth"});
  }
  async function copyCard(text: string, index: string) {
    try { await navigator.clipboard.writeText(text); } catch { return; }
    copiedIndex = index;
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => { copiedIndex = null; }, 1500);
  }
  function imagePreviewKeydown(event:KeyboardEvent){if(event.key==="Escape")openImagePreview=null;}
  function openMarkdownFile(event:MouseEvent){
    const target=event.target;
    if(!(target instanceof Element))return;
    const link=target.closest<HTMLAnchorElement>('a[href^="/api/workspaces/"][href*="/files/view?"],a[href^="/?"][href*="view=file"],a[href^="/open-file?"]');
    if(!link)return;
    event.preventDefault();
    if(!onopenfile)return;
    const linkTarget=workspaceViewTarget(link.href);
    if(!linkTarget)return;
    onopenfile({path:linkTarget.path,pathBase:"workspace",workspaceId:linkTarget.workspaceId,...(sourceTaskId?{sourceTaskId}:{}),...(linkTarget.line?{line:linkTarget.line}:{}),initialEdit:false});
  }
  async function markdownClick(event:MouseEvent){
    openMarkdownFile(event);
    const target=event.target;
    if(!(target instanceof Element))return;
    const button=target.closest<HTMLButtonElement>("button[data-copy-code]");
    if(!button)return;
    const code=button.closest(".markdown-code-block")?.querySelector("pre code");
    if(!code)return;
    try{await navigator.clipboard.writeText((code.textContent??"").replace(/\n$/,""));}catch{return;}
    const label=button.querySelector<HTMLElement>("[data-copy-label]");
    button.classList.add("copied");button.setAttribute("aria-label",$t("common.copied"));button.title=$t("common.copied");if(label)label.textContent=$t("common.copied");
    setTimeout(()=>{if(!button.isConnected)return;button.classList.remove("copied");button.setAttribute("aria-label",$t("common.copy"));button.title=$t("common.copy");if(label)label.textContent=$t("common.copy");},1500);
  }
  function markdownInteractions(node:HTMLElement){
    node.addEventListener("click",markdownClick);
    return{destroy:()=>node.removeEventListener("click",markdownClick)};
  }
  function diffEditTarget(event:AgentEvent){
    if(!workspaceId||!onopenfile)return null;
    return fileEventEditTarget(event.metadata,sourceTaskId);
  }
  function imagePreview(event:AgentEvent){
    if(event.metadata?.mediaKind!=="image"||typeof event.metadata?.mediaPath!=="string")return null;
    const pathBase=event.metadata?.mediaPathBase;
    const imageWorkspaceId=typeof event.metadata?.mediaWorkspaceId==="string"?event.metadata.mediaWorkspaceId:workspaceId;
    const imageTaskId=typeof event.metadata?.sourceTaskId==="string"?event.metadata.sourceTaskId:event.taskId??sourceTaskId;
    if(pathBase==="task-output"){
      const href=taskImageOutputHref(imageTaskId,event.metadata.mediaPath);
      return href?{href,path:event.metadata.mediaPath}:null;
    }
    if(pathBase!=="workspace"&&pathBase!=="task-cwd"||!imageWorkspaceId)return null;
    const href=workspaceFilePreviewHref(imageWorkspaceId,event.metadata.mediaPath,pathBase,imageTaskId);
    return href?{href,path:event.metadata.mediaPath}:null;
  }
  type GoogleGrounding={webSearchQueries:string[];sources:Array<{uri:string;title:string}>;renderedContent:string|null};
  function googleGrounding(event:AgentEvent):GoogleGrounding|null{
    const raw=event.metadata?.grounding;if(!raw||typeof raw!=="object"||Array.isArray(raw))return null;
    const item=raw as Record<string,unknown>,safeUri=(value:unknown)=>{try{const url=new URL(String(value??""));return url.protocol==="https:"?url.toString():"";}catch{return"";}};
    const webSearchQueries=(Array.isArray(item.webSearchQueries)?item.webSearchQueries:[]).map(value=>String(value??"").trim()).filter(Boolean).slice(0,10);
    const sources=(Array.isArray(item.sources)?item.sources:[]).map(value=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{}).map(value=>({uri:safeUri(value.uri),title:String(value.title??"").trim().slice(0,300)})).filter(value=>Boolean(value.uri)).slice(0,12);
    const renderedContent=typeof item.renderedContent==="string"&&item.renderedContent.trim()?item.renderedContent.slice(0,6000):null;
    return webSearchQueries.length||sources.length||renderedContent?{webSearchQueries,sources,renderedContent}:null;
  }
  // Auto-stick to the bottom as new events arrive, unless the user scrolled up.
</script>

<svelte:window onkeydown={imagePreviewKeydown}/>

{#snippet eventCard(event: DisplayEvent, cardId: string, fallbackTimestamp:string|null=null)}
  {#if event.type === "context_compaction"}
    <div class="context-boundary" role="status" data-event-type={event.type} data-scroll-anchor={eventAnchorIdentity(event)}><span></span><strong><Sparkles size={14}/>{event.metadata?.trigger==="auto"?$t("conversation.contextAutoCompacted"):$t("conversation.contextCompacted")}</strong><span></span></div>
  {:else if isDiffEvent(event)}
    {@const editTarget=diffEditTarget(event)}
    {@const diffPath=(event.metadata as any)?.path ?? $t("conversation.fileChange")}
    <article class="bubble diff-card" data-event-type={event.type} data-scroll-anchor={eventAnchorIdentity(event)}>
      <span class="diff-head"><FileDiff size={14}/><code class="path-tail-ellipsis" title={diffPath} dir="rtl"><bdi dir="ltr">{diffPath}</bdi></code><button class="diff-edit" disabled={!editTarget} aria-label={`${$t("common.edit")} ${(event.metadata as any)?.path??$t("conversation.file")}`} title={editTarget?$t("common.edit"):$t("workspace.filePathUnresolved")} onclick={()=>editTarget&&onopenfile?.(editTarget)}><Pencil size={13}/><span>{$t("common.edit")}</span></button><em class="add">+{(event.metadata as any)?.additions ?? 0}</em><em class="del">-{(event.metadata as any)?.deletions ?? 0}</em><button class="copy-btn" class:copied={copiedIndex===cardId} aria-label={$t("conversation.copyDiff")} title={$t("common.copy")} onclick={()=>copyCard(String(event.content),cardId)}>{#if copiedIndex===cardId}<Check size={15}/>{:else}<Copy size={15}/>{/if}</button></span>
      <pre class="diff">{#each String(event.content).split("\n") as line}<span class={lineClass(line)}>{line}
</span>{/each}</pre>
    </article>
  {:else if isCommandEvent(event)}
    <article class="bubble cmd-card" data-event-type={event.type} data-scroll-anchor={eventAnchorIdentity(event)}>
      <span class="cmd-head"><SquareTerminal size={14}/>{(event.metadata as any)?.description || $t("conversation.command")}<button class="copy-btn push" class:copied={copiedIndex===cardId} aria-label={$t("conversation.copyCommand")} title={$t("common.copy")} onclick={()=>copyCard(String(event.content),cardId)}>{#if copiedIndex===cardId}<Check size={15}/>{:else}<Copy size={15}/>{/if}</button></span>
      <pre class="term">$ {event.content}</pre>
    </article>
  {:else}
    {@const presentation = presentEvent(event)}
    {@const timestamp = event.timestamp??fallbackTimestamp}
    {@const preview=imagePreview(event)}
    {@const grounding=googleGrounding(event)}
    {@const finalOutput=isFinalOutputEvent(event)}
    {@const liveWriting=liveWritingEventKey===eventAnchorIdentity(event)}
    {#if preview}
      <button type="button" class="conversation-image-card" aria-haspopup="dialog" aria-label={$t("outcome.openImage",{file:preview.path})} title={$t("outcome.openImage",{file:preview.path})} data-event-type={event.type} data-scroll-anchor={eventAnchorIdentity(event)} onclick={()=>openImagePreview=preview}><span><ImageIcon size={15}/><strong>{$t("conversation.image")}</strong><code>{preview.path.split(/[\\/]/).at(-1)}</code><Eye size={14}/></span><img src={preview.href} alt={preview.path} loading="lazy"/></button>
    {:else}
    <article class="bubble {presentation.className}" class:has-card-copy={Boolean(event.content)} class:final-output-card={finalOutput} class:final-output-reveal={revealingFinalEventKeys.has(eventAnchorIdentity(event))} class:live-writing-card={liveWriting} data-event-type={event.type} data-scroll-anchor={eventAnchorIdentity(event)}>
      {#if event.content}<span class="bubble-copy-anchor"><button class="copy-btn" class:copied={copiedIndex===cardId} aria-label={$t("a11y.copyContent")} title={$t("common.copy")} onclick={()=>copyCard(String(event.content),cardId)}>{#if copiedIndex===cardId}<Check size={15}/>{:else}<Copy size={15}/>{/if}</button></span>{/if}
      <span class="bubble-card-head"><span class:final-output-badge={finalOutput}>{#if finalOutput}<Sparkles size={12}/>{$t("conversation.finalAnswer")}{:else}{presentation.label}{/if}</span>{#if timestamp&&(presentation.className==="user"||presentation.className==="agent")}<time class="bubble-card-time" datetime={timestamp}>{formatCardDateTime(timestamp,$locale)}</time>{/if}</span>
      {#if event.serverName || event.toolName}<small>{[event.serverName, event.toolName].filter(Boolean).join(" · ")}</small>{/if}
      {#if event.content}
        {#if isMarkdownEvent(event)}<div class="markdown-body" class:user-input-content={presentation.className==="user"} class:folded={presentation.className==="user"&&!expandedInputs.has(cardId)} use:measureInputFold={{id:cardId,enabled:presentation.className==="user",expanded:expandedInputs.has(cardId)}} use:markdownInteractions>{@html renderMarkdown(event.content,{workspaceId,workspacePath,executionHostId,workspaces:workspaceTargets,inlineImages:presentation.className==="agent"&&event.type!=="message_delta"})}</div>
        {:else}<pre class:user-input-content={presentation.className==="user"} class:folded={presentation.className==="user"&&!expandedInputs.has(cardId)} use:measureInputFold={{id:cardId,enabled:presentation.className==="user",expanded:expandedInputs.has(cardId)}}>{event.content}</pre>{/if}
        {#if presentation.className==="user"&&foldableInputs.has(cardId)}
          {@const inputFoldLabel=$t(expandedInputs.has(cardId)?"conversation.collapseInput":"conversation.expandInput")}
          <button type="button" class="input-fold-toggle" aria-label={inputFoldLabel} title={inputFoldLabel} aria-expanded={expandedInputs.has(cardId)} onclick={()=>toggleInputFold(cardId)}>{#if expandedInputs.has(cardId)}<ChevronUp size={16}/>{:else}<ChevronDown size={16}/>{/if}</button>
        {/if}
      {/if}
      {#if grounding}
        <section class="google-grounding" aria-label={$t("vertexSearch.label")}>
          {#if grounding.sources.length}<div class="grounding-sources"><strong>{$t("vertexSearch.sourcesLabel")}</strong>{#each grounding.sources as source,index}{@const sourceLabel=source.title||$t("vertexSearch.source",{index:index+1})}<a href={source.uri} target="_blank" rel="noopener noreferrer" title={sourceLabel}>{sourceLabel}</a>{/each}</div>{/if}
          {#if grounding.renderedContent}<iframe class="google-search-suggestions" title={$t("vertexSearch.suggestions")} srcdoc={grounding.renderedContent} sandbox="allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation"></iframe>{/if}
        </section>
      {/if}
      {#if liveWriting}<span class="live-writing-wave" role="status" aria-label={$t("conversation.writingResponse")}><i></i><i></i><i></i></span>{/if}
    </article>
    {/if}
  {/if}
{/snippet}

{#snippet eventGroup(group:ProcessEventGroup,cardId:string)}
  <details class="event-group" class:failed={group.failed} open={expandedGroups.has(cardId)} ontoggle={(event)=>setGroupOpen(cardId,event.currentTarget.open)}>
    <summary>
      <span class="event-group-icon">{#if group.group==="command"}<SquareTerminal size={14}/>{:else if group.group==="file"}<FileDiff size={14}/>{:else if group.group==="tool"}<Wrench size={14}/>{:else}<Activity size={14}/>{/if}</span>
      <span class="event-group-copy"><strong>{group.label}</strong><small>{group.latest}</small></span>
      <em>{group.events.length}</em><ChevronDown class="event-group-chevron" size={15}/>
    </summary>
    {#if expandedGroups.has(cardId)}
      <div class="event-group-items">
        {#each group.events as event,index}{@render eventCard(event,`${cardId}-${index}`)}{/each}
      </div>
    {/if}
  </details>
{/snippet}

{#if processRows.length||busy}
  <section class="work-status-drawer" class:open={statusPanelOpen}>
    <button type="button" class="work-status-badge" aria-expanded={statusPanelOpen} onclick={()=>{restoreStatusPanelAtBottom=false;statusPanelOpen=!statusPanelOpen}}>
      <span class="process-state" class:running={busy}>{#if busy}<i class="process-pulse"></i>{:else}<Check size={15}/>{/if}</span>
      <span class="work-status-copy"><strong>{busy?busyText:$t("conversation.workFinished")}</strong>{#if busy&&statusWarnings}<small>{statusWarnings}</small>{:else if !busy&&completionEvidence}<small>{completionEvidence}</small>{/if}</span>
      {#if progress.visible}
        <span class="work-progress-heartbeat" class:quiet={progress.quiet} title={progressHeartbeatLabel} aria-label={progressHeartbeatLabel}>
          <i aria-hidden="true"></i>
          {#if progress.elapsedKnown}<b>{progressElapsedText}</b>{/if}
        </span>
      {/if}
      <ChevronDown size={16}/>
    </button>
    {#if statusPanelOpen}
      <div class="work-status-panel">
        <code>{busy?(statusVisibility.summary||busyText):$t("conversation.workComplete")}</code>
        {#each runningBuilds as build (build.id)}<BuildProgressCard {build}/>{/each}
        {#if finishedBuilds.length}
          <ul class="build-history">
            {#each finishedBuilds.slice(0,BUILD_HISTORY_VISIBLE) as entry (entry.id)}
              {@const duration=buildDurationLabel(entry.durationMs)}
              <li class="build-history-row {entry.status}">
                <span class="build-history-mark">{#if entry.status==="completed"}<Check size={13}/>{:else}<CircleAlert size={13}/>{/if}</span>
                <code title={entry.detail}>{entry.command}</code>
                {#if entry.count>1}<b>×{entry.count}</b>{/if}
                {#if entry.status==="failed"&&entry.exitCode!==null}<em>{$t("build.exitCode",{code:entry.exitCode})}</em>{/if}
                {#if duration}<small>{$t(duration.key,duration.params)}</small>{/if}
              </li>
            {/each}
            {#if finishedBuilds.length>BUILD_HISTORY_VISIBLE}
              <li class="build-history-more">{$t("build.historyMore",{count:finishedBuilds.length-BUILD_HISTORY_VISIBLE})}</li>
            {/if}
          </ul>
        {/if}
        {#if quotaWindow}
          <div class="provider-quota {quotaTone}">
            <span class="provider-quota-head"><strong>{quotaTitle}</strong>{#if quotaPercent!==null}<b>{Math.round(quotaPercent)}%</b>{/if}</span>
            <div class="provider-quota-bar" aria-label={quotaBadge||quotaTitle}><i style={`width:${quotaPercent??0}%`}></i></div>
            {#if quotaWindow.resetsAt}<small>{$t("quota.reset",{label:formatCardDateTime(quotaWindow.resetsAt,$locale)})}</small>
            {:else if quotaWindow.resetLabel}<small>{quotaWindow.resetLabel}</small>{/if}
          </div>
        {/if}
        {#if liveMode!=="History"}
          <div class="work-heartbeat">
            <span class="work-heartbeat-head"><strong>{$t("conversation.activitySignal")}</strong><small>{$t("conversation.activityReset")}</small></span>
            <HeartbeatBar lastEventAt={Date.parse(statusVisibility.lastAt??"")||Date.now()} transport={statusVisibility.transport} phase={statusVisibility.phase==="idle"?"reasoning":statusVisibility.phase}/>
          </div>
        {/if}
        <div class="work-activity-row">
          <div class="work-spark" aria-hidden="true">{#each statusVisibility.bars as height}<i style={`height:${height}px`}></i>{/each}</div>
          <strong>{$t("conversation.eventCount",{count:processRows.length})}</strong>
        </div>
        <div class="work-event-summary">
          <span>{$t("conversation.commandCount",{count:statusVisibility.commandCount})}</span>
          <span>{$t("conversation.fileCount",{count:statusVisibility.fileCount})}</span>
          <span>{$t("conversation.toolCount",{count:statusVisibility.toolCount})}</span>
          <span>{$t("conversation.internalCount",{count:statusVisibility.internalCount})}</span>
        </div>
        {#if detailedProcessRows.length}
          <details class="work-event-details">
            <summary>{$t("conversation.viewWorkDetails")}<span>{detailedProcessRows.length}</span><ChevronDown size={15}/></summary>
            <div class="process-events">
              {#each detailedProcessRows as row,index (row.id)}
                {#if row.kind==="group"}{@render eventGroup(row,`work-${row.id}`)}{:else}{@render eventCard(row.event,`work-event-${index}`)}{/if}
              {/each}
            </div>
          </details>
        {/if}
      </div>
    {/if}
  </section>
{/if}
{#if changedFileEntries.length}
  <section class="changed-files" class:collapsed={changedFilesCollapsed} aria-label={$t("conversation.changedFiles")}>
    <button class="changed-files-toggle" aria-expanded={!changedFilesCollapsed} onclick={()=>changedFilesCollapsed=!changedFilesCollapsed}><FileDiff size={15}/><strong>{$t("conversation.changedFiles")}</strong><em>{changedFileEntries.length}</em><span class="changed-files-chevron" class:open={!changedFilesCollapsed}><ChevronDown size={15}/></span></button>
    {#if !changedFilesCollapsed}<div class="changed-file-chips">{#each changedFileEntries as [file, stat]}{@const canOpen=Boolean(workspaceId&&onopenfile&&fileEventCanOpen({path:file,pathBase:stat.pathBase})&&(stat.pathBase==="workspace"||sourceTaskId))}<button class="cf-chip" class:disabled={!canOpen} disabled={!canOpen} title={canOpen?$t("workspace.openFile"):$t("workspace.filePathUnresolved")} onclick={()=>canOpen&&onopenfile?.({path:file,pathBase:stat.pathBase as "workspace"|"task-cwd",...(sourceTaskId?{sourceTaskId}:{})})}><code class="path-tail-ellipsis" title={file} dir="rtl"><bdi dir="ltr">{file}</bdi></code><em class="add">+{stat.add}</em><em class="del">-{stat.del}</em></button>{/each}</div>{/if}
  </section>
{/if}
<div class="conv-wrap">
<section class="conversation" class:follow-latest={followLatest} class:has-work-panel={processRows.length>0||busy} bind:this={logElement} onscroll={onScroll} use:cancelFollowOnUserInput use:revealOnTap>
  <span class="conversation-top-sentinel" bind:this={topSentinel} aria-hidden="true"></span>
  <div class="conversation-content" bind:this={contentElement}>
  {#if earlierHistoryVisible}
    <div class="transcript-history-anchor" data-scroll-anchor="transcript-history">
      {#if transcriptHistoryLoading}<button type="button" disabled><LoaderCircle class="spin" size={14}/>{$t("conversation.loadingEarlier")}</button>{:else if transcriptCanLoadMore}<button type="button" onclick={()=>onloadtranscripthistory?.()}><ChevronUp size={14}/>{$t(transcriptTruncated?.droppedTurns==null?"conversation.loadEarlierAll":"conversation.loadEarlierTurns",{count:transcriptTruncated?.droppedTurns??0})}</button>{:else}<small>{$t("conversation.earlierLimitReached")}</small>{/if}
    </div>
  {/if}
  {#if fanoutBarVisible}
    <div class="fanout-sticky" class:expanded={lanesOpen}>
    <div class="fanout-bar-pinned">
      <span class="fanout-bar-lead">{$t("fanout.badge",{running:liveAgentTally.running+liveAgentTally.waiting,total:liveAgentTally.total})}</span>
      {#each liveAgents.slice(0,4) as agent (agent.id)}
        <button type="button" class="fanout-chip {agent.status}" onclick={()=>focusAgent(agent.id)}><i></i>{agent.name}</button>
      {/each}
      {#if liveAgents.length>4}<span class="fanout-chip rest">{$t("fanout.rest",{count:liveAgents.length-4})}</span>{/if}
      <span class="fanout-bar-actions">
        {#if liveAgentTally.waiting}<button type="button" class="fanout-bar-alert" onclick={()=>focusAgent(liveAgents[0]!.id)}>{$t("fanout.waiting",{count:liveAgentTally.waiting})}</button>{/if}
        {#if liveAgents.length>2}<button type="button" class="fanout-bar-lanes" aria-expanded={lanesOpen} onclick={()=>lanesOpen=!lanesOpen}><span>{$t(lanesOpen?"fanout.detailsClose":"fanout.details")}</span><ChevronDown size={15}/></button>{/if}
      </span>
    </div>
    {#if lanesOpen}
      <div class="fanout-lanes">
        {#each liveAgents as agent (agent.id)}
          <article class="fanout-lane {agent.status}">
            <header><i></i><strong>{agent.name}</strong><b>{agentElapsed(agent)}</b></header>
            <div class="fanout-lane-steps">
              {#each agentSteps(agent) as step, index}<p class:now={index===agentSteps(agent).length-1&&agent.status==="running"} class:hold={index===agentSteps(agent).length-1&&agent.status==="waiting"}>{step}</p>{/each}
              {#if agent.status==="waiting"}<p class="hold">{agent.waitingReason||$t("fanout.waitingTag")}</p>{/if}
              {#if !agentSteps(agent).length}<p>{$t("conversation.waitingForActivity")}</p>{/if}
            </div>
          </article>
        {/each}
      </div>
    {/if}
    </div>
  {/if}
  {#if runningHistoryVisible}
    <div class="running-history-control"><button type="button" aria-pressed={runningHistoryExpanded} disabled={runningHistoryLoading} onclick={()=>ontogglerunninghistory?.()}>{#if runningHistoryLoading}<LoaderCircle class="spin" size={15}/>{:else if runningHistoryExpanded}<EyeOff size={15}/>{:else}<Eye size={15}/>{/if}{$t(runningHistoryLoading?"conversation.loadingHistory":runningHistoryExpanded?"conversation.hideHistory":"conversation.showHistory")}</button><small>{$t(runningHistoryExpanded?"conversation.historyWithCurrent":"conversation.currentOnly",{count:RUNNING_HISTORY_OUTPUT_LIMIT})}</small></div>
  {/if}
  {#each turns as turn, turnIndex (turn.id)}
    {@const parallelAgents=sortAgentsByAttention(parallelAgentCards(turn.process,rootThreadId))}
    {@const parallelEventSet=new Set(parallelAgents.flatMap(agent=>agent.events))}
    {@const outputTimestamp=[...turn.result].reverse().find(event=>event.timestamp)?.timestamp??[...turn.process].reverse().find(event=>event.timestamp)?.timestamp??(turnIndex===turns.length-1?responseTimestamp:null)}
    {@const lastProcessBlockIndex=turn.timeline.reduce((latest,block,index)=>block.kind==="process"?index:latest,-1)}
    <div class="conversation-turn" class:active-turn={turn.active}>
      {#each turn.request as event, index}{@render eventCard(event, `${turn.id}-request-${index}`)}{/each}
      {#if parallelAgents.length}
        {@const turnTally=parallelAgentTally(parallelAgents)}
        <section class="parallel-agents" aria-label={$t("conversation.agents")}>
          <header><Bot size={15}/><strong>{$t("conversation.agents")}</strong><small>{turnTally.waiting?$t("fanout.waiting",{count:turnTally.waiting}):turnTally.running?$t("conversation.agentRunningCount",{count:turnTally.running}):$t("conversation.allAgentsComplete")}</small><span>{parallelAgents.length}</span></header>
          <div class="parallel-agent-list">
            {#each parallelAgents as agent (agent.id)}
              {@const activityEvents=agent.events.filter(event=>!isParallelAgentEvent(event))}
              <details id={agentRowId(agent.id)} class="parallel-agent-row {agent.status}" open={expandedAgents.has(agent.id)} ontoggle={(event)=>setAgentOpen(agent.id,event.currentTarget.open)}>
                <summary>
                  <span class="parallel-agent-icon">{#if agent.status==="running"}<LoaderCircle size={14}/>{:else if agent.status==="completed"}<Check size={14}/>{:else if agent.status==="waiting"}<Clock3 size={14}/>{:else}<CircleAlert size={14}/>{/if}</span>
                  <span class="parallel-agent-copy"><strong>{agent.name}</strong><small>{agent.waitingReason||agent.activity||agent.prompt||$t("conversation.waitingForActivity")}</small></span>
                  {#if activityEvents.length}<span class="parallel-agent-count">{activityEvents.length}</span>{/if}
                  <b class="parallel-agent-elapsed">{agentElapsed(agent)}</b>
                  <em>{$t(agent.status==="waiting"?"fanout.waitingTag":`task.status.${agent.status}`)}</em><ChevronDown class="parallel-agent-chevron" size={15}/>
                </summary>
                {#if expandedAgents.has(agent.id)}
                  <div class="parallel-agent-detail">
                    {#if agent.prompt}<div class="parallel-agent-prompt"><span>{$t("conversation.instruction")}</span><p>{agent.prompt}</p></div>{/if}
                    <div class="parallel-agent-meta"><code>{agent.id}</code>{#if agent.path}<span>{agent.path}</span>{/if}</div>
                    {#if activityEvents.length}
                      <div class="parallel-agent-events">
                        {#each activityEvents as event, index}{@render eventCard(event, `${turn.id}-agent-${agent.id}-${index}`)}{/each}
                      </div>
                    {:else}<p class="parallel-agent-empty">{$t("conversation.waitingForDetails")}</p>{/if}
                  </div>
                {/if}
              </details>
            {/each}
          </div>
        </section>
      {/if}
      {#each turn.timeline as block, blockIndex (block.id)}
        {#if block.kind==="process"}
          {#each block.events.filter(event=>event.type==="message_delta"||event.type==="message_completed"||Boolean(imagePreview(event))) as event, processIndex}
            {@render eventCard(event, `${turn.id}-${block.id}-message-${processIndex}`, outputTimestamp)}
          {/each}
        {:else}
          {@render eventCard(block.event, `${turn.id}-${block.id}`, outputTimestamp)}
        {/if}
      {/each}
      {#if turn.outputUsage}<div class="output-token-chip" class:exact={turn.outputUsage.exact} aria-live={turn.active?"polite":"off"}><TurnUsageDetails usage={turn.outputUsage} live={turn.active}/></div>{/if}
    </div>
  {/each}
  </div>
</section>
<div class="scroll-jumps">
  {#if jumpMode==="both"||jumpMode==="up"}<button onclick={toTop} aria-label={$t("conversation.scrollTop")} title={$t("conversation.scrollTop")}><ChevronsUp size={17}/></button>{/if}
  {#if jumpMode==="both"||jumpMode==="down"}<button class:has-new={hasNewEvents} onclick={toLatest} aria-label={hasNewEvents?`${$t("conversation.scrollBottom")} · ${$t("conversation.newEvents")}`:$t("conversation.scrollBottom")} title={hasNewEvents?$t("conversation.newEvents"):$t("conversation.scrollBottom")}><ChevronsDown size={17}/>{#if hasNewEvents}<span class="scroll-new" aria-hidden="true"></span>{/if}</button>{/if}
</div>
{#if openImagePreview}
  <div class="image-preview-backdrop" role="presentation" onclick={(event)=>{if(event.target===event.currentTarget)openImagePreview=null}}>
    <dialog open class="image-preview-panel" aria-modal="true" aria-label={$t("outcome.openImage",{file:openImagePreview.path})}>
      <header><ImageIcon size={17}/><code title={openImagePreview.path}>{openImagePreview.path.split(/[\\/]/).at(-1)}</code><a href={openImagePreview.href} target="_blank" rel="noreferrer" aria-label={$t("outcome.openImage",{file:openImagePreview.path})}><ExternalLink size={16}/></a><button type="button" aria-label={$t("common.close")} title={$t("common.close")} onclick={()=>openImagePreview=null}><X size={18}/></button></header>
      <div class="image-preview-stage"><img src={openImagePreview.href} alt={openImagePreview.path}/></div>
    </dialog>
  </div>
{/if}
</div>
