<script lang="ts">
  import { CircleAlert, Square, Check, UserMinus, UserPlus, FileText, Send, Eye, Download, Trash2 } from "@lucide/svelte";
  import { onMount, tick } from "svelte";
  import { aggregateTurnOutputUsage, collaborationUsageThreadId, firstConversationOutput, latestOutputRunId, observedQuotaRange, summarizeDisplayedOutputUsage, type CollaborationTurnPresentation, type TurnOutputUsage } from "./conversation";
  import { formatContextTokens } from "./context-usage";
  import { collaborationDetailRefreshDelay, conversationInputAvailable } from "./conversation-controls";
  import type { AgentEvent } from "./events";
  import CollaborationRunCard from "./CollaborationRunCard.svelte";
  import ConversationUserCard from "./ConversationUserCard.svelte";
  import ConversationContinuation from "./ConversationContinuation.svelte";
  import EmotionAvatar from "./EmotionAvatar.svelte";
  import TurnUsageDetails from "./TurnUsageDetails.svelte";
  import { advanceAvatar, enqueueAvatar, initialAvatarQueue, type AvatarNotice } from "./collaboration-queue";
  import { buildInlineEmotionCards, buildOutputAssetFrames, buildRunPresentations, resolveConversationScenePosition, resolveParticipantOutfit } from "./collaboration-presentation";
  import { subscribeEmotionStream, type EmotionStreamSnapshot } from "./emotion-stream";
  import { roleplayActiveAtRound } from "./roleplay";
  import { CollaborationStore } from "./collaboration-store";
  import { activeTaskStreamTargets, mergeCollaborationRunEvents, taskStreamCursor, taskStreamKey, upsertCollaborationRunEvent, type TaskStreamTarget } from "./collaboration-live-state";
  import { assertUniqueKeys } from "./identity-selectors";
  import { collaborationAvatarKey, collaborationEventKey, collaborationMessageKey, collaborationParticipantKey, collaborationRunKey, duplicateDiagnostics, inlineSceneKey, processRowKey, taskEventKey } from "./collaboration-identity";
  import { PersistentEventStream } from "./collaboration-stream";
  import { collaborationRecentStatuses, type CollaborationRecentStatuses } from "./agent-status";
  import { applyChromePhase, shouldRevealOnTap } from "./immersive-chrome";
  import { t } from "./i18n";
  import { providerDisplayName } from "./provider-display";
  import { workspaceFileDownloadHref } from "./workspace-viewer-state";
  import { shouldSubmitOnEnter } from "./input-submit";
  type ReminderTarget="codex"|"claude"|"antigravity"|"deepseek"|"ollama"|"grok";
  const conversationProviders:ReminderTarget[]=["codex","claude","grok","antigravity","deepseek","ollama"];
  export let collaborationId:string;
  export let api:(path:string,init?:RequestInit)=>Promise<any>;
  export let onopen:(task:any)=>void=()=>{};
  export let onopenfile:((file:{path:string;pathBase:"workspace";workspaceId:string;initialEdit:false})=>void)|null=null;
  export let codexAvatar:"Gpt-Codex"|"Gpt-Sol"="Gpt-Sol";
  export let embedded=false;
  export let onclose:(()=>void)|null=null;
  export let onproviderstatus:((statuses:CollaborationRecentStatuses)=>void)|null=null;
  export let quotaByProvider:Record<string,{fiveHour?:{pct:number|null}|null;sevenDay?:{pct:number|null}|null}|null>|null=null;
  export let enterToSend=false;
  let detail:any=null,error="",collapsed=new Set<string>(),autoCollapsed=new Set<string>(),processExpanded=new Set<string>(),initializedFailures=new Set<string>(),queue=initialAvatarQueue(),timer:ReturnType<typeof setTimeout>|null=null,refreshTimer:ReturnType<typeof setTimeout>|null=null,loading=false,reloadQueued=false,emotionSnapshot:EmotionStreamSnapshot|null=null,mounted=false,sourceId="",lastSequence=0,liveStatus:"Live"|"Delayed"="Delayed",nextMessage="",submitting=false,rosterChanging:""|ReminderTarget="",pendingEvents:any[]=[],reminderTargets:ReminderTarget[]=[],continuationMode:"closed"|"adding-rounds"|"auto-continuing"|"retrying"="closed";
  type TurnCollapseMode="off"|"mobile"|"previous";
  let turnCollapseMode:TurnCollapseMode=typeof localStorage!=="undefined"&&["mobile","previous"].includes(localStorage.getItem("conversation-turn-collapse")??"")?localStorage.getItem("conversation-turn-collapse") as TurnCollapseMode:"off";
  let scrollFrame:number|null=null,mainStream:PersistentEventStream|null=null,renderRecoveryPending=false;
  const liveStore=new CollaborationStore(),mutationKeys=new Map<string,string>();
  let conversationForm:HTMLFormElement|null=null;
  let conclusionPath="",conclusionPathSession="",conclusionCreating=false,conclusionDeleting=false;
  let taskSources=new Map<string,PersistentEventStream>(),taskDrainTimers=new Map<string,ReturnType<typeof setTimeout>>(),taskSequences=new Map<string,number>(),taskEvents=new Map<string,AgentEvent[]>(),taskTerminalKeys=new Set<string>();
  let providerStatusSignature="";
  const terminal=new Set(["completed","failed","timed-out","cancelled","stop-unconfirmed"]);
  const providerName=(provider:ReminderTarget)=>`${detail?.session?.metadata?.participantNicknames?.[provider]??providerDisplayName(provider)} · ${providerDisplayName(provider)}`;
  const userName=()=>typeof detail?.session?.metadata?.userNickname==="string"?detail.session.metadata.userNickname:$t("conversation.user");
  const roleName=(role:string,purpose:string)=>purpose==="independent-review"?$t("collaboration.role.independentReview"):purpose.startsWith("cross-check-")?$t("collaboration.role.crossCheck"):purpose==="review-synthesis"?$t("collaboration.role.synthesis"):purpose==="primary-final"?$t("collaboration.role.finalEdit"):purpose==="review"?$t("collaboration.role.sequentialReview"):purpose==="debate-turn"?detail?.session?.metadata?.conversationKind==="casual"?$t(role==="primary"?"collaboration.role.firstConversationalist":"collaboration.role.conversationalist"):detail?.session?.metadata?.conversationKind==="artifact-review"?$t(role==="primary"?"collaboration.role.firstReviewer":"collaboration.role.reviewer"):$t(role==="primary"?"collaboration.role.firstSpeaker":"collaboration.role.debater"):$t(role==="primary"?"collaboration.role.primary":"collaboration.role.assistant");
  const permissionName=(mode:string)=>mode==="write"?$t("collaboration.permission.write"):mode==="plan"?$t("collaboration.permission.plan"):$t("permission.readOnly");
  const participant=(id:string)=>detail?.participants?.find((item:any)=>item.id===id);
  const latestParticipantRun=(id:string)=>[...(detail?.runs??[])].reverse().find((item:any)=>item.participantId===id)?.id??null;
  const latestCrossConclusion=(participantId:string)=>[...(detail?.runs??[])].reverse().find((item:any)=>item.participantId===participantId&&String(item.purpose).startsWith("cross-check-")&&item.status==="completed")??null;
  const runTask=(run:any)=>detail?.tasks?.[run.providerTaskId];
  const stripControl=(value:string|undefined|null)=>value?.replace(/\n?\[CLAUDEX_WORKHOUSE_(?:DEBATE|CONVERSATION):[^\]]+\]\s*$/i,"")??"";
  const runEventRows=(run:any)=>mergeCollaborationRunEvents(run,detail?.runEvents?.[run.id]??[],taskEvents.get(taskStreamKey(run))??[]);
  const runOutput=(run:any)=>runOutputById.get(run.id)??"";
  const runOutputTimestamp=(run:any)=>{
    const message=[...(detail?.messages??[])].reverse().find((item:any)=>item.runId===run.id&&item.messageType==="provider-output");
    const task=runTask(run);
    return message?.createdAt??runPresentations.get(run.id)?.final?.timestamp??(runOutput(run)?run.completedAt??task?.updatedAt??run.startedAt:null);
  };
  const participantOutfit=(person:any)=>{
    const provider=person?.provider as ReminderTarget,liveOutfit=emotionSnapshot?.bootstrapStatus==="ready"?(provider==="codex"?emotionSnapshot.codexState.outfit:provider==="claude"?emotionSnapshot.state.outfit:provider==="grok"?emotionSnapshot.grokState.outfit:provider==="antigravity"?emotionSnapshot.antigravityState.outfit:provider==="deepseek"?emotionSnapshot.deepseekState.outfit:emotionSnapshot.ollamaState.outfit):undefined;
    return resolveParticipantOutfit({provider,sessionOutfit:detail?.session?.metadata?.participantToneSnapshots?.[provider]?.avatarOutfit,liveOutfit,codexAvatar});
  };
  const currentRoleplayActive=()=>detail?.session?.metadata?.roleplayActive!==false;
  const continuationAvailable=()=>detail?.continuation?.available===true;
  const enabledProviders=():ReminderTarget[]=>{const configured=detail?.session?.metadata?.enabledProviders;return (Array.isArray(configured)?configured:detail?.participants?.filter((item:any)=>!item.archivedAt).map((item:any)=>item.provider)??[]).filter((item:unknown):item is ReminderTarget=>conversationProviders.includes(item as ReminderTarget));};
  const participantRosterEditable=()=>detail?.session?.mode==="debate"&&detail?.session?.metadata?.conversationKind==="casual"&&(conversationInputVisible||detail?.continuation?.canSubmitUserInput===true||detail?.continuation?.canAddRounds===true);
  let conversationInputVisible=false;
  $: conversationInputVisible=conversationInputAvailable(detail?.session,detail?.continuation);
  $: if(detail?.session?.id&&conclusionPathSession!==detail.session.id){conclusionPathSession=detail.session.id;conclusionPath=typeof detail.session.metadata?.conclusionRelativePath==="string"?detail.session.metadata.conclusionRelativePath:"";}
  const normalizeReminderTargets=(value:unknown):ReminderTarget[]=>{
    const normalized:Array<unknown>=Array.isArray(value)?value:[value],targets=new Set<ReminderTarget>();
    for(const item of normalized){
      if(conversationProviders.includes(item as ReminderTarget))targets.add(item as ReminderTarget);
      if(item&&typeof item==="object")for(const target of normalizeReminderTargets((item as any).targets??(item as any).reminderTargets??(item as any).providers))targets.add(target);
      if(typeof item!=="string")continue;
      const text=item.toLowerCase();
      try{const parsed=JSON.parse(item);for(const target of normalizeReminderTargets(parsed))targets.add(target);}catch{}
      if(/\bcodex\b|지삐|코덱스/.test(text))targets.add("codex");
      if(/\bclaude\b|클쨩|클로드/.test(text))targets.add("claude");
      if(/\b(?:gemin[ei]|antigravity)\b|잼민e|재미니/.test(text))targets.add("antigravity");
      if(/\bdeepseek\b|딥시크/.test(text))targets.add("deepseek");
      if(/\bollama\b|올라마/.test(text))targets.add("ollama");
      if(/\b(?:both|all)\b|둘\s*다|전체/.test(text))for(const provider of enabledProviders())targets.add(provider);
    }
    return [...targets];
  };
  const reminderForRound=(round:number)=>{
    const entries:Array<{round:number;targets:ReminderTarget[]}>=[];
    const metadata=detail?.session?.metadata??{},metadataReminders=[...(Array.isArray(metadata.personalityReminders)?metadata.personalityReminders:[]),...(metadata.personalityReminder?[metadata.personalityReminder]:[])];
    for(const item of metadataReminders){
      if(Number(item?.round)!==Number(round))continue;
      entries.push({round:Number(round),targets:normalizeReminderTargets(item?.targets??item?.reminderTargets??item?.providers)});
    }
    for(const message of detail?.messages??[]){
      if(!["personality-reminder","reminder-request"].includes(message?.messageType??message?.message_type)||Number(message?.round)!==Number(round))continue;
      entries.push({round:Number(round),targets:normalizeReminderTargets(message?.targets??message?.metadata?.targets??message?.contentRef??message?.content_ref)});
    }
    if(!entries.length)return null;
    return {round:Number(round),targets:[...new Set(entries.flatMap(item=>item.targets))] as ReminderTarget[]};
  };
  const reminderTargetLabel=(targets:ReminderTarget[])=>targets.length===enabledProviders().length?$t("collaboration.reminder.both"):targets.length===1?providerDisplayName(targets[0]):$t("collaboration.reminder.recorded");
  const availableReminderTargets=()=>enabledProviders();
  const reminderTargetAvailable=(provider:ReminderTarget)=>availableReminderTargets().includes(provider);
  function armReminder(targets:ReminderTarget[]){reminderTargets=[...targets];}
  type TimelineRound={key:string;round:number;items:Array<{run:any;index:number}>};
  let outputAssetFrames=new Map<string,any[]>(),inlineEmotionCards=new Map<string,any>(),inlinePanelNotice:any=null,runOutputById=new Map<string,string>(),displayedRuns:any[]=[],timelineRounds:TimelineRound[]=[];
  let runPresentations=new Map<string,CollaborationTurnPresentation>();
  function rebuildRunPresentations(){return buildRunPresentations(detail?.runs??[],runEventRows,terminal,detail?.session?.metadata?.conversationKind==="casual");}
  function rebuildRunOutputs():Map<string,string>{return new Map((detail?.runs??[]).map((run:any):[string,string]=>[String(run.id),firstConversationOutput(detail?.runOutputs?.[run.id],terminal.has(run.status)?stripControl(runTask(run)?.result):null,stripControl(runPresentations.get(run.id)?.final?.content))]));}
  function rebuildTimelineRuns(){const runs=detail?.runs??[],visible=detail?.session?.metadata?.conversationKind!=="casual"?runs:(()=>{const lastTimeout=[...runs].map((run:any,index:number)=>({run,index})).reverse().find(({run}:any)=>run.status==="timed-out"&&!runOutput(run))?.index??-1;return runs.filter((run:any,index:number)=>run.status!=="timed-out"||Boolean(runOutput(run))||index===lastTimeout);})();if(import.meta.env?.DEV)assertUniqueKeys("CollaborationTimeline displayedRuns",visible,(run:any)=>collaborationRunKey(detail?.session?.id,run));return visible;}
  function rebuildTimelineRounds():TimelineRound[]{
    const groups:TimelineRound[]=[];
    for(const [index,run] of displayedRuns.entries()){
      const round=Number(run.round)||1,last=groups.at(-1);
      if(last&&last.round===round)last.items.push({run,index});
      else groups.push({key:`${detail?.session?.id??collaborationId}:round:${round}:${run.id}`,round,items:[{run,index}]});
    }
    return groups;
  }
  const conversationGridLayout=()=>detail?.session?.mode==="debate"&&detail?.session?.metadata?.conversationKind==="casual"&&enabledProviders().length>=2;
  // A review reads as a comparison, so the two reviewers belong side by side
  // exactly as the two conversationalists do. The conversation grid starts at
  // the tablet breakpoint because its turns are short; a review card carries
  // findings with file and line references and needs the wider column, so it
  // only pairs up on a large tablet. Rounds that produced a single card — the
  // cross-check hand-off and the synthesis — keep the full width below.
  const REVIEW_GRID_MIN_WIDTH=900;
  const reviewGridLayout=()=>["review","parallel"].includes(String(detail?.session?.mode))
    &&(detail?.participants?.length??0)>=2
    &&viewportWidth>=REVIEW_GRID_MIN_WIDTH
    &&timelineRounds.some(group=>group.items.length>=2);
  let participantGrid=false;
  let viewportWidth=typeof window==="undefined"?0:window.innerWidth;
  // The phone dock is position:fixed, so the conversation has to reserve the
  // band it covers itself. A constant reserve cannot match it: the dock is
  // absent on a read-only conversation, one row tall while it only carries the
  // input, two rows with the continuation actions, and taller again once the
  // input opens. Whatever the constant over-reserved stayed as dead space under
  // the last card, and because the dock only slides fully in at the end of the
  // scroll, the reader hit that empty band with the dock still part way out.
  function dockReserve(node:HTMLElement){
    const measure=()=>{
      const height=Math.round(node.getBoundingClientRect().height);
      document.documentElement.style.setProperty("--conversation-dock-height",`${height>0?height:0}px`);
    };
    measure();
    const observer=typeof ResizeObserver==="undefined"?null:new ResizeObserver(measure);
    observer?.observe(node);
    return{destroy(){observer?.disconnect();document.documentElement.style.removeProperty("--conversation-dock-height");}};
  }
  // Mirrors the orchestrator: the configured order is used in every round.
  const participantOrderForRound=()=>{
    const enabled=enabledProviders(),configured=((detail?.session?.metadata?.participantOrder??enabled) as ReminderTarget[]).filter(provider=>enabled.includes(provider));
    return [...configured,...enabled.filter(provider=>!configured.includes(provider))];
  };
  function rebuildOutputAssetFrames(){
    return buildOutputAssetFrames({runs:detail?.runs??[],participant,output:runOutput,outfit:participantOutfit,available:outfit=>emotionSnapshot?.assets?.[outfit]??[],roleplayActive:run=>roleplayActiveAtRound(detail?.messages??[],Number(run.round)||1),toneSnapshot:provider=>detail?.session?.metadata?.participantToneSnapshots?.[provider]});
  }
  function conversationTurnLength(){const value=detail?.session?.metadata?.conversationTurnLength;return detail?.session?.metadata?.conversationKind==="casual"&&(value==="compact"||value==="rich")?value:null;}
  function rebuildInlineEmotionCards(){return buildInlineEmotionCards({runs:detail?.runs??[],output:runOutput,participant,outfit:participantOutfit,available:outfit=>emotionSnapshot?.assets?.[outfit]??[],mode:conversationTurnLength()});}
  const outputUsageFor=(run:any)=>{
    const person=participant(run.participantId),task=runTask(run),output=runOutputById.get(run.id)??"";
    return person?summarizeDisplayedOutputUsage(runEventRows(run),collaborationUsageThreadId(person.provider,task),output,task?.metadata?.outputUsage):null;
  };
  const rebuildProviderUsageSummaries=()=>enabledProviders().map(provider=>{
    const usages=displayedRuns.filter((run:any)=>participant(run.participantId)?.provider===provider).map((run:any)=>outputUsageFor(run)).filter((usage:TurnOutputUsage|null):usage is TurnOutputUsage=>Boolean(usage));
    return{provider,usage:aggregateTurnOutputUsage(usages)};
  }).filter((item):item is {provider:ReminderTarget;usage:TurnOutputUsage}=>Boolean(item.usage));
  let providerUsageSummaryRows:Array<{provider:ReminderTarget;usage:TurnOutputUsage}>=[],codexQuotaObserved:ReturnType<typeof observedQuotaRange>=null;
  const currentQuota=(provider:ReminderTarget)=>{
    const quota=quotaByProvider?.[provider];
    if(quota?.sevenDay?.pct!==null&&quota?.sevenDay?.pct!==undefined)return{label:"quota.weekly",pct:quota.sevenDay.pct};
    if(quota?.fiveHour?.pct!==null&&quota?.fiveHour?.pct!==undefined)return{label:"quota.fiveHours",pct:quota.fiveHour.pct};
    return null;
  };
  const participantRoute=()=>((detail?.session?.metadata?.participantOrder??enabledProviders()) as ReminderTarget[]).map(provider=>providerDisplayName(provider)).join(" → ");
  const conversationPermission=()=>[...new Set((detail?.participants??[]).filter((item:any)=>enabledProviders().includes(item.provider)).map((item:any)=>permissionName(item.permissionMode)))].join(" · ");
  function rebuildInlinePanelNotice(){
    const run=[...(detail?.runs??[])].reverse().find((item:any)=>!terminal.has(item.status)&&inlineEmotionCards.get(item.id)?.scenes?.length),presentation=run?inlineEmotionCards.get(run.id):null,scene=presentation?.scenes?.at(-1),person=run?participant(run.participantId):null;
    return run&&scene&&person?{eventId:scene.id,participantId:person.id,sourceRunId:run.id,generation:run.generation,version:scene.sourceOffset,activity:"speaking",line:scene.text.replace(/\s+/g," ").slice(0,72),emotion:scene.emotion,priority:2,terminal:false}:null;
  }
  $:{detail;taskEvents;runPresentations=rebuildRunPresentations();}
  $:{detail;runPresentations;runOutputById=rebuildRunOutputs();}
  $:{detail;runOutputById;displayedRuns=rebuildTimelineRuns();}
  $:{displayedRuns;taskEvents;providerUsageSummaryRows=rebuildProviderUsageSummaries();codexQuotaObserved=observedQuotaRange(displayedRuns.flatMap((run:any)=>runEventRows(run)),10_080);}
  $:{displayedRuns;detail;timelineRounds=rebuildTimelineRounds();}
  // Naming the dependencies is what makes this re-evaluate: Svelte tracks the
  // identifiers in the statement, not the ones the helpers read inside.
  $:{detail;viewportWidth;timelineRounds;participantGrid=conversationGridLayout()||reviewGridLayout();}
  $:{detail;runOutputById;emotionSnapshot;codexAvatar;outputAssetFrames=rebuildOutputAssetFrames();}
  $:{detail;runOutputById;emotionSnapshot;codexAvatar;inlineEmotionCards=rebuildInlineEmotionCards();}
  $:{detail;inlineEmotionCards;inlinePanelNotice=rebuildInlinePanelNotice();}
  const runSessionTask=(run:any,person:any)=>{const task=runTask(run),sessionId=task?.threadId??task?.providerSessionId??person?.providerSessionId;return task&&sessionId?{...task,threadId:sessionId,providerSessionId:sessionId}:null;};
  const hostName=(id:string)=>id==="local"?"local":id;
  const utteranceTerminal=(activity:string)=>["completed","failed","cancelled","agreed"].includes(activity);
  function scheduleConversationScroll(){
    if(!mounted||detail?.session?.mode!=="debate")return;
    const scroller=document.scrollingElement,nearBottom=!scroller||scroller.scrollHeight-scroller.scrollTop-scroller.clientHeight<240;if(!nearBottom)return;
    if(scrollFrame!==null)cancelAnimationFrame(scrollFrame);
    void tick().then(()=>{if(!mounted||detail?.session?.mode!=="debate")return;scrollFrame=requestAnimationFrame(()=>{scrollFrame=null;const runId=latestOutputRunId(detail?.runs??[],runOutput);if(runId)document.getElementById(`collaboration-run-${runId}`)?.scrollIntoView({behavior:"auto",block:"end"});});});
  }
  function toggle(id:string){const next=new Set(collapsed),automatic=new Set(autoCollapsed);next.has(id)?next.delete(id):next.add(id);automatic.delete(id);autoCollapsed=automatic;collapsed=next;}
  function setTurnCollapseMode(value:TurnCollapseMode){turnCollapseMode=value;localStorage.setItem("conversation-turn-collapse",value);}
  function applyTurnAutoCollapse(){
    const base=new Set([...collapsed].filter(id=>!autoCollapsed.has(id))),next=new Set<string>();
    const enabled=turnCollapseMode==="previous"||turnCollapseMode==="mobile"&&typeof window!=="undefined"&&window.innerWidth<=768;
    if(enabled){
      const completed=(detail?.runs??[]).filter((run:any)=>terminal.has(run.status));
      for(const run of completed.slice(0,-1))next.add(run.id);
    }
    autoCollapsed=next;collapsed=new Set([...base,...next]);
  }
  $:{detail;turnCollapseMode;applyTurnAutoCollapse();}
  function toggleProcess(id:string){const next=new Set(processExpanded);next.has(id)?next.delete(id):next.add(id);processExpanded=next;}
  function initializeFailedProcesses(next:any){const initialized=new Set(initializedFailures);for(const run of next?.runs??[])if(run.status==="failed"||run.status==="timed-out")initialized.add(run.id);initializedFailures=initialized;}
  async function load(){
    if(loading){reloadQueued=true;return;}
    loading=true;
    const requestedId=collaborationId;
    try{const next=await api(`/api/collaborations/${requestedId}`);if(collaborationId===requestedId){if(liveStore.snapshot(next))initializeFailedProcesses(next);seedTaskStreamCursors(next);error="";const buffered=pendingEvents;pendingEvents=[];for(const event of buffered)receive(event);syncTaskStreams();scheduleConversationScroll();}}catch(e){if(collaborationId===requestedId)error=e instanceof Error?e.message:String(e);}finally{
      loading=false;
      if(reloadQueued){reloadQueued=false;scheduleRefresh();}
    }
  }
  function scheduleRefresh(delay=0){if(refreshTimer){if(delay>0)return;clearTimeout(refreshTimer);}refreshTimer=setTimeout(()=>{refreshTimer=null;void load();},delay);}
  async function cancel(){if(!confirm($t(detail?.session?.mode==="debate"?"collaboration.cancelConversationConfirm":"collaboration.cancelConfirm")))return;await api(`/api/collaborations/${collaborationId}/cancel`,{method:"POST",headers:{"Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({confirm:true})});await load();}
  async function acceptPartial(){await api(`/api/collaborations/${collaborationId}/accept-partial`,{method:"POST",headers:{"Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({confirm:true})});await load();}
  async function resume(){await api(`/api/collaborations/${collaborationId}/resume`,{method:"POST",headers:{"Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({confirmExternalState:true})});await load();}
  async function relayPrimary(){await api(`/api/collaborations/${collaborationId}/relay-to-primary`,{method:"POST",headers:{"Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({confirm:true})});await load();}
  function defaultConclusionPath(){return`docs/conversation-${collaborationId.slice(0,8)}-conclusion.md`;}
  async function createConclusion(){
    if(conclusionCreating||enabledProviders().length!==2)return;
    const relativePath=(conclusionPath.trim()||defaultConclusionPath()).replace(/^\/+/,"");
    if(!confirm($t("conclusion.confirm",{path:relativePath})))return;
    const workspaceId=detail?.participants?.find((item:any)=>enabledProviders().includes(item.provider))?.workspaceId;
    if(!workspaceId)return;
    conclusionCreating=true;
    try{const next=await api(`/api/collaborations/${collaborationId}/conclusion-markdown`,{method:"POST",headers:{"Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({workspaceId,relativePath,confirmWrite:true,confirmNoOverwrite:true})});detail={...detail,session:next.session};conclusionPath=next.file.relativePath;error="";await load();}catch(e){error=e instanceof Error?e.message:String(e);}finally{conclusionCreating=false;}
  }
  function openConclusion(file:any){if(onopenfile&&file?.workspaceId&&file?.relativePath)onopenfile({path:file.relativePath,pathBase:"workspace",workspaceId:file.workspaceId,initialEdit:false});}
  async function deleteConclusion(file:any){
    if(conclusionDeleting||!file?.workspaceId||!file?.relativePath||!file?.revision||!confirm($t("conclusion.deleteConfirm",{path:file?.relativePath??""})))return;
    conclusionDeleting=true;
    try{const next=await api(`/api/collaborations/${collaborationId}/conclusion-markdown`,{method:"DELETE",headers:{"Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({workspaceId:file.workspaceId,relativePath:file.relativePath,revision:file.revision,confirmDelete:true})});detail={...detail,session:next.session};conclusionPath=typeof next.session?.metadata?.conclusionRelativePath==="string"?next.session.metadata.conclusionRelativePath:file.relativePath;error="";await load();}catch(e){error=e instanceof Error?e.message:String(e);}finally{conclusionDeleting=false;}
  }
  const mutationKey=(name:string)=>{const existing=mutationKeys.get(name);if(existing)return existing;const key=crypto.randomUUID();mutationKeys.set(name,key);return key;};
  async function sendConversationMessage(){if(!nextMessage.trim()||submitting||!conversationInputVisible)return;submitting=true;const action=`message:${detail.session.controllerGeneration}:${nextMessage.trim()}`;try{const armed=currentRoleplayActive()?[...reminderTargets]:[];const next=await api(`/api/collaborations/${collaborationId}/messages`,{method:"POST",headers:{"Idempotency-Key":mutationKey(action)},body:JSON.stringify({prompt:nextMessage.trim(),generation:detail.session.controllerGeneration,...(armed.length?{reminderTargets:armed}:{})})});mutationKeys.delete(action);nextMessage="";reminderTargets=[];continuationMode="closed";liveStore.snapshot(next);}catch(e){error=e instanceof Error?e.message:String(e);}finally{submitting=false;}}
  async function addRounds(){if(submitting)return;submitting=true;continuationMode="adding-rounds";const action=`add-rounds:${detail.session.revision}`;try{const next=await api(`/api/collaborations/${collaborationId}/add-rounds`,{method:"POST",headers:{"Idempotency-Key":mutationKey(action)},body:JSON.stringify({count:5})});mutationKeys.delete(action);continuationMode="closed";liveStore.snapshot(next);}catch(e){continuationMode="closed";error=e instanceof Error?e.message:String(e);}finally{submitting=false;}}
  async function autoContinue(){if(submitting)return;submitting=true;continuationMode="auto-continuing";const action=`auto-continue:${detail.session.controllerGeneration}:${detail.session.metadata?.currentRound??0}`;try{const next=await api(`/api/collaborations/${collaborationId}/auto-continue`,{method:"POST",headers:{"Idempotency-Key":mutationKey(action)},body:JSON.stringify({count:5})});mutationKeys.delete(action);continuationMode="closed";liveStore.snapshot(next);}catch(e){continuationMode="closed";error=e instanceof Error?e.message:String(e);}finally{submitting=false;}}
  async function retryFailedTurn(){const runId=detail?.continuation?.failedRunId;if(!runId||submitting)return;submitting=true;continuationMode="retrying";const action=`retry:${runId}`;try{const next=await api(`/api/collaborations/${collaborationId}/runs/${runId}/retry`,{method:"POST",headers:{"Idempotency-Key":mutationKey(action)},body:JSON.stringify({confirm:true})});mutationKeys.delete(action);continuationMode="closed";liveStore.snapshot(next);}catch(e){continuationMode="closed";error=e instanceof Error?e.message:String(e);}finally{submitting=false;}}
  async function changeParticipant(provider:ReminderTarget,enabled:boolean){if(rosterChanging||submitting||!participantRosterEditable())return;if(!enabled&&!confirm($t("collaboration.ejectConfirm",{provider:providerName(provider)})))return;rosterChanging=provider;const action=`participant:${provider}:${enabled}`;try{const next=await api(`/api/collaborations/${collaborationId}/participants/${provider}`,{method:"PUT",headers:{"Idempotency-Key":mutationKey(action)},body:JSON.stringify({enabled,confirm:true})});mutationKeys.delete(action);reminderTargets=reminderTargets.filter(item=>next.session.metadata?.enabledProviders?.includes(item));liveStore.snapshot(next);error="";}catch(e){error=e instanceof Error?e.message:String(e);}finally{rosterChanging="";}}
  const conversationLabel=()=>detail?.session?.mode==="debate"?$t("collaboration.mode.conversation",{flow:$t(detail.session.metadata?.conversationFlow==="guided"?"collaboration.flow.guided":"collaboration.flow.automatic")}):detail?.session?.mode==="parallel"?$t("collaboration.mode.independentReview"):detail?.session?.mode==="review"?(detail.session.metadata?.reviewDepth?$t(detail.session.metadata.reviewDepth==="deep"?"collaboration.mode.deepCrossReview":"collaboration.mode.crossReview"):$t("collaboration.role.sequentialReview")):detail?.session?.mode;
  const reviewStepLabel=()=>{const step=String(detail?.session?.currentStep??"");if(step==="independent-review")return $t("collaboration.step.independentReview");if(step.startsWith("cross-check:"))return $t("collaboration.step.crossCheck");if(step==="review-synthesis")return $t("collaboration.step.synthesis");if(step==="done")return $t("task.status.completed");return step;};
  function schedule(){if(timer)clearTimeout(timer);if(queue.pinned||!queue.visible)return;timer=setTimeout(()=>{queue=advanceAvatar(queue);schedule();},queue.visible.priority>=4?9000:4000);}
  function seedTaskStreamCursors(snapshot:any){const next=new Map(taskSequences);for(const run of snapshot?.runs??[]){const key=taskStreamKey(run),sequence=taskStreamCursor(snapshot?.runEvents?.[run.id]??[]);if(sequence>0)next.set(key,Math.max(next.get(key)??0,sequence));}taskSequences=next;}
  function receive(raw:any){
    if(!detail){const key=collaborationEventKey(raw),index=pendingEvents.findIndex(item=>collaborationEventKey(item)===key);if(index<0)pendingEvents=[...pendingEvents,raw].slice(-500);else{const next=[...pendingEvents];next[index]={...next[index],...raw,metadata:{...(next[index]?.metadata??{}),...(raw?.metadata??{})}};pendingEvents=next;}return;}
    lastSequence=Math.max(lastSequence,Number(raw.sequence)||0);const applied=liveStore.event(raw);if(applied.gap)scheduleRefresh(0);
    if(applied.applied&&raw.type==="avatar/state"){const meta=raw.metadata??{},notice:AvatarNotice={eventId:raw.eventId,participantId:raw.participantId,sourceRunId:raw.runId,generation:raw.generation,version:Number(meta.version)||0,activity:String(meta.activity??"waiting"),line:String(meta.line??""),emotion:String(meta.emotion??"neutral"),priority:Number(meta.priority)||1,terminal:utteranceTerminal(String(meta.activity??""))};queue=enqueueAvatar(queue,notice);schedule();}
    if(!applied.applied)return;
    syncTaskStreams();const refreshDelay=collaborationDetailRefreshDelay(raw.type);if(refreshDelay!==null)scheduleRefresh(refreshDelay);
  }
  function closeTaskStream(key:string){taskSources.get(key)?.stop();taskSources.delete(key);const timer=taskDrainTimers.get(key);if(timer)clearTimeout(timer);taskDrainTimers.delete(key);}
  function stopTaskStreams(){for(const source of taskSources.values())source.stop();for(const timer of taskDrainTimers.values())clearTimeout(timer);taskSources=new Map();taskDrainTimers=new Map();}
  function targetCurrent(target:TaskStreamTarget){const run=(detail?.runs??[]).find((item:any)=>item.id===target.runId);return Boolean(run&&taskStreamKey(run)===target.key&&!taskTerminalKeys.has(target.key)&&(!terminal.has(run.status)||taskSources.has(target.key)));}
  function receiveTask(target:TaskStreamTarget,event:AgentEvent){
    if(!targetCurrent(target))return;const run=(detail?.runs??[]).find((item:any)=>item.id===target.runId);if(!run)return;const sequence=Number(event.sequence)||0,cursor=taskSequences.get(target.key)??0,rows=taskEvents.get(target.key)??[];
    if(sequence>0&&sequence<=cursor&&!rows.some(item=>taskEventKey(run,item)===taskEventKey(run,event)))return;
    const merged=upsertCollaborationRunEvent(run,rows,event);taskSequences.set(target.key,Math.max(cursor,sequence));if(!merged.changed)return;taskEvents.set(target.key,merged.events);taskEvents=new Map(taskEvents);
    if(event.type==="message_delta"||event.type==="message_completed"||event.type==="task_completed")scheduleConversationScroll();
    if(event.terminal){taskTerminalKeys=new Set(taskTerminalKeys).add(target.key);closeTaskStream(target.key);scheduleRefresh(0);}
  }
  function openTaskStream(target:TaskStreamTarget){
    if(taskSources.has(target.key)||document.visibilityState!=="visible"||!targetCurrent(target))return;
    const stream=new PersistentEventStream({url:()=>`/api/tasks/${target.provider}/${encodeURIComponent(target.taskId)}/events/stream?after=${taskSequences.get(target.key)??0}`,eventName:"agent-event",visible:()=>document.visibilityState==="visible",onEvent:event=>receiveTask(target,event),onResync:value=>{if(!targetCurrent(target))return;taskSequences.set(target.key,Math.max(0,Number(value?.latestSequence)||0));scheduleRefresh(0);},onStatus:()=>{},onWatchdog:()=>scheduleRefresh(0)});taskSources.set(target.key,stream);stream.start();
  }
  function syncTaskStreams(){
    const openKeys=new Set(taskSources.keys()),wanted=new Map((document.visibilityState==="visible"?activeTaskStreamTargets(detail,taskTerminalKeys,openKeys):[]).map(target=>[target.key,target]));
    for(const key of taskSources.keys())if(!wanted.has(key))closeTaskStream(key);
    for(const target of wanted.values()){
      openTaskStream(target);
      const run=(detail?.runs??[]).find((item:any)=>item.id===target.runId);
      if(run&&terminal.has(run.status)&&!taskDrainTimers.has(target.key))taskDrainTimers.set(target.key,setTimeout(()=>{taskDrainTimers.delete(target.key);taskTerminalKeys=new Set(taskTerminalKeys).add(target.key);closeTaskStream(target.key);scheduleRefresh(0);},1500));
    }
  }
  function stopSource(){mainStream?.stop();mainStream=null;sourceId="";}
  function connect(){
    if(!mounted||document.visibilityState!=="visible"||mainStream)return;
    sourceId=collaborationId;const expectedId=collaborationId;mainStream=new PersistentEventStream({url:()=>`/api/collaborations/${expectedId}/events?after=${lastSequence}`,eventName:"collaboration-event",visible:()=>document.visibilityState==="visible",onEvent:value=>{if(sourceId===expectedId)receive(value);},onResync:value=>{if(sourceId!==expectedId)return;lastSequence=Math.max(0,Number(value.latestSequence)||0);liveStore.cursor(lastSequence);pendingEvents=[];void load();},onStatus:status=>{if(sourceId!==expectedId)return;liveStatus=status==="live"?"Live":"Delayed";liveStore.connection(status);},onWatchdog:()=>void load()});mainStream.start();
  }
  function switchCollaboration(id:string){if(!mounted||sourceId===id)return;stopSource();stopTaskStreams();liveStore.reset();error="";lastSequence=0;pendingEvents=[];taskSequences=new Map();taskEvents=new Map();taskTerminalKeys=new Set();processExpanded=new Set();initializedFailures=new Set();reminderTargets=[];continuationMode="closed";void load();connect();}
  function submitConversationKey(event:KeyboardEvent){if(!shouldSubmitOnEnter(event,enterToSend)||submitting||!nextMessage.trim())return;event.preventDefault();void sendConversationMessage();}
  function renderDiagnostics(){
    if(!detail)return[];
    const sessionId=detail.session?.id,diagnostics=[
      ...duplicateDiagnostics({rows:detail.runs??[],keyFor:(run:any)=>collaborationRunKey(sessionId,run),itemType:"run",sessionId,runIdFor:(run:any)=>run.id,participantIdFor:(run:any)=>run.participantId,itemIdFor:(run:any)=>run.id}),
      ...duplicateDiagnostics({rows:detail.messages??[],keyFor:(message:any)=>collaborationMessageKey(sessionId,message),itemType:"message",sessionId,runIdFor:(message:any)=>message.runId,participantIdFor:(message:any)=>message.participantId,itemIdFor:(message:any)=>message.id}),
      ...duplicateDiagnostics({rows:detail.participants??[],keyFor:(person:any)=>collaborationParticipantKey(sessionId,person),itemType:"participant",sessionId,participantIdFor:(person:any)=>person.id,itemIdFor:(person:any)=>person.id}),
      ...duplicateDiagnostics({rows:detail.avatarStates??[],keyFor:(state:any)=>collaborationAvatarKey(sessionId,state),itemType:"avatar-state",sessionId,runIdFor:(state:any)=>state.sourceRunId,participantIdFor:(state:any)=>state.participantId,itemIdFor:(state:any)=>state.version})
    ];
    for(const run of detail.runs??[]){const person=participant(run.participantId),events=runEventRows(run),process=runPresentations.get(run.id)?.process??[],scenes=inlineEmotionCards.get(run.id)?.scenes??[];diagnostics.push(...duplicateDiagnostics({rows:events,keyFor:(event:any)=>taskEventKey(run,event),itemType:"run-event",sessionId,runIdFor:()=>run.id,participantIdFor:()=>run.participantId,itemIdFor:(event:any)=>event.eventId??event.sequence}),...duplicateDiagnostics({rows:process,keyFor:(row:any)=>processRowKey(sessionId,run,person,row),itemType:"process-row",sessionId,runIdFor:()=>run.id,participantIdFor:()=>run.participantId,itemIdFor:(row:any)=>row.id}),...duplicateDiagnostics({rows:scenes,keyFor:(scene:any)=>inlineSceneKey(sessionId,run,person,scene),itemType:"inline-scene",sessionId,runIdFor:()=>run.id,participantIdFor:()=>run.participantId,itemIdFor:(scene:any)=>scene.id}));}
    return diagnostics;
  }
  function recoverRender(errorValue:unknown,reset:()=>void){console.error("collaboration-render-error",{error:errorValue instanceof Error?errorValue.message:String(errorValue),sessionId:detail?.session?.id??collaborationId,duplicates:renderDiagnostics()});if(renderRecoveryPending)return;renderRecoveryPending=true;setTimeout(async()=>{await load();renderRecoveryPending=false;reset();},0);}
  $: switchCollaboration(collaborationId);
  $: {
    const statuses=collaborationRecentStatuses(detail),signature=JSON.stringify(statuses);
    if(signature!==providerStatusSignature){providerStatusSignature=signature;onproviderstatus?.(statuses);}
  }
  onMount(()=>{mounted=true;const unsubscribeStore=liveStore.subscribe(state=>{detail=state.detail;liveStatus=state.connection==="live"?"Live":"Delayed";}),unsubscribeEmotion=subscribeEmotionStream(value=>emotionSnapshot=value);const visibility=()=>{if(document.visibilityState==="hidden"){stopSource();stopTaskStreams();liveStore.connection("delayed");}else{connect();syncTaskStreams();void load();}},online=()=>{mainStream?.reconnectNow();for(const source of taskSources.values())source.reconnectNow();syncTaskStreams();void load();};// The control dock is fixed over the conversation, so on a phone it sits on
  // top of what is being read. Feed the shared reading mode from the page
  // scroll so it slides away like the session composer does, and comes back at
  // the end of the conversation or on a tap.
  const dockScroll=()=>{
    const element=document.scrollingElement??document.documentElement;
    const top=element.scrollTop;
    applyChromePhase("scrolling",top,Math.max(0,element.scrollHeight-element.clientHeight-top));
  };
  const dockTap=(event:PointerEvent)=>{if(shouldRevealOnTap(event.target as Element|null))applyChromePhase("tap");};
  const trackViewport=()=>{viewportWidth=window.innerWidth;};
  trackViewport();
  window.addEventListener("resize",trackViewport);
  window.addEventListener("scroll",dockScroll,{passive:true});
  document.addEventListener("pointerup",dockTap);
  document.addEventListener("visibilitychange",visibility);window.addEventListener("online",online);void load();connect();return()=>{mounted=false;unsubscribeStore();unsubscribeEmotion();window.removeEventListener("resize",trackViewport);window.removeEventListener("scroll",dockScroll);document.removeEventListener("pointerup",dockTap);document.removeEventListener("visibilitychange",visibility);window.removeEventListener("online",online);stopSource();stopTaskStreams();if(timer)clearTimeout(timer);if(refreshTimer)clearTimeout(refreshTimer);if(scrollFrame!==null)cancelAnimationFrame(scrollFrame);};});
</script>

{#snippet conversationInputForm(inputEnabled=true)}
  <form bind:this={conversationForm} class="conversation-input" class:input-disabled={!inputEnabled} onsubmit={(event)=>{event.preventDefault();void sendConversationMessage();}}>
    <label class="conversation-input-label" for="conversation-next">{$t("collaboration.waitingUserInput",{user:userName()})}</label>
    <textarea id="conversation-next" rows="1" maxlength="20000" bind:value={nextMessage} disabled={submitting||!inputEnabled} placeholder={$t("conversation.inputPlaceholder")} onkeydown={submitConversationKey}></textarea>
    {#if currentRoleplayActive()}
      <div class="personality-reminder-control">
        <button type="button" class:armed={reminderTargets.length>0} aria-pressed={reminderTargets.length>0} disabled={submitting} onclick={()=>armReminder(reminderTargets.length?[]:availableReminderTargets())}>{$t("collaboration.reminder.label")}{#if reminderTargets.length} · {reminderTargetLabel(reminderTargets)}{/if}</button>
        {#if reminderTargets.length}
          <div class="personality-reminder-targets" role="group" aria-label={$t("collaboration.reminder.targets")}>
            <button type="button" class:active={reminderTargets.length===availableReminderTargets().length} aria-pressed={reminderTargets.length===availableReminderTargets().length} disabled={submitting} onclick={()=>armReminder(availableReminderTargets())}>{$t("collaboration.reminder.both")}</button>
            {#each availableReminderTargets() as provider}<button type="button" class:active={reminderTargets.length===1&&reminderTargets[0]===provider} aria-pressed={reminderTargets.length===1&&reminderTargets[0]===provider} disabled={submitting||!reminderTargetAvailable(provider)} onclick={()=>armReminder([provider])}>{providerDisplayName(provider)}</button>{/each}
            <button type="button" disabled={submitting} onclick={()=>armReminder([])}>{$t("common.off")}</button>
          </div>
          <small>{$t("collaboration.reminder.once")}</small>
        {/if}
      </div>
    {/if}
    <button class="primary conversation-send" type="submit" aria-label={$t("collaboration.sendNextRound")} title={$t("collaboration.sendNextRound")} disabled={!inputEnabled||!nextMessage.trim()||submitting}><Send size={19}/><span>{submitting?$t("form.submitting"):$t("collaboration.sendNextRound")}</span></button>
  </form>
{/snippet}

<section class="collaboration-view" class:embedded aria-label={$t("collaboration.timeline")}>
  {#if error}<p class="collaboration-error"><CircleAlert size={17}/>{error}</p>{/if}
  {#if detail}
    <svelte:boundary onerror={recoverRender}>
    <header class="collaboration-heading conversation-summary-heading">
      <div><span class="collab-badge">{enabledProviders().map(provider=>providerDisplayName(provider)).join(" + ")}</span><h1>{detail.session.title}</h1><p>{conversationLabel()} · {detail.session.metadata?.conversationFlow==="automatic"?$t("conversation.flowAutomatic"):$t("conversation.flowGuided")}</p></div>
      <span class="collaboration-status s-{detail.session.status}" aria-live="polite">{$t(`task.status.${detail.session.status}`)} · {$t(liveStatus==="Live"?"session.live":"session.delayed")}</span>
      <div class="conversation-summary-strip">
        <strong>{participantRoute()}</strong>
        {#if detail.session.mode==="debate"}<span>{$t("collaboration.roundProgress",{current:detail.session.metadata?.currentRound??1,max:detail.session.maxTurnsPerParticipant??"∞"})}</span>{/if}
        <span>{conversationPermission()||$t("permission.readOnly")}</span>
        {#each providerUsageSummaryRows as summary (summary.provider)}<span class="conversation-provider-usage"><b>{providerName(summary.provider)}</b><TurnUsageDetails usage={summary.usage} showProcessed={true}/></span>{/each}
        {#if codexQuotaObserved}<span class="conversation-quota-observation">{providerName("codex")} · {$t("quota.observedDuringConversation")} · {$t("quota.weekly")} {codexQuotaObserved.startPct}% → {codexQuotaObserved.endPct}%{#if codexQuotaObserved.startPct===codexQuotaObserved.endPct} · {$t("quota.belowResolution")}{/if}</span>{/if}
        {#each enabledProviders().filter(provider=>provider!=="codex"||!codexQuotaObserved) as provider}{#if currentQuota(provider)}{@const quota=currentQuota(provider)!}<span>{providerName(provider)} · {$t("quota.currentAccount")} · {$t(quota.label)} {quota.pct}%</span>{/if}{/each}
        <label>{$t("conversation.turnAutoCollapse")}<select value={turnCollapseMode} onchange={(event)=>setTurnCollapseMode(event.currentTarget.value as TurnCollapseMode)}><option value="off">{$t("conversation.turnCollapseOff")}</option><option value="mobile">{$t("conversation.turnCollapseMobile")}</option><option value="previous">{$t("conversation.turnCollapsePrevious")}</option></select></label>
      </div>
    </header>
    {#if detail.session.mode==="debate"&&detail.session.metadata?.conversationKind==="casual"}
      <div class="conversation-roster" aria-label={$t("collaboration.manageParticipants")}>
        <span>{$t("collaboration.participantsNow")}</span>
        {#each conversationProviders as provider}
          {@const typedProvider=provider as ReminderTarget}{@const active=enabledProviders().includes(typedProvider)}
          <button type="button" class:active disabled={!participantRosterEditable()||Boolean(rosterChanging)||submitting||active&&enabledProviders().length===1} title={$t(active?"collaboration.ejectModel":"collaboration.loadModel",{provider:providerName(typedProvider)})} onclick={()=>changeParticipant(typedProvider,!active)}>{#if active}<UserMinus size={15}/>{:else}<UserPlus size={15}/>{/if}<strong>{providerName(typedProvider)}</strong><small>{$t(active?"collaboration.eject":"collaboration.load")}</small></button>
        {/each}
        {#if !participantRosterEditable()}<small class="roster-hint">{$t("collaboration.changeParticipantsWhenWaiting")}</small>{/if}
      </div>
    {/if}
    {#if detail.session.metadata?.workspaceChangeNotice}<p class="snapshot-warning">{detail.session.metadata.workspaceChangeNotice}</p>{/if}
    {#if detail.session.mode!=="debate"}{@const userMessage=detail.messages.find((item:any)=>item.messageType==="user-input")}{#if userMessage}<ConversationUserCard userName={userName()} content={userMessage.contentRef} timestamp={userMessage.createdAt??detail.session.createdAt}/>{/if}{/if}
    <div class="collaboration-timeline" class:participant-grid-conversation={participantGrid}>
      {#each timelineRounds as group (group.key)}
        {@const roundReminder=reminderForRound(group.round)}
        <section class="conversation-round-group" class:participant-grid-round={participantGrid} aria-label={$t("collaboration.round",{count:group.round})}>
          {#if detail.session.mode==="debate"}{@const userMessage=detail.messages.find((item:any)=>item.messageType==="user-input"&&item.round===group.round)}{#if userMessage}<ConversationUserCard userName={userName()} content={userMessage.contentRef} timestamp={userMessage.createdAt??(group.round===1?detail.session.createdAt:null)} roundLabel={$t("collaboration.round",{count:group.round})} reminderLabel={roundReminder?`${$t("collaboration.reminder.label")} · ${reminderTargetLabel(roundReminder.targets)}`:""}/>{/if}{/if}
          <div class="conversation-round-outputs">
            {#if participantGrid}<span class="conversation-round-node" aria-hidden="true">{group.round}</span>{/if}
            {#each group.items as item (collaborationRunKey(detail.session.id,item.run))}
              {@const run=item.run}{@const index=item.index}{@const person=participant(run.participantId)}{@const task=runTask(run)}{@const output=runOutputById.get(run.id)??""}{@const outputUsage=outputUsageFor(run)}{@const frames=outputAssetFrames.get(run.id)??[]}{@const inlinePresentation=inlineEmotionCards.get(run.id)??null}{@const outfit=participantOutfit(person)}{@const queueNotice=latestParticipantRun(person.id)===run.id&&queue.visible?.participantId===person.id?queue.visible:null}{@const notice=inlinePanelNotice?.sourceRunId===run.id?inlinePanelNotice:queueNotice}{@const process=runPresentations.get(run.id)?.process??[]}{@const sessionTask=runSessionTask(run,person)}{@const reminder=reminderForRound(run.round)}
              {#if index>0}<div class="relay-arrow conversation-handoff conversation-stacked-handoff" role="separator" aria-label={$t("conversation.handoffAria",{provider:providerName(person.provider)})}><span></span><strong>{$t(run.purpose.startsWith("cross-check-")?"collaboration.relay.crossCheck":run.purpose==="review-synthesis"?"collaboration.relay.synthesis":run.purpose==="debate-turn"?"collaboration.relay.nextSpeaker":run.purpose==="independent-review"?"collaboration.relay.independent":"collaboration.relay.nextParticipant",{provider:providerName(person.provider)})}</strong><b aria-hidden="true">↓</b><span></span></div>{/if}
              <CollaborationRunCard sessionId={detail.session.id} {run} {person} {task} {output} {outputUsage} timestamp={runOutputTimestamp(run)} {frames} {inlinePresentation} {outfit} {notice} {process} {sessionTask} collapsed={collapsed.has(run.id)} processExpanded={processExpanded.has(run.id)} {reminder} {codexAvatar} {api} {onopen} ontoggle={()=>toggle(run.id)} ontoggleProcess={()=>toggleProcess(run.id)} providerLabel={providerName(person.provider)} roleLabel={roleName(person.role,run.purpose)} hostLabel={hostName(person.executionHostId)} permissionLabel={permissionName(person.permissionMode)} showRound={detail.session.mode==="debate"}/>
              {#if detail.session.mode==="debate"&&index===displayedRuns.length-1&&["starting","running"].includes(detail.session.status)}
                {@const roundRuns=displayedRuns.filter((item:any)=>item.round===run.round)}{@const nextProvider=participantOrderForRound()[roundRuns.length]}{@const pendingPerson=detail.participants.find((item:any)=>item.provider===nextProvider)}
                {#if pendingPerson}{@const nextNotice=queue.visible?.participantId===pendingPerson.id?queue.visible:null}<article class="participant-block pending-participant"><header><span class="participant-avatar"><EmotionAvatar engine={pendingPerson.provider} {codexAvatar} onMiniClick={()=>{}} miniLabel={$t("a11y.providerAvatar",{provider:providerName(pendingPerson.provider)})} externalState={{emotion:nextNotice?.emotion??"neutral",line:"",statusLine:""}}/></span><div><strong>{providerName(pendingPerson.provider)}</strong><span>{$t("collaboration.round",{count:run.round})} · {$t("collaboration.sequentialResponse")}</span></div><span class="participant-state" class:live={Boolean(nextNotice)}>{nextNotice?.line??$t("queue.pending")}</span></header></article>{/if}
              {/if}
            {/each}
          </div>
        </section>
      {/each}
    </div>
    {#if detail.session.mode==="review"&&detail.session.metadata?.reviewFinalization==="side-by-side"}
      <section class="review-conclusion-section" aria-label={$t("collaboration.conclusion.title")}><header><strong>{$t("collaboration.conclusion.title")}</strong><span>{$t("collaboration.conclusion.body")}</span></header><div class="review-conclusion-grid">{#each detail.participants as person (person.id)}{@const conclusion=latestCrossConclusion(person.id)}<article><h2>{providerName(person.provider)}</h2><p>{conclusion?runOutput(conclusion):$t("collaboration.conclusion.waiting")}</p></article>{/each}</div></section>
    {/if}
    {#if detail.session.mode==="debate"&&(detail.continuation?.available||detail.session.metadata?.conversationFlow==="guided"||detail.session.metadata?.conversationKind==="casual")}
      <section class="conversation-control-dock" class:input-open={conversationInputVisible} use:dockReserve aria-label={$t("conversation.progressControls")}>
        <div class="conversation-control-actions">
            <ConversationContinuation continuation={detail.continuation} mode={continuationMode} {submitting} maximum={detail.session.maxTurnsPerParticipant??100} onadd={addRounds} onauto={autoContinue} onretry={retryFailedTurn}/>
            {#if detail.continuation?.canResume}<button type="button" onclick={resume}>{$t("collaboration.resumeAfterCheck")}</button>{/if}
            {#if !["completed","failed","cancelled","archived"].includes(detail.session.status)}<button type="button" class="danger" onclick={cancel}><Square size={16}/>{$t("conversation.finishConversation")}</button>{/if}
        </div>
        {#if conversationInputVisible}
          {@render conversationInputForm(true)}
        {/if}
        {#if !conversationInputVisible&&!continuationAvailable()&&!["completed","partial","failed","cancelled"].includes(detail.session.status)}
          <p class="conversation-locked">{$t("collaboration.inputLocked",{user:userName()})}</p>
        {/if}
      </section>
    {/if}
    {#if detail.session.mode==="debate"&&["casual","artifact-review"].includes(detail.session.metadata?.conversationKind)&&["completed","partial","waiting-user"].includes(detail.session.status)}
      {@const conclusionFile=detail.session.metadata?.conclusionMarkdown}
      <section class="conversation-conclusion">
        <span><FileText size={17}/><strong>{$t("conclusion.title")}</strong><small>{conclusionFile?.relativePath?$t("conclusion.ready",{path:conclusionFile.relativePath}):enabledProviders().length>=2?$t("conclusion.body"):$t("conclusion.twoProviders")}</small></span>
        {#if conclusionFile?.relativePath&&conclusionFile?.workspaceId&&conclusionFile?.revision}
          <div class="conversation-conclusion-actions">
            <button type="button" onclick={()=>openConclusion(conclusionFile)} disabled={!onopenfile}><Eye size={15}/>{$t("conclusion.view")}</button>
            <a href={workspaceFileDownloadHref(conclusionFile.workspaceId,conclusionFile.relativePath)??undefined} download={String(conclusionFile.relativePath).split("/").at(-1)}><Download size={15}/>{$t("conclusion.download")}</a>
            <button type="button" class="danger" onclick={()=>deleteConclusion(conclusionFile)} disabled={conclusionDeleting}><Trash2 size={15}/>{conclusionDeleting?$t("conclusion.deleting"):$t("conclusion.delete")}</button>
          </div>
        {:else}
          <input bind:value={conclusionPath} placeholder={defaultConclusionPath()} disabled={conclusionCreating||enabledProviders().length<2}/>
          <button type="button" onclick={createConclusion} disabled={conclusionCreating||enabledProviders().length<2}>{conclusionCreating?$t("conclusion.creating"):$t("conclusion.create")}</button>
        {/if}
      </section>
    {/if}
    <div class="collaboration-actions">
      {#if detail.session.mode!=="debate"&&!["completed","failed","cancelled","archived"].includes(detail.session.status)}<button class="danger" onclick={cancel}><Square size={16}/>{$t("collaboration.stopAll")}</button>{/if}{#if detail.session.mode!=="debate"&&detail.continuation?.canResume}<button onclick={resume}>{$t("collaboration.resumeAfterCheck")}</button>{/if}{#if detail.continuation?.canAcceptPartial}<button onclick={acceptPartial}><Check size={16}/>{$t("collaboration.useCompletedOnly")}</button>{/if}{#if detail.session.mode==="assist"&&detail.session.status==="completed"}<button onclick={relayPrimary}>{$t("collaboration.relayPrimary")}</button>{/if}{#if embedded&&onclose}<button onclick={()=>onclose?.()}>{$t("collaboration.closeDetails")}</button>{/if}
    </div>
      {#snippet failed(_error,reset)}
        <p class="collaboration-error"><CircleAlert size={17}/>{$t("collaboration.duplicateData")}<button type="button" onclick={()=>{void load().then(reset);}}>{$t("common.refresh")}</button></p>
      {/snippet}
    </svelte:boundary>
  {/if}
</section>
