<script lang="ts">
  import { Activity, Archive, ArchiveRestore, ArrowRightLeft, Bot, Check, ChevronDown, ChevronUp, CircleAlert, Clipboard, FileText, GitBranch, GitPullRequest, LoaderCircle, MoreVertical, Pencil, Send, Settings, Square, Trash2, Clock3, X } from "@lucide/svelte";
  import { onMount,tick } from "svelte";
  import { type AgentEvent } from "./events";
  import { pageBlock } from "./pager";
  import { currentViewportBand, popoverPlacement } from "./mobile-viewport";
  import { dismissOnOutside } from "./outside-dismiss";
  import Conversation from "./Conversation.svelte";
  import AttachBar, { type Attachment } from "./AttachBar.svelte";
  import type { AgentRecentStatus } from "./agent-status";
  import { codexConversationEvents, codexTurnsToEvents } from "./codex-turns";
  import SessionBadges from "./SessionBadges.svelte";
  import SessionModelBadges from "./SessionModelBadges.svelte";
  import SessionActivityStrip from "./SessionActivityStrip.svelte";
  import WorkspaceGitOverview from "./WorkspaceGitOverview.svelte";
  import { workspaceGitOverview } from "./session-git-state";
  import { canApplyLiveSnapshot, liveSnapshotSequence, mergeLiveEvents, mergeTerminalSnapshot } from "./live-events";
  import { shouldSubmitOnEnter } from "./input-submit";
  import SessionSettingsFields from "./SessionSettingsFields.svelte";
  import { effortLabel, ownershipLabel, permissionLabel as permLabel, relativeTime, shortId, sourceLabel, statusLabel } from "./session-ui";
  import ApprovalPanel from "./ApprovalPanel.svelte";
  import UserInputPanel from "./UserInputPanel.svelte";
  import type { TaskState } from "./task-state";
  import ContextMeter from "./ContextMeter.svelte";
  import { latestContextUsage, type ContextUsage } from "./context-usage";
  import WorkModeChips from "./WorkModeChips.svelte";
  import { workModeOf, type WorkMode } from "./work-mode";
  import AutomationLevelChips from "./AutomationLevelChips.svelte";
  import { automationLevelLabel, automationLevelOf, permissionForAutomation, type AutomationLevel } from "./automation-level";
  import { acknowledgeDangerFullAccess, dangerFullAccessAcknowledged, requestDangerFullAccessAcknowledgement } from "./danger-confirmation";
  import { defaultSessionHeadingCollapsed } from "./mobile-viewport";
  import HandoffDialog from "./HandoffDialog.svelte";
  import ProviderExecutionPicker from "./ProviderExecutionPicker.svelte";
  import CollaborationTimeline from "./CollaborationTimeline.svelte";
  import MessageQueue from "./MessageQueue.svelte";
  import { mergeWorkspaceRecords } from "./identity-selectors";
  import { sessionMatchesConversationScope, type ConversationSessionScope } from "./conversation-session-scope";
  import type { SessionClassificationContext } from "./session-classification";
  import { locale, t } from "./i18n";
  import { subscribeTaskLiveness } from "./liveness";
  import { applyChromePhase, bottomChromeProgress, chromeCollapse, chromeSlide, chromeVisible, setChromeBlocking, updateChromeDistance } from "./immersive-chrome";
  import { shouldAutoFoldSessionChrome } from "./scroll-navigation";
  import { createLatestRequestGate } from "./latest-request";
  import { sessionSearchMatch } from "./session-search";
  import { recoverCodexSessionLocation } from "./codex-session-location";
  import { isTransientApiError } from "./api-client";
  import type { ApiRequestOptions } from "./api-client";
  import TaskOutcomeSummary from "./TaskOutcomeSummary.svelte";
  import { hasTaskOutcomeDetails, taskOutcomeSummary } from "./task-outcome";
  import TaskRecoveryCard from "./TaskRecoveryCard.svelte";
  import PullRequestDialog from "./PullRequestDialog.svelte";
  import { readRunningHistoryPreference, runningHistoryPreferenceKey, writeRunningHistoryPreference } from "./running-history-preference";
  export let api:(path:string,init?:RequestInit,options?:ApiRequestOptions)=>Promise<any>;
  export let query = "";
  export let status:""|"running"|"waiting"|"completed"|"failed"="";
  export let projectId="";
  export let source="";
  export let ownership="";
  export let model="";
  export let archived=false;
  export let active=true;
  export let sessionScope:ConversationSessionScope="regular";
  export let classificationContext:SessionClassificationContext={};
  export let onRecentStatus:((recent:AgentRecentStatus|null)=>void)|null=null;
  export let taskState:TaskState<any>;
  export let enterToSend=false;
  export let scrollAutoSwitch=true;
  export let projects:Array<{id:string;name:string;enabled:boolean}>=[];
  export let workspaces:Array<{id:string;projectId:string;hostId:string;displayName:string;canonicalPath:string;lastGitStatus?:Record<string,unknown>|null;lastVerifiedAt?:string|null}>=[];
  export let hosts:Array<{id:string;displayName:string}>=[];
  export let modelOptions:any[]=[];
  export let providerQuota:any=null;
  export let onDetail:((open:boolean)=>void)|null=null;
  export let onOpenTask:((task:any)=>void)|null=null;
  export let onOpenFile:((file:{path:string;pathBase:"workspace"|"task-cwd";sourceTaskId?:string;workspaceId?:string;line?:number;initialEdit?:boolean})=>void)|null=null;
  export let codexAvatar:"Gpt-Codex"|"Gpt-Sol"="Gpt-Sol";
  export function closeDetail(){ stopLive(); discardLive(); selected=null; selectedAssistId=null; assistOpen=false; renameEditing=false;locationRecoveryLoading=false; liveMode="History"; }
  export async function refreshSessions(){
    const current=selected;
    await load(true,false);
    if(!current)return;
    await Promise.allSettled([
      current.threadId?moreTurns(true):Promise.resolve(),
      current.taskId?loadEvents(current.taskId,true):Promise.resolve(),
      reconcileSelectedStatus()
    ]);
  }
  $: onDetail?.(Boolean(selected));
  let lastQuery = "";
  let searchTimer:ReturnType<typeof setTimeout>|null=null;
  type Session=Record<string,any>;
  let sessions:Session[]=[];let selected:Session|null=null;let turns:any[]=[];let nextCursor:string|null=null;let turnCursor:string|null=null;let turnsLoading=false;
  let showRunningHistory=false,runningHistoryPreference="";
  function syncRunningHistoryPreference(item:Session|null=selected){
    const sessionId=item?.threadId??item?.taskId??"",next=sessionId?runningHistoryPreferenceKey("codex",sessionId):"";
    if(next===runningHistoryPreference)return;
    runningHistoryPreference=next;showRunningHistory=next?readRunningHistoryPreference(localStorage,"codex",sessionId):false;
  }
  $: syncRunningHistoryPreference(selected);
  const defaultHeadingCollapsed=()=>defaultSessionHeadingCollapsed(typeof window==="undefined"?Number.POSITIVE_INFINITY:window.innerWidth);
  let headingCollapsed=defaultHeadingCollapsed();let headingKey="";let outcomeMobileExpanded=false;let outcomeMobileDismissed=false;let outcomeTaskKey="";
  $: {const nextHeadingKey=selected?.threadId??selected?.taskId??"";if(nextHeadingKey!==headingKey){headingKey=nextHeadingKey;headingCollapsed=defaultHeadingCollapsed();}}
  $: {const nextOutcomeTaskKey=selected?.taskId??selected?.threadId??"";if(nextOutcomeTaskKey!==outcomeTaskKey){outcomeTaskKey=nextOutcomeTaskKey;outcomeMobileExpanded=false;outcomeMobileDismissed=false;}}
  // Mirrors the Claude detail view: phones fade the whole chrome, while wider
  // screens keep bottom controls fixed and fold only the heading while reading.
  $: setChromeBlocking("codex",Boolean(selected&&(selected.status==="waiting"||selected.metadata?.approvalLoop)));
  // Mirrors the Claude detail: only the action with a deadline stays in the
  // phone row, the rest live in one sheet so nothing wraps, clips or hides.
  let sessionMenuOpen=false,sessionMenuStyle="",sessionMenuTrigger:HTMLButtonElement|undefined,sessionMenu:HTMLDivElement|undefined;
  function placeSessionMenu(){
    if(!sessionMenuTrigger||!sessionMenu)return;
    const band=currentViewportBand(),rect=sessionMenuTrigger.getBoundingClientRect();
    const width=Math.min(280,Math.max(200,band.width-24));
    const spot=popoverPlacement({top:rect.top,bottom:rect.bottom,left:rect.left},{width,height:sessionMenu.scrollHeight},band);
    sessionMenuStyle=`left:${spot.left}px;top:${spot.top}px;width:${width}px;max-height:${spot.maxHeight}px`;
  }
  const runAndCloseSessionMenu=(run:()=>void)=>{closeSessionMenu();run();};
  function closeSessionMenu(){if(!sessionMenuOpen)return;sessionMenuOpen=false;try{sessionMenu?.hidePopover();}catch{}}
  function toggleSessionMenu(){
    if(sessionMenuOpen)return closeSessionMenu();
    sessionMenuOpen=true;
    requestAnimationFrame(()=>{try{sessionMenu?.showPopover();}catch{}placeSessionMenu();});
  }
  $: chromeHidden=!$chromeVisible;
  $: if(!selected||bottomChromeHidden)closeSessionMenu();

  $: bottomChromeHidden=$bottomChromeProgress<=0;
  // A reader sitting at the very end of the log must be able to see the session
  // controls. The direction-based rule misses the case where the browser clamps
  // scrollTop after the log shrank: that arrives as an upward scroll at the
  // bottom, which is deliberately ignored, so nothing ever expanded them again.
  const handleConversationScroll=(direction:"down"|"up",scrollTop:number,nearBottom:boolean)=>{if(!shouldAutoFoldSessionChrome(direction,scrollTop,nearBottom))return;if(!chromeHidden&&!headingCollapsed)headingCollapsed=true;};
  let publishedRecent="";
  function publishRecentItem(item:Session|null|undefined){const recent:AgentRecentStatus|null=item?{provider:"codex",taskId:item.taskId??null,status:item.status??"unknown",title:item.title??$t("session.untitledCodex"),updatedAt:item.updatedAt??new Date(0).toISOString(),threadId:item.threadId??null}:null;const key=JSON.stringify(recent);if(key!==publishedRecent){publishedRecent=key;onRecentStatus?.(recent);}}
  const recentFrom=(rows:Session[])=>{const activeRows=rows.filter(item=>["pending","queued","running","waiting"].includes(item.status));return [...(activeRows.length?activeRows:rows)].sort((a,b)=>String(b.updatedAt??"").localeCompare(String(a.updatedAt??"")))[0];};
  function publishRecent(){publishRecentItem(recentFrom(sessions));}
  let recentLoading=false;
  const scopedSessions=(rows:Session[])=>rows.filter(item=>sessionMatchesConversationScope(item,sessionScope,$taskState,classificationContext));
  // Native Codex threads can arrive before the matching Workhouse task list.
  // Re-apply the scope when task metadata catches up so linked threads cannot
  // remain stranded in the provider tab.
  $:{
    $taskState;classificationContext;
    const scoped=scopedSessions(sessions);
    if(scoped.length!==sessions.length){sessions=scoped;publishRecent();}
  }
  async function pollRecent(){if(!active||recentLoading||document.visibilityState==="hidden")return;recentLoading=true;try{const d=await api("/api/codex/threads?limit=20&archived=false",{}, {caller:"CodexSessions.pollRecent"}),rows=scopedSessions(d.sessions??[]);publishRecentItem(recentFrom(rows));const refreshed=selected?.threadId?rows.find((item:Session)=>item.threadId===selected?.threadId):null;if(refreshed?.canMutate)applySelectedLocation(refreshed);}catch{}finally{recentLoading=false;}}
  let loading=true;let loadingMore=false;let initialLoadComplete=false;let filterApplying=false;let filterStage:"debounce"|"request"="request";let filterSlow=false;let filterSlowTimer:ReturnType<typeof setTimeout>|null=null;let stale=false;let syncedAt:string|null=null;let error="";let search="";let deleteOpen=false;let deleteAcknowledged=false;
  const loadRequests=createLatestRequestGate();
  function beginFilterFeedback(stage:"debounce"|"request"="request"){filterApplying=true;filterStage=stage;filterSlow=false;if(filterSlowTimer)clearTimeout(filterSlowTimer);filterSlowTimer=stage==="request"?setTimeout(()=>filterSlow=true,900):null;}
  function finishFilterFeedback(){filterApplying=false;filterSlow=false;if(filterSlowTimer)clearTimeout(filterSlowTimer);filterSlowTimer=null;}
  // Invalidate an in-flight result as soon as search text changes, including
  // during the debounce window. It must never paint rows for the old query.
  $: if (query !== lastQuery) { lastQuery = query; search = query; loadRequests.begin(); if(filtersReady)beginFilterFeedback("debounce");if (searchTimer) clearTimeout(searchTimer); searchTimer = setTimeout(() => load(), 300); }
  let bulkMode=false;let bulkSelected=new Set<string>();let bulkDeleteOpen=false;let bulkAcknowledged=false;let bulkDeleting=false;let bulkProgress="";
  let statusReady=false;let loadedStatus=status;
  $: if(statusReady&&status!==loadedStatus){loadedStatus=status;void load();}
  const filterSignature=()=>JSON.stringify({projectId,source,ownership,model,archived});
  let filtersReady=false;let loadedFilters="";
  $: if(filtersReady){const next=filterSignature();if(next!==loadedFilters){loadedFilters=next;void load();}}
  let actionOpen=false;let followup="";let sending=false;let followupStarting=false;let contextRequestBusy=false;let capabilities:any={};let settingsOpen=false;let handoffOpen=false;let pullRequestOpen=false;let assistOpen=false;let assistPrompt="";let assistSourceContent="";let assistTargetProvider:"codex"|"claude"|"deepseek"|"ollama"|"antigravity"|"grok"="claude";let assistTargetModel="";let assistTargetEffort="default";let assistTargetTier:string|null=null;let selectedAssistId:string|null=null;let messageQueueRef:any=null;
  let renameEditing=false;let renameTitle="";let renameSaving=false;
  let msgAttachments:Attachment[]=[];
  let msgAttachRef:any=null;
  const withAttachments=(text:string,files:Attachment[])=>files.length?`${text.trim()}\n\n${$t("attachment.promptInstruction")}\n${files.map(f=>`- ${f.path} (${f.name})`).join("\n")}`:text;
  function submitFollowupKey(event:KeyboardEvent){if(!shouldSubmitOnEnter(event,enterToSend)||sending||(!followup.trim()&&!msgAttachments.length))return;event.preventDefault();void sendFollowup();}
  let page=1;const PAGE_SIZE=20;
  let catalog:any={models:[],permissions:[]};let selectedModel="";let selectedEffort="";let selectedTier:string|null=null;let selectedPermission=":workspace";let selectedWorkMode:WorkMode="default";let selectedAutomation:AutomationLevel="auto";let dangerAcknowledged=dangerFullAccessAcknowledged();let dangerConfirmed=dangerAcknowledged;let selectedProject="";let selectedWorkspace="";
  const selectableModels=()=>modelOptions.length?modelOptions:(catalog.models??[]).filter((item:any)=>!item.hidden);
  const selectedHost=()=>selected?.executionHostId??"local";
  const workspaceChoices=()=>mergeWorkspaceRecords(workspaces);
  const gitOverviewForAllSessions=()=>workspaceGitOverview([...sessions,...$taskState],workspaceChoices());
  const conversationWorkspacePath=(session:Session)=>session.cwd??workspaceChoices().find(item=>item.id===session.workspaceId)?.canonicalPath??null;
  const locationChoices=()=>workspaceChoices().filter(item=>item.hostId===selectedHost()&&item.projectId===selectedProject);
  const hostLocations=()=>workspaceChoices().filter(item=>item.hostId===selectedHost());
  const projectName=(id:string)=>projects.find(item=>item.id===id)?.name??id;
  const hostName=(id:string|null|undefined)=>hosts.find(item=>item.id===(id??"local"))?.displayName??(id??$t("common.unknown"));
  function syncSelectedWorkspace(){const choices=locationChoices();if(!choices.some(item=>item.id===selectedWorkspace))selectedWorkspace=choices[0]?.id??"";}
  let events:AgentEvent[]=[];let liveMode:"Live"|"Delayed"|"History"="History";let liveUnsubscribe:(()=>void)|null=null;let liveScope=0;let lastLiveSequence=0;const liveIds=new Set<string>();let liveQueue:AgentEvent[]=[];let liveTimer:ReturnType<typeof setTimeout>|null=null;
  let contextUsage:ContextUsage|null=null;
  $: contextUsage=latestContextUsage(events,selected?.contextUsage??selected?.metadata?.contextUsage);
  $: historyEvents=codexTurnsToEvents(turns,selected?.cwd??null);
  $: conversationEvents=codexConversationEvents(historyEvents,events,Boolean(showRunningHistory&&selected&&activeStatus(selected.status)));
  let detailFileEntries:Array<{path:string;add:number;del:number;pathBase:"workspace"|"task-cwd"|"unresolved"}>=[];
  $: {
    const files=new Map<string,{add:number;del:number;pathBase:"workspace"|"task-cwd"|"unresolved"}>();
    for(const event of conversationEvents){
      if(event.type!=="file_change_started"&&event.type!=="file_change_completed")continue;
      const path=String(event.metadata?.path??"");if(!path)continue;
      const rawBase=event.metadata?.pathBase,pathBase=rawBase==="workspace"||rawBase==="task-cwd"?rawBase:"unresolved";
      const current=files.get(path)??{add:0,del:0,pathBase};
      current.add+=Number(event.metadata?.additions??0);current.del+=Number(event.metadata?.deletions??0);
      if(current.pathBase!==pathBase)current.pathBase="unresolved";
      files.set(path,current);
    }
    detailFileEntries=[...files].map(([path,stats])=>({path,...stats}));
  }
  const statusIcon=(value:string)=>value==="completed"?Check:value==="failed"?CircleAlert:value==="running"?Activity:value==="waiting"?Clock3:value==="stopped"?Square:Clock3;
  const executionBackendLabel=(metadata:any)=>metadata?.executionBackend?$t(`execution.${metadata.executionBackend}`):metadata?.executionUiLabel??null;
  function filterSummary(){const values=[search.trim()?`${$t("common.search")}: ${search.trim()}`:null,projectId?`${$t("session.project")}: ${projectName(projectId)}`:null,source?`${$t("session.source")}: ${sourceLabel(source)}`:null,ownership?`${$t("session.owner")}: ${ownershipLabel(ownership)}`:null,status?`${$t("session.statusFilter")}: ${statusLabel(status)}`:null,model?`${$t("session.model")}: ${model}`:null,archived?$t("session.archived"):null].filter(Boolean);return values.join(" · ")||$t("common.all");}
  function filterProgressBody(){const filters=filterSummary();return $t(filterStage==="debounce"?"session.filterDebounceReason":filterSlow?"session.filterDelayedReason":"session.filterRequestReason",{filters});}
  function params(cursor:string|null=null){const p=new URLSearchParams({limit:"50",archived:String(archived)});if(cursor)p.set("cursor",cursor);if(projectId)p.set("projectId",projectId);if(source)p.set("source",source);if(ownership)p.set("ownership",ownership);if(status)p.set("status",status);if(model)p.set("model",model);if(search.trim())p.set("search",search.trim());return p;}
  async function load(reset=true,feedback=true){
    const generation=reset?loadRequests.begin():loadRequests.value();
    if(reset){nextCursor=null;page=1;loadingMore=false;loading=!sessions.length&&!initialLoadComplete;if(feedback&&(initialLoadComplete||filterApplying))beginFilterFeedback("request");else finishFilterFeedback();}
    else loadingMore=true;
    try{
      const searching=Boolean(search.trim());
      const d=await api(searching?`/api/codex/search?q=${encodeURIComponent(search.trim())}&limit=50${!reset&&nextCursor?`&cursor=${nextCursor}`:""}`:`/api/codex/threads?${params(reset?null:nextCursor)}`,{}, {caller:"CodexSessions.load"});
      if(!loadRequests.isCurrent(generation))return;
      const rows=scopedSessions(searching?d.results:d.sessions);
      sessions=reset?rows:[...sessions,...rows.filter((x:Session)=>!sessions.some(y=>y.threadId===x.threadId&&y.jobId===x.jobId))];
      const refreshed=selected?.threadId?sessions.find(item=>item.threadId===selected?.threadId):null;
      if(refreshed?.canMutate)applySelectedLocation(refreshed);
      if(reset&&bulkMode)bulkSelected=new Set([...bulkSelected].filter(id=>sessions.some(item=>item.threadId===id)));
      nextCursor=d.nextCursor;stale=searching?Boolean(d.fallback):d.stale;syncedAt=searching?new Date().toISOString():d.syncedAt;capabilities=searching?{...capabilities,search:!d.fallback}:d.capabilities??{};error="";publishRecent();
    }catch(e){if(loadRequests.isCurrent(generation))error=isTransientApiError(e)?"":e instanceof Error?e.message:String(e);}
    finally{if(loadRequests.isCurrent(generation)){if(reset){initialLoadComplete=true;loading=false;finishFilterFeedback();}else loadingMore=false;}}
  }
  // Native thread pages can be large. Never drain the full history in the
  // background: each page also reconciles provider and SQLite metadata.
  async function loadNext(){if(nextCursor&&!loadingMore)await load(false);}
  const activeStatus=(value:string)=>["pending","queued","running","waiting"].includes(value);
  const terminalStatus=(value:string)=>["completed","failed","stopped"].includes(value);
  const canBulkDelete=(item:Session)=>Boolean(capabilities.delete&&item.threadId&&!activeStatus(item.status));
  const selectedBulkSessions=()=>sessions.filter(item=>item.threadId&&bulkSelected.has(item.threadId));
  function startBulkMode(){bulkMode=true;bulkSelected=new Set();error="";}
  function exitBulkMode(){bulkMode=false;bulkSelected=new Set();bulkDeleteOpen=false;bulkAcknowledged=false;bulkProgress="";}
  function toggleBulk(item:Session){if(!canBulkDelete(item))return;const next=new Set(bulkSelected);if(next.has(item.threadId))next.delete(item.threadId);else next.add(item.threadId);bulkSelected=next;}
  function togglePageBulk(items:Session[]){const eligible=items.filter(canBulkDelete);const allSelected=eligible.length>0&&eligible.every(item=>bulkSelected.has(item.threadId));const next=new Set(bulkSelected);for(const item of eligible){if(allSelected)next.delete(item.threadId);else next.add(item.threadId);}bulkSelected=next;}
  function openBulkDelete(){if(!bulkSelected.size)return;bulkAcknowledged=false;bulkProgress="";bulkDeleteOpen=true;}
  function closeBulkDelete(){if(bulkDeleting)return;bulkDeleteOpen=false;bulkAcknowledged=false;bulkProgress="";}
  function flushLive(){if(liveTimer)clearTimeout(liveTimer);liveTimer=null;if(liveQueue.length)events=mergeLiveEvents(events,liveQueue);liveQueue=[];}
  function discardLive(){if(liveTimer)clearTimeout(liveTimer);liveTimer=null;liveQueue=[];}
  function setSelectedStatus(status:string){if(!selected)return;selected={...selected,status,canStop:activeStatus(status)&&Boolean(selected.canStop),updatedAt:new Date().toISOString()};if(selected.taskId)taskState.patchStatus("codex",selected.taskId,status,selected.updatedAt);sessions=sessions.map(item=>(item.threadId&&item.threadId===selected?.threadId)||(item.taskId&&item.taskId===selected?.taskId)?selected!:item);publishRecent();}
  function finishSelected(status:string){if(!selected||!terminalStatus(status)||!activeStatus(selected.status))return;setSelectedStatus(status);flushLive();liveMode="History";stopLive();if(selected?.taskId)void loadEvents(selected.taskId,true);if(selected?.threadId)void moreTurns(true);}
  function receiveLive(event:AgentEvent){if(event.eventId&&liveIds.has(event.eventId))return;if(event.eventId){liveIds.add(event.eventId);if(liveIds.size>2000)liveIds.delete(liveIds.values().next().value!);}lastLiveSequence=Math.max(lastLiveSequence,event.sequence??0);liveQueue.push(event);if(!liveTimer)liveTimer=setTimeout(flushLive,100);if(event.terminal)finishSelected(event.type==="task_completed"?"completed":event.type==="task_stopped"?"stopped":"failed");}
  function stopLive(){liveScope++;liveUnsubscribe?.();liveUnsubscribe=null;}
  function startLive(){stopLive();if(selected?.ownership!=="claudex-workhouse"){liveMode="History";return;}if(!active||!selected?.taskId||!activeStatus(selected.status)||document.visibilityState!=="visible"){liveMode=selected&&activeStatus(selected.status)?"Delayed":"History";return;}liveMode="Delayed";const taskId=selected.taskId,scope=liveScope,current=()=>liveScope===scope&&selected?.taskId===taskId;liveUnsubscribe=subscribeTaskLiveness({provider:"codex",taskId,after:lastLiveSequence,onChange:()=>{},onStatus:(status)=>{if(current())liveMode=status==="live"?"Live":"Delayed";},onEvent:(event)=>{if(current())receiveLive(event);},onResync:()=>{if(!current())return;liveMode="Delayed";if(selected?.taskId)void loadEvents(selected.taskId,true);else if(selected?.threadId)void moreTurns(true);void reconcileSelectedStatus();}});}
  async function loadEvents(taskId:string,preserveLive=false){try{const d=await api(`/api/tasks/codex/${encodeURIComponent(taskId)}/events`);if(selected?.taskId!==taskId||!canApplyLiveSnapshot(lastLiveSequence,d.latestSequence))return;const snapshot=Array.isArray(d.events)?d.events:[];events=preserveLive&&events.length?mergeTerminalSnapshot(snapshot,events):snapshot;lastLiveSequence=Math.max(lastLiveSequence,liveSnapshotSequence(d.latestSequence));if(typeof d.status==="string"&&terminalStatus(d.status))finishSelected(d.status);}catch{}}
  let locationRecoveryLoading=false;
  function applySelectedLocation(location:Session){
    if(!selected||!location.canMutate||location.threadId!==selected.threadId)return;
    const updated:Session={...selected,projectId:location.projectId??selected.projectId,cwd:location.cwd??selected.cwd,executionHostId:location.executionHostId??selected.executionHostId??"local",workspaceId:location.workspaceId??selected.workspaceId,canMutate:true};
    selected=updated;sessions=sessions.map(item=>item.threadId===updated.threadId?{...item,...updated}:item);
  }
  async function recoverSelectedLocation(current:Session){
    if(current.canMutate||!current.taskId||current.ownership!=="claudex-workhouse")return;
    locationRecoveryLoading=true;
    try{
      const d=await api(`/api/tasks/codex/${encodeURIComponent(current.taskId)}`);
      if(selected?.taskId!==current.taskId||!d?.task)return;
      taskState.upsert(d.task);
      const recovered=recoverCodexSessionLocation(selected!,d.task);
      if(recovered.canMutate)applySelectedLocation(recovered);
    }catch{}finally{if(selected?.taskId===current.taskId)locationRecoveryLoading=false;}
  }
  let reconcileLoading=false;
  async function reconcileSelectedStatus(){const current=selected;if(reconcileLoading||!current?.taskId||current.ownership!=="claudex-workhouse"||!activeStatus(current.status)||document.visibilityState==="hidden")return;reconcileLoading=true;try{const d=await api(`/api/tasks/codex/${encodeURIComponent(current.taskId)}`);if(selected?.taskId!==current.taskId||!d?.task)return;taskState.upsert(d.task);const open:Session=recoverCodexSessionLocation(selected!,d.task);const status=String(d.task.status??open.status);if(open.canMutate)applySelectedLocation(open);if(terminalStatus(status))finishSelected(status);else if(activeStatus(status)){const updated:Session={...open,status,updatedAt:d.task.updatedAt??open.updatedAt,canStop:true};selected=updated;sessions=sessions.map(item=>item.taskId===current.taskId||item.threadId===updated.threadId?updated:item);publishRecent();}}catch{}finally{reconcileLoading=false;}}
  async function open(item:Session){stopLive();discardLive();locationRecoveryLoading=false;const linked=item.taskId?$taskState.find((task:any)=>task.id===item.taskId):null,recovered=recoverCodexSessionLocation(item,linked);selected={...recovered,canStop:Boolean(item.canStop&&activeStatus(item.status))};syncRunningHistoryPreference(selected);selectedAssistId=null;assistOpen=false;turns=[];turnCursor=null;actionOpen=false;events=[];lastLiveSequence=0;liveIds.clear();const recovery=selected.canMutate?Promise.resolve():recoverSelectedLocation(selected);if(item.taskId)await Promise.allSettled([loadEvents(item.taskId),recovery]);else await recovery;if(item.threadId&&(!events.length||showRunningHistory&&activeStatus(item.status)))await moreTurns(true);startLive();}
  export async function openTaskSession(task:any){
    if(task?.id)taskState.upsert(task);
    const cached=sessions.find(item=>item.threadId&&item.threadId===task.threadId);
    const item={
      ...(cached??{}),threadId:task.threadId,taskId:task.id,jobId:task.jobId??cached?.jobId??null,projectId:task.projectId??cached?.projectId??null,cwd:task.cwd??cached?.cwd??null,executionHostId:task.executionHostId??cached?.executionHostId??"local",workspaceId:task.workspaceId??cached?.workspaceId??null,
      title:task.title??cached?.title??$t("session.untitledCodex"),preview:task.prompt??cached?.preview??"",source:task.source??cached?.source??"claudex-workhouse",
      ownership:task.ownership??cached?.ownership??(task.owned?"claudex-workhouse":"external"),status:task.status??cached?.status??"unknown",archived:cached?.archived??false,
      requestedModel:task.requestedModel??cached?.requestedModel??null,requestedReasoningEffort:task.requestedReasoningEffort??cached?.requestedReasoningEffort??null,
      requestedServiceTier:task.requestedServiceTier??cached?.requestedServiceTier??null,permissionProfile:task.permissionProfile??cached?.permissionProfile??null,
      updatedAt:task.updatedAt??cached?.updatedAt??new Date().toISOString(),canMutate:Boolean(task.threadId),canStop:Boolean(task.owned&&["pending","queued","running","waiting"].includes(task.status)),metadata:task.metadata??cached?.metadata??{},contextUsage:task.metadata?.contextUsage??cached?.contextUsage??null
    };
    await open(item);
  }
  export async function openSearchResult(result:any){
    const cached=sessions.find(item=>item.threadId===result.threadId);
    await open({...cached,threadId:result.threadId,taskId:result.taskId??cached?.taskId??null,title:result.title??cached?.title??$t("session.untitledCodex"),
      preview:result.snippet??cached?.preview??"",projectId:result.projectId??cached?.projectId??null,workspaceId:result.workspaceId??cached?.workspaceId??null,
      status:result.status??cached?.status??"unknown",updatedAt:result.updatedAt??cached?.updatedAt??new Date().toISOString(),
      source:cached?.source??"unknown",ownership:cached?.ownership??"external",canMutate:Boolean(cached?.canMutate),canStop:false,metadata:cached?.metadata??{}});
    await tick();const needle=String(result.match??"").trim(),card=[...document.querySelectorAll<HTMLElement>(".bubble")].find(item=>needle&&item.textContent?.includes(needle));
    card?.classList.add("history-search-target");card?.scrollIntoView({block:"center"});setTimeout(()=>card?.classList.remove("history-search-target"),1800);
  }
  async function moreTurns(reset=false){if(!selected?.threadId||turnsLoading)return;turnsLoading=true;try{const p=new URLSearchParams({limit:"8"});if(!reset&&turnCursor)p.set("cursor",turnCursor);const d=await api(`/api/codex/threads/${selected.threadId}/turns?${p}`,{}, {caller:"CodexSessions.moreTurns"});const chronological=[...(d.turns??[])].reverse();turns=reset?chronological:[...chronological,...turns];turnCursor=d.nextCursor;}catch(e){error=e instanceof Error?e.message:String(e)}finally{turnsLoading=false}}
  async function toggleRunningHistory(){const next=!showRunningHistory,sessionId=selected?.threadId??selected?.taskId;showRunningHistory=next;if(sessionId)writeRunningHistoryPreference(localStorage,"codex",sessionId,next);if(next&&selected?.threadId&&!turns.length)await moreTurns(true);}
  async function mutate(suffix:string,method="POST",body:any={}){if(!selected?.threadId||sending)return null;sending=true;followupStarting=suffix==="messages";try{const d=await api(`/api/codex/threads/${selected.threadId}/${suffix}`,{method,headers:{"Idempotency-Key":crypto.randomUUID()},body:JSON.stringify(body)});if(suffix==="messages"){stopLive();discardLive();const started={...d.task,status:d.task.status??"running",updatedAt:d.task.updatedAt??new Date().toISOString()},latestPrompt=String(started.prompt??body?.prompt??selected.preview??"");taskState.upsert(started);selected={...selected,status:started.status,taskId:started.id,preview:latestPrompt,canStop:Boolean(started.owned),updatedAt:started.updatedAt};sessions=sessions.map(item=>item.threadId===selected?.threadId?selected!:item);publishRecent();followup="";msgAttachments=[];events=[];lastLiveSequence=0;liveIds.clear();startLive()}if(suffix==="fork"){if(d?.task)taskState.upsert(d.task);await load();selected=null}if(suffix==="archive"||suffix==="unarchive"){selected=null;await load()}actionOpen=false;return d;}catch(e){error=e instanceof Error?e.message:String(e);return null;}finally{sending=false;followupStarting=false;}}
  async function sendFollowup(){if(!selected||sending||(!followup.trim()&&!msgAttachments.length))return;if(!activeStatus(selected.status))return mutate("messages","POST",{prompt:withAttachments(followup,msgAttachments)});sending=true;try{const sent=withAttachments(followup,msgAttachments);if(await messageQueueRef?.enqueue(sent)){followup="";msgAttachments=[];}}finally{sending=false;}}
  async function queuedTaskStarted(task:any){if(!selected||task.threadId!==selected.threadId||task.provider!=="codex"||task.id===selected.taskId)return;await openTaskSession(task);}
  async function stop(){if(!selected?.taskId)return;sending=true;try{await api(`/api/tasks/codex/${encodeURIComponent(selected.taskId)}/stop`,{method:"POST",headers:{"Idempotency-Key":crypto.randomUUID()},body:"{}"});setSelectedStatus("stopped");selected={...selected,canStop:false};}catch(e){error=e instanceof Error?e.message:String(e)}finally{sending=false;}}
  async function toggleFollow(){if(!selected?.taskId||selected.ownership==="claudex-workhouse")return;sending=true;try{const enabled=selected.controlState!=="follow",data=await api(`/api/tasks/codex/${encodeURIComponent(selected.taskId)}/follow`,{method:"POST",headers:{"Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({enabled})});selected={...selected,controlState:data.controlState};}catch(e){error=e instanceof Error?e.message:String(e)}finally{sending=false;}}
  async function takeControl(){if(!selected?.taskId||selected.ownership==="claudex-workhouse"||!confirm($t("session.takeControlConfirm")))return;sending=true;try{const data=await api(`/api/tasks/codex/${encodeURIComponent(selected.taskId)}/take-control`,{method:"POST",headers:{"Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({confirm:true})});await openTaskSession(data.task);}catch(e){error=e instanceof Error?e.message:String(e)}finally{sending=false;}}
  const selectedDeckTask=()=>selected?.taskId?$taskState.find((task:any)=>task.id===selected?.taskId):null;
  const selectedOutcomeTask=()=>{const task=selectedDeckTask();return selected?{...selected,...(task??{}),status:selected.status,result:task?.result??selected.result??null,error:task?.error??selected.error??null,metadata:{...selected.metadata,...task?.metadata}}:selected;};
  function currentAssistSource(){
    const task=selectedDeckTask(),result=terminalStatus(selected?.status??"")?String(task?.result??selected?.result??"").trim():"";if(result)return result;
    const rows=(events.length?events:historyEvents).filter((item:any)=>String(item?.content??"").trim()).slice(-80).map((item:any)=>{const role=item.metadata?.role==="user"?$t("conversation.userDefault"):item.metadata?.role==="agent"||item.type==="message_completed"||item.type==="message_delta"?"Codex":item.type.startsWith("command_")?$t("conversation.command"):item.type.startsWith("file_change_")?$t("conversation.fileChange"):$t("conversation.process");return `[${role}] ${String(item.content).trim()}`;});
    return (rows.join("\n\n")||String(task?.log??selected?.preview??"").trim()).slice(-20000);
  }
  function openAssist(){assistSourceContent=currentAssistSource();const active=activeStatus(selected?.status??"");assistPrompt=$t(active?"assist.defaultActivePrompt":"assist.defaultCompletedPrompt",{provider:"Codex",content:assistSourceContent});assistTargetProvider="claude";assistTargetModel="";assistTargetEffort="default";assistTargetTier=null;assistOpen=true;}
  async function createAssist(){if(!selected?.taskId||!selected.workspaceId||!assistTargetModel||!assistPrompt.trim()||!assistSourceContent.trim()||sending)return;sending=true;try{const data=await api(`/api/tasks/codex/${encodeURIComponent(selected.taskId)}/assist`,{method:"POST",headers:{"Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({targetProvider:assistTargetProvider,executionHostId:selected.executionHostId??"local",workspaceId:selected.workspaceId,title:$t("assist.sessionTitle",{title:selected.title}),prompt:assistPrompt,sourceContent:assistSourceContent,model:assistTargetModel,reasoningEffort:assistTargetEffort,serviceTier:assistTargetTier})});selectedAssistId=data.session.id;assistOpen=false;assistPrompt="";assistSourceContent="";}catch(e){error=e instanceof Error?e.message:String(e)}finally{sending=false;}}
  const handoffSource=()=>selected?{...selected,id:selected.taskId,provider:"codex",threadId:selected.threadId,result:selected.preview??null,owned:selected.ownership==="claudex-workhouse"}:null;
  async function handoffCompleted(task:any){handoffOpen=false;taskState.upsert(task);if(onOpenTask)onOpenTask(task);else if(task.provider==="codex")await openTaskSession(task);}
  async function compactContext(){if(!selected?.taskId||!selected.threadId||selected.ownership!=="claudex-workhouse"||activeStatus(selected.status)||contextRequestBusy)return;contextRequestBusy=true;try{const current=selected;const data=await api(`/api/tasks/codex/${encodeURIComponent(current.taskId)}/compact`,{method:"POST",headers:{"Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({confirm:true})});flushLive();stopLive();discardLive();const task=data.task;taskState.upsert(task);selected={...current,taskId:task.id,status:task.status??"pending",updatedAt:task.updatedAt??new Date().toISOString(),canStop:true,metadata:{...current.metadata,...task.metadata,operation:"context_compaction"},contextUsage:task.metadata?.contextUsage??current.contextUsage};sessions=sessions.map(item=>item.threadId===current.threadId?selected!:item);publishRecent();lastLiveSequence=0;liveIds.clear();startLive();}catch(e){error=e instanceof Error?e.message:String(e)}finally{contextRequestBusy=false;}}
  async function saveSettings(){if(!selected?.threadId||!selectedWorkspace)return;const applied=await mutate("settings","PATCH",{model:selectedModel,reasoningEffort:selectedEffort,serviceTier:selectedTier,permissionProfile:selectedPermission,workMode:selectedWorkMode,automationLevel:selectedAutomation,dangerConfirmation:dangerConfirmed,fullAccessAcknowledged:dangerConfirmed,acknowledgementVersion:dangerConfirmed?1:undefined,projectId:selectedProject,workspaceId:selectedWorkspace});if(!applied)return;const canonical=applied.thread??{};selected={...selected,...canonical,threadId:selected.threadId,metadata:{...selected.metadata,...(canonical.metadata??{})}};sessions=sessions.map(item=>item.threadId===selected?.threadId?selected!:item);settingsOpen=false;}
  async function permanentlyDelete(){if(!selected?.threadId||!deleteAcknowledged)return;sending=true;try{await api(`/api/codex/threads/${selected.threadId}`,{method:"DELETE",headers:{"Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({confirmDelete:true,acknowledgeFilesRemain:true})});deleteOpen=false;deleteAcknowledged=false;selected=null;await load();}catch(e){error=e instanceof Error?e.message:String(e)}finally{sending=false;}}
  async function permanentlyDeleteBulk(){if(!bulkAcknowledged||!bulkSelected.size||bulkDeleting)return;const targets=selectedBulkSessions();if(!targets.length){exitBulkMode();return;}bulkDeleting=true;const failures:Array<{id:string;title:string;message:string}>=[];let deleted=0;try{for(const item of targets){bulkProgress=$t("bulk.deletingProgress",{current:deleted+failures.length+1,total:targets.length});try{await api(`/api/codex/threads/${encodeURIComponent(item.threadId)}`,{method:"DELETE",headers:{"Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({confirmDelete:true,acknowledgeFilesRemain:true})});deleted++;}catch(e){failures.push({id:item.threadId,title:item.title||$t("session.untitled"),message:e instanceof Error?e.message:String(e)});}}bulkSelected=new Set(failures.map(item=>item.id));bulkDeleteOpen=false;bulkAcknowledged=false;bulkProgress="";await load();if(failures.length){bulkMode=true;error=$t("bulk.deleteResult",{deleted,failed:failures.length,details:failures.map(item=>`${item.title} (${item.message})`).join(", ")});}else{bulkMode=false;bulkSelected=new Set();}}finally{bulkDeleting=false;}}
  function recordDangerAcknowledgement(){acknowledgeDangerFullAccess();dangerAcknowledged=true;dangerConfirmed=true;}
  async function quickSetWorkMode(mode:WorkMode){if(!selected?.threadId||sending||workModeOf("codex",selected.permissionProfile,selected.metadata)===mode)return;const level=mode==="plan"?"read":automationLevelOf(selected.permissionProfile,selected.metadata),permission=mode==="plan"?":read-only":selected.permissionProfile??":workspace";sending=true;try{await api(`/api/codex/threads/${selected.threadId}/settings`,{method:"PATCH",headers:{"Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({permissionProfile:permission,workMode:mode,automationLevel:level})});selected={...selected,permissionProfile:permission,metadata:{...selected.metadata,workMode:mode,automationLevel:level}};sessions=sessions.map(item=>item.threadId===selected?.threadId?selected!:item);}catch(e){error=e instanceof Error?e.message:String(e)}finally{sending=false;}}
  async function quickSetAutomation(level:AutomationLevel){if(!selected?.threadId||sending||automationLevelOf(selected.permissionProfile,selected.metadata)===level)return;if(level==="full"&&!requestDangerFullAccessAcknowledgement())return;if(level==="full"){dangerAcknowledged=true;dangerConfirmed=true;}const permission=permissionForAutomation("codex",level);sending=true;try{await api(`/api/codex/threads/${selected.threadId}/settings`,{method:"PATCH",headers:{"Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({permissionProfile:permission,automationLevel:level,dangerConfirmation:level==="full",fullAccessAcknowledged:level==="full",acknowledgementVersion:level==="full"?1:undefined})});selected={...selected,permissionProfile:permission,metadata:{...selected.metadata,automationLevel:level}};sessions=sessions.map(item=>item.threadId===selected?.threadId?selected!:item);}catch(e){error=e instanceof Error?e.message:String(e)}finally{sending=false;}}
  function showSettings(){const models=selectableModels();selectedModel=models.some((x:any)=>x.id===selected?.requestedModel)?selected!.requestedModel:models.find((x:any)=>x.isDefault)?.id||models[0]?.id||"";const m=models.find((x:any)=>x.id===selectedModel);selectedEffort=selected?.requestedReasoningEffort||m?.defaultReasoningEffort||"medium";selectedTier=selected?.requestedServiceTier??null;selectedPermission=selected?.permissionProfile||":workspace";selectedWorkMode=workModeOf("codex",selected?.permissionProfile,selected?.metadata);selectedAutomation=automationLevelOf(selected?.permissionProfile,selected?.metadata);selectedProject=typeof selected?.metadata?.nextProjectId==="string"?selected.metadata.nextProjectId:selected?.projectId??"";selectedWorkspace=typeof selected?.metadata?.nextWorkspaceId==="string"?selected.metadata.nextWorkspaceId:selected?.workspaceId??"";syncSelectedWorkspace();dangerConfirmed=dangerAcknowledged;settingsOpen=true;actionOpen=false;}
  function copy(value:string){navigator.clipboard.writeText(value);}
  function copySelected(){if(selected?.threadId)copy(selected.threadId);}
  function beginRename(){if(!selected)return;renameTitle=selected.title??"";renameEditing=true;actionOpen=false;}
  function cancelRename(){renameEditing=false;renameTitle=selected?.title??"";}
  const focusRename=(node:HTMLInputElement)=>{node.focus();node.select();};
  function renameKeydown(event:KeyboardEvent){if(event.isComposing)return;if(event.key==="Escape"){event.preventDefault();cancelRename();}else if(event.key==="Enter"){event.preventDefault();void saveRename();}}
  async function saveRename(){
    const current=selected,title=renameTitle.trim();if(!current?.threadId||!title||renameSaving)return;
    if(title===current.title){cancelRename();return;}
    renameSaving=true;
    try{
      const data=await api(`/api/sessions/codex/${encodeURIComponent(current.threadId)}/title`,{method:"PATCH",headers:{"Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({title})});
      for(const task of data.tasks??[])taskState.upsert(task);
      if(selected?.threadId!==current.threadId)return;
      const updated={...current,title:data.title??title,metadata:{...current.metadata,...(data.thread?.metadata??{}),customTitle:data.title??title}};
      selected=updated;sessions=sessions.map(item=>item.threadId===current.threadId?{...item,title:updated.title,metadata:updated.metadata}:item);renameEditing=false;publishRecent();
    }catch(e){error=e instanceof Error?e.message:String(e);}finally{renameSaving=false;}
  }
  let mounted=false,previousActive=active;
  $: if(mounted&&active!==previousActive){previousActive=active;if(active){void load(true,false);if(selected)startLive();}else stopLive();}
  onMount(()=>{let alive=true;mounted=true;previousActive=active;loadedStatus=status;loadedFilters=filterSignature();statusReady=true;filtersReady=true;void load();void (async()=>{try{const d=await api("/api/providers/codex/models");if(alive)catalog=d.catalog;}catch{}})();const recentTimer=setInterval(()=>{if(active&&document.visibilityState==="visible"){void pollRecent();void reconcileSelectedStatus();}},8000);const visibility=()=>{if(document.visibilityState==="hidden"||!active)stopLive();else{if(selected)startLive();void pollRecent();void reconcileSelectedStatus();}};document.addEventListener("visibilitychange",visibility);return()=>{alive=false;mounted=false;statusReady=false;filtersReady=false;if(searchTimer)clearTimeout(searchTimer);finishFilterFeedback();clearInterval(recentTimer);document.removeEventListener("visibilitychange",visibility);stopLive();discardLive();onDetail?.(false);};});
</script>

{#if error}<button class="session-error" onclick={()=>error=""}>{error}</button>{/if}
{#if !selected}
  <p class="codex-sync-state" class:stale>{stale?"Cached":syncedAt?new Date(syncedAt).toLocaleTimeString($locale):$t("status.checking")}</p>
  {#if filterApplying}<div class="filter-progress" class:slow={filterSlow} role="status" aria-live="polite"><LoaderCircle class="spin" size={17}/><span><strong>{$t(filterStage==="debounce"?"session.filterDebouncing":"session.filterApplying")}</strong><small>{filterProgressBody()}</small></span></div>{/if}
  {#if loading}<div class="session-empty"><LoaderCircle class="spin"/>{$t("common.loading")}</div>
  {:else}
    {@const pageCount=Math.max(1,Math.ceil(sessions.length/PAGE_SIZE))}
    {@const cur=Math.min(page,pageCount)}
    {@const pageSessions=sessions.slice((cur-1)*PAGE_SIZE,cur*PAGE_SIZE)}
    {@const selectableOnPage=pageSessions.filter(canBulkDelete)}
    {@const pageFullySelected=selectableOnPage.length>0&&selectableOnPage.every(item=>bulkSelected.has(item.threadId))}
    <div class="bulk-session-toolbar" class:active={bulkMode}>
      {#if bulkMode}
        <span>{$t("bulk.selected",{count:bulkSelected.size})}</span>
        <button onclick={()=>togglePageBulk(pageSessions)} disabled={!selectableOnPage.length}>{$t(pageFullySelected?"bulk.unselectPage":"bulk.selectPage")}</button>
        <button onclick={exitBulkMode}>{$t("common.cancel")}</button>
        <button class="destructive" onclick={openBulkDelete} disabled={!bulkSelected.size}><Trash2 size={16}/>{$t("common.delete")}</button>
      {:else}
        <span>{$t("bulk.description")}</span>
        <button onclick={startBulkMode} disabled={!capabilities.delete||!sessions.some(canBulkDelete)}><Trash2 size={16}/>{$t("bulk.deleteMultiple")}</button>
      {/if}
    </div>
    <div class="session-list session-browser-list" class:filtering={filterApplying} aria-busy={filterApplying}>
      <WorkspaceGitOverview items={gitOverviewForAllSessions()}/>
      {#each pageSessions as item}
        {@const Icon=statusIcon(item.status)}
        {@const bulkEligible=canBulkDelete(item)}
        {@const bulkChecked=Boolean(item.threadId&&bulkSelected.has(item.threadId))}
        {@const searchMatch=search.trim()?sessionSearchMatch({result:item.preview??""},search):null}
        <button class="task-card session-card" class:terminal-task={!activeStatus(item.status)} class:active-task={activeStatus(item.status)} class:failed={item.status==="failed"} class:bulk-selected={bulkMode&&bulkChecked} class:bulk-unavailable={bulkMode&&!bulkEligible} disabled={bulkMode&&!bulkEligible} aria-pressed={bulkMode?bulkChecked:undefined} title={bulkMode&&!bulkEligible?$t(activeStatus(item.status)?"bulk.cannotDeleteRunning":"bulk.cannotDelete"):undefined} onclick={()=>bulkMode?toggleBulk(item):open(item)}>
          {#if bulkMode}<span class="bulk-check" class:checked={bulkChecked} aria-hidden="true">{#if bulkChecked}<Check size={17}/>{/if}</span>{:else}<span class="status-mark s-{item.status}"><Icon size={17}/></span>{/if}
          <span class="task-copy">
            <strong>{item.title||$t("task.untitled")}</strong>
            <span class="meta">
              <span class="engine codex">Codex</span>
              <SessionModelBadges provider="codex" modelLabel={item.requestedModel??$t("model.default")} effort={item.requestedReasoningEffort} serviceTier={item.requestedServiceTier}/>
              <span class="host-badge">{hostName(item.executionHostId)}</span>
              <span>{item.projectId?projectName(item.projectId):$t("workspace.noWorkspace")}</span>
              {#if !activeStatus(item.status)}<span>{statusLabel(item.status)}</span>{/if}
              <span>{sourceLabel(item.source)}</span>
              <span>{ownershipLabel(item.ownership)}</span>
              {#if item.archived}<span>{$t("session.archived")}</span>{/if}
              {#if bulkMode&&!bulkEligible}<span class="bulk-disabled-reason">{activeStatus(item.status)?$t("task.status.running"):$t("common.delete")}</span>{/if}
              <span>{relativeTime(item.updatedAt)}</span>
            </span>
            <span class="preview" class:search-hit-card={Boolean(searchMatch)}>{#if searchMatch}<span class="search-hit-label">{$t("conversation.result")}</span><span class="search-hit-text">{searchMatch.leading?"…":""}{searchMatch.before}{searchMatch.before?" ":""}<mark>{searchMatch.match}</mark>{searchMatch.after?" ":""}{searchMatch.after}{searchMatch.trailing?"…":""}</span>{:else}{item.preview||item.threadId||item.jobId}{/if}</span>
            <SessionActivityStrip provider="codex" taskId={item.taskId??""} status={item.status} updatedAt={item.updatedAt} startedAt={item.createdAt??null} activity={statusLabel(item.activity??item.status)} streamEnabled={item.ownership==="claudex-workhouse"}/>
          </span>
        </button>
      {/each}
    </div>
    {#if pageCount>1||nextCursor}
      {@const blk = pageBlock(cur,pageCount)}
      <nav class="pager" aria-label={$t("pagination.label")}>
        {#if blk.hasPrev}<button aria-label={$t("pagination.previousBlock")} onclick={()=>page=blk.pages[0]-1}>‹</button>{/if}
        {#each blk.pages as p}<button class:cur={p===cur} onclick={()=>page=p}>{p}</button>{/each}
        {#if blk.hasNext}<button aria-label={$t("pagination.nextBlock")} onclick={()=>page=blk.pages[blk.pages.length-1]+1}>›</button>{/if}
        {#if nextCursor}<button class="pager-more" disabled={loadingMore} onclick={loadNext}>{loadingMore?$t("common.loading"):$t("common.more")}</button>{/if}
      </nav>
    {/if}
  {/if}
{:else}
  <main class="codex-detail">
    <div class="detail-main">
      <section class="task-heading" class:collapsed={headingCollapsed} inert={chromeHidden} use:chromeCollapse>
        <div class="task-heading-top"><SessionBadges provider="codex" status={selected.status} liveMode={liveMode} ownership={selected.ownership}/>{#if headingCollapsed}<strong class="collapsed-title">{selected.title}</strong>{/if}<button class="icon-button more" aria-label={$t("common.more")} onclick={()=>actionOpen=!actionOpen}><MoreVertical size={19}/></button><button class="heading-toggle" aria-label={$t(headingCollapsed?"session.expandTitle":"session.collapseTitle")} title={$t(headingCollapsed?"session.expandTitle":"session.collapseTitle")} onclick={()=>headingCollapsed=!headingCollapsed}>{#if headingCollapsed}<ChevronDown size={18}/>{:else}<ChevronUp size={18}/>{/if}</button></div>
        {#if !headingCollapsed}<div class="heading-expanded">{#if renameEditing}<div class="session-title-editor"><input bind:value={renameTitle} aria-label={$t("session.rename")} maxlength="100" onkeydown={renameKeydown} use:focusRename/><button type="button" class="save" aria-label={$t("common.save")} title={$t("common.save")} disabled={!renameTitle.trim()||renameSaving} onclick={saveRename}>{#if renameSaving}<LoaderCircle class="spin" size={17}/>{:else}<Check size={17}/>{/if}</button><button type="button" aria-label={$t("common.cancel")} title={$t("common.cancel")} disabled={renameSaving} onclick={cancelRename}><X size={17}/></button></div>{:else}<div class="session-title-row"><h1>{selected.title}</h1><button type="button" class="session-title-edit" aria-label={$t("session.rename")} title={$t("session.rename")} onclick={beginRename}><Pencil size={15}/></button></div>{/if}
        <p>{selected.projectId??$t("session.unregisteredProject")} · {sourceLabel(selected.source)}{#if executionBackendLabel(selected.metadata)} · {executionBackendLabel(selected.metadata)}{/if} · {relativeTime(selected.updatedAt)}</p>
        {#if selected.threadId}<div class="id-row"><button class="copy-id" onclick={copySelected} title={$t("session.copyThreadId")}><span>{$t("session.thread")}</span><code>{shortId(selected.threadId)}</code><Clipboard size={15}/></button></div>{/if}</div>{/if}
        <ContextMeter provider="codex" usage={contextUsage} canCompact={Boolean(selected.ownership==="claudex-workhouse"&&selected.threadId)} busy={activeStatus(selected.status)} compacting={contextRequestBusy||Boolean(selected.metadata?.operation==="context_compaction"&&activeStatus(selected.status))} oncompact={compactContext}/>
        {#if actionOpen}<div class="action-menu"><button onclick={showSettings}><Settings/>{$t("session.settings")}</button>{#if selected.archived}<button onclick={()=>mutate("unarchive")}><ArchiveRestore/>{$t("common.back")}</button>{:else}<button onclick={()=>mutate("archive")}><Archive/>{$t("session.archived")}</button>{/if}<hr/><button class="destructive" disabled={!capabilities.delete} onclick={()=>{deleteOpen=true;deleteAcknowledged=false;actionOpen=false}}><Trash2/>{$t("session.deletePermanent")}</button></div>{/if}
      </section>
      {#if selected.taskId}<ApprovalPanel {api} task={{id:selected.taskId,provider:"codex",status:selected.status,executionHostId:selected.executionHostId??null,workspaceId:selected.workspaceId??null,title:selected.title}}/>{/if}
      {#if selected.taskId}<UserInputPanel {api} task={{id:selected.taskId,provider:"codex",title:selected.title,status:selected.status}}/>{/if}
      {#if selected.taskId}<TaskRecoveryCard {api} task={selectedOutcomeTask()} onstarted={openTaskSession}/>{/if}
      {#if !followupStarting}<TaskOutcomeSummary {api} task={selectedOutcomeTask()} events={conversationEvents} mobileCollapsible={selected.canMutate&&selected.ownership==="claudex-workhouse"} mobileExpanded={outcomeMobileExpanded} mobileDismissed={outcomeMobileDismissed} hideOnWide onclose={()=>{outcomeMobileExpanded=false;outcomeMobileDismissed=true;}}/>{/if}
      {#if !events.length&&turnCursor}<button class="load-more" disabled={turnsLoading} onclick={()=>moreTurns(false)}>{$t(turnsLoading?"common.loading":"conversation.moreHistory")}</button>{/if}
      {#if events.length||historyEvents.length}{#key selected?.threadId??selected?.taskId??"closed"}<Conversation provider="codex" events={conversationEvents} request={selected?.preview??""} requestTimestamp={selected?.createdAt??null} responseTimestamp={selected?.updatedAt??null} busy={followupStarting||["pending","queued","running","waiting"].includes(selected?.status??"")&&liveMode!=="History"} liveMode={followupStarting?"Delayed":liveMode} rootThreadId={selected?.threadId??null} {providerQuota} persistedOutputUsage={selectedOutcomeTask()?.metadata?.outputUsage} {scrollAutoSwitch} onScrollDirection={handleConversationScroll} onRevealChrome={()=>applyChromePhase("tap")} onScrollActivity={(top,distance,userInitiated)=>{return userInitiated?applyChromePhase("scrolling",top,distance):updateChromeDistance(distance,top);}} runningHistoryVisible={Boolean(activeStatus(selected?.status??"")&&selected?.threadId)} runningHistoryExpanded={showRunningHistory} runningHistoryLoading={turnsLoading} ontogglerunninghistory={toggleRunningHistory} workspaceId={selected?.workspaceId??null} workspacePath={selected?conversationWorkspacePath(selected):null} executionHostId={selected?.executionHostId??"local"} workspaceTargets={workspaces} sourceTaskId={selected?.taskId??null} onopenfile={(file)=>onOpenFile?.({...file,workspaceId:file.workspaceId??selected?.workspaceId})}/>{/key}
      {:else}<div class="session-empty">{$t("conversation.empty")}</div>{/if}
      {#if selectedAssistId}<CollaborationTimeline collaborationId={selectedAssistId} {api} {codexAvatar} quotaByProvider={{codex:providerQuota}} {enterToSend} embedded onopen={(task)=>onOpenTask?.(task)} onclose={()=>selectedAssistId=null}/>{/if}
      <div class="bottom-chrome-drawer" inert={bottomChromeHidden} use:chromeSlide>
      <div bind:this={sessionMenu} class="session-actions-sheet" popover="manual" role="menu" aria-label={$t("nav.moreActions")} style={sessionMenuStyle} use:dismissOnOutside={{onDismiss:closeSessionMenu,triggerSelector:'[data-popup-trigger="codex-session-actions"]'}}>
        {#if selected.canMutate}<button title={$t("session.fork")} onclick={()=>runAndCloseSessionMenu(()=>mutate("fork"))} disabled={sending}><GitBranch size={19}/><span>{$t("session.fork")}</span></button>{/if}
        {#if selected.taskId&&selected.ownership==="claudex-workhouse"}<button title={$t("handoff.newSessionTitle")} onclick={()=>runAndCloseSessionMenu(()=>handoffOpen=true)} disabled={sending}><ArrowRightLeft size={19}/><span>{$t("handoff.title")}</span></button>{/if}
        {#if selected.taskId&&selected.ownership==="claudex-workhouse"}<button title={$t(!selected.workspaceId?"assist.noWorkspace":activeStatus(selected.status)?"assist.runningTitle":"assist.title")} onclick={()=>runAndCloseSessionMenu(openAssist)} disabled={sending||!selected.workspaceId}><Bot size={18}/><span>{$t("assist.chooseReviewer")}</span></button>{/if}
        {#if selected.taskId&&selected.status==="completed"&&selected.workspaceId&&selectedDeckTask()}<button title={$t("pr.title")} onclick={()=>runAndCloseSessionMenu(()=>pullRequestOpen=true)} disabled={sending}><GitPullRequest size={18}/><span>{$t("pr.action")}</span></button>{/if}
      </div>
      {#if selected.taskId&&selected.threadId&&selected.ownership==="claudex-workhouse"}<MessageQueue bind:this={messageQueueRef} {api} provider="codex" taskId={selected.taskId} threadId={selected.threadId} active={activeStatus(selected.status)} onstarted={queuedTaskStarted}/>{/if}
      {#if selected.canMutate&&selected.ownership==="claudex-workhouse"}<form class="composer with-attach" inert={bottomChromeHidden} onsubmit={(e)=>{e.preventDefault();sendFollowup()}}><div class="chat-settings-bar"><div class="chat-settings-scroll"><WorkModeChips provider="codex" value={workModeOf("codex",selected.permissionProfile,selected.metadata)} disabled={sending} onchange={quickSetWorkMode}/><AutomationLevelChips provider="codex" value={automationLevelOf(selected.permissionProfile,selected.metadata)} disabled={sending} onchange={quickSetAutomation}/><button type="button" class="setting-summary tap" onclick={showSettings} title={$t("session.changeModelPermission")} aria-label={$t("session.modelPermissionSettings")}><Settings size={16}/><span>{selected.requestedModel??$t("session.modelUnknown")}</span><span>{effortLabel(selected.requestedReasoningEffort??"medium")}</span><span>{selected.requestedServiceTier==="priority"?"Fast":"Standard"}</span><span>{automationLevelLabel(automationLevelOf(selected.permissionProfile,selected.metadata))}</span></button></div><button type="button" class="mobile-controls-toggle" data-popup-trigger="codex-session-actions" bind:this={sessionMenuTrigger} aria-haspopup="menu" aria-expanded={sessionMenuOpen} aria-label={$t("nav.moreActions")} title={$t("nav.moreActions")} onclick={toggleSessionMenu}><MoreVertical size={15}/></button></div><AttachBar bind:this={msgAttachRef} bind:attachments={msgAttachments} disabled={sending}/><div class="composer-input" class:with-outcome={!followupStarting&&!outcomeMobileDismissed&&["completed","failed"].includes(selected.status)&&hasTaskOutcomeDetails(taskOutcomeSummary(selectedOutcomeTask(),conversationEvents))}><textarea bind:value={followup} placeholder={$t(activeStatus(selected.status)?"conversation.followupQueuedPlaceholder":"conversation.threadFollowupPlaceholder")} rows="1" maxlength="20000" onkeydown={submitFollowupKey} onpaste={(event)=>void msgAttachRef?.handlePaste(event)}></textarea>{#if !followupStarting&&!outcomeMobileDismissed&&["completed","failed"].includes(selected.status)&&hasTaskOutcomeDetails(taskOutcomeSummary(selectedOutcomeTask(),conversationEvents))}<button type="button" class="outcome-badge" class:failed={selected.status==="failed"} aria-expanded={outcomeMobileExpanded} aria-controls="mobile-task-outcome" aria-label={$t(outcomeMobileExpanded?"outcome.hide":"outcome.show")} title={$t(outcomeMobileExpanded?"outcome.hide":"outcome.show")} onclick={()=>{if(outcomeMobileExpanded){outcomeMobileExpanded=false;outcomeMobileDismissed=true;}else outcomeMobileExpanded=true;}}>{#if selected.status==="failed"}<CircleAlert size={14}/>{:else}<FileText size={14}/>{/if}<span>{$t(selected.status==="failed"?"outcome.badgeFailed":"outcome.badgeSummary")}</span>{#if outcomeMobileExpanded}<ChevronDown size={13}/>{:else}<ChevronUp size={13}/>{/if}</button>{/if}</div>{#if selected.canStop&&activeStatus(selected.status)&&!followup.trim()&&!msgAttachments.length}<button type="button" class="send stop" aria-label={$t("common.stop")} title={$t("common.stop")} onclick={stop} disabled={sending}><Square size={19}/></button>{:else}<button class="send" aria-label={$t(activeStatus(selected.status)?"conversation.queueSend":"common.send")} title={$t(activeStatus(selected.status)?"conversation.queueSend":"common.send")} disabled={(!followup.trim()&&!msgAttachments.length)||sending}><Send/></button>{/if}</form>
      {:else if selected.canMutate&&selected.taskId}<div class="external-control-card"><span><strong>{$t(selected.controlState==="follow"?"session.following":"session.history")}</strong><small>{$t("session.externalOwnershipBody")}</small></span><div><button onclick={toggleFollow}>{$t(selected.controlState==="follow"?"session.stopFollowing":"session.followSafely")}</button><button class="primary" disabled={!terminalStatus(selected.status)} onclick={takeControl}>{$t("session.takeControl")}</button></div>{#if !terminalStatus(selected.status)}<small>{$t("session.takeControlAfterExit")}</small>{/if}</div>
      {:else if locationRecoveryLoading&&selected.ownership==="claudex-workhouse"}<p class="composer-unavailable checking"><LoaderCircle class="spin" size={16}/>{$t("status.checking")}</p>
      {:else}<div class="chat-settings-bar orphan"><button type="button" class="setting-summary tap" disabled title={$t("session.changeModelPermission")} aria-label={$t("session.modelPermissionSettings")}><Settings size={16}/><span>{selected.requestedModel??$t("session.modelUnknown")}</span><span>{effortLabel(selected.requestedReasoningEffort??"medium")}</span><span>{selected.requestedServiceTier==="priority"?"Fast":"Standard"}</span><span>{permLabel(selected.permissionProfile??":workspace")}</span></button></div><p class="composer-unavailable">{$t("session.workspaceUnavailableFollowup")}</p>{/if}
      </div>
    </div>
    <aside class="session-side-rail" aria-label={$t("session.current")}>
      <section>
        <h2>{$t("session.current")}</h2>
        <dl>
          <div><dt>{$t("session.provider")}</dt><dd>Codex</dd></div>
          <div><dt>{$t("common.status")}</dt><dd class="state-text s-{selected.status}">{statusLabel(selected.status)}</dd></div>
          <div><dt>{$t("workspace.label")}</dt><dd>{selected.projectId??$t("session.unregisteredProject")}</dd></div>
          <div><dt>{$t("conversation.lastEvent",{time:""})}</dt><dd>{relativeTime(selected.updatedAt)}</dd></div>
          <div><dt>{$t("session.worker")}</dt><dd>{selected.executionHostId??$t("common.unknown")}</dd></div>
        </dl>
      </section>
      {#if !followupStarting&&["completed","failed"].includes(selected.status)&&hasTaskOutcomeDetails(taskOutcomeSummary(selectedOutcomeTask(),conversationEvents))}<TaskOutcomeSummary {api} task={selectedOutcomeTask()} events={conversationEvents} rail/>{/if}
      {#if followupStarting||!["completed","failed"].includes(selected.status)||!hasTaskOutcomeDetails(taskOutcomeSummary(selectedOutcomeTask(),conversationEvents))}
      <section>
        <h2>{$t("session.controls")}</h2>
        <div class="session-side-actions">
          {#if selected.canMutate}<button title={$t("session.fork")} onclick={()=>mutate("fork")} disabled={sending}><GitBranch size={18}/><span>{$t("session.fork")}</span></button>{/if}
          {#if selected.taskId&&selected.ownership==="claudex-workhouse"}<button title={$t("handoff.newSessionTitle")} onclick={()=>handoffOpen=true} disabled={sending}><ArrowRightLeft size={18}/><span>{$t("handoff.title")}</span></button>{/if}
          {#if selected.taskId&&selected.ownership==="claudex-workhouse"}<button title={$t(!selected.workspaceId?"assist.noWorkspace":activeStatus(selected.status)?"assist.runningTitle":"assist.title")} onclick={openAssist} disabled={sending||!selected.workspaceId}><Bot size={18}/><span>{$t("assist.chooseReviewer")}</span></button>{/if}
          {#if selected.taskId&&selected.status==="completed"&&selected.workspaceId&&selectedDeckTask()}<button title={$t("pr.title")} onclick={()=>pullRequestOpen=true} disabled={sending}><GitPullRequest size={18}/><span>{$t("pr.action")}</span></button>{/if}
        </div>
      </section>
      {/if}
      <section>
        <h2>{$t("conversation.changedFiles")} <span>{detailFileEntries.length}</span></h2>
        {#if detailFileEntries.length}
          <div class="session-side-files">
            {#each detailFileEntries.slice(0,9) as file}
              {@const canOpen=Boolean(selected.workspaceId&&onOpenFile&&file.pathBase!=="unresolved"&&(file.pathBase==="workspace"||selected.taskId))}
              <button disabled={!canOpen} onclick={()=>canOpen&&onOpenFile?.({path:file.path,pathBase:file.pathBase as "workspace"|"task-cwd",sourceTaskId:selected?.taskId??undefined,workspaceId:selected?.workspaceId})}><code class="path-tail-ellipsis" title={file.path} dir="rtl"><bdi dir="ltr">{file.path}</bdi></code><span><em>+{file.add}</em><i>-{file.del}</i></span></button>
            {/each}
          </div>
        {:else}<p class="session-side-empty">{$t("workspace.noChanges")}</p>{/if}
      </section>
    </aside>
  </main>
{/if}

{#if settingsOpen}<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true"><header><h2>{$t("session.settings")}</h2><button class="icon-button" aria-label={$t("a11y.closeDialog")} onclick={()=>settingsOpen=false}>×</button></header>
  <label>{$t("workMode.label")}<WorkModeChips provider="codex" value={selectedWorkMode} onchange={(mode)=>{selectedWorkMode=mode;if(mode==="plan"){selectedAutomation="read";selectedPermission=":read-only";}}}/></label>
  <label>{$t("permission.level")}<AutomationLevelChips provider="codex" value={selectedAutomation} onchange={(level)=>{selectedAutomation=level;selectedPermission=permissionForAutomation("codex",level);dangerConfirmed=level==="full"&&dangerAcknowledged;}}/></label>
  {#if selectedAutomation==="full"&&!dangerAcknowledged}<label class="danger-confirm"><input type="checkbox" bind:checked={dangerConfirmed} onchange={()=>dangerConfirmed&&recordDangerAcknowledgement()}/>{$t("permission.fullAccessAcknowledge")}</label>{/if}
  <SessionSettingsFields provider="codex" models={selectableModels()} permissions={catalog.permissions??[]} bind:model={selectedModel} bind:effort={selectedEffort} bind:tier={selectedTier} bind:permission={selectedPermission} bind:danger={dangerConfirmed} showPermission={false}/>
  <fieldset class="workspace-choice"><legend>{$t("workspace.nextRequest")}</legend><div class="workspace-choice-grid">{#each hostLocations() as workspace}<button type="button" class:active={selectedWorkspace===workspace.id} onclick={()=>{selectedProject=workspace.projectId;selectedWorkspace=workspace.id;}}><strong>{projectName(workspace.projectId)}</strong><small>{workspace.canonicalPath}</small></button>{/each}</div>{#if !hostLocations().length}<small class="field-warning">{$t("workspace.noRegistered")}</small>{/if}</fieldset>
  {#if activeStatus(selected?.status??"")}<small class="field-warning">{$t("workspace.activeRequestUnchanged")}</small>{:else}<small>{$t("workspace.resumeNextRequest")}</small>{/if}
  <button class="primary" onclick={saveSettings} disabled={!selectedWorkspace||(selectedPermission===":danger-full-access"&&!dangerConfirmed)}>{$t("workspace.applyNextRequest")}</button>
</div></div>{/if}
{#if deleteOpen&&selected}<div class="modal-backdrop"><div class="modal delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="codex-delete-title"><header><h2 id="codex-delete-title">{$t("session.deleteCodexTitle")}</h2><button class="icon-button" aria-label={$t("a11y.closeDialog")} onclick={()=>deleteOpen=false}>×</button></header><p><strong>{selected.title}</strong></p><p>{$t("session.deleteBody")}</p><p><strong>{$t("session.deleteFilesWarning")}</strong></p><label class="delete-check"><input type="checkbox" bind:checked={deleteAcknowledged}/>{$t("session.deleteAcknowledge")}</label><div class="delete-actions"><button onclick={()=>deleteOpen=false}>{$t("common.cancel")}</button><button class="destructive" onclick={permanentlyDelete} disabled={sending||!deleteAcknowledged}>{$t("session.deletePermanent")}</button></div></div></div>{/if}
{#if bulkDeleteOpen}<div class="modal-backdrop"><div class="modal delete-dialog bulk-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="codex-bulk-delete-title" aria-busy={bulkDeleting}><header><h2 id="codex-bulk-delete-title">{$t("bulk.deleteCodexTitle",{count:bulkSelected.size})}</h2><button class="icon-button" aria-label={$t("a11y.closeDialog")} onclick={closeBulkDelete} disabled={bulkDeleting}>×</button></header><ul class="bulk-delete-list">{#each selectedBulkSessions().slice(0,5) as item}<li>{item.title||$t("session.untitled")}</li>{/each}{#if bulkSelected.size>5}<li>{$t("bulk.moreCount",{count:bulkSelected.size-5})}</li>{/if}</ul><p>{$t("bulk.deleteBody")}</p><p><strong>{$t("session.deleteFilesWarning")}</strong></p>{#if bulkDeleting}<p class="bulk-delete-progress"><LoaderCircle class="spin" size={18}/>{bulkProgress}</p>{/if}<label class="delete-check"><input type="checkbox" bind:checked={bulkAcknowledged} disabled={bulkDeleting}/>{$t("bulk.deleteAcknowledge")}</label><div class="delete-actions"><button onclick={closeBulkDelete} disabled={bulkDeleting}>{$t("common.cancel")}</button><button class="destructive" onclick={permanentlyDeleteBulk} disabled={bulkDeleting||!bulkAcknowledged}>{bulkDeleting?bulkProgress:$t("bulk.deleteCount",{count:bulkSelected.size})}</button></div></div></div>{/if}
{#if assistOpen&&selected}<div class="modal-backdrop" role="presentation" onclick={(event)=>event.target===event.currentTarget&&(assistOpen=false)}><div class="modal" role="dialog" aria-modal="true" aria-labelledby="codex-assist-title"><header><h2 id="codex-assist-title">{$t("assist.dialogTitle")}</h2><button class="icon-button" aria-label={$t("a11y.closeDialog")} onclick={()=>assistOpen=false}><X size={20}/></button></header><p class="assist-note">{$t(activeStatus(selected.status)?"assist.runningBody":"assist.body")}</p><ProviderExecutionPicker {api} sourceProvider="codex" hostId={selected.executionHostId??"local"} selectionKey="assist" bind:provider={assistTargetProvider} bind:model={assistTargetModel} bind:effort={assistTargetEffort} bind:tier={assistTargetTier}/><label>{$t("assist.request")}<textarea bind:value={assistPrompt} rows="7" maxlength="20000"></textarea></label><button class="primary" onclick={createAssist} disabled={!assistTargetModel||!assistPrompt.trim()||!assistSourceContent.trim()||sending}>{$t(sending?"assist.requesting":"assist.start")}</button></div></div>{/if}
{#if handoffOpen&&handoffSource()}<HandoffDialog {api} source={handoffSource()} onclose={()=>handoffOpen=false} oncomplete={handoffCompleted}/>{/if}
{#if pullRequestOpen&&selected?.taskId&&selectedDeckTask()}<PullRequestDialog {api} task={selectedDeckTask()} events={conversationEvents} onclose={()=>pullRequestOpen=false} oncreated={(task)=>{taskState.upsert(task);selected={...selected,metadata:{...selected?.metadata,...task.metadata}};}}/>{/if}
