<script lang="ts">
  import { Activity, ArrowRightLeft, Bot, EllipsisVertical, FileText, GitBranch, GitPullRequest, Check, ChevronDown, ChevronLeft, ChevronUp, CircleAlert, Clipboard, Clock3, CloudOff, Gauge, Globe, House, KanbanSquare, Link2, LoaderCircle, MessagesSquare, MonitorSmartphone, Pencil, Plus, RefreshCw, Search, Send, Settings, Square, SquareTerminal, Trash2, X, Zap } from "@lucide/svelte";
  import { onDestroy, onMount, tick } from "svelte";
  import { type AgentEvent } from "./events";
  import { pageBlock } from "./pager";
  import CodexSessions from "./CodexSessions.svelte";
  import Conversation from "./Conversation.svelte";
  import AttachBar, { type Attachment } from "./AttachBar.svelte";
  import AgentAvatarDock from "./AgentAvatarDock.svelte";
  import TonePresetSheet from "./TonePresetSheet.svelte";
  import { buildSay } from "./create-summary";
  import { emptyGlobalModelSettings, normalizeGlobalModelSettings, normalizeModelCandidates, type GlobalModelEntry, type GlobalModelSettings } from "./global-model-shape";
  import { activeAgentStatus, activeSessions, avatarSessionRows, chooseProviderRecent, prioritizeCollaborationStatus, recentCompletedSessions, taskForRecentSession, type AgentRecentSession, type AgentRecentStatus, type CollaborationRecentStatuses } from "./agent-status";
  import { connectedParticipants, creationBlockReason, fallbackProvider, participantList, providerAvailability, providerAvailabilityPhase, providerConnected, type ProviderAvailability } from "./provider-availability";
  import { effortLabel, modelLabel, permissionLabel as permLabel, relativeTime as ago, shortId, statusLabel } from "./session-ui";
  import SessionBadges from "./SessionBadges.svelte";
  import SessionModelBadges from "./SessionModelBadges.svelte";
  import SessionActivityStrip from "./SessionActivityStrip.svelte";
  import TaskLivenessPanel from "./TaskLivenessPanel.svelte";
  import CollaborationBoardPanel from "./CollaborationBoardPanel.svelte";
  import CollaborationBoardPage from "./CollaborationBoardPage.svelte";
  import { createBoardCard, getBoardCard, type CollaborationBoardAttachCandidate, type CollaborationBoardCard, type CollaborationBoardExecutionConfig, type CollaborationBoardProvider } from "./collaboration-board";
  import WorkspaceGitOverview from "./WorkspaceGitOverview.svelte";
  import { workspaceGitOverview } from "./session-git-state";
  import { canApplyLiveSnapshot, canApplySnapshotStatus, liveRowsForTask, liveSnapshotSequence, mergeLiveEvents, mergeTerminalSnapshot } from "./live-events";
  import { shouldSubmitOnEnter } from "./input-submit";
  import SessionSettingsFields from "./SessionSettingsFields.svelte";
  import { currentViewportBand, defaultSessionHeadingCollapsed, installKeyboardInset, popoverPlacement } from "./mobile-viewport";
  import { dismissOnOutside } from "./outside-dismiss";
  import { dragScrollX } from "./drag-scroll";
  import { applyChromePhase, bottomChromeProgress, chromeCollapse, chromeSlide, chromeVisible, configureImmersiveChrome, immersiveChromeEnabled, revealImmersiveChrome, IMMERSIVE_END_HEADING_MIN_HEIGHT, setChromeBlocking, updateChromeDistance } from "./immersive-chrome";
  import { shouldAutoFoldSessionChrome } from "./scroll-navigation";
  import { AVATAR_COLLAPSE_DELAYS, AVATAR_TRAY_SHAPES, normalizeAvatarCollapseDelay, readAvatarTrayShape, writeAvatarTrayShape, type AvatarTrayShape } from "./avatar-notice";
  import InfrastructureSettings from "./InfrastructureSettings.svelte";
  import ArtifactSettings from "./ArtifactSettings.svelte";
  import ProjectWorkspaceSettings from "./ProjectWorkspaceSettings.svelte";
  import WorkspaceViewer from "./WorkspaceViewer.svelte";
  import type { WorkspaceViewerLayoutState } from "./workspace-viewer-layout";
  import GitSettings from "./GitSettings.svelte";
  import ProtonDriveSettings from "./ProtonDriveSettings.svelte";
  import SnapshotSettings from "./SnapshotSettings.svelte";
  import McpServerSettings from "./McpServerSettings.svelte";
  import AboutLicenses from "./AboutLicenses.svelte";
  import HandoffDialog from "./HandoffDialog.svelte";
  import ProviderExecutionPicker from "./ProviderExecutionPicker.svelte";
  import WorkChainTimeline from "./WorkChainTimeline.svelte";
  import ApprovalPanel from "./ApprovalPanel.svelte";
  import UserInputPanel from "./UserInputPanel.svelte";
  import { createTaskState } from "./task-state";
  import { beginBackdropPointer,moveBackdropPointer,shouldDismissBackdrop,type BackdropPointer } from "./backdrop-dismiss";
  import SetupWizard from "./SetupWizard.svelte";
  import OwnerClaim from "./OwnerClaim.svelte";
  import ContextMeter from "./ContextMeter.svelte";
  import { latestContextUsage, type ContextUsage } from "./context-usage";
  import { quotaIsStale, quotaNeedsRetry, quotaRetryDelay } from "./quota-retry";
  import WorkModeChips from "./WorkModeChips.svelte";
  import { permissionForWorkMode, workModeOf, type WorkMode } from "./work-mode";
  import AutomationLevelChips from "./AutomationLevelChips.svelte";
  import { automationLevelLabel, automationLevelOf, permissionForAutomation, platformAutomationDefault, shouldApplyPlatformAutomationDefault, type AutomationLevel } from "./automation-level";
  import { acknowledgeDangerFullAccess, dangerFullAccessAcknowledged, requestDangerFullAccessAcknowledgement } from "./danger-confirmation";
  import CollaborationTimeline from "./CollaborationTimeline.svelte";
  import ConversationDocumentManager from "./ConversationDocumentManager.svelte";
  import MessageQueue from "./MessageQueue.svelte";
  import { newestSessionItems } from "./session-browser";
  import { sessionSearchMatch, type SessionSearchMatch } from "./session-search";
  import { DEFAULT_CHARACTERS, TONE_PRESETS, type CharacterSettings, type TonePreset } from "./character-settings";
  import { avatarDisplayMode } from "./provider-name-mark";
  import { requestJson, type ApiRequestOptions } from "./api-client";
  import { applyIndependentRegion, summarizeLoaderFailures, type LoaderFailure } from "./independent-loader";
  import { mergeWorkspaceRecords } from "./identity-selectors";
  import { resolveViewerWorkspace } from "./workspace-recovery";
  import { workspaceViewTarget } from "./markdown";
  import { sessionMatchesConversationScope } from "./conversation-session-scope";
  import { recentRunningConversationEvents } from "./running-history";
  import { readRunningHistoryPreference, runningHistoryPreferenceKey, writeRunningHistoryPreference } from "./running-history-preference";
  import { formatCurrency, formatDateTime, formatQuotaPercentage, locale, saveLocale, t, type SupportedLocale, type Translator } from "./i18n";
  import { subscribeTaskLiveness } from "./liveness";
  import { createProviderRefreshCoordinator, shouldApplyProviderSnapshot } from "./provider-refresh";
  import { latestThreadMember, latestThreadRows } from "./provider-session-grouping";
  import { claudeSelectionTransitions, isClaudeCatalogFallback, type ClaudeCatalogMeta } from "./claude-model-filter";
  import { compatibleDefaultsFromUi, compatibleDefaultsPayload, compatibleUiFromDelegation, reconcileDelegationAfterModelSave } from "./delegation-save";
  import { applyPushPreference } from "./push-preference-apply";
  import { matchingVscodeWorkspace, vscodeContextFromLocation, vscodeContextPrompt, type VscodeContext } from "./vscode-context";
  import { BUILTIN_PROMPT_PRESETS, builtinPromptPresets, codePointSlice, normalizePromptPresets, previewPromptPresetMerge, promptPresetSignature, promptPresetSyncDecision, recommendTaskIntake, type PromptPreset } from "./task-intake";
  import{parseNewRequestTarget}from"./new-request-deep-link";
  import{exchangeLocalEntryFragment}from"./local-entry-bootstrap";
  import PromptPresetSyncNotice from "./PromptPresetSyncNotice.svelte";
  import TaskOutcomeSummary from "./TaskOutcomeSummary.svelte";
  import { hasTaskOutcomeDetails, taskOutcomeSummary } from "./task-outcome";
  import TaskRecoveryCard from "./TaskRecoveryCard.svelte";
  import HistorySearchResults from "./HistorySearchResults.svelte";
  import { sharedTaskPrompt } from "./share-target";
  import PullRequestDialog from "./PullRequestDialog.svelte";
  import { PALETTES, SKINS, TEXT_SIZES, normalizePalette, normalizeSkin, normalizeTextSize, type Palette, type Skin, type TextSize } from "./ui-theme";
  import { liveWorkRedesignEnabled } from "./ui-feature-flags";
  import { providerDisplayName } from "./provider-display";

  type Status = "pending" | "queued" | "running" | "waiting" | "completed" | "failed" | "stopped" | "unknown";
  type ProviderId="codex"|"claude"|"deepseek"|"ollama"|"antigravity"|"grok";
  const conversationProviders:ProviderId[]=["codex","claude","grok","antigravity","deepseek","ollama"];
  type ConnectionAuthProvider="codex"|"claude"|"antigravity"|"grok";
  type Task = { id:string; provider:ProviderId; nativeId:string; threadId:string|null; projectId:string; title:string; prompt?:string; status:Status; createdAt:string; updatedAt:string; result?:string|null; error?:string|null; log?:string; owned:boolean; ownership?:string|null; source?:string|null; jobId?:string|null; cwd?:string|null; requestedModel?:string|null; requestedReasoningEffort?:string|null; requestedServiceTier?:string|null; permissionProfile?:string|null; settingsUpdatedAt?:string|null; executionHostId?:string|null;workspaceId?:string|null;workChainId?:string|null;sourceSessionId?:string|null;metadata?:Record<string,any>;preview?:string;previewSource?:"result"|"error"|"log"|"prompt";listProjection?:boolean };
  const isAuthProvider=(provider:ProviderId):provider is "codex"|"claude"|"grok"=>provider==="codex"||provider==="claude"||provider==="grok";
  const isConnectionAuthProvider=(provider:ProviderId):provider is ConnectionAuthProvider=>provider==="codex"||provider==="claude"||provider==="antigravity"||provider==="grok";
  type Project = { id:string; name:string; enabled:boolean; error:string|null };
  type Host={id:string;type:"local"|"worker";displayName:string;platform:string;architecture:string;status:string;lastSeenAt:string|null;capabilities?:Record<string,any>};
  type Workspace={id:string;projectId:string;hostId:string;displayName:string;canonicalPath:string;state?:string;lastGitStatus?:any;lastVerifiedAt?:string|null};
  type WorkspaceViewerContext={workspace:Workspace;initialFile?:{path:string;pathBase:"workspace"|"task-cwd";sourceTaskId?:string;line?:number};sourceTaskId?:string|null;initialEdit?:boolean};
  type Collaboration={id:string;projectId:string;title:string;mode:"parallel"|"review"|"assist"|"debate";status:string;outcome:string|null;currentStep:string;sourceTaskId:string|null;workChainId?:string|null;updatedAt:string;maxTurnsPerParticipant?:number|null;currentTurnCounts?:Partial<Record<ProviderId,number>>;metadata?:Record<string,any>};
  type ConversationDocument={collaborationId:string;title:string;status:string;updatedAt:string;workspaceId:string;relativePath:string;revision:string};
  type QuotaReservation={id:string;provider:"codex"|"claude";projectId:string;executionHostId:string;workspaceId:string;title:string|null;status:"waiting-quota"|"claiming"|"starting"|"started"|"cancelled"|"failed";createdAt:string;updatedAt:string;nextCheckAt:string;lastQuotaCheckAt:string|null;lastQuotaStatus:string|null;taskId:string|null;error:string|null};

  const taskState=createTaskState<Task>();
  let tasks: Task[] = [],avatarTasks:Task[]=[];
  $: tasks=$taskState;
  let projects: Project[] = [];
  let hosts:Host[]=[];let workspaces:Workspace[]=[];let workspaceViewer:WorkspaceViewerContext|null=null,workspaceViewerLayout:WorkspaceViewerLayoutState={layout:"window",reversed:false};
  let vscodeContext:VscodeContext|null=null;
  let selected: Task | null = null;
  let collaborationBoardOpen=false;let collaborationBoardInitialCardId:string|null=null;let collaborationBoardCardIds=new Set<string>();
  let collaborations:Collaboration[]=[];let conversationDocuments:ConversationDocument[]=[];let conversationDocumentsOpen=false;let conversationDocumentDeleting="";let selectedCollaboration:string|null=null;let selectedAssistId:string|null=null;
  let quotaReservations:QuotaReservation[]=[];let reservationBusy:string|null=null;let reservationFocusId:string|null=null;
  let contextRequestBusy=false;
  let renameEditing=false;let renameTitle="";let renameSaving=false;
  const defaultHeadingCollapsed=()=>defaultSessionHeadingCollapsed(typeof window==="undefined"?Number.POSITIVE_INFINITY:window.innerWidth);
  let headingCollapsed=defaultHeadingCollapsed();
  let outcomeMobileExpanded=false;let outcomeMobileDismissed=false;let outcomeTaskKey="";
  let pullRequestOpen=false;
  let headingKey="";
  $: {const nextHeadingKey=selected?.threadId??selected?.id??"";if(nextHeadingKey!==headingKey){headingKey=nextHeadingKey;headingCollapsed=defaultHeadingCollapsed();renameEditing=false;}}
  $: {const nextOutcomeTaskKey=selected?.id??"";if(nextOutcomeTaskKey!==outcomeTaskKey){outcomeTaskKey=nextOutcomeTaskKey;outcomeMobileExpanded=false;outcomeMobileDismissed=false;}}
  let coarsePointer=typeof window!=="undefined"&&window.matchMedia("(pointer:coarse)").matches;
  let viewportWidth=typeof window==="undefined"?Number.POSITIVE_INFINITY:window.innerWidth;
  let viewportHeight=typeof window==="undefined"?Number.POSITIVE_INFINITY:window.visualViewport?.height??window.innerHeight;
  let keyboardOpen=false;
  // A task that is waiting on the person must keep its controls on screen.
  $: chromeBlocking=Boolean(selected&&(selected.status==="waiting"||selected.metadata?.approvalLoop));
  $: immersiveActive=immersiveChromeEnabled(viewportWidth,viewportHeight,coarsePointer,immersiveScroll);
  $: configureImmersiveChrome({enabled:immersiveActive,keyboardOpen,revealHeadingAtBottom:viewportHeight>=IMMERSIVE_END_HEADING_MIN_HEIGHT});
  $: setChromeBlocking("claude",chromeBlocking);
  $: chromeHidden=immersiveActive&&!$chromeVisible;
  $: bottomChromeHidden=immersiveActive&&$bottomChromeProgress<=0;
  // Below this width the brand, avatars and five actions stop fitting on one row.
  const TOPBAR_OVERFLOW_WIDTH=760;
  // Six provider avatars plus the utilities squeeze the nav long before the
  // overflow width, and the labels start wrapping mid-word. Above this width the
  // tabs keep icon+label; below it only the icon shows and the label stays as
  // the accessible name and the tooltip.
  const NAV_LABEL_WIDTH=1180;
  // The phone topbar cannot hold brand, avatars and five actions at once, so the
  // ambient utilities collapse into one overflow sheet. New task keeps its own
  // slot at the far right: it is the only primary action up here.
  let overflowOpen=false,overflowStyle="",overflowTrigger:HTMLButtonElement|undefined,overflowMenu:HTMLDivElement|undefined;
  $: compactTopbar=viewportWidth<=TOPBAR_OVERFLOW_WIDTH;
  $: navIconOnly=viewportWidth<NAV_LABEL_WIDTH&&!compactTopbar;
  $: if(!compactTopbar&&overflowOpen)closeOverflow();
  function placeOverflow(){
    if(!overflowTrigger||!overflowMenu)return;
    const band=currentViewportBand(),rect=overflowTrigger.getBoundingClientRect();
    const width=Math.min(260,Math.max(180,band.width-16));
    const spot=popoverPlacement({top:rect.top,bottom:rect.bottom,left:rect.right-width},{width,height:overflowMenu.scrollHeight},band);
    overflowStyle=`left:${spot.left}px;top:${spot.top}px;width:${width}px;max-height:${spot.maxHeight}px`;
  }
  // The phone session actions grew past what one row can hold, and every
  // arrangement that kept them all on screen either cut a label, hid the last
  // button, or spent three rows of the drawer on actions nobody takes twice a
  // session. Stop is the exception: it is the one action with a deadline, so it
  // stays a single tap while the rest move behind the same overflow sheet the
  // topbar already uses.
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
  // Leaving the session, or losing the row to the reading slide, must not strand
  // an open sheet pointing at a button that is no longer there.
  $: if(!selected||bottomChromeHidden)closeSessionMenu();
  function closeOverflow(){if(!overflowOpen)return;overflowOpen=false;try{overflowMenu?.hidePopover();}catch{}}
  function toggleOverflow(){
    if(overflowOpen)return closeOverflow();
    overflowOpen=true;
    requestAnimationFrame(()=>{try{overflowMenu?.showPopover();}catch{}placeOverflow();});
  }
  const revealChrome=()=>applyChromePhase("tap");
  const handleScrollActivity=(scrollTop:number,distanceToBottom:number,userInitiated:boolean)=>{userInitiated?applyChromePhase("scrolling",scrollTop,distanceToBottom):updateChromeDistance(distanceToBottom,scrollTop);};
  // Phone reading mode fades the whole chrome. Wider screens keep the bottom
  // controls fixed and temporarily fold only this heading while reading.
  const handleConversationScroll=(direction:"down"|"up",scrollTop:number,nearBottom:boolean)=>{
    // Fold the heading before immersive mode hides it. When the reader reaches
    // the end and the chrome returns, compact landscape must restore the small
    // heading rather than pushing the composer under the mobile navigation.
    if(shouldAutoFoldSessionChrome(direction,scrollTop,nearBottom)&&!headingCollapsed)headingCollapsed=true;
  };
  const conversationWorkspacePath=(task:Task)=>task.cwd??workspaces.find(item=>item.id===task.workspaceId)?.canonicalPath??null;
  let events: AgentEvent[] = [];
  let transcriptTruncated:{before:true;droppedTurns:number|null;droppedBytes:number}|null=null,transcriptTurns=12,transcriptHistoryLoading=false,transcriptHistoryKey="";
  $: {
    const next=selected?.provider==="claude"?(selected.threadId??selected.id):"";
    if(next!==transcriptHistoryKey){transcriptHistoryKey=next;transcriptTurns=12;transcriptTruncated=null;transcriptHistoryLoading=false;}
  }
  let showRunningHistory=false,runningHistoryPreference="";
  $: {
    const sessionId=selected?.threadId??selected?.id??"",next=sessionId&&selected?runningHistoryPreferenceKey(selected.provider,sessionId):"";
    if(next!==runningHistoryPreference){runningHistoryPreference=next;showRunningHistory=next?readRunningHistoryPreference(localStorage,selected!.provider,sessionId):false;}
  }
  function setShowRunningHistory(value:boolean){
    const sessionId=selected?.threadId??selected?.id;
    showRunningHistory=value;
    if(selected&&sessionId)writeRunningHistoryPreference(localStorage,selected.provider,sessionId,value);
  }
  let contextUsage:ContextUsage|null=null;
  $: contextUsage=latestContextUsage(events,selected?.metadata?.contextUsage,{provider:selected?.provider,model:selected?.requestedModel??selected?.metadata?.model});
  $: visibleConversationEvents=selected?.provider==="claude"&&active.has(selected.status)?recentRunningConversationEvents(events,showRunningHistory):events;
  let detailFileEntries:Array<{path:string;add:number;del:number;pathBase:"workspace"|"task-cwd"|"unresolved"}>=[];
  $: {
    const files=new Map<string,{add:number;del:number;pathBase:"workspace"|"task-cwd"|"unresolved"}>();
    for(const event of visibleConversationEvents){
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
  let codexSessionRecent:AgentRecentStatus|null=null;
  let codexRef:{closeDetail:()=>void;openTaskSession:(task:Task)=>Promise<void>;openSearchResult:(result:any)=>Promise<void>;refreshSessions:()=>Promise<void>}|null=null;
  let codexDetailOpen=false;
  let codexRecent:AgentRecentStatus|null=null;
  let claudeRecent:AgentRecentStatus|null=null;
  let grokRecent:AgentRecentStatus|null=null;
  let deepseekRecent:AgentRecentStatus|null=null;
  let ollamaRecent:AgentRecentStatus|null=null;
  let antigravityRecent:AgentRecentStatus|null=null;
  let collaborationRecent:CollaborationRecentStatuses={};
  let avatarOpenProvider:ProviderId|null=null;
  let avatarSessionsLoading:Record<ProviderId,boolean>={codex:false,claude:false,grok:false,antigravity:false,deepseek:false,ollama:false};
  let avatarSessionsError:Record<ProviderId,boolean>={codex:false,claude:false,grok:false,antigravity:false,deepseek:false,ollama:false};
  let avatarCompleted:Record<ProviderId,AgentRecentSession[]>={codex:[],claude:[],grok:[],antigravity:[],deepseek:[],ollama:[]};
  let avatarActive:Record<ProviderId,AgentRecentSession[]>={codex:[],claude:[],grok:[],antigravity:[],deepseek:[],ollama:[]};
  let engine: "all"|"conversation"|"collaboration-work"|"conversation-linked"|ProviderId = "all";
  let overviewOpen=liveWorkRedesignEnabled();
  let overviewExpandedTaskId:string|null=null;
  let codexMounted=false;
  $: if(engine==="codex")codexMounted=true;
  let statusFilter: ""|"active"|"waiting"|"done"|"failed" = "";
  let codexStatus: ""|"running"|"waiting"|"completed"|"failed" = "";
  let hostFilter="",workspaceFilter="",ownershipFilter="",sourceFilter="",chainFilter="";
  let codexProjectFilter="",codexSourceFilter="",codexOwnershipFilter="",codexModelFilter="";
  let searchOpen = false;
  let query = "";
  let taskSearchQuery="";
  let taskSearchTimer:ReturnType<typeof setTimeout>|null=null;
  function updateSearchQuery(value:string){
    query=value;
    if(taskSearchTimer)clearTimeout(taskSearchTimer);
    taskSearchTimer=null;
    if(!value.trim()){taskSearchQuery="";return;}
    taskSearchTimer=setTimeout(()=>{taskSearchTimer=null;taskSearchQuery=value;},180);
  }
  onDestroy(()=>{if(taskSearchTimer)clearTimeout(taskSearchTimer);});
  function applyCreateDefaultsForTab(value:typeof engine){if(value==="codex"||value==="claude"||value==="deepseek"||value==="ollama"||value==="antigravity"||value==="grok"){chooseCreateKind("single");createProvider=fallbackProvider(value,providerConnections);}else if(value==="conversation")chooseCreateKind("conversation");else if(value==="collaboration-work")chooseCreateKind("review");}
  function closeCurrentDetail(){
    if(selected){stopLive();discardLive();}
    selected=null;selectedAssistId=null;selectedCollaboration=null;events=[];chainOpen=false;
    codexRef?.closeDetail();codexDetailOpen=false;
  }
  let closeOverlayView=()=>{};
  const resetPageScroll=()=>requestAnimationFrame(()=>window.scrollTo({top:0,left:0,behavior:"instant"}));
  function openOverview(){exitTaskBulkMode();exitConversationBulkMode();closeCurrentDetail();engine="all";closeOverlayView();collaborationBoardOpen=false;overviewOpen=true;resetPageScroll();void refresh();}
  function openSessions(){closeCurrentDetail();closeOverlayView();collaborationBoardOpen=false;overviewOpen=false;resetPageScroll();if(engine==="conversation")selectEngine("all");}
  function openConversations(){closeCurrentDetail();closeOverlayView();collaborationBoardOpen=false;selectEngine("conversation");}
  function openCollaborationBoard(card?:CollaborationBoardCard){exitTaskBulkMode();exitConversationBulkMode();closeCurrentDetail();closeOverlayView();overviewOpen=false;collaborationBoardInitialCardId=card?.id??null;collaborationBoardOpen=true;resetPageScroll();}
  async function promoteSelectedToBoard(){if(!selected)return;const source=selected;try{const card=await createBoardCard(api,{title:source.title||$t("session.untitled"),description:source.prompt??"",boardStatus:"in_progress",priority:"normal",workspaceId:source.workspaceId??null,targetBranch:"",roles:{implementer:{provider:source.provider,permissionProfile:source.permissionProfile??(source.provider==="codex"?":workspace":":workspace-write")},reviewer:{provider:source.provider==="claude"?"codex":"claude",permissionProfile:":read-only"}},sourceTaskId:source.id});openCollaborationBoard(card)}catch(error){window.alert(error instanceof Error?error.message:String(error))}}
  async function openOrPromoteSelectedBoard(){if(!selected?.workChainId)return promoteSelectedToBoard();try{openCollaborationBoard(await getBoardCard(api,selected.workChainId))}catch{await promoteSelectedToBoard()}}
  function selectEngine(value:typeof engine){closeOverlayView();overviewOpen=false;if(engine===value)return;exitTaskBulkMode();exitConversationBulkMode();if(value!=="codex"){codexRef?.closeDetail();codexDetailOpen=false;}engine=value;applyCreateDefaultsForTab(value);if(value!=="codex")void refresh();}
  const codexStatusFor=(value:typeof statusFilter):typeof codexStatus=>value==="active"?"running":value==="done"?"completed":value;
  function statusSelected(value:typeof statusFilter){return engine==="codex"?codexStatus===codexStatusFor(value):statusFilter===value;}
  function selectStatus(value:typeof statusFilter){if(engine==="codex")codexStatus=codexStatusFor(value);else statusFilter=value;}
  let page = 1;
  const PAGE_SIZE = 20;
  $: { engine; statusFilter; taskSearchQuery; page = 1; }
  let quotaOpen = false;
  let quota: any = null;
  let quotaLoading=false,quotaRetryAttempt=0,quotaRetryTimer:ReturnType<typeof setTimeout>|null=null;
  function clearQuotaRetry(){if(quotaRetryTimer)clearTimeout(quotaRetryTimer);quotaRetryTimer=null;}
  function scheduleQuotaRetry(){
    clearQuotaRetry();
    const delay=quotaRetryDelay(quotaRetryAttempt,quota);quotaRetryAttempt++;
    quotaRetryTimer=setTimeout(()=>{quotaRetryTimer=null;if(typeof document==="undefined"||document.visibilityState==="visible")void loadQuota();},delay);
  }
  async function loadQuota(resetRetry=false){
    if(resetRetry)quotaRetryAttempt=0;
    if(quotaLoading)return;
    clearQuotaRetry();quotaLoading=true;
    try{quota=await api("/api/quota");if(quotaNeedsRetry(quota))scheduleQuotaRetry();else quotaRetryAttempt=0;}
    catch{scheduleQuotaRetry();}
    finally{quotaLoading=false;}
  }
  async function loadQuotaReservations(){const data=await api("/api/quota-reservations",{}, {caller:"App.quotaReservations"});quotaReservations=data.reservations??[];}
  const quotaPeak = () => Math.max(quota?.claude?.fiveHour?.pct ?? 0, quota?.claude?.sevenDay?.pct ?? 0, quota?.codex?.fiveHour?.pct ?? 0, quota?.codex?.sevenDay?.pct ?? 0, quota?.grok?.fiveHour?.pct ?? 0, quota?.grok?.sevenDay?.pct ?? 0, quota?.antigravity?.fiveHour?.pct ?? 0, quota?.antigravity?.sevenDay?.pct ?? 0, quota?.ollama?.fiveHour?.pct ?? 0, quota?.ollama?.sevenDay?.pct ?? 0);
  const quotaPct=(value:unknown)=>typeof value==="number"&&Number.isFinite(value)?formatQuotaPercentage(value,$locale):"?";
  const barClass = (pct:number|null) => (pct??0) >= 90 ? "crit" : (pct??0) >= 70 ? "warn" : "ok";
  const fmtReset = (iso:string|null,label?:string|null) => {
    if(!iso) return label ? $t("quota.reset",{label}) : "";
    const diff = new Date(iso).getTime() - Date.now();
    if(diff <= 0) return $t("quota.resetSoon");
    const h = Math.floor(diff/3600000), m = Math.round((diff%3600000)/60000);
    return h >= 24 ? $t("quota.resetDays",{days:Math.floor(h/24),hours:h%24}) : h ? $t("quota.resetHours",{hours:h,minutes:m}) : $t("quota.resetMinutes",{minutes:m});
  };
  let theme: "auto"|"light"|"dark" = (localStorage.getItem("deck-theme") as "light"|"dark"|null) ?? "auto";
  function syncThemeChrome(){requestAnimationFrame(()=>{const color=getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute("content",color);});}
  function applyTheme(value:typeof theme){theme=value;if(value==="auto"){localStorage.removeItem("deck-theme");delete document.documentElement.dataset.theme;}else{localStorage.setItem("deck-theme",value);document.documentElement.dataset.theme=value;}syncThemeChrome();}
  let palette:Palette=normalizePalette(localStorage.getItem("deck-palette"));
  function applyPalette(value:Palette){palette=value;localStorage.setItem("deck-palette",value);if(value==="forest")delete document.documentElement.dataset.palette;else document.documentElement.dataset.palette=value;syncThemeChrome();}
  let skin:Skin=normalizeSkin(localStorage.getItem("deck-skin"));
  function applySkin(value:Skin){skin=value;localStorage.setItem("deck-skin",value);if(value==="soft")delete document.documentElement.dataset.skin;else document.documentElement.dataset.skin=value;}
  let sessionTextSize:TextSize=normalizeTextSize(localStorage.getItem("deck-session-text-size"));
  function applySessionTextSize(value:TextSize){sessionTextSize=value;localStorage.setItem("deck-session-text-size",value);if(value==="medium")delete document.documentElement.dataset.sessionTextSize;else document.documentElement.dataset.sessionTextSize=value;}
  let conversationTextSize:TextSize=normalizeTextSize(localStorage.getItem("deck-conversation-text-size"));
  function applyConversationTextSize(value:TextSize){conversationTextSize=value;localStorage.setItem("deck-conversation-text-size",value);if(value==="medium")delete document.documentElement.dataset.conversationTextSize;else document.documentElement.dataset.conversationTextSize=value;}
  const paletteSwatches:Record<Palette,[string,string,string]>={
    forest:["#5ad38a","#62c9d8","#0f1411"],ocean:["#55b8ff","#55d6d0","#0d141c"],violet:["#b69cff","#75c8ff","#15121d"],
    sunset:["#ff9b68","#f6c65b","#1b120f"],rose:["#f08bb4","#b99cff","#1a1117"],mono:["#d4d8dc","#8f9aa3","#121416"],
  };
  let catalog:any={models:[],permissions:[]};
  let claudePermissions:Array<{id:string;description:string|null}>=[];
  type ClaudeModelOption={id:string;displayName:string;description?:string;source?:"runtime"|"custom"};
  let claudeModels:ClaudeModelOption[]=[];
  const COMPATIBLE_REASONING_EFFORTS:Array<{id:string;displayName:string}>=[
    {id:"default",displayName:"Default"},{id:"low",displayName:"Low"},{id:"medium",displayName:"Medium"},
    {id:"high",displayName:"High"},{id:"xhigh",displayName:"Extra high"},{id:"max",displayName:"Maximum"}
  ];
  let claudeEfforts:Array<{id:string;displayName:string}>=[...COMPATIBLE_REASONING_EFFORTS];
  type ClaudeModelTransition={scope:string;from:string;to:string;fromName:string;toName:string};
  let claudeCatalogLoading=true;let claudeCatalogRefreshing=false;let codexCatalogRefreshing=false;let providerCatalogRefreshing:Partial<Record<ProviderId,boolean>>={};let claudeCatalogMeta:ClaudeCatalogMeta|null=null;let claudeModelTransitions:ClaudeModelTransition[]=[];
  type RuntimeStatus={provider:ProviderId;name:string;current:string|null;latest:string|null;updateAvailable:boolean|null;managed:boolean;source:string;checkedAt:string|null;canUpdate:boolean;checksum:string|null;checksumSource?:"package"|"binary"|null;fault?:string|null;management:"managed"|"external"|"api";dependsOn:"codex"|"claude"|null;configured:boolean|null};
  type RuntimeAutoUpdateSettings={version:1;providers:Record<"codex"|"claude",boolean>};
  type ApplicationUpdateStatus={state:string;current:{version:string;installMethod:string};target:{version:string;publishedAt:string;manifestSha256:string;keyId:string}|null;updateAvailable:boolean;reason:string|null;blockers:Array<{kind:string;id:string;status:string}>;recentAttempts:Array<{id:string;state:string;sourceVersion:string;targetVersion:string;rollbackPerformed:boolean;error:string|null;updatedAt:string}>};
  type AvatarNoticeAction={type:"open-provider-models";provider:ProviderId};
  type RuntimeAvatarNotice={key:string;emotion:string;line:string;statusLine:string;action?:AvatarNoticeAction};
  type ProviderAccount={provider:ProviderId;state:"unavailable"|"disconnected"|"unknown"|"connected";accountType:string|null;planType:string|null;emailMasked:string|null;errorCategory:string|null;checkedAt:string};
  type CompatibleProviderUiSettings={provider:"deepseek"|"ollama";baseUrl:string;secretConfigured:boolean;secretSource:"workhouse"|"environment"|null};
  type AuthAttempt={provider:ConnectionAuthProvider;attemptId:string;method:string;state:"starting"|"waiting"|"code_required"|"verifying"|"completed"|"failed"|"cancelled"|"timeout";createdAt:string;expiresAt:string;url:string|null;userCode:string|null;codeRequired:boolean;errorCategory:string|null;inputNonce?:string};
  type AuthFeedback={tone:"info"|"success"|"error";message:string};
  let runtimes:RuntimeStatus[]=[];
  // Every provider gets a card. Only the managed ones get install/update controls, so the screen
  // never implies that Workhouse manages the externally installed CLIs or the API providers.
  const RUNTIME_CARD_PROVIDERS:{provider:ProviderId;name:string;management:RuntimeStatus["management"]}[]=[
    {provider:"codex",name:"Codex CLI",management:"managed"},{provider:"claude",name:"Claude Code",management:"managed"},
    {provider:"antigravity",name:"Gemini Antigravity CLI",management:"external"},{provider:"grok",name:"Grok CLI",management:"external"},
    {provider:"deepseek",name:"DeepSeek",management:"api"},{provider:"ollama",name:"Ollama Cloud",management:"api"},
  ];
  let runtimeBusy:"check"|"codex"|"claude"|null=null;
  let runtimeSettingsBusy:"codex"|"claude"|null=null;
  let runtimeAutoUpdate:RuntimeAutoUpdateSettings={version:1,providers:{codex:false,claude:false}};
  let runtimeAvatarNotices:Partial<Record<ProviderId,RuntimeAvatarNotice>>={};
  let runtimeNoticeQueues:Partial<Record<ProviderId,RuntimeAvatarNotice[]>>={};
  const runtimeNoticeTimers:Partial<Record<ProviderId,ReturnType<typeof setTimeout>>>={};
  let runtimeUpdateSource:EventSource|null=null;
  let modelCatalogSource:EventSource|null=null;
  let runtimeNotice="";
  let applicationUpdate:ApplicationUpdateStatus|null=null,applicationUpdateBusy:false|"check"|"apply"=false,applicationUpdateNotice="";
  let systemDiagnostic:any=null;let diagnosticBusy=false;
  let providerAccounts:ProviderAccount[]=[];let providerAccountsLoaded=false;let providerAccountsLoading=false;let providerAuthNotice="";
  let compatibleProviderSettings:Record<"deepseek"|"ollama",CompatibleProviderUiSettings>={deepseek:{provider:"deepseek",baseUrl:"https://api.deepseek.com/anthropic",secretConfigured:false,secretSource:null},ollama:{provider:"ollama",baseUrl:"https://ollama.com",secretConfigured:false,secretSource:null}};
  let compatibleProviderSecrets:Record<"deepseek"|"ollama",string>={deepseek:"",ollama:""};
  let compatibleProviderSaving:"deepseek"|"ollama"|null=null;
  let connectedAvatarProviders:Record<ProviderId,boolean>={codex:false,claude:false,grok:false,antigravity:false,deepseek:false,ollama:false};
  let authAttempts:Partial<Record<ConnectionAuthProvider,AuthAttempt>>={};let authCodes:Partial<Record<ConnectionAuthProvider,string>>={};
  let authFeedback:Partial<Record<ConnectionAuthProvider,AuthFeedback>>={};
  const authStreams:Partial<Record<ConnectionAuthProvider,EventSource>>={};
  const authWindows:Partial<Record<ConnectionAuthProvider,Window>>={};
  const AUTH_TERMINAL=new Set<AuthAttempt["state"]>(["completed","failed","cancelled","timeout"]);let authPollTimer:ReturnType<typeof setInterval>|null=null;let authPollBusy=false;
  const runtimeFor=(provider:"codex"|"claude")=>runtimes.find(item=>item.provider===provider);
  const accountFor=(provider:ConnectionAuthProvider)=>providerAccounts.find(item=>item.provider===provider);
  // One source of truth for "may this provider take new work": the connection
  // snapshot. Session history no longer keeps a provider in any creation path,
  // while the session list and session detail stay reachable for every provider.
  $: runtimeCards=RUNTIME_CARD_PROVIDERS.map(card=>runtimes.find(item=>item.provider===card.provider)??({provider:card.provider,name:card.name,current:null,latest:null,updateAvailable:null,managed:false,source:"",checkedAt:null,canUpdate:false,checksum:null,management:card.management,dependsOn:card.management==="api"?"claude":null,configured:null} satisfies RuntimeStatus));
  $: providerConnections=providerAvailability<ProviderId>(conversationProviders,providerAccounts,providerAccountsLoaded);
  $: creatableProviders=providerConnections.connected as ProviderId[];
  $: providerConnectionPhase=providerAvailabilityPhase(providerConnections);
  $: connectedAvatarProviders=Object.fromEntries(conversationProviders.map(provider=>[provider,providerConnected(providerConnections,provider)])) as Record<ProviderId,boolean>;
  // Creation stays blocked while the snapshot is still loading and whenever the
  // chosen engine or participant set is not backed by a connected account. The
  // rule itself lives in creationBlockReason so the submit buttons, the Enter
  // key path, and the request functions cannot drift apart.
  $: createConnectionBlocked=creationBlockReason({
    kind:createKind,
    provider:createKind==="conversation"?conversationFirstProvider:createProvider,
    participants:createKind==="single"?[createProvider]:createKind==="conversation"?conversationParticipants:activeReviewParticipants
  },providerConnections)!==null;
  const isActiveAuthAttempt=(item:AuthAttempt|null|undefined)=>Boolean(item&&!(["completed","failed","cancelled","timeout"] as string[]).includes(item.state));
  const activeAuthAttempt=(provider:ConnectionAuthProvider)=>{const item=authAttempts[provider];return isActiveAuthAttempt(item)?item!:null;};
  const providerName=(provider:ConnectionAuthProvider)=>provider==="codex"?"Codex":provider==="claude"?"Claude Code":provider==="grok"?"Grok":"Gemini";
  const setAuthFeedback=(provider:ConnectionAuthProvider,tone:AuthFeedback["tone"],message:string)=>authFeedback={...authFeedback,[provider]:{tone,message}};
  const accountStatusLabel=(provider:ConnectionAuthProvider,attempt:AuthAttempt|null=activeAuthAttempt(provider),account:ProviderAccount|undefined=accountFor(provider))=>{if(attempt)return $t(attempt.state==="code_required"?"auth.codeRequired":attempt.state==="verifying"?"status.checking":"auth.inProgress");if(providerAccountsLoading&&!providerAccountsLoaded)return $t("status.checking");const state=account?.state;return $t(state==="connected"?"status.connected":state==="disconnected"?"auth.connectionRequired":state==="unavailable"?"auth.runtimeUnavailable":"host.statusUnavailable");};
  const planLabel=(account:ProviderAccount|undefined)=>{if(!account||account.state!=="connected")return"";if(account.planType)return account.planType.replaceAll("_"," ");if(account.accountType==="apiKey")return"API key";if(account.accountType==="vertex-service-account")return"Vertex service account";return $t(account.provider==="codex"?"auth.chatGptAccount":account.provider==="antigravity"?"auth.antigravityAccount":"auth.claudeAccount");};
  const authErrorCategories=new Set(["device_code_unsupported","auth_url_invalid","auth_url_rejected","auth_timeout","provider_timeout","runtime_unavailable","provider_unavailable","provider_rejected","final_verification_failed","login_process_failed","unsupported_output","process_identity_mismatch"]);
  const authErrorLabel=(category:string|null|undefined)=>category?$t(`auth.error.${authErrorCategories.has(category)?category:"unknown"}`):"";
  const taskNeedsProviderAuth=(task:Task)=>isConnectionAuthProvider(task.provider)&&task.status==="failed"&&(accountFor(task.provider)?.state==="disconnected"||/failed to authenticate|oauth session expired|authentication|인증/i.test(`${task.error??""}\n${task.log??""}`));
  // Legacy last-run values are migration fallbacks only. Saved global defaults
  // are the canonical source for every newly opened create dialog.
  const savedPrefs=(()=>{try{return JSON.parse(localStorage.getItem("deck-create-prefs")||"{}")}catch{return{}}})();
  const globalPrefs=(()=>{try{return JSON.parse(localStorage.getItem("deck-global-settings")||"{}")}catch{return{}}})();
  const persistedCodexAutomation=[globalPrefs.codexAutomation,globalPrefs.codexPermission,savedPrefs.codexAutomation,savedPrefs.codexPermission];
  const conversationPrefs=(()=>{try{return JSON.parse(localStorage.getItem("deck-conversation-prefs")||"{}")}catch{return{}}})();
  type GlobalTab="infrastructure"|"account"|"defaults"|"characters"|"workspace"|"storage"|"display"|"system"|"about"|string;
  type StorageTab="artifacts"|"snapshots";
  type AccountTab="providers"|"git"|"proton";
  type DefaultsTab="general"|ProviderId;
  type GlobalTabGroup="daily"|"connection"|"storage"|"system";
  type DisplayTab="screen"|"notifications";
  type DelegationLaunchMode="managed"|"direct";
  type DelegationSettings={version:3;claude:{launchMode:DelegationLaunchMode;model:string;reasoningEffort:string};codex:{launchMode:DelegationLaunchMode;model:string|null;reasoningEffort:string|null;serviceTier:"priority"|null};deepseek:{launchMode:"managed";model:string|null;reasoningEffort:string|null};ollama:{launchMode:"managed";model:string|null;reasoningEffort:string|null};antigravity:{launchMode:"managed";model:string|null;reasoningEffort:string|null};grok:{launchMode:"managed";model:string|null;reasoningEffort:string|null}};

  type AntigravityExecutionSettings={version:1;backend:"consumer"|"vertex"|"vertex-agent";vertex:{projectId:string;location:string;credentialsPath:string;creditsUrl:string}};
  const DEFAULT_DELEGATION_SETTINGS:DelegationSettings={version:3,claude:{launchMode:"managed",model:"claude-opus-5",reasoningEffort:"default"},codex:{launchMode:"managed",model:null,reasoningEffort:null,serviceTier:null},deepseek:{launchMode:"managed",model:null,reasoningEffort:null},ollama:{launchMode:"managed",model:null,reasoningEffort:null},antigravity:{launchMode:"managed",model:null,reasoningEffort:null},grok:{launchMode:"managed",model:null,reasoningEffort:null}};
  const EMPTY_GLOBAL_MODELS:GlobalModelSettings=emptyGlobalModelSettings();
  // Grouped by how the tab saves: "daily" tabs use the sticky save row, the rest write immediately.
  const GLOBAL_TABS:Array<{id:GlobalTab;labelKey:string;group:GlobalTabGroup}>=[{id:"defaults",labelKey:"settings.defaults",group:"daily"},{id:"characters",labelKey:"settings.characters",group:"daily"},{id:"display",labelKey:"settings.display",group:"daily"},{id:"account",labelKey:"settings.account",group:"connection"},{id:"mcp",labelKey:"mcp.settingsTab",group:"connection"},{id:"infrastructure",labelKey:"settings.infrastructure",group:"connection"},{id:"workspace",labelKey:"settings.workspace",group:"connection"},{id:"storage",labelKey:"settings.storage.title",group:"storage"},{id:"system",labelKey:"settings.system",group:"system"},{id:"about",labelKey:"settings.about",group:"system"}];
  const DEFAULTS_TABS:Array<{id:DefaultsTab;label:string}>=[{id:"general",label:"settings.defaults.general"},{id:"codex",label:"Codex"},{id:"claude",label:"Claude"},{id:"grok",label:"Grok"},{id:"antigravity",label:"Antigravity"},{id:"deepseek",label:"DeepSeek"},{id:"ollama",label:"Ollama"}];
  const DISPLAY_TABS:Array<{id:DisplayTab;labelKey:string}>=[{id:"screen",labelKey:"settings.display.screen"},{id:"notifications",labelKey:"settings.notifications"}];
  const STORAGE_TABS:Array<{id:StorageTab;labelKey:string}>=[{id:"artifacts",labelKey:"settings.artifacts"},{id:"snapshots",labelKey:"settings.storage"}];
  const savedDisplayTab=localStorage.getItem("deck-display-settings-tab") as DisplayTab|null;
  const ACCOUNT_TABS:Array<{id:AccountTab;labelKey:string}>=[{id:"providers",labelKey:"provider.connections"},{id:"git",labelKey:"settings.git"},{id:"proton",labelKey:"proton.title"}];
  const savedStorageTab=localStorage.getItem("deck-storage-settings-tab") as StorageTab|null;
  const savedAccountTab=localStorage.getItem("deck-account-settings-tab") as AccountTab|null;
  const savedGlobalTab=localStorage.getItem("deck-global-settings-tab") as GlobalTab|null;
  const savedDefaultsTab=localStorage.getItem("deck-defaults-settings-tab") as DefaultsTab|null;
  let globalOpen=false,settingsClosePrompt=false,globalTab:GlobalTab=GLOBAL_TABS.some(item=>item.id===savedGlobalTab)?savedGlobalTab!:"defaults",globalBaseline:Record<string,string>={},characterSettings:CharacterSettings=structuredClone(DEFAULT_CHARACTERS),charactersLoaded=false,charactersLoading=false,providerOutfits:Record<ProviderId,string[]>={codex:["Gpt-Codex","Gpt-Sol"],claude:["normal","capy"],grok:["Grok"],antigravity:["Antigravity","Gemma-e4b"],deepseek:["DeepSeek","Ollama"],ollama:["Ollama","DeepSeek","Antigravity","Gemma-e4b"]},globalSaving=false,globalSaveNotice="";
  let defaultsTab:DefaultsTab=DEFAULTS_TABS.some(item=>item.id===savedDefaultsTab)?savedDefaultsTab!:"general";
  let displayTab:DisplayTab=DISPLAY_TABS.some(item=>item.id===savedDisplayTab)?savedDisplayTab!:"screen";
  let storageTab:StorageTab=STORAGE_TABS.some(item=>item.id===savedStorageTab)?savedStorageTab!:"artifacts";
  let accountTab:AccountTab=ACCOUNT_TABS.some(item=>item.id===savedAccountTab)?savedAccountTab!:"providers";
  let localeSaving=false,localeNotice="";
  async function chooseLocale(event:Event){
    const next=(event.currentTarget as HTMLSelectElement).value as SupportedLocale;
    localeSaving=true;localeNotice=$t("language.saving");
    try{await saveLocale(next);localeNotice=$t("language.saved");}
    catch{localeNotice=$t("language.saveFailed");}
    finally{localeSaving=false;}
  }
  const providerNickname=(provider:"codex"|"claude")=>characterSettings.providers[provider].nickname.trim()||DEFAULT_CHARACTERS.providers[provider].nickname;
  const characterToneLabel=(provider:ProviderId)=>$t(`character.tone.${TONE_PRESETS.find(item=>item.id===characterSettings.providers[provider].tonePreset)?.id??"default"}`);
  let delegationSettings:DelegationSettings=structuredClone(DEFAULT_DELEGATION_SETTINGS),delegationLoaded=false,delegationLoading=false;
  let globalModelSettings:GlobalModelSettings=structuredClone(EMPTY_GLOBAL_MODELS),globalModelCandidates:Record<ProviderId,GlobalModelEntry[]>={claude:[],codex:[],grok:[],deepseek:[],ollama:[],antigravity:[]},globalModelsLoaded=false,globalModelsLoading=false,globalModelsLoadPromise:Promise<void>|null=null;
  let claudeSwitchModelsOnFlag=true,claudeExecutionLoaded=false,claudeExecutionLoading=false;
  const DEFAULT_ANTIGRAVITY_EXECUTION:AntigravityExecutionSettings={version:1,backend:"consumer",vertex:{projectId:"",location:"global",credentialsPath:"",creditsUrl:""}};
  let antigravityExecution:AntigravityExecutionSettings=structuredClone(DEFAULT_ANTIGRAVITY_EXECUTION),antigravityExecutionLoaded=false,antigravityExecutionLoading=false,antigravityExecutionTesting=false,antigravityCredentialUploading=false,antigravityExecutionNotice="",antigravityCredentialNotice="";
  type GeminiCliReadiness={installed:boolean;source:string|null;version:string|null;ripgrep:boolean;projectId:string;location:string;credentials:string};
  let geminiCliReadiness:GeminiCliReadiness|null=null;
  // Both Vertex backends read the same project, region, and service-account key,
  // so the credential fields stay visible for either one.
  let antigravityUsesVertex=false;
  $: antigravityUsesVertex=antigravityExecution.backend==="vertex"||antigravityExecution.backend==="vertex-agent";
  type CreditConsentChoice="cancel"|"once"|"always";
  type PaidCreditProvider="codex"|"claude"|"grok";
  type CreditConsentPrompt={providers:PaidCreditProvider[];reasons:Partial<Record<PaidCreditProvider,"exhausted"|"unknown">>;waiters:Array<(choice:CreditConsentChoice)=>void>};
  let allowPaidCredits=globalPrefs.allowPaidCredits===true,creditUsageLoaded=false,creditUsageLoading=false,creditConsentPrompt:CreditConsentPrompt|null=null;
  let customModelDraft:Record<"claude"|"codex",{id:string;displayName:string}>={claude:{id:"",displayName:""},codex:{id:"",displayName:""}};let modelValidation:Partial<Record<"claude"|"codex",{busy:boolean;valid?:boolean;detail?:string}>>={};
  let showAvatars=globalPrefs.showAvatars!==false;let showSpeech=globalPrefs.showSpeech!==false;let collapseCompleted=globalPrefs.collapseCompleted!==false;let notifications=globalPrefs.notifications===true;let vibration=globalPrefs.vibration===true;let rememberLast=globalPrefs.rememberLast!==false;let enterToSend=globalPrefs.enterToSend!==false;let hideLocalPaths=globalPrefs.hideLocalPaths===true;
  let avatarAutoCollapse=globalPrefs.avatarAutoCollapse!==false;let avatarCollapseDelayMs=normalizeAvatarCollapseDelay(globalPrefs.avatarCollapseDelayMs);let scrollAutoSwitch=globalPrefs.scrollAutoSwitch!==false;let immersiveScroll=globalPrefs.immersiveScroll!==false;
  // Card shape belongs to the screen, not the account, so it stays out of the
  // synced display payload and is written straight back to this device.
  let avatarTrayShape:AvatarTrayShape=readAvatarTrayShape();
  const changeAvatarTrayShape=(shape:AvatarTrayShape)=>{avatarTrayShape=writeAvatarTrayShape(shape);};
  let pushState:"unsupported"|"permission-needed"|"subscribed"|"disabled"|"failed"="disabled";let pushPreferences={approvals:true,userInput:true,completed:true,failed:true,hostOffline:false,handoff:true,vibration:false,quietStart:null as string|null,quietEnd:null as string|null};
  const browserId=(()=>{let value=localStorage.getItem("deck-browser-id");if(!value){value=crypto.randomUUID();localStorage.setItem("deck-browser-id",value);}return value;})();
  let codexAvatar:"Gpt-Codex"|"Gpt-Sol"=globalPrefs.codexAvatar==="Gpt-Codex"?"Gpt-Codex":"Gpt-Sol";
  const savedDefaultProvider=globalPrefs.defaultProvider??savedPrefs.provider;
  let globalDefaultProvider:ProviderId=(["codex","claude","grok","antigravity","deepseek","ollama"] as ProviderId[]).includes(savedDefaultProvider)?savedDefaultProvider:"codex";
  let globalCodexModel=globalPrefs.codexModel??savedPrefs.codexModel??"";
  let globalCodexEffort=globalPrefs.codexEffort??savedPrefs.codexEffort??"";
  let globalCodexTier:string|null=globalPrefs.codexTier==="priority"?"priority":null;
  let globalCodexWorkMode:WorkMode=(globalPrefs.codexWorkMode??savedPrefs.codexWorkMode)==="plan"?"plan":"default";
  let globalCodexAutomation:AutomationLevel=automationLevelOf(globalPrefs.codexPermission??savedPrefs.codexPermission??":workspace",{automationLevel:globalPrefs.codexAutomation??savedPrefs.codexAutomation});
  let globalClaudeModel=globalPrefs.claudeModel??savedPrefs.claudeModel??"claude-opus-4-8";
  let globalClaudeEffort=globalPrefs.claudeEffort??savedPrefs.claudeEffort??"medium";
  let globalClaudeWorkMode:WorkMode=(globalPrefs.claudeWorkMode??savedPrefs.claudeWorkMode)==="plan"||(globalPrefs.claudeWorkMode??savedPrefs.claudeWorkMode)==null&&(globalPrefs.claudePermission??savedPrefs.claudePermission??":read-only")===":read-only"?"plan":"default";
  let globalClaudeAutomation:AutomationLevel=automationLevelOf(globalPrefs.claudePermission??savedPrefs.claudePermission??":read-only",{automationLevel:globalPrefs.claudeAutomation??savedPrefs.claudeAutomation});
  let createModel=globalCodexModel;let createEffort=globalCodexEffort;let createTier:string|null=globalCodexTier;let createPermission=permissionForAutomation("codex",globalCodexAutomation);let dangerAcknowledged=dangerFullAccessAcknowledged();let dangerConfirmed=dangerAcknowledged;
  let createClaudePermission=permissionForAutomation("claude",globalClaudeAutomation);let createClaudeModel=globalClaudeModel;let createClaudeEffort=globalClaudeEffort;
  type CompatibleExecutionProvider="antigravity"|"deepseek"|"ollama"|"grok";
  type VertexGoogleSearchMode="off"|"auto"|"always";
  const compatibleProviders:CompatibleExecutionProvider[]=["grok","antigravity","deepseek","ollama"];
  let globalCompatibleModels:Record<CompatibleExecutionProvider,string>={grok:globalPrefs.grokModel??savedPrefs.grokModel??"",antigravity:globalPrefs.antigravityModel??savedPrefs.antigravityModel??"",deepseek:globalPrefs.deepseekModel??savedPrefs.deepseekModel??"deepseek-v4-pro",ollama:globalPrefs.ollamaModel??savedPrefs.ollamaModel??""};
  let globalCompatibleEfforts:Record<CompatibleExecutionProvider,string>={grok:globalPrefs.grokEffort??savedPrefs.grokEffort??"default",antigravity:globalPrefs.antigravityEffort??savedPrefs.antigravityEffort??"default",deepseek:globalPrefs.deepseekEffort??savedPrefs.deepseekEffort??"default",ollama:globalPrefs.ollamaEffort??savedPrefs.ollamaEffort??"default"};
  let globalCompatibleWorkModes:Record<CompatibleExecutionProvider,WorkMode>={grok:globalPrefs.grokWorkMode==="plan"?"plan":"default",antigravity:globalPrefs.antigravityWorkMode==="plan"?"plan":"default",deepseek:globalPrefs.deepseekWorkMode==="plan"?"plan":"default",ollama:globalPrefs.ollamaWorkMode==="plan"?"plan":"default"};
  let globalCompatibleAutomation:Record<CompatibleExecutionProvider,AutomationLevel>={grok:automationLevelOf(globalPrefs.grokPermission??savedPrefs.grokPermission,{automationLevel:globalPrefs.grokAutomation??savedPrefs.grokAutomation}),antigravity:automationLevelOf(globalPrefs.antigravityPermission??savedPrefs.antigravityPermission,{automationLevel:globalPrefs.antigravityAutomation??savedPrefs.antigravityAutomation}),deepseek:automationLevelOf(globalPrefs.deepseekPermission??savedPrefs.deepseekPermission,{automationLevel:globalPrefs.deepseekAutomation??savedPrefs.deepseekAutomation}),ollama:automationLevelOf(globalPrefs.ollamaPermission??savedPrefs.ollamaPermission,{automationLevel:globalPrefs.ollamaAutomation??savedPrefs.ollamaAutomation})};
  let createGrokModel=globalCompatibleModels.grok;let createDeepseekModel=globalCompatibleModels.deepseek;let createOllamaModel=globalCompatibleModels.ollama;let createAntigravityModel=globalCompatibleModels.antigravity;
  let createGoogleSearchMode:VertexGoogleSearchMode="off";
  let createCompatibleEfforts={...globalCompatibleEfforts};let createCompatibleWorkModes={...globalCompatibleWorkModes};let createCompatibleAutomation={...globalCompatibleAutomation};
  let createCodexWorkMode:WorkMode=globalCodexWorkMode;
  let createClaudeWorkMode:WorkMode=globalClaudeWorkMode;
  let createCodexAutomation:AutomationLevel=globalCodexAutomation;
  let createClaudeAutomation:AutomationLevel=globalClaudeAutomation;
  createPermission=permissionForAutomation("codex",createCodexAutomation);
  createClaudePermission=permissionForAutomation("claude",createClaudeAutomation);
  function allCodexModelOptions():any[]{const base=(catalog.models??[]).find((item:any)=>item.isDefault&&!item.hidden)??(catalog.models??[]).find((item:any)=>!item.hidden),byId=new Map<string,any>((catalog.models??[]).map((item:any)=>[item.id,item]));for(const item of [...globalModelCandidates.codex,...globalModelSettings.codex.models])if(!byId.has(item.id))byId.set(item.id,{...base,id:item.id,model:item.id,displayName:item.displayName,hidden:false,isDefault:false,defaultReasoningEffort:base?.defaultReasoningEffort??"medium",supportedReasoningEfforts:base?.supportedReasoningEfforts??[],serviceTiers:base?.serviceTiers??[],defaultServiceTier:null});return[...byId.values()];}
  function allClaudeModelOptions(){const byId=new Map(claudeModels.map(item=>[item.id,item]));for(const item of [...globalModelCandidates.claude,...globalModelSettings.claude.models])if(!byId.has(item.id))byId.set(item.id,{id:item.id,displayName:item.displayName,source:item.source});return[...byId.values()];}
  function availableCodexModels(){if(!globalModelsLoaded)return(catalog.models??[]).filter((item:any)=>!item.hidden);const enabled=new Set(globalModelSettings.codex.models.map(item=>item.id));return allCodexModelOptions().filter((item:any)=>enabled.has(item.id)&&!item.hidden);}
  function availableClaudeModels(){if(!globalModelsLoaded)return claudeModels;const enabled=new Set(globalModelSettings.claude.models.map(item=>item.id));return allClaudeModelOptions().filter(item=>enabled.has(item.id));}
  function availableCompatibleModels(provider:CompatibleExecutionProvider){const enabled=new Set(globalModelSettings[provider].models.map(item=>item.id)),byId=new Map([...globalModelCandidates[provider],...globalModelSettings[provider].models].map(item=>[item.id,item]));return[...byId.values()].filter(item=>!globalModelsLoaded||enabled.has(item.id));}
  function compatibleEffortOptions(provider:CompatibleExecutionProvider){
    const catalog=new Map(claudeEfforts.map(item=>[item.id,item])),supported=provider==="antigravity"?["default","low","medium","high"]:["default","low","medium","high","xhigh","max"];
    return supported.map(id=>catalog.get(id)??COMPATIBLE_REASONING_EFFORTS.find(item=>item.id===id)!);
  }
  function createCompatibleModel(provider:CompatibleExecutionProvider){return provider==="grok"?createGrokModel:provider==="deepseek"?createDeepseekModel:provider==="ollama"?createOllamaModel:createAntigravityModel;}
  function setCreateCompatibleModel(provider:CompatibleExecutionProvider,value:string){if(provider==="grok")createGrokModel=value;else if(provider==="deepseek")createDeepseekModel=value;else if(provider==="ollama")createOllamaModel=value;else createAntigravityModel=value;}
  function compatibleCreateModel(){return createCompatibleModel(createProvider as CompatibleExecutionProvider);}
  function compatibleCreateProvider(provider:ProviderId):provider is CompatibleExecutionProvider{return compatibleProviders.includes(provider as CompatibleExecutionProvider);}
  function collaborationBoardExecutionConfig():CollaborationBoardExecutionConfig{
    const providerConfig=(provider:CollaborationBoardProvider)=>{const compatible=compatibleCreateProvider(provider),models=provider==="codex"?availableCodexModels():provider==="claude"?availableClaudeModels():availableCompatibleModels(provider as CompatibleExecutionProvider),defaultModel=provider==="codex"?globalCodexModel:provider==="claude"?globalClaudeModel:globalCompatibleModels[provider as CompatibleExecutionProvider],defaultReasoningEffort=provider==="codex"?globalCodexEffort:provider==="claude"?globalClaudeEffort:globalCompatibleEfforts[provider as CompatibleExecutionProvider],defaultServiceTier=provider==="codex"?globalCodexTier:null,defaultWorkMode=provider==="codex"?globalCodexWorkMode:provider==="claude"?globalClaudeWorkMode:globalCompatibleWorkModes[provider as CompatibleExecutionProvider],defaultAutomationLevel=provider==="codex"?globalCodexAutomation:provider==="claude"?globalClaudeAutomation:globalCompatibleAutomation[provider as CompatibleExecutionProvider];return{provider,models,efforts:provider==="codex"?[]:provider==="claude"?claudeEfforts:compatible?compatibleEffortOptions(provider):[],defaultModel,defaultReasoningEffort,defaultServiceTier,defaultWorkMode,defaultAutomationLevel,defaultPermissionProfile:permissionForAutomation(provider,defaultAutomationLevel),...(provider==="antigravity"?{defaultGoogleSearchMode:"off" as const}:{})};};
    // Board cards start new provider runs, so they follow the same connected-only rule as the create dialog.
    const boardProviders=(creatableProviders as CollaborationBoardProvider[]).filter(provider=>(["codex","claude","grok","antigravity","deepseek","ollama"] as string[]).includes(provider));
    return{defaultProvider:fallbackProvider(globalDefaultProvider,providerConnections),providers:boardProviders.map(providerConfig),fullAccessAcknowledged:dangerFullAccessAcknowledged()};
  }
  function collaborationBoardSessionCandidates():CollaborationBoardAttachCandidate[]{return[...tasks.filter(item=>!item.workChainId).map(item=>({id:item.id,kind:"task" as const,title:item.title,provider:item.provider,status:item.status})),...collaborations.filter(item=>!item.workChainId).map(item=>({id:item.id,kind:"collaboration" as const,title:item.title,provider:null,status:item.status}))];}
  function createWorkModeFor(provider:ProviderId){return provider==="codex"?createCodexWorkMode:provider==="claude"?createClaudeWorkMode:createCompatibleWorkModes[provider as CompatibleExecutionProvider];}
  function createAutomationFor(provider:ProviderId){return provider==="codex"?createCodexAutomation:provider==="claude"?createClaudeAutomation:createCompatibleAutomation[provider as CompatibleExecutionProvider];}
  function createPermissionFor(provider:ProviderId){return provider==="codex"?createPermission:provider==="claude"?createClaudePermission:permissionForAutomation(provider,createCompatibleAutomation[provider as CompatibleExecutionProvider]);}
  const claudeModelName=(id:string|null|undefined)=>allClaudeModelOptions().find(m=>m.id===(id??"default"))?.displayName??(id??$t("common.default"));
  let taskSettingsOpen=false;let taskSettingsNotice="";let editModel="";let editEffort="";let editTier:string|null=null;let editPermission=":workspace";let editWorkMode:WorkMode="default";let editAutomation:AutomationLevel="auto";let editDanger=false;let editProject="";let editWorkspace="";let editGoogleSearchMode:VertexGoogleSearchMode="off";
  const vertexGoogleSearchMode=(value:unknown):VertexGoogleSearchMode=>value==="auto"||value==="always"?value:"off";
  const editHost=()=>selected?.executionHostId??"local";
  const editWorkspaces=()=>workspaces.filter(item=>item.hostId===editHost()&&item.projectId===editProject);
  const editLocations=()=>workspaces.filter(item=>item.hostId===editHost());
  function syncEditWorkspace(){const choices=editWorkspaces();if(!choices.some(item=>item.id===editWorkspace))editWorkspace=choices[0]?.id??"";}
  const canEditSettings=()=>Boolean(selected&&selected.threadId&&(selected.owned||selected.provider==="claude"));
  function openTaskSettings(){
    if(!selected)return;editDanger=dangerAcknowledged;
    editProject=typeof selected.metadata?.nextProjectId==="string"?selected.metadata.nextProjectId:selected.projectId;
    editWorkspace=typeof selected.metadata?.nextWorkspaceId==="string"?selected.metadata.nextWorkspaceId:selected.workspaceId??"";
    syncEditWorkspace();void loadHostData();
    editWorkMode=workModeOf(selected.provider,selected.permissionProfile,selected.metadata);
    editAutomation=automationLevelOf(selected.permissionProfile,selected.metadata);
    editGoogleSearchMode=vertexGoogleSearchMode(selected.metadata?.googleSearchMode);
    if(selected.provider==="claude"){editModel=selected.requestedModel??"default";editEffort=selected.requestedReasoningEffort??"default";editPermission=selected.permissionProfile??":read-only";}
    else if(compatibleCreateProvider(selected.provider)){editModel=selected.requestedModel??globalCompatibleModels[selected.provider];editEffort=selected.requestedReasoningEffort??"default";editPermission=selected.permissionProfile??":read-only";}
    else{editModel=selected.requestedModel||availableCodexModels().find((x:any)=>x.isDefault)?.id||availableCodexModels()[0]?.id||"";const m=allCodexModelOptions().find((x:any)=>x.id===editModel);editEffort=selected.requestedReasoningEffort||m?.defaultReasoningEffort||"medium";editTier=selected.requestedServiceTier??null;editPermission=selected.permissionProfile||":workspace";}
    taskSettingsOpen=true;
  }
  async function saveTaskSettings(){
    if(!selected||sending)return;sending=true;taskSettingsNotice="";error="";
    try{
      if(selected.provider==="claude"){
        editPermission=permissionForWorkMode("claude",editWorkMode,editPermission);
        const d=await api(`/api/tasks/claude/${encodeURIComponent(selected.id)}/settings`,{method:"PATCH",body:JSON.stringify({model:editModel,reasoningEffort:editEffort,permissionProfile:editPermission,workMode:editWorkMode,automationLevel:editAutomation,dangerConfirmation:editDanger,projectId:editProject,workspaceId:editWorkspace})});
        selected=d.task;taskState.upsert(d.task);
      }else if(compatibleCreateProvider(selected.provider)){
        editPermission=permissionForWorkMode(selected.provider,editWorkMode,editPermission);
        const data=await api(`/api/tasks/${selected.provider}/${encodeURIComponent(selected.id)}/settings`,{method:"PATCH",body:JSON.stringify({model:editModel,reasoningEffort:editEffort,permissionProfile:editPermission,workMode:editWorkMode,automationLevel:editAutomation,dangerConfirmation:editDanger,projectId:editProject,workspaceId:editWorkspace,...(selected.provider==="antigravity"?{googleSearchMode:editGoogleSearchMode}:{})})});selected=data.task;taskState.upsert(data.task);
      }else if(selected.threadId&&(!selected.executionHostId||selected.executionHostId==="local")&&!selected.id.startsWith("codex:worker:")){
        const current=selected,data=await api(`/api/codex/threads/${current.threadId}/settings`,{method:"PATCH",headers:{"Idempotency-Key":uuid()},body:JSON.stringify({model:editModel,reasoningEffort:editEffort,serviceTier:editTier,permissionProfile:editPermission,workMode:editWorkMode,automationLevel:editAutomation,dangerConfirmation:editDanger,fullAccessAcknowledged:editDanger,acknowledgementVersion:editDanger?1:undefined,projectId:editProject,workspaceId:editWorkspace})});
        const canonical=data.thread??{},updated:Task={...current,projectId:canonical.projectId??current.projectId,workspaceId:canonical.workspaceId??current.workspaceId,cwd:canonical.cwd??current.cwd,requestedModel:canonical.requestedModel??null,requestedReasoningEffort:canonical.requestedReasoningEffort??null,requestedServiceTier:canonical.requestedServiceTier??null,permissionProfile:canonical.permissionProfile??current.permissionProfile,settingsUpdatedAt:canonical.settingsUpdatedAt??current.settingsUpdatedAt,metadata:{...current.metadata,...(canonical.metadata??{})}};selected=updated;taskState.upsert(updated);
      }else if(selected.provider==="codex"){
        const data=await api(`/api/tasks/codex/${encodeURIComponent(selected.id)}/settings`,{method:"PATCH",headers:{"Idempotency-Key":uuid()},body:JSON.stringify({model:editModel,reasoningEffort:editEffort,serviceTier:editTier,permissionProfile:editPermission,workMode:editWorkMode,automationLevel:editAutomation,dangerConfirmation:editDanger,fullAccessAcknowledged:editDanger,acknowledgementVersion:editDanger?1:undefined,projectId:editProject,workspaceId:editWorkspace})});selected=data.task;taskState.upsert(data.task);
      }
      taskSettingsOpen=false;taskSettingsNotice=$t("settings.saved");
    }catch(e){error=e instanceof Error?e.message:String(e)}
    finally{sending=false;}
  }
  function chooseCreateWorkMode(provider:ProviderId,mode:WorkMode){
    if(provider==="codex")createCodexWorkMode=mode;
    else if(provider==="claude"){createClaudeWorkMode=mode;createClaudePermission=permissionForWorkMode("claude",mode,createClaudePermission);}
    else createCompatibleWorkModes={...createCompatibleWorkModes,[provider]:mode};
    if(mode==="plan")chooseCreateAutomation(provider,"read");
  }
  function chooseGlobalWorkMode(provider:ProviderId,mode:WorkMode){
    if(provider==="codex")globalCodexWorkMode=mode;
    else if(provider==="claude")globalClaudeWorkMode=mode;
    else globalCompatibleWorkModes={...globalCompatibleWorkModes,[provider]:mode};
    if(mode==="plan")chooseGlobalAutomation(provider,"read");
  }
  function chooseGlobalAutomation(provider:ProviderId,level:AutomationLevel){
    if(provider!=="codex"&&level==="confirm")return;
    if(provider==="codex")globalCodexAutomation=level;
    else if(provider==="claude")globalClaudeAutomation=level;
    else globalCompatibleAutomation={...globalCompatibleAutomation,[provider]:level};
    dangerConfirmed=level==="full"&&dangerAcknowledged;
  }
  function recordDangerAcknowledgement(){acknowledgeDangerFullAccess();dangerAcknowledged=true;dangerConfirmed=true;editDanger=true;}
  function ensureDangerAcknowledgement(){const confirmed=requestDangerFullAccessAcknowledgement();if(confirmed){dangerAcknowledged=true;dangerConfirmed=true;editDanger=true;}return confirmed;}
  function chooseCreateAutomation(provider:ProviderId,level:AutomationLevel){
    if(provider!=="codex"&&level==="confirm")return;
    const permission=permissionForAutomation(provider,level);
    if(provider==="codex"){createCodexAutomation=level;createPermission=permission;}
    else if(provider==="claude"){createClaudeAutomation=level;createClaudePermission=permission;}
    else createCompatibleAutomation={...createCompatibleAutomation,[provider]:level};
    dangerConfirmed=level==="full"&&dangerAcknowledged;
  }
  function chooseEditAutomation(level:AutomationLevel){if(!selected||selected.provider!=="codex"&&level==="confirm")return;editAutomation=level;editPermission=permissionForAutomation(selected.provider,level);editDanger=level==="full"&&dangerAcknowledged;}
  async function quickSetWorkMode(mode:WorkMode){
    if(!selected||sending||workModeOf(selected.provider,selected.permissionProfile,selected.metadata)===mode)return;
    sending=true;
    try{
      const nextAutomation=mode==="plan"?"read":automationLevelOf(selected.permissionProfile,selected.metadata);const permission=mode==="plan"?permissionForAutomation(selected.provider,"read"):permissionForWorkMode(selected.provider,mode,selected.permissionProfile??(selected.provider==="claude"?":read-only":":workspace"));
      if(selected.provider==="claude"||compatibleCreateProvider(selected.provider)){
        const data=await api(`/api/tasks/${selected.provider}/${encodeURIComponent(selected.id)}/settings`,{method:"PATCH",body:JSON.stringify({permissionProfile:permission,workMode:mode,automationLevel:nextAutomation})});
        selected=data.task;taskState.upsert(data.task);
      }else if(selected.threadId&&(!selected.executionHostId||selected.executionHostId==="local")){
        await api(`/api/codex/threads/${selected.threadId}/settings`,{method:"PATCH",headers:{"Idempotency-Key":uuid()},body:JSON.stringify({permissionProfile:permission,workMode:mode,automationLevel:nextAutomation})});
        selected={...selected,permissionProfile:permission,metadata:{...selected.metadata,workMode:mode,automationLevel:nextAutomation}};taskState.upsert(selected);
      }else if(selected.provider==="codex"){
        const data=await api(`/api/tasks/codex/${encodeURIComponent(selected.id)}/settings`,{method:"PATCH",body:JSON.stringify({permissionProfile:permission,workMode:mode,automationLevel:nextAutomation})});selected=data.task;taskState.upsert(data.task);
      }
    }catch(e){error=e instanceof Error?e.message:String(e)}finally{sending=false;}
  }
  async function quickSetAutomation(level:AutomationLevel){
    if(!selected||sending||automationLevelOf(selected.permissionProfile,selected.metadata)===level||selected.provider!=="codex"&&level==="confirm")return;
    if(level==="full"&&!ensureDangerAcknowledgement())return;
    sending=true;try{const permission=permissionForAutomation(selected.provider,level),body={permissionProfile:permission,automationLevel:level,dangerConfirmation:level==="full",fullAccessAcknowledged:level==="full",acknowledgementVersion:level==="full"?1:undefined};let data:any;
      if(selected.provider==="claude"||compatibleCreateProvider(selected.provider))data=await api(`/api/tasks/${selected.provider}/${encodeURIComponent(selected.id)}/settings`,{method:"PATCH",body:JSON.stringify(body)});
      else if(selected.threadId&&(!selected.executionHostId||selected.executionHostId==="local")){await api(`/api/codex/threads/${selected.threadId}/settings`,{method:"PATCH",headers:{"Idempotency-Key":uuid()},body:JSON.stringify(body)});data={task:{...selected,permissionProfile:permission,metadata:{...selected.metadata,automationLevel:level}}};}
      else data=await api(`/api/tasks/codex/${encodeURIComponent(selected.id)}/settings`,{method:"PATCH",body:JSON.stringify(body)});
      selected=data.task;taskState.upsert(data.task);
    }catch(e){error=e instanceof Error?e.message:String(e)}finally{sending=false;}
  }
  let loading = true;
  let setupRequired=false,resumeSetupAfterSettings=false,setupShowOnStartup=true,setupPreferenceBusy=false,setupPreferenceNotice="";
  let ownerClaimChecked=false;
  let ownerClaimRequired=false;
  let ownerClaimInitial:any=null;
  let ownerClaimStatusError="";
  let retryOwnerClaimStatus=()=>{};
  let error = "";
  let quickCreate=false;
  let createBackdropPointer:BackdropPointer|null=null;
  let createOpen = false;let createOpening=false;let createLocationLoading=false;let createLocationError="";let createError="";let createKind:"single"|"parallel"|"review"|"conversation"="single";let reviewDepth:"basic"|"deep"="basic";let reviewFinalization:"primary"|"side-by-side"|"raw"="primary";let reviewApplyFixes=true;let collaborationTimeoutMinutes=30;let conversationTimeoutMinutes=Number(conversationPrefs.timeoutMinutes)||30;let debateMaxTurns=Number(conversationPrefs.maxRounds)||5;let debateUnlimited=conversationPrefs.unlimited===true;let debateUnlimitedConfirmed=false;let debateKind:"discussion"|"artifact-review"=conversationPrefs.kind==="artifact-review"?"artifact-review":"discussion";let conversationFlow:"guided"|"automatic"=conversationPrefs.flow==="automatic"?"automatic":"guided";let conversationTurnLength:"compact"|"rich"="rich";let conversationAllowModelUserCall=conversationPrefs.allowModelUserCall===true;let conversationConclusionRequested=false;let conversationConclusionPath="";let conversationEnabled:Record<ProviderId,boolean>=Object.fromEntries(conversationProviders.map(provider=>[provider,conversationPrefs.enabled?.[provider]??(provider==="codex"||provider==="claude")])) as Record<ProviderId,boolean>;const savedConversationTone=(provider:ProviderId)=>TONE_PRESETS.some(item=>item.id===conversationPrefs.tonePresets?.[provider])?conversationPrefs.tonePresets[provider] as TonePreset:null;/* A null entry keeps that participant on the global character preset. The panel used to carry one shared global/session switch plus a per-provider select, so a single overridden participant silently moved every other one off its global tone. */let conversationTonePresets:Record<ProviderId,TonePreset|null>=Object.fromEntries(conversationProviders.map(provider=>[provider,conversationPrefs.useGlobalTone===false?savedConversationTone(provider):null])) as Record<ProviderId,TonePreset|null>;let conversationCustomTones:Record<ProviderId,string|null>=Object.fromEntries(conversationProviders.map(provider=>[provider,null])) as Record<ProviderId,string|null>;let conversationFirstProvider:ProviderId=conversationProviders.includes(conversationPrefs.firstProvider)?conversationPrefs.firstProvider:conversationProviders.includes(globalDefaultProvider)?globalDefaultProvider:"codex";let conversationUserNickname=typeof conversationPrefs.userNickname==="string"&&conversationPrefs.userNickname.trim()?conversationPrefs.userNickname.slice(0,40):$t("conversation.userDefault");let conversationCodexModel=conversationPrefs.codexModel??globalPrefs.codexModel??savedPrefs.codexModel??"";let conversationCodexEffort=conversationPrefs.codexEffort??globalPrefs.codexEffort??savedPrefs.codexEffort??"";let conversationClaudeModel=conversationPrefs.claudeModel??globalPrefs.claudeModel??savedPrefs.claudeModel??"claude-opus-4-8";let conversationClaudeEffort=conversationPrefs.claudeEffort??globalPrefs.claudeEffort??savedPrefs.claudeEffort??"medium";let conversationCompatibleModels:Record<CompatibleExecutionProvider,string>={grok:conversationPrefs.grokModel??globalCompatibleModels.grok,antigravity:conversationPrefs.antigravityModel??globalCompatibleModels.antigravity,deepseek:conversationPrefs.deepseekModel??globalCompatibleModels.deepseek,ollama:conversationPrefs.ollamaModel??globalCompatibleModels.ollama};let conversationCompatibleEfforts:Record<CompatibleExecutionProvider,string>={grok:conversationPrefs.grokEffort??globalCompatibleEfforts.grok,antigravity:conversationPrefs.antigravityEffort??globalCompatibleEfforts.antigravity,deepseek:conversationPrefs.deepseekEffort??globalCompatibleEfforts.deepseek,ollama:conversationPrefs.ollamaEffort??globalCompatibleEfforts.ollama};
  let reviewEnabled:Record<ProviderId,boolean>=Object.fromEntries(conversationProviders.map(provider=>[provider,savedPrefs.reviewEnabled?.[provider]??(provider==="codex"||provider==="claude")])) as Record<ProviderId,boolean>;
  let reviewTonePresets:Record<ProviderId,TonePreset|null>=Object.fromEntries(conversationProviders.map(provider=>[provider,null])) as Record<ProviderId,TonePreset|null>;
  let reviewCustomTones:Record<ProviderId,string|null>=Object.fromEntries(conversationProviders.map(provider=>[provider,null])) as Record<ProviderId,string|null>;
  let activeReviewParticipants:ProviderId[]=[];
  if(conversationProviders.filter(provider=>reviewEnabled[provider]).length<2)reviewEnabled={...reviewEnabled,codex:true,claude:true};
  if(!conversationProviders.some(provider=>conversationEnabled[provider]))conversationEnabled={...conversationEnabled,codex:true};
  if(!conversationEnabled[conversationFirstProvider])conversationFirstProvider=conversationProviders.find(provider=>conversationEnabled[provider])??"codex";
  function chooseCreateKind(kind:typeof createKind){createKind=kind;if(kind!=="single")syncReviewPrimary();if(kind!=="conversation")debateUnlimitedConfirmed=false;}
  function chooseReviewKind(){if(createKind!=="parallel"&&createKind!=="review")createKind="parallel";syncReviewPrimary();debateUnlimitedConfirmed=false;}
  // Review participants are the enabled providers with the final/primary one first, mirroring conversation mode.
  const reviewParticipants=():ProviderId[]=>activeReviewParticipants;
  function syncReviewPrimary(){const pool=participantList(conversationProviders,reviewEnabled,providerConnections);if(!pool.includes(createProvider))createProvider=pool[0]??fallbackProvider(createProvider,providerConnections);}
  function toggleReviewProvider(provider:ProviderId){const next=!reviewEnabled[provider];if(!next&&reviewParticipants().length<=2)return;reviewEnabled={...reviewEnabled,[provider]:next};syncReviewPrimary();dangerConfirmed=reviewFullAutoSelected()&&dangerAcknowledged;}
  const reviewCallCount=()=>{const count=reviewParticipants().length;return createKind==="parallel"?count:count*(reviewDepth==="deep"?3:2)+(reviewFinalization==="primary"?1:0);};
  const reviewFullAutoSelected=()=>reviewParticipants().some(provider=>createAutomationFor(provider)==="full");
  const reviewPrimaryAutomation=()=>createAutomationFor(createProvider);
  const reviewFixesEnabled=()=>createKind==="review"&&reviewFinalization==="primary"&&reviewApplyFixes&&reviewPrimaryAutomation()!=="read";
  function chooseReviewAutomation(provider:ProviderId,level:AutomationLevel){chooseCreateAutomation(provider,level);dangerConfirmed=reviewFullAutoSelected()&&dangerAcknowledged;}
  function toggleConversationProvider(provider:ProviderId){const next=!conversationEnabled[provider];if(!next&&conversationParticipants.length===1)return;conversationEnabled={...conversationEnabled,[provider]:next};const pool=participantList(conversationProviders,conversationEnabled,providerConnections);if(!pool.includes(conversationFirstProvider))conversationFirstProvider=pool[0]??provider;}
  const conversationToneFor=(provider:ProviderId)=>conversationTonePresets[provider]??characterSettings.providers[provider].tonePreset;
  const conversationToneOverridden=(provider:ProviderId)=>Boolean(conversationTonePresets[provider]);
  const conversationCustomTone=(provider:ProviderId)=>conversationCustomTones[provider]??characterSettings.providers[provider].customTone;
  function chooseConversationTone(provider:ProviderId,tone:TonePreset|null){conversationTonePresets={...conversationTonePresets,[provider]:tone};}
  function setConversationCustomTone(provider:ProviderId,value:string){conversationCustomTones={...conversationCustomTones,[provider]:value};}
  const conversationToneSummary=(provider:ProviderId)=>conversationToneOverridden(provider)
    ?`${$t(`character.tone.${conversationToneFor(provider)}`)} · ${$t("conversation.toneOverride")}`
    :`${$t("conversation.useGlobalTone")} · ${characterToneLabel(provider)}`;
  const reviewToneFor=(provider:ProviderId)=>reviewTonePresets[provider]??characterSettings.providers[provider].tonePreset;
  const reviewCustomTone=(provider:ProviderId)=>reviewCustomTones[provider]??characterSettings.providers[provider].customTone;
  function chooseReviewTone(provider:ProviderId,tone:TonePreset|null){reviewTonePresets={...reviewTonePresets,[provider]:tone};}
  function setReviewCustomTone(provider:ProviderId,value:string){reviewCustomTones={...reviewCustomTones,[provider]:value};}
  let assistOpen=false;let assistPrompt="";let assistSourceContent="";let assistTargetProvider:ProviderId="claude";let assistTargetModel="";let assistTargetEffort="default";let assistTargetTier:string|null=null;let messageQueueRef:any=null;
  let handoffOpen=false;let chainOpen=false;
  let createProvider: ProviderId = globalDefaultProvider;
  $: reviewParticipantPool=participantList(conversationProviders,reviewEnabled,providerConnections);
  $: activeReviewParticipants=[createProvider,...reviewParticipantPool.filter(provider=>provider!==createProvider)].filter(provider=>reviewParticipantPool.includes(provider));
  $: conversationParticipants=participantList(conversationProviders,conversationEnabled,providerConnections);
  // A stored default, participant set, or first responder can name a provider
  // that is no longer connected. Reconcile once the snapshot lands so every
  // creation path keeps a usable selection instead of pointing at dead state.
  $: if(providerConnections.loaded)reconcileProviderSelections(providerConnections);
  function reconcileProviderSelections(availability:ProviderAvailability<ProviderId>){
    if(!availability.connected.length)return;
    const nextConversation=connectedParticipants(conversationProviders,conversationEnabled,availability,1);
    if(conversationProviders.some(provider=>nextConversation[provider]!==conversationEnabled[provider]))conversationEnabled=nextConversation;
    if(!nextConversation[conversationFirstProvider])conversationFirstProvider=conversationProviders.find(provider=>nextConversation[provider])??conversationFirstProvider;
    const nextReview=connectedParticipants(conversationProviders,reviewEnabled,availability,Math.min(2,availability.connected.length));
    if(conversationProviders.some(provider=>nextReview[provider]!==reviewEnabled[provider]))reviewEnabled=nextReview;
    const primaryPool=createKind==="parallel"||createKind==="review"?conversationProviders.filter(provider=>nextReview[provider]):availability.connected;
    if(!primaryPool.includes(createProvider))createProvider=primaryPool[0]??fallbackProvider(createProvider,availability);
  }
  let createProject = "";
  let createHost="local";let createWorkspace="";
  let createPrompt = "";
  const PROMPT_PRESET_CACHE_KEY="deck-prompt-presets",PROMPT_PRESET_SNAPSHOT_KEY="deck-prompt-presets-server-snapshot-v1";
  function savedPromptPresets(){try{return normalizePromptPresets(JSON.parse(localStorage.getItem("deck-prompt-presets")||"[]"));}catch{return[];}}
  function savedPromptPresetSnapshot(){try{const raw=localStorage.getItem(PROMPT_PRESET_SNAPSHOT_KEY);return raw===null?null:normalizePromptPresets(JSON.parse(raw));}catch{return null;}}
  function cachePromptPresets(value:PromptPreset[],serverSnapshot=false){const normalized=normalizePromptPresets(value);localStorage.setItem(PROMPT_PRESET_CACHE_KEY,JSON.stringify(normalized));if(serverSnapshot)localStorage.setItem(PROMPT_PRESET_SNAPSHOT_KEY,JSON.stringify(normalized));return normalized;}
  let customPromptPresets:PromptPreset[]=savedPromptPresets();
  let promptPresetUpdatedAt:string|null=null,promptPresetSyncBusy=false,promptPresetSyncNotice="",promptPresetUploadRetryAfter=0;
  let promptPresetConflict:{server:PromptPreset[];local:PromptPreset[];snapshot:PromptPreset[];merged:PromptPreset[];dropped:PromptPreset[];deletedOnServer:string[];deletedOnLocal:string[];degraded:boolean}|null=null;
  let intakeRecommendation=recommendTaskIntake("");
  $: intakeRecommendation=recommendTaskIntake(createPrompt);
  const allPromptPresets=(custom:PromptPreset[],translate:Translator)=>[...builtinPromptPresets(translate),...custom];
  async function persistPromptPresets(nextValue:PromptPreset[],baseUpdatedAt=promptPresetUpdatedAt){
    const next=cachePromptPresets(nextValue);customPromptPresets=next;promptPresetSyncBusy=true;promptPresetSyncNotice="";
    const body={settings:{version:1 as const,presets:next},baseUpdatedAt},key=uuid();
    const send=()=>api("/api/system-settings/prompt-presets",{method:"PUT",headers:{"Idempotency-Key":key},body:JSON.stringify(body)});
    try{
      let data;try{data=await send();}catch(first){const status=(first as any)?.status;if(status!==undefined&&status!==0)throw first;data=await send();}
      customPromptPresets=cachePromptPresets(data.settings?.presets??next,true);promptPresetUpdatedAt=data.updatedAt??null;promptPresetConflict=null;promptPresetUploadRetryAfter=0;
    }catch(value){
      promptPresetUploadRetryAfter=Date.now()+15_000;promptPresetSyncNotice=value instanceof Error?value.message:String(value);
      try{
        const current=await api("/api/system-settings/prompt-presets"),server=normalizePromptPresets(current.settings?.presets),snapshot=savedPromptPresetSnapshot()??[];
        promptPresetUpdatedAt=current.updatedAt??null;
        if(promptPresetSignature(server)===promptPresetSignature(next)){customPromptPresets=cachePromptPresets(server,true);promptPresetConflict=null;promptPresetSyncNotice="";promptPresetUploadRetryAfter=0;}
        else{const preview=previewPromptPresetMerge(server,next,snapshot);promptPresetConflict={server,local:next,snapshot,...preview,degraded:Boolean(current.degraded)};}
      }catch{}
    }finally{promptPresetSyncBusy=false;}
  }
  async function loadPromptPresetSettings(){
    if(promptPresetSyncBusy||promptPresetConflict)return;
    promptPresetSyncBusy=true;
    try{
      const data=await api("/api/system-settings/prompt-presets"),server=normalizePromptPresets(data.settings?.presets),local=savedPromptPresets(),decision=promptPresetSyncDecision(server,local,savedPromptPresetSnapshot());
      promptPresetUpdatedAt=data.updatedAt??null;promptPresetSyncNotice=data.degraded?$t("preset.serverRecovered"):"";
      if(decision.action==="use-server"){customPromptPresets=cachePromptPresets(server,true);promptPresetConflict=null;}
      else if(decision.action==="upload-local"){if(Date.now()<promptPresetUploadRetryAfter){customPromptPresets=local;promptPresetSyncNotice=$t("preset.syncRetryLater");}else await persistPromptPresets(local,promptPresetUpdatedAt);}
      else{customPromptPresets=local;promptPresetConflict={server,local,snapshot:savedPromptPresetSnapshot()??[],merged:decision.merged,dropped:decision.dropped,deletedOnServer:decision.deletedOnServer,deletedOnLocal:decision.deletedOnLocal,degraded:Boolean(data.degraded)};}
    }catch(value){promptPresetSyncNotice=value instanceof Error?value.message:String(value);}
    finally{promptPresetSyncBusy=false;}
  }
  function useServerPromptPresets(){if(!promptPresetConflict)return;customPromptPresets=cachePromptPresets(promptPresetConflict.server,true);promptPresetConflict=null;promptPresetUploadRetryAfter=0;promptPresetSyncNotice="";}
  function mergePromptPresetConflict(){if(!promptPresetConflict)return;if(promptPresetConflict.dropped.length&&!confirm($t("preset.mergeDropConfirm",{count:promptPresetConflict.dropped.length})))return;void persistPromptPresets(promptPresetConflict.merged,promptPresetUpdatedAt);}
  function savePromptPreset(){
    if(!createPrompt.trim()||promptPresetSyncBusy||promptPresetConflict)return;
    if(customPromptPresets.length>=20){promptPresetSyncNotice=$t("preset.limitReached",{count:20});return;}
    const labelValue=window.prompt($t("preset.namePrompt"),codePointSlice(createPrompt.trim().replace(/\s+/g," "),24));
    const label=labelValue?codePointSlice(labelValue.trim(),40):"";
    if(!label)return;
    const prompt=codePointSlice(createPrompt.trim(),4001);
    if(Array.from(prompt).length>4000){promptPresetSyncNotice=$t("preset.promptTooLong",{count:4000});return;}
    void persistPromptPresets([...customPromptPresets,{id:crypto.randomUUID(),label,prompt}]);
  }
  function deletePromptPreset(id:string){if(promptPresetSyncBusy||promptPresetConflict)return;void persistPromptPresets(customPromptPresets.filter(item=>item.id!==id));}
  function applyIntakeRecommendation(){createProvider=fallbackProvider(intakeRecommendation.provider,providerConnections);chooseCreateKind(intakeRecommendation.kind==="review"?"parallel":"single");}
  let followup = "";
  let sending = false;
  let followupStarting=false;
  let msgAttachments: Attachment[] = [];
  let createAttachments: Attachment[] = [];
  let msgAttachRef:any=null;
  let createAttachRef:any=null;
  const withAttachments = (text:string, files:Attachment[]) => files.length ? `${text.trim()}\n\n${$t("attachment.promptInstruction")}\n${files.map(f=>`- ${f.path} (${f.name})`).join("\n")}` : text;
  let liveStatus:"Live"|"Delayed"|"History"="History";
  let liveUnsubscribe:(()=>void)|null=null;let liveScope=0;let lastLiveSequence=0;const liveIds=new Set<string>();let deltaQueue:AgentEvent[]=[];let deltaTimer:ReturnType<typeof setTimeout>|null=null;let terminalDrainTimer:ReturnType<typeof setTimeout>|null=null;

  const active = new Set(["pending","queued","running","waiting"]);
  const terminal = new Set(["completed","failed","stopped"]);
  let labels:Record<Status,string>;
  $: {$locale;labels={pending:statusLabel("pending"),queued:statusLabel("queued"),running:statusLabel("running"),waiting:statusLabel("waiting"),completed:statusLabel("completed"),failed:statusLabel("failed"),stopped:statusLabel("stopped"),unknown:statusLabel("unknown")};}
  let taskSearchMatches=new Map<string,SessionSearchMatch>();
  $:{
    tasks;projects;taskSearchQuery;
    const next=new Map<string,SessionSearchMatch>();
    if(taskSearchQuery.trim())for(const task of tasks){
      const match=sessionSearchMatch(task,taskSearchQuery,projects.find(item=>item.id===task.projectId)?.name??task.projectId);
      if(match)next.set(task.id,match);
    }
    taskSearchMatches=next;
  }
  const matchesQuery = (task:Task) => !taskSearchQuery.trim()||taskSearchMatches.has(task.id);
  const searchMatchLabel=(match:SessionSearchMatch)=>match.source==="result"?$t("conversation.result"):match.source==="prompt"?$t("conversation.request"):match.source==="log"?$t("conversation.process"):match.source==="error"?labels.failed:$t("common.search");
  const matchesStatus=(task:Task)=>statusFilter===""||(statusFilter==="active"&&active.has(task.status))||(statusFilter==="waiting"&&task.status==="waiting")||(statusFilter==="done"&&task.status==="completed")||(statusFilter==="failed"&&task.status==="failed");
  // Group before applying the status filter. Otherwise an older completed turn
  // from a currently running Claude thread leaks into the Completed tab.
  const grouped = () => latestThreadRows(filtered()).filter(matchesStatus).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
  const turnCount = (task:Task) => task.threadId?tasks.filter(t=>t.provider===task.provider&&t.threadId===task.threadId).length:1;
  // The list must not open a stream per row, so the fan-out badge reads the
  // roll-up the worker already writes into task metadata.
  const fanoutSummary=(task:Task)=>{
    const raw=(task.metadata as any)?.parallelAgents;
    if(!raw||typeof raw!=="object")return null;
    const count=(value:unknown)=>Number.isFinite(Number(value))?Math.max(0,Math.round(Number(value))):0;
    const total=count(raw.total);
    if(!total)return null;
    return{total,running:count(raw.running),waiting:count(raw.waiting),failed:count(raw.failed),completed:count(raw.completed)};
  };
  // Provenance for the session classifier: a collaboration id resolves to the
  // mode and work chain that produced the provider task, so managed and Assist
  // work stays visible while conversation and board executions do not.
  $: collaborationProvenance=new Map(collaborations.map(item=>[item.id,{mode:item.mode,workChainId:item.workChainId??null}]));
  $: sessionClassificationContext={collaborations:collaborationProvenance};
  const filtered = () => tasks.filter((task) => engine!=="conversation" && engine!=="collaboration-work" && (engine === "all" || engine==="conversation-linked" || task.provider === engine) && sessionMatchesConversationScope(task,engine==="conversation-linked"?"conversation-linked":"regular",tasks,sessionClassificationContext) && (!hostFilter||(task.executionHostId??"local")===hostFilter) && (!workspaceFilter||task.workspaceId===workspaceFilter) && (!ownershipFilter||(task.ownership??(task.owned?"claudex-workhouse":"unknown"))===ownershipFilter) && (!sourceFilter||(task.source??"unknown")===sourceFilter) && (!chainFilter||task.workChainId===chainFilter) && matchesQuery(task));
  const collaborationMatchesStatus=(item:Collaboration)=>statusFilter===""||statusFilter==="active"&&["starting","running","waiting-user","cancel-requested"].includes(item.status)||statusFilter==="waiting"&&item.status==="waiting-user"||statusFilter==="done"&&item.status==="completed"||statusFilter==="failed"&&["partial","failed","stop-unconfirmed"].includes(item.status);
  const visibleCollaborations=(conversationOnly=false)=>collaborations.filter(item=>item.mode!=="assist"&&(!conversationOnly||item.mode==="debate")&&collaborationMatchesStatus(item)&&(!taskSearchQuery||item.title.toLowerCase().includes(taskSearchQuery.toLowerCase())));
  const visibleWorkCollaborations=()=>collaborations.filter(item=>item.mode!=="assist"&&item.mode!=="debate"&&collaborationMatchesStatus(item)&&(!taskSearchQuery||item.title.toLowerCase().includes(taskSearchQuery.toLowerCase())));
  type BrowserListItem={kind:"task";id:string;updatedAt:string;task:Task}|{kind:"collaboration";id:string;updatedAt:string;collaboration:Collaboration};
  const buildBrowserItems=():BrowserListItem[]=>{
    const taskItems=grouped().map(task=>({kind:"task" as const,id:task.id,updatedAt:task.updatedAt,task}));
    const collaborationItems=(engine==="conversation"?visibleCollaborations(true):engine==="collaboration-work"?visibleWorkCollaborations():[]).map(collaboration=>({kind:"collaboration" as const,id:collaboration.id,updatedAt:collaboration.updatedAt,collaboration}));
    return newestSessionItems([...taskItems,...collaborationItems]);
  };
  let browserRows:BrowserListItem[]=[];
  $:{engine;tasks;collaborations;statusFilter;hostFilter;workspaceFilter;ownershipFilter;sourceFilter;chainFilter;taskSearchQuery;taskSearchMatches;browserRows=buildBrowserItems();}
  const pageBrowserItems=()=>{const pageCount=Math.max(1,Math.ceil(browserRows.length/PAGE_SIZE)),current=Math.min(page,pageCount);return browserRows.slice((current-1)*PAGE_SIZE,current*PAGE_SIZE);};
  let taskBulkMode=false;let taskBulkSelected=new Map<string,Task>();let taskBulkDeleteOpen=false;let taskBulkAcknowledged=false;let taskBulkDeleting=false;let taskBulkProgress="";
  const taskSessionKey=(task:Task)=>task.threadId?`${task.provider}:${task.threadId}`:task.id;
  const canBulkDeleteTask=(task:Task)=>Boolean(task.threadId&&terminal.has(task.status)&&(!task.executionHostId||task.executionHostId==="local"));
  const taskPageSessions=()=>pageBrowserItems().filter((item):item is Extract<BrowserListItem,{kind:"task"}>=>item.kind==="task").map(item=>item.task);
  function startTaskBulkMode(){taskBulkMode=true;taskBulkSelected=new Map();error="";}
  function exitTaskBulkMode(){taskBulkMode=false;taskBulkSelected=new Map();taskBulkDeleteOpen=false;taskBulkAcknowledged=false;taskBulkProgress="";}
  function toggleTaskBulk(task:Task){if(!canBulkDeleteTask(task))return;const key=taskSessionKey(task),next=new Map(taskBulkSelected);if(next.has(key))next.delete(key);else next.set(key,task);taskBulkSelected=next;}
  function toggleTaskPageBulk(){const eligible=taskPageSessions().filter(canBulkDeleteTask),allSelected=eligible.length>0&&eligible.every(task=>taskBulkSelected.has(taskSessionKey(task))),next=new Map(taskBulkSelected);for(const task of eligible){const key=taskSessionKey(task);if(allSelected)next.delete(key);else next.set(key,task);}taskBulkSelected=next;}
  function openTaskBulkDelete(){if(!taskBulkSelected.size)return;taskBulkAcknowledged=false;taskBulkProgress="";taskBulkDeleteOpen=true;}
  function closeTaskBulkDelete(){if(taskBulkDeleting)return;taskBulkDeleteOpen=false;taskBulkAcknowledged=false;taskBulkProgress="";}
  async function permanentlyDeleteTaskBulk(){
    if(!taskBulkAcknowledged||!taskBulkSelected.size||taskBulkDeleting)return;
    const targets=[...taskBulkSelected.entries()],failures:Array<{key:string;task:Task;message:string}>=[];let deleted=0;taskBulkDeleting=true;
    try{
      for(const [key,task] of targets){taskBulkProgress=$t("bulk.deletingProgress",{current:deleted+failures.length+1,total:targets.length});try{await api(`/api/tasks/${task.provider}/${encodeURIComponent(task.id)}/session`,{method:"DELETE",headers:{"Idempotency-Key":uuid()},body:JSON.stringify({confirmDelete:true,acknowledgeFilesRemain:true})});deleted++;}catch(e){failures.push({key,task,message:e instanceof Error?e.message:String(e)});}}
      taskBulkSelected=new Map(failures.map(item=>[item.key,item.task]));taskBulkDeleteOpen=false;taskBulkAcknowledged=false;taskBulkProgress="";await refresh();
      if(failures.length){taskBulkMode=true;error=$t("bulk.deleteResult",{deleted,failed:failures.length,details:failures.map(item=>`${item.task.title} (${item.message})`).join(", ")});}else exitTaskBulkMode();
    }finally{taskBulkDeleting=false;}
  }
  const collaborationDeleteStatuses=new Set(["completed","partial","failed","cancelled","stop-unconfirmed","archived"]);
  let conversationBulkMode=false;let conversationBulkSelected=new Map<string,Collaboration>();let conversationBulkDeleteOpen=false;let conversationBulkAcknowledged=false;let conversationBulkDeleting=false;let conversationBulkProgress="";
  const canBulkDeleteConversation=(item:Collaboration)=>item.mode==="debate"&&collaborationDeleteStatuses.has(item.status);
  const conversationPageSessions=()=>pageBrowserItems().filter((item):item is Extract<BrowserListItem,{kind:"collaboration"}>=>item.kind==="collaboration").map(item=>item.collaboration);
  function startConversationBulkMode(){conversationBulkMode=true;conversationBulkSelected=new Map();error="";}
  function exitConversationBulkMode(){conversationBulkMode=false;conversationBulkSelected=new Map();conversationBulkDeleteOpen=false;conversationBulkAcknowledged=false;conversationBulkProgress="";}
  function toggleConversationBulk(item:Collaboration){if(!canBulkDeleteConversation(item))return;const next=new Map(conversationBulkSelected);if(next.has(item.id))next.delete(item.id);else next.set(item.id,item);conversationBulkSelected=next;}
  function toggleConversationPageBulk(){const eligible=conversationPageSessions().filter(canBulkDeleteConversation),allSelected=eligible.length>0&&eligible.every(item=>conversationBulkSelected.has(item.id)),next=new Map(conversationBulkSelected);for(const item of eligible){if(allSelected)next.delete(item.id);else next.set(item.id,item);}conversationBulkSelected=next;}
  function openConversationBulkDelete(){if(!conversationBulkSelected.size)return;conversationBulkAcknowledged=false;conversationBulkProgress="";conversationBulkDeleteOpen=true;}
  function closeConversationBulkDelete(){if(conversationBulkDeleting)return;conversationBulkDeleteOpen=false;conversationBulkAcknowledged=false;conversationBulkProgress="";}
  async function permanentlyDeleteConversationBulk(){
    if(!conversationBulkAcknowledged||!conversationBulkSelected.size||conversationBulkDeleting)return;
    const targets=[...conversationBulkSelected.values()],failures:Array<{item:Collaboration;message:string}>=[];let deleted=0;conversationBulkDeleting=true;
    try{
      for(const item of targets){conversationBulkProgress=$t("bulk.deletingProgress",{current:deleted+failures.length+1,total:targets.length});try{await api(`/api/collaborations/${encodeURIComponent(item.id)}`,{method:"DELETE",headers:{"Idempotency-Key":uuid()},body:JSON.stringify({confirmDelete:true,deleteLinkedProviderSessions:true})});deleted++;}catch(e){failures.push({item,message:e instanceof Error?e.message:String(e)});}}
      conversationBulkSelected=new Map(failures.map(item=>[item.item.id,item.item]));conversationBulkDeleteOpen=false;conversationBulkAcknowledged=false;conversationBulkProgress="";await refresh();
      if(failures.length){conversationBulkMode=true;error=$t("bulk.deleteResult",{deleted,failed:failures.length,details:failures.map(item=>`${item.item.title} (${item.message})`).join(", ")});}else exitConversationBulkMode();
    }finally{conversationBulkDeleting=false;}
  }
  function openManagedConversationDocument(document:ConversationDocument){void openConversationFile({path:document.relativePath,pathBase:"workspace",workspaceId:document.workspaceId,initialEdit:false});}
  async function deleteManagedConversationDocument(document:ConversationDocument){
    if(conversationDocumentDeleting||!confirm($t("conclusion.deleteManagedConfirm",{title:document.title,path:document.relativePath})))return;
    conversationDocumentDeleting=document.collaborationId;
    try{
      const next=await api(`/api/collaborations/${encodeURIComponent(document.collaborationId)}/conclusion-markdown`,{method:"DELETE",headers:{"Idempotency-Key":uuid()},body:JSON.stringify({workspaceId:document.workspaceId,relativePath:document.relativePath,revision:document.revision,confirmDelete:true})});
      conversationDocuments=conversationDocuments.filter(item=>item.collaborationId!==document.collaborationId);
      collaborations=collaborations.map(item=>item.id===document.collaborationId?next.session:item);
      error="";
    }catch(value){error=value instanceof Error?value.message:String(value);}finally{conversationDocumentDeleting="";}
  }
  const taskRecent=(provider:ProviderId,taskRows:Task[]):AgentRecentStatus|null=>{const rows=taskRows.filter(item=>item.provider===provider);const running=rows.filter(item=>active.has(item.status));const task=(running.length?running:rows).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0];return task?{provider,taskId:task.id,status:task.status,title:task.title,updatedAt:task.updatedAt,threadId:task.threadId}:null;};
  // Pass `tasks` explicitly so Svelte tracks the polling result as a reactive
  // dependency. Reads hidden inside taskRecent() are otherwise evaluated once.
  $: avatarTasks=avatarSessionRows(tasks,collaborationBoardOpen?collaborationBoardCardIds:undefined,sessionClassificationContext);
  $: if(!selectedCollaboration)collaborationRecent={};
  $: claudeTaskRecent=taskRecent("claude",avatarTasks);
  $: codexTaskRecent=chooseProviderRecent(taskRecent("codex",avatarTasks),codexSessionRecent);
  $: claudeRecent=selectedCollaboration?prioritizeCollaborationStatus(collaborationRecent.claude,claudeTaskRecent):claudeTaskRecent;
  $: codexRecent=selectedCollaboration?prioritizeCollaborationStatus(collaborationRecent.codex,codexTaskRecent):codexTaskRecent;
  $: grokRecent=selectedCollaboration?prioritizeCollaborationStatus(collaborationRecent.grok,taskRecent("grok",avatarTasks)):taskRecent("grok",avatarTasks);
  $: deepseekRecent=taskRecent("deepseek",avatarTasks);
  $: ollamaRecent=taskRecent("ollama",avatarTasks);
  $: antigravityRecent=taskRecent("antigravity",avatarTasks);
  $: collaborationStreamOwners=selectedCollaboration?Object.fromEntries(conversationProviders.map(provider=>[provider,activeAgentStatus(collaborationRecent[provider])])):{};
  $: avatarCompleted={codex:recentCompletedSessions(avatarTasks,"codex"),claude:recentCompletedSessions(avatarTasks,"claude"),antigravity:recentCompletedSessions(avatarTasks,"antigravity"),deepseek:recentCompletedSessions(avatarTasks,"deepseek"),ollama:recentCompletedSessions(avatarTasks,"ollama"),grok:recentCompletedSessions(avatarTasks,"grok")};
  $: avatarActive={codex:activeSessions(avatarTasks,"codex"),claude:activeSessions(avatarTasks,"claude"),antigravity:activeSessions(avatarTasks,"antigravity"),deepseek:activeSessions(avatarTasks,"deepseek"),ollama:activeSessions(avatarTasks,"ollama"),grok:activeSessions(avatarTasks,"grok")};
  const projectName = (id:string) => projects.find((item) => item.id === id)?.name ?? id;
  const projectLabel = (task:Task) => task.projectId.startsWith("dir:") ? (task.cwd ? `…/${task.cwd.split("/").filter(Boolean).slice(-1)[0]}` : $t("workspace.localFolder")) : projectName(task.projectId);
  const collaborationModeLabel=(item:any)=>$t(item.mode==="debate"?"collaboration.mode.conversationShort":item.mode==="parallel"?"collaboration.mode.independentReview":item.mode==="review"?(item.metadata?.reviewDepth?"collaboration.mode.crossReview":"collaboration.mode.legacyReview"):"collaboration.mode.unknown");
  const collaborationPreview=(item:any)=>item.mode==="parallel"?$t("collaboration.preview.independent"):item.mode==="review"?(item.metadata?.reviewDepth?$t("collaboration.preview.crossReview",{depth:item.metadata.reviewDepth==="deep"?$t("collaboration.depth.deepPrefix"):"",count:Number(item.metadata?.reviewExchangeCalls??4)+(item.metadata?.reviewFinalization==="primary"?1:0)}):$t("collaboration.preview.legacyReview")):$t("collaboration.preview.conversation",{flow:$t(item.metadata?.conversationFlow==="guided"?"collaboration.flow.guided":"collaboration.flow.automatic"),round:item.metadata?.currentRound??1,max:item.maxTurnsPerParticipant??"∞"});
  const taskDeleteUnavailableLabel=(task:Task)=>$t(active.has(task.status)?"bulk.cannotDeleteRunning":task.executionHostId&&task.executionHostId!=="local"?"bulk.cannotDeleteRemote":"bulk.cannotDelete");
  const hostName=(id:string|null|undefined)=>hosts.find(item=>item.id===(id??"local"))?.displayName??(id??"local");
  const workerOnline=(id:string|null|undefined)=>{
    const host=hosts.find(item=>item.id===(id??"local"));
    return host?host.status==="online"||host.status==="connected":null;
  };
  const gitOverviewForAllSessions=()=>workspaceGitOverview(tasks,workspaces);
  const createWorkspaces=()=>workspaces.filter(item=>item.hostId===createHost&&item.projectId===createProject);
  const executionHostName=(item:{id:string;displayName:string})=>item.id==="local"?$t("host.thisPc"):item.displayName;
  const createLocations=()=>workspaces.filter(item=>item.hostId===createHost);
  // ---- create panel presentation -------------------------------------------
  // Automation runs most-restrictive first so the irreversible option is never
  // the one a thumb lands on by default.
  const AUTOMATION_ORDER:AutomationLevel[]=["read","confirm","auto","full"];
  const automationLabel=(level:AutomationLevel)=>$t(level==="full"?"permission.fullAccess":level==="auto"?"permission.automatic":level==="confirm"?"permission.confirm":"permission.readOnly");
  const automationDescription=(level:AutomationLevel)=>$t(level==="full"?"permission.fullAccessDescription":level==="auto"?"permission.automaticDescription":level==="confirm"?"permission.confirmDescription":"permission.readOnlyDescription");
  const workModeLabel=(mode:WorkMode)=>$t(mode==="plan"?"workMode.plan":"workMode.default");
  const createWorkspaceLabel=()=>{const found=workspaces.find(item=>item.id===createWorkspace);return found?projectName(found.projectId):$t("workspace.noRegistered");};
  const createHostLabel=()=>{const found=hosts.find(item=>item.id===createHost);return found?executionHostName(found):createHost;};
  const providerNames=(list:ProviderId[])=>list.map(providerDisplayName).join(", ");
  let createLocationOpen=false,toneSheetProvider:ProviderId|null=null,toneSheetMode:"conversation"|"review"="conversation";
  function openToneSheet(provider:ProviderId,mode:"conversation"|"review"){toneSheetProvider=provider;toneSheetMode=mode;}
  // The panel states its own configuration as a sentence whose values are the
  // controls. Tapping a value scrolls to the field that owns it.
  // Svelte's legacy reactivity tracks the identifiers an expression names, not
  // the state a called function reads. Anything derived through a helper names
  // its inputs here so the value is recomputed when they change.
  $: createSayParts=tracked(createKind,createProvider,createWorkspace,workspaces,conversationFirstProvider,
    conversationEnabled,conversationFlow,debateMaxTurns,debateUnlimited,reviewEnabled,reviewDepth,reviewFinalization,
    reviewApplyFixes,createCodexWorkMode,createClaudeWorkMode,createCompatibleWorkModes,
    createCodexAutomation,createClaudeAutomation,createCompatibleAutomation,$t)?createSay():[];
  const tracked=(..._inputs:unknown[])=>true;
  // createAutomationFor/createWorkModeFor read state the template expression
  // never names, so a text node or {#if} built from them kept its first value
  // while the surrounding buttons restyled. Mirror the values into reactive
  // declarations and read those from the markup instead.
  $: createAutomationNow=(createProvider==="codex"?createCodexAutomation:createProvider==="claude"?createClaudeAutomation:createCompatibleAutomation[createProvider as CompatibleExecutionProvider]) as AutomationLevel;
  $: createWorkModeNow=(createProvider==="codex"?createCodexWorkMode:createProvider==="claude"?createClaudeWorkMode:createCompatibleWorkModes[createProvider as CompatibleExecutionProvider]) as WorkMode;
  $: createAutomations=Object.fromEntries(conversationProviders.map(provider=>[provider,
    provider==="codex"?createCodexAutomation:provider==="claude"?createClaudeAutomation:createCompatibleAutomation[provider as CompatibleExecutionProvider]])) as Record<ProviderId,AutomationLevel>;
  $: reviewHasFullAuto=activeReviewParticipants.some(provider=>createAutomations[provider]==="full");
  $: reviewPrimaryReadOnly=createAutomations[createProvider]==="read";
  $: reviewFixesNow=createKind==="review"&&reviewFinalization==="primary"&&reviewApplyFixes&&!reviewPrimaryReadOnly;
  $: createLocationSummary=tracked(hosts,workspaces,createHost,createWorkspace,$t)?`${createHostLabel()} · ${createWorkspaceLabel()}`:"";
  $: reviewCallCountNow=tracked(createKind,reviewDepth,reviewFinalization,reviewEnabled,createProvider)?reviewCallCount():0;
  // Each participant decides on its own whether to keep the global character
  // tone, so the row has to restate that decision after every sheet choice.
  $: conversationToneRows=Object.fromEntries(conversationProviders.map(provider=>{
    const override=conversationTonePresets[provider];
    return[provider,{
      override:Boolean(override),
      name:$t(`character.tone.${override??characterSettings.providers[provider].tonePreset}`),
      scope:$t(override?"conversation.toneOverride":"conversation.toneScopeGlobal")
    }];
  })) as Record<ProviderId,{override:boolean;name:string;scope:string}>;
  $: reviewToneRows=Object.fromEntries(conversationProviders.map(provider=>{
    const override=reviewTonePresets[provider];
    return[provider,{
      override:Boolean(override),
      name:$t(`character.tone.${override??characterSettings.providers[provider].tonePreset}`),
      scope:$t(override?"conversation.toneOverride":"conversation.toneScopeGlobal")
    }];
  })) as Record<ProviderId,{override:boolean;name:string;scope:string}>;
  const createSay=()=>{
    if(createKind==="conversation")return buildSay($t("create.sayConversation"),{
      first:providerDisplayName(conversationFirstProvider),
      others:providerNames(conversationProviders.filter(provider=>conversationEnabled[provider]&&provider!==conversationFirstProvider)),
      flow:$t(conversationFlow==="automatic"?"collaboration.flow.automatic":"collaboration.flow.guided"),
      turns:debateUnlimited?$t("conversation.unlimited"):$t("conversation.roundCount.other",{count:debateMaxTurns}),
      automation:$t("permission.readOnly")
    });
    if(createKind==="parallel"||createKind==="review")return buildSay($t("create.sayReview"),{
      participants:providerNames(activeReviewParticipants),
      workspace:createWorkspaceLabel(),
      method:$t(createKind==="review"?"collaboration.mode.crossReview":"collaboration.mode.independentReview"),
      primary:providerDisplayName(createProvider),
      finish:$t(reviewFixesEnabled()?"create.sayFinishFix":"create.sayFinishReport")
    });
    return buildSay($t("create.saySingle"),{
      provider:providerDisplayName(createProvider),
      workspace:createWorkspaceLabel(),
      automation:automationLabel(createAutomationFor(createProvider)),
      mode:workModeLabel(createWorkModeFor(createProvider))
    });
  };
  function revealCreateField(name:string){
    const target=document.getElementById(`create-${name}`);
    if(!target)return;
    if(name==="workspace"||name==="provider"&&createKind==="single")createLocationOpen=name==="workspace"||createLocationOpen;
    target.scrollIntoView({block:"center",behavior:"smooth"});
    target.classList.add("field-flash");
    setTimeout(()=>target.classList.remove("field-flash"),900);
  }
  const createSayTarget=(name:string)=>name==="workspace"?"workspace":name==="provider"||name==="first"||name==="others"||name==="participants"||name==="primary"?"provider":name==="automation"?"automation":name==="mode"?"workmode":name==="turns"?"turns":name==="method"?"method":name==="flow"?"flow":name==="finish"?"finish":name;
  function setCreateTurns(value:number){debateMaxTurns=Math.min(100,Math.max(1,Math.round(Number.isFinite(value)?value:1)));}
  function syncCreateWorkspace(){
    const current=createLocations().find(item=>item.id===createWorkspace);
    if(current){createProject=current.projectId;return;}
    const fallback=createWorkspaces()[0]??createLocations()[0];
    createWorkspace=fallback?.id??"";
    if(fallback)createProject=fallback.projectId;
  }
  function syncCodexOptions(){
    const visible=availableCodexModels();if(!visible.length)return;
    const current=visible.find((item:any)=>item.id===createModel),preferred=globalCodexModel;
    const model=current??visible.find((item:any)=>item.id===preferred)??visible.find((item:any)=>item.isDefault)??visible[0];
    const changed=createModel!==model.id;createModel=model.id;
    const preferredEffort=globalCodexEffort;
    if(!model.supportedReasoningEfforts?.some((item:any)=>item.reasoningEffort===createEffort))createEffort=model.supportedReasoningEfforts?.some((item:any)=>item.reasoningEffort===preferredEffort)?preferredEffort:model.defaultReasoningEffort??model.supportedReasoningEfforts?.[0]?.reasoningEffort??"medium";
    if(changed)createTier=globalCodexTier==="priority"&&model.serviceTiers?.some((item:any)=>item.id==="priority")?"priority":null;
    else if(!model.serviceTiers?.some((item:any)=>item.id===createTier))createTier=null;
  }
  function syncGlobalCodexOptions(){
    const visible=availableCodexModels();if(!visible.length)return;
    const model=visible.find((item:any)=>item.id===globalCodexModel)??visible.find((item:any)=>item.isDefault)??visible[0];
    const changed=globalCodexModel!==model.id;globalCodexModel=model.id;
    if(!model.supportedReasoningEfforts?.some((item:any)=>item.reasoningEffort===globalCodexEffort))globalCodexEffort=model.defaultReasoningEffort??model.supportedReasoningEfforts?.[0]?.reasoningEffort??"medium";
    if(changed||!model.serviceTiers?.some((item:any)=>item.id===globalCodexTier))globalCodexTier=null;
  }
  const conversationCodexModelInfo=()=>allCodexModelOptions().find((item:any)=>item.id===conversationCodexModel&&!item.hidden);
  function syncConversationCodexOptions(){
    const visible=availableCodexModels();if(!visible.length)return;
    const model=visible.find((item:any)=>item.id===conversationCodexModel)??visible.find((item:any)=>item.isDefault)??visible[0];conversationCodexModel=model.id;
    if(!model.supportedReasoningEfforts?.some((item:any)=>item.reasoningEffort===conversationCodexEffort))conversationCodexEffort=model.defaultReasoningEffort??model.supportedReasoningEfforts?.[0]?.reasoningEffort??"medium";
  }
  function conversationCodexModelChanged(){syncConversationCodexOptions();}
  function syncConversationClaudeOptions(){
    const models=availableClaudeModels();if(models.length&&!models.some(item=>item.id===conversationClaudeModel))conversationClaudeModel=models[0].id;
    if(claudeEfforts.length&&!claudeEfforts.some(item=>item.id===conversationClaudeEffort))conversationClaudeEffort=claudeEfforts.find(item=>item.id==="default")?.id??claudeEfforts[0].id;
  }
  function syncConversationCompatibleOptions(){for(const provider of compatibleProviders){const models=availableCompatibleModels(provider),efforts=compatibleEffortOptions(provider);if(models.length&&!models.some(item=>item.id===conversationCompatibleModels[provider]))conversationCompatibleModels={...conversationCompatibleModels,[provider]:models[0].id};if(efforts.length&&!efforts.some(item=>item.id===conversationCompatibleEfforts[provider]))conversationCompatibleEfforts={...conversationCompatibleEfforts,[provider]:"default"};}}
  function syncAllGlobalModelChoices(){syncGlobalCodexOptions();syncCodexOptions();syncConversationCodexOptions();syncConversationClaudeOptions();syncConversationCompatibleOptions();const claude=availableClaudeModels(),codex=availableCodexModels();if(claude.length&&!claude.some(item=>item.id===globalClaudeModel))globalClaudeModel=claude[0].id;if(claude.length&&!claude.some(item=>item.id===createClaudeModel))createClaudeModel=globalClaudeModel;for(const provider of compatibleProviders){const efforts=compatibleEffortOptions(provider);if(efforts.length&&!efforts.some(item=>item.id===globalCompatibleEfforts[provider]))globalCompatibleEfforts={...globalCompatibleEfforts,[provider]:"default"};if(efforts.length&&!efforts.some(item=>item.id===createCompatibleEfforts[provider]))createCompatibleEfforts={...createCompatibleEfforts,[provider]:globalCompatibleEfforts[provider]};const models=availableCompatibleModels(provider);if(models.length&&!models.some(item=>item.id===globalCompatibleModels[provider]))globalCompatibleModels={...globalCompatibleModels,[provider]:models[0].id};const selected=createCompatibleModel(provider);if(models.length&&!models.some(item=>item.id===selected))setCreateCompatibleModel(provider,globalCompatibleModels[provider]);}if(claudeEfforts.length&&!claudeEfforts.some(item=>item.id===globalClaudeEffort))globalClaudeEffort=claudeEfforts.find(item=>item.id==="default")?.id??claudeEfforts[0].id;if(claude.length&&!claude.some(item=>item.id===delegationSettings.claude.model))delegationSettings={...delegationSettings,claude:{...delegationSettings.claude,model:claude[0].id}};if(codex.length&&!codex.some((item:any)=>item.id===delegationSettings.codex.model))setDelegationCodexModel(codex.find((item:any)=>item.isDefault)?.id??codex[0].id);}
  function applyGlobalDefaultsToCreate(){
    createModel=globalCodexModel;createEffort=globalCodexEffort;createTier=globalCodexTier;createCodexWorkMode=globalCodexWorkMode;createCodexAutomation=globalCodexAutomation;createPermission=permissionForAutomation("codex",createCodexAutomation);
    createClaudeModel=globalClaudeModel;createClaudeEffort=globalClaudeEffort;createClaudeWorkMode=globalClaudeWorkMode;createClaudeAutomation=globalClaudeAutomation;createClaudePermission=permissionForAutomation("claude",createClaudeAutomation);
    createGrokModel=globalCompatibleModels.grok;createAntigravityModel=globalCompatibleModels.antigravity;createDeepseekModel=globalCompatibleModels.deepseek;createOllamaModel=globalCompatibleModels.ollama;createCompatibleEfforts={...globalCompatibleEfforts};createCompatibleWorkModes={...globalCompatibleWorkModes};createCompatibleAutomation={...globalCompatibleAutomation};
    // The saved default may point at a provider that has since been
    // disconnected; fall back to a connected one instead of opening the dialog
    // on an engine that cannot start.
    createProvider=fallbackProvider(globalDefaultProvider,providerConnections);dangerConfirmed=createAutomationFor(createProvider)==="full"&&dangerAcknowledged;
  }
  function applyPlatformDefaults(snapshot:any){
    if(!shouldApplyPlatformAutomationDefault(snapshot?.platform,snapshot?.defaults?.codexAutomation,persistedCodexAutomation)||snapshot?.defaults?.codexAutomation!==platformAutomationDefault("codex","win32"))return;
    globalCodexAutomation="confirm";
    createCodexAutomation="confirm";
    createPermission=permissionForAutomation("codex","confirm");
  }
  let hostDataLoadPromise:Promise<void>|null=null;
  let workspaceCatalogLoadPromise:Promise<Workspace[]>|null=null;
  async function loadWorkspaceCatalog(){
    if(workspaceCatalogLoadPromise)return workspaceCatalogLoadPromise;
    workspaceCatalogLoadPromise=(async()=>{
      const data=await api("/api/workspaces",{}, {caller:"App.loadWorkspaceCatalog"});
      if(!Array.isArray(data?.workspaces))throw new Error("Workspace catalog response is invalid.");
      return mergeWorkspaceRecords(data.workspaces as Workspace[]);
    })();
    try{return await workspaceCatalogLoadPromise;}finally{workspaceCatalogLoadPromise=null;}
  }
  function applyWorkspaceCatalog(catalog:Workspace[]){
    workspaces=catalog;
    syncCreateWorkspace();
    if(taskSettingsOpen)syncEditWorkspace();
  }
  async function loadHostData(){
    if(hostDataLoadPromise)return hostDataLoadPromise;
    hostDataLoadPromise=(async()=>{
      let locations:any;
      try{locations=await api("/api/location-options");}
      catch{const[p,w]=await Promise.all([api("/api/projects"),api("/api/workspaces")]);locations={projects:p.projects,workspaces:w.workspaces};}
      const[c,h]=await Promise.all([api("/api/providers/codex/models").catch(()=>({catalog})),api("/api/hosts").catch(()=>({hosts}))]);
      projects=locations.projects??[];catalog=c.catalog??catalog;hosts=h.hosts??hosts;applyWorkspaceCatalog(mergeWorkspaceRecords(locations.workspaces??[]));
      if(!projects.some(item=>item.id===createProject&&item.enabled))createProject=projects.find(item=>item.enabled)?.id??"";
      if(!hosts.some(item=>item.id===createHost&&item.status==="online"))createHost=hosts.find(item=>item.id==="local")?.id??hosts.find(item=>item.status==="online")?.id??"local";
      syncCodexOptions();syncConversationCodexOptions();syncConversationClaudeOptions();syncCreateWorkspace();if(taskSettingsOpen)syncEditWorkspace();
    })();
    try{await hostDataLoadPromise;}finally{hostDataLoadPromise=null;}
  }
  async function loadCreateLocations(){
    createLocationLoading=true;createLocationError="";
    try{await loadHostData();syncCreateWorkspace();}
    catch(value){createLocationError=value instanceof Error?value.message:String(value);}
    finally{createLocationLoading=false;}
  }
  async function openCreate(){
    if(createOpening){createOpen=true;return;}
    quickCreate=false;
    applyGlobalDefaultsToCreate();
    createGoogleSearchMode="off";
    applyCreateDefaultsForTab(engine);conversationTurnLength="rich";createError="";
    if(isAuthProvider(createProvider)&&accountFor(createProvider)?.state==="connected"){const next={...authFeedback};delete next[createProvider];authFeedback=next;}
    const locationLoad=loadCreateLocations();
    createOpen=true;
    createOpening=true;
    try{
      // Connection state gates every engine choice below, so refresh it with
      // the rest of the dialog data instead of letting the chips flip after the
      // spinner clears.
      await Promise.allSettled([locationLoad,loadAntigravityExecutionSettings(),loadGlobalModelSettings(true),loadClaudeModelCatalog(),loadPromptPresetSettings()]);
      syncAllGlobalModelChoices();syncCreateWorkspace();
      const availability=providerAvailability<ProviderId>(conversationProviders,providerAccounts,providerAccountsLoaded);
      createProvider=fallbackProvider(createProvider,availability);reconcileProviderSelections(availability);
    }finally{createOpening=false;}
  }
  async function openQuickCreate(){await openCreate();chooseCreateKind("single");chooseCreateAutomation("codex","auto");chooseCreateAutomation("claude","auto");quickCreate=true;}
  async function openOverviewCreate(provider:"codex"|"claude"){await openCreate();chooseCreateKind("single");createProvider=fallbackProvider(provider,providerConnections);}
  async function openOverviewReview(){await openCreate();chooseReviewKind();}
  function openOverviewWorker(){globalTab="infrastructure";openGlobalSettings();}
  async function openVscodeContext(){
    const context=vscodeContextFromLocation(location);
    if(!context)return false;
    history.replaceState(null,"",`${location.pathname}${location.search}`);
    await openCreate();
    createKind="single";
    vscodeContext=context;
    createPrompt=vscodeContextPrompt(context);
    const workspace=matchingVscodeWorkspace(context,workspaces);
    if(workspace){
      createHost=workspace.hostId;createProject=workspace.projectId;createWorkspace=workspace.id;
    }else createError=$t("vscode.workspaceNotFound",{path:context.workspacePath});
    return true;
  }
  async function openSharedTask(){
    const token=new URLSearchParams(location.search).get("share");
    if(!token)return false;
    deepLinkOpening=true;
    try{
      const payload=await api(`/api/share-target/${encodeURIComponent(token)}`,{}, {caller:"App.shareTarget"});
      history.replaceState(null,"",location.pathname);
      await openCreate();
      createKind="single";createPrompt=sharedTaskPrompt(payload);
      createAttachments=Array.isArray(payload.files)?payload.files.filter((item:any)=>item&&typeof item.path==="string"&&typeof item.name==="string"&&Number.isFinite(Number(item.size))).slice(0,5):[];
      return true;
    }catch(value){
      history.replaceState(null,"",location.pathname);
      error=value instanceof Error?value.message:String(value);
      return false;
    }finally{deepLinkOpening=false;}
  }
  function retryTaskAfterAuth(task:Task){openCreate();createKind="single";createProvider=fallbackProvider(task.provider,providerConnections);createProject=task.projectId;if(task.workspaceId)createWorkspace=task.workspaceId;createPrompt=task.prompt??"";}
  const uuid = () => crypto.randomUUID();
  const focusNode = (node:HTMLElement) => { node.focus(); };
  const defaultSettingsSignature=()=>JSON.stringify({globalDefaultProvider,globalCodexModel,globalCodexEffort,globalCodexTier,globalCodexWorkMode,globalCodexAutomation,globalClaudeModel,globalClaudeEffort,globalClaudeWorkMode,globalClaudeAutomation,globalCompatibleModels,globalCompatibleEfforts,globalCompatibleWorkModes,globalCompatibleAutomation,delegationSettings,globalModelSettings,allowPaidCredits,claudeSwitchModelsOnFlag,antigravityExecution});
  const displaySettingsSignature=()=>JSON.stringify({theme,palette,skin,sessionTextSize,conversationTextSize,codexAvatar,showAvatars,showSpeech,collapseCompleted,notifications,vibration,rememberLast,enterToSend,avatarAutoCollapse,avatarCollapseDelayMs,scrollAutoSwitch,immersiveScroll,hideLocalPaths,pushPreferences});
  const characterSettingsSignature=()=>JSON.stringify(characterSettings);
  const globalTabDirty=(tab:GlobalTab)=>tab==="defaults"?globalBaseline.defaults!==defaultSettingsSignature():tab==="characters"?globalBaseline.characters!==characterSettingsSignature():tab==="display"?globalBaseline.display!==displaySettingsSignature():false;
  const globalDirty=()=>GLOBAL_TABS.some(item=>globalTabDirty(item.id));
  function captureGlobalBaseline(){globalBaseline={defaults:defaultSettingsSignature(),characters:characterSettingsSignature(),display:displaySettingsSignature()};}
  function restoreGlobalBaseline(){
    try{const value=JSON.parse(globalBaseline.defaults);globalDefaultProvider=value.globalDefaultProvider;globalCodexModel=value.globalCodexModel;globalCodexEffort=value.globalCodexEffort;globalCodexTier=value.globalCodexTier;globalCodexWorkMode=value.globalCodexWorkMode;globalCodexAutomation=value.globalCodexAutomation;globalClaudeModel=value.globalClaudeModel;globalClaudeEffort=value.globalClaudeEffort;globalClaudeWorkMode=value.globalClaudeWorkMode;globalClaudeAutomation=value.globalClaudeAutomation;globalCompatibleModels=value.globalCompatibleModels??globalCompatibleModels;globalCompatibleEfforts=value.globalCompatibleEfforts??globalCompatibleEfforts;globalCompatibleWorkModes=value.globalCompatibleWorkModes??globalCompatibleWorkModes;globalCompatibleAutomation=value.globalCompatibleAutomation??globalCompatibleAutomation;delegationSettings=value.delegationSettings??delegationSettings;globalModelSettings=value.globalModelSettings??globalModelSettings;allowPaidCredits=value.allowPaidCredits===true;claudeSwitchModelsOnFlag=value.claudeSwitchModelsOnFlag!==false;antigravityExecution=structuredClone(value.antigravityExecution??antigravityExecution);}catch{}
    try{characterSettings=JSON.parse(globalBaseline.characters);avatarDisplayMode.set(characterSettings.avatarDisplay);}catch{}
    try{const value=JSON.parse(globalBaseline.display);applyTheme(value.theme);applyPalette(normalizePalette(value.palette));applySkin(normalizeSkin(value.skin));applySessionTextSize(normalizeTextSize(value.sessionTextSize));applyConversationTextSize(normalizeTextSize(value.conversationTextSize));codexAvatar=value.codexAvatar;showAvatars=value.showAvatars;showSpeech=value.showSpeech;collapseCompleted=value.collapseCompleted;notifications=value.notifications;vibration=value.vibration;rememberLast=value.rememberLast;enterToSend=value.enterToSend;avatarAutoCollapse=value.avatarAutoCollapse;avatarCollapseDelayMs=value.avatarCollapseDelayMs;scrollAutoSwitch=value.scrollAutoSwitch;immersiveScroll=value.immersiveScroll!==false;hideLocalPaths=value.hideLocalPaths===true;pushPreferences=value.pushPreferences;}catch{}
  }
  async function loadCharacterSettings(){if(charactersLoading)return;const wasClean=!globalBaseline.characters||globalBaseline.characters===characterSettingsSignature();charactersLoading=true;try{const[data,emotionData]=await Promise.all([api("/api/system-settings/characters"),api("/api/emotion").catch(()=>null)]);const loaded=data.settings??structuredClone(DEFAULT_CHARACTERS);if(emotionData?.outfitsByProvider&&typeof emotionData.outfitsByProvider==="object")providerOutfits={...providerOutfits,...emotionData.outfitsByProvider};const providers={...DEFAULT_CHARACTERS.providers,...loaded.providers};for(const provider of ["codex","claude","grok","antigravity","deepseek","ollama"] as ProviderId[]){const choices=providerOutfits[provider],saved=String(providers[provider]?.avatarOutfit??"");providers[provider]={...providers[provider],avatarOutfit:choices.includes(saved)?saved:choices[0]};}characterSettings={...loaded,avatarDisplay:loaded.avatarDisplay??"character",providers};avatarDisplayMode.set(characterSettings.avatarDisplay);charactersLoaded=true;if(wasClean)globalBaseline.characters=characterSettingsSignature();}catch(e){globalSaveNotice=e instanceof Error?e.message:String(e);}finally{charactersLoading=false;}}
  async function loadDelegationSettings(){if(delegationLoading)return;const wasClean=!globalBaseline.defaults||globalBaseline.defaults===defaultSettingsSignature();delegationLoading=true;try{const data=await api("/api/system-settings/delegation"),settings=data.settings??DEFAULT_DELEGATION_SETTINGS;delegationSettings=structuredClone(settings);if(wasClean){const compatible=compatibleUiFromDelegation(delegationSettings,globalCompatibleModels,globalCompatibleEfforts);globalCompatibleModels=compatible.models;globalCompatibleEfforts=compatible.efforts;}delegationLoaded=true;if(wasClean)globalBaseline.defaults=defaultSettingsSignature();}catch(e){globalSaveNotice=e instanceof Error?e.message:String(e);}finally{delegationLoading=false;}}
  async function loadGlobalModelSettings(snapshot=false){
    if(globalModelsLoadPromise)return globalModelsLoadPromise;
    globalModelsLoadPromise=(async()=>{
      const wasClean=!globalBaseline.defaults||globalBaseline.defaults===defaultSettingsSignature();globalModelsLoading=true;
      try{const data=await api(`/api/system-settings/models${snapshot?"?snapshot=true":""}`);globalModelSettings=normalizeGlobalModelSettings(data.settings);globalModelCandidates=normalizeModelCandidates(data.candidates);globalModelsLoaded=true;syncAllGlobalModelChoices();if(wasClean)globalBaseline.defaults=defaultSettingsSignature();}
      catch(e){globalSaveNotice=e instanceof Error?e.message:String(e);}
      finally{globalModelsLoading=false;}
    })();
    try{await globalModelsLoadPromise;}finally{globalModelsLoadPromise=null;}
  }
  async function loadCreditUsageSettings(){if(creditUsageLoading)return;const wasClean=!globalBaseline.defaults||globalBaseline.defaults===defaultSettingsSignature();creditUsageLoading=true;try{const data=await api("/api/system-settings/credit-usage");allowPaidCredits=data.settings?.allowPaidCredits===true;creditUsageLoaded=true;if(wasClean)globalBaseline.defaults=defaultSettingsSignature();}catch(e){globalSaveNotice=e instanceof Error?e.message:String(e);}finally{creditUsageLoading=false;}}
  async function loadClaudeExecutionSettings(){if(claudeExecutionLoading)return;const wasClean=!globalBaseline.defaults||globalBaseline.defaults===defaultSettingsSignature();claudeExecutionLoading=true;try{const data=await api("/api/system-settings/claude-execution");claudeSwitchModelsOnFlag=data.settings?.switchModelsOnFlag!==false;claudeExecutionLoaded=true;if(wasClean)globalBaseline.defaults=defaultSettingsSignature();}catch(e){globalSaveNotice=e instanceof Error?e.message:String(e);}finally{claudeExecutionLoading=false;}}
  async function loadAntigravityExecutionSettings(){if(antigravityExecutionLoading)return;const wasClean=!globalBaseline.defaults||globalBaseline.defaults===defaultSettingsSignature();antigravityExecutionLoading=true;try{const data=await api("/api/system-settings/antigravity-execution");antigravityExecution=structuredClone(data.settings??DEFAULT_ANTIGRAVITY_EXECUTION);antigravityExecutionLoaded=true;if(wasClean)globalBaseline.defaults=defaultSettingsSignature();}catch(e){globalSaveNotice=e instanceof Error?e.message:String(e);}finally{antigravityExecutionLoading=false;}}
  async function uploadAntigravityCredentials(event:Event){const input=event.currentTarget as HTMLInputElement,file=input.files?.[0];input.value="";if(!file)return;antigravityCredentialNotice="";if(file.size<1||file.size>1024*1024){antigravityCredentialNotice=$t("antigravityExecution.credentialsSize");return;}antigravityCredentialUploading=true;try{const form=new FormData();form.append("credentials",file,file.name);const response=await fetch(`/api/system-settings/antigravity-execution/credentials?${new URLSearchParams({projectId:antigravityExecution.vertex.projectId,location:antigravityExecution.vertex.location})}`,{method:"POST",headers:{"X-Claudex-Workhouse-Request":"1","Idempotency-Key":uuid(),Accept:"application/json"},body:form}),data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error??`HTTP ${response.status}`);antigravityExecution=structuredClone(data.settings);antigravityExecutionLoaded=true;antigravityCredentialNotice=$t("antigravityExecution.credentialsUploaded",{type:data.credential?.type??"Google"});await testAntigravityExecution();}catch(e){antigravityCredentialNotice=e instanceof Error?e.message:String(e);}finally{antigravityCredentialUploading=false;}}
  function applyAntigravityCatalog(data:any){const candidates=structuredClone(data.candidates?.antigravity??[]);globalModelCandidates={...globalModelCandidates,antigravity:candidates};const ids=new Set(candidates.map((item:GlobalModelEntry)=>item.id));let models=globalModelSettings.antigravity.models.filter(item=>ids.has(item.id));if(!models.length)models=structuredClone(data.settings?.antigravity?.models??candidates.slice(0,1));globalModelSettings={...globalModelSettings,antigravity:{models}};if(models.length&&!models.some(item=>item.id===globalCompatibleModels.antigravity))globalCompatibleModels={...globalCompatibleModels,antigravity:models[0].id};syncAllGlobalModelChoices();}
  async function testAntigravityExecution(){if(antigravityExecutionTesting)return;antigravityExecutionTesting=true;antigravityExecutionNotice="";try{await api("/api/system-settings/antigravity-execution",{method:"PUT",headers:{"Idempotency-Key":uuid()},body:JSON.stringify(antigravityExecution)});const result=await api("/api/system-settings/antigravity-execution/test",{method:"POST",headers:{"Idempotency-Key":uuid()}});await loadProviderAccounts(true);geminiCliReadiness=result.geminiCli??null;if(!result.ok)throw new Error(result.error||$t("antigravityExecution.testFailed"));applyAntigravityCatalog(await api("/api/system-settings/models"));antigravityExecutionLoaded=true;geminiCliReadiness=result.geminiCli??null;antigravityExecutionNotice=$t("antigravityExecution.testSuccess",{count:result.models});}catch(e){antigravityExecutionNotice=e instanceof Error?e.message:String(e);}finally{antigravityExecutionTesting=false;}}
  async function loadPathDisplay(){const wasClean=!globalBaseline.display||globalBaseline.display===displaySettingsSignature();try{const data=await api("/api/system-settings/path-display");hideLocalPaths=data.hideLocalPaths===true;if(wasClean)globalBaseline.display=displaySettingsSignature();}catch{/* Keep the last local display preference if the server is temporarily unavailable. */}}
  function selectGlobalTab(tab:GlobalTab){globalTab=tab;localStorage.setItem("deck-global-settings-tab",tab);
    if(tab==="account"){void loadProviderAccounts();void loadCompatibleProviderSettings();void loadAntigravityExecutionSettings();}else if(tab==="infrastructure"||tab==="workspace")void loadHostData();else if(tab==="system"){void loadRuntimes();void loadApplicationUpdate();void loadSetupPreferences();}else if(tab==="characters")void loadCharacterSettings();else if(tab==="defaults"){void loadGlobalModelSettings();void loadDelegationSettings();void loadCreditUsageSettings();void loadClaudeExecutionSettings();void loadAntigravityExecutionSettings();}else if(tab==="display")void loadPathDisplay();}
  function selectDefaultsTab(tab:DefaultsTab){defaultsTab=tab;localStorage.setItem("deck-defaults-settings-tab",tab);}
  function selectDisplayTab(tab:DisplayTab){displayTab=tab;localStorage.setItem("deck-display-settings-tab",tab);}
  function selectStorageTab(tab:StorageTab){storageTab=tab;localStorage.setItem("deck-storage-settings-tab",tab);}
  function selectAccountTab(tab:AccountTab){accountTab=tab;localStorage.setItem("deck-account-settings-tab",tab);}
  function resumeSetup(){if(resumeSetupAfterSettings){resumeSetupAfterSettings=false;setupRequired=true;}}
  async function loadSetupPreferences(){try{const data=await api("/api/system-settings/setup");setupShowOnStartup=data.preferences?.showOnStartup!==false;}catch(value){setupPreferenceNotice=value instanceof Error?value.message:String(value);}}
  async function setSetupStartupVisibility(showOnStartup:boolean){if(setupPreferenceBusy)return;setupShowOnStartup=showOnStartup;setupPreferenceBusy=true;setupPreferenceNotice="";try{const data=await api("/api/system-settings/setup",{method:"PUT",headers:{"Idempotency-Key":uuid()},body:JSON.stringify({version:1,showOnStartup})});setupShowOnStartup=data.preferences.showOnStartup;setupPreferenceNotice=$t(showOnStartup?"setup.autoShowEnabled":"setup.autoShowDisabled");}catch(value){setupShowOnStartup=!showOnStartup;setupPreferenceNotice=value instanceof Error?value.message:String(value);}finally{setupPreferenceBusy=false;}}
  function reopenSetup(){globalOpen=false;resumeSetupAfterSettings=false;setupRequired=true;}
  function dismissSetup(){setupRequired=false;resumeSetupAfterSettings=false;setupShowOnStartup=false;void setSetupStartupVisibility(false);}
  function closeGlobalSettings(){if(globalDirty()){settingsClosePrompt=true;return;}globalOpen=false;resumeSetup();}
  function discardAndCloseGlobalSettings(){restoreGlobalBaseline();settingsClosePrompt=false;globalOpen=false;resumeSetup();}
  async function saveAndCloseGlobalSettings(){if(await saveGlobalSettings()){settingsClosePrompt=false;globalOpen=false;resumeSetup();}}
  function updateCharacter(provider:ProviderId,patch:Partial<CharacterSettings["providers"]["codex"]>){characterSettings={...characterSettings,providers:{...characterSettings.providers,[provider]:{...characterSettings.providers[provider],...patch}}};}
  function updateAvatarDisplay(value:CharacterSettings["avatarDisplay"]){characterSettings={...characterSettings,avatarDisplay:value};avatarDisplayMode.set(value);}
  async function saveGlobalSettings():Promise<boolean>{
    if(globalSaving)return false;
    globalSaveNotice="";
    if(Object.values(characterSettings.providers).some(character=>!character.nickname.trim())){globalSaveNotice=$t("character.nicknameRequired");return false;}
    globalSaving=true;
    // Persist the dedicated global defaults. A stale automation label must
    // never turn a confirmed full-access permission back into workspace mode.
    pushPreferences={...pushPreferences,completed:notifications,vibration};
    try{
      if(!charactersLoaded)await loadCharacterSettings();
      if(!charactersLoaded)throw new Error(globalSaveNotice||$t("character.loadFailed"));
      if(!delegationLoaded)await loadDelegationSettings();
      if(!delegationLoaded)throw new Error(globalSaveNotice||$t("delegation.loadFailed"));
      if(!globalModelsLoaded)await loadGlobalModelSettings();
      if(!globalModelsLoaded)throw new Error(globalSaveNotice||$t("model.globalLoadFailed"));
      if(!creditUsageLoaded)await loadCreditUsageSettings();
      if(!creditUsageLoaded)throw new Error(globalSaveNotice||$t("billing.loadFailed"));
      if(!claudeExecutionLoaded)await loadClaudeExecutionSettings();
      if(!claudeExecutionLoaded)throw new Error(globalSaveNotice||$t("claudeExecution.loadFailed"));
      if(!antigravityExecutionLoaded)await loadAntigravityExecutionSettings();
      if(!antigravityExecutionLoaded)throw new Error(globalSaveNotice||$t("antigravityExecution.loadFailed"));
      syncAllGlobalModelChoices();
      delegationSettings=compatibleDefaultsFromUi(delegationSettings,globalCompatibleModels,globalCompatibleEfforts);
      const data={defaultProvider:globalDefaultProvider,codexModel:globalCodexModel,codexEffort:globalCodexEffort,codexTier:globalCodexTier,codexPermission:permissionForAutomation("codex",globalCodexAutomation),codexWorkMode:globalCodexWorkMode,codexAutomation:globalCodexAutomation,claudeModel:globalClaudeModel,claudeEffort:globalClaudeEffort,claudePermission:permissionForAutomation("claude",globalClaudeAutomation),claudeWorkMode:globalClaudeWorkMode,claudeAutomation:globalClaudeAutomation,...Object.fromEntries(compatibleProviders.flatMap(provider=>[[`${provider}Model`,globalCompatibleModels[provider]],[`${provider}Effort`,globalCompatibleEfforts[provider]],[`${provider}WorkMode`,globalCompatibleWorkModes[provider]],[`${provider}Automation`,globalCompatibleAutomation[provider]],[`${provider}Permission`,permissionForAutomation(provider,globalCompatibleAutomation[provider])]])),codexAvatar,showAvatars,showSpeech,collapseCompleted,notifications,vibration,rememberLast,enterToSend,avatarAutoCollapse,avatarCollapseDelayMs,scrollAutoSwitch,immersiveScroll,hideLocalPaths,allowPaidCredits};
      localStorage.setItem("deck-global-settings",JSON.stringify(data));
      const pendingDelegation=structuredClone(delegationSettings);
      await api("/api/system-settings/antigravity-execution",{method:"PUT",headers:{"Idempotency-Key":uuid()},body:JSON.stringify(antigravityExecution)});
      const modelResult=await api("/api/system-settings/models",{method:"PUT",headers:{"Idempotency-Key":uuid()},body:JSON.stringify({settings:globalModelSettings,compatibleDefaults:compatibleDefaultsPayload(pendingDelegation)})});
      // The model endpoint also returns the delegation value that was stored
      // before this save began. Keep the user's pending selection whenever it
      // is still enabled, or a newly selected Opus can revert to the old model.
      if(modelResult.delegation)delegationSettings=reconcileDelegationAfterModelSave(pendingDelegation,modelResult.delegation,modelResult.settings);
      const writes=[
        {label:$t("settings.notifications"),promise:api("/api/push/preferences",{method:"PUT",headers:{"Idempotency-Key":uuid()},body:JSON.stringify(pushPreferences)})},
        {label:$t("character.settings"),promise:api("/api/system-settings/characters",{method:"PUT",headers:{"Idempotency-Key":uuid()},body:JSON.stringify(characterSettings)})},
        {label:$t("delegation.settings"),promise:api("/api/system-settings/delegation",{method:"PUT",headers:{"Idempotency-Key":uuid()},body:JSON.stringify(delegationSettings)})},
        {label:$t("billing.settings"),promise:api("/api/system-settings/credit-usage",{method:"PUT",headers:{"Idempotency-Key":uuid()},body:JSON.stringify({version:1,allowPaidCredits})})},
        {label:$t("claudeExecution.settings"),promise:api("/api/system-settings/claude-execution",{method:"PUT",headers:{"Idempotency-Key":uuid()},body:JSON.stringify({version:1,switchModelsOnFlag:claudeSwitchModelsOnFlag})})},
        {label:$t("display.pathSettings"),promise:api("/api/system-settings/path-display",{method:"PUT",headers:{"Idempotency-Key":uuid()},body:JSON.stringify({hideLocalPaths})})}
      ];
      const results=await Promise.allSettled(writes.map(item=>item.promise));
      const failures=results.flatMap((result,index)=>result.status==="rejected"?[`${writes[index].label}: ${result.reason instanceof Error?result.reason.message:String(result.reason)}`]:[]);
      if(failures.length)throw new Error(failures.join(" · "));
      // Every settings write above is already durable. Web Push is a browser
      // capability, not a settings store: a permission prompt the user never
      // answers, or an installation without VAPID keys, must not leave the
      // Save button dimmed and the result unreported.
      codexAvatar=characterSettings.providers.codex.avatarOutfit==="Gpt-Sol"?"Gpt-Sol":"Gpt-Codex";
      captureGlobalBaseline();globalSaveNotice=$t("settings.globalSaved");
      // Settings are durable at this point. Release the Save button and any
      // save-and-close flow immediately; browser notification permission is a
      // separate capability that may remain pending while its prompt is open.
      void applyPushPreference(notifications,{enable:enablePush,disable:disablePush}).then(push=>{if(!push.applied)globalSaveNotice=$t("settings.globalSavedPushSkipped");});
      return true;
    }catch(e){globalSaveNotice=e instanceof Error?e.message:String(e);return false;}finally{globalSaving=false;}
  }
  function urlBase64(value:string){const padding="=".repeat((4-value.length%4)%4),base64=(value+padding).replace(/-/g,"+").replace(/_/g,"/");const raw=atob(base64);return Uint8Array.from([...raw].map(char=>char.charCodeAt(0)));}
  async function registerPushSubscription(subscription:PushSubscription){const agentData=(navigator as Navigator&{userAgentData?:{platform?:string}}).userAgentData;await api("/api/push/subscriptions",{method:"POST",headers:{"Idempotency-Key":uuid()},body:JSON.stringify({subscription:subscription.toJSON(),browserLabel:agentData?.platform??navigator.platform??"Browser"})});}
  async function loadPush(){if(!("serviceWorker" in navigator)||!("PushManager" in window)||!("Notification" in window)){pushState="unsupported";return;}try{const config=await api("/api/push");pushPreferences={...pushPreferences,...config.preferences};notifications=pushPreferences.completed;vibration=pushPreferences.vibration;const registration=await navigator.serviceWorker.register("/sw.js",{updateViaCache:"none"});const subscription=await registration.pushManager.getSubscription();if(subscription)await registerPushSubscription(subscription);pushState=subscription?"subscribed":Notification.permission==="default"?"permission-needed":"disabled";}catch{pushState="failed";}}
  async function enablePush(){if(pushState==="unsupported")return;const permission=Notification.permission==="default"?await Notification.requestPermission():Notification.permission;if(permission!=="granted"){pushState="permission-needed";return;}const config=await api("/api/push"),registration=await navigator.serviceWorker.register("/sw.js",{updateViaCache:"none"});let subscription=await registration.pushManager.getSubscription();if(!subscription)subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64(config.publicKey)});await registerPushSubscription(subscription);pushState="subscribed";}
  async function handleCompletionNotificationsChange(event:Event){notifications=(event.currentTarget as HTMLInputElement).checked;if(!notifications)return;try{await enablePush();}catch{pushState="failed";}}
  async function disablePush(){if(!("serviceWorker" in navigator))return;const registration=await navigator.serviceWorker.getRegistration("/sw.js"),subscription=await registration?.pushManager.getSubscription();if(subscription){await api("/api/push/unsubscribe",{method:"POST",headers:{"Idempotency-Key":uuid()},body:JSON.stringify({endpoint:subscription.endpoint})});await subscription.unsubscribe();}pushState="disabled";}
  async function disableAllPush(){if(!confirm($t("notification.disableAllConfirm")))return;await api("/api/push/unsubscribe-all",{method:"POST",headers:{"Idempotency-Key":uuid()},body:JSON.stringify({confirm:true})});const registration=await navigator.serviceWorker.getRegistration("/sw.js"),subscription=await registration?.pushManager.getSubscription();await subscription?.unsubscribe();pushState="disabled";notifications=false;}
  async function sendPresence(){if(document.visibilityState!=="visible"&&pushState!=="subscribed")return;await api("/api/push/presence",{method:"POST",headers:{"Idempotency-Key":uuid()},body:JSON.stringify({browserId,visible:document.visibilityState==="visible"})}).catch(()=>{});}
  function changeCodexAvatar(value:"Gpt-Codex"|"Gpt-Sol"){
    codexAvatar=value;
    try{const saved=JSON.parse(localStorage.getItem("deck-global-settings")||"{}");localStorage.setItem("deck-global-settings",JSON.stringify({...saved,codexAvatar:value}));}catch{}
  }
  function changeAvatarOutfit(provider:ProviderId,outfit:string){
    if(provider==="codex")changeCodexAvatar(outfit==="Gpt-Sol"?"Gpt-Sol":"Gpt-Codex");
    if(!charactersLoaded)return;
    characterSettings={...characterSettings,providers:{...characterSettings.providers,[provider]:{...characterSettings.providers[provider],avatarOutfit:outfit}}};
    try{const baseline=JSON.parse(globalBaseline.characters);baseline.providers[provider].avatarOutfit=outfit;globalBaseline.characters=JSON.stringify(baseline);}catch{}
  }

  function requestCreditConsent(providers:PaidCreditProvider[],reasons:Partial<Record<PaidCreditProvider,"exhausted"|"unknown">>={}){
    return new Promise<CreditConsentChoice>((resolve)=>{
      const unique=[...new Set(providers)];
      if(creditConsentPrompt){creditConsentPrompt={providers:[...new Set([...creditConsentPrompt.providers,...unique])],reasons:{...creditConsentPrompt.reasons,...reasons},waiters:[...creditConsentPrompt.waiters,resolve]};return;}
      creditConsentPrompt={providers:unique,reasons,waiters:[resolve]};
    });
  }
  function settleCreditConsent(choice:CreditConsentChoice){const prompt=creditConsentPrompt;if(!prompt)return;creditConsentPrompt=null;for(const resolve of prompt.waiters)resolve(choice);}
  const creditProviderLabel=(providers:PaidCreditProvider[])=>providers.map(provider=>providerName(provider)).join(" · ");
  async function api(path:string, init:RequestInit={}, options:ApiRequestOptions={}) {
    let nextInit=init;
    for(let attempt=0;attempt<3;attempt++){
      try{return await requestJson(path,nextInit,options);}
      catch(error){
        const details=(error as any)?.details,blocked:PaidCreditProvider[]=Array.isArray(details?.providers)?details.providers.filter((item:unknown):item is PaidCreditProvider=>item==="codex"||item==="claude"||item==="grok"):[];
        const headers=new Headers(nextInit.headers);
        const approved=new Set(String(headers.get("X-Claudex-Workhouse-Paid-Credits")??"").split(",").filter((item):item is PaidCreditProvider=>item==="codex"||item==="claude"||item==="grok")),newlyBlocked=blocked.filter(provider=>!approved.has(provider));
        if((error as any)?.code!=="PAID_CREDITS_CONFIRMATION_REQUIRED"||!newlyBlocked.length)throw error;
        const reasons=details?.creditReasons&&typeof details.creditReasons==="object"?details.creditReasons:{};
        const choice=await requestCreditConsent(newlyBlocked,reasons);
        if(choice==="cancel")throw Object.assign(new Error($t("billing.cancelled")),{code:"PAID_CREDITS_CANCELLED"});
        if(choice==="always"){
          const settings={version:1 as const,allowPaidCredits:true};
          await requestJson("/api/system-settings/credit-usage",{method:"PUT",headers:{"Idempotency-Key":uuid()},body:JSON.stringify(settings)},{caller:"App.paidCreditConsent"});
          allowPaidCredits=true;creditUsageLoaded=true;
        }
        headers.set("X-Claudex-Workhouse-Paid-Credits",[...new Set([...approved,...newlyBlocked])].join(","));
        nextInit={...nextInit,headers};
      }
    }
    throw new Error($t("billing.retryFailed"));
  }
  async function loadProviderAccounts(preserveFeedback=false){
    if(providerAccountsLoading)return;providerAccountsLoading=true;if(!preserveFeedback)providerAuthNotice="";
    try{const data=await api("/api/provider-connections");providerAccounts=data.accounts??[];providerAccountsLoaded=true;const recovered=(data.attempts??[]) as AuthAttempt[];for(const provider of ["codex","claude","grok","antigravity"] as const){const attempt=recovered.find(item=>item.provider===provider),current=authAttempts[provider];if(attempt){applyAuthAttempt(provider,attempt);if(!AUTH_TERMINAL.has(attempt.state)&&(!authStreams[provider]||current?.attemptId!==attempt.attemptId))watchAuthAttempt(provider,attempt);}else if(activeAuthAttempt(provider)){stopAuthStream(provider);const next={...authAttempts};delete next[provider];authAttempts=next;setAuthFeedback(provider,"error",$t("auth.statusDisconnected"));}}}
    catch(e){providerAuthNotice=e instanceof Error?e.message:String(e);}
    finally{providerAccountsLoading=false;syncAuthPolling();}
  }
  async function loadCompatibleProviderSettings(){
    try{const data=await api("/api/system-settings/compatible-providers");if(data?.settings)compatibleProviderSettings=data.settings;}
    catch(e){providerAuthNotice=e instanceof Error?e.message:String(e);}
  }
  function updateCompatibleBaseUrl(provider:"deepseek"|"ollama",baseUrl:string){compatibleProviderSettings={...compatibleProviderSettings,[provider]:{...compatibleProviderSettings[provider],baseUrl}};}
  function updateCompatibleSecret(provider:"deepseek"|"ollama",secret:string){compatibleProviderSecrets={...compatibleProviderSecrets,[provider]:secret};}
  async function saveCompatibleProvider(provider:"deepseek"|"ollama"){
    if(compatibleProviderSaving)return;compatibleProviderSaving=provider;providerAuthNotice="";
    try{
      const current=compatibleProviderSettings[provider],secret=compatibleProviderSecrets[provider].trim(),data=await api(`/api/system-settings/compatible-providers/${provider}`,{method:"PUT",headers:{"Idempotency-Key":uuid()},body:JSON.stringify({baseUrl:current.baseUrl,secret:secret||undefined})});
      compatibleProviderSettings={...compatibleProviderSettings,[provider]:data.settings};compatibleProviderSecrets={...compatibleProviderSecrets,[provider]:""};providerAuthNotice=$t("auth.connectionSaved",{name:provider==="deepseek"?"DeepSeek":"Ollama"});await loadProviderAccounts(true);
    }catch(e){providerAuthNotice=e instanceof Error?e.message:String(e);}
    finally{compatibleProviderSaving=null;}
  }
  function openGlobalSettings(){globalOpen=true;settingsClosePrompt=false;globalSaveNotice="";captureGlobalBaseline();selectGlobalTab(globalTab);}
  function openProviderConnections(){createOpen=false;globalTab="account";openGlobalSettings();}
  function stopAuthStream(provider:ConnectionAuthProvider){authStreams[provider]?.close();delete authStreams[provider];}
  function openAuthWindow(provider:ConnectionAuthProvider){try{const popup=window.open("about:blank",`claudex-workhouse-auth-${provider}`);if(!popup)return;popup.opener=null;popup.document.title=providerName(provider);popup.document.body.textContent=$t("auth.preparingPage");authWindows[provider]=popup;}catch{/* The inline official link remains available when popups are blocked. */}}
  function forwardAuthWindow(provider:ConnectionAuthProvider,url:string|null){const popup=authWindows[provider];if(!url||!popup||popup.closed)return;try{popup.location.replace(url);}catch{try{popup.location.href=url;}catch{}}delete authWindows[provider];}
  function syncAuthPolling(){const needed=(["codex","claude","grok","antigravity"] as const).some(provider=>Boolean(activeAuthAttempt(provider)));if(needed&&!authPollTimer)authPollTimer=setInterval(()=>void pollAuthAttempts(),1500);else if(!needed&&authPollTimer){clearInterval(authPollTimer);authPollTimer=null;}}
  function applyAuthAttempt(provider:ConnectionAuthProvider,attempt:AuthAttempt){const previous=authAttempts[provider],newTerminal=AUTH_TERMINAL.has(attempt.state)&&(!previous||previous.attemptId!==attempt.attemptId||!AUTH_TERMINAL.has(previous.state)),stateChanged=!previous||previous.attemptId!==attempt.attemptId||previous.state!==attempt.state||previous.url!==attempt.url;authAttempts={...authAttempts,[provider]:attempt};forwardAuthWindow(provider,attempt.url);if(stateChanged&&attempt.state==="code_required")setAuthFeedback(provider,"info",$t("auth.codeRequired"));else if(attempt.state==="verifying")setAuthFeedback(provider,"info",$t("auth.verifyingBody"));if(AUTH_TERMINAL.has(attempt.state)){stopAuthStream(provider);authCodes={...authCodes,[provider]:""};if(newTerminal){if(attempt.state==="completed")setAuthFeedback(provider,"success",$t("auth.connectedSuccess",{name:providerName(provider)}));else if(attempt.state==="failed"||attempt.state==="timeout")setAuthFeedback(provider,"error",authErrorLabel(attempt.errorCategory)||$t("auth.error.unknown"));void loadProviderAccounts(true);}}syncAuthPolling();}
  async function pollAuthAttempts(){if(authPollBusy)return;authPollBusy=true;try{const data=await api("/api/provider-connections/attempts"),snapshots=(data.attempts??[]) as AuthAttempt[];for(const provider of ["codex","claude","grok","antigravity"] as const){const current=activeAuthAttempt(provider),snapshot=snapshots.find(item=>item.provider===provider);if(snapshot&&(current?.attemptId===snapshot.attemptId||!authAttempts[provider]||AUTH_TERMINAL.has(authAttempts[provider]!.state)))applyAuthAttempt(provider,snapshot);else if(current&&!snapshot){stopAuthStream(provider);const next={...authAttempts};delete next[provider];authAttempts=next;setAuthFeedback(provider,"error",$t("auth.statusDisconnected"));}}}catch{/* SSE remains the primary path; the next bounded poll retries. */}finally{authPollBusy=false;syncAuthPolling();}}
  function watchAuthAttempt(provider:ConnectionAuthProvider,attempt:AuthAttempt){
    stopAuthStream(provider);const source=new EventSource(`/api/provider-connections/${provider}/attempts/${attempt.attemptId}/events`);authStreams[provider]=source;
    const types=["auth/start","auth/url","auth/code-required","auth/verifying","auth/completed","auth/failed","auth/cancelled","auth/timeout"];
    for(const type of types)source.addEventListener(type,(message)=>{try{const event=JSON.parse((message as MessageEvent).data),previous=authAttempts[provider];if(!previous||event.attemptId!==previous.attemptId)return;applyAuthAttempt(provider,{...previous,state:event.state,url:event.url??previous.url,userCode:event.userCode??previous.userCode,codeRequired:event.type==="auth/code-required"?true:previous.codeRequired,errorCategory:event.errorCategory??previous.errorCategory});}catch{}});
    source.onerror=()=>{const current=authAttempts[provider];if(current&&!["completed","failed","cancelled","timeout"].includes(current.state))setAuthFeedback(provider,"error",$t("auth.statusDisconnected"));};
  }
  async function startProviderLogin(provider:ConnectionAuthProvider,method:"device"|"browser"|"subscription"|"console"|"sso"|"google-oauth"|"google-cloud"){
    if(activeAuthAttempt(provider))return;providerAuthNotice="";setAuthFeedback(provider,"info",$t("auth.startingBody"));openAuthWindow(provider);
    try{const data=await api(`/api/provider-connections/${provider}/login`,{method:"POST",headers:{"Idempotency-Key":uuid()},body:JSON.stringify({method})});applyAuthAttempt(provider,data.attempt);if(provider==="claude"&&data.attempt.state==="waiting"&&!data.attempt.url){const popup=authWindows[provider];if(popup&&!popup.closed)popup.close();delete authWindows[provider];}authCodes={...authCodes,[provider]:""};if(!AUTH_TERMINAL.has(data.attempt.state))watchAuthAttempt(provider,data.attempt);}
    catch(e){const popup=authWindows[provider];if(popup&&!popup.closed)popup.close();delete authWindows[provider];const message=e instanceof Error?e.message:String(e);setAuthFeedback(provider,"error",message);void loadProviderAccounts(true);}
  }
  async function submitAuthCode(provider:"claude"|"antigravity"){
    const attempt=authAttempts[provider],code=authCodes[provider]?.trim()??"";if(!attempt?.inputNonce||!code)return;
    try{setAuthFeedback(provider,"info",$t("auth.verifyingBody"));const data=await api(`/api/provider-connections/${provider}/attempts/${attempt.attemptId}/code`,{method:"POST",headers:{"Idempotency-Key":uuid()},body:JSON.stringify({nonce:attempt.inputNonce,code})});authAttempts={...authAttempts,[provider]:{...data.attempt,inputNonce:undefined}};authCodes={...authCodes,[provider]:""};}
    catch(e){setAuthFeedback(provider,"error",e instanceof Error?e.message:String(e));}
  }
  async function cancelProviderLogin(provider:ConnectionAuthProvider){
    const attempt=activeAuthAttempt(provider);if(!attempt)return;
    try{const data=await api(`/api/provider-connections/${provider}/attempts/${attempt.attemptId}/cancel`,{method:"POST",headers:{"Idempotency-Key":uuid()},body:JSON.stringify({confirm:true})});authAttempts={...authAttempts,[provider]:data.attempt};stopAuthStream(provider);authCodes={...authCodes,[provider]:""};const next={...authFeedback};delete next[provider];authFeedback=next;void loadProviderAccounts(true);}
    catch(e){setAuthFeedback(provider,"error",e instanceof Error?e.message:String(e));}
  }
  async function logoutProvider(provider:ConnectionAuthProvider){
    const name=providerName(provider);if(!confirm($t("auth.logoutConfirm",{name,warning:$t(provider==="codex"?"auth.logoutCodexWarning":provider==="antigravity"?"auth.logoutAntigravityWarning":"auth.logoutClaudeWarning")})))return;providerAuthNotice="";
    try{const data=await api(`/api/provider-connections/${provider}/logout`,{method:"POST",headers:{"Idempotency-Key":uuid()},body:JSON.stringify({confirm:true})});providerAccounts=providerAccounts.map(item=>item.provider===provider?data.account:item);}
    catch(e){providerAuthNotice=e instanceof Error?e.message:String(e);}
  }
  async function loadRuntimes(){try{const data=await api("/api/runtime-updates");runtimes=data.runtimes??[];if(data.autoUpdate)runtimeAutoUpdate=data.autoUpdate;}catch(e){runtimeNotice=e instanceof Error?e.message:String(e)}}
  async function loadApplicationUpdate(){try{applicationUpdate=await api("/api/application-updates");}catch(e){applicationUpdateNotice=e instanceof Error?e.message:String(e)}}
  // "Up to date" and "this install is not updatable at all" are different
  // answers. Branching on updateAvailable alone reported a source checkout,
  // which the updater deliberately never touches, as already current.
  function applicationUpdateNoticeKey(status:any){
    if(status?.updateAvailable)return"applicationUpdate.available";
    if(status?.reason==="source-checkout-not-updatable")return"applicationUpdate.sourceCheckout";
    if(status?.state==="unconfigured")return"applicationUpdate.notUpdatable";
    return"applicationUpdate.current";
  }
  async function checkApplicationUpdate(){if(applicationUpdateBusy)return;applicationUpdateBusy="check";applicationUpdateNotice="";try{applicationUpdate=await api("/api/application-updates/check",{method:"POST",body:"{}"});applicationUpdateNotice=$t(applicationUpdateNoticeKey(applicationUpdate));}catch(e){applicationUpdateNotice=e instanceof Error?e.message:String(e)}finally{applicationUpdateBusy=false;}}
  async function applyApplicationUpdate(){const status=applicationUpdate;if(applicationUpdateBusy||!status?.updateAvailable||!status.target||status.blockers.length)return;if(!confirm($t("applicationUpdate.confirm",{current:status.current.version,target:status.target.version})))return;applicationUpdateBusy="apply";applicationUpdateNotice=$t("applicationUpdate.applying");try{const data=await api("/api/application-updates/apply",{method:"POST",headers:{"Idempotency-Key":uuid()},body:JSON.stringify({targetVersion:status.target.version,manifestSha256:status.target.manifestSha256,confirm:true})});applicationUpdate=data.status;applicationUpdateNotice=$t("applicationUpdate.restart");}catch(e){applicationUpdateNotice=e instanceof Error?e.message:String(e)}finally{applicationUpdateBusy=false;}}
  async function loadSystemDiagnostic(){diagnosticBusy=true;try{systemDiagnostic=(await api("/api/system/diagnostics")).report;}catch(e){runtimeNotice=e instanceof Error?e.message:String(e)}finally{diagnosticBusy=false;}}
  async function copySystemDiagnostic(){if(systemDiagnostic)await navigator.clipboard.writeText(JSON.stringify(systemDiagnostic,null,2));}
  async function checkUpdates(){if(runtimeBusy)return;runtimeBusy="check";runtimeNotice="";try{const data=await api("/api/runtime-updates/check",{method:"POST",body:"{}"});runtimes=data.runtimes??[];if(data.autoUpdate)runtimeAutoUpdate=data.autoUpdate;runtimeNotice=$t(runtimes.some(item=>item.updateAvailable)?"runtime.updateAvailable":"runtime.upToDate");}catch(e){runtimeNotice=e instanceof Error?e.message:String(e)}finally{runtimeBusy=null;}}
  async function updateRuntime(provider:"codex"|"claude"){
    const item=runtimeFor(provider);if(runtimeBusy||!item?.canUpdate||!item.updateAvailable)return;
    if(!confirm($t("runtime.updateConfirm",{name:item.name,current:item.current??$t("runtime.currentVersion"),latest:item.latest??$t("runtime.latestVersion")})))return;
    runtimeBusy=provider;runtimeNotice=$t("runtime.updating",{name:item.name});
    try{const data=await api(`/api/runtime-updates/${provider}`,{method:"POST",body:JSON.stringify({confirm:true})});runtimes=data.runtimes??[];if(data.autoUpdate)runtimeAutoUpdate=data.autoUpdate;runtimeNotice=$t("runtime.updated",{name:item.name});}
    catch(e){runtimeNotice=e instanceof Error?e.message:String(e)}finally{runtimeBusy=null;}
  }
  async function toggleRuntimeAutoUpdate(provider:"codex"|"claude",enabled:boolean){
    if(runtimeSettingsBusy)return;runtimeSettingsBusy=provider;runtimeNotice="";const previous=runtimeAutoUpdate;runtimeAutoUpdate={...previous,providers:{...previous.providers,[provider]:enabled}};
    try{const data=await api("/api/runtime-updates/settings",{method:"PUT",headers:{"Idempotency-Key":uuid()},body:JSON.stringify(runtimeAutoUpdate)});runtimeAutoUpdate=data.autoUpdate;runtimeNotice=$t(enabled?"runtime.autoUpdateEnabled":"runtime.autoUpdateDisabled",{name:providerName(provider)});}
    catch(e){runtimeAutoUpdate=previous;runtimeNotice=e instanceof Error?e.message:String(e);}finally{runtimeSettingsBusy=null;}
  }
  function enqueueAvatarNotice(provider:ProviderId,notice:RuntimeAvatarNotice){
    if(runtimeAvatarNotices[provider]?.key===notice.key||runtimeNoticeQueues[provider]?.some(item=>item.key===notice.key))return;
    if(!runtimeAvatarNotices[provider])runtimeAvatarNotices={...runtimeAvatarNotices,[provider]:notice};
    else runtimeNoticeQueues={...runtimeNoticeQueues,[provider]:[...(runtimeNoticeQueues[provider]??[]),notice].slice(-4)};
    if(!globalOpen&&!quotaOpen&&!createOpen)scheduleRuntimeNoticeClear(provider);
  }
  function scheduleRuntimeNoticeClear(provider:ProviderId){
    if(runtimeNoticeTimers[provider]||!runtimeAvatarNotices[provider])return;
    runtimeNoticeTimers[provider]=setTimeout(()=>{const queue=[...(runtimeNoticeQueues[provider]??[])],visible=queue.shift(),next={...runtimeAvatarNotices},queues={...runtimeNoticeQueues};if(visible)next[provider]=visible;else delete next[provider];if(queue.length)queues[provider]=queue;else delete queues[provider];runtimeAvatarNotices=next;runtimeNoticeQueues=queues;delete runtimeNoticeTimers[provider];if(visible&&!globalOpen&&!quotaOpen&&!createOpen)scheduleRuntimeNoticeClear(provider);},Math.max(7000,avatarCollapseDelayMs+1500));
  }
  $: if(!globalOpen&&!quotaOpen&&!createOpen){for(const provider of conversationProviders)if(runtimeAvatarNotices[provider])scheduleRuntimeNoticeClear(provider);}
  function startRuntimeUpdateEvents(){
    runtimeUpdateSource?.close();const source=new EventSource("/api/runtime-updates/events");runtimeUpdateSource=source;
    source.addEventListener("runtime-update",message=>{try{const event=JSON.parse((message as MessageEvent).data),provider=event.provider as ProviderId;if(!conversationProviders.includes(provider))return;const name=event.name??providerDisplayName(provider),version=event.latest??event.current??$t("common.unavailable"),type=String(event.type);enqueueAvatarNotice(provider,{key:`runtime:${event.sequence}:${type}`,emotion:type==="auto_update_completed"?"happy":type==="auto_update_failed"?"sad":"confused",line:$t(type==="auto_update_completed"?"runtime.toastCompleted":type==="auto_update_failed"?"runtime.toastFailed":"runtime.toastAvailable",{name}),statusLine:$t(type==="auto_update_completed"?"runtime.toastCompletedDetail":type==="auto_update_failed"?"runtime.toastFailedDetail":"runtime.toastAvailableDetail",{version})});if(type==="auto_update_completed")void loadRuntimes();}catch{}});
  }
  function startModelCatalogEvents(){modelCatalogSource?.close();const source=new EventSource("/api/model-catalog/events");modelCatalogSource=source;source.addEventListener("model-catalog",message=>{try{const event=JSON.parse((message as MessageEvent).data),provider=event.provider as ProviderId;if(!conversationProviders.includes(provider)||event.type!=="models_discovered")return;const first=event.models?.[0]?.displayName??event.models?.[0]?.id??"",count=Number(event.count)||1;enqueueAvatarNotice(provider,{key:`models:${event.sequence}:${provider}`,emotion:"happy",line:$t(count===1?"model.discoveredOne":"model.discoveredMany",{provider:providerDisplayName(provider),model:first,count}),statusLine:$t("model.discoveredAction"),action:{type:"open-provider-models",provider}});}catch{}});}
  function handleAvatarNoticeAction(action:AvatarNoticeAction){if(action.type!=="open-provider-models")return;globalTab="defaults";selectDefaultsTab(action.provider);openGlobalSettings();}
  let refreshRunning=false;
  let refreshQueued=false;
  let taskSynchronizationStartedAt=0;
  let taskSynchronizationRunning=false;
  function scheduleTaskSynchronization(){
    if(taskSynchronizationRunning||Date.now()-taskSynchronizationStartedAt<30000)return;
    taskSynchronizationRunning=true;
    taskSynchronizationStartedAt=Date.now();
    void api("/api/tasks",{}, {caller:"App.backgroundTaskSynchronization"})
      .then(()=>{void refresh(true);})
      .catch(()=>{})
      .finally(()=>{taskSynchronizationRunning=false;taskSynchronizationStartedAt=Date.now();});
  }
  const taskRefresh=createProviderRefreshCoordinator();
  const taskSnapshotRevisions:Record<"all"|ProviderId,number|null>={all:null,codex:null,claude:null,grok:null,antigravity:null,deepseek:null,ollama:null};
  const avatarRefreshRunning:Record<ProviderId,boolean>={codex:false,claude:false,grok:false,antigravity:false,deepseek:false,ollama:false};
  async function refreshTaskSnapshot(caller:string){
    const refreshProviders:ProviderId[]=["codex","claude","grok","antigravity","deepseek","ollama"],taskGeneration=taskRefresh.reserve(refreshProviders);
    const params=new URLSearchParams({snapshot:"true"});
    if(taskSnapshotRevisions.all!==null)params.set("revision",String(taskSnapshotRevisions.all));
    const data=await api(`/api/tasks?${params}`,{}, {caller});
    if(Number.isInteger(data.revision))taskSnapshotRevisions.all=data.revision;
    if(data.unchanged)return;
    if(data.delta&&Array.isArray(data.mutations)){for(const provider of refreshProviders){const mutations=data.mutations.filter((mutation:any)=>(mutation.kind==="upsert"?mutation.task?.provider:mutation.provider)===provider);if(!mutations.length)continue;taskRefresh.apply(provider,taskGeneration[provider],()=>{for(const mutation of mutations)if(mutation.kind==="upsert"&&mutation.task)taskState.upsert(mutation.task);else if(mutation.kind==="delete-task")taskState.remove(mutation.taskId);else if(mutation.kind==="delete-session")taskState.removeSession(mutation.provider,mutation.threadId);});}return;}
    const rows=Array.isArray(data.tasks)?data.tasks:[],partial=data.partial===true;
    for(const provider of refreshProviders){const incoming=rows.filter((item:Task)=>item.provider===provider),current=tasks.filter(item=>item.provider===provider);if(!shouldApplyProviderSnapshot(partial,incoming.length,current.length))continue;taskRefresh.apply(provider,taskGeneration[provider],()=>taskState.replaceProvider(provider,incoming));}
  }
  async function refresh(silent=false) {
    if(refreshRunning){if(!silent)refreshQueued=true;return;}
    refreshRunning=true;
    if(!silent) loading=true;
    try {
      const regionFailures:LoaderFailure[]=[];
      const region=<T>(label:string,promise:Promise<T>,apply:(value:T)=>void)=>applyIndependentRegion(label,promise,apply,regionFailures);
      const codexRefresh=engine==="codex"&&codexRef
        ? region("codex sessions",codexRef.refreshSessions(),()=>{})
        : Promise.resolve();
      if(silent){
        await Promise.allSettled([
          codexRefresh,
          region("tasks",refreshTaskSnapshot("App.refresh.tasks"),()=>{}),
          region("collaborations",api("/api/collaborations",{}, {caller:"App.refresh.collaborations"}),collaborationData=>collaborations=collaborationData.collaborations??collaborations),
          region("conversation documents",api("/api/conversation-documents",{}, {caller:"App.refresh.conversationDocuments"}),documentData=>conversationDocuments=documentData.documents??conversationDocuments),
          region("quota reservations",loadQuotaReservations(),()=>{}),
          region("workspaces",loadWorkspaceCatalog(),workspaceData=>applyWorkspaceCatalog(workspaceData))
        ]);
      }else{
        await Promise.allSettled([
          codexRefresh,
          region("tasks",refreshTaskSnapshot("App.initialLoad.tasks"),()=>{}),
          region("projects",api("/api/projects",{}, {caller:"App.initialLoad.projects"}),projectData=>{projects=projectData.projects;if(!projects.some(item=>item.id===createProject&&item.enabled))createProject=projects.find(item=>item.enabled)?.id??"";}),
          region("codex catalog",api("/api/providers/codex/models",{}, {caller:"App.initialLoad.codexCatalog"}),catalogData=>{catalog=catalogData.catalog??catalog;syncCodexOptions();}),
          region("hosts",api("/api/hosts",{}, {caller:"App.initialLoad.hosts"}),hostData=>hosts=hostData.hosts??hosts),
          region("workspaces",loadWorkspaceCatalog(),workspaceData=>applyWorkspaceCatalog(workspaceData)),
          region("collaborations",api("/api/collaborations",{}, {caller:"App.initialLoad.collaborations"}),collaborationData=>collaborations=collaborationData.collaborations??collaborations),
          region("conversation documents",api("/api/conversation-documents",{}, {caller:"App.initialLoad.conversationDocuments"}),documentData=>conversationDocuments=documentData.documents??conversationDocuments),
          region("quota reservations",loadQuotaReservations(),()=>{})
        ]);
        syncCreateWorkspace();
      }
      if(selected) {
        const previous=selected;
        const refreshed=tasks.find((item)=>item.id===previous.id);
        const latest=previous.provider==="claude"?latestThreadMember(tasks,previous):refreshed??previous;
        if(latest.id!==previous.id){
          flushLive();stopLive();discardLive();selected={...latest,metadata:{...previous.metadata,...latest.metadata}};lastLiveSequence=0;liveIds.clear();await loadThreadEvents(selected,true,true);startLive();
        }else if(refreshed)applySelectedSnapshot(refreshed);
        // Only re-pull the transcript while the session is still catching up
        // (delayed SSE) or empty. A completed session we're already viewing
        // has its full transcript from the live stream — re-fetching + merging
        // every 4s froze the view right after completion.
        if(liveStatus!=="Live" && (active.has(selected.status) || !events.length))await loadThreadEvents(selected,true,true);
      }
      scheduleTaskSynchronization();
      error=summarizeLoaderFailures(regionFailures);
    } catch(e) { error=e instanceof Error?e.message:String(e); }
    finally { loading=false;refreshRunning=false;if(refreshQueued){refreshQueued=false;void refresh(true);} }
  }
  async function refreshAvatarSessions(provider:ProviderId){
    if(avatarRefreshRunning[provider])return;
    avatarRefreshRunning[provider]=true;avatarSessionsLoading={...avatarSessionsLoading,[provider]:true};avatarSessionsError={...avatarSessionsError,[provider]:false};
    const generation=taskRefresh.reserve([provider])[provider],params=new URLSearchParams({provider,snapshot:"true"});
    if(taskSnapshotRevisions[provider]!==null)params.set("revision",String(taskSnapshotRevisions[provider]));
    try{
      const data=await api(`/api/tasks?${params}`);if(Number.isInteger(data.revision))taskSnapshotRevisions[provider]=data.revision;if(data.unchanged)return;if(data.delta&&Array.isArray(data.mutations)){taskRefresh.apply(provider,generation,()=>{for(const mutation of data.mutations)if(mutation.kind==="upsert"&&mutation.task?.provider===provider)taskState.upsert(mutation.task);else if(mutation.provider===provider&&mutation.kind==="delete-task")taskState.remove(mutation.taskId);else if(mutation.provider===provider&&mutation.kind==="delete-session")taskState.removeSession(provider,mutation.threadId);});return;}const rows=(Array.isArray(data.tasks)?data.tasks:[]).filter((item:Task)=>item.provider===provider);
      // A partial empty response means provider synchronization failed. Keep
      // the last good rows visible and retry while the avatar panel is open.
      if(data.partial&&rows.length===0){avatarSessionsError={...avatarSessionsError,[provider]:true};return;}
      taskRefresh.apply(provider,generation,()=>taskState.replaceProvider(provider,rows));
    }catch{avatarSessionsError={...avatarSessionsError,[provider]:true};/* Keep the last good provider snapshot; opening/polling retries. */}
    finally{avatarRefreshRunning[provider]=false;avatarSessionsLoading={...avatarSessionsLoading,[provider]:false};}
  }
  function avatarPanelOpen(provider:ProviderId|null){quotaOpen=false;avatarOpenProvider=provider;if(provider)void refreshAvatarSessions(provider);}
  function refreshVisibleTaskLists(){if(avatarOpenProvider)void refreshAvatarSessions(avatarOpenProvider);else void refresh(true).then(()=>void openInitialDeepLink());}
  async function loadEvents(task:Task,silent=false,preserveLive=false) {
    try {
      const transcriptQuery=task.provider==="claude"?`?transcriptTurns=${transcriptTurns}`:"";
      const data=await api(`/api/tasks/${task.provider}/${encodeURIComponent(task.id)}/events${transcriptQuery}`);
      if(selected?.id===task.id){
        const snapshot=Array.isArray(data.events)?data.events:[];
        const live=preserveLive?liveRowsForTask(events,task.id):[];
        if(canApplyLiveSnapshot(lastLiveSequence,data.latestSequence))events=live.length?mergeTerminalSnapshot(snapshot,live):snapshot;
        else if(preserveLive&&snapshot.length)events=mergeTerminalSnapshot(snapshot,live);
        lastLiveSequence=Math.max(lastLiveSequence,liveSnapshotSequence(data.latestSequence));
        transcriptTruncated=task.provider==="claude"&&data.truncated?.before?data.truncated:null;
      }
      if(selected?.id===task.id&&canApplySnapshotStatus(selected.status,data.status)&&selected.status!==data.status)applySelectedSnapshot({...selected,status:data.status},false);
      return true;
    } catch(e) { if(!silent) error=e instanceof Error?e.message:String(e);return false; }
  }
  // Both providers serve a thread-wide snapshot from the latest task endpoint.
  // Never fan out over historical Claude task rows: long sessions can have
  // dozens of turns and a single refresh would exhaust the global rate limit.
  async function loadThreadEvents(task:Task,silent=false,preserveLive=false){
    return loadEvents(task,silent,preserveLive);
  }
  async function loadEarlierTranscript(){
    const task=selected;if(!task||task.provider!=="claude"||transcriptTurns>=24||transcriptHistoryLoading)return;
    const previous=transcriptTurns;transcriptTurns=24;transcriptHistoryLoading=true;
    const loaded=await loadThreadEvents(task,false,true);
    if(!loaded&&selected?.id===task.id)transcriptTurns=previous;
    if(selected?.id===task.id)transcriptHistoryLoading=false;
  }
  function flushLive(){if(deltaTimer)clearTimeout(deltaTimer);deltaTimer=null;if(deltaQueue.length)events=mergeLiveEvents(events,deltaQueue);deltaQueue=[];}
  function discardLive(){if(deltaTimer)clearTimeout(deltaTimer);deltaTimer=null;deltaQueue=[];}
  function scheduleTerminalDrainStop(taskId:string){
    if(terminalDrainTimer)clearTimeout(terminalDrainTimer);
    terminalDrainTimer=setTimeout(()=>{terminalDrainTimer=null;if(selected?.id===taskId&&terminal.has(selected.status)){liveStatus="History";stopLive();}},1500);
  }
  function applySelectedSnapshot(next:Task,reloadTerminalEvents=true,terminalFromLive=false){
    if(!selected||selected.id!==next.id)return;
    const wasActive=active.has(selected.status);selected={...selected,...next};taskState.upsert(selected);
    if(!terminal.has(next.status))return;
    flushLive();liveStatus="History";
    // A terminal task snapshot can beat the SSE connection by a fraction of a
    // second. Keep that stream alive briefly so live-only commentary and hooks
    // can drain before the terminal history snapshot replaces the view.
    if(terminalFromLive)stopLive();else scheduleTerminalDrainStop(next.id);
    if(wasActive){if(vibration&&navigator.vibrate)navigator.vibrate(next.status==="completed"?[80]:[100,80,100]);if(notifications&&"Notification" in window&&Notification.permission==="granted"&&document.visibilityState!=="visible")new Notification(selected.title,{body:$t(next.status==="completed"?"notification.taskCompleted":"notification.checkTask")});}
    if(reloadTerminalEvents)void loadThreadEvents(selected,true,true);
  }
  async function reconcileSelectedStatus(){
    const current=selected;if(!current?.owned||!active.has(current.status))return;
    try{const data=await api(`/api/tasks/${current.provider}/${encodeURIComponent(current.id)}`);if(selected?.id===current.id&&data?.task)applySelectedSnapshot(data.task);}catch{}
  }
  function receiveLive(event:AgentEvent){if(event.eventId&&liveIds.has(event.eventId))return;if(event.eventId){liveIds.add(event.eventId);if(liveIds.size>2000)liveIds.delete(liveIds.values().next().value!);}lastLiveSequence=Math.max(lastLiveSequence,event.sequence??0);deltaQueue.push(event);if(!deltaTimer)deltaTimer=setTimeout(flushLive,100);if(event.terminal&&selected){const status=event.type==="task_completed"?"completed":event.type==="task_stopped"?"stopped":"failed";applySelectedSnapshot({...selected,status,updatedAt:new Date().toISOString()},true,true);}}
  function stopLive(){if(terminalDrainTimer){clearTimeout(terminalDrainTimer);terminalDrainTimer=null;}liveScope++;liveUnsubscribe?.();liveUnsubscribe=null;}
  function startLive(){stopLive();if(!selected?.owned){liveStatus="History";return;}if(!active.has(selected.status)||document.visibilityState!=="visible"){liveStatus=active.has(selected.status)?"Delayed":"History";return;}liveStatus="Delayed";const taskId=selected.id,provider=selected.provider,scope=liveScope,current=()=>liveScope===scope&&selected?.id===taskId;liveUnsubscribe=subscribeTaskLiveness({provider,taskId,after:lastLiveSequence,onChange:()=>{},onStatus:(status)=>{if(current())liveStatus=status==="live"?"Live":"Delayed";},onEvent:(event)=>{if(current())receiveLive(event);},onResync:()=>{if(!current())return;liveStatus="Delayed";if(selected)void loadThreadEvents(selected,true,true);void reconcileSelectedStatus();}});}
  async function openTask(task:Task,exact=false) {
    collaborationBoardOpen=false;
    if(task.provider==="codex"&&task.threadId&&(!task.executionHostId||task.executionHostId==="local")){stopLive();discardLive();selected=null;events=[];engine="codex";await tick();await codexRef?.openTaskSession(task);return;}
    codexRef?.closeDetail();codexDetailOpen=false;stopLive();discardLive();engine=task.provider;let latest=exact?task:latestThreadMember(tasks,task);if(latest.listProjection)try{const data=await api(`/api/tasks/${latest.provider}/${encodeURIComponent(latest.id)}/snapshot`,{}, {caller:"App.openTask.snapshot"});if(data?.task){latest=data.task;taskState.upsert(latest);}}catch(value){error=value instanceof Error?value.message:String(value);return;}selected=latest;events=[];lastLiveSequence=0;liveIds.clear();startLive();await loadThreadEvents(latest,true,true);
  }
  async function openHistoryResult(result:any){
    searchOpen=false;updateSearchQuery("");
    if(result.taskId){
      try{
        const data=await api(`/api/tasks/${result.provider}/${encodeURIComponent(result.taskId)}/snapshot`,{}, {caller:"App.historySearch.snapshot"});
        if(data?.task){
          taskState.upsert(data.task);await openTask(data.task,true);await tick();
          const selector=result.matchField==="prompt"?".bubble.user":result.matchField==="error"?".bubble.error":".bubble.agent",needle=String(result.match??"").trim();
          const card=[...document.querySelectorAll<HTMLElement>(selector)].find(item=>needle&&item.textContent?.includes(needle))
            ??document.querySelector<HTMLElement>(result.matchField==="result"||result.matchField==="error"?".task-outcome":".conversation");
          card?.classList.add("history-search-target");card?.scrollIntoView({block:"center"});
          setTimeout(()=>card?.classList.remove("history-search-target"),1800);
          return;
        }
      }catch(value){error=value instanceof Error?value.message:String(value);return;}
    }
    if(result.provider==="codex"&&result.threadId){engine="codex";codexMounted=true;await tick();await codexRef?.openSearchResult(result);}
  }
  function relatedWorkspaceSessions(workspaceId:string){const byThread=new Map<string,Task>();for(const task of tasks.filter(item=>item.workspaceId===workspaceId)){const key=task.threadId?`${task.provider}:${task.threadId}`:task.id,current=byThread.get(key);if(!current||task.updatedAt>current.updatedAt)byThread.set(key,task);}return[...byThread.values()].sort((left,right)=>right.updatedAt.localeCompare(left.updatedAt)).slice(0,30);}
  function openWorkspaceFiles(workspace:Workspace,initialFile?:WorkspaceViewerContext["initialFile"],sourceTaskId?:string|null,initialEdit=false){workspaceViewerLayout={layout:"window",reversed:false};workspaceViewer={workspace,initialFile,sourceTaskId,initialEdit};}
  async function openConversationFile(file:{path:string;pathBase:"workspace"|"task-cwd";sourceTaskId?:string;workspaceId?:string;line?:number;initialEdit?:boolean}){
    const workspaceId=file.workspaceId??selected?.workspaceId,sourceTaskId=file.sourceTaskId??selected?.id;
    if(!workspaceId)return;
    try{
      const resolved=await resolveViewerWorkspace(workspaceId,workspaces,loadWorkspaceCatalog);
      if(resolved.reloaded)applyWorkspaceCatalog(resolved.catalog);
      if(!resolved.workspace){error=$t("workspace.notFound");return;}
      error="";
      openWorkspaceFiles(resolved.workspace,{path:file.path,pathBase:file.pathBase,...(sourceTaskId?{sourceTaskId}:{}),...(file.line?{line:file.line}:{})},sourceTaskId??null,file.initialEdit??true);
    }catch(value){error=value instanceof Error?value.message:String(value);}
  }
  function openViewerSession(reference:{id:string}){const task=tasks.find(item=>item.id===reference.id);if(task)void openTask(task);else error=$t("session.notFoundInTasks",{provider:"Agent"});}
  let deepLinkOpening=false;
  async function openInitialDeepLink(){
    if(deepLinkOpening)return false;
    if(await openSharedTask())return true;
    if(await openVscodeContext())return true;
    const params=new URLSearchParams(location.search),fileTarget=workspaceViewTarget(location.href);
    const newRequestTarget=parseNewRequestTarget(location.search);
    if(newRequestTarget){
      const requestedProvider=newRequestTarget.provider,requestedHost=newRequestTarget.hostId,requestedWorkspace=newRequestTarget.workspaceId;
      await openCreate();
      createKind="single";
      if(requestedProvider==="codex"||requestedProvider==="claude")createProvider=fallbackProvider(requestedProvider,providerConnections);
      if(requestedHost&&hosts.some(item=>item.id===requestedHost&&["online","connecting"].includes(item.status)))createHost=requestedHost;
      const linkedWorkspace=requestedWorkspace?workspaces.find(item=>item.id===requestedWorkspace&&item.hostId===createHost):null;
      if(linkedWorkspace){createProject=linkedWorkspace.projectId;createWorkspace=linkedWorkspace.id;}
      else syncCreateWorkspace();
      history.replaceState(null,"",location.pathname);
      return true;
    }
    if(fileTarget){
      deepLinkOpening=true;
      try{
        const resolved=await resolveViewerWorkspace(fileTarget.workspaceId,workspaces,loadWorkspaceCatalog);
        if(resolved.reloaded)applyWorkspaceCatalog(resolved.catalog);
        if(!resolved.workspace){error=$t("workspace.notFound");return false;}
        openWorkspaceFiles(resolved.workspace,{path:fileTarget.path,pathBase:"workspace",...(fileTarget.line?{line:fileTarget.line}:{})},null,false);
        error="";
        history.replaceState(null,"",location.pathname);
        return true;
      }catch(value){
        error=value instanceof Error?value.message:String(value);
        return false;
      }finally{deepLinkOpening=false;}
    }
    const taskId=params.get("task");
    if(taskId){
      deepLinkOpening=true;
      try{
        let task=tasks.find(item=>item.id===taskId);
        const requestedProvider=params.get("provider");
        if(!task&&(requestedProvider==="codex"||requestedProvider==="claude")){
          const data=await api(`/api/tasks/${requestedProvider}/${encodeURIComponent(taskId)}/snapshot`,{}, {caller:"App.deepLink.snapshot"});
          if(data?.task){
            task=data.task;
            taskState.upsert(task!);
          }
        }
        if(!task)return false;
        await openTask(task);
        error="";
        history.replaceState(null,"",location.pathname);
        return true;
      }catch(value){
        error=value instanceof Error?value.message:String(value);
        return false;
      }finally{deepLinkOpening=false;}
    }
    const reservationId=params.get("reservation");
    if(params.get("view")==="reservation"&&reservationId){
      if(!quotaReservations.some(item=>item.id===reservationId))await loadQuotaReservations();
      if(!quotaReservations.some(item=>item.id===reservationId))return false;
      selected=null;selectedCollaboration=null;reservationFocusId=reservationId;
      history.replaceState(null,"",location.pathname);
      setTimeout(()=>document.getElementById(`quota-reservation-${reservationId}`)?.scrollIntoView({behavior:"smooth",block:"center"}),0);
      return true;
    }
    if(params.get("view")==="host"){
      globalTab="infrastructure";
      openGlobalSettings();
      history.replaceState(null,"",location.pathname);
      return true;
    }
    return false;
  }
  async function openChainSession(sessionId:string){const task=tasks.filter(item=>item.id===sessionId||item.threadId===sessionId).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0];if(task){chainOpen=false;await openTask(task);}}
  async function openRecentSession(session:AgentRecentSession){
    const task=taskForRecentSession(tasks,session);if(task)await openTask(task);else error=$t("session.notFoundInTasks",{provider:providerDisplayName(session.provider)});
  }
  function updateAvatarTaskStatus(provider:ProviderId,taskId:string,status:"completed"|"failed"|"stopped"){
    taskState.patchStatus(provider,taskId,status);
  }
  function currentCreatePayload(){
    const workMode=createWorkModeFor(createProvider);
    const automationLevel=createAutomationFor(createProvider);
    const compatibleModel=createProvider==="deepseek"||createProvider==="ollama"||createProvider==="antigravity"?compatibleCreateModel():null;
    return{provider:createProvider,projectId:createProject,executionHostId:createHost,workspaceId:createWorkspace||undefined,prompt:withAttachments(createPrompt,createAttachments),workMode,automationLevel,...(createProvider==="antigravity"?{googleSearchMode:createGoogleSearchMode}:{}),...(createProvider==="codex"?{model:createModel,reasoningEffort:createEffort,serviceTier:createTier,permissionProfile:createPermission,dangerConfirmation:dangerConfirmed,fullAccessAcknowledged:dangerConfirmed,acknowledgementVersion:dangerConfirmed?1:undefined}:{permissionProfile:createPermissionFor(createProvider),model:createProvider==="claude"?(createClaudeModel==="default"?null:createClaudeModel):compatibleModel,reasoningEffort:createProvider==="claude"?(createClaudeEffort==="default"?null:createClaudeEffort):(createCompatibleEfforts[createProvider as CompatibleExecutionProvider]==="default"?null:createCompatibleEfforts[createProvider as CompatibleExecutionProvider]),dangerConfirmation:dangerConfirmed,fullAccessAcknowledged:dangerConfirmed,acknowledgementVersion:dangerConfirmed?1:undefined})};
  }
  function finishCreateForm(){createOpen=false;createPrompt="";createAttachments=[];vscodeContext=null;}
  // Recomputed from raw state rather than the reactive snapshot so a keyboard or
  // programmatic caller cannot slip through on a stale derivation.
  function liveProviderAvailability(){return providerAvailability<ProviderId>(conversationProviders,providerAccounts,providerAccountsLoaded);}
  function reviewParticipantsFor(availability:ProviderAvailability<ProviderId>):ProviderId[]{
    const pool=participantList(conversationProviders,reviewEnabled,availability);
    return[createProvider,...pool.filter(provider=>provider!==createProvider)].filter(provider=>pool.includes(provider));
  }
  function conversationParticipantsFor(availability:ProviderAvailability<ProviderId>):ProviderId[]{
    const pool=participantList(conversationProviders,conversationEnabled,availability);
    return[conversationFirstProvider,...pool.filter(provider=>provider!==conversationFirstProvider)].filter(provider=>pool.includes(provider));
  }
  function createSelectionFor(availability:ProviderAvailability<ProviderId>){
    return{
      kind:createKind,
      provider:createKind==="conversation"?conversationFirstProvider:createProvider,
      participants:createKind==="single"?[createProvider]:createKind==="conversation"?conversationParticipantsFor(availability):reviewParticipantsFor(availability)
    };
  }
  // The invariant enforced immediately before any create request leaves the app.
  function blockCreateOnConnection(availability:ProviderAvailability<ProviderId>=liveProviderAvailability()){
    const reason=creationBlockReason(createSelectionFor(availability),availability);
    if(!reason)return false;
    createError=$t(reason==="connections-loading"?"provider.connectionChecking":reason==="needs-two-participants"?"review.needsTwoConnected":"provider.noneConnectedBody");
    return true;
  }
  async function reserveTask(){
    if(createKind!=="single"||!createPrompt.trim()||!createWorkspace||createOpening||sending||createConnectionBlocked)return;
    if(blockCreateOnConnection())return;
    sending=true;createError="";
    try{
      const data=await api("/api/quota-reservations",{method:"POST",headers:{"Idempotency-Key":uuid()},body:JSON.stringify(currentCreatePayload())});
      quotaReservations=[data.reservation,...quotaReservations.filter(item=>item.id!==data.reservation.id)];
      quota=data.quota?{...quota,[createProvider]:data.quota}:quota;
      finishCreateForm();
    }catch(e){createError=e instanceof Error?e.message:String(e);}finally{sending=false;}
  }
  async function cancelQuotaReservation(item:QuotaReservation){
    if(reservationBusy)return;reservationBusy=item.id;
    try{const data=await api(`/api/quota-reservations/${item.id}/cancel`,{method:"POST",headers:{"Idempotency-Key":uuid()},body:JSON.stringify({confirm:true})});quotaReservations=quotaReservations.map(row=>row.id===item.id?data.reservation:row);}
    catch(e){error=e instanceof Error?e.message:String(e);}finally{reservationBusy=null;}
  }
  async function startQuotaReservationNow(item:QuotaReservation){
    if(reservationBusy||!confirm($t("quotaReservation.startNowConfirm")))return;reservationBusy=item.id;
    try{const data=await api(`/api/quota-reservations/${item.id}/start-now`,{method:"POST",headers:{"Idempotency-Key":uuid()},body:JSON.stringify({confirm:true})});quotaReservations=quotaReservations.map(row=>row.id===item.id?data.reservation:row);if(data.task){taskState.upsert(data.task);await openTask(data.task);}}
    catch(e){error=e instanceof Error?e.message:String(e);}finally{reservationBusy=null;}
  }
  async function retryQuotaReservation(item:QuotaReservation){
    if(reservationBusy)return;reservationBusy=item.id;
    try{const data=await api(`/api/quota-reservations/${item.id}/retry`,{method:"POST",headers:{"Idempotency-Key":uuid()},body:JSON.stringify({confirm:true})});quotaReservations=quotaReservations.map(row=>row.id===item.id?data.reservation:row);}
    catch(e){error=e instanceof Error?e.message:String(e);}finally{reservationBusy=null;}
  }
  async function createTask() {
    if(!createPrompt.trim()||!createWorkspace||createOpening||sending||createConnectionBlocked)return;
    if(createKind!=="single")return createCollaboration();
    if(blockCreateOnConnection())return;
    sending=true;createError="";
    try {
      const payload=currentCreatePayload();
      const automationLevel=createAutomationFor(createProvider);
      const submit=()=>api("/api/tasks",{method:"POST",headers:{"Idempotency-Key":uuid()},body:JSON.stringify(payload)});
      let data:any;
      try{data=await submit();}
      catch(cause){
        const recoverable=(cause as any)?.code==="AUTOMATIC_EXECUTION_BLOCKED"&&createProvider==="codex"&&createHost==="local"&&automationLevel==="auto";
        if(!recoverable)throw cause;
        const accepted=confirm($t("host.trustedAutoTaskConfirm"));
        if(!accepted){createError=$t("host.trustedAutoTaskRequired");return;}
        await api("/api/hosts/local/trusted-auto",{method:"PUT",headers:{"Idempotency-Key":uuid()},body:JSON.stringify({enabled:true,provider:"codex",confirmNoSandbox:true,version:1})});
        data=await submit();
      }
      // A new task starts its own spool at sequence 1. Carrying the previously
      // viewed task's high-water mark makes the SSE subscription ask for
      // `after=<old sequence>` and makes canApplyLiveSnapshot reject the first
      // snapshots, so the new session rendered nothing until a reload reset it.
      stopLive();discardLive();lastLiveSequence=0;liveIds.clear();taskState.upsert(data.task);selected=data.task;overviewOpen=false;events=[];finishCreateForm();
      if(rememberLast)try{localStorage.setItem("deck-create-prefs",JSON.stringify({provider:createProvider,claudeModel:createClaudeModel,claudeEffort:createClaudeEffort,claudePermission:createClaudePermission,claudeWorkMode:createClaudeWorkMode,claudeAutomation:createClaudeAutomation,codexModel:createModel,codexEffort:createEffort,codexTier:createTier,codexPermission:createPermission,codexWorkMode:createCodexWorkMode,codexAutomation:createCodexAutomation,grokModel:createGrokModel,deepseekModel:createDeepseekModel,ollamaModel:createOllamaModel,antigravityModel:createAntigravityModel,...Object.fromEntries(compatibleProviders.flatMap(provider=>[[`${provider}Effort`,createCompatibleEfforts[provider]],[`${provider}WorkMode`,createCompatibleWorkModes[provider]],[`${provider}Automation`,createCompatibleAutomation[provider]],[`${provider}Permission`,permissionForAutomation(provider,createCompatibleAutomation[provider])]]))}));}catch{}
      startLive();
      await loadThreadEvents(data.task,true,true);
    } catch(e) { createError=e instanceof Error?e.message:String(e); }
    finally { sending=false; }
  }
  async function createCollaboration(){
    const conversation=createKind==="conversation",review=!conversation;
    const availability=liveProviderAvailability();
    const primaryProvider:ProviderId=conversation?conversationFirstProvider:createProvider;
    // The payload participants come from the connected-only list, never from the
    // raw enabled map, so a disconnected provider cannot re-enter the request.
    const enabled:ProviderId[]=conversation?conversationParticipantsFor(availability):reviewParticipantsFor(availability);
    if(!createPrompt.trim()||!createWorkspace||createOpening||sending||createConnectionBlocked||conversation&&(!conversationUserNickname.trim()||debateUnlimited&&!debateUnlimitedConfirmed)||review&&reviewFullAutoSelected()&&!dangerConfirmed)return;
    if(blockCreateOnConnection(availability))return;
    sending=true;
    try{
      const applyReviewFixes=reviewFixesEnabled();
      const participants=enabled.map((provider)=>{
        const modelSettings=conversation?(provider==="codex"?{model:conversationCodexModel||null,reasoningEffort:conversationCodexEffort||null}:provider==="claude"?{model:conversationClaudeModel==="default"?null:conversationClaudeModel,reasoningEffort:conversationClaudeEffort==="default"?null:conversationClaudeEffort}:{model:conversationCompatibleModels[provider]||null,reasoningEffort:conversationCompatibleEfforts[provider]==="default"?null:conversationCompatibleEfforts[provider]}):(provider==="codex"?{model:createModel||null,reasoningEffort:createEffort||null,serviceTier:createTier}:provider==="claude"?{model:createClaudeModel==="default"?null:createClaudeModel,reasoningEffort:createClaudeEffort==="default"?null:createClaudeEffort}:{model:createCompatibleModel(provider as CompatibleExecutionProvider)||null,reasoningEffort:createCompatibleEfforts[provider as CompatibleExecutionProvider]==="default"?null:createCompatibleEfforts[provider as CompatibleExecutionProvider]});
        const toneOverride=conversation?conversationTonePresets[provider]:reviewTonePresets[provider],toneSettings=toneOverride?{tonePreset:toneOverride,...(toneOverride==="custom"?{customTone:conversation?conversationCustomTone(provider):reviewCustomTone(provider)}:{})}:{};
        return{provider,executionHostId:createHost,workspaceId:createWorkspace,permissionMode:applyReviewFixes&&provider===primaryProvider?"write":"read",...modelSettings,automationLevel:conversation?"read":createAutomationFor(provider),...toneSettings};
      });
      const reviewFull=review&&reviewFullAutoSelected();
      const data=await api("/api/collaborations",{method:"POST",headers:{"Idempotency-Key":uuid()},body:JSON.stringify({projectId:createProject,title:createPrompt.trim().replace(/\s+/g," ").slice(0,80),mode:createKind,primaryProvider,prompt:withAttachments(createPrompt,createAttachments),participants,reviewDepth:createKind==="review"?reviewDepth:undefined,reviewFinalization:createKind==="review"?reviewFinalization:undefined,applyReviewFixes:createKind==="review"?applyReviewFixes:undefined,maxRounds:conversation?(debateUnlimited?null:Math.min(Math.max(debateMaxTurns,1),100)):undefined,unlimitedConfirmation:conversation&&debateUnlimited&&debateUnlimitedConfirmed,debateKind:conversation?debateKind:undefined,conversationFlow:conversation?conversationFlow:undefined,conversationKind:conversation?(debateKind==="artifact-review"?"artifact-review":"casual"):undefined,conversationTurnLength:conversation?conversationTurnLength:undefined,participantOrder:conversation?enabled:undefined,relationshipPreset:conversation?"adult-friends":undefined,userNickname:conversation?conversationUserNickname.trim():undefined,allowModelUserCall:conversation&&conversationFlow==="automatic"?conversationAllowModelUserCall:undefined,conclusionRequested:conversation?conversationConclusionRequested:undefined,conclusionRelativePath:conversation&&conversationConclusionRequested&&conversationConclusionPath.trim()?conversationConclusionPath.trim().replace(/^\/+/,""):undefined,dangerConfirmation:applyReviewFixes||reviewFull&&dangerConfirmed,fullAccessAcknowledged:reviewFull&&dangerConfirmed,acknowledgementVersion:reviewFull&&dangerConfirmed?1:undefined,timeoutMs:(conversation?conversationTimeoutMinutes:collaborationTimeoutMinutes)*60_000})});
      if(conversation)try{localStorage.setItem("deck-conversation-prefs",JSON.stringify({firstProvider:conversationFirstProvider,enabled:conversationEnabled,flow:conversationFlow,allowModelUserCall:conversationAllowModelUserCall,kind:debateKind,useGlobalTone:conversationProviders.every(provider=>!conversationTonePresets[provider]),tonePresets:Object.fromEntries(conversationProviders.map(provider=>[provider,conversationToneFor(provider)])),maxRounds:Math.min(Math.max(debateMaxTurns,1),100),unlimited:debateUnlimited,timeoutMinutes:Math.min(Math.max(conversationTimeoutMinutes,1),480),userNickname:conversationUserNickname.trim(),codexModel:conversationCodexModel,codexEffort:conversationCodexEffort,claudeModel:conversationClaudeModel,claudeEffort:conversationClaudeEffort,...Object.fromEntries(compatibleProviders.flatMap(provider=>[[`${provider}Model`,conversationCompatibleModels[provider]],[`${provider}Effort`,conversationCompatibleEfforts[provider]]]))}));}catch{}
      else if(rememberLast)try{const current=JSON.parse(localStorage.getItem("deck-create-prefs")||"{}");localStorage.setItem("deck-create-prefs",JSON.stringify({...current,reviewEnabled,codexModel:createModel,codexEffort:createEffort,codexTier:createTier,codexAutomation:createCodexAutomation,codexPermission:permissionForAutomation("codex",createCodexAutomation),claudeModel:createClaudeModel,claudeEffort:createClaudeEffort,claudeAutomation:createClaudeAutomation,claudePermission:permissionForAutomation("claude",createClaudeAutomation),grokModel:createGrokModel,deepseekModel:createDeepseekModel,ollamaModel:createOllamaModel,antigravityModel:createAntigravityModel}));}catch{}
      collaborations=[data.session,...collaborations.filter(item=>item.id!==data.session.id)];selectedCollaboration=data.session.id;selected=null;createOpen=false;createPrompt="";createAttachments=[];vscodeContext=null;debateUnlimitedConfirmed=false;
    }catch(e){error=e instanceof Error?e.message:String(e)}finally{sending=false;}
  }
  function currentAssistSource(){
    const result=terminal.has(selected?.status??"pending")?String(selected?.result??"").trim():"";if(result)return result;
    const rows=events.filter(item=>String(item?.content??"").trim()).slice(-80).map(item=>{const role=item.metadata?.role==="user"?$t("conversation.userDefault"):item.metadata?.role==="agent"||item.type==="message_completed"||item.type==="message_delta"?providerDisplayName(selected?.provider??"codex"):item.type.startsWith("command_")?$t("conversation.command"):item.type.startsWith("file_change_")?$t("conversation.fileChange"):$t("conversation.process");return `[${role}] ${String(item.content).trim()}`;});
    return (rows.join("\n\n")||String(selected?.log??selected?.prompt??"").trim()).slice(-20000);
  }
  function openAssist(){if(!selected)return;assistSourceContent=currentAssistSource();const provider=providerDisplayName(selected.provider),activeSession=active.has(selected.status);assistPrompt=$t(activeSession?"assist.defaultActivePrompt":"assist.defaultCompletedPrompt",{provider,content:assistSourceContent});assistTargetProvider=selected.provider==="codex"?"claude":"codex";assistTargetModel="";assistTargetEffort="default";assistTargetTier=null;assistOpen=true;}
  async function createAssist(){if(!selected||!assistTargetModel||!assistPrompt.trim()||!assistSourceContent.trim()||sending)return;sending=true;try{const data=await api(`/api/tasks/${selected.provider}/${encodeURIComponent(selected.id)}/assist`,{method:"POST",headers:{"Idempotency-Key":uuid()},body:JSON.stringify({targetProvider:assistTargetProvider,executionHostId:selected.executionHostId??"local",workspaceId:selected.workspaceId,title:$t("assist.sessionTitle",{title:selected.title}),prompt:assistPrompt,sourceContent:assistSourceContent,model:assistTargetModel,reasoningEffort:assistTargetEffort,serviceTier:assistTargetTier})});selectedAssistId=data.session.id;collaborations=[data.session,...collaborations.filter(item=>item.id!==data.session.id)];assistOpen=false;assistPrompt="";assistSourceContent="";}catch(e){error=e instanceof Error?e.message:String(e)}finally{sending=false;}}
  async function openCollaboration(id:string){codexRef?.closeDetail();codexDetailOpen=false;stopLive();discardLive();selected=null;events=[];selectedCollaboration=id;}
  function submitFollowupKey(event:KeyboardEvent){if(!shouldSubmitOnEnter(event,enterToSend)||sending||(!followup.trim()&&!msgAttachments.length))return;event.preventDefault();void sendFollowup();}
  function submitCreateKey(event:KeyboardEvent){const permission=createPermissionFor(createProvider),reviewDanger=(createKind==="parallel"||createKind==="review")&&reviewFullAutoSelected();if(!shouldSubmitOnEnter(event,enterToSend)||sending||!createPrompt.trim()||createConnectionBlocked||(createKind==="single"&&permission===":danger-full-access"&&!dangerConfirmed)||(reviewDanger&&!dangerConfirmed))return;event.preventDefault();void createTask();}
  async function action(kind:"message"|"fork"|"stop") {
    if(!selected||sending)return;
    sending=true;followupStarting=kind==="message";
    try {
      const suffix=kind==="message"?"messages":kind;
      const body=kind==="message"?JSON.stringify({prompt:withAttachments(followup,msgAttachments)}):JSON.stringify({});
      const data=await api(`/api/tasks/${selected.provider}/${encodeURIComponent(selected.id)}/${suffix}`,{method:"POST",headers:{"Idempotency-Key":uuid()},body});
      if(kind==="message"&&data.queued){
        // A turn started between the polled snapshot and this request, so the
        // server queued the message instead of opening a second process on the
        // session. The queue panel owns it now; no optimistic request card.
        followup="";msgAttachments=[];await queuedTaskStarted(data.task);
      }else if(kind==="message"){
        // Same session: keep the transcript, append the new user turn, stream the new worker.
        flushLive();stopLive();discardLive();const next={...data.task,metadata:{...selected.metadata,...data.task.metadata}};taskState.upsert(next);selected=next;const sent=withAttachments(followup,msgAttachments);followup="";msgAttachments=[];
        lastLiveSequence=0;
        // Stamp the optimistic request with the turn it belongs to. An anonymous
        // copy cannot be paired with the same row in the server snapshot, so the
        // turn showed two request cards and the log lost its order around them.
        events=[...events,{type:"message",content:sent,timestamp:next.createdAt,taskId:next.id,metadata:{role:"user",section:"request"}} as AgentEvent];
        startLive();
      }else if(kind==="fork"){taskState.upsert(data.task);selected=data.task;events=[];await loadThreadEvents(data.task,true);}
      else{selected=data.task;taskState.upsert(data.task);await loadThreadEvents(data.task,true);}
    } catch(e) { error=e instanceof Error?e.message:String(e); }
    finally { sending=false;followupStarting=false; }
  }
  async function sendFollowup(){
    if(!selected||sending||(!followup.trim()&&!msgAttachments.length))return;
    if(!active.has(selected.status))return action("message");
    sending=true;try{const sent=withAttachments(followup,msgAttachments);if(await messageQueueRef?.enqueue(sent)){followup="";msgAttachments=[];}}catch(e){error=e instanceof Error?e.message:String(e)}finally{sending=false;}
  }
  async function queuedTaskStarted(task:Task){
    if(!selected||task.threadId!==selected.threadId||task.provider!==selected.provider||task.id===selected.id)return;
    flushLive();stopLive();discardLive();const previous=selected;taskState.upsert(task);selected={...task,metadata:{...previous.metadata,...task.metadata}};lastLiveSequence=0;liveIds.clear();startLive();await loadThreadEvents(selected,true,true);
  }
  async function recoveredTaskStarted(task:Task){taskState.upsert(task);await openTask(task);}
  async function compactContext(){
    if(!selected?.threadId||!selected.owned||active.has(selected.status)||contextRequestBusy)return;
    contextRequestBusy=true;
    try{
      const current=selected;const data=await api(`/api/tasks/${current.provider}/${encodeURIComponent(current.id)}/compact`,{method:"POST",headers:{"Idempotency-Key":uuid()},body:JSON.stringify({confirm:true})});
      const next={...data.task,metadata:{...current.metadata,...data.task.metadata,operation:"context_compaction"}};
      flushLive();stopLive();discardLive();taskState.upsert(next);selected=next;lastLiveSequence=0;liveIds.clear();startLive();
    }catch(e){error=e instanceof Error?e.message:String(e)}finally{contextRequestBusy=false;}
  }
  async function toggleFollow(){if(!selected||selected.owned||sending)return;sending=true;try{const enabled=selected.metadata?.controlState!=="follow",data=await api(`/api/tasks/${selected.provider}/${encodeURIComponent(selected.id)}/follow`,{method:"POST",headers:{"Idempotency-Key":uuid()},body:JSON.stringify({enabled})});selected=data.task;taskState.upsert(data.task);}catch(e){error=e instanceof Error?e.message:String(e)}finally{sending=false;}}
  async function takeControl(){if(!selected||selected.owned||sending||!confirm($t("session.takeControlOwnedConfirm")))return;sending=true;try{const data=await api(`/api/tasks/${selected.provider}/${encodeURIComponent(selected.id)}/take-control`,{method:"POST",headers:{"Idempotency-Key":uuid()},body:JSON.stringify({confirm:true})});taskState.upsert(data.task);await openTask(data.task);}catch(e){error=e instanceof Error?e.message:String(e)}finally{sending=false;}}
  async function copy(value:string|null){if(value)await navigator.clipboard.writeText(value);}
  async function copySelected(kind:"task"|"thread"){if(!selected)return;await copy(kind==="task"?selected.nativeId:selected.threadId);}
  function beginRename(){if(!selected)return;renameTitle=selected.title??"";renameEditing=true;}
  function cancelRename(){renameEditing=false;renameTitle=selected?.title??"";}
  function renameKeydown(event:KeyboardEvent){if(event.isComposing)return;if(event.key==="Escape"){event.preventDefault();cancelRename();}else if(event.key==="Enter"){event.preventDefault();void saveRename();}}
  async function saveRename(){
    const current=selected,title=renameTitle.trim();if(!current||!title||renameSaving)return;
    if(title===current.title){cancelRename();return;}
    const sessionId=current.threadId??current.id;renameSaving=true;
    try{
      const data=await api(`/api/sessions/${current.provider}/${encodeURIComponent(sessionId)}/title`,{method:"PATCH",headers:{"Idempotency-Key":uuid()},body:JSON.stringify({title})});
      for(const task of data.tasks??[])taskState.upsert(task);
      if(selected?.id!==current.id)return;
      const updated=(data.tasks??[]).find((task:Task)=>task.id===current.id);
      selected=updated??{...selected,title:data.title??title,metadata:{...selected.metadata,customTitle:data.title??title}};
      taskState.upsert(selected!);renameEditing=false;
    }catch(e){error=e instanceof Error?e.message:String(e);}finally{renameSaving=false;}
  }
  function statusIcon(status:Status){return status==="completed"?Check:status==="failed"?CircleAlert:status==="running"?Activity:status==="waiting"?Clock3:status==="stopped"?Square:Clock3;}
  function executionBackendLabel(metadata:Record<string,any>|undefined){return metadata?.executionBackend?$t(`execution.${metadata.executionBackend}`):metadata?.executionUiLabel??null;}
  const createModelInfo=()=>allCodexModelOptions().find((x:any)=>x.id===createModel);
  const delegationCodexModelInfo=()=>delegationSettings.codex.model?allCodexModelOptions().find((item:any)=>item.id===delegationSettings.codex.model&&!item.hidden):availableCodexModels().find((item:any)=>item.isDefault&&!item.hidden);
  const delegationCodexEfforts=()=>delegationCodexModelInfo()?.supportedReasoningEfforts??[];
  function setDelegationCodexModel(model:string|null){delegationSettings={...delegationSettings,codex:{...delegationSettings.codex,model}};const info=delegationCodexModelInfo();if(delegationSettings.codex.reasoningEffort&&!info?.supportedReasoningEfforts?.some((item:any)=>item.reasoningEffort===delegationSettings.codex.reasoningEffort))delegationSettings={...delegationSettings,codex:{...delegationSettings.codex,reasoningEffort:null}};if(delegationSettings.codex.serviceTier&&!info?.serviceTiers?.some((item:any)=>item.id===delegationSettings.codex.serviceTier))delegationSettings={...delegationSettings,codex:{...delegationSettings.codex,serviceTier:null}};}
  const delegationClaudeModels=()=>availableClaudeModels();
  function mergeModelCandidates(provider:"codex"|"claude",runtime:GlobalModelEntry[]){const custom=[...globalModelCandidates[provider],...globalModelSettings[provider].models].filter(item=>item.source==="custom"),byId=new Map(runtime.map(item=>[item.id,item]));for(const item of custom)byId.set(item.id,item);const candidates=[...byId.values()],selected=globalModelSettings[provider].models.filter(item=>item.source==="custom"||byId.get(item.id)?.source==="runtime");globalModelCandidates={...globalModelCandidates,[provider]:candidates};globalModelSettings={...globalModelSettings,[provider]:{models:selected.length?selected:candidates.slice(0,1)}};}
  function claudeSelectionSnapshot(){return{create:createClaudeModel,conversation:conversationClaudeModel,delegation:delegationSettings.claude.model};}
  function applyClaudeCatalog(data:any){
    const before=claudeSelectionSnapshot(),oldNames=new Map(allClaudeModelOptions().map(item=>[item.id,item.displayName]));
    claudePermissions=data.permissions??claudePermissions;claudeModels=data.models??data.catalog?.models??claudeModels;claudeEfforts=Array.isArray(data.efforts)&&data.efforts.length?data.efforts:[...COMPATIBLE_REASONING_EFFORTS];claudeCatalogMeta=data.catalog??claudeCatalogMeta;
    mergeModelCandidates("claude",claudeModels.filter(item=>item.id!=="default").map(item=>({id:item.id,displayName:item.displayName,source:item.source??"runtime",validatedAt:null})));
    syncAllGlobalModelChoices();
    claudeModelTransitions=claudeSelectionTransitions(before,claudeSelectionSnapshot()).map(item=>({...item,fromName:oldNames.get(item.from)??item.from,toName:claudeModelName(item.to)}));
  }
  let claudeCatalogLoadPromise:Promise<void>|null=null;
  async function loadClaudeModelCatalog(){
    if(claudeCatalogLoadPromise)return claudeCatalogLoadPromise;
    if(claudeModels.length){claudeCatalogLoading=false;return;}
    claudeCatalogLoadPromise=(async()=>{
      claudeCatalogLoading=true;
      try{applyClaudeCatalog(await api("/api/providers/claude/permissions"));}
      catch{/* The create dialog can still use a previously loaded or custom model. */}
      finally{claudeCatalogLoading=false;}
    })();
    try{await claudeCatalogLoadPromise;}finally{claudeCatalogLoadPromise=null;}
  }
  const claudeModelTransitionText=()=>[...new Set(claudeModelTransitions.map(item=>`${item.fromName} → ${item.toName}`))].join(", ");
  function toggleGlobalModel(provider:ProviderId,item:GlobalModelEntry){const current=globalModelSettings[provider].models,exists=current.some(model=>model.id===item.id),models=exists?current.filter(model=>model.id!==item.id):[...current,item];if(!models.length)return;globalModelSettings={...globalModelSettings,[provider]:{models}};syncAllGlobalModelChoices();}
  function addCustomModel(provider:"codex"|"claude",validatedAt:string|null=null){const draft=customModelDraft[provider],id=draft.id.trim(),displayName=draft.displayName.trim()||id;if(!/^[a-z0-9][a-z0-9._:/-]{0,90}(?:\[1m\])?$/i.test(id)){modelValidation={...modelValidation,[provider]:{busy:false,valid:false,detail:$t("model.invalidId")}};return;}const item:GlobalModelEntry={id,displayName,source:"custom",validatedAt},without=globalModelCandidates[provider].filter(model=>model.id!==id);globalModelCandidates={...globalModelCandidates,[provider]:[...without,item]};const selected=globalModelSettings[provider].models.filter(model=>model.id!==id);globalModelSettings={...globalModelSettings,[provider]:{models:[...selected,item]}};customModelDraft={...customModelDraft,[provider]:{id:"",displayName:""}};syncAllGlobalModelChoices();}
  async function validateCustomModel(provider:"codex"|"claude"){const model=customModelDraft[provider].id.trim();if(!model)return;modelValidation={...modelValidation,[provider]:{busy:true}};try{const result=await api("/api/system-settings/models/validate",{method:"POST",body:JSON.stringify({provider,model})});modelValidation={...modelValidation,[provider]:{busy:false,valid:result.valid,detail:result.detailKey?$t(result.detailKey):result.detail}};if(result.valid)addCustomModel(provider,result.validatedAt??new Date().toISOString());}catch(e){modelValidation={...modelValidation,[provider]:{busy:false,valid:false,detail:e instanceof Error?e.message:String(e)}};}}
  async function refreshClaudeModelCatalog(){if(claudeCatalogRefreshing)return;claudeCatalogRefreshing=true;globalSaveNotice="";try{const data=await api("/api/providers/claude/permissions?refresh=true");applyClaudeCatalog(data);}catch(e){globalSaveNotice=e instanceof Error?e.message:String(e);}finally{claudeCatalogRefreshing=false;}}
  async function refreshCodexModelCatalog(){if(codexCatalogRefreshing)return;codexCatalogRefreshing=true;globalSaveNotice="";try{const data=await api("/api/providers/codex/models?refresh=true");catalog=data.catalog??catalog;mergeModelCandidates("codex",(catalog.models??[]).filter((item:any)=>!item.hidden).map((item:any)=>({id:item.id,displayName:item.displayName,source:"runtime",validatedAt:null})));syncAllGlobalModelChoices();}catch(e){globalSaveNotice=e instanceof Error?e.message:String(e);}finally{codexCatalogRefreshing=false;}}
  async function refreshCompatibleModelCatalog(provider:CompatibleExecutionProvider){if(providerCatalogRefreshing[provider])return;providerCatalogRefreshing={...providerCatalogRefreshing,[provider]:true};globalSaveNotice="";try{const data=await api(`/api/providers/${provider}/models?refresh=true`),candidates=(data.models??[]).map((item:any)=>({id:item.id,displayName:item.displayName??item.id,source:"runtime" as const,validatedAt:null})),ids=new Set(candidates.map((item:GlobalModelEntry)=>item.id)),selected=globalModelSettings[provider].models.filter(item=>ids.has(item.id));globalModelCandidates={...globalModelCandidates,[provider]:candidates};globalModelSettings={...globalModelSettings,[provider]:{models:selected.length?selected:candidates.slice(0,1)}};syncAllGlobalModelChoices();}catch(e){globalSaveNotice=e instanceof Error?e.message:String(e);}finally{const next={...providerCatalogRefreshing};delete next[provider];providerCatalogRefreshing=next;}}
  const canContinue=()=>Boolean(selected?.threadId);
  function createModelChanged(){const m=createModelInfo();if(!m?.supportedReasoningEfforts?.some((x:any)=>x.reasoningEffort===createEffort))createEffort=m?.defaultReasoningEffort??"medium";if(!m?.serviceTiers?.some((x:any)=>x.id==="priority"))createTier=null;}
  const globalCodexModelInfo=()=>allCodexModelOptions().find((x:any)=>x.id===globalCodexModel);
  function globalCodexModelChanged(){const m=globalCodexModelInfo();if(!m?.supportedReasoningEfforts?.some((x:any)=>x.reasoningEffort===globalCodexEffort))globalCodexEffort=m?.defaultReasoningEffort??"medium";if(!m?.serviceTiers?.some((x:any)=>x.id==="priority"))globalCodexTier=null;}
  async function handoffCompleted(task:Task){handoffOpen=false;taskState.upsert(task);await openTask(task);}

  onMount(()=>{
    let disposed=false;
    let disposeApplication=()=>{};
    let ownerCheckRunning=false;
    const colorScheme=window.matchMedia("(prefers-color-scheme: light)");
    const syncSystemTheme=()=>{if(theme==="auto")syncThemeChrome();};
    colorScheme.addEventListener("change",syncSystemTheme);
    syncThemeChrome();
    let applicationStarted=false;
    const startApplication=async()=>{
      if(applicationStarted||disposed)return;
      applicationStarted=true;
      const deepLinkOpened=await openInitialDeepLink();
      if(disposed)return;
      const removeKeyboardInset=installKeyboardInset();
      // The immersive reading mode must switch off the moment the layout stops
      // being a phone, and must never hide the composer while the soft keyboard
      // is up.
      const trackViewport=()=>{viewportWidth=window.innerWidth;viewportHeight=window.visualViewport?.height??window.innerHeight;keyboardOpen=document.documentElement.hasAttribute("data-keyboard-open");};
      const coarseQuery=window.matchMedia("(pointer:coarse)");
      const trackPointer=(event:MediaQueryListEvent)=>{coarsePointer=event.matches;};
      trackViewport();
      window.addEventListener("resize",trackViewport);
      window.visualViewport?.addEventListener("resize",trackViewport);
      window.addEventListener("focusin",trackViewport);
      window.addEventListener("focusout",trackViewport);
      coarseQuery.addEventListener("change",trackPointer);
      const overflowReposition=()=>{if(overflowOpen)placeOverflow();};
      window.addEventListener("resize",overflowReposition);
      window.visualViewport?.addEventListener("resize",overflowReposition);
      window.visualViewport?.addEventListener("scroll",overflowReposition);
      const removeViewportTracking=()=>{
        window.removeEventListener("resize",overflowReposition);
        window.visualViewport?.removeEventListener("resize",overflowReposition);
        window.visualViewport?.removeEventListener("scroll",overflowReposition);
        window.removeEventListener("resize",trackViewport);
        window.visualViewport?.removeEventListener("resize",trackViewport);
        window.removeEventListener("focusin",trackViewport);
        window.removeEventListener("focusout",trackViewport);
        coarseQuery.removeEventListener("change",trackPointer);
      };
      startRuntimeUpdateEvents();startModelCatalogEvents();
      void (async()=>{
        await refresh();
        // Provider rows update through the shared Svelte store. Let the
        // subscription flush before resolving a task deep link against it.
        await tick();
        if(!deepLinkOpened)await openInitialDeepLink();
        if(disposed)return;
        await Promise.allSettled([loadQuota(true),loadPush().then(sendPresence)]);
        if(disposed)return;
        await Promise.allSettled([
          loadCharacterSettings(),
          loadProviderAccounts(),
          loadPathDisplay(),
          loadPromptPresetSettings(),
          api("/api/setup").then(data=>{setupRequired=Boolean(data.required);setupShowOnStartup=data.preferences?.showOnStartup!==false;})
        ]);
        if(disposed)return;
        await loadGlobalModelSettings();
        await loadClaudeModelCatalog();
      })();
      const timer=setInterval(()=>{if(document.visibilityState==="visible")refreshVisibleTaskLists();},30000);
      const statusTimer=setInterval(()=>{if(document.visibilityState!=="visible")return;void refreshTaskSnapshot("App.statusDelta");if(selected)void reconcileSelectedStatus();},10000);
      const presenceTimer=setInterval(()=>void sendPresence(),30000);
      const visibility=()=>{void sendPresence();if(document.visibilityState==="hidden")stopLive();else{refreshVisibleTaskLists();void loadPromptPresetSettings();if(quotaNeedsRetry(quota)||quotaIsStale(quota))void loadQuota();if(selected){startLive();void reconcileSelectedStatus();}}};
      document.addEventListener("visibilitychange",visibility);
      disposeApplication=()=>{removeKeyboardInset();removeViewportTracking();clearInterval(timer);clearInterval(statusTimer);clearInterval(presenceTimer);if(authPollTimer)clearInterval(authPollTimer);for(const timer of Object.values(runtimeNoticeTimers))if(timer)clearTimeout(timer);clearQuotaRetry();document.removeEventListener("visibilitychange",visibility);stopLive();discardLive();stopAuthStream("codex");stopAuthStream("claude");runtimeUpdateSource?.close();runtimeUpdateSource=null;modelCatalogSource?.close();modelCatalogSource=null;};
    };
    const initialize=async()=>{
      if(disposed||ownerCheckRunning||applicationStarted)return;
      ownerCheckRunning=true;
      ownerClaimChecked=false;
      ownerClaimStatusError="";
      ownerClaimInitial=null;
      try{
        await exchangeLocalEntryFragment(location,history);
        try{applyPlatformDefaults(await requestJson("/api/bootstrap/status",{}, {category:"quick",caller:"App.bootstrap"}));}catch{/* Non-loopback deployments do not expose the launcher snapshot. */}
        ownerClaimInitial=await requestJson("/api/bootstrap/owner-claim/status",{}, {category:"quick",caller:"App.ownerClaim"});
        ownerClaimRequired=ownerClaimInitial?.required===true;
        if(!ownerClaimRequired&&location.pathname==="/claim")history.replaceState(null,"","/");
      }catch(value){
        if((value as any)?.status===404)ownerClaimRequired=false;
        else ownerClaimStatusError=value instanceof Error?value.message:String(value);
      }finally{
        ownerClaimChecked=true;
        ownerCheckRunning=false;
      }
      if(disposed||ownerClaimRequired||ownerClaimStatusError)return;
      await startApplication();
    };
    retryOwnerClaimStatus=()=>void initialize();
    void initialize();
    return()=>{
      disposed=true;
      colorScheme.removeEventListener("change",syncSystemTheme);
      retryOwnerClaimStatus=()=>{};
      disposeApplication();
    };
  });
</script>

<svelte:head><meta name="color-scheme" content="dark light" /></svelte:head>

{#snippet topbarUtilities(labelled:boolean)}
  <button type="button" data-popup-trigger="quota" class="icon-button quota-btn {barClass(quotaPeak())}" class:labelled class:active={quotaOpen} aria-label={$t("quota.title")} title={$t("quota.title")} onclick={()=>{closeOverflow();quotaOpen=!quotaOpen;if(quotaOpen)void loadQuota(true);}}><Gauge size={19}/>{#if labelled}<span>{$t("quota.title")}</span>{/if}</button>
  <button type="button" class="icon-button" class:labelled class:active={globalOpen} aria-label={$t("a11y.openSettings")} title={$t("settings.title")} onclick={()=>{closeOverflow();openGlobalSettings();}}><Settings size={19}/>{#if labelled}<span>{$t("settings.title")}</span>{/if}</button>
  {#if !selected&&!selectedCollaboration&&!codexDetailOpen}<button type="button" class="icon-button" class:labelled class:active={searchOpen} aria-label={$t("a11y.openSearch")} title={$t("common.search")} onclick={()=>{closeOverflow();searchOpen=!searchOpen;if(searchOpen)overviewOpen=false;else updateSearchQuery("");}}><Search size={19}/>{#if labelled}<span>{$t("common.search")}</span>{/if}</button>{/if}
  <button type="button" class="icon-button" class:labelled aria-label={$t("common.refresh")} title={$t("common.refresh")} disabled={refreshRunning} onclick={()=>{closeOverflow();void refresh();}}><RefreshCw size={19} class={refreshRunning?"spin":""}/>{#if labelled}<span>{$t("common.refresh")}</span>{/if}</button>
{/snippet}

{#snippet providerConnectionsPending()}
  <div class="create-options-loading provider-connection-pending" role="status"><LoaderCircle class="spin" size={17}/><span>{$t("provider.connectionChecking")}</span></div>
{/snippet}

{#snippet providerConnectionsEmpty()}
  <div class="provider-connection-empty" role="status">
    <strong>{$t("provider.noneConnected")}</strong>
    <small>{$t("provider.noneConnectedBody")}</small>
    <button type="button" onclick={openProviderConnections}>{$t("provider.openConnections")}</button>
  </div>
{/snippet}

{#snippet inlineProviderAuth(provider:ConnectionAuthProvider,idPrefix:string)}
  {@const account=providerAccounts.find(item=>item.provider===provider)}
  {@const storedAttempt=authAttempts[provider]}
  {@const attempt=isActiveAuthAttempt(storedAttempt)?storedAttempt!:null}
  {@const feedback=authFeedback[provider]}
  <section class="inline-auth-flow" class:connected={account?.state==="connected"} aria-live="polite">
    <header><span class="provider-mark {provider}">{provider==="codex"?"C":provider==="claude"?"Cl":provider==="grok"?"G":"Ag"}</span><span><strong>{$t("auth.inlineTitle",{name:providerName(provider)})}</strong><small>{accountStatusLabel(provider,attempt,account)}</small></span></header>
    {#if feedback}<p class="auth-feedback {feedback.tone}" role="status">{feedback.message}</p>{/if}
    {#if attempt}
      <div class="auth-progress">
        {#if attempt.url}<a class="auth-open" href={attempt.url} target="_blank" rel="noopener noreferrer">{$t(provider==="codex"?"auth.openOpenAI":provider==="antigravity"?"auth.openGoogle":provider==="grok"?"auth.openXai":"auth.openAnthropic")}</a>{:else}<p class="auth-waiting">{$t("auth.preparingPage")}</p>{/if}
        {#if attempt.userCode}<div class="device-code"><span><small>{$t("auth.oneTimeCode")}</small><code>{attempt.userCode}</code></span><button type="button" onclick={()=>copy(attempt.userCode)}>{$t("auth.copyCode")}</button></div>{/if}
        {#if (provider==="claude"||provider==="antigravity")&&attempt.state==="code_required"}
          <form class="auth-code-form" onsubmit={(event)=>{event.preventDefault();void submitAuthCode(provider);}}><label for={`${idPrefix}-${provider}-auth-code`}>{$t(provider==="antigravity"?"auth.antigravityCode":"auth.claudeCode")}</label><div><input id={`${idPrefix}-${provider}-auth-code`} type="text" autocomplete="one-time-code" maxlength="512" value={authCodes[provider]??""} oninput={(event)=>authCodes={...authCodes,[provider]:(event.currentTarget as HTMLInputElement).value}} placeholder={$t("auth.officialPageCode")}/><button type="submit" disabled={!authCodes[provider]?.trim()}>{$t("auth.submitCode")}</button></div></form>
        {/if}
        <button type="button" class="auth-cancel" onclick={()=>cancelProviderLogin(provider)}>{$t("auth.cancelLogin")}</button>
      </div>
    {:else if account?.state==="disconnected"}
      <p class="inline-auth-help">{$t("auth.inlineBody")}</p>
      <div class="provider-auth-actions">
        {#if provider==="codex"}<button type="button" onclick={()=>startProviderLogin("codex","device")}>{$t("auth.connectCodex")}</button><button type="button" onclick={()=>startProviderLogin("codex","browser")}>{$t("auth.browserLogin")}</button>
        {:else if provider==="claude"}<button type="button" onclick={()=>startProviderLogin("claude","subscription")}>{$t("auth.connectClaudeSubscription")}</button><button type="button" onclick={()=>startProviderLogin("claude","console")}>{$t("auth.connectConsole")}</button><button type="button" onclick={()=>startProviderLogin("claude","sso")}>{$t("auth.connectSso")}</button>
        {:else if provider==="grok"}<button type="button" onclick={()=>startProviderLogin("grok","device")}>{$t("auth.connectGrok")}</button>
        {:else}<button type="button" onclick={()=>startProviderLogin("antigravity",antigravityUsesVertex?"google-cloud":"google-oauth")}>{$t(antigravityUsesVertex?"antigravityExecution.connectCloud":"auth.connectAntigravity")}</button>{/if}
      </div>
    {:else}<p class="inline-auth-ready">{$t("auth.readyToCreate")}</p>{/if}
  </section>
{/snippet}

{#if !ownerClaimChecked}
<main class="claim-bootstrap" aria-live="polite"><LoaderCircle class="spin" size={30}/><strong>{$t("ownerClaim.scanning")}</strong></main>
{:else if ownerClaimStatusError}
<main class="claim-bootstrap" role="alert"><CircleAlert size={30}/><strong>{ownerClaimStatusError}</strong><button type="button" onclick={retryOwnerClaimStatus}>{$t("common.retry")}</button></main>
{:else if ownerClaimRequired}
<OwnerClaim {api} initialStatus={ownerClaimInitial} onclaimed={retryOwnerClaimStatus}/>
{:else}
<div class="shell" inert={Boolean(workspaceViewer)&&(workspaceViewerLayout.layout==="window"||workspaceViewerLayout.layout==="fullscreen")} class:detail-open={selected||selectedCollaboration||codexDetailOpen} class:session-detail-open={selected||codexDetailOpen} class:chrome-drawer-enabled={immersiveActive} class:chrome-immersive={chromeHidden} style={immersiveActive?`--chrome-progress:${$bottomChromeProgress}`:""} class:overview-open={overviewOpen&&!selected&&!selectedCollaboration&&!codexDetailOpen} class:viewer-columns={Boolean(workspaceViewer)&&workspaceViewerLayout.layout==="columns"} class:viewer-rows={Boolean(workspaceViewer)&&workspaceViewerLayout.layout==="rows"} class:viewer-layout-reversed={Boolean(workspaceViewer)&&workspaceViewerLayout.reversed}>
  <header class="topbar">
    <div class="brand" aria-label={$t("brand.name")}>
      <span class="brand-nav-slot">
        {#if selectedCollaboration}<button class="brand-back" aria-label={$t("common.back")} onclick={()=>{selectedCollaboration=null;revealImmersiveChrome();}}><ChevronLeft size={22}/></button>
        {:else if selected}<button class="brand-back" aria-label={$t("common.back")} onclick={()=>{stopLive();discardLive();selected=null;selectedAssistId=null;events=[];liveStatus="History";revealImmersiveChrome();}}><ChevronLeft size={22}/></button>
        {:else if engine==="codex"&&codexDetailOpen}<button class="brand-back" aria-label={$t("session.title")} onclick={()=>{codexRef?.closeDetail();revealImmersiveChrome();}}><ChevronLeft size={22}/></button>
        {:else}<img class="brand-app-icon" src="/icons/favicon.svg" alt="" aria-hidden="true"/>{/if}
      </span>
      <span class="brand-copy"><strong><span class="brand-full">{$t("brand.name")}</span><span class="brand-short">{$t("brand.shortName")}</span></strong><small>{$t("brand.subtitle")}</small></span>
    </div>
    <nav class="primary-nav" class:icon-only={navIconOnly} aria-label={$t("nav.primary")}>
      <button type="button" class:active={overviewOpen} onclick={openOverview} aria-label={$t("nav.home")} title={$t("nav.home")}><House size={17}/><span class="nav-label">{$t("nav.home")}</span></button>
      <button type="button" class:active={collaborationBoardOpen} onclick={()=>openCollaborationBoard()} aria-label={$t("collaborationBoard.title")} title={$t("collaborationBoard.title")}><KanbanSquare size={17}/><span class="nav-label">{$t("collaborationBoard.title")}</span></button>
      <button type="button" class:active={!overviewOpen&&!collaborationBoardOpen&&engine!=="conversation"} onclick={openSessions} aria-label={$t("nav.sessions")} title={$t("nav.sessions")}><SquareTerminal size={17}/><span class="nav-label">{$t("nav.sessions")}</span></button>
      <button type="button" class:active={!overviewOpen&&!collaborationBoardOpen&&engine==="conversation"} onclick={openConversations} aria-label={$t("nav.conversation")} title={$t("nav.conversation")}><MessagesSquare size={17}/><span class="nav-label">{$t("nav.conversation")}</span></button>
    </nav>
    <div class="top-actions">
      <AgentAvatarDock codex={codexRecent} claude={claudeRecent} grok={grokRecent} deepseek={deepseekRecent} ollama={ollamaRecent} antigravity={antigravityRecent} connectedProviders={connectedAvatarProviders} activeByProvider={avatarActive} completedByProvider={avatarCompleted} sessionsLoading={avatarSessionsLoading} sessionsError={avatarSessionsError} onSelect={openRecentSession} onStatusChange={updateAvatarTaskStatus} onOpen={avatarPanelOpen} {showAvatars} {showSpeech} {codexAvatar} {avatarAutoCollapse} {avatarCollapseDelayMs} {avatarTrayShape} statusSuspended={quotaOpen||globalOpen||createOpen} streamSuspendedProviders={collaborationStreamOwners} onCodexAvatarChange={changeCodexAvatar} onAvatarOutfitChange={changeAvatarOutfit} onNoticeAction={handleAvatarNoticeAction} backgroundNotifications={notifications} {vibration} runtimeNotices={runtimeAvatarNotices}/>
      {#if compactTopbar}
        <button type="button" bind:this={overflowTrigger} data-popup-trigger="overflow" class="icon-button" class:active={overflowOpen} aria-label={$t("nav.moreActions")} title={$t("nav.moreActions")} aria-haspopup="menu" aria-expanded={overflowOpen} onclick={toggleOverflow}><EllipsisVertical size={19}/></button>
      {:else}
        {@render topbarUtilities(false)}
      {/if}
      <button class="new-button" aria-label={$t("task.create")} onclick={openCreate}>{#if createOpening}<LoaderCircle class="spin" size={19}/>{:else}<Plus size={19}/>{/if}<span>{$t("task.create")}</span></button>
    </div>
    {#if compactTopbar}
      <div bind:this={overflowMenu} class="topbar-overflow" popover="manual" role="menu" aria-label={$t("nav.moreActions")} style={overflowStyle} use:dismissOnOutside={{onDismiss:closeOverflow,triggerSelector:'[data-popup-trigger="overflow"]'}}>
        {@render topbarUtilities(true)}
      </div>
    {/if}
  </header>
  {#if providerAccountsLoaded&&providerAccounts.filter(item=>item.provider==="codex"||item.provider==="claude").length===2&&providerAccounts.filter(item=>item.provider==="codex"||item.provider==="claude").every(item=>item.state==="disconnected")&&!selected&&!codexDetailOpen}
    <div class="provider-setup-notice"><span><strong>{$t("provider.connectionRequired")}</strong><small>{$t("provider.connectionRequiredBody")}</small></span><button type="button" onclick={openGlobalSettings}>{$t("provider.connectionSettings")}</button></div>
  {/if}
  {#if (claudeCatalogLoading||claudeCatalogRefreshing||isClaudeCatalogFallback(claudeCatalogMeta)||claudeModelTransitions.length)&&!selected&&!selectedCollaboration&&!codexDetailOpen}
    <div class="model-filter-notice" role="status" aria-live="polite">
      {#if claudeCatalogLoading||claudeCatalogRefreshing}<LoaderCircle class="spin" size={18}/>{:else}<CircleAlert size={18}/>{/if}<span><strong>{$t(claudeCatalogLoading||claudeCatalogRefreshing?"model.catalogCheckingTitle":claudeModelTransitions.length?"model.catalogTransitionTitle":"model.catalogDelayTitle")}</strong><small>{$t(claudeCatalogLoading||claudeCatalogRefreshing?"model.catalogCheckingBody":claudeModelTransitions.length?(isClaudeCatalogFallback(claudeCatalogMeta)?"model.catalogTransitionFallbackBody":"model.catalogTransitionBody"):"model.catalogFallbackBody",{models:claudeModelTransitionText()})}</small></span>
      <button type="button" disabled={claudeCatalogLoading||claudeCatalogRefreshing} onclick={refreshClaudeModelCatalog}><RefreshCw size={14} class={claudeCatalogRefreshing?"spin":""}/>{$t(claudeCatalogLoading||claudeCatalogRefreshing?"model.loading":"model.catalogRetry")}</button>
    </div>
  {/if}
  {#if quotaOpen}
    <div class="quota-pop" role="status" use:dismissOnOutside={{onDismiss:()=>quotaOpen=false,triggerSelector:'[data-popup-trigger="quota"]'}}>
      <header><strong>{$t("quota.title")}</strong><span class="quota-actions"><button class="icon-button" aria-label={$t("common.refresh")} title={$t("common.refresh")} disabled={quotaLoading} onclick={()=>void loadQuota(true)}><RefreshCw size={15} class={quotaLoading?"spin":""}/></button></span></header>
      {#if quotaLoading&&!quota}<p class="quota-note">{$t("common.loading")}</p>{/if}
      {#each [["codex","Codex",quota?.codex],["claude","Claude",quota?.claude],["grok","Grok",quota?.grok],["antigravity","Gemini",quota?.antigravity],["deepseek","DeepSeek",quota?.deepseek],["ollama","Ollama Cloud",quota?.ollama]] as [cls,name,q]}
        <section>
          <span class="engine {cls}">{name}</span>{#if q?.plan}<em class="plan">{q.plan}</em>{/if}
          {#if q?.fiveHour}
            <div class="quota-line"><span>{$t("quota.fiveHours")}</span><div class="qbar"><i class={barClass(q.fiveHour.pct)} style={`width:${Math.min(100,q.fiveHour.pct??0)}%`}></i></div><span class="pct">{quotaPct(q.fiveHour.pct)}%</span></div>
            {@const fiveHourReset=fmtReset(q.fiveHour.resetsAt,q.fiveHour.resetLabel)}
            {#if fiveHourReset}<p class="reset">{fiveHourReset}</p>{/if}
          {/if}
          {#if q?.sevenDay}
            <div class="quota-line"><span>{$t("quota.weekly")}</span><div class="qbar"><i class={barClass(q.sevenDay.pct)} style={`width:${Math.min(100,q.sevenDay.pct??0)}%`}></i></div><span class="pct">{quotaPct(q.sevenDay.pct)}%</span></div>
            {@const sevenDayReset=fmtReset(q.sevenDay.resetsAt,q.sevenDay.resetLabel)}
            {#if sevenDayReset}<p class="reset">{sevenDayReset}</p>{/if}
          {/if}
          {#if q?.balance}
            <div class="quota-balance" class:depleted={!q.balance.available}>
              <strong>{$t("quota.balance")}</strong>
              <span>{formatCurrency(q.balance.total,q.balance.currency,$locale)}</span>
              <small>{$t("quota.balanceSplit",{toppedUp:formatCurrency(q.balance.toppedUp,q.balance.currency,$locale),granted:formatCurrency(q.balance.granted,q.balance.currency,$locale)})}</small>
            </div>
            {#if !q.balance.available}<p class="quota-note warn-text">{$t("quota.balanceDepleted")}</p>{/if}
          {/if}
          {#if q?.quotaMode==="vertex-credit"}<p class="quota-note vertex-quota-note"><strong>{$t("antigravityExecution.vertexCreditTitle")}</strong><span>{$t("antigravityExecution.vertexQuotaScope",{project:q.projectId,location:q.location})}</span><small>{$t("antigravityExecution.vertexCreditBody")}</small><a href={q.creditsUrl||`https://console.cloud.google.com/billing?project=${encodeURIComponent(String(q.projectId??""))}`} target="_blank" rel="noopener noreferrer">{$t("antigravityExecution.vertexCreditOpen")}</a></p>
          {:else if q?.limitsAvailable===false}<p class="quota-note">{$t(q?.balance?"quota.prepaidLimits":"quota.accountLimitsUnavailable")}</p>{:else if !quotaLoading && !q?.fiveHour && !q?.sevenDay}<p class="quota-note">{$t("quota.noData")}</p>{/if}
          {#if q?.error === "rate_limited"}<p class="quota-note warn-text">{$t("quota.rateLimited")}</p>
          {:else if q?.error}<p class="quota-note warn-text">{$t("quota.unavailable")} · {$t("quota.retrying")}</p>
          {:else if q?.status === "partial"&&q?.limitsAvailable!==false}<p class="quota-note">{$t("quota.partial")}</p>{/if}
        </section>
      {/each}
      {#if quota?.fetchedAt}<p class="fetched">{formatDateTime(quota.fetchedAt,$locale)}</p>{/if}
    </div>
  {/if}

  {#if searchOpen && !selected && !selectedCollaboration && !codexDetailOpen}
    <div class="searchbar"><Search size={18}/><input value={query} oninput={(event)=>updateSearchQuery(event.currentTarget.value)} placeholder={$t("historySearch.placeholder")} use:focusNode/>{#if query}<button class="icon-button" aria-label={$t("common.clear")} onclick={()=>updateSearchQuery("")}><X size={18}/></button>{/if}</div>
  {/if}

  {#if error}<button class="error-band" onclick={()=>error=""}><CloudOff size={18}/><span>{error}</span><X size={17}/></button>{/if}
  {#if taskSettingsNotice}<button class="settings-save-band" aria-live="polite" onclick={()=>taskSettingsNotice=""}><Check size={18}/><span>{taskSettingsNotice}</span><X size={17}/></button>{/if}

  {#if !selected&&!selectedCollaboration}
    {#if searchOpen&&query.trim()}
      <HistorySearchResults {api} {query} {workspaces} initialProvider={engine==="codex"||engine==="claude"?engine:""} onopen={openHistoryResult}/>
    {:else}
    <section class="browser-shell" class:codex-browser={engine==="codex"&&!codexDetailOpen}>
      <div class="quota-reservation-list" aria-label={$t("quotaReservation.list")}>
        {#each quotaReservations.filter(item=>item.status!=="started"&&item.status!=="cancelled") as item (item.id)}
          {@const reservationQuota=quota?.[item.provider]}
          <article id={`quota-reservation-${item.id}`} class="quota-reservation-card" class:failed={item.status==="failed"} class:focused={reservationFocusId===item.id}>
            <header><span class="engine {item.provider}">{providerDisplayName(item.provider)}</span><strong>{item.title||$t("task.untitled")}</strong><span class="reservation-status">{$t(`quotaReservation.status.${item.status}`)}</span></header>
            <div class="reservation-meta">
              <span>{hosts.find(host=>host.id===item.executionHostId)?.displayName??item.executionHostId}</span>
              <span>{workspaces.find(workspace=>workspace.id===item.workspaceId)?.displayName??item.workspaceId}</span>
              <span>{$t("quotaReservation.nextCheck")}: {formatDateTime(item.nextCheckAt,$locale)}</span>
            </div>
            <div class="reservation-quota">
              <span>{$t("quota.fiveHours")} {quotaPct(reservationQuota?.fiveHour?.pct)}%{#if reservationQuota?.fiveHour?.resetsAt} · {fmtReset(reservationQuota.fiveHour.resetsAt,reservationQuota.fiveHour.resetLabel)}{/if}</span>
              <span>{$t("quota.weekly")} {quotaPct(reservationQuota?.sevenDay?.pct)}%</span>
              <span>{$t("quotaReservation.lastCheck")}: {item.lastQuotaCheckAt?formatDateTime(item.lastQuotaCheckAt,$locale):$t("common.unavailable")} · {item.lastQuotaStatus??$t("common.unknown")}</span>
            </div>
            {#if item.error}<p>{item.error}</p>{/if}
            {#if item.status==="waiting-quota"}<footer><button type="button" disabled={reservationBusy===item.id} onclick={()=>startQuotaReservationNow(item)}>{$t("quotaReservation.startNow")}</button><button type="button" disabled={reservationBusy===item.id} onclick={()=>cancelQuotaReservation(item)}>{$t("quotaReservation.cancel")}</button></footer>{/if}
            {#if item.status==="failed"}<footer><button type="button" disabled={reservationBusy===item.id} onclick={()=>retryQuotaReservation(item)}>{$t("quotaReservation.retry")}</button></footer>{/if}
          </article>
        {/each}
      </div>
    {#if collaborationBoardOpen}
      <CollaborationBoardPage {api} {workspaces} executionConfig={collaborationBoardExecutionConfig()} sessionCandidates={collaborationBoardSessionCandidates()} initialCardId={collaborationBoardInitialCardId} onclose={openOverview} oncardschange={(ids)=>collaborationBoardCardIds=new Set(ids)} onaction={()=>refreshTaskSnapshot("App.collaborationBoardAction")} onopensession={(kind,id)=>kind==="task"?tasks.find(task=>task.id===id)&&openTask(tasks.find(task=>task.id===id)!):openCollaboration(id)}/>
    {:else if overviewOpen}
      {@const overviewTasks=tasks.filter(task=>sessionMatchesConversationScope(task,"regular",tasks,sessionClassificationContext))}
      {@const overviewActive=latestThreadRows(overviewTasks).filter(task=>active.has(task.status))}
      {@const overviewCompleted=latestThreadRows(overviewTasks).filter(task=>task.status==="completed").slice(0,3)}
      <main class="overview-page">
        <div class="overview-grid">
          <div class="overview-main">
          <section class="overview-panel overview-active" class:overview-active-empty={!overviewActive.length}>
            <header><div><span class="overview-kicker">{$t("overview.active")}</span><h2>{$t("overview.activeTitle")}</h2></div><span class="overview-count">{$t("overview.activeCount",{count:overviewActive.length})}</span></header>
            {#if overviewActive.length}
              <div class="overview-task-stack">
                {#each overviewActive as task}
                  <TaskLivenessPanel {task} {api} density={overviewActive.length===1?"full":overviewActive.length===2?"medium":(overviewExpandedTaskId??overviewActive[0]?.id)===task.id?"full":"compact"} hostName={hostName(task.executionHostId)} workspaceName={workspaces.find(item=>item.id===task.workspaceId)?.displayName??projectLabel(task)} onopen={()=>openTask(task)} onexpand={()=>overviewExpandedTaskId=task.id}/>
                {/each}
              </div>
            {:else}
              <div class="overview-empty"><Check size={22}/><strong>{$t("overview.noActive")}</strong><span>{$t("overview.noActiveBody")}</span></div>
            {/if}
          </section>
          <CollaborationBoardPanel {api} {workspaces} executionConfig={collaborationBoardExecutionConfig()} onopen={openCollaborationBoard} onopenall={()=>openCollaborationBoard()}/>
          </div>
          <aside class="overview-side">
            <section class="overview-panel overview-workers">
              <header><div><h2>{$t("overview.workers")}</h2></div><span class="overview-muted">{$t("overview.justUpdated")}</span></header>
              <div class="overview-worker-list">
                {#each hosts as host}
                  {@const hostActiveCount=latestThreadRows(tasks).filter(task=>active.has(task.status)&&(task.executionHostId??"local")===host.id).length}
                  {@const hostProviders=[...new Set(latestThreadRows(tasks).filter(task=>(task.executionHostId??"local")===host.id).map(task=>providerDisplayName(task.provider)))]}
                  <div class:worker-offline={host.status!=="online"&&host.status!=="connected"}><span><strong><i class:online={host.status==="online"||host.status==="connected"}></i>{host.displayName}</strong><small>{$t("overview.heartbeat",{time:host.lastSeenAt?ago(host.lastSeenAt):$t("common.unknown")})}</small><small>{hostActiveCount?$t("overview.hostActive",{count:hostActiveCount}):$t("overview.hostIdle")}{#if hostProviders.length} · {hostProviders.join(" · ")}{/if}</small></span>{#if host.status!=="online"&&host.status!=="connected"}<button type="button" onclick={openOverviewWorker}>{$t("overview.diagnoseHost")}</button>{/if}</div>
                {:else}
                  <p class="overview-side-empty">{$t("overview.noWorkers")}</p>
                {/each}
              </div>
            </section>
            <section class="overview-panel overview-recent">
              <header><div><h2>{$t("overview.recent")}</h2></div><button type="button" onclick={openSessions}>{$t("overview.allSessions")} ›</button></header>
              <div class="overview-recent-list">
                {#each overviewCompleted as task}
                  <button type="button" onclick={()=>openTask(task)}><span><Check size={15}/></span><strong>{task.title||$t("task.untitled")}</strong><small>{ago(task.updatedAt)}</small></button>
                {:else}
                  <p class="overview-side-empty">{$t("overview.noRecent")}</p>
                {/each}
              </div>
            </section>
            <section class="overview-panel overview-quick">
              <header><div><h2>{$t("overview.quickCreate")}</h2></div></header>
              <div class="overview-quick-grid">
                {#if providerConnectionPhase==="none"}
                  <button type="button" onclick={openProviderConnections}><strong>{$t("provider.noneConnected")}</strong><small>{$t("provider.noneConnectedBody")}</small></button>
                {/if}
                {#if providerConnected(providerConnections,"codex")}<button type="button" onclick={()=>openOverviewCreate("codex")}><strong>{$t("overview.newCodex")}</strong><small>{$t("overview.newCodexBody")}</small></button>{/if}
                {#if providerConnected(providerConnections,"claude")}<button type="button" onclick={()=>openOverviewCreate("claude")}><strong>{$t("overview.newClaude")}</strong><small>{$t("overview.newClaudeBody")}</small></button>{/if}
                {#if creatableProviders.length}<button type="button" onclick={()=>openCollaborationBoard()}><strong>{$t("collaborationBoard.newCard")}</strong><small>{$t("collaborationBoard.quickCreateBody")}</small></button>{/if}
                {#if creatableProviders.length>1}<button type="button" onclick={openOverviewReview}><strong>{$t("overview.startReview")}</strong><small>{$t("overview.startReviewBody")}</small></button>{/if}
                <button type="button" onclick={openOverviewWorker}><strong>{$t("overview.connectWorker")}</strong><small>{$t("overview.connectWorkerBody")}</small></button>
              </div>
            </section>
          </aside>
        </div>
      </main>
    {:else}
    {#if engine!=="codex"||!codexDetailOpen}
    <div class="filterbar">
      {#if engine!=="conversation"}
      <nav class="filters" aria-label={$t("session.engineFilter")}>
        {#each [["all",$t("nav.all")],["collaboration-work",$t("nav.collaborationWork")],["conversation-linked",$t("nav.linkedSessions")],["codex","Codex"],["claude","Claude"],["grok","Grok"],["antigravity","Gemini"],["deepseek","DeepSeek"],["ollama","Ollama"]] as item}
          <button class:active={engine===item[0]} onclick={()=>selectEngine(item[0] as typeof engine)}>{item[1]}</button>
        {/each}
      </nav>
      {/if}
      <nav class="filters sub" aria-label={$t("session.statusFilter")}>
        {#each [["",$t("common.all")],["active",$t("task.status.running")],["waiting",$t("task.status.waiting")],["done",$t("task.status.completed")],["failed",$t("task.status.failed")]] as item}
          <button class:active={statusSelected(item[0] as typeof statusFilter)} onclick={()=>selectStatus(item[0] as typeof statusFilter)}>{item[1]}</button>
        {/each}
      </nav>
      {#if engine==="codex"}
      <div class="session-select-filters" role="region" aria-label={$t("session.filters")}>
        <label>{$t("session.project")}<select bind:value={codexProjectFilter}><option value="">{$t("common.all")}</option>{#each projects as item}<option value={item.id}>{item.name}</option>{/each}</select></label>
        <label>{$t("session.source")}<select bind:value={codexSourceFilter}><option value="">{$t("common.all")}</option><option value="claudex-workhouse">Claudex Workhouse</option><option value="cx">cx</option><option value="cli">CLI</option><option value="vscode">VS Code</option><option value="appServer">app-server</option></select></label>
        <label>{$t("session.owner")}<select bind:value={codexOwnershipFilter}><option value="">{$t("common.all")}</option><option value="claudex-workhouse">Claudex Workhouse</option><option value="external-cx">{$t("session.ownership.externalCx")}</option><option value="external">{$t("session.ownership.externalCodex")}</option><option value="unknown">{$t("common.unknown")}</option></select></label>
        <label>{$t("session.model")}<select bind:value={codexModelFilter}><option value="">{$t("common.all")}</option>{#each availableCodexModels() as item}<option value={item.id}>{modelLabel(item)}</option>{/each}</select></label>
      </div>
      {:else if engine!=="conversation"&&engine!=="collaboration-work"}
      <div class="session-select-filters" aria-label={$t("session.filters")}>
        <label>{$t("session.host")}<select bind:value={hostFilter}><option value="">{$t("common.all")}</option>{#each hosts as item}<option value={item.id}>{modelLabel(item)}</option>{/each}</select></label>
        <label>{$t("session.workspace")}<select bind:value={workspaceFilter}><option value="">{$t("common.all")}</option>{#each workspaces.filter(item=>!hostFilter||item.hostId===hostFilter) as item}<option value={item.id}>{modelLabel(item)}</option>{/each}</select></label>
        <label>{$t("session.owner")}<select bind:value={ownershipFilter}><option value="">{$t("common.all")}</option><option value="claudex-workhouse">Claudex Workhouse</option><option value="external">{$t("session.ownership.external")}</option><option value="external-cx">{$t("session.ownership.externalCx")}</option><option value="unknown">{$t("common.unknown")}</option></select></label>
        <label>{$t("session.source")}<select bind:value={sourceFilter}><option value="">{$t("common.all")}</option>{#each [...new Set(tasks.map(item=>item.source??"unknown"))] as value}<option {value}>{value}</option>{/each}</select></label>
        <label>{$t("session.workChain")}<select bind:value={chainFilter}><option value="">{$t("common.all")}</option>{#each [...new Set(tasks.map(item=>item.workChainId).filter((value):value is string=>Boolean(value)))] as value}<option {value}>{value.slice(0,8)}…</option>{/each}</select></label>
      </div>
      {/if}
    </div>
    {/if}
    {#if codexMounted}<div class="codex-session-pane" hidden={engine!=="codex"}><CodexSessions active={engine==="codex"} {api} bind:this={codexRef} bind:status={codexStatus} bind:projectId={codexProjectFilter} bind:source={codexSourceFilter} bind:ownership={codexOwnershipFilter} bind:model={codexModelFilter} sessionScope="regular" classificationContext={sessionClassificationContext} {taskState} {query} {enterToSend} {scrollAutoSwitch} {projects} {workspaces} {hosts} modelOptions={availableCodexModels()} providerQuota={quota?.codex??null} {codexAvatar} onDetail={(o)=>codexDetailOpen=o} onRecentStatus={(recent)=>codexSessionRecent=recent} onOpenTask={(task)=>openTask(task)} onOpenFile={openConversationFile}/></div>{/if}
    {#if engine!=="codex"}<main class="task-list session-browser-list">
      {#if engine==="conversation"||engine==="collaboration-work"}
      <div class="bulk-session-toolbar" class:active={conversationBulkMode}>
        {#if conversationBulkMode}
          {@const selectableOnPage=conversationPageSessions().filter(canBulkDeleteConversation)}
          {@const pageFullySelected=selectableOnPage.length>0&&selectableOnPage.every(item=>conversationBulkSelected.has(item.id))}
          <span>{$t("bulk.selected",{count:conversationBulkSelected.size})}</span>
          <button onclick={toggleConversationPageBulk} disabled={!selectableOnPage.length}>{$t(pageFullySelected?"bulk.unselectPage":"bulk.selectPage")}</button>
          <button onclick={exitConversationBulkMode}>{$t("common.cancel")}</button>
          <button class="destructive" onclick={openConversationBulkDelete} disabled={!conversationBulkSelected.size}><Trash2 size={16}/>{$t("common.delete")}</button>
        {:else}
          <span>{$t("bulk.description")}</span>
          {#if engine==="conversation"}<button aria-expanded={conversationDocumentsOpen} onclick={()=>conversationDocumentsOpen=!conversationDocumentsOpen} disabled={!conversationDocuments.length}><FileText size={16}/>{$t("conclusion.manage",{count:conversationDocuments.length})}</button>{/if}
          <button onclick={startConversationBulkMode} disabled={!(engine==="conversation"?visibleCollaborations(true):visibleWorkCollaborations()).some(canBulkDeleteConversation)}><Trash2 size={16}/>{$t("bulk.deleteMultiple")}</button>
        {/if}
      </div>
      {#if engine==="conversation"&&conversationDocumentsOpen}<ConversationDocumentManager documents={conversationDocuments} deletingId={conversationDocumentDeleting} onopen={openManagedConversationDocument} ondelete={deleteManagedConversationDocument} onclose={()=>conversationDocumentsOpen=false}/>{/if}
      {:else}
      <div class="bulk-session-toolbar" class:active={taskBulkMode}>
        {#if taskBulkMode}
          {@const selectableOnPage=taskPageSessions().filter(canBulkDeleteTask)}
          {@const pageFullySelected=selectableOnPage.length>0&&selectableOnPage.every(task=>taskBulkSelected.has(taskSessionKey(task)))}
          <span>{$t("bulk.selected",{count:taskBulkSelected.size})}</span>
          <button onclick={toggleTaskPageBulk} disabled={!selectableOnPage.length}>{$t(pageFullySelected?"bulk.unselectPage":"bulk.selectPage")}</button>
          <button onclick={exitTaskBulkMode}>{$t("common.cancel")}</button>
          <button class="destructive" onclick={openTaskBulkDelete} disabled={!taskBulkSelected.size}><Trash2 size={16}/>{$t("common.delete")}</button>
        {:else}
          <span>{$t("bulk.description")}</span>
          <button onclick={startTaskBulkMode} disabled={!grouped().some(canBulkDeleteTask)}><Trash2 size={16}/>{$t("bulk.deleteMultiple")}</button>
        {/if}
      </div>
      {/if}
      {#if loading && !browserRows.length}<div class="empty"><RefreshCw class="spin" size={24}/><p>{$t("task.loading")}</p></div>
      {:else if !browserRows.length}<div class="empty"><Bot size={28}/><p>{engine==="conversation"?$t("task.emptyConversation"):engine==="collaboration-work"?$t("task.emptyCollaborationWork"):engine==="conversation-linked"?$t("task.emptyLinked"):$t("task.emptyVisible")}</p></div>
      {:else}
        {@const list = browserRows}
        {@const pageCount = Math.max(1, Math.ceil(list.length / PAGE_SIZE))}
        {@const cur = Math.min(page, pageCount)}
        {@const pageEntries = list.slice((cur-1)*PAGE_SIZE, cur*PAGE_SIZE)}
        <WorkspaceGitOverview items={gitOverviewForAllSessions()}/>
        {#each pageEntries as entry (`${entry.kind}:${entry.id}`)}
          {#if entry.kind==="collaboration"}
            {@const item=entry.collaboration}
            {@const bulkEligible=canBulkDeleteConversation(item)}
            {@const bulkChecked=conversationBulkSelected.has(item.id)}
            <button class="task-card session-card collaboration-card" class:failed={item.status==="failed"} class:bulk-selected={conversationBulkMode&&bulkChecked} class:bulk-unavailable={taskBulkMode||conversationBulkMode&&!bulkEligible} disabled={taskBulkMode||conversationBulkMode&&!bulkEligible} aria-pressed={conversationBulkMode?bulkChecked:undefined} title={conversationBulkMode&&!bulkEligible?$t("bulk.cannotDeleteRunningConversation"):undefined} onclick={()=>conversationBulkMode?toggleConversationBulk(item):openCollaboration(item.id)}>
              {#if conversationBulkMode}<span class="bulk-check" class:checked={bulkChecked} aria-hidden="true">{#if bulkChecked}<Check size={17}/>{/if}</span>{:else}<span class="status-mark s-{item.status}">{#if item.status==="completed"}<Check size={17}/>{:else if item.status==="partial"||item.status==="failed"}<CircleAlert size={17}/>{:else}<Activity size={17}/>{/if}</span>{/if}
              <span class="task-copy">
                <strong>{item.title}</strong>
                <span class="meta"><span class="collab-badge">{collaborationModeLabel(item)}</span><span>{$t("collaboration.participantCount",{count:Array.isArray(item.metadata?.enabledProviders)?item.metadata.enabledProviders.length:2})}</span><span>{item.currentStep}</span><span>{$t(`collaboration.${item.status}`)}</span>{#if conversationBulkMode&&!bulkEligible}<span class="bulk-disabled-reason">{$t("bulk.runningUnavailable")}</span>{/if}<span>{ago(item.updatedAt)}</span></span>
                <span class="preview">{collaborationPreview(item)} · {$t("collaboration.deleteLinkedWarning")}</span>
              </span>
            </button>
          {:else}
          {@const task=entry.task}
          {@const Icon=statusIcon(task.status)}
          {@const bulkEligible=canBulkDeleteTask(task)}
          {@const bulkChecked=taskBulkSelected.has(taskSessionKey(task))}
          {@const searchMatch=taskSearchMatches.get(task.id)}
          <button class="task-card session-card" class:terminal-task={!active.has(task.status)} class:active-task={active.has(task.status)} class:failed={task.status==="failed"} class:bulk-selected={taskBulkMode&&bulkChecked} class:bulk-unavailable={taskBulkMode&&!bulkEligible} disabled={taskBulkMode&&!bulkEligible} aria-pressed={taskBulkMode?bulkChecked:undefined} title={taskBulkMode&&!bulkEligible?taskDeleteUnavailableLabel(task):undefined} onclick={()=>taskBulkMode?toggleTaskBulk(task):openTask(task)}>
            {#if taskBulkMode}<span class="bulk-check" class:checked={bulkChecked} aria-hidden="true">{#if bulkChecked}<Check size={17}/>{/if}</span>{:else}<span class="status-mark s-{task.status}"><Icon size={17}/></span>{/if}
            <span class="task-copy">
              <strong>{task.title||$t("task.untitled")}</strong>
              <span class="meta">
                <span class="engine {task.provider}">{providerDisplayName(task.provider)}</span>
                <SessionModelBadges provider={task.provider} modelLabel={task.provider==="claude"?claudeModelName(task.requestedModel):(task.requestedModel??$t("model.default"))} effort={task.requestedReasoningEffort} serviceTier={task.requestedServiceTier}/>
                {#if task.metadata?.collaborationParticipantId}<span class="assist-badge">{$t("collaboration.linked")}</span>{/if}
                {#if fanoutSummary(task)}{@const fanout=fanoutSummary(task)!}<span class="fanout-badge" class:waiting={fanout.waiting>0}><span class="fanout-pips" aria-hidden="true">{#each Array(Math.min(fanout.total,6)) as _pip, pip}<i class:on={pip<fanout.running+fanout.waiting}></i>{/each}</span>{$t(fanout.waiting?"fanout.badgeWaiting":"fanout.badge",{running:fanout.running+fanout.waiting,total:fanout.total,waiting:fanout.waiting})}</span>{/if}
                {#if collaborations.some(item=>item.mode==="assist"&&item.sourceTaskId===task.id)}<span class="assist-badge">{$t(task.provider==="codex"?"assist.reviewOnce":"assist.opinionOnce",{name:providerNickname(task.provider==="codex"?"claude":"codex")})}</span>{/if}
                <span class="host-badge">{hostName(task.executionHostId)}</span>
                <span>{projectLabel(task)}</span>
                {#if !active.has(task.status)}<span>{labels[task.status]}</span>{/if}
                {#if turnCount(task)>1}<span>{$t("conversation.turnCount",{count:turnCount(task)})}</span>{/if}
                {#if taskBulkMode&&!bulkEligible}<span class="bulk-disabled-reason">{taskDeleteUnavailableLabel(task)}</span>{/if}
                <span>{ago(task.updatedAt)}</span>
              </span>
              <span class="preview" class:search-hit-card={Boolean(taskSearchQuery&&searchMatch)}>
                {#if taskSearchQuery&&searchMatch}
                  <span class="search-hit-label">{searchMatchLabel(searchMatch)}</span>
                  <span class="search-hit-text">{searchMatch.leading?"…":""}{searchMatch.before}{searchMatch.before?" ":""}<mark>{searchMatch.match}</mark>{searchMatch.after?" ":""}{searchMatch.after}{searchMatch.trailing?"…":""}</span>
                {:else}
                  {task.preview||task.result||task.error||task.log?.split("\n").filter(Boolean).at(-1)||task.prompt||$t("task.waitingOutput")}
                {/if}
              </span>
              <SessionActivityStrip provider={task.provider} taskId={task.id} status={task.status} updatedAt={task.updatedAt} startedAt={task.createdAt??null} activity={task.metadata?.activity??labels[task.status]} workerOnline={workerOnline(task.executionHostId)} streamEnabled={task.owned&&(!task.ownership||task.ownership==="claudex-workhouse")}/>
            </span>
          </button>
          {/if}
        {/each}
        {#if pageCount > 1}
          {@const blk = pageBlock(cur, pageCount)}
          <nav class="pager" aria-label={$t("pagination.label")}>
            {#if blk.hasPrev}<button aria-label={$t("pagination.previousBlock")} onclick={()=>page=blk.pages[0]-1}>‹</button>{/if}
            {#each blk.pages as p}<button class:cur={p===cur} onclick={()=>page=p}>{p}</button>{/each}
            {#if blk.hasNext}<button aria-label={$t("pagination.nextBlock")} onclick={()=>page=blk.pages[blk.pages.length-1]+1}>›</button>{/if}
          </nav>
        {/if}
      {/if}
    </main>{/if}
    {/if}
    </section>
    {/if}
  {:else if selectedCollaboration}
    <main class="detail collaboration-detail"><CollaborationTimeline collaborationId={selectedCollaboration} {api} {codexAvatar} quotaByProvider={quota} {enterToSend} onproviderstatus={(statuses)=>collaborationRecent=statuses} onopen={(task)=>openTask(task)} onopenfile={openConversationFile}/></main>
  {:else}
    {#if selected}
    <main class="detail">
      <div class="detail-main">
      <section class="task-heading" class:collapsed={headingCollapsed} inert={chromeHidden} use:chromeCollapse>
        <div class="task-heading-top"><SessionBadges provider={selected.provider} status={selected.status} liveMode={liveStatus} ownership={selected.ownership}/>{#if headingCollapsed}<strong class="collapsed-title">{selected.title}</strong>{/if}<button class="heading-toggle" aria-label={$t(headingCollapsed?"session.expandTitle":"session.collapseTitle")} title={$t(headingCollapsed?"session.expandTitle":"session.collapseTitle")} onclick={()=>headingCollapsed=!headingCollapsed}>{#if headingCollapsed}<ChevronDown size={18}/>{:else}<ChevronUp size={18}/>{/if}</button></div>
        {#if !headingCollapsed}<div class="heading-expanded">{#if renameEditing}<div class="session-title-editor"><input bind:value={renameTitle} aria-label={$t("session.rename")} maxlength="100" onkeydown={renameKeydown} use:focusNode/><button type="button" class="save" aria-label={$t("common.save")} title={$t("common.save")} disabled={!renameTitle.trim()||renameSaving} onclick={saveRename}>{#if renameSaving}<LoaderCircle class="spin" size={17}/>{:else}<Check size={17}/>{/if}</button><button type="button" aria-label={$t("common.cancel")} title={$t("common.cancel")} disabled={renameSaving} onclick={cancelRename}><X size={17}/></button></div>{:else}<div class="session-title-row"><h1>{selected.title}</h1><button type="button" class="session-title-edit" aria-label={$t("session.rename")} title={$t("session.rename")} onclick={beginRename}><Pencil size={15}/></button></div>{/if}
        <p>{hostName(selected.executionHostId)} · {projectLabel(selected)}{#if executionBackendLabel(selected.metadata)} · {executionBackendLabel(selected.metadata)}{/if} · {ago(selected.updatedAt)}</p>
        <div class="id-row"><button onclick={()=>copySelected("task")} title={$t("task.copyId")}><span>{$t("task.label")}</span><code>{shortId(selected.nativeId)}</code><Clipboard size={15}/></button><button onclick={()=>copySelected("thread")} title={$t("session.copyThreadId")}><span>{$t("session.thread")}</span><code>{shortId(selected.threadId)}</code><Clipboard size={15}/></button></div></div>{/if}
        <ContextMeter provider={selected.provider} usage={contextUsage} canCompact={Boolean(selected.owned&&selected.threadId)} busy={active.has(selected.status)} compacting={contextRequestBusy||Boolean(selected.metadata?.operation==="context_compaction"&&active.has(selected.status))} oncompact={compactContext}/>
      </section>
      <!-- Board membership is an action, not news: promoting a session or opening
           its card lives in the session controls below. Only an inbound handoff
           still earns a banner, because its origin is not reachable elsewhere. -->
      {#if selected.sourceSessionId}<div class="handoff-banner"><span><strong>{$t("handoff.received")}</strong><small>{$t("handoff.sourceSession",{id:shortId(selected.sourceSessionId)})}</small></span><button type="button" onclick={()=>openChainSession(selected!.sourceSessionId!)}>{$t("handoff.openSource")}</button></div>{/if}
      <ApprovalPanel {api} task={selected}/>
      <UserInputPanel {api} task={selected}/>
      <TaskRecoveryCard {api} task={selected} onstarted={recoveredTaskStarted}/>
      {#if taskNeedsProviderAuth(selected)}
        <div class="session-auth-recovery">
          <div><strong>{$t("auth.sessionInterruptedTitle")}</strong><small>{$t("auth.sessionInterruptedBody")}</small></div>
          {@render inlineProviderAuth(selected.provider as ConnectionAuthProvider,"session")}
          {#if isConnectionAuthProvider(selected.provider)&&providerAccounts.find(item=>item.provider===selected!.provider)?.state==="connected"&&!isActiveAuthAttempt(authAttempts[selected.provider])}<button type="button" class="primary" onclick={()=>retryTaskAfterAuth(selected!)}>{$t("auth.retryOriginalTask")}</button>{/if}
        </div>
      {/if}
      {#if !followupStarting}<TaskOutcomeSummary {api} task={selected} events={visibleConversationEvents} mobileCollapsible={canContinue()&&selected.owned} mobileExpanded={outcomeMobileExpanded} mobileDismissed={outcomeMobileDismissed} hideOnWide onclose={()=>{outcomeMobileExpanded=false;outcomeMobileDismissed=true;}}/>{/if}
      {#key selected.threadId??selected.id}<Conversation provider={selected.provider} events={visibleConversationEvents} request={selected.prompt} requestTimestamp={selected.createdAt} responseTimestamp={selected.updatedAt} busy={followupStarting||active.has(selected.status) && liveStatus!=="History"} liveMode={followupStarting?"Delayed":liveStatus} rootThreadId={selected.provider==="codex"?selected.threadId??null:null} providerQuota={quota?.[selected.provider]??null} persistedOutputUsage={selected.metadata?.outputUsage} {scrollAutoSwitch} onScrollDirection={handleConversationScroll} onRevealChrome={revealChrome} onScrollActivity={handleScrollActivity} runningHistoryVisible={Boolean(selected.provider==="claude"&&active.has(selected.status)&&selected.threadId)} runningHistoryExpanded={showRunningHistory} ontogglerunninghistory={()=>setShowRunningHistory(!showRunningHistory)} {transcriptTruncated} {transcriptHistoryLoading} transcriptCanLoadMore={transcriptTurns<24} onloadtranscripthistory={loadEarlierTranscript} workspaceId={selected.workspaceId??null} workspacePath={conversationWorkspacePath(selected)} executionHostId={selected.executionHostId??"local"} workspaceTargets={workspaces} sourceTaskId={selected.id} onopenfile={openConversationFile}/>{/key}
      {#if selectedAssistId}<CollaborationTimeline collaborationId={selectedAssistId} {api} {codexAvatar} quotaByProvider={quota} {enterToSend} embedded onopen={(task)=>openTask(task)} onclose={()=>selectedAssistId=null}/>{/if}
      <div class="bottom-chrome-drawer" inert={bottomChromeHidden} use:chromeSlide>
      <div bind:this={sessionMenu} class="session-actions-sheet" popover="manual" role="menu" aria-label={$t("nav.moreActions")} style={sessionMenuStyle} use:dismissOnOutside={{onDismiss:closeSessionMenu,triggerSelector:'[data-popup-trigger="session-actions"]'}}>
        {#if canContinue()}<button title={$t("session.fork")} onclick={()=>runAndCloseSessionMenu(()=>action("fork"))} disabled={sending}><GitBranch size={19}/><span>{$t("session.fork")}</span></button>{/if}
        {#if selected.owned}<button title={$t("handoff.newSessionTitle")} onclick={()=>runAndCloseSessionMenu(()=>handoffOpen=true)} disabled={sending}><ArrowRightLeft size={19}/><span>{$t("handoff.title")}</span></button>{/if}
        {#if selected.owned}<button title={$t(!selected.workspaceId?"assist.noWorkspace":active.has(selected.status)?"assist.otherRunningTitle":"assist.otherTitle")} onclick={()=>runAndCloseSessionMenu(openAssist)} disabled={sending||!selected.workspaceId}><Bot size={18}/><span>{$t("assist.chooseReviewer")}</span></button>{/if}
        {#if selected.workChainId}<button title={$t("handoff.workChain")} onclick={()=>runAndCloseSessionMenu(()=>chainOpen=!chainOpen)}><Link2 size={18}/><span>{$t("handoff.workChain")}</span></button>{/if}
        <button title={$t(selected.workChainId?"collaborationBoard.openLinkedCard":"collaborationBoard.promoteBody")} onclick={()=>runAndCloseSessionMenu(openOrPromoteSelectedBoard)} disabled={sending}><KanbanSquare size={18}/><span>{$t(selected.workChainId?"collaborationBoard.openLinkedCard":"collaborationBoard.addToBoard")}</span></button>
        {#if selected.status==="completed"&&selected.workspaceId}<button title={$t("pr.title")} onclick={()=>runAndCloseSessionMenu(()=>pullRequestOpen=true)} disabled={sending}><GitPullRequest size={18}/><span>{$t("pr.action")}</span></button>{/if}
      </div>
      {#if chainOpen&&selected.workChainId}<WorkChainTimeline {api} chainId={selected.workChainId} onopen={openChainSession}/>{/if}
      {#if selected.owned&&selected.threadId}<MessageQueue bind:this={messageQueueRef} {api} provider={selected.provider} taskId={selected.id} threadId={selected.threadId} active={active.has(selected.status)} onstarted={queuedTaskStarted}/>{/if}
      {#if canContinue()&&selected.owned}
        <form class="composer with-attach" inert={bottomChromeHidden} onsubmit={(event)=>{event.preventDefault();sendFollowup()}}>
          <div class="chat-settings-bar">
            <div class="chat-settings-scroll">
            {#if canEditSettings()}
              <WorkModeChips provider={selected.provider} value={workModeOf(selected.provider,selected.permissionProfile,selected.metadata)} disabled={sending} onchange={quickSetWorkMode}/>
              <AutomationLevelChips provider={selected.provider} value={automationLevelOf(selected.permissionProfile,selected.metadata)} disabled={sending} onchange={quickSetAutomation}/>
              <button type="button" class="setting-summary tap" onclick={openTaskSettings} title={$t("session.changeModelPermission")} aria-label={$t("session.modelPermissionSettings")}>
                <Settings size={16}/>
                <span>{selected.provider==="claude"?claudeModelName(selected.requestedModel):(selected.requestedModel??$t("model.default"))}</span>
                {#if selected.provider==="codex"}<span>{effortLabel(selected.requestedReasoningEffort??"medium")}</span><span>{selected.requestedServiceTier==="priority"?"Fast":"Standard"}</span>{:else if selected.requestedReasoningEffort}<span>{effortLabel(selected.requestedReasoningEffort)}</span>{/if}
                {#if selected.provider==="antigravity"&&selected.metadata?.modelBackend==="vertex-api"}<span>{$t(`vertexSearch.${vertexGoogleSearchMode(selected.metadata?.googleSearchMode)}`)}</span>{/if}
                <span>{automationLevelLabel(automationLevelOf(selected.permissionProfile,selected.metadata))}</span>
              </button>
            {/if}
            </div>
            <button type="button" class="mobile-controls-toggle" data-popup-trigger="session-actions" bind:this={sessionMenuTrigger} aria-haspopup="menu" aria-expanded={sessionMenuOpen} aria-label={$t("nav.moreActions")} title={$t("nav.moreActions")} onclick={toggleSessionMenu}><EllipsisVertical size={15}/></button>
          </div>
          <AttachBar bind:this={msgAttachRef} bind:attachments={msgAttachments} disabled={sending}/>
          <div class="composer-input" class:with-outcome={!followupStarting&&!outcomeMobileDismissed&&["completed","failed"].includes(selected.status)&&hasTaskOutcomeDetails(taskOutcomeSummary(selected,visibleConversationEvents))}>
            <textarea bind:value={followup} placeholder={$t(active.has(selected.status)?"conversation.followupQueuedPlaceholder":"conversation.followupPlaceholder")} rows="1" maxlength="20000" onkeydown={submitFollowupKey} onpaste={(event)=>void msgAttachRef?.handlePaste(event)}></textarea>
            {#if !followupStarting&&!outcomeMobileDismissed&&["completed","failed"].includes(selected.status)&&hasTaskOutcomeDetails(taskOutcomeSummary(selected,visibleConversationEvents))}
              <button type="button" class="outcome-badge" class:failed={selected.status==="failed"} aria-expanded={outcomeMobileExpanded} aria-controls="mobile-task-outcome" aria-label={$t(outcomeMobileExpanded?"outcome.hide":"outcome.show")} title={$t(outcomeMobileExpanded?"outcome.hide":"outcome.show")} onclick={()=>{if(outcomeMobileExpanded){outcomeMobileExpanded=false;outcomeMobileDismissed=true;}else outcomeMobileExpanded=true;}}>
                {#if selected.status==="failed"}<CircleAlert size={14}/>{:else}<FileText size={14}/>{/if}
                <span>{$t(selected.status==="failed"?"outcome.badgeFailed":"outcome.badgeSummary")}</span>
                {#if outcomeMobileExpanded}<ChevronDown size={13}/>{:else}<ChevronUp size={13}/>{/if}
              </button>
            {/if}
          </div>
          {#if active.has(selected.status)&&selected.owned&&!followup.trim()&&!msgAttachments.length}
            <button type="button" class="send stop" aria-label={$t("common.stop")} title={$t("common.stop")} onclick={()=>confirm($t("task.stopOnlyConfirm"))&&action("stop")} disabled={sending}><Square size={19}/></button>
          {:else}
            <button class="send" aria-label={$t(active.has(selected.status)?"conversation.queueSend":"common.send")} title={$t(active.has(selected.status)?"conversation.queueSend":"common.send")} disabled={(!followup.trim()&&!msgAttachments.length)||sending}><Send size={20}/></button>
          {/if}
        </form>
      {:else if selected.threadId}
        <div class="external-control-card"><span><strong>{$t(selected.metadata?.controlState==="follow"?"session.following":"session.history")}</strong><small>{$t("session.externalOwnershipNoTakeover")}</small></span><div><button type="button" onclick={toggleFollow}>{$t(selected.metadata?.controlState==="follow"?"session.stopFollowing":"session.followSafely")}</button><button type="button" class="primary" disabled={!terminal.has(selected.status)} onclick={takeControl}>{$t("session.takeControl")}</button></div>{#if !terminal.has(selected.status)}<small>{$t("session.takeControlAfterExit")}</small>{/if}</div>
      {/if}
      </div>
      </div>
      <aside class="session-side-rail" aria-label={$t("session.current")}>
        <section>
          <h2>{$t("session.current")}</h2>
          <dl>
            <div><dt>{$t("session.provider")}</dt><dd>{providerDisplayName(selected.provider)}</dd></div>
            <div><dt>{$t("common.status")}</dt><dd class="state-text s-{selected.status}">{labels[selected.status]}</dd></div>
            <div><dt>{$t("workspace.label")}</dt><dd>{projectLabel(selected)}</dd></div>
            <div><dt>{$t("conversation.lastEvent",{time:""})}</dt><dd>{ago(selected.updatedAt)}</dd></div>
            <div><dt>{$t("session.worker")}</dt><dd>{["online","connected"].includes(hosts.find(host=>host.id===(selected!.executionHostId??"local"))?.status??"")?$t("common.normal"):$t("common.unknown")}</dd></div>
          </dl>
        </section>
        {#if !followupStarting&&["completed","failed"].includes(selected.status)&&hasTaskOutcomeDetails(taskOutcomeSummary(selected,visibleConversationEvents))}<TaskOutcomeSummary {api} task={selected} events={visibleConversationEvents} rail/>{/if}
        {#if followupStarting||!["completed","failed"].includes(selected.status)||!hasTaskOutcomeDetails(taskOutcomeSummary(selected,visibleConversationEvents))}
        <section>
          <h2>{$t("session.controls")}</h2>
          <div class="session-side-actions">
            {#if canContinue()}<button title={$t("session.fork")} onclick={()=>action("fork")} disabled={sending}><GitBranch size={18}/><span>{$t("session.fork")}</span></button>{/if}
            {#if selected.owned}<button title={$t("handoff.newSessionTitle")} onclick={()=>handoffOpen=true} disabled={sending}><ArrowRightLeft size={18}/><span>{$t("handoff.title")}</span></button>{/if}
            {#if selected.owned}<button title={$t(!selected.workspaceId?"assist.noWorkspace":active.has(selected.status)?"assist.otherRunningTitle":"assist.otherTitle")} onclick={openAssist} disabled={sending||!selected.workspaceId}><Bot size={18}/><span>{$t("assist.chooseReviewer")}</span></button>{/if}
            {#if selected.workChainId}<button title={$t("handoff.workChain")} onclick={()=>chainOpen=!chainOpen}><Link2 size={18}/><span>{$t("handoff.workChain")}</span></button>{/if}
            <button title={$t(selected.workChainId?"collaborationBoard.openLinkedCard":"collaborationBoard.promoteBody")} onclick={openOrPromoteSelectedBoard} disabled={sending}><KanbanSquare size={18}/><span>{$t(selected.workChainId?"collaborationBoard.openLinkedCard":"collaborationBoard.addToBoard")}</span></button>
            {#if selected.status==="completed"&&selected.workspaceId}<button title={$t("pr.title")} onclick={()=>pullRequestOpen=true} disabled={sending}><GitPullRequest size={18}/><span>{$t("pr.action")}</span></button>{/if}
          </div>
        </section>
        {/if}
        <section>
          <h2>{$t("conversation.changedFiles")} <span>{detailFileEntries.length}</span></h2>
          {#if detailFileEntries.length}
            <div class="session-side-files">
              {#each detailFileEntries.slice(0,9) as file}
                {@const canOpen=Boolean(selected.workspaceId&&file.pathBase!=="unresolved"&&(file.pathBase==="workspace"||selected.id))}
                <button disabled={!canOpen} onclick={()=>canOpen&&openConversationFile({path:file.path,pathBase:file.pathBase as "workspace"|"task-cwd",sourceTaskId:selected!.id})}><code class="path-tail-ellipsis" title={file.path} dir="rtl"><bdi dir="ltr">{file.path}</bdi></code><span><em>+{file.add}</em><i>-{file.del}</i></span></button>
              {/each}
            </div>
          {:else}<p class="session-side-empty">{$t("workspace.noChanges")}</p>{/if}
        </section>
      </aside>
    </main>
    {/if}
  {/if}
</div>

{#if creditConsentPrompt}
  <div class="credit-consent-toast" role="alertdialog" aria-modal="true" aria-labelledby="credit-consent-title" aria-describedby="credit-consent-body">
    <div class="credit-consent-icon"><CircleAlert size={22}/></div>
    <div class="credit-consent-content">
      <strong id="credit-consent-title">{$t(creditConsentPrompt.providers.some(provider=>creditConsentPrompt?.reasons[provider]==="unknown")?"billing.promptUnknownTitle":"billing.promptTitle",{provider:creditProviderLabel(creditConsentPrompt.providers)})}</strong>
      <p id="credit-consent-body">{$t(creditConsentPrompt.providers.some(provider=>creditConsentPrompt?.reasons[provider]==="unknown")?"billing.promptUnknownBody":"billing.promptBody")}</p>
      <small>{$t("billing.promptNote")}</small>
      <div class="credit-consent-actions"><button type="button" onclick={()=>settleCreditConsent("cancel")}>{$t("common.cancel")}</button><button type="button" class="primary" onclick={()=>settleCreditConsent("once")}>{$t("billing.useOnce")}</button><button type="button" class="primary paid-always" onclick={()=>settleCreditConsent("always")}>{$t("billing.alwaysUse")}</button></div>
    </div>
  </div>
{/if}

{#if globalOpen}
  <div class="modal-backdrop" role="presentation" onclick={(e)=>e.target===e.currentTarget&&closeGlobalSettings()}>
    <div class="modal global-settings" role="dialog" aria-modal="true" aria-labelledby="global-title">
      <header><h2 id="global-title">{$t("settings.title")}</h2><button class="icon-button" aria-label={$t("a11y.closeDialog")} onclick={closeGlobalSettings}><X size={20}/></button></header>
      <nav class="settings-tabs" aria-label={$t("settings.title")} use:dragScrollX>{#each GLOBAL_TABS as tab,index}{#if index>0&&GLOBAL_TABS[index-1].group!==tab.group}<span class="settings-tab-divider" role="separator" aria-orientation="vertical"></span>{/if}<button type="button" class:active={globalTab===tab.id} onclick={()=>selectGlobalTab(tab.id)}>{$t(tab.labelKey)}{#if globalTabDirty(tab.id)}<i aria-label={$t("common.changed")}></i>{/if}</button>{/each}</nav>
      <div class="settings-tab-panel settings-tab-{globalTab}">
      {#if globalTab==="infrastructure"}
      <InfrastructureSettings {api} onopenworkspace={()=>selectGlobalTab("workspace")} onopensettings={(section)=>selectGlobalTab(section==="provider-connections"?"account":section==="external-access"?"system":"infrastructure")}/>
      {:else if globalTab==="mcp"}
      <McpServerSettings {api}/>
      {:else if globalTab==="storage"}
      <h3>{$t("settings.storage.title")}</h3>
      <nav class="settings-subtabs" aria-label={$t("settings.storage.sections")}>
        {#each STORAGE_TABS as tab}<button type="button" class:active={storageTab===tab.id} aria-current={storageTab===tab.id?"page":undefined} onclick={()=>selectStorageTab(tab.id)}>{$t(tab.labelKey)}</button>{/each}
      </nav>
      {#if storageTab==="artifacts"}<ArtifactSettings {api}/>{:else}<SnapshotSettings {api}/>{/if}
      {:else if globalTab==="account"}
      <nav class="settings-subtabs" aria-label={$t("settings.account.sections")}>
        {#each ACCOUNT_TABS as tab}<button type="button" class:active={accountTab===tab.id} aria-current={accountTab===tab.id?"page":undefined} onclick={()=>selectAccountTab(tab.id)}>{$t(tab.labelKey)}</button>{/each}
      </nav>
      {#if accountTab==="git"}<GitSettings {api}/>{:else if accountTab==="proton"}<ProtonDriveSettings {api}/>{:else}
      <div class="provider-connection-heading"><h3>{$t("provider.connections")}</h3><button type="button" disabled={providerAccountsLoading} onclick={()=>loadProviderAccounts()}><RefreshCw size={14} class={providerAccountsLoading?"spin":""}/>{$t(providerAccountsLoading?"status.checking":"common.refreshStatus")}</button></div>
      <div class="provider-connections">
        {#each ["codex","claude","grok","antigravity"] as provider}
          {@const typedProvider=provider as ConnectionAuthProvider}
          {@const account=providerAccounts.find(item=>item.provider===typedProvider)}
          {@const attempt=authAttempts[typedProvider]}
          {@const runningAttempt=isActiveAuthAttempt(attempt)?attempt!:null}
          <section class="provider-connection-card" class:connected={account?.state==="connected"}>
            <header><span class="provider-mark {typedProvider}">{typedProvider==="codex"?"C":typedProvider==="claude"?"Cl":typedProvider==="grok"?"G":"Ag"}</span><span><strong>{providerName(typedProvider)}</strong><small>{planLabel(account)||(typedProvider==="antigravity"?$t("auth.antigravityCli"):typedProvider==="grok"?$t("auth.grokCli"):"")}{account?.emailMasked?` · ${account.emailMasked}`:""}</small></span><em class:connected={account?.state==="connected"} class:busy={Boolean(runningAttempt)}>{accountStatusLabel(typedProvider,runningAttempt,account)}</em></header>
            {#if typedProvider==="antigravity"}<p class="provider-scope-notice">{$t(antigravityUsesVertex?"antigravityExecution.accountManaged":"auth.antigravityConnectionBody")}</p>{/if}
            {#if runningAttempt}
              <div class="auth-progress" aria-live="polite">
                {#if runningAttempt.url}<a class="auth-open" href={runningAttempt.url} target="_blank" rel="noopener noreferrer">{$t(typedProvider==="codex"?"auth.openOpenAI":typedProvider==="antigravity"?"auth.openGoogle":typedProvider==="grok"?"auth.openXai":"auth.openAnthropic")}</a>{/if}
                {#if runningAttempt.userCode}<div class="device-code"><span><small>{$t("auth.oneTimeCode")}</small><code>{runningAttempt.userCode}</code></span><button type="button" onclick={()=>copy(runningAttempt.userCode)}>{$t("auth.copyCode")}</button></div>{/if}
                {#if (typedProvider==="claude"||typedProvider==="antigravity")&&runningAttempt.state==="code_required"}
                  <form class="auth-code-form" onsubmit={(event)=>{event.preventDefault();void submitAuthCode(typedProvider);}}><label for={`${typedProvider}-auth-code`}>{$t(typedProvider==="antigravity"?"auth.antigravityCode":"auth.claudeCode")}</label><div><input id={`${typedProvider}-auth-code`} type="text" autocomplete="one-time-code" maxlength="512" value={authCodes[typedProvider]??""} oninput={(event)=>authCodes={...authCodes,[typedProvider]:(event.currentTarget as HTMLInputElement).value}} placeholder={$t("auth.officialPageCode")}/><button type="submit" disabled={!authCodes[typedProvider]?.trim()}>{$t("auth.submitCode")}</button></div></form>
                {/if}
                <button type="button" class="auth-cancel" onclick={()=>cancelProviderLogin(typedProvider)}>{$t("auth.cancelLogin")}</button>
              </div>
            {:else}
              <div class="provider-auth-actions">
                {#if typedProvider==="codex"}
                  <button type="button" onclick={()=>startProviderLogin("codex","device")}>{$t(account?.state==="connected"?"auth.reconnect":"auth.connectCodex")}</button>
                  <button type="button" onclick={()=>startProviderLogin("codex","browser")}>{$t("auth.browserLogin")}</button>
                {:else if typedProvider==="claude"}
                  <button type="button" onclick={()=>startProviderLogin("claude","subscription")}>{$t("auth.connectClaudeSubscription")}</button>
                  <button type="button" onclick={()=>startProviderLogin("claude","console")}>{$t("auth.connectConsole")}</button>
                  <button type="button" onclick={()=>startProviderLogin("claude","sso")}>{$t("auth.connectSso")}</button>
                {:else if typedProvider==="grok"}
                  <button type="button" onclick={()=>startProviderLogin("grok","device")}>{$t(account?.state==="connected"?"auth.reconnect":"auth.connectGrok")}</button>
                {:else if !antigravityUsesVertex}
                  <button type="button" onclick={()=>startProviderLogin("antigravity","google-oauth")}>{$t(account?.state==="connected"?"auth.reconnect":"auth.connectAntigravity")}</button>
                {/if}
                {#if account?.state==="connected"}<button type="button" class="auth-logout" onclick={()=>logoutProvider(typedProvider)}>{$t("auth.logout")}</button>{/if}
              </div>
            {/if}
            {#if authFeedback[typedProvider]}<p class="auth-feedback {authFeedback[typedProvider]?.tone}" role="status" aria-live="polite">{authFeedback[typedProvider]?.message}</p>{/if}
            {#if attempt&&["failed","timeout"].includes(attempt.state)}<p class="auth-error">{authErrorLabel(attempt.errorCategory)}</p>{/if}
          </section>
        {/each}
        {#each ["deepseek","ollama"] as provider}
          {@const typedProvider=provider as "deepseek"|"ollama"}
          {@const account=providerAccounts.find(item=>item.provider===typedProvider)}
          {@const settings=compatibleProviderSettings[typedProvider]}
          <section class="provider-connection-card" class:connected={account?.state==="connected"}>
            <header><span class="provider-mark {typedProvider}">{$t(typedProvider==="deepseek"?"auth.deepseekMark":"auth.ollamaMark")}</span><span><strong>{$t(typedProvider==="deepseek"?"provider.deepseek":"provider.ollama")}</strong><small>{$t(typedProvider==="deepseek"?"auth.deepseekApi":"auth.ollamaRuntime")}</small></span><em class:connected={account?.state==="connected"} class:busy={providerAccountsLoading}>{$t(account?.state==="connected"?"status.connected":account?.state==="unavailable"?"auth.runtimeUnavailable":"auth.connectionRequired")}</em></header>
            <p class="provider-scope-notice">{$t(typedProvider==="deepseek"?"auth.deepseekConnectionBody":"auth.ollamaConnectionBody")}</p>
            <form class="compatible-provider-form" onsubmit={(event)=>{event.preventDefault();void saveCompatibleProvider(typedProvider);}}>
              <label>{$t(typedProvider==="deepseek"?"auth.deepseekBaseUrl":"auth.ollamaBaseUrl")}<input type="url" required maxlength="2048" value={settings.baseUrl} oninput={(event)=>updateCompatibleBaseUrl(typedProvider,(event.currentTarget as HTMLInputElement).value)}/></label>
              <label>{$t(typedProvider==="deepseek"?"auth.deepseekApiKey":"auth.ollamaToken")}<input type="password" autocomplete="new-password" maxlength="4096" value={compatibleProviderSecrets[typedProvider]} oninput={(event)=>updateCompatibleSecret(typedProvider,(event.currentTarget as HTMLInputElement).value)} placeholder={$t(settings.secretConfigured?"auth.secretStored":"auth.secretEnter")}/></label>
              <small>{$t(typedProvider==="deepseek"?"auth.deepseekSecretHelp":"auth.ollamaSecretHelp")}</small>
              <div class="provider-auth-actions"><button type="submit" disabled={compatibleProviderSaving!==null||(!settings.secretConfigured&&!compatibleProviderSecrets[typedProvider].trim())}>{$t(compatibleProviderSaving===typedProvider?"common.saving":"auth.saveConnection")}</button><button type="button" disabled={providerAccountsLoading||compatibleProviderSaving!==null} onclick={()=>loadProviderAccounts()}>{$t(providerAccountsLoading?"status.checking":"auth.connectionRefresh")}</button></div>
            </form>
          </section>
        {/each}
      </div>
      <p class="provider-scope-notice">{$t("provider.connectionScope")}</p>
      {#if providerAuthNotice}<p class="runtime-notice" aria-live="polite">{providerAuthNotice}</p>{/if}
      {/if}
      {:else if globalTab==="workspace"}
      <ProjectWorkspaceSettings {api} {projects} onviewworkspace={(workspace)=>openWorkspaceFiles(workspace)}/>
      {:else if globalTab==="about"}
      <AboutLicenses {api}/>
      {:else if globalTab==="system"}
      <h3>{$t("setup.settingsTitle")}</h3>
      <section class="credit-usage-setting">
        <label><span><strong>{$t("setup.showOnStartup")}</strong><small>{$t("setup.showOnStartupBody")}</small></span><input type="checkbox" checked={setupShowOnStartup} disabled={setupPreferenceBusy} onchange={(event)=>setSetupStartupVisibility((event.currentTarget as HTMLInputElement).checked)}/></label>
        <button type="button" onclick={reopenSetup}>{$t("setup.openNow")}</button>
      </section>
      {#if setupPreferenceNotice}<p class="runtime-notice" aria-live="polite">{setupPreferenceNotice}</p>{/if}
      <h3>{$t("diagnostic.system")}</h3>
      <div class="runtime-heading"><small>{$t("diagnostic.safeReport")}</small><button type="button" disabled={diagnosticBusy} onclick={loadSystemDiagnostic}><RefreshCw size={14}/>{$t(diagnosticBusy?"diagnostic.running":"diagnostic.run")}</button></div>
      {#if systemDiagnostic}<pre class="system-diagnostic">{JSON.stringify(systemDiagnostic,null,2)}</pre><button type="button" onclick={copySystemDiagnostic}>{$t("diagnostic.copyReport")}</button>{/if}
      <h3>{$t("applicationUpdate.title")}</h3>
      <div class="runtime-heading"><small>{$t("applicationUpdate.separate")}</small><button type="button" disabled={Boolean(applicationUpdateBusy)} onclick={checkApplicationUpdate}><RefreshCw size={14} class={applicationUpdateBusy==="check"?"spin":""}/>{$t(applicationUpdateBusy==="check"?"status.checking":"applicationUpdate.check")}</button></div>
      {#if applicationUpdate}
        <div class="runtime-card application-update-card" class:verified={applicationUpdate.state==="up-to-date"}>
          <span class="application-update-current"><strong>{$t("applicationUpdate.installed",{version:applicationUpdate.current.version})}</strong><small>{$t("applicationUpdate.method",{method:applicationUpdate.current.installMethod})}</small></span>
          {#if applicationUpdate.target}<span class="application-update-target"><code title={applicationUpdate.target.manifestSha256}>{$t("applicationUpdate.signature",{key:applicationUpdate.target.keyId,hash:applicationUpdate.target.manifestSha256.slice(0,12)})}</code><small>{$t("applicationUpdate.target",{version:applicationUpdate.target.version})}</small></span>{/if}
          {#if applicationUpdate.updateAvailable}<button type="button" class="runtime-update" disabled={Boolean(applicationUpdateBusy)||applicationUpdate.blockers.length>0} onclick={applyApplicationUpdate}>{$t(applicationUpdateBusy==="apply"?"applicationUpdate.applying":"common.update")}</button>{/if}
          <span class="application-update-detail">{#if applicationUpdate.updateAvailable&&applicationUpdate.blockers.length}<small class="runtime-notice">{$t("applicationUpdate.blocked",{count:applicationUpdate.blockers.length})}</small>{/if}{#if applicationUpdate.updateAvailable}<small>{$t("applicationUpdate.snapshotRestart")}</small>{:else if applicationUpdate.reason==="source-checkout-not-updatable"}<small>{$t("applicationUpdate.sourceCheckout")}</small>{/if}{#if applicationUpdate.recentAttempts[0]}<small>{$t("applicationUpdate.recent",{source:applicationUpdate.recentAttempts[0].sourceVersion,target:applicationUpdate.recentAttempts[0].targetVersion,state:applicationUpdate.recentAttempts[0].state})}</small>{/if}</span>
        </div>
      {/if}
      {#if applicationUpdateNotice}<p class="runtime-notice" aria-live="polite">{applicationUpdateNotice}</p>{/if}
      <h3>{$t("runtime.title")}</h3>
      <div class="runtime-heading"><small>{$t("runtime.independentInstall")}</small><button type="button" disabled={Boolean(runtimeBusy)} onclick={checkUpdates}><RefreshCw size={14} class={runtimeBusy==="check"?"spin":""}/>{$t(runtimeBusy==="check"?"status.checking":"runtime.checkUpdates")}</button></div>
      {#each runtimeCards as item (item.provider)}
        <div class="runtime-card" class:verified={item.managed}>
          <span>
            <strong>{item.name} {item.current??$t("common.unavailable")}</strong>
            {#if item.management==="managed"}
              <small>{item.updateAvailable===true?$t("runtime.latest",{version:item.latest??$t("common.unavailable")}):$t(item.updateAvailable===false?"runtime.latestVersion":item.source?.includes("check-failed")?"runtime.checkFailed":item.managed?"runtime.managedOfficial":"runtime.managementUnknown")}</small>
            {:else if item.management==="external"}
              <small>{$t(item.current?"runtime.externalInstalled":item.configured?"runtime.externalVersionUnavailable":"runtime.externalMissing")}</small>
            {:else}
              <small>{$t(item.configured?"runtime.apiConfigured":"runtime.apiMissing")}</small>
            {/if}
          </span>
          <span class="runtime-badge" data-management={item.management}>{$t(item.management==="managed"?"runtime.badge.managed":item.management==="external"?"runtime.badge.external":"runtime.badge.api")}</span>
          <!-- A digest rebuilt offline is of the binary, not of the upstream
               package, so it is labelled as such instead of being shown under
               the same "SHA" as a downloaded package digest. -->
          {#if item.checksum}<code title={item.checksum}>{item.checksumSource==="binary"?"BIN SHA":"SHA"} {item.checksum.slice(0,12)}</code>{/if}
          {#if item.fault}<small class="runtime-fault">{item.fault}</small>{/if}
          {#if item.management==="managed"}
            <label class="runtime-auto-toggle"><span><strong>{$t("runtime.autoUpdate")}</strong><small>{$t(item.canUpdate?"runtime.autoUpdateBody":"runtime.autoUpdateUnavailable")}</small></span><input type="checkbox" checked={runtimeAutoUpdate.providers[item.provider as "codex"|"claude"]} disabled={!item.canUpdate||Boolean(runtimeSettingsBusy)} onchange={(event)=>toggleRuntimeAutoUpdate(item.provider as "codex"|"claude",(event.currentTarget as HTMLInputElement).checked)}/></label>
            {#if item.updateAvailable}<button type="button" class="runtime-update" disabled={Boolean(runtimeBusy)} onclick={()=>updateRuntime(item.provider as "codex"|"claude")}>{$t(runtimeBusy===item.provider?"runtime.updatingShort":"common.update")}</button>{/if}
          {:else}
            <small class="runtime-unmanaged">{$t(item.management==="external"?"runtime.externalBody":"runtime.apiBody")}</small>
          {/if}
        </div>
      {/each}
      {#if runtimeNotice}<p class="runtime-notice" aria-live="polite">{runtimeNotice}</p>{/if}
      {:else if globalTab==="defaults"}
      <h3>{$t("execution.defaults")}</h3>
      <nav class="settings-subtabs" aria-label={$t("settings.defaults.sections")}>
        {#each DEFAULTS_TABS as tab}<button type="button" class:active={defaultsTab===tab.id} aria-current={defaultsTab===tab.id?"page":undefined} onclick={()=>selectDefaultsTab(tab.id)}>{tab.id==="general"?$t(tab.label):providerDisplayName(tab.id)}</button>{/each}
      </nav>
      {#if defaultsTab==="general"}
      <section class="credit-usage-setting">
        <label><span><strong>{$t("billing.allowPaidCredits")}</strong><small>{$t("billing.allowPaidCreditsBody")}</small></span><input type="checkbox" bind:checked={allowPaidCredits} disabled={creditUsageLoading}/></label>
        <p><CircleAlert size={15}/>{$t("billing.providerAccountNote")}</p>
      </section>
      <label>{$t("execution.defaultAgent")}<div class="segments">{#each ["codex","claude","grok","antigravity","deepseek","ollama"] as provider}{@const typedProvider=provider as ProviderId}<button type="button" class:active={globalDefaultProvider===typedProvider} onclick={()=>globalDefaultProvider=typedProvider}>{providerDisplayName(typedProvider)}</button>{/each}</div></label>
      <h4>{$t("delegation.toOtherProvider")}</h4>
      <p class="provider-scope-notice">{$t("delegation.body")}</p>
      {#if delegationLoading&&!delegationLoaded}<p class="provider-waiting">{$t("delegation.loading")}</p>{/if}
      <section class="delegation-card">
        <h4>Codex → Claude</h4>
        <label>{$t("delegation.launchMode")}<div class="segments"><button type="button" disabled={delegationLoading} class:active={delegationSettings.claude.launchMode==="managed"} onclick={()=>delegationSettings={...delegationSettings,claude:{...delegationSettings.claude,launchMode:"managed"}}}>{$t("delegation.managed")}</button><button type="button" disabled={delegationLoading} class:active={delegationSettings.claude.launchMode==="direct"} onclick={()=>delegationSettings={...delegationSettings,claude:{...delegationSettings.claude,launchMode:"direct"}}}>{$t("delegation.directCli")}</button></div></label>
        <label>{$t("model.defaultLabel")}<select value={delegationSettings.claude.model} onchange={(event)=>delegationSettings={...delegationSettings,claude:{...delegationSettings.claude,model:(event.currentTarget as HTMLSelectElement).value}}}>{#each delegationClaudeModels() as model}<option value={model.id}>{modelLabel(model)}</option>{/each}</select></label>
        <label>{$t("model.reasoningEffort")}<select value={delegationSettings.claude.reasoningEffort} onchange={(event)=>delegationSettings={...delegationSettings,claude:{...delegationSettings.claude,reasoningEffort:(event.currentTarget as HTMLSelectElement).value}}}>{#each claudeEfforts as effort}<option value={effort.id}>{$t(`session.effort.${effort.id}`)}</option>{/each}</select></label>
        <small class="field-help">{$t("delegation.managedBody")}</small>
      </section>
      <section class="delegation-card">
        <h4>Claude → Codex</h4>
        <label>{$t("delegation.launchMode")}<div class="segments"><button type="button" disabled={delegationLoading} class:active={delegationSettings.codex.launchMode==="managed"} onclick={()=>delegationSettings={...delegationSettings,codex:{...delegationSettings.codex,launchMode:"managed"}}}>{$t("delegation.managed")}</button><button type="button" disabled={delegationLoading} class:active={delegationSettings.codex.launchMode==="direct"} onclick={()=>delegationSettings={...delegationSettings,codex:{...delegationSettings.codex,launchMode:"direct"}}}>{$t("delegation.directCli")}</button></div></label>
        <label>{$t("model.label")}<select value={delegationSettings.codex.model??""} onchange={(event)=>setDelegationCodexModel((event.currentTarget as HTMLSelectElement).value||null)}>{#each availableCodexModels() as model}<option value={model.id}>{modelLabel(model)}</option>{/each}</select></label>
        <label>{$t("model.reasoningEffort")}<select value={delegationSettings.codex.reasoningEffort??""} onchange={(event)=>delegationSettings={...delegationSettings,codex:{...delegationSettings.codex,reasoningEffort:(event.currentTarget as HTMLSelectElement).value||null}}}><option value="">{$t("model.selectedDefault")}</option>{#each delegationCodexEfforts() as effort}<option value={effort.reasoningEffort}>{effortLabel(effort.reasoningEffort)}</option>{/each}</select></label>
        <label>{$t("model.speed")}<div class="segments"><button type="button" class:active={delegationSettings.codex.serviceTier===null} onclick={()=>delegationSettings={...delegationSettings,codex:{...delegationSettings.codex,serviceTier:null}}}>{$t("model.standard")}</button><button type="button" class:active={delegationSettings.codex.serviceTier==="priority"} disabled={!delegationCodexModelInfo()?.serviceTiers?.some((item:any)=>item.id==="priority")} onclick={()=>delegationSettings={...delegationSettings,codex:{...delegationSettings.codex,serviceTier:"priority"}}}>{$t("model.fast")}</button></div></label>
        <small class="field-help">{$t("delegation.codexBody")}</small>
      </section>
      {/if}
      {#if defaultsTab!=="general"}
      <h4>{$t("model.globalList")}</h4>
      <p class="provider-scope-notice">{$t("model.globalListBody")}</p>
      {/if}
      {#if defaultsTab==="codex"}
      <section class="model-catalog-card">
        <div class="delegation-heading"><h4>{$t("model.codexModels")}</h4><button type="button" disabled={codexCatalogRefreshing} onclick={refreshCodexModelCatalog}><RefreshCw size={14} class={codexCatalogRefreshing?"spin":""}/>{$t(codexCatalogRefreshing?"model.loading":"model.load")}</button></div>
        <div class="delegation-model-options">{#each globalModelCandidates.codex as model}<label title={model.id}><input type="checkbox" checked={globalModelSettings.codex.models.some(item=>item.id===model.id)} disabled={globalModelSettings.codex.models.length===1&&globalModelSettings.codex.models.some(item=>item.id===model.id)} onchange={()=>toggleGlobalModel("codex",model)}/><span><strong>{modelLabel(model)}</strong><small>{model.source==="custom"?$t(model.validatedAt?"model.customValidated":"model.custom"): $t("model.codexRuntime")}</small></span></label>{/each}</div>
        <div class="custom-model-row"><input aria-label={$t("model.codexCustomId")} placeholder={$t("model.customId")} bind:value={customModelDraft.codex.id}/><input aria-label={$t("model.codexDisplayName")} placeholder={$t("model.displayNameOptional")} bind:value={customModelDraft.codex.displayName}/><button type="button" onclick={()=>addCustomModel("codex")}>{$t("common.add")}</button><button type="button" disabled={modelValidation.codex?.busy||!customModelDraft.codex.id.trim()} onclick={()=>validateCustomModel("codex")}>{$t(modelValidation.codex?.busy?"model.validating":"model.validate")}</button></div>
        {#if modelValidation.codex?.detail}<small class:validation-ok={modelValidation.codex.valid} class:validation-error={modelValidation.codex.valid===false}>{modelValidation.codex.detail}</small>{/if}
      </section>
      {/if}
      {#if defaultsTab==="claude"}
      <section class="credit-usage-setting">
        <label><span><strong>{$t("claudeExecution.switchModelsOnFlag")}</strong><small>{$t("claudeExecution.switchModelsOnFlagBody")}</small></span><input type="checkbox" bind:checked={claudeSwitchModelsOnFlag} disabled={claudeExecutionLoading}/></label>
        <p><CircleAlert size={15}/>{$t("claudeExecution.nextTurnNote")}</p>
      </section>
      <section class="model-catalog-card">
        <div class="delegation-heading"><h4>{$t("model.claudeModels")}</h4><button type="button" disabled={claudeCatalogRefreshing} onclick={refreshClaudeModelCatalog}><RefreshCw size={14} class={claudeCatalogRefreshing?"spin":""}/>{$t(claudeCatalogRefreshing?"model.loading":"model.load")}</button></div>
        <div class="delegation-model-options">{#each globalModelCandidates.claude as model}<label title={model.id}><input type="checkbox" checked={globalModelSettings.claude.models.some(item=>item.id===model.id)} disabled={globalModelSettings.claude.models.length===1&&globalModelSettings.claude.models.some(item=>item.id===model.id)} onchange={()=>toggleGlobalModel("claude",model)}/><span><strong>{modelLabel(model)}</strong><small>{model.source==="custom"?$t(model.validatedAt?"model.customValidated":"model.custom"):$t("model.claudeRuntime")}</small></span></label>{/each}</div>
        <div class="custom-model-row"><input aria-label={$t("model.claudeCustomId")} placeholder="claude-opus-4-6[1m]" bind:value={customModelDraft.claude.id}/><input aria-label={$t("model.claudeDisplayName")} placeholder="Opus 4.6 (1M)" bind:value={customModelDraft.claude.displayName}/><button type="button" onclick={()=>addCustomModel("claude")}>{$t("common.add")}</button><button type="button" disabled={modelValidation.claude?.busy||!customModelDraft.claude.id.trim()} onclick={()=>validateCustomModel("claude")}>{$t(modelValidation.claude?.busy?"model.validating":"model.validate")}</button></div>
        {#if modelValidation.claude?.detail}<small class:validation-ok={modelValidation.claude.valid} class:validation-error={modelValidation.claude.valid===false}>{modelValidation.claude.detail}</small>{/if}
        {#if claudeCatalogMeta}<small class="catalog-state" class:stale={claudeCatalogMeta.stale===true}>{isClaudeCatalogFallback(claudeCatalogMeta)?$t("model.catalogFallbackFilteredState"):claudeCatalogMeta.stale?"Cached":"Claude Code"}{claudeCatalogMeta.fetchedAt?` · ${formatDateTime(claudeCatalogMeta.fetchedAt,$locale)}`:""}</small>{/if}
      </section>
      {/if}
      {#if defaultsTab==="antigravity"}
      <section class="credit-usage-setting antigravity-execution-setting">
        <label><span><strong>{$t("antigravityExecution.backend")}</strong><small>{$t("antigravityExecution.body")}</small></span><div class="segments"><button type="button" class:active={antigravityExecution.backend==="consumer"} onclick={()=>antigravityExecution={...antigravityExecution,backend:"consumer"}}>{$t("antigravityExecution.consumer")}</button><button type="button" class:active={antigravityExecution.backend==="vertex"} onclick={()=>antigravityExecution={...antigravityExecution,backend:"vertex"}}>{$t("antigravityExecution.vertex")}</button><button type="button" class:active={antigravityExecution.backend==="vertex-agent"} onclick={()=>antigravityExecution={...antigravityExecution,backend:"vertex-agent"}}>{$t("antigravityExecution.vertexAgent")}</button></div></label>
        <p class="field-help">{$t(antigravityExecution.backend==="vertex-agent"?"antigravityExecution.vertexAgentBody":antigravityExecution.backend==="vertex"?"antigravityExecution.vertexBody":"antigravityExecution.consumerBody")}</p>
        {#if antigravityUsesVertex}
          <label>{$t("antigravityExecution.project")}<input bind:value={antigravityExecution.vertex.projectId} autocomplete="off" placeholder={$t("antigravityExecution.projectPlaceholder")}/></label>
          <label>{$t("antigravityExecution.location")}<input bind:value={antigravityExecution.vertex.location} autocomplete="off" placeholder={$t("antigravityExecution.locationPlaceholder")}/></label>
          <label>{$t("antigravityExecution.creditsUrl")}<input type="url" bind:value={antigravityExecution.vertex.creditsUrl} autocomplete="off" placeholder={$t("antigravityExecution.creditsUrlPlaceholder")}/><small>{$t("antigravityExecution.creditsUrlHelp")}</small></label>
          <div class="vertex-credential-upload"><span><strong>{$t("antigravityExecution.credentialsUpload")}</strong><small>{antigravityExecution.vertex.credentialsPath?$t("antigravityExecution.credentialsConfigured"):$t("antigravityExecution.credentialsHelp")}</small></span><label class="credential-upload-button">{antigravityCredentialUploading?$t("antigravityExecution.credentialsUploading"):$t(antigravityExecution.vertex.credentialsPath?"antigravityExecution.credentialsReplace":"antigravityExecution.credentialsChoose")}<input type="file" disabled={antigravityCredentialUploading} onchange={uploadAntigravityCredentials}/></label></div>
          {#if antigravityCredentialNotice}<p class="credential-upload-notice">{antigravityCredentialNotice}</p>{/if}
        {/if}
        {#if antigravityExecution.backend==="vertex-agent"&&geminiCliReadiness}
          <p class="field-help">{$t("antigravityExecution.geminiCliStatus",{state:$t(geminiCliReadiness.installed?"antigravityExecution.geminiCliReady":"antigravityExecution.geminiCliMissing"),version:geminiCliReadiness.version??"?"})}<br/>{$t("antigravityExecution.geminiCliScope",{project:geminiCliReadiness.projectId||"?",location:geminiCliReadiness.location||"?"})}{#if !geminiCliReadiness.ripgrep}<br/>{$t("antigravityExecution.geminiCliRipgrep")}{/if}{#if !geminiCliReadiness.installed}<br/>{$t("antigravityExecution.geminiCliInstall")}{/if}</p>
        {/if}
        <div class="provider-auth-actions"><button type="button" disabled={antigravityExecutionLoading||antigravityExecutionTesting} onclick={testAntigravityExecution}>{$t(antigravityExecutionTesting?"antigravityExecution.testing":"antigravityExecution.applyTest")}</button></div>
        {#if antigravityExecutionNotice}<p>{antigravityExecutionNotice}</p>{/if}
      </section>
      {/if}
      {#each compatibleProviders as provider}
        {#if defaultsTab===provider}
        <section class="model-catalog-card">
          <div class="delegation-heading"><h4>{$t("model.providerModels",{provider:providerDisplayName(provider)})}</h4><button type="button" disabled={providerCatalogRefreshing[provider]} onclick={()=>refreshCompatibleModelCatalog(provider)}><RefreshCw size={14} class={providerCatalogRefreshing[provider]?"spin":""}/>{$t(providerCatalogRefreshing[provider]?"model.loading":"model.load")}</button></div>
          <div class="delegation-model-options">{#each globalModelCandidates[provider] as model}<label title={model.id}><input type="checkbox" checked={globalModelSettings[provider].models.some(item=>item.id===model.id)} disabled={globalModelSettings[provider].models.length===1&&globalModelSettings[provider].models.some(item=>item.id===model.id)} onchange={()=>toggleGlobalModel(provider,model)}/><span><strong>{modelLabel(model)}</strong><small>{$t("model.providerRuntime",{provider:providerDisplayName(provider)})}</small></span></label>{/each}</div>
        </section>
        {/if}
      {/each}
      {#if defaultsTab==="codex"}
      <h4>{$t("model.codexDefaults")}</h4>
      <label>{$t("workMode.label")}<WorkModeChips provider="codex" value={globalCodexWorkMode} onchange={(mode)=>chooseGlobalWorkMode("codex",mode)}/></label>
      <label>{$t("model.label")}{#if availableCodexModels().length}<div class="chips">{#each availableCodexModels() as model}<button type="button" class:active={globalCodexModel===model.id} onclick={()=>{globalCodexModel=model.id;globalCodexModelChanged();}}>{modelLabel(model)}</button>{/each}</div>{:else}<small class="field-warning">{$t("model.saveGlobalCodex")}</small>{/if}</label>
      <label>{$t("model.reasoningEffort")}<div class="chips">{#each globalCodexModelInfo()?.supportedReasoningEfforts??[] as effort}<button type="button" class:active={globalCodexEffort===effort.reasoningEffort} onclick={()=>globalCodexEffort=effort.reasoningEffort}>{effortLabel(effort.reasoningEffort)}</button>{/each}</div></label>
      <label>{$t("model.speed")}<div class="segments"><button type="button" class:active={globalCodexTier===null} onclick={()=>globalCodexTier=null}>{$t("model.standard")}</button><button type="button" class:active={globalCodexTier==="priority"} disabled={!globalCodexModelInfo()?.serviceTiers?.some((x:any)=>x.id==="priority")} onclick={()=>globalCodexTier="priority"}>{$t("model.fast")}</button></div></label>
      <label>{$t("automation.level")}<AutomationLevelChips provider="codex" value={globalCodexAutomation} onchange={(level)=>chooseGlobalAutomation("codex",level)}/></label>
      {/if}
      {#if defaultsTab==="claude"}
      <h4>{$t("model.claudeDefaults")}</h4>
      <label>{$t("workMode.label")}<WorkModeChips provider="claude" value={globalClaudeWorkMode} onchange={(mode)=>chooseGlobalWorkMode("claude",mode)}/></label>
      <label>{$t("model.label")}<select bind:value={globalClaudeModel}>{#each availableClaudeModels() as m}<option value={m.id}>{m.displayName}</option>{/each}</select></label>
      <label>{$t("model.reasoningEffort")}<select bind:value={globalClaudeEffort}>{#each claudeEfforts as e}<option value={e.id}>{$t(`session.effort.${e.id}`)}</option>{/each}</select></label>
      <label>{$t("automation.level")}<AutomationLevelChips provider="claude" value={globalClaudeAutomation} onchange={(level)=>chooseGlobalAutomation("claude",level)}/></label>
      {/if}
      {#each compatibleProviders as provider}
        {#if defaultsTab===provider}
        <h4>{$t("model.providerDefaults",{provider:providerDisplayName(provider)})}</h4>
        <label>{$t("workMode.label")}<WorkModeChips {provider} value={globalCompatibleWorkModes[provider]} onchange={(mode)=>chooseGlobalWorkMode(provider,mode)}/></label>
        <label>{$t("model.label")}<select value={globalCompatibleModels[provider]} onchange={(event)=>globalCompatibleModels={...globalCompatibleModels,[provider]:(event.currentTarget as HTMLSelectElement).value}}>{#each availableCompatibleModels(provider) as model}<option value={model.id}>{model.displayName}</option>{/each}</select></label>
        <label>{$t("model.reasoningEffort")}<select value={globalCompatibleEfforts[provider]} onchange={(event)=>globalCompatibleEfforts={...globalCompatibleEfforts,[provider]:(event.currentTarget as HTMLSelectElement).value}}>{#each compatibleEffortOptions(provider) as effort}<option value={effort.id}>{$t(`session.effort.${effort.id}`)}</option>{/each}</select></label>
        <label>{$t("automation.level")}<AutomationLevelChips {provider} value={globalCompatibleAutomation[provider]} onchange={(level)=>chooseGlobalAutomation(provider,level)}/></label>
        {/if}
      {/each}
      {#if (defaultsTab==="codex"&&globalCodexAutomation==="full")||(defaultsTab==="claude"&&globalClaudeAutomation==="full")||(compatibleProviders.includes(defaultsTab as CompatibleExecutionProvider)&&globalCompatibleAutomation[defaultsTab as CompatibleExecutionProvider]==="full")}
        {#if !dangerAcknowledged}<label class="danger-confirm"><input type="checkbox" bind:checked={dangerConfirmed} onchange={()=>dangerConfirmed&&recordDangerAcknowledgement()}/>{$t("permission.fullAutoRiskAcknowledge")}</label>{/if}
      {/if}
      {:else if globalTab==="characters"}
      <h3>{$t("character.byProvider")}</h3>
      <p class="provider-scope-notice">{$t("character.scopeBody")}</p>
      {#if charactersLoading&&!charactersLoaded}<p class="provider-waiting">{$t("character.loading")}</p>{/if}
      <fieldset class="appearance-field avatar-display-setting"><legend>{$t("character.avatarDisplay")}</legend><p>{$t("character.avatarDisplayBody")}</p><div class="segments"><button type="button" class:active={characterSettings.avatarDisplay==="character"} onclick={()=>updateAvatarDisplay("character")}>{$t("character.avatarDisplay.character")}</button><button type="button" class:active={characterSettings.avatarDisplay==="name-mark"} onclick={()=>updateAvatarDisplay("name-mark")}>{$t("character.avatarDisplay.nameMark")}</button></div></fieldset>
      <div class="character-settings-grid">
        {#each ["codex","claude","grok","antigravity","deepseek","ollama"] as provider}
          {@const typedProvider=provider as ProviderId}{@const character=characterSettings.providers[typedProvider]}
          <section class="character-card"><header><strong>{character.nickname} · {providerDisplayName(typedProvider)}</strong><small>{$t("character.defaultFemale")}</small></header>
            <label>{$t("character.nickname")}<input value={character.nickname} maxlength="30" oninput={(event)=>updateCharacter(typedProvider,{nickname:(event.currentTarget as HTMLInputElement).value})}/></label>
            <label>{$t("character.toneLabel")}<select value={character.tonePreset} onchange={(event)=>updateCharacter(typedProvider,{tonePreset:(event.currentTarget as HTMLSelectElement).value as any})}>{#each TONE_PRESETS as tone}<option value={tone.id}>{$t(`character.tone.${tone.id}`)}</option>{/each}</select></label>
            <label class="character-check"><input type="checkbox" checked={character.conversationOnly} onchange={(event)=>updateCharacter(typedProvider,{conversationOnly:(event.currentTarget as HTMLInputElement).checked})}/><span><strong>{$t("character.conversationOnly")}</strong><small>{$t("character.conversationOnlyBody")}</small></span></label>
            {#if character.tonePreset==="custom"}<label>{$t("character.customTone")}<textarea rows="4" maxlength="2000" value={character.customTone} oninput={(event)=>updateCharacter(typedProvider,{customTone:(event.currentTarget as HTMLTextAreaElement).value})}></textarea></label>{/if}
            {#if characterSettings.avatarDisplay==="character"}<label>{$t("character.avatarOutfit")}<select value={character.avatarOutfit} onchange={(event)=>updateCharacter(typedProvider,{avatarOutfit:(event.currentTarget as HTMLSelectElement).value})}>{#each providerOutfits[typedProvider] as outfit}<option value={outfit}>{typedProvider==="antigravity"?"Gemini":outfit}</option>{/each}</select>{#if typedProvider!=="codex"}<small class="field-help">{$t("character.installedAssetsOnly")}</small>{/if}</label>{/if}
            <label>{$t("character.emotionIntensity")}<select value={character.emotionIntensity} onchange={(event)=>updateCharacter(typedProvider,{emotionIntensity:(event.currentTarget as HTMLSelectElement).value as any})}><option value="subtle">{$t("character.emotion.subtle")}</option><option value="natural">{$t("character.emotion.natural")}</option><option value="expressive">{$t("character.emotion.expressive")}</option></select></label>
          </section>
        {/each}
      </div>
      {:else if globalTab==="display"}
      <h3>{$t("settings.display")}</h3>
      <nav class="settings-subtabs" aria-label={$t("settings.display.sections")}>
        {#each DISPLAY_TABS as tab}<button type="button" class:active={displayTab===tab.id} aria-current={displayTab===tab.id?"page":undefined} onclick={()=>selectDisplayTab(tab.id)}>{$t(tab.labelKey)}</button>{/each}
      </nav>
      {#if displayTab==="screen"}
      <label class="language-setting"><span><strong>{$t("language.label")}</strong></span><select value={$locale} disabled={localeSaving} onchange={chooseLocale} aria-label={$t("language.label")}><option value="ko">{$t("language.option.ko")}</option><option value="en">{$t("language.option.en")}</option><option value="ja">{$t("language.option.ja")}</option></select></label>
      {#if localeNotice}<p class="locale-notice" class:error={localeNotice===$t("language.saveFailed")} aria-live="polite">{localeNotice}</p>{/if}
      <label>{$t("settings.theme")}<div class="segments three"><button type="button" class:active={theme==="auto"} onclick={()=>applyTheme("auto")}>{$t("settings.theme.auto")}</button><button type="button" class:active={theme==="light"} onclick={()=>applyTheme("light")}>{$t("settings.theme.light")}</button><button type="button" class:active={theme==="dark"} onclick={()=>applyTheme("dark")}>{$t("settings.theme.dark")}</button></div></label>
      <fieldset class="appearance-field"><legend>{$t("settings.palette")}</legend><div class="palette-grid">
        {#each PALETTES as option}
          <button type="button" class:active={palette===option} aria-pressed={palette===option} onclick={()=>applyPalette(option)}>
            <span class="palette-swatches" aria-hidden="true">{#each paletteSwatches[option] as color}<i style={`--swatch:${color}`}></i>{/each}</span>
            <strong>{$t(`settings.palette.${option}`)}</strong>{#if palette===option}<Check size={15}/>{/if}
          </button>
        {/each}
      </div></fieldset>
      <fieldset class="appearance-field"><legend>{$t("settings.skin")}</legend><div class="skin-grid">
        {#each SKINS as option}
          <button type="button" class:active={skin===option} aria-pressed={skin===option} onclick={()=>applySkin(option)}>
            <span class="skin-preview skin-preview-{option}" aria-hidden="true"><i></i><i></i></span>
            <strong>{$t(`settings.skin.${option}`)}</strong>{#if skin===option}<Check size={15}/>{/if}
          </button>
        {/each}
      </div></fieldset>
      <fieldset class="appearance-field"><legend>{$t("settings.sessionTextSize")}</legend><div class="segments four text-size-segments">
        {#each TEXT_SIZES as option}<button type="button" class:active={sessionTextSize===option} aria-pressed={sessionTextSize===option} onclick={()=>applySessionTextSize(option)}>{$t(`settings.textSize.${option}`)}</button>{/each}
      </div></fieldset>
      <fieldset class="appearance-field"><legend>{$t("settings.conversationTextSize")}</legend><div class="segments four text-size-segments">
        {#each TEXT_SIZES as option}<button type="button" class:active={conversationTextSize===option} aria-pressed={conversationTextSize===option} onclick={()=>applyConversationTextSize(option)}>{$t(`settings.textSize.${option}`)}</button>{/each}
      </div></fieldset>
      <div class="setting-switches">
        <label><span><strong>{$t("display.avatars")}</strong><small>{$t("display.avatarsBody")}</small></span><input type="checkbox" bind:checked={showAvatars}/></label>
        <label><span><strong>{$t("display.statusBubbles")}</strong><small>{$t("display.statusBubblesBody")}</small></span><input type="checkbox" bind:checked={showSpeech}/></label>
        <label><span><strong>{$t("display.autoCollapse")}</strong><small>{$t("display.autoCollapseBody")}</small></span><input type="checkbox" bind:checked={avatarAutoCollapse}/></label>
        <label class="setting-choice"><span><strong>{$t("display.collapseDelay")}</strong><small>{$t("display.collapseDelayBody")}</small></span><select bind:value={avatarCollapseDelayMs} disabled={!avatarAutoCollapse}>{#each AVATAR_COLLAPSE_DELAYS as delay}<option value={delay}>{$t("format.seconds",{count:delay/1000})}</option>{/each}</select></label>
        <label class="setting-choice"><span><strong>{$t("display.noticeShape")}</strong><small>{$t("display.noticeShapeBody")}</small></span><select value={avatarTrayShape} onchange={(event)=>changeAvatarTrayShape((event.currentTarget as HTMLSelectElement).value as AvatarTrayShape)} disabled={!showAvatars||!showSpeech}>{#each AVATAR_TRAY_SHAPES as shape}<option value={shape}>{$t(`display.noticeShape.${shape}`)}</option>{/each}</select></label>
        <label><span><strong>{$t("display.scrollButton")}</strong><small>{$t("display.scrollButtonBody")}</small></span><input type="checkbox" bind:checked={scrollAutoSwitch}/></label>
        <label><span><strong>{$t("display.immersiveScroll")}</strong><small>{$t("display.immersiveScrollBody")}</small></span><input type="checkbox" bind:checked={immersiveScroll}/></label>
        <label><span><strong>{$t("display.enterToSend")}</strong><small>{$t("display.enterToSendBody")}</small></span><input type="checkbox" bind:checked={enterToSend}/></label>
        <label><span><strong>{$t("display.rememberLast")}</strong><small>{$t("display.rememberLastBody")}</small></span><input type="checkbox" bind:checked={rememberLast}/></label>
        <label><span><strong>{$t("display.hidePaths")}</strong><small>{$t("display.hidePathsBody")}</small></span><input type="checkbox" bind:checked={hideLocalPaths}/></label>
      </div>
      {/if}
      {#if displayTab==="notifications"}
      <div class="setting-switches">
        <label><span><strong>{$t("display.completionNotifications")}</strong><small>{$t("display.completionNotificationsBody")}</small></span><input type="checkbox" checked={notifications} onchange={handleCompletionNotificationsChange}/></label>
        <label><span><strong>{$t("display.approvalNotifications")}</strong><small>{$t("display.approvalNotificationsBody",{state:pushState})}</small></span><input type="checkbox" bind:checked={pushPreferences.approvals}/></label>
        <label><span><strong>{$t("display.userInputNotifications")}</strong><small>{$t("display.userInputNotificationsBody")}</small></span><input type="checkbox" bind:checked={pushPreferences.userInput}/></label>
        <label><span><strong>{$t("display.failureNotifications")}</strong><small>{$t("display.failureNotificationsBody")}</small></span><input type="checkbox" bind:checked={pushPreferences.failed}/></label>
        <label><span><strong>{$t("display.hostOfflineNotifications")}</strong><small>{$t("display.defaultOff")}</small></span><input type="checkbox" bind:checked={pushPreferences.hostOffline}/></label>
        <label><span><strong>{$t("display.handoffNotifications")}</strong><small>{$t("display.handoffNotificationsBody")}</small></span><input type="checkbox" bind:checked={pushPreferences.handoff}/></label>
        <label><span><strong>{$t("display.vibration")}</strong><small>{$t("display.vibrationBody")}</small></span><input type="checkbox" bind:checked={vibration}/></label>
        <label class="setting-choice"><span><strong>{$t("display.quietHours")}</strong><small>{$t("display.quietHoursBody")}</small></span><span class="quiet-hours"><input aria-label={$t("display.quietStart")} type="time" value={pushPreferences.quietStart??""} oninput={(event)=>pushPreferences.quietStart=(event.currentTarget as HTMLInputElement).value||null}/><span>–</span><input aria-label={$t("display.quietEnd")} type="time" value={pushPreferences.quietEnd??""} oninput={(event)=>pushPreferences.quietEnd=(event.currentTarget as HTMLInputElement).value||null}/></span></label>
      </div>
      <button class="danger-lite" onclick={disableAllPush}>{$t("display.disableAllNotifications")}</button>
      {/if}
      {/if}
      </div>
      {#if globalTab==="defaults"||globalTab==="characters"||globalTab==="display"}<div class="settings-save-row sticky"><span class:error={Boolean(globalSaveNotice)&&globalSaveNotice!==$t("settings.globalSaved")&&globalSaveNotice!==$t("settings.globalSavedPushSkipped")}>{globalSaveNotice||$t(globalDirty()?"settings.unsavedChanges":"settings.allSaved")}</span><button class="primary" onclick={saveGlobalSettings} disabled={globalSaving||delegationLoading||((globalCodexAutomation==="full"||globalClaudeAutomation==="full")&&!dangerConfirmed)}>{globalSaving?$t("common.saving"):$t("common.save")}</button></div>{/if}
    </div>
  </div>
{/if}

{#if settingsClosePrompt}
  <div class="modal-backdrop settings-close-backdrop" role="presentation">
    <div class="modal settings-close-dialog" role="alertdialog" aria-modal="true" aria-labelledby="settings-close-title" aria-describedby="settings-close-body">
      <header><h2 id="settings-close-title">{$t("settings.closeTitle")}</h2></header>
      <p id="settings-close-body">{$t("settings.closeBody")}</p>
      <div class="settings-close-actions">
        <button type="button" onclick={()=>settingsClosePrompt=false}>{$t("settings.keepEditing")}</button>
        <button type="button" class="discard" onclick={discardAndCloseGlobalSettings}>{$t("settings.discardClose")}</button>
        <button type="button" class="primary" disabled={globalSaving} onclick={saveAndCloseGlobalSettings}>{globalSaving?$t("common.saving"):$t("settings.saveClose")}</button>
      </div>
    </div>
  </div>
{/if}

{#if workspaceViewer}<WorkspaceViewer {api} workspace={workspaceViewer.workspace} initialFile={workspaceViewer.initialFile??null} initialEdit={workspaceViewer.initialEdit??false} sourceTaskId={workspaceViewer.sourceTaskId??null} relatedSessions={relatedWorkspaceSessions(workspaceViewer.workspace.id)} onopensession={openViewerSession} onlayoutchange={(state)=>workspaceViewerLayout=state} onclose={()=>{workspaceViewer=null;workspaceViewerLayout={layout:"window",reversed:false};}}/>{/if}

{#if createOpen}
  <div class="modal-backdrop" role="presentation"
    onpointerdown={(event)=>createBackdropPointer=beginBackdropPointer(event.target===event.currentTarget,event.clientX,event.clientY)}
    onpointermove={(event)=>{if(createBackdropPointer)createBackdropPointer=moveBackdropPointer(createBackdropPointer,event.clientX,event.clientY);}}
    onpointercancel={()=>createBackdropPointer=null}
    onclick={(event)=>{const dismiss=shouldDismissBackdrop(createBackdropPointer,event.target===event.currentTarget);createBackdropPointer=null;if(dismiss){createOpen=false;vscodeContext=null;}}}>
    <div class="modal create-panel" class:quick-create={quickCreate} role="dialog" aria-modal="true" aria-labelledby="new-title">
      <header><h2 id="new-title">{createKind==="parallel"||createKind==="review"?$t("create.newReview"):createKind==="conversation"?$t("create.newConversation"):$t("create.newTask")}</h2><button class="icon-button" aria-label={$t("a11y.closeDialog")} onclick={()=>{createOpen=false;vscodeContext=null;}}><X size={20}/></button></header>
      {#if quickCreate}
        <p class="quick-create-summary"><Zap size={16}/><span><strong>{$t("quick.title")}</strong><small>{providerDisplayName(createProvider)} · {workspaces.find(item=>item.id===createWorkspace)?.displayName??$t("workspace.noRegistered")}</small></span><button type="button" onclick={()=>quickCreate=false}>{$t("quick.advanced")}</button></p>
        {#if promptPresetConflict}<PromptPresetSyncNotice serverCount={promptPresetConflict.server.length} localCount={promptPresetConflict.local.length} mergedCount={promptPresetConflict.merged.length} droppedCount={promptPresetConflict.dropped.length} deletedCount={new Set([...promptPresetConflict.deletedOnServer,...promptPresetConflict.deletedOnLocal]).size} recovered={promptPresetConflict.degraded} busy={promptPresetSyncBusy} onuseserver={useServerPromptPresets} onmerge={mergePromptPresetConflict}/>{:else if promptPresetSyncNotice}<p class:preset-sync-info={promptPresetSyncNotice===$t("preset.serverRecovered")} class:preset-sync-error={promptPresetSyncNotice!==$t("preset.serverRecovered")}>{promptPresetSyncNotice}</p>{/if}
        <section class="prompt-presets"><header><strong>{$t("preset.title")}</strong><button type="button" disabled={!createPrompt.trim()||promptPresetSyncBusy||Boolean(promptPresetConflict)} onclick={savePromptPreset}>{$t("preset.saveCurrent")}</button></header><div>{#each allPromptPresets(customPromptPresets,$t) as preset}<span><button type="button" onclick={()=>createPrompt=preset.prompt}>{preset.label}</button>{#if customPromptPresets.some(item=>item.id===preset.id)}<button type="button" class="preset-delete" disabled={promptPresetSyncBusy||Boolean(promptPresetConflict)} aria-label={$t("preset.delete",{name:preset.label})} onclick={()=>deletePromptPreset(preset.id)}>×</button>{/if}</span>{/each}</div></section>
        <label>{$t("conversation.request")}<textarea bind:value={createPrompt} rows="7" maxlength="20000" placeholder={$t("create.requestPlaceholder")} onkeydown={submitCreateKey} onpaste={(event)=>void createAttachRef?.handlePaste(event)}></textarea></label>
        {#if createPrompt.trim()}<div class="intake-recommendation"><span><strong>{$t("recommend.title")}</strong><small>{$t(`recommend.${intakeRecommendation.reason}`)} · {intakeRecommendation.kind==="review"?$t("create.review"):(intakeRecommendation.provider==="codex"?"Codex":"Claude")}</small></span><button type="button" onclick={applyIntakeRecommendation}>{$t("recommend.apply")}</button></div>{/if}
        <div class="attach-row"><AttachBar bind:this={createAttachRef} bind:attachments={createAttachments} disabled={sending}/><span class="attach-hint">{$t("attachment.hint")}</span></div>
        {#if providerConnectionPhase==="none"}{@render providerConnectionsEmpty()}{/if}
        {#if createError}<p class="create-error" role="alert">{createError}</p>{/if}
        {@const quickQuota=quota?.[createProvider]}<div class="quota-reservation-preview"><strong>{providerDisplayName(createProvider)} · {$t("quotaReservation.currentUsage")}</strong>{#if quickQuota?.quotaMode==="vertex-credit"}<span>{$t("antigravityExecution.vertexCreditTitle")} · {$t("antigravityExecution.vertexQuotaScope",{project:quickQuota.projectId,location:quickQuota.location})}</span>{:else if quickQuota?.fiveHour||quickQuota?.sevenDay}{#if quickQuota?.fiveHour}<span>{$t("quota.fiveHours")} {quotaPct(quickQuota.fiveHour.pct)}%{#if quickQuota.fiveHour.resetsAt} · {fmtReset(quickQuota.fiveHour.resetsAt,quickQuota.fiveHour.resetLabel)}{/if}</span>{/if}{#if quickQuota?.sevenDay}<span>{$t("quota.weekly")} {quotaPct(quickQuota.sevenDay.pct)}%{#if quickQuota.sevenDay.resetsAt} · {fmtReset(quickQuota.sevenDay.resetsAt,quickQuota.sevenDay.resetLabel)}{/if}</span>{/if}{:else if quickQuota?.balance}<span>{$t("quota.balance")} {formatCurrency(quickQuota.balance.total,quickQuota.balance.currency,$locale)}</span>{:else}<span>{$t("quota.noData")}</span>{/if}</div>
        <div class="create-submit-actions"><button class="primary" onclick={()=>createTask()} disabled={!createPrompt.trim()||!createWorkspace||createOpening||sending||createConnectionBlocked||(isConnectionAuthProvider(createProvider)&&Boolean(activeAuthAttempt(createProvider)))}><Zap size={18}/>{sending?$t("task.creating"):$t("quotaReservation.startNow")}</button>{#if createProvider==="codex"||createProvider==="claude"}<button onclick={reserveTask} disabled={!createPrompt.trim()||!createWorkspace||createOpening||sending||createConnectionBlocked||(isConnectionAuthProvider(createProvider)&&Boolean(activeAuthAttempt(createProvider)))}><Clock3 size={18}/>{$t("quotaReservation.afterReset")}</button>{/if}</div>
      {:else}
      <div class="create-kinds" role="group" aria-label={$t("create.sessionType")}>
        <button type="button" aria-label={$t("create.single")} class:active={createKind==="single"} onclick={()=>chooseCreateKind("single")}>{$t("create.single")}</button>
        <button type="button" aria-label={$t("create.review")} class:active={createKind==="parallel"||createKind==="review"} onclick={chooseReviewKind}>{$t("create.review")}</button>
        <button type="button" aria-label={$t("create.conversation")} class:active={createKind==="conversation"} onclick={()=>chooseCreateKind("conversation")}>{$t("create.conversation")}</button>
      </div>

      <p class="create-say">{#each createSayParts as part}{#if part.kind==="text"}<span>{part.value}</span>{:else}<button type="button" class="say-tok" class:mono={part.name==="workspace"||part.name==="turns"} class:danger={part.name==="automation"&&createKind==="single"&&createAutomationFor(createProvider)==="full"||part.name==="finish"&&reviewFixesEnabled()} onclick={()=>revealCreateField(createSayTarget(part.name))}>{part.value}</button>{/if}{/each}</p>

      {#if createKind==="single"}
        <section class="cblk" id="create-provider">
          <h4 class="cover">{$t("create.sectionEngine")}</h4>
          {#if providerConnectionPhase==="loading"}
            {@render providerConnectionsPending()}
          {:else if providerConnectionPhase==="none"}
            {@render providerConnectionsEmpty()}
          {:else}
            <div class="cf" role="group" aria-label={$t("create.engine")}><span class="cf-n">{$t("create.engine")}</span><div class="sel">{#each creatableProviders as typedProvider}<button type="button" aria-label={providerDisplayName(typedProvider)} class:active={createProvider===typedProvider} onclick={()=>createProvider=typedProvider}>{providerDisplayName(typedProvider)}</button>{/each}</div></div>
          {/if}
          <!-- Engine-specific model and permission options only make sense once an engine can actually be chosen. -->
          {#if providerConnectionPhase==="ready"}
          {#if isConnectionAuthProvider(createProvider)&&(providerAccounts.find(item=>item.provider===createProvider)?.state==="disconnected"||isActiveAuthAttempt(authAttempts[createProvider])||authFeedback[createProvider]?.tone==="success")}{@render inlineProviderAuth(createProvider,"create")}{/if}
          {#if createOpening}
            <div class="create-options-loading" role="status"><LoaderCircle class="spin" size={17}/><span>{$t("model.loading")}</span></div>
          {:else if createProvider==="codex"}
            <div class="cf" role="group" aria-label={$t("model.label")}><span class="cf-n">{$t("model.label")}</span><div class="chips">{#each availableCodexModels() as m}<button type="button" aria-label={m.displayName} class:active={createModel===m.id} onclick={()=>{createModel=m.id;createModelChanged();}}>{m.displayName}</button>{/each}</div></div>
            <div class="cf" role="group" aria-label={$t("model.reasoningEffort")}><span class="cf-n">{$t("model.reasoningEffort")}</span><div class="sel">{#each createModelInfo()?.supportedReasoningEfforts??[] as e}<button type="button" class:active={createEffort===e.reasoningEffort} onclick={()=>createEffort=e.reasoningEffort}>{effortLabel(e.reasoningEffort)}</button>{/each}</div></div>
            {#if createModelInfo()?.serviceTiers?.some((x:any)=>x.id==="priority")}<div class="cf" role="group" aria-label={$t("model.speed")}><span class="cf-n">{$t("model.speed")}</span><div class="sel"><button type="button" class:active={createTier===null} onclick={()=>createTier=null}>{$t("model.standard")}</button><button type="button" class:active={createTier==="priority"} onclick={()=>createTier="priority"}>{$t("model.fastUsage")}</button></div></div>{/if}
          {:else if createProvider==="claude"}
            <div class="cf" role="group" aria-label={$t("model.label")}><span class="cf-n">{$t("model.label")}</span><div class="chips">{#each availableClaudeModels() as m}<button type="button" aria-label={m.displayName} class:active={createClaudeModel===m.id} onclick={()=>createClaudeModel=m.id}>{m.displayName}</button>{/each}</div></div>
            <div class="cf" role="group" aria-label={$t("model.reasoningEffort")}><span class="cf-n">{$t("model.reasoningEffort")}</span><div class="sel">{#each claudeEfforts as e}<button type="button" class:active={createClaudeEffort===e.id} onclick={()=>createClaudeEffort=e.id}>{$t(`session.effort.${e.id}`)}</button>{/each}</div></div>
          {:else if createProvider==="grok"}
            <div class="cf" role="group" aria-label={$t("model.label")}><span class="cf-n">{$t("model.label")}</span><div class="chips">{#each availableCompatibleModels("grok") as m}<button type="button" aria-label={m.displayName} class:active={createGrokModel===m.id} onclick={()=>createGrokModel=m.id}>{m.displayName}</button>{/each}</div></div>
            <label class="cf">{$t("model.reasoningEffort")}<select value={createCompatibleEfforts.grok} onchange={(event)=>createCompatibleEfforts={...createCompatibleEfforts,grok:(event.currentTarget as HTMLSelectElement).value}}>{#each compatibleEffortOptions("grok") as effort}<option value={effort.id}>{$t(`session.effort.${effort.id}`)}</option>{/each}</select></label>
            {#if !availableCompatibleModels("grok").length}<p class="field-warning">{$t("provider.grokUnavailable")}</p>{/if}
          {:else if createProvider==="deepseek"}
            <div class="cf" role="group" aria-label={$t("model.label")}><span class="cf-n">{$t("model.label")}</span><div class="chips">{#each availableCompatibleModels("deepseek") as m}<button type="button" aria-label={m.displayName} class:active={createDeepseekModel===m.id} onclick={()=>createDeepseekModel=m.id}>{m.displayName}</button>{/each}</div></div>
            <label class="cf">{$t("model.reasoningEffort")}<select value={createCompatibleEfforts.deepseek} onchange={(event)=>createCompatibleEfforts={...createCompatibleEfforts,deepseek:(event.currentTarget as HTMLSelectElement).value}}>{#each compatibleEffortOptions("deepseek") as effort}<option value={effort.id}>{$t(`session.effort.${effort.id}`)}</option>{/each}</select></label>
            <p class="field-help">{$t("provider.deepseekApiHelp")}</p>
          {:else if createProvider==="ollama"}
            <div class="cf" role="group" aria-label={$t("model.label")}><span class="cf-n">{$t("model.label")}</span><div class="chips">{#each availableCompatibleModels("ollama") as m}<button type="button" aria-label={m.displayName} class:active={createOllamaModel===m.id} onclick={()=>createOllamaModel=m.id}>{m.displayName}</button>{/each}</div></div>
            <label class="cf">{$t("model.reasoningEffort")}<select value={createCompatibleEfforts.ollama} onchange={(event)=>createCompatibleEfforts={...createCompatibleEfforts,ollama:(event.currentTarget as HTMLSelectElement).value}}>{#each compatibleEffortOptions("ollama") as effort}<option value={effort.id}>{$t(`session.effort.${effort.id}`)}</option>{/each}</select></label>
            {#if !availableCompatibleModels("ollama").length}<p class="field-warning">{$t("provider.ollamaUnavailable")}</p>{/if}
          {:else if createProvider==="antigravity"}
            <p class="field-help"><strong>{$t(antigravityExecution.backend==="vertex-agent"?"antigravityExecution.createVertexAgent":antigravityExecution.backend==="vertex"?"antigravityExecution.createVertex":"antigravityExecution.createConsumer",{project:antigravityExecution.vertex.projectId,location:antigravityExecution.vertex.location})}</strong>{#if antigravityUsesVertex}<br/>{$t("antigravityExecution.vertexCreditBody")}{/if}</p>
            <div class="cf" role="group" aria-label={$t("model.label")}><span class="cf-n">{$t("model.label")}</span><div class="chips">{#each availableCompatibleModels("antigravity") as m}<button type="button" aria-label={m.displayName} class:active={createAntigravityModel===m.id} onclick={()=>createAntigravityModel=m.id}>{m.displayName}</button>{/each}</div></div>
            <label class="cf">{$t("model.reasoningEffort")}<select value={createCompatibleEfforts.antigravity} onchange={(event)=>createCompatibleEfforts={...createCompatibleEfforts,antigravity:(event.currentTarget as HTMLSelectElement).value}}>{#each compatibleEffortOptions("antigravity") as effort}<option value={effort.id}>{$t(`session.effort.${effort.id}`)}</option>{/each}</select></label>
            {#if antigravityExecution.backend==="vertex"}<div class="cf" role="group" aria-label={$t("vertexSearch.label")}><span class="cf-n">{$t("vertexSearch.label")}</span><div class="chips" role="group" aria-label={$t("vertexSearch.label")}><button type="button" class:active={createGoogleSearchMode==="off"} onclick={()=>createGoogleSearchMode="off"}>{$t("vertexSearch.off")}</button><button type="button" class:active={createGoogleSearchMode==="auto"} onclick={()=>createGoogleSearchMode="auto"}>{$t("vertexSearch.auto")}</button><button type="button" class:active={createGoogleSearchMode==="always"} onclick={()=>createGoogleSearchMode="always"}>{$t("vertexSearch.always")}</button></div></div><p class="field-help">{$t("vertexSearch.retentionNotice")}</p>{/if}
            {#if !availableCompatibleModels("antigravity").length}<p class="field-warning">{$t("provider.antigravityUnavailable")}</p>{/if}
          {/if}
          {/if}
        </section>

        {#if providerConnectionPhase==="ready"}
        <section class="cblk" id="create-automation">
          <h4 class="cover">{$t("create.permissionSection")}{#if createAutomationNow==="full"}<span class="r danger">{$t("create.hardToUndo")}</span>{/if}</h4>
          <div class="cf" role="group" aria-label={$t("workMode.label")} id="create-workmode"><span class="cf-n">{$t("workMode.label")}</span><div class="sel">{#each ["default","plan"] as const as mode}<button type="button" class:active={createWorkModeNow===mode} onclick={()=>chooseCreateWorkMode(createProvider,mode)}>{workModeLabel(mode)}</button>{/each}</div></div>
          <div class="cf" role="group" aria-label={$t("automation.level")}><span class="cf-n">{$t("automation.level")}</span><div class="sel">{#each AUTOMATION_ORDER as level}<button type="button" class:active={createAutomationNow===level} class:danger={level==="full"} disabled={createProvider==="claude"&&level==="confirm"} title={createProvider==="claude"&&level==="confirm"?$t("permission.claudeConfirmUnavailable"):undefined} onclick={()=>chooseCreateAutomation(createProvider,level)}>{automationLabel(level)}</button>{/each}</div><small class="field-help">{automationDescription(createAutomationNow)}</small></div>
          {#if createAutomationNow==="full"&&!dangerAcknowledged}
            <div class="chaz"><div class="chaz-stripe"></div><div class="chaz-body"><span>{$t("create.dangerBand")}</span><label class="danger-confirm"><input type="checkbox" bind:checked={dangerConfirmed} onchange={()=>dangerConfirmed&&recordDangerAcknowledgement()}/>{$t("permission.fullAutoRiskAcknowledge")}</label></div></div>
          {/if}
        </section>
        {/if}
      {:else}
        <div class="collaboration-create-options">
          <p>{$t(createKind==="conversation"?"create.conversationParticipantsBody":"create.reviewParticipantsBody")}</p>

          {#if createKind==="conversation"}
            <section class="cblk" id="create-provider">
              <h4 class="cover">{$t("conversation.participants")}<span class="r">{$t("create.participantCount",{count:conversationParticipants.length})}</span></h4>
              {#if providerConnectionPhase==="loading"}
                {@render providerConnectionsPending()}
              {:else if providerConnectionPhase==="none"}
                {@render providerConnectionsEmpty()}
              {:else}
                <div class="chips">{#each creatableProviders as provider}<button type="button" class:active={conversationEnabled[provider]} onclick={()=>toggleConversationProvider(provider)}>{providerDisplayName(provider)}</button>{/each}</div>
                <p class="debate-readonly">{$t("conversation.readOnlyBody")}</p>
                <div class="cf" role="group" aria-label={$t("create.firstResponder")}><span class="cf-n">{$t("create.firstResponder")}</span><div class="sel">{#each conversationParticipants as provider}<button type="button" aria-label={providerDisplayName(provider)} class:active={conversationFirstProvider===provider} onclick={()=>conversationFirstProvider=provider}>{providerDisplayName(provider)}</button>{/each}</div></div>
              {/if}
              <label class="cf">{$t("conversation.userNickname")}<span class="cinp"><span>@</span><input bind:value={conversationUserNickname} maxlength="40" placeholder={$t("conversation.userDefault")}/></span><small class="field-help">{$t("conversation.userNicknameBody")}</small></label>

              {#each conversationParticipants as provider}
                <div class="cwho" data-provider={provider}>
                  <h5>{providerDisplayName(provider)}{#if conversationFirstProvider===provider}<em>{$t("create.firstResponderBadge")}</em>{/if}</h5>
                  {#if provider==="codex"}
                    <label class="cf">{$t("model.label")}<select bind:value={conversationCodexModel} onchange={conversationCodexModelChanged}>{#each availableCodexModels() as model}<option value={model.id}>{modelLabel(model)}</option>{/each}</select></label>
                    <label class="cf">{$t("model.reasoningEffort")}<select bind:value={conversationCodexEffort}>{#each conversationCodexModelInfo()?.supportedReasoningEfforts??[] as effort}<option value={effort.reasoningEffort}>{effortLabel(effort.reasoningEffort)}</option>{/each}</select></label>
                  {:else if provider==="claude"}
                    <label class="cf">{$t("model.label")}<select bind:value={conversationClaudeModel}>{#each availableClaudeModels() as model}<option value={model.id}>{modelLabel(model)}</option>{/each}</select></label>
                    <label class="cf">{$t("model.reasoningEffort")}<select bind:value={conversationClaudeEffort}>{#each claudeEfforts as effort}<option value={effort.id}>{$t(`session.effort.${effort.id}`)}</option>{/each}</select></label>
                  {:else}
                    <label class="cf">{$t("model.label")}<select bind:value={conversationCompatibleModels[provider]}>{#each availableCompatibleModels(provider) as model}<option value={model.id}>{model.displayName}</option>{/each}</select></label>
                    <label class="cf">{$t("model.reasoningEffort")}<select bind:value={conversationCompatibleEfforts[provider]}>{#each compatibleEffortOptions(provider) as effort}<option value={effort.id}>{$t(`session.effort.${effort.id}`)}</option>{/each}</select></label>
                  {/if}
                  <div class="cf">
                    <span class="cf-n">{$t("character.toneLabel")}</span>
                    <button type="button" class="cpick-field" aria-label={$t("character.toneLabel")} onclick={(event)=>{event.stopPropagation();openToneSheet(provider,"conversation");}}>
                      <span class="cpick-value">{conversationToneRows[provider].name}</span>
                      <span class="cpick-tag" class:override={conversationToneRows[provider].override}>{conversationToneRows[provider].scope}</span>
                      <ChevronDown size={16}/>
                    </button>
                  </div>
                </div>
              {/each}
            </section>

            <section class="cblk" id="create-flow">
              <h4 class="cover">{$t("create.sectionProgress")}</h4>
              <div class="cf" role="group" aria-label={$t("conversation.flow")}><span class="cf-n">{$t("conversation.flow")}</span><div class="sel"><button type="button" aria-label={$t("collaboration.flow.guided")} class:active={conversationFlow==="guided"} onclick={()=>conversationFlow="guided"}>{$t("collaboration.flow.guided")}</button><button type="button" aria-label={$t("collaboration.flow.automatic")} class:active={conversationFlow==="automatic"} onclick={()=>conversationFlow="automatic"}>{$t("collaboration.flow.automatic")}</button></div></div>
              {#if conversationFlow==="automatic"}<div class="cf" role="group" aria-label={$t("conversation.modelUserCall")}><span class="cf-n">{$t("conversation.modelUserCall")}</span><div class="sel" role="group" aria-label={$t("conversation.modelUserCallPolicy")}><button type="button" class:active={!conversationAllowModelUserCall} aria-pressed={!conversationAllowModelUserCall} onclick={()=>conversationAllowModelUserCall=false}>{$t("common.disallow")}</button><button type="button" class:active={conversationAllowModelUserCall} aria-pressed={conversationAllowModelUserCall} onclick={()=>conversationAllowModelUserCall=true}>{$t("common.allow")}</button></div><small class="field-help">{$t("conversation.modelUserCallBody")}</small></div>{/if}
              <div class="cf" role="group" aria-label={$t("conversation.length")}><span class="cf-n">{$t("conversation.length")}</span><div class="sel" role="group" aria-label={$t("conversation.length")}><button type="button" class:active={conversationTurnLength==="compact"} aria-pressed={conversationTurnLength==="compact"} onclick={()=>conversationTurnLength="compact"}>{$t("collaboration.length.compact")}</button><button type="button" class:active={conversationTurnLength==="rich"} aria-pressed={conversationTurnLength==="rich"} onclick={()=>conversationTurnLength="rich"}>{$t("collaboration.length.rich")}</button></div><small class="field-help">{$t("conversation.lengthBody")}</small></div>
              <label class="cf" id="create-turns">{$t(conversationFlow==="automatic"?"conversation.maxRoundsPerModel":"conversation.maxRounds")}
                <span class="cstep">
                  <button type="button" aria-label="−" disabled={debateUnlimited} onclick={()=>setCreateTurns(debateMaxTurns-1)}>−</button>
                  <input type="text" inputmode="numeric" disabled={debateUnlimited} aria-label={$t("conversation.maxRounds")} value={debateMaxTurns} onchange={(event)=>{setCreateTurns(Number((event.currentTarget as HTMLInputElement).value.replace(/[^0-9]/g,"")));(event.currentTarget as HTMLInputElement).value=String(debateMaxTurns);}}/>
                  <button type="button" aria-label="+" disabled={debateUnlimited} onclick={()=>setCreateTurns(debateMaxTurns+1)}>+</button>
                  <button type="button" class="cstep-flag" class:active={debateUnlimited} aria-pressed={debateUnlimited} onclick={()=>debateUnlimited=!debateUnlimited}>{$t("conversation.unlimited")}</button>
                </span>
                <small class="field-help">{$t("create.turnLimitHint")}</small>
              </label>
              {#if debateUnlimited}<div class="chaz"><div class="chaz-stripe"></div><div class="chaz-body"><span><strong>{$t("conversation.unlimitedCostWarning")}</strong> {$t("conversation.unlimitedLimitBody")}</span><label class="danger-confirm"><input type="checkbox" bind:checked={debateUnlimitedConfirmed}/>{$t("conversation.unlimitedAcknowledge")}</label></div></div>{/if}
            </section>

            <section class="cblk">
              <h4 class="cover">{$t("create.sectionOptions")}<span class="r">{$t("create.optional")}</span></h4>
              <label class="cswitch"><span><b>{$t("conversation.reviewTools")}</b><small>{$t("conversation.reviewToolsBody")}</small></span><input type="checkbox" checked={debateKind==="artifact-review"} onchange={(event)=>debateKind=(event.currentTarget as HTMLInputElement).checked?"artifact-review":"discussion"}/></label>
              <label class="cswitch"><span><b>{$t("conclusion.requestAtCreation")}</b><small>{$t("conclusion.creationBody")}</small></span><input type="checkbox" bind:checked={conversationConclusionRequested}/></label>
              {#if conversationConclusionRequested}<label class="cf">{$t("conclusion.path")}<input bind:value={conversationConclusionPath} maxlength="1024" placeholder={$t("conclusion.pathPlaceholder")}/></label>{/if}
              <label class="cf">{$t("common.totalTimeoutMinutes")}<input type="number" min="1" max="480" bind:value={conversationTimeoutMinutes}/></label>
            </section>
          {:else}
            <section class="cblk" id="create-method">
              <h4 class="cover">{$t("review.method")}</h4>
              <div class="review-method-options" role="radiogroup" aria-label={$t("review.method")}><button type="button" role="radio" aria-checked={createKind==="parallel"} class:active={createKind==="parallel"} onclick={()=>chooseCreateKind("parallel")}><strong>{$t("collaboration.mode.independentReview")}</strong><small>{$t("review.independentBody")}</small></button><button type="button" role="radio" aria-checked={createKind==="review"} class:active={createKind==="review"} onclick={()=>chooseCreateKind("review")}><strong>{$t("collaboration.mode.crossReview")}</strong><small>{$t("review.crossBody")}</small></button></div>
              {#if createKind==="review"}<div class="cf" role="group" aria-label={$t("review.depth")}><span class="cf-n">{$t("review.depth")}</span><div class="sel"><button type="button" class:active={reviewDepth==="basic"} onclick={()=>reviewDepth="basic"}>{$t("review.basic")}</button><button type="button" class:active={reviewDepth==="deep"} onclick={()=>reviewDepth="deep"}>{$t("review.deep")}</button></div><small class="field-help">{$t(reviewDepth==="basic"?"review.basicBody":"review.deepBody")}</small></div>{/if}
            </section>

            <section class="cblk" id="create-provider">
              <h4 class="cover">{$t("conversation.participants")}<span class="r">{$t("create.participantCount",{count:activeReviewParticipants.length})}</span></h4>
              {#if providerConnectionPhase==="loading"}
                {@render providerConnectionsPending()}
              {:else if providerConnectionPhase==="none"}
                {@render providerConnectionsEmpty()}
              {:else}
                <div class="chips">{#each creatableProviders as provider}<button type="button" class:active={reviewEnabled[provider]} onclick={()=>toggleReviewProvider(provider)}>{providerDisplayName(provider)}</button>{/each}</div>
                <small class="field-help">{$t("review.participantsBody")}</small>
                {#if creatableProviders.length<2}<p class="field-warning">{$t("review.needsTwoConnected")}</p>{/if}
                <div class="cf" role="group" aria-label={$t(createKind==="review"?"create.finalPrimary":"create.firstDisplay")}><span class="cf-n">{$t(createKind==="review"?"create.finalPrimary":"create.firstDisplay")}</span><div class="sel">{#each activeReviewParticipants as provider}<button type="button" aria-label={providerDisplayName(provider)} class:active={createProvider===provider} onclick={()=>createProvider=provider}>{providerDisplayName(provider)}</button>{/each}</div></div>
              {/if}

              {#each activeReviewParticipants as provider}
                <div class="cwho" data-provider={provider}>
                  <h5>{providerDisplayName(provider)}{#if createProvider===provider}<em>{$t("create.finalPrimaryBadge")}</em>{/if}</h5>
                  {#if provider==="codex"}
                    <label class="cf">{$t("model.label")}<select bind:value={createModel} onchange={createModelChanged}>{#each availableCodexModels() as model}<option value={model.id}>{modelLabel(model)}</option>{/each}</select></label>
                    <label class="cf">{$t("model.reasoningEffort")}<select bind:value={createEffort}>{#each createModelInfo()?.supportedReasoningEfforts??[] as effort}<option value={effort.reasoningEffort}>{effortLabel(effort.reasoningEffort)}</option>{/each}</select></label>
                    {#if createModelInfo()?.serviceTiers?.some((item:any)=>item.id==="priority")}<div class="cf" role="group" aria-label={$t("model.speed")}><span class="cf-n">{$t("model.speed")}</span><div class="sel"><button type="button" class:active={createTier===null} onclick={()=>createTier=null}>{$t("model.standard")}</button><button type="button" class:active={createTier==="priority"} onclick={()=>createTier="priority"}>{$t("session.fastUsage")}</button></div></div>{/if}
                  {:else if provider==="claude"}
                    <label class="cf">{$t("model.label")}<select bind:value={createClaudeModel}>{#each availableClaudeModels() as model}<option value={model.id}>{modelLabel(model)}</option>{/each}</select></label>
                    <label class="cf">{$t("model.reasoningEffort")}<select bind:value={createClaudeEffort}>{#each claudeEfforts as effort}<option value={effort.id}>{$t(`session.effort.${effort.id}`)}</option>{/each}</select></label>
                  {:else}
                    {@const compatible=provider as CompatibleExecutionProvider}
                    <label class="cf">{$t("model.label")}<select value={createCompatibleModel(compatible)} onchange={(event)=>setCreateCompatibleModel(compatible,(event.currentTarget as HTMLSelectElement).value)}>{#each availableCompatibleModels(compatible) as model}<option value={model.id}>{model.displayName}</option>{/each}</select></label>
                    <label class="cf">{$t("model.reasoningEffort")}<select value={createCompatibleEfforts[compatible]} onchange={(event)=>createCompatibleEfforts={...createCompatibleEfforts,[compatible]:(event.currentTarget as HTMLSelectElement).value}}>{#each compatibleEffortOptions(compatible) as effort}<option value={effort.id}>{$t(`session.effort.${effort.id}`)}</option>{/each}</select></label>
                  {/if}
                  <div class="cf">
                    <span class="cf-n">{$t("character.toneLabel")}</span>
                    <button type="button" class="cpick-field" aria-label={$t("character.toneLabel")} onclick={(event)=>{event.stopPropagation();openToneSheet(provider,"review");}}>
                      <span class="cpick-value">{reviewToneRows[provider].name}</span>
                      <span class="cpick-tag" class:override={reviewToneRows[provider].override}>{reviewToneRows[provider].scope}</span>
                      <ChevronDown size={16}/>
                    </button>
                  </div>
                  <div class="cf" role="group" aria-label={$t("automation.level")}><span class="cf-n">{$t("automation.level")}</span><div class="sel">{#each AUTOMATION_ORDER as level}<button type="button" class:active={createAutomations[provider]===level} class:danger={level==="full"} disabled={provider==="claude"&&level==="confirm"} title={provider==="claude"&&level==="confirm"?$t("permission.claudeConfirmUnavailable"):undefined} onclick={()=>chooseReviewAutomation(provider,level)}>{automationLabel(level)}</button>{/each}</div></div>
                </div>
              {/each}
            </section>

            <section class="cblk" id="create-finish">
              <h4 class="cover">{$t("review.finalization")}</h4>
              {#if createKind==="review"}
                <div class="review-method-options"><button type="button" class:active={reviewFinalization==="primary"} onclick={()=>reviewFinalization="primary"}><strong>{$t("review.primaryTitle")}</strong><small>{$t("review.primaryBody")}</small></button><button type="button" class:active={reviewFinalization==="side-by-side"} onclick={()=>reviewFinalization="side-by-side"}><strong>{$t("review.sideBySideTitle")}</strong><small>{$t("review.sideBySideBody")}</small></button><button type="button" class:active={reviewFinalization==="raw"} onclick={()=>reviewFinalization="raw"}><strong>{$t("review.rawTitle")}</strong><small>{$t("review.rawBody")}</small></button></div>
                {#if reviewFinalization==="primary"}<label class="cswitch"><span><b>{$t("review.applyFixes")}</b>{#if reviewPrimaryReadOnly}<small class="field-warning">{$t("review.readOnlyFixWarning")}</small>{/if}</span><input type="checkbox" bind:checked={reviewApplyFixes} disabled={reviewPrimaryReadOnly}/></label>{/if}
              {/if}
              <div class="cplan">
                <p class="cplan-title">{$t("create.runPlan")}</p>
                {#each activeReviewParticipants as provider,index}<p class="cplan-step"><i>{index+1}</i><b>{providerDisplayName(provider)}</b><span>{$t("create.review")} · {automationLabel(createAutomations[provider])}</span></p>{/each}
                {#if createKind==="review"&&reviewFinalization==="primary"}<p class="cplan-step"><i>{activeReviewParticipants.length+1}</i><b>{providerDisplayName(createProvider)}</b><span>{$t(reviewFixesNow?"create.sayFinishFix":"create.sayFinishReport")}</span></p>{/if}
                <p class="cplan-foot">{$t("review.executionSummary",{result:$t(reviewFixesNow?"review.primaryFixesLast":"review.resultsOnly"),count:reviewCallCountNow})}</p>
              </div>
              {#if reviewHasFullAuto}<div class="chaz"><div class="chaz-stripe"></div><div class="chaz-body"><span>{$t(reviewFixesNow&&createAutomations[createProvider]==="full"?"review.fullAutoExternalBody":"review.fullAutoWorkspaceBody")}</span>{#if !dangerAcknowledged}<label class="danger-confirm"><input type="checkbox" bind:checked={dangerConfirmed} onchange={()=>dangerConfirmed&&recordDangerAcknowledgement()}/>{$t("review.fullAutoAcknowledge")}</label>{/if}</div></div>{/if}
              <label class="cf">{$t("common.totalTimeoutMinutes")}<input type="number" min="1" max="480" bind:value={collaborationTimeoutMinutes}/></label>
            </section>
          {/if}
        </div>
      {/if}

      <section class="cblk" id="create-workspace" aria-busy={createLocationLoading}>
        <h4 class="cover">{$t("create.workLocation")}</h4>
        <button type="button" class="cpick" aria-expanded={createLocationOpen} onclick={()=>createLocationOpen=!createLocationOpen}>
          <span><b>{createLocationSummary}</b><small class="mono">{workspaces.find(item=>item.id===createWorkspace)?.canonicalPath??""}</small></span>
          <span class="v">{#if createLocationOpen}<ChevronUp size={16}/>{:else}<ChevronDown size={16}/>{/if}</span>
        </button>
        {#if createLocationOpen||createLocationLoading}
          {#if createLocationLoading}
            <div class="create-location-loading" role="status"><LoaderCircle class="spin" size={18}/><span><strong>{$t("create.loadingLocations")}</strong><small>{$t("create.loadingLocationsBody")}</small></span></div>
          {:else}
            <div class="cf" role="group" aria-label={$t("create.executionLocation")}><span class="cf-n">{$t("create.executionLocation")}</span><div class="host-choice-grid">{#each hosts as item}<button type="button" class:active={createHost===item.id} disabled={createLocationLoading||item.status!=="online"} onclick={()=>{createHost=item.id;syncCreateWorkspace();}}><strong>{executionHostName(item)}</strong><small>{item.platform} · {$t(`status.${item.status}`)}{item.lastSeenAt?` · ${ago(item.lastSeenAt)}`:""}</small></button>{/each}</div></div>
            <div class="cf" role="group" aria-label={$t("create.workLocation")}><span class="cf-n">{$t("create.workLocation")}</span><div class="workspace-choice-grid">{#each createLocations() as workspace}<button type="button" class:active={createWorkspace===workspace.id} onclick={()=>{createProject=workspace.projectId;createWorkspace=workspace.id;}}><strong>{projectName(workspace.projectId)}</strong><small>{workspace.canonicalPath}</small></button>{/each}</div></div>
            {#if createLocationError}<div class="create-location-error"><small class="field-warning" title={createLocationError}>{$t("create.locationLoadFailed")}</small><button type="button" onclick={loadCreateLocations}>{$t("common.retry")}</button></div>{:else if !createLocations().length}<small class="field-warning">{$t("workspace.noRegistered")}</small>{/if}
          {/if}
        {/if}
      </section>

      {#if vscodeContext}
        <section class="vscode-context-preview">
          <header><strong>{$t("vscode.contextTitle")}</strong><span>{vscodeContext.languageId||"text"} · {vscodeContext.startLine+1}:{vscodeContext.startColumn+1}–{vscodeContext.endLine+1}:{vscodeContext.endColumn+1}</span></header>
          <code>{vscodeContext.filePath}</code>
          <small>{$t("vscode.contextSummary",{selection:vscodeContext.selectedText.length,diagnostics:vscodeContext.diagnostics.length})}</small>
        </section>
      {/if}
      {#if promptPresetConflict}<PromptPresetSyncNotice serverCount={promptPresetConflict.server.length} localCount={promptPresetConflict.local.length} mergedCount={promptPresetConflict.merged.length} droppedCount={promptPresetConflict.dropped.length} deletedCount={new Set([...promptPresetConflict.deletedOnServer,...promptPresetConflict.deletedOnLocal]).size} recovered={promptPresetConflict.degraded} busy={promptPresetSyncBusy} onuseserver={useServerPromptPresets} onmerge={mergePromptPresetConflict}/>{:else if promptPresetSyncNotice}<p class:preset-sync-info={promptPresetSyncNotice===$t("preset.serverRecovered")} class:preset-sync-error={promptPresetSyncNotice!==$t("preset.serverRecovered")}>{promptPresetSyncNotice}</p>{/if}
      <section class="prompt-presets"><header><strong>{$t("preset.title")}</strong><button type="button" disabled={!createPrompt.trim()||promptPresetSyncBusy||Boolean(promptPresetConflict)} onclick={savePromptPreset}>{$t("preset.saveCurrent")}</button></header><div>{#each allPromptPresets(customPromptPresets,$t) as preset}<span><button type="button" onclick={()=>createPrompt=preset.prompt}>{preset.label}</button>{#if customPromptPresets.some(item=>item.id===preset.id)}<button type="button" class="preset-delete" disabled={promptPresetSyncBusy||Boolean(promptPresetConflict)} aria-label={$t("preset.delete",{name:preset.label})} onclick={()=>deletePromptPreset(preset.id)}>×</button>{/if}</span>{/each}</div></section>
      <label>{createKind==="parallel"||createKind==="review"?$t("create.reviewTarget"):$t("conversation.request")}<textarea bind:value={createPrompt} rows="7" maxlength="20000" placeholder={createKind==="parallel"||createKind==="review"?$t("create.reviewPlaceholder"):$t("create.requestPlaceholder")} onkeydown={submitCreateKey} onpaste={(event)=>void createAttachRef?.handlePaste(event)}></textarea></label>
      {#if createPrompt.trim()}<div class="intake-recommendation"><span><strong>{$t("recommend.title")}</strong><small>{$t(`recommend.${intakeRecommendation.reason}`)} · {intakeRecommendation.kind==="review"?$t("create.review"):(intakeRecommendation.provider==="codex"?"Codex":"Claude")}</small></span><button type="button" onclick={applyIntakeRecommendation}>{$t("recommend.apply")}</button></div>{/if}
      <div class="attach-row"><AttachBar bind:this={createAttachRef} bind:attachments={createAttachments} disabled={sending}/><span class="attach-hint">{$t("attachment.hint")}</span></div>
      {#if createError}<p class="create-error" role="alert">{createError}</p>{/if}
      {#if createKind==="single"}{@const selectedQuota=quota?.[createProvider]}<div class="quota-reservation-preview"><strong>{providerDisplayName(createProvider)} · {$t("quotaReservation.currentUsage")}</strong>{#if selectedQuota?.quotaMode==="vertex-credit"}<span>{$t("antigravityExecution.vertexCreditTitle")} · {$t("antigravityExecution.vertexQuotaScope",{project:selectedQuota.projectId,location:selectedQuota.location})}</span>{:else if selectedQuota?.fiveHour||selectedQuota?.sevenDay}{#if selectedQuota?.fiveHour}<span>{$t("quota.fiveHours")} {quotaPct(selectedQuota.fiveHour.pct)}%{#if selectedQuota.fiveHour.resetsAt} · {fmtReset(selectedQuota.fiveHour.resetsAt,selectedQuota.fiveHour.resetLabel)}{/if}</span>{/if}{#if selectedQuota?.sevenDay}<span>{$t("quota.weekly")} {quotaPct(selectedQuota.sevenDay.pct)}%{#if selectedQuota.sevenDay.resetsAt} · {fmtReset(selectedQuota.sevenDay.resetsAt,selectedQuota.sevenDay.resetLabel)}{/if}</span>{/if}{:else if selectedQuota?.balance}<span>{$t("quota.balance")} {formatCurrency(selectedQuota.balance.total,selectedQuota.balance.currency,$locale)}</span>{:else}<span>{$t("quota.noData")}</span>{/if}</div>{/if}
      <div class="create-submit-actions"><button class="primary" onclick={()=>createTask()} disabled={!createPrompt.trim()||!createWorkspace||createOpening||sending||createConnectionBlocked||(createKind==="single"&&isConnectionAuthProvider(createProvider)&&Boolean(activeAuthAttempt(createProvider)))||(createKind==="single"&&createPermissionFor(createProvider)===":danger-full-access"&&!dangerConfirmed)||((createKind==="parallel"||createKind==="review")&&reviewFullAutoSelected()&&!dangerConfirmed)||(createKind==="conversation"&&(!conversationUserNickname.trim()||debateUnlimited&&!debateUnlimitedConfirmed||compatibleProviders.some(provider=>conversationEnabled[provider]&&!conversationCompatibleModels[provider])))||(createProvider==="grok"&&!createGrokModel)||(createProvider==="ollama"&&!createOllamaModel)||(createProvider==="antigravity"&&!createAntigravityModel)}><Plus size={19}/>{sending?$t("task.creating"):createKind==="single"?$t("quotaReservation.startNow"):createKind==="conversation"?$t("conversation.start"):$t("collaboration.startReview")}</button>{#if createKind==="single"&&(createProvider==="codex"||createProvider==="claude")}<button onclick={reserveTask} disabled={!createPrompt.trim()||!createWorkspace||createOpening||sending||createConnectionBlocked||(isConnectionAuthProvider(createProvider)&&Boolean(activeAuthAttempt(createProvider)))||createPermissionFor(createProvider)===":danger-full-access"&&!dangerConfirmed}><Clock3 size={18}/>{$t("quotaReservation.afterReset")}</button>{/if}</div>
      {/if}
    </div>
  </div>
{/if}

{#if toneSheetProvider}
  {@const toneProvider=toneSheetProvider}
  <TonePresetSheet
    title={$t("conversation.toneSheetTitle",{name:providerDisplayName(toneProvider)})}
    nickname={characterSettings.providers[toneProvider].nickname}
    globalTone={characterSettings.providers[toneProvider].tonePreset}
    selected={toneSheetMode==="conversation"?conversationTonePresets[toneProvider]:reviewTonePresets[toneProvider]}
    customTone={toneSheetMode==="conversation"?conversationCustomTone(toneProvider):reviewCustomTone(toneProvider)}
    onchoose={(tone)=>toneSheetMode==="conversation"?chooseConversationTone(toneProvider,tone):chooseReviewTone(toneProvider,tone)}
    oncustom={(value)=>toneSheetMode==="conversation"?setConversationCustomTone(toneProvider,value):setReviewCustomTone(toneProvider,value)}
    onclose={()=>toneSheetProvider=null}/>
{/if}

{#if taskBulkDeleteOpen}
  <div class="modal-backdrop"><div class="modal delete-dialog bulk-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="task-bulk-delete-title" aria-busy={taskBulkDeleting}>
    <header><h2 id="task-bulk-delete-title">{$t("bulk.deleteProviderTitle",{scope:$t(engine==="all"?"bulk.scopeAll":engine==="conversation-linked"?"bulk.scopeLinked":"bulk.scopeClaude"),count:taskBulkSelected.size})}</h2><button class="icon-button" aria-label={$t("a11y.closeDialog")} onclick={closeTaskBulkDelete} disabled={taskBulkDeleting}>×</button></header>
    <ul class="bulk-delete-list">{#each [...taskBulkSelected.values()].slice(0,5) as task}<li><span class="engine {task.provider}">{providerDisplayName(task.provider)}</span> {task.title||$t("session.untitled")}</li>{/each}{#if taskBulkSelected.size>5}<li>{$t("bulk.moreCount",{count:taskBulkSelected.size-5})}</li>{/if}</ul>
    <p>{$t("bulk.deleteProviderBody")}</p><p><strong>{$t("session.deleteFilesWarning")}</strong></p>
    {#if taskBulkDeleting}<p class="bulk-delete-progress"><LoaderCircle class="spin" size={18}/>{taskBulkProgress}</p>{/if}
    <label class="delete-check"><input type="checkbox" bind:checked={taskBulkAcknowledged} disabled={taskBulkDeleting}/>{$t("bulk.deleteAcknowledge")}</label>
    <div class="delete-actions"><button onclick={closeTaskBulkDelete} disabled={taskBulkDeleting}>{$t("common.cancel")}</button><button class="destructive" onclick={permanentlyDeleteTaskBulk} disabled={taskBulkDeleting||!taskBulkAcknowledged}>{taskBulkDeleting?taskBulkProgress:$t("bulk.deleteCount",{count:taskBulkSelected.size})}</button></div>
  </div></div>
{/if}

{#if conversationBulkDeleteOpen}
  <div class="modal-backdrop"><div class="modal delete-dialog bulk-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="conversation-bulk-delete-title" aria-busy={conversationBulkDeleting}>
    <header><h2 id="conversation-bulk-delete-title">{$t(engine==="collaboration-work"?"bulk.deleteCollaborationWorkTitle":"bulk.deleteConversationTitle",{count:conversationBulkSelected.size})}</h2><button class="icon-button" aria-label={$t("a11y.closeDialog")} onclick={closeConversationBulkDelete} disabled={conversationBulkDeleting}>×</button></header>
    <ul class="bulk-delete-list">{#each [...conversationBulkSelected.values()].slice(0,5) as item}<li>{item.title||$t("conversation.untitled")}</li>{/each}{#if conversationBulkSelected.size>5}<li>{$t("bulk.moreCount",{count:conversationBulkSelected.size-5})}</li>{/if}</ul>
    <p>{$t(engine==="collaboration-work"?"bulk.deleteCollaborationWorkBody":"bulk.deleteConversationBody")}</p><p><strong>{$t("session.deleteFilesWarning")}</strong></p>
    {#if conversationBulkDeleting}<p class="bulk-delete-progress"><LoaderCircle class="spin" size={18}/>{conversationBulkProgress}</p>{/if}
    <label class="delete-check"><input type="checkbox" bind:checked={conversationBulkAcknowledged} disabled={conversationBulkDeleting}/>{$t(engine==="collaboration-work"?"bulk.deleteCollaborationWorkAcknowledge":"bulk.deleteConversationAcknowledge")}</label>
    <div class="delete-actions"><button onclick={closeConversationBulkDelete} disabled={conversationBulkDeleting}>{$t("common.cancel")}</button><button class="destructive" onclick={permanentlyDeleteConversationBulk} disabled={conversationBulkDeleting||!conversationBulkAcknowledged}>{conversationBulkDeleting?conversationBulkProgress:$t("bulk.deleteCount",{count:conversationBulkSelected.size})}</button></div>
  </div></div>
{/if}

{#if assistOpen&&selected}
  <div class="modal-backdrop" role="presentation" onclick={(event)=>event.target===event.currentTarget&&(assistOpen=false)}><div class="modal" role="dialog" aria-modal="true" aria-labelledby="assist-title"><header><h2 id="assist-title">{$t("assist.dialogTitle")}</h2><button class="icon-button" aria-label={$t("a11y.closeDialog")} onclick={()=>assistOpen=false}><X size={20}/></button></header><p class="assist-note">{$t(active.has(selected.status)?"assist.otherRunningBody":"assist.otherBody")}</p><ProviderExecutionPicker {api} sourceProvider={selected.provider} hostId={selected.executionHostId??"local"} selectionKey="assist" bind:provider={assistTargetProvider} bind:model={assistTargetModel} bind:effort={assistTargetEffort} bind:tier={assistTargetTier}/><label>{$t("assist.request")}<textarea bind:value={assistPrompt} rows="7" maxlength="20000"></textarea></label><button class="primary" onclick={createAssist} disabled={!assistTargetModel||!assistPrompt.trim()||!assistSourceContent.trim()||sending}>{$t(sending?"assist.requesting":"assist.start")}</button></div></div>
{/if}

{#if handoffOpen&&selected}<HandoffDialog {api} source={selected} onclose={()=>handoffOpen=false} oncomplete={handoffCompleted}/>{/if}
{#if pullRequestOpen&&selected}<PullRequestDialog {api} task={selected} events={visibleConversationEvents} onclose={()=>pullRequestOpen=false} oncreated={(task)=>{taskState.upsert(task);selected=task;}}/>{/if}

{#if taskSettingsOpen && selected}
  <div class="modal-backdrop" role="presentation" onclick={(e)=>e.target===e.currentTarget&&(taskSettingsOpen=false)}>
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <header><h2 id="settings-title">{$t("session.settings")}</h2><button class="icon-button" aria-label={$t("a11y.closeDialog")} onclick={()=>taskSettingsOpen=false}><X size={20}/></button></header>
      <label>{$t("workMode.label")}<WorkModeChips provider={selected.provider} value={editWorkMode} onchange={(mode)=>{editWorkMode=mode;editPermission=permissionForWorkMode(selected!.provider,mode,editPermission);if(mode==="plan")chooseEditAutomation("read");}}/></label>
      <label>{$t("permission.level")}<AutomationLevelChips provider={selected.provider} value={editAutomation} onchange={chooseEditAutomation}/></label>
      {#if editAutomation==="full"&&!dangerAcknowledged}<label class="danger-confirm"><input type="checkbox" bind:checked={editDanger} onchange={()=>editDanger&&recordDangerAcknowledgement()}/>{$t("permission.fullAccessAcknowledge")}</label>{/if}
      <SessionSettingsFields provider={selected.provider} models={selected.provider==="claude"?availableClaudeModels():compatibleCreateProvider(selected.provider)?availableCompatibleModels(selected.provider):availableCodexModels()} permissions={selected.provider==="claude"?claudePermissions:(catalog.permissions??[])} efforts={selected.provider==="claude"?claudeEfforts:compatibleCreateProvider(selected.provider)?compatibleEffortOptions(selected.provider):[]} bind:model={editModel} bind:effort={editEffort} bind:tier={editTier} bind:permission={editPermission} bind:danger={editDanger} showPermission={false}/>
      {#if selected.provider==="antigravity"&&selected.metadata?.modelBackend==="vertex-api"}<label>{$t("vertexSearch.label")}<div class="chips" role="group" aria-label={$t("vertexSearch.label")}><button type="button" class:active={editGoogleSearchMode==="off"} onclick={()=>editGoogleSearchMode="off"}>{$t("vertexSearch.off")}</button><button type="button" class:active={editGoogleSearchMode==="auto"} onclick={()=>editGoogleSearchMode="auto"}>{$t("vertexSearch.auto")}</button><button type="button" class:active={editGoogleSearchMode==="always"} onclick={()=>editGoogleSearchMode="always"}>{$t("vertexSearch.always")}</button></div><small>{$t("vertexSearch.nextTurnNotice")}</small></label>{/if}
      <fieldset class="workspace-choice"><legend>{$t("workspace.nextRequest")}</legend><div class="workspace-choice-grid">{#each editLocations() as workspace}<button type="button" class:active={editWorkspace===workspace.id} onclick={()=>{editProject=workspace.projectId;editWorkspace=workspace.id;}}><strong>{projectName(workspace.projectId)}</strong><small>{workspace.canonicalPath}</small></button>{/each}</div>{#if !editLocations().length}<small class="field-warning">{$t("workspace.noRegistered")}</small>{/if}</fieldset>
      {#if active.has(selected.status)}<small class="field-warning">{$t("workspace.activeRequestUnchanged")}</small>{:else}<small>{$t("workspace.resumeNextRequestWithHandoff")}</small>{/if}
      <button class="primary" onclick={saveTaskSettings} disabled={sending||!editWorkspace||(editPermission===":danger-full-access"&&!editDanger)}>{sending?$t("common.saving"):$t("workspace.applyNextRequest")}</button>
    </div>
  </div>
{/if}
{#if setupRequired}<SetupWizard {api} onsettings={(tab)=>{setupRequired=false;resumeSetupAfterSettings=true;globalTab=tab;openGlobalSettings();}} oncomplete={()=>setupRequired=false} onskip={dismissSetup}/>{/if}
{/if}
