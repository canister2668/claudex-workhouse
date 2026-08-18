<script lang="ts">
  import { Expand, Move, Pin, RotateCcw, Settings, Zap } from "@lucide/svelte";
  import { onMount } from "svelte";
  import { avatarNoticeKey, DEFAULT_AVATAR_COLLAPSE_DELAY_MS, normalizeAvatarCollapseDelay, terminalNoticeStatus } from "./avatar-notice";
  import { emotionAssetUrl } from "./collaboration-assets";
  import { emotionAssetFile, emotionStateMatchesContext, localizedEmotionCopy, statusEmotion, type EmotionAssetEntry } from "./emotion-state";
  import { subscribeEmotionStream, type EmotionTaskStates } from "./emotion-stream";
  import { locale, t } from "./i18n";
  import { avatarDisplayMode, providerNameMark } from "./provider-name-mark";

  // Mirrors the VS Code emotion panel (provider-worker state.json via SSE).
  // Claude and Codex workers write separate provider states; both are accepted
  // only when their session ID matches the selected thread.
  export let engine: "all" | "codex" | "claude" | "deepseek" | "ollama" | "antigravity" | "grok" = "all";
  export let context: { provider?: "codex" | "claude" | "deepseek" | "ollama" | "antigravity" | "grok"; status?: string; sessionId?: string | null; taskId?: string | null } | null = null;
  export let variant: "mini" | "panel" = "mini";
  export let codexAvatar: "Gpt-Codex"|"Gpt-Sol" = "Gpt-Sol";
  export let onCodexAvatarChange:((avatar:"Gpt-Codex"|"Gpt-Sol")=>void)|null=null;
  export let onAvatarOutfitChange:((provider:"codex"|"claude"|"deepseek"|"ollama"|"antigravity"|"grok",outfit:string)=>void)|null=null;
  export let onMiniClick:(()=>void)|null=null;
  export let miniLabel="";
  export let miniExpanded=false;
  export let avatarAutoCollapse=true;
  export let avatarCollapseDelayMs=DEFAULT_AVATAR_COLLAPSE_DELAY_MS;
  export let allowDrag=true;
  export let suspended=false;
  export let initialCollapsed=false;
  export let collapsible=true;
  export let showSettings=true;
  export let headerAvatarSizeStep:0|1|2=1;
  export let floatingAvatarSizeStep:0|1|2=1;
  export let onHeaderAvatarSizeChange:((size:0|1|2)=>void)|null=null;
  export let onFloatingAvatarSizeChange:((size:0|1|2)=>void)|null=null;
  export let floatingPinned=false;
  export let onFloatingPinnedChange:((pinned:boolean)=>void)|null=null;
  export let keepEmptyCollapsed=false;
  // Floating tray cards carry the provider name so identity survives when the
  // character art is small or several cards overlap.
  export let nameLabel="";
  type ExternalAction={type:string;provider?:string};
  export let externalState:{key?:string;emotion:string;line:string;statusLine:string;outfit?:string;action?:ExternalAction}|null=null;
  export let onExternalAction:((action:ExternalAction)=>void)|null=null;
  export let onPanelClick:(()=>void)|null=null;

  type EmotionState = { emotion: string; line: string; statusLine: string; lineKey?: string; statusKey?: string; outfit: string; source?: string; sessionId?: string; taskId?: string; timestamp?: number };
  let state: EmotionState = { emotion: "neutral", line: "", statusLine: "", outfit: "normal" };
  let codexState: EmotionState = { emotion: "neutral", line: "", statusLine: "", outfit: "Gpt-Sol" };
  let grokState:EmotionState={emotion:"neutral",line:"",statusLine:"",outfit:"Grok"};
  let deepseekState:EmotionState={emotion:"neutral",line:"",statusLine:"",outfit:"DeepSeek"};
  let ollamaState:EmotionState={emotion:"neutral",line:"",statusLine:"",outfit:"Ollama"};
  let antigravityState:EmotionState={emotion:"neutral",line:"",statusLine:"",outfit:"Antigravity"};
  let taskStates:EmotionTaskStates={codex:{},claude:{},grok:{},deepseek:{},ollama:{},antigravity:{}};
  let assets:Record<string,EmotionAssetEntry[]>={};
  let localOutfit:{provider:"codex"|"claude"|"deepseek"|"ollama"|"antigravity"|"grok";outfit:string}|null=null;
  let outfitRequest=0;
  let bootstrapStatus:"pending"|"ready"|"error"="pending";
  let open = false;
  let outfitsByProvider:Record<"codex"|"claude"|"deepseek"|"ollama"|"antigravity"|"grok",string[]>={codex:["Gpt-Codex","Gpt-Sol"],claude:["normal","capy"],grok:["Grok"],antigravity:["Antigravity","Gemma-e4b"],deepseek:["DeepSeek","Ollama"],ollama:["Ollama","DeepSeek","Antigravity","Gemma-e4b"]};
  let inputMode: "mcp" | "catch" = "mcp";
  async function toggleMode() {
    const next = inputMode === "mcp" ? "catch" : "mcp";
    try {
      await fetch("/api/emotion/mode", { method: "POST", headers: { "Content-Type": "application/json", "X-Claudex-Workhouse-Request": "1", Accept: "application/json" }, body: JSON.stringify({ mode: next }) });
      inputMode = next;
    } catch { /* keep current */ }
  }
  async function setOutfit(outfit: string) {
    const provider=ctxEngine==="codex"||ctxEngine==="grok"||ctxEngine==="deepseek"||ctxEngine==="ollama"||ctxEngine==="antigravity"?ctxEngine:"claude";
    const request=++outfitRequest;
    localOutfit={provider,outfit};
    if(provider==="codex")codexState={...codexState,outfit};
    else if(provider==="grok")grokState={...grokState,outfit};
    else if(provider==="deepseek")deepseekState={...deepseekState,outfit};
    else if(provider==="ollama")ollamaState={...ollamaState,outfit};
    else if(provider==="antigravity")antigravityState={...antigravityState,outfit};
    else state={...state,outfit};
    try {
      const response = await fetch("/api/emotion/outfit", { method: "POST", headers: { "Content-Type": "application/json", "X-Claudex-Workhouse-Request": "1", Accept: "application/json" }, body: JSON.stringify({ provider,outfit }) });
      if(!response.ok)throw new Error(`outfit ${response.status}`);
      const data = await response.json();
      if(request!==outfitRequest)return;
      if(data.state){
        if(provider==="codex")codexState={...codexState,...data.state};
        else if(provider==="grok")grokState={...grokState,...data.state};
        else if(provider==="deepseek")deepseekState={...deepseekState,...data.state};
        else if(provider==="ollama")ollamaState={...ollamaState,...data.state};
        else if(provider==="antigravity")antigravityState={...antigravityState,...data.state};
        else state={...state,...data.state};
      }
      localOutfit=null;
      onAvatarOutfitChange?.(provider,outfit);
      if(provider==="codex"){codexAvatar=outfit as "Gpt-Codex"|"Gpt-Sol";onCodexAvatarChange?.(codexAvatar);}
    } catch { if(request===outfitRequest)localOutfit=null; }
  }
  let fallbackStep = 0;
  let hidden = false;
  let collapsed=suspended||initialCollapsed||(keepEmptyCollapsed&&!context?.status);
  let collapseTimer:ReturnType<typeof setTimeout>|null=null;
  let mounted=false;
  let hovering=false;
  let pointerActive=false;

  const clean = (value: string, fallback: string) => (value || "").replace(/[^a-zA-Z0-9_-]/g, "") || fallback;
  const codexLine = (emotion: string) => (({ coding: $t("avatar.coding"), confused: $t("avatar.needsCheck"), happy: $t("avatar.completed"), sad: $t("avatar.failed"), neutral: "" }) as Record<string, string>)[emotion] ?? "";
  $: resolvedMiniLabel=miniLabel||$t("avatar.agentStatus");
  const sizeLabel=(step:number)=>[$t("avatar.size.small"),$t("avatar.size.medium"),$t("avatar.size.large")][step];

  $: ctxEngine = context?.provider ?? (engine !== "all" ? engine : null);
  $: markProvider=ctxEngine??engine;
  $: nameMark=providerNameMark(markProvider,$locale);
  $: latestProviderState=ctxEngine==="codex"?codexState:ctxEngine==="grok"?grokState:ctxEngine==="deepseek"?deepseekState:ctxEngine==="ollama"?ollamaState:ctxEngine==="antigravity"?antigravityState:state;
  // A task-scoped avatar shows its own task or nothing. Falling back to the
  // provider's latest state let a task that had not written an emotion yet --
  // every task, for the seconds its worker takes to boot -- display the
  // previous task's "완료". Appearance still follows the provider.
  $: providerState=ctxEngine&&context?.taskId
    ?taskStates[ctxEngine]?.[context.taskId]??(latestProviderState.taskId===context.taskId?latestProviderState:{emotion:"neutral",line:"",statusLine:"",outfit:latestProviderState.outfit})
    :latestProviderState;
  $: outfits=ctxEngine?outfitsByProvider[ctxEngine]:[];
  $: matchingProviderHook=emotionStateMatchesContext(providerState,context?.sessionId,context?.taskId,context?.status);
  // Run-scoped collaboration state owns emotion/text, but the user's normal
  // avatar selection still owns appearance unless an explicit outfit is given.
  // Static defaults are not server state. Use the local Codex display cache only
  // until bootstrap completes; after that every provider follows the canonical
  // server selection even when the state has no task/source metadata.
  $: latestOutfit=ctxEngine==="codex"&&bootstrapStatus!=="ready"?codexAvatar:latestProviderState.outfit;
  $: requestedOutfit=externalState?.outfit?clean(externalState.outfit,"normal"):localOutfit?.provider===ctxEngine?clean(localOutfit.outfit,outfits[0]??"normal"):clean(latestOutfit,outfits[0]??"normal");
  $: outfit=outfits.includes(requestedOutfit)?requestedOutfit:outfits[0]??"normal";
  $: emotion = externalState ? clean(externalState.emotion,"neutral") : matchingProviderHook ? clean(providerState.emotion,"neutral") : statusEmotion(context?.status);
  // Worker and hook copy arrives as a translation key; model-authored lines have no
  // key and are shown exactly as written. A key with no dictionary entry falls back
  // to the literal the writer stored rather than rendering the raw key.
  // `$t` is passed in so the reactive statement re-runs when the language changes.
  $: line = externalState ? externalState.line : matchingProviderHook ? localizedEmotionCopy($t, providerState.lineKey, providerState.line) : codexLine(emotion);
  $: statusLine = externalState ? externalState.statusLine : matchingProviderHook ? localizedEmotionCopy($t, providerState.statusKey, providerState.statusLine) : (context?.status ?? "");
  $: noticeKey=avatarNoticeKey({engine:ctxEngine,sessionId:externalState?.key??context?.sessionId,status:context?.status,outfit,emotion,line,statusLine});
  let lastNoticeKey="";
  let hadExternalState=false;
  let pendingReveal=false;
  let pendingRevealForce=false;
  let manuallyCollapsed=false;
  let lastNoticeScope="";
  // A dismissal belongs to the notice the user dismissed, not to the provider.
  // Scoping it to the session meant one tap -- easy to land by accident on a
  // phone, where the card is deliberately tappable -- silenced every later
  // notice of that session, including the completion. The scope is the task, and
  // an outcome always speaks even while the current task is dismissed.
  $: noticeScope=`${ctxEngine??"all"}:${externalState?.key??context?.taskId??context?.sessionId??""}`;
  $: if(noticeScope!==lastNoticeScope){if(lastNoticeScope)manuallyCollapsed=false;lastNoticeScope=noticeScope;}
  $: if(noticeKey!==lastNoticeKey){const hadNotice=Boolean(lastNoticeKey),clearingExternal=hadExternalState&&!externalState,outcome=terminalNoticeStatus(context?.status);lastNoticeKey=noticeKey;hadExternalState=Boolean(externalState);if(mounted&&hadNotice&&!clearingExternal){if(suspended){pendingReveal=true;pendingRevealForce=pendingRevealForce||outcome;}else revealNotice(outcome);}}
  $: normalAssetEmotion = emotion;
  $: outfitAssetFile=emotionAssetFile(assets,outfit,normalAssetEmotion,`${normalAssetEmotion}.webp`);
  $: codexFallbackFile=emotionAssetFile(assets,"Gpt-Codex",normalAssetEmotion,`${normalAssetEmotion}.webp`);
  $: normalFallbackFile=emotionAssetFile(assets,"normal",normalAssetEmotion,`${normalAssetEmotion}.webp`);
  $: outfitNeutralFile=emotionAssetFile(assets,outfit,"neutral","neutral.webp");
  $: normalNeutralFile=emotionAssetFile(assets,"normal","neutral","neutral.webp");
  $: candidates = ctxEngine === "codex"
    ? [...new Set([emotionAssetUrl(outfit,outfitAssetFile),emotionAssetUrl("Gpt-Codex",codexFallbackFile),emotionAssetUrl("normal",normalFallbackFile),emotionAssetUrl("normal",normalNeutralFile)])]
    : ctxEngine === "claude"
      ? [...new Set([emotionAssetUrl(outfit,outfitAssetFile),emotionAssetUrl("normal",normalFallbackFile),emotionAssetUrl("normal",normalNeutralFile)])]
      : [...new Set([emotionAssetUrl(outfit,outfitAssetFile),emotionAssetUrl(outfit,outfitNeutralFile)])];
  $: imageKey = `${outfit}/${emotion}/${candidates[0]??""}`;
  let lastKey = "";
  $: if (imageKey !== lastKey) { lastKey = imageKey; fallbackStep = 0; hidden = false; }
  const onError = () => { if (fallbackStep < candidates.length - 1) fallbackStep += 1; else hidden = true; };

  // ---- panel placement & size (persisted) ----
  // Position is stored as viewport fractions so it survives rotation/resizes;
  // size is a device-independent step (0/1/2) mapped to pixels per breakpoint in CSS.
  let asideEl: HTMLElement;
  let controlsOpen = false;
  let sizeStep: 0 | 1 | 2 = (():0|1|2 => { const v = Number(localStorage.getItem("deck-avatar-size")); return v === 0 || v === 2 ? v : 1; })();
  let dragEnabled = allowDrag&&localStorage.getItem("deck-avatar-drag") === "1";
  let pos: { x: number; y: number } | null = (() => {
    try {
      const saved = JSON.parse(localStorage.getItem("deck-avatar-pos") || "null");
      if (!saved || !Number.isFinite(saved.xf) || !Number.isFinite(saved.yf)) return null;
      return { x: Math.min(Math.max(saved.xf * window.innerWidth, 4), window.innerWidth - 80), y: Math.min(Math.max(saved.yf * window.innerHeight, 4), window.innerHeight - 80) };
    } catch { return null; }
  })();
  function cycleSize() { sizeStep = ((sizeStep + 1) % 3) as 0|1|2; localStorage.setItem("deck-avatar-size", String(sizeStep)); }
  function toggleDrag() { dragEnabled = !dragEnabled; localStorage.setItem("deck-avatar-drag", dragEnabled ? "1" : "0"); }
  function resetPos() { pos = null; localStorage.removeItem("deck-avatar-pos"); }
  function clearCollapseTimer(){if(collapseTimer)clearTimeout(collapseTimer);collapseTimer=null;}
  function scheduleCollapse(){
    clearCollapseTimer();
    if(!mounted||variant!=="panel"||suspended||!avatarAutoCollapse||collapsed||hovering||pointerActive||controlsOpen||dragEnabled||document.visibilityState!=="visible")return;
    collapseTimer=setTimeout(()=>{collapseTimer=null;if(!hovering&&!pointerActive&&!controlsOpen&&!dragEnabled)collapsed=true;},normalizeAvatarCollapseDelay(avatarCollapseDelayMs));
  }
  function revealNotice(force=false){if(manuallyCollapsed&&!force)return;if(force)manuallyCollapsed=false;collapsed=false;scheduleCollapse();}
  function collapseNotice(manual=false){if(dragEnabled)return;if(manual)manuallyCollapsed=true;controlsOpen=false;collapsed=true;clearCollapseTimer();}
  export function reveal(){revealNotice(true);}
  export function collapse(){collapseNotice();}
  export function isCollapsed(){return collapsed;}
  export function hasContent(){return Boolean(line||statusLine||context?.status);}
  function handlePanelClick(){if(externalState?.action&&!collapsed){onExternalAction?.(externalState.action);return;}onPanelClick?.();if(!collapsible||dragEnabled)return;if(collapsed)revealNotice(true);else collapseNotice(true);}
  function toggleControls(event:MouseEvent){event.stopPropagation();collapsed=false;controlsOpen=!controlsOpen;if(controlsOpen)clearCollapseTimer();else scheduleCollapse();}
  function endPointerInteraction(){pointerActive=false;window.removeEventListener("pointerup",endPointerInteraction);window.removeEventListener("pointercancel",endPointerInteraction);scheduleCollapse();}
  function beginPointerInteraction(event:PointerEvent){pointerActive=true;clearCollapseTimer();window.removeEventListener("pointerup",endPointerInteraction);window.removeEventListener("pointercancel",endPointerInteraction);window.addEventListener("pointerup",endPointerInteraction,{once:true});window.addEventListener("pointercancel",endPointerInteraction,{once:true});onPointerDown(event);}
  function hoverStart(event:PointerEvent){if(event.pointerType!=="mouse")return;hovering=true;clearCollapseTimer();}
  function hoverEnd(event:PointerEvent){if(event.pointerType!=="mouse")return;hovering=false;scheduleCollapse();}
  let collapseConfigKey="";
  let previousAutoCollapse=avatarAutoCollapse;
  $: if(mounted&&avatarAutoCollapse!==previousAutoCollapse){previousAutoCollapse=avatarAutoCollapse;if(!avatarAutoCollapse){collapsed=suspended||(keepEmptyCollapsed&&!line&&!statusLine&&!context?.status);clearCollapseTimer();}else scheduleCollapse();}
  let previousSuspended=suspended;
  $: if(mounted&&suspended!==previousSuspended){previousSuspended=suspended;if(suspended)collapseNotice();else if(pendingReveal){pendingReveal=false;const force=pendingRevealForce;pendingRevealForce=false;revealNotice(force);}else if(!avatarAutoCollapse&&(!keepEmptyCollapsed||Boolean(line||statusLine||context?.status)))revealNotice();}
  $: if(mounted&&keepEmptyCollapsed&&!line&&!statusLine&&!context?.status&&!collapsed)collapseNotice();
  $: {const next=`${mounted}:${avatarAutoCollapse}:${avatarCollapseDelayMs}:${collapsed}:${controlsOpen}:${dragEnabled}:${hovering}:${pointerActive}`;if(next!==collapseConfigKey){collapseConfigKey=next;if(mounted)scheduleCollapse();}}
  function onPointerDown(event: PointerEvent) {
    if (!dragEnabled) return;
    if ((event.target as HTMLElement).closest("button")) return;
    const rect = asideEl.getBoundingClientRect();
    const offX = event.clientX - rect.left;
    const offY = event.clientY - rect.top;
    const move = (ev: PointerEvent) => {
      pos = {
        x: Math.min(Math.max(ev.clientX - offX, 4), window.innerWidth - rect.width - 4),
        y: Math.min(Math.max(ev.clientY - offY, 4), window.innerHeight - rect.height - 4)
      };
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (pos) localStorage.setItem("deck-avatar-pos", JSON.stringify({ xf: pos.x / window.innerWidth, yf: pos.y / window.innerHeight }));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    event.preventDefault();
  }

  onMount(() => {
    mounted=true;scheduleCollapse();
    const unsubscribe=subscribeEmotionStream(value=>{state={...state,...value.state};codexState={...codexState,...value.codexState};grokState={...grokState,...value.grokState};deepseekState={...deepseekState,...value.deepseekState};ollamaState={...ollamaState,...value.ollamaState};antigravityState={...antigravityState,...value.antigravityState};taskStates=value.taskStates;outfitsByProvider=value.outfitsByProvider;assets=value.assets;inputMode=value.mode;bootstrapStatus=value.bootstrapStatus;});
    const visibility = () => { if (document.visibilityState === "hidden")clearCollapseTimer();else scheduleCollapse(); };
    document.addEventListener("visibilitychange", visibility);
    return () => { mounted=false;document.removeEventListener("visibilitychange", visibility);window.removeEventListener("pointerup",endPointerInteraction);window.removeEventListener("pointercancel",endPointerInteraction);clearCollapseTimer();unsubscribe(); };
  });
</script>

{#if !hidden||$avatarDisplayMode==="name-mark"}
  {#if variant === "panel"}
    <aside bind:this={asideEl} class="emotion-side size-{sizeStep}" class:draggable={allowDrag&&dragEnabled} class:collapsed style={allowDrag&&pos ? `left:${pos.x}px;top:${pos.y}px;right:auto;bottom:auto;` : ""} onpointerdown={beginPointerInteraction} onpointerenter={hoverStart} onpointerleave={hoverEnd}>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex (role and tabindex are paired when this card is collapsible) -->
      <div class="avatar-panel" role={collapsible||externalState?.action?"button":undefined} tabindex={collapsible||externalState?.action?0:undefined} aria-label={externalState?.action?statusLine:collapsible?(collapsed?$t("avatar.expandStatus"):$t("avatar.collapseStatus")):undefined} aria-expanded={collapsible?!collapsed:undefined} onclick={handlePanelClick} onkeydown={(e) => { if ((collapsible||externalState?.action)&&(e.key === "Enter"||e.key === " ") && !dragEnabled){e.preventDefault();handlePanelClick();} }}>
        {#if $avatarDisplayMode==="name-mark"}<span class="avatar-visual provider-name-mark" data-provider={markProvider} aria-hidden="true">{nameMark}</span>{:else}{#key `${imageKey}:${fallbackStep}`}<img class="avatar-visual" src={candidates[fallbackStep]} alt={emotion} onerror={onError} draggable="false"/>{/key}{/if}
        <div class="avatar-texts" aria-hidden={collapsed}>
          {#if nameLabel}<p class="avatar-name">{nameLabel}</p>{/if}
          {#if line}<p class="avatar-line">{line}</p>{/if}
          {#if statusLine}<p class="avatar-status">{statusLine}</p>{/if}
        </div>
      </div>
      {#if showSettings&&!collapsed}<button type="button" class="avatar-settings" aria-label={$t("a11y.avatarSettings")} title={$t("a11y.avatarSettings")} onclick={toggleControls}><Settings size={15}/></button>{/if}
      {#if showSettings&&(controlsOpen || dragEnabled)}
        <div class="avatar-menu">
          {#if dragEnabled}
            <button type="button" class="on" onclick={toggleDrag}><Move size={13}/>{$t("avatar.finishMoving")}</button>
          {:else}
            {#if allowDrag}<button type="button" onclick={() => { toggleDrag(); controlsOpen = false; }}><Move size={13}/>{$t("avatar.move")}</button>
            <button type="button" onclick={cycleSize}><Expand size={13}/>{$t("avatar.size",{size:sizeLabel(sizeStep)})}</button>{/if}
            {#if onHeaderAvatarSizeChange}<button type="button" onclick={()=>onHeaderAvatarSizeChange?.(((headerAvatarSizeStep+1)%3) as 0|1|2)}><Expand size={13}/>{$t("avatar.headerSize",{size:sizeLabel(headerAvatarSizeStep)})}</button>{/if}
            {#if onFloatingAvatarSizeChange}<button type="button" onclick={()=>onFloatingAvatarSizeChange?.(((floatingAvatarSizeStep+1)%3) as 0|1|2)}><Expand size={13}/>{$t("avatar.noticeSize",{size:sizeLabel(floatingAvatarSizeStep)})}</button>{/if}
            {#if onFloatingPinnedChange}<button type="button" class:on={floatingPinned} aria-pressed={floatingPinned} onclick={()=>onFloatingPinnedChange?.(!floatingPinned)}><Pin size={13}/>{$t("avatar.pinFloating",{state:floatingPinned?$t("common.on"):$t("common.off")})}</button>{/if}
            {#if ctxEngine === "codex"}
              {#each [["Gpt-Codex","Codex"],["Gpt-Sol","Sol"]] as [avatar,name]}
                <button type="button" class="avatar-choice" class:on={outfit===avatar} onclick={()=>{void setOutfit(avatar);controlsOpen=false;}}><img src={emotionAssetUrl(avatar,"neutral.webp")} alt=""/>{name}</button>
              {/each}
            {:else if outfits.length > 1}
              {#each outfits as item}
                <button type="button" class="avatar-choice" class:on={outfit===item} onclick={()=>{setOutfit(item);controlsOpen=false;}}><img src={emotionAssetUrl(item,"neutral.webp")} alt=""/>{item}</button>
              {/each}
            {/if}
            <button type="button" title={inputMode==="mcp"?$t("avatar.mode.mcpTitle"):$t("avatar.mode.catchTitle")} onclick={toggleMode}><Zap size={13}/>{inputMode==="mcp"?"MCP":$t("avatar.mode.catch")}</button>
            {#if allowDrag&&pos}<button type="button" onclick={() => { resetPos(); controlsOpen = false; }}><RotateCcw size={13}/>{$t("avatar.resetPosition")}</button>{/if}
          {/if}
        </div>
      {/if}
    </aside>
  {:else}
    <button class="avatar-mini" class:open={onMiniClick?miniExpanded:open} onclick={() => onMiniClick?onMiniClick():(open=!open)} aria-label={resolvedMiniLabel} aria-expanded={onMiniClick?miniExpanded:open} title={statusLine || line || resolvedMiniLabel}>
      {#if $avatarDisplayMode==="name-mark"}<span class="avatar-visual provider-name-mark" data-provider={markProvider} aria-hidden="true">{nameMark}</span>{:else}{#key `${imageKey}:${fallbackStep}`}<img class="avatar-visual" src={candidates[fallbackStep]} alt={emotion} onerror={onError} draggable="false"/>{/key}{/if}
    </button>
    {#if open&&!onMiniClick}
      <div class="avatar-pop" role="status">
        {#if $avatarDisplayMode==="name-mark"}<span class="avatar-visual provider-name-mark" data-provider={markProvider} aria-hidden="true">{nameMark}</span>{:else}<img class="avatar-visual" src={candidates[fallbackStep]} alt={emotion} onerror={onError} draggable="false"/>{/if}
        {#if line}<p class="avatar-line">{line}</p>{/if}
        {#if statusLine}<p class="avatar-status">{statusLine}</p>{/if}
      </div>
    {/if}
  {/if}
{/if}
