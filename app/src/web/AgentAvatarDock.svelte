<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import { flip } from "svelte/animate";
  import EmotionAvatar from "./EmotionAvatar.svelte";
  import { avatarTaskStreamKey, type AgentRecentSession, type AgentRecentStatus } from "./agent-status";
  import { DEFAULT_AVATAR_COLLAPSE_DELAY_MS, type AvatarTrayShape } from "./avatar-notice";
  import { relativeTime, statusLabel } from "./session-ui";
  import { t } from "./i18n";
  import { subscribeTaskLiveness } from "./liveness";

  export let codex: AgentRecentStatus | null = null;
  export let claude: AgentRecentStatus | null = null;
  export let grok:AgentRecentStatus|null=null;
  export let deepseek:AgentRecentStatus|null=null;
  export let ollama:AgentRecentStatus|null=null;
  export let antigravity:AgentRecentStatus|null=null;
  type AvatarProvider="codex"|"claude"|"antigravity"|"deepseek"|"ollama"|"grok";
  export let connectedProviders:Record<AvatarProvider,boolean>={codex:true,claude:true,grok:true,antigravity:true,deepseek:true,ollama:true};
  export let showAvatars = true;
  export let showSpeech = true;
  export let backgroundNotifications = false;
  export let vibration = false;
  type NoticeAction={type:"open-provider-models";provider:AvatarProvider};
  export let runtimeNotices:Partial<Record<AvatarProvider,{key:string;emotion:string;line:string;statusLine:string;action?:NoticeAction}>>={};
  export let onNoticeAction:((action:NoticeAction)=>void)|null=null;
  const forwardNoticeAction=(action:{type:string;provider?:string})=>onNoticeAction?.(action as NoticeAction);
  export let avatarAutoCollapse=true;
  export let avatarCollapseDelayMs=DEFAULT_AVATAR_COLLAPSE_DELAY_MS;
  export let avatarTrayShape:AvatarTrayShape="auto";
  export let statusSuspended=false;
  export let streamSuspended=false;
  export let streamSuspendedProviders:Partial<Record<AvatarProvider,boolean>>={};
  export let codexAvatar:"Gpt-Codex"|"Gpt-Sol"="Gpt-Sol";
  export let onCodexAvatarChange:((avatar:"Gpt-Codex"|"Gpt-Sol")=>void)|null=null;
  export let onAvatarOutfitChange:((provider:"codex"|"claude"|"deepseek"|"ollama"|"antigravity"|"grok",outfit:string)=>void)|null=null;
  export let completedByProvider:Record<AvatarProvider,AgentRecentSession[]>={codex:[],claude:[],grok:[],antigravity:[],deepseek:[],ollama:[]};
  export let activeByProvider:Record<AvatarProvider,AgentRecentSession[]>={codex:[],claude:[],grok:[],antigravity:[],deepseek:[],ollama:[]};
  export let sessionsLoading:Record<AvatarProvider,boolean>={codex:false,claude:false,grok:false,antigravity:false,deepseek:false,ollama:false};
  export let sessionsError:Record<AvatarProvider,boolean>={codex:false,claude:false,grok:false,antigravity:false,deepseek:false,ollama:false};
  export let onSelect:((session:AgentRecentSession)=>void|Promise<void>)|null=null;
  export let onOpen:((provider:AvatarProvider|null)=>void)|null=null;
  export let onStatusChange:((provider:AvatarProvider,taskId:string,status:"completed"|"failed"|"stopped")=>void)|null=null;
  export let onFloatingPinnedStateChange:((state:Record<AvatarProvider,boolean>)=>void)|null=null;
  let dock:HTMLDivElement;
  let openProvider:AvatarProvider|null=null;
  const storedSize=(key:string,fallback:0|1|2=1):0|1|2=>{const raw=localStorage.getItem(key);if(raw===null)return fallback;const value=Number(raw);return value===0||value===1||value===2?value:fallback;};
  let headerAvatarSizeStep=storedSize("deck-header-avatar-size");
  let floatingAvatarSizeStep=storedSize("deck-floating-avatar-size",storedSize("deck-avatar-size"));
  type Provider=AvatarProvider;
  type LiveProvider=AvatarProvider;
  const providers:Provider[]=["codex","claude","grok","antigravity","deepseek","ollama"];
  const activeStatusValues=new Set(["pending","queued","running","waiting"]);
  const legacyPinned=localStorage.getItem("deck-floating-pinned")==="1";
  let floatingPinned:Record<Provider,boolean>={
    codex:localStorage.getItem("deck-floating-pinned-codex")===null?legacyPinned:localStorage.getItem("deck-floating-pinned-codex")==="1",
    claude:localStorage.getItem("deck-floating-pinned-claude")==="1",
    grok:localStorage.getItem("deck-floating-pinned-grok")==="1",
    antigravity:localStorage.getItem("deck-floating-pinned-antigravity")==="1",
    deepseek:localStorage.getItem("deck-floating-pinned-deepseek")==="1",
    ollama:localStorage.getItem("deck-floating-pinned-ollama")==="1"
  };
  if(localStorage.getItem("deck-floating-pinned")!==null){
    if(localStorage.getItem("deck-floating-pinned-codex")===null)localStorage.setItem("deck-floating-pinned-codex",legacyPinned?"1":"0");
    if(localStorage.getItem("deck-floating-pinned-claude")===null)localStorage.setItem("deck-floating-pinned-claude","0");
    localStorage.removeItem("deck-floating-pinned");
  }
  type FloatingPosition={x:number;y:number};
  const trays:Record<Provider,HTMLDivElement|null>={codex:null,claude:null,grok:null,antigravity:null,deepseek:null,ollama:null};
  let floatingPositions:Record<Provider,FloatingPosition|null>={codex:null,claude:null,grok:null,antigravity:null,deepseek:null,ollama:null};
  let draggingFloating:Provider|null=null;
  let resetVisible:Provider|null=null;
  const resetTimers:Record<Provider,ReturnType<typeof setTimeout>|null>={codex:null,claude:null,grok:null,antigravity:null,deepseek:null,ollama:null};
  let dragCleanup:(()=>void)|null=null;
  const setHeaderAvatarSize=(size:0|1|2)=>{headerAvatarSizeStep=size;localStorage.setItem("deck-header-avatar-size",String(size));};
  const setFloatingAvatarSize=(size:0|1|2)=>{floatingAvatarSizeStep=size;localStorage.setItem("deck-floating-avatar-size",String(size));};
  const viewport=()=>{const visual=window.visualViewport;return{left:visual?.offsetLeft??0,top:visual?.offsetTop??0,width:visual?.width??window.innerWidth,height:visual?.height??window.innerHeight};};
  function positionKey(provider:Provider){return`deck-floating-position-${provider}`;}
  function clampFloatingPosition(provider:Provider,x:number,y:number):FloatingPosition{
    const view=viewport(),rect=trays[provider]?.getBoundingClientRect(),width=rect?.width??0,height=rect?.height??0;
    if(width<20||height<20)return{x,y};
    return{x:Math.min(Math.max(x,view.left+6),Math.max(view.left+6,view.left+view.width-width-6)),y:Math.min(Math.max(y,view.top+6),Math.max(view.top+6,view.top+view.height-height-6))};
  }
  function readFloatingPosition(provider:Provider):FloatingPosition|null{
    try{const raw=localStorage.getItem(positionKey(provider))??(provider==="codex"?localStorage.getItem("deck-floating-position"):null);const saved=JSON.parse(raw||"null");if(!saved||!Number.isFinite(saved.xf)||!Number.isFinite(saved.yf))return null;const view=viewport();return{x:view.left+saved.xf*view.width,y:view.top+saved.yf*view.height};}catch{return null;}
  }
  floatingPositions={codex:readFloatingPosition("codex"),claude:readFloatingPosition("claude"),grok:readFloatingPosition("grok"),antigravity:readFloatingPosition("antigravity"),deepseek:readFloatingPosition("deepseek"),ollama:readFloatingPosition("ollama")};
  if(localStorage.getItem("deck-floating-position")!==null){if(!localStorage.getItem(positionKey("codex")))localStorage.setItem(positionKey("codex"),localStorage.getItem("deck-floating-position")!);localStorage.removeItem("deck-floating-position");}
  function saveFloatingPosition(provider:Provider){const position=floatingPositions[provider];if(!position)return;const view=viewport();localStorage.setItem(positionKey(provider),JSON.stringify({xf:(position.x-view.left)/Math.max(1,view.width),yf:(position.y-view.top)/Math.max(1,view.height)}));}
  function restoreFloatingPosition(provider:Provider){if(!floatingPinned[provider])return;const restored=readFloatingPosition(provider);if(restored)floatingPositions={...floatingPositions,[provider]:clampFloatingPosition(provider,restored.x,restored.y)};}
  function clampCurrentPosition(provider:Provider){const position=floatingPositions[provider];if(!floatingPinned[provider]||!position)return;const next=clampFloatingPosition(provider,position.x,position.y);if(next.x!==position.x||next.y!==position.y){floatingPositions={...floatingPositions,[provider]:next};saveFloatingPosition(provider);}}
  function clearResetTimer(provider?:Provider){for(const item of provider?[provider]:providers){if(resetTimers[item])clearTimeout(resetTimers[item]!);resetTimers[item]=null;}}
  function showReset(provider:Provider){clearResetTimer(provider);resetVisible=provider;resetTimers[provider]=setTimeout(()=>{if(resetVisible===provider)resetVisible=null;resetTimers[provider]=null;},4000);}
  function resetFloatingPosition(provider:Provider){floatingPositions={...floatingPositions,[provider]:null};if(resetVisible===provider)resetVisible=null;clearResetTimer(provider);localStorage.removeItem(positionKey(provider));}
  function setFloatingPinned(provider:Provider,pinned:boolean){floatingPinned={...floatingPinned,[provider]:pinned};localStorage.setItem(`deck-floating-pinned-${provider}`,pinned?"1":"0");onFloatingPinnedStateChange?.({...floatingPinned});if(resetVisible===provider)resetVisible=null;clearResetTimer(provider);if(!pinned)resetFloatingPosition(provider);}
  function beginFloatingDrag(provider:Provider,event:PointerEvent){
    const tray=trays[provider];
    if(!floatingPinned[provider]||!tray||event.button!==0||(event.target as HTMLElement).closest("button"))return;
    const rect=tray.getBoundingClientRect(),startX=event.clientX,startY=event.clientY,startLeft=rect.left,startTop=rect.top;
    let moved=false;
    dragCleanup?.();
    const move=(next:PointerEvent)=>{const dx=next.clientX-startX,dy=next.clientY-startY;if(!moved&&Math.hypot(dx,dy)<6)return;moved=true;draggingFloating=provider;if(resetVisible===provider)resetVisible=null;clearResetTimer(provider);floatingPositions={...floatingPositions,[provider]:clampFloatingPosition(provider,startLeft+dx,startTop+dy)};next.preventDefault();};
    const cleanup=()=>{window.removeEventListener("pointermove",move);window.removeEventListener("pointerup",up);window.removeEventListener("pointercancel",cancel);dragCleanup=null;};
    // A card still sitting in the flow has no placement to undo, so the reset
    // affordance only appears once the user has actually moved it out.
    const up=()=>{cleanup();if(moved){draggingFloating=null;saveFloatingPosition(provider);}else if(floatingPositions[provider])showReset(provider);};
    const cancel=()=>{cleanup();draggingFloating=null;};
    dragCleanup=cleanup;window.addEventListener("pointermove",move,{passive:false});window.addEventListener("pointerup",up,{once:true});window.addEventListener("pointercancel",cancel,{once:true});
  }
  function trackTray(node:HTMLDivElement,provider:Provider){
    trays[provider]=node;const observer=new ResizeObserver(()=>clampCurrentPosition(provider));observer.observe(node);requestAnimationFrame(()=>restoreFloatingPosition(provider));
    return{destroy(){observer.disconnect();if(trays[provider]===node)trays[provider]=null;}};
  }
  type NoticeControl={collapse:()=>void};
  let codexNotice:NoticeControl|null=null;
  let claudeNotice:NoticeControl|null=null;
  const emptySource=()=>({codex:null,claude:null,grok:null,antigravity:null,deepseek:null,ollama:null}) as Record<LiveProvider,(()=>void)|null>;
  const emptyKeys=()=>({codex:"",claude:"",grok:"",antigravity:"",deepseek:"",ollama:""}) as Record<LiveProvider,string>;
  const emptyCursors=()=>({codex:{taskId:"",sequence:0},claude:{taskId:"",sequence:0},grok:{taskId:"",sequence:0},antigravity:{taskId:"",sequence:0},deepseek:{taskId:"",sequence:0},ollama:{taskId:"",sequence:0}}) as Record<LiveProvider,{taskId:string;sequence:number}>;
  let liveStatuses:Record<LiveProvider,string>={codex:"",claude:"",grok:"",antigravity:"",deepseek:"",ollama:""};
  const sources=emptySource();
  const sourceKeys=emptyKeys();
  const sourceCursors=emptyCursors();
  let liveActivity:Record<LiveProvider,{phase:string;raw:string;labelKey:string}|null>={codex:null,claude:null,grok:null,antigravity:null,deepseek:null,ollama:null};
  let terminalStatus:Partial<Record<LiveProvider,{taskId:string;status:"completed"|"failed"|"stopped"}>>={};
  // Floating cards stack newest-first. Only the empty -> active transition counts
  // as "appeared"; running -> completed must not shuffle a card back to the top.
  let activitySeq=0;
  let lastActive:Record<LiveProvider,number>={codex:0,claude:0,grok:0,antigravity:0,deepseek:0,ollama:0};
  function setLiveStatus(provider:LiveProvider,status:string){
    if(status&&!liveStatuses[provider])lastActive={...lastActive,[provider]:++activitySeq};
    else if(!status&&lastActive[provider])lastActive={...lastActive,[provider]:0};
    liveStatuses={...liveStatuses,[provider]:status};
  }
  function sync(provider:LiveProvider,recent:AgentRecentStatus|null){
    // Do not restore terminal state from localStorage. It belongs to a concrete
    // task and otherwise contaminates the next task while snapshots are loading.
    if(!recent){sources[provider]?.();sources[provider]=null;sourceKeys[provider]="";terminalStatus={...terminalStatus,[provider]:undefined};setLiveStatus(provider,"");liveActivity={...liveActivity,[provider]:null};return;}
    const previousTaskId=sourceCursors[provider].taskId;
    if(previousTaskId&&previousTaskId!==recent.taskId)liveActivity={...liveActivity,[provider]:null};
    const terminalRecord=terminalStatus[provider];
    if(terminalRecord&&terminalRecord.taskId!==recent.taskId)terminalStatus={...terminalStatus,[provider]:undefined};
    else if(terminalRecord&&activeStatusValues.has(recent.status)){
      // A provider refresh may have started before the terminal SSE arrived.
      // Keep the task-scoped terminal event authoritative over that stale row.
      sources[provider]?.();sources[provider]=null;sourceKeys[provider]="";setLiveStatus(provider,terminalRecord.status);return;
    }
    const key=avatarTaskStreamKey(recent,streamSuspended||streamSuspendedProviders[provider]===true||!showAvatars);
    if(sourceKeys[provider]===key){if(!key)setLiveStatus(provider,recent.status??"");return;}
    sources[provider]?.();sources[provider]=null;sourceKeys[provider]=key;
    setLiveStatus(provider,recent.status??"");
    if(!key||!recent?.taskId||document.visibilityState!=="visible")return;
    if(sourceCursors[provider].taskId!==recent.taskId)sourceCursors[provider]={taskId:recent.taskId,sequence:0};
    const applyStatus=(status:string)=>setLiveStatus(provider,status);
    let terminal=false;
    const unsubscribe=subscribeTaskLiveness({provider,taskId:recent.taskId,after:sourceCursors[provider].sequence,onChange:value=>{if(!value.eventCount)return;setLiveStatus(provider,value.phase);liveActivity={...liveActivity,[provider]:{phase:value.phase,raw:value.recentActivity?.raw??"",labelKey:value.recentActivity?.labelKey??""}};},onEvent:(event)=>{const sequence=Number(event.sequence)||0;if(sequence)sourceCursors[provider].sequence=Math.max(sourceCursors[provider].sequence,sequence);if(!event.terminal)return;terminal=true;const status=event.type==="task_completed"?"completed":event.type==="task_stopped"?"stopped":"failed";terminalStatus={...terminalStatus,[provider]:{taskId:recent.taskId!,status}};setLiveStatus(provider,status);onStatusChange?.(provider,recent.taskId!,status);if(document.visibilityState!=="visible"){if(vibration&&navigator.vibrate)navigator.vibrate(status==="completed"?[80]:[100,80,100]);if(backgroundNotifications&&"Notification" in window&&Notification.permission==="granted")new Notification(recent.title,{body:$t(status==="completed"?"notification.taskCompleted":"notification.checkTask")});}sources[provider]?.();sources[provider]=null;},onResync:(value)=>{sourceCursors[provider].sequence=Math.max(sourceCursors[provider].sequence,Number(value?.latestSequence)||0);fetch(`/api/tasks/${provider}/${encodeURIComponent(recent.taskId!)}`,{headers:{Accept:"application/json"}}).then(response=>response.ok?response.json():null).then(data=>{const status=data?.task?.status;if(typeof status==="string"&&!terminalStatus[provider])applyStatus(status);}).catch(()=>{});}});
    if(terminal)unsubscribe();else sources[provider]=unsubscribe;
  }
  $: sync("codex",codex);
  $: sync("claude",claude);
  $: sync("grok",grok);
  $: sync("antigravity",antigravity);
  $: sync("deepseek",deepseek);
  $: sync("ollama",ollama);
  $: if(statusSuspended&&resetVisible){resetVisible=null;clearResetTimer();}
  onMount(()=>{
    onFloatingPinnedStateChange?.({...floatingPinned});
    const visibility=()=>{
      if(document.visibilityState==="hidden"&&!backgroundNotifications){
        for(const provider of providers){sources[provider]?.();sources[provider]=null;sourceKeys[provider]="";}
      }else{
        sync("codex",codex);sync("claude",claude);sync("grok",grok);sync("antigravity",antigravity);sync("deepseek",deepseek);sync("ollama",ollama);
      }
    };
    const outside=(event:PointerEvent)=>{if(dock&&!dock.contains(event.target as Node)){openProvider=null;resetVisible=null;clearResetTimer();}};
    const key=(event:KeyboardEvent)=>{if(event.key==="Escape"){openProvider=null;resetVisible=null;clearResetTimer();}};
    const reposition=()=>{for(const provider of providers)restoreFloatingPosition(provider);};
    document.addEventListener("visibilitychange",visibility);
    document.addEventListener("pointerdown",outside);
    document.addEventListener("keydown",key);
    window.addEventListener("resize",reposition);window.visualViewport?.addEventListener("resize",reposition);window.visualViewport?.addEventListener("scroll",reposition);
    return()=>{document.removeEventListener("visibilitychange",visibility);document.removeEventListener("pointerdown",outside);document.removeEventListener("keydown",key);window.removeEventListener("resize",reposition);window.visualViewport?.removeEventListener("resize",reposition);window.visualViewport?.removeEventListener("scroll",reposition);dragCleanup?.();clearResetTimer();};
  });
  onDestroy(()=>{for(const provider of providers)sources[provider]?.();});

  const label = (provider:AvatarProvider,recent:AgentRecentStatus|null,status?:string) => {
    const name=providerName(provider);
    return recent ? $t("avatar.recentSession",{provider:name,title:recent.title,status:status||recent.status||""}) : $t("avatar.noRecentSession",{provider:name});
  };
  // The bubble is only as wide as the avatar, so it uses short labels of its own
  // where the full liveness phrase would be clipped to an ellipsis.
  const speech = (status?: string) => status === "running" ? $t("task.status.running")
    : status === "reasoning" ? $t("liveness.phase.reasoning")
    : status === "acting" ? $t("avatar.speech.acting")
    : status === "waiting-user" ? $t("avatar.speech.waiting-user")
    : status === "waiting-approval" ? $t("liveness.phase.waiting-approval")
    : status === "pending" || status === "queued" ? $t("task.status.queued")
    : status === "waiting" ? $t("task.status.waiting")
    : status === "completed" ? $t("task.status.completed")
    : status === "failed" ? $t("task.status.failed")
    : status === "stopped" ? $t("task.status.stopped")
    : "";
  const speechTitle = (status?: string) => status === "acting" ? $t("liveness.phase.acting")
    : status === "waiting-user" ? $t("liveness.phase.waiting-user")
    : speech(status);
  import { upsertStableRows } from "./collaboration-identity";
  const providerName=(provider:AvatarProvider)=>({codex:"Codex",claude:"Claude",grok:"Grok",antigravity:"Gemini",deepseek:"DeepSeek",ollama:"Ollama"})[provider];
  const sessionKey=(provider:AvatarProvider,session:AgentRecentSession)=>`task:${provider}:${session.taskId??session.threadId??""}`;
  const collapseNotices=()=>{codexNotice?.collapse();claudeNotice?.collapse();};
  const toggle=(provider:AvatarProvider)=>{
    resetVisible=null;clearResetTimer();
    openProvider=openProvider===provider?null:provider;
    if(openProvider)collapseNotices();
    onOpen?.(openProvider);
  };
  const choose=async(session:AgentRecentSession)=>{const select=onSelect;openProvider=null;onOpen?.(null);await tick();await select?.(session);};
  const displayStatus=(provider:AvatarProvider,recent:AgentRecentStatus|null,statuses:Record<LiveProvider,string>)=>statuses[provider]||recent?.status;
  // Newest arrival first; providers that never spoke keep the declared order.
  // These are reactive statements rather than calls made from the markup: a
  // helper that reads component state inside its own body hides that state from
  // the expression that calls it, so the list kept its first value while the
  // recent-task props and the dragged position moved on without it.
  $: providerItems=[
    {provider:"codex" as const,recent:codex},
    {provider:"claude" as const,recent:claude},
    {provider:"grok" as const,recent:grok},
    {provider:"antigravity" as const,recent:antigravity},
    {provider:"deepseek" as const,recent:deepseek},
    {provider:"ollama" as const,recent:ollama}
  ];
  $: orderedItems=providerItems
    .map((item,index)=>({item,index}))
    .sort((a,b)=>(lastActive[b.item.provider]-lastActive[a.item.provider])||(a.index-b.index))
    .map(entry=>entry.item);
  // A pinned card only leaves the flow once the user has actually placed it.
  const detached=(provider:AvatarProvider,pinned:Record<Provider,boolean>,positions:Record<Provider,FloatingPosition|null>)=>pinned[provider]&&positions[provider]!==null;
