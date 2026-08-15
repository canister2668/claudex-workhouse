<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import { turnUsageLabelKey, turnUsageSummary, type TurnOutputUsage } from "./conversation";
  import { formatContextTokens } from "./context-usage";
  import { t } from "./i18n";

  export let usage:TurnOutputUsage;
  export let live=false;
  export let showProcessed=false;
  let details:HTMLDetailsElement,popover:HTMLElement;

  $: summary=turnUsageSummary(usage);
  const number=(value:number)=>formatContextTokens(value);
  async function placePopover(){
    bindDismiss();
    if(!details.open)return;
    await tick();
    const trigger=details.querySelector("summary")?.getBoundingClientRect(),anchor=details.getBoundingClientRect();
    if(!trigger||!popover)return;
    const card=details.closest(".participant-block")?.getBoundingClientRect(),scroller=details.closest(".conversation,.collaboration-detail")?.getBoundingClientRect(),viewport=scroller??{top:0,right:window.innerWidth,bottom:window.innerHeight,left:0};
    const left=Math.max(card?.left??viewport.left,viewport.left),right=Math.min(card?.right??viewport.right,viewport.right),top=Math.max(card?.top??viewport.top,viewport.top),bottom=Math.min(card?.bottom??viewport.bottom,viewport.bottom),bounds={left,right,top,bottom,width:Math.max(0,right-left),height:Math.max(0,bottom-top)};
    const inset=8,panelWidth=Math.min(290,Math.max(160,bounds.width-inset*2));
    popover.style.width=`${panelWidth}px`;
    popover.style.maxHeight=`${Math.max(80,bounds.height-inset*2)}px`;
    popover.style.overflowY="auto";
    const desiredLeft=trigger.right-panelWidth,minLeft=bounds.left+inset,maxLeft=Math.max(minLeft,bounds.right-panelWidth-inset),absoluteLeft=Math.min(maxLeft,Math.max(minLeft,desiredLeft));
    popover.style.left=`${absoluteLeft-anchor.left}px`;
    popover.style.right="auto";
    const panel=popover.getBoundingClientRect();
    const above=trigger.top-bounds.top,below=bounds.bottom-trigger.bottom;
    const desiredTop=above>=panel.height+7||above>=below?trigger.top-panel.height-7:trigger.bottom+7,minTop=bounds.top+inset,maxTop=Math.max(minTop,bounds.bottom-panel.height-inset),absoluteTop=Math.min(maxTop,Math.max(minTop,desiredTop));
    popover.style.top=`${absoluteTop-anchor.top}px`;
    popover.style.bottom="auto";
  }
  // <details> only closes on its own summary, so an outside pointer or Escape has
  // to be wired up by hand. The listeners exist only while the panel is open, or
  // every rendered turn would keep one alive for the life of the conversation.
  let dismissBound=false;
  const dismiss=(event:Event)=>{
    if(!details?.open)return;
    if(event.type==="pointerdown"&&event.target instanceof Node&&details.contains(event.target))return;
    if(event.type==="keydown"&&(event as KeyboardEvent).key!=="Escape")return;
    details.open=false;
    if(event.type==="keydown")details.querySelector("summary")?.focus();
  };
  function bindDismiss(open=Boolean(details?.open)){
    if(open===dismissBound)return;
    dismissBound=open;
    const method=open?"addEventListener":"removeEventListener";
    document[method]("pointerdown",dismiss,true);
    document[method]("keydown",dismiss,true);
  }
  onDestroy(()=>bindDismiss(false));
</script>

<details bind:this={details} class="turn-usage-details" class:live ontoggle={placePopover}>
  <summary>
    {#if summary.billable===null}{$t(turnUsageLabelKey(usage),{count:number(summary.output)})}{:else}{number(summary.billable)}{/if}
    {#if showProcessed&&summary.processed!==null} · {$t("tokens.totalProcessedInline",{count:number(summary.processed)})}{/if}
    {#if live}<i aria-hidden="true">↑</i>{/if}
  </summary>
  <div bind:this={popover} class="turn-usage-popover">
    <strong>{$t("tokens.turnDetails")}</strong>
    <div class="turn-usage-hero">
      <span>{summary.billable===null?$t("tokens.output"):$t("tokens.billable")}</span>
      <b>{summary.billable===null&&!summary.exact?$t("tokens.approximate",{count:number(summary.output)}):number(summary.billable??summary.output)}</b>
    </div>
    {#if summary.billable!==null&&summary.billableInput!==null}
      <div class="turn-usage-split"><span>{$t("tokens.inputPart",{count:number(summary.billableInput)})}</span><span>{$t("tokens.outputPart",{count:number(summary.output)})}</span></div>
    {/if}
    {#if summary.reasoning}<div class="turn-usage-sub">{$t("tokens.reasoningPart",{count:number(summary.reasoning)})}</div>{/if}
    <hr/>
    <div class="turn-usage-foot">
      {#if summary.cacheRead}
        <span>{summary.savedPercent===null?$t("tokens.cacheReuse",{count:number(summary.cacheRead)}):$t("tokens.cacheReuseSaved",{count:number(summary.cacheRead),percent:summary.savedPercent})}</span>
      {/if}
      {#if summary.cacheWrite}<span>{$t("tokens.cacheWritePart",{count:number(summary.cacheWrite)})}</span>{/if}
      <!-- Codex reports one task-cumulative reading rather than per-request totals, so a count of 1 explains nothing. -->
      {#if summary.requestCount&&summary.requestCount>1}<span>{$t("tokens.requestCount",{count:summary.requestCount})}</span>{/if}
      {#if summary.processed!==null}<span>{$t("tokens.totalProcessed",{count:number(summary.processed)})}</span>{/if}
      {#if usage.inputTokens===null}<span>{$t("tokens.processedUnavailable")}</span>{/if}
    </div>
  </div>
</details>