</script>

{#if showAvatars}<div class="agent-avatar-dock header-size-{headerAvatarSizeStep}" aria-label={$t("session.recent")} bind:this={dock}>
  {#each providerItems.filter(item=>connectedProviders[item.provider]) as item (item.provider)}
    {@const provider=item.provider}
    {@const recent=item.recent}
    {@const name=providerName(provider)}
    {@const status=displayStatus(provider,recent,liveStatuses)}
    {@const text=speech(status)}
    {@const activeSessions=upsertStableRows(activeByProvider[provider],session=>sessionKey(provider,session))}
    {@const completedSessions=upsertStableRows(completedByProvider[provider],session=>sessionKey(provider,session))}
    <div class="agent-avatar-slot {provider}" title={label(provider,recent,status)}>
      {#key `${provider}:${status}`}
        <EmotionAvatar engine={provider} {codexAvatar} onMiniClick={()=>toggle(provider)} miniExpanded={openProvider===provider} miniLabel={$t("avatar.statusAndRecent",{provider:name})} context={{provider,status,sessionId:recent?.threadId,taskId:recent?.taskId}}/>
      {/key}
      {#if showSpeech&&text}<span class="avatar-speech status-{status}" role="status" title={speechTitle(status)}><span>{text}</span></span>{/if}
      {#if openProvider===provider}
        <div class="recent-session-pop" role="dialog" aria-label={$t("avatar.avatarAndSessions",{provider:name})}>
          <header><strong>{$t("avatar.providerSessions",{provider:name})}</strong><small>{$t("avatar.selectToOpen")}</small></header>
          {#if liveActivity[provider]}
            <div class="provider-live-activity"><strong>{$t(liveActivity[provider]!.labelKey||`liveness.phase.${liveActivity[provider]!.phase}`)}</strong>{#if liveActivity[provider]!.raw}<code>{liveActivity[provider]!.raw}</code>{/if}</div>
          {/if}
          <div class="recent-avatar-profile">
            <EmotionAvatar variant="panel" engine={provider} {codexAvatar} onCodexAvatarChange={provider==="codex"?onCodexAvatarChange:null} {onAvatarOutfitChange} avatarAutoCollapse={false} allowDrag={false} collapsible={false} {headerAvatarSizeStep} {floatingAvatarSizeStep} floatingPinned={floatingPinned[provider]} onHeaderAvatarSizeChange={setHeaderAvatarSize} onFloatingAvatarSizeChange={setFloatingAvatarSize} onFloatingPinnedChange={pinned=>setFloatingPinned(provider,pinned)} context={{provider,status,sessionId:recent?.threadId,taskId:recent?.taskId}}/>
          </div>
          {#if activeSessions.length}
            <h4>{$t("task.status.running")}</h4>
            <div class="recent-session-list active-list">
              {#each activeSessions as session (sessionKey(provider,session))}
                <button type="button" onclick={()=>choose(session)}><span class="recent-live"></span><span><strong>{session.title}</strong><small>{statusLabel(session.status)} · {session.projectId??$t("session.unregisteredProject")} · {relativeTime(session.updatedAt)}</small></span></button>
              {/each}
            </div>
          {/if}
          {#if completedSessions.length}
            <h4>{$t("session.recentCompleted")}</h4>
            <div class="recent-session-list">
              {#each completedSessions as session (sessionKey(provider,session))}
                <button type="button" onclick={()=>choose(session)}><span class="recent-check">✓</span><span><strong>{session.title}</strong><small>{session.projectId??$t("session.unregisteredProject")} · {relativeTime(session.updatedAt)}</small></span></button>
              {/each}
            </div>
          {:else if !activeSessions.length&&sessionsLoading[provider]}<p role="status">{$t("common.loading")}</p>
          {:else if !activeSessions.length&&sessionsError[provider]}<p role="alert">{$t("common.notAvailable")} · <button type="button" onclick={()=>onOpen?.(provider)}>{$t("common.retry")}</button></p>
          {:else if !activeSessions.length}<p>{$t("session.noResults")}</p>{/if}
        </div>
      {/if}
    </div>
  {/each}
  {#if showSpeech}
    <!-- The overview hides automatic notices with CSS but keeps them mounted.
         Removing them here recreated each EmotionAvatar on every session-tab
         entry, so an unchanged status opened again as if it were a new event. -->
    {@const flowItems=orderedItems.filter(item=>connectedProviders[item.provider]&&!detached(item.provider,floatingPinned,floatingPositions))}
    {#if flowItems.length}
      <div class="agent-status-tray flow floating-size-{floatingAvatarSizeStep} floating-shape-{avatarTrayShape}" role="group" aria-label={$t("avatar.automaticNotices")} aria-live="polite">
        {#each flowItems as item (item.provider)}
          {@const provider=item.provider}{@const recent=item.recent}{@const status=displayStatus(provider,recent,liveStatuses)}{@const pinned=floatingPinned[provider]}{@const noticeActive=Boolean(runtimeNotices[provider])}
          <div class="tray-item provider-{provider} status-{status||'idle'}" class:pinned class:auto={!pinned} class:notice-active={noticeActive} class:dragging={draggingFloating===provider} role="group" aria-label={pinned?$t("avatar.pinnedNotice",{provider:providerName(provider)}):providerName(provider)} animate:flip={{duration:180}} onpointerdown={(event)=>{if(pinned)beginFloatingDrag(provider,event);}} use:trackTray={provider}>
            {#if provider==="codex"}<EmotionAvatar bind:this={codexNotice} variant="panel" engine={provider} {codexAvatar} nameLabel={providerName(provider)} avatarAutoCollapse={pinned?false:avatarAutoCollapse} {avatarCollapseDelayMs} allowDrag={false} collapsible={!pinned} showSettings={false} keepEmptyCollapsed initialCollapsed={pinned?false:!status&&!recent} suspended={statusSuspended||openProvider!==null} externalState={runtimeNotices[provider]??null} onExternalAction={forwardNoticeAction} context={{provider,status,sessionId:recent?.threadId,taskId:recent?.taskId}}/>
            {:else if provider==="claude"}<EmotionAvatar bind:this={claudeNotice} variant="panel" engine={provider} nameLabel={providerName(provider)} avatarAutoCollapse={pinned?false:avatarAutoCollapse} {avatarCollapseDelayMs} allowDrag={false} collapsible={!pinned} showSettings={false} keepEmptyCollapsed initialCollapsed={pinned?false:!status&&!recent} suspended={statusSuspended||openProvider!==null} externalState={runtimeNotices[provider]??null} onExternalAction={forwardNoticeAction} context={{provider,status,sessionId:recent?.threadId,taskId:recent?.taskId}}/>
            {:else}<EmotionAvatar variant="panel" engine={provider} nameLabel={providerName(provider)} avatarAutoCollapse={pinned?false:avatarAutoCollapse} {avatarCollapseDelayMs} allowDrag={false} collapsible={!pinned} showSettings={false} keepEmptyCollapsed initialCollapsed={pinned?false:!status&&!recent} suspended={statusSuspended||openProvider!==null} externalState={runtimeNotices[provider]??null} onExternalAction={forwardNoticeAction} context={{provider,status,sessionId:recent?.threadId,taskId:recent?.taskId}}/>{/if}
            {#if resetVisible===provider}<button type="button" class="floating-reset" onclick={()=>resetFloatingPosition(provider)}>{$t("avatar.resetPosition")}</button>{/if}
          </div>
        {/each}
      </div>
    {/if}
    {#each orderedItems.filter(item=>connectedProviders[item.provider]&&detached(item.provider,floatingPinned,floatingPositions)) as item (item.provider)}
      {@const provider=item.provider}{@const recent=item.recent}{@const status=displayStatus(provider,recent,liveStatuses)}{@const noticeActive=Boolean(runtimeNotices[provider])}
      <div use:trackTray={provider} class="agent-status-tray pinned tray-item provider-{provider} status-{status||'idle'} floating-size-{floatingAvatarSizeStep} floating-shape-{avatarTrayShape}" class:notice-active={noticeActive} class:dragging={draggingFloating===provider} role="group" aria-label={$t("avatar.pinnedNotice",{provider:providerName(provider)})} aria-live="polite" style={floatingPositions[provider]?`left:${floatingPositions[provider]!.x}px;top:${floatingPositions[provider]!.y}px;right:auto;`:""} onpointerdown={(event)=>beginFloatingDrag(provider,event)}>
        <EmotionAvatar variant="panel" engine={provider} {codexAvatar} nameLabel={providerName(provider)} avatarAutoCollapse={false} {avatarCollapseDelayMs} allowDrag={false} collapsible={false} showSettings={false} keepEmptyCollapsed initialCollapsed={false} suspended={statusSuspended||openProvider!==null} externalState={runtimeNotices[provider]??null} onExternalAction={forwardNoticeAction} context={{provider,status,sessionId:recent?.threadId,taskId:recent?.taskId}}/>
        {#if resetVisible===provider}<button type="button" class="floating-reset" onclick={()=>resetFloatingPosition(provider)}>{$t("avatar.resetPosition")}</button>{/if}
      </div>
    {/each}
  {/if}
</div>{/if}
