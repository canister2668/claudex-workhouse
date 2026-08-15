<script lang="ts">
  import { Gauge, RefreshCw, Sparkles } from "@lucide/svelte";
  import { formatContextTokens, type ContextUsage } from "./context-usage";
  import { providerDisplayName } from "./provider-display";
  import { t } from "./i18n";

  export let provider:"codex"|"claude"|"deepseek"|"ollama"|"antigravity"|"grok";
  export let usage:ContextUsage|null=null;
  export let canCompact=false;
  export let busy=false;
  export let compacting=false;
  export let oncompact:(()=>void)|null=null;
  let open=false;
  $: pct=usage?.percent??null;
  $: remaining=usage?.usedTokens!==null&&usage?.usedTokens!==undefined&&usage?.windowTokens
    ?Math.max(0,usage.windowTokens-usage.usedTokens)
    :null;
  $: tone=pct!==null&&pct>=90?"critical":pct!==null&&pct>=75?"warning":"normal";
  $: label=compacting?$t("context.compacting"):usage?.lastCompactedAt&&usage.usedTokens===null?$t("context.compacted"):pct!==null?`${$t("context.label")} ${Math.round(pct)}%`:usage?.usedTokens!==null&&usage?.usedTokens!==undefined?`${$t("context.label")} ${formatContextTokens(usage.usedTokens)}`:$t("context.pending");
</script>

<div class="context-meter {tone}" class:open>
  <div class:context-detail={open}>
    <button type="button" class:context-summary={!open} class:context-window-card={open} class:context-window-toggle={open} class:warning={open&&tone==="warning"} class:critical={open&&tone==="critical"} onclick={()=>open=!open} aria-expanded={open} aria-label={open?`${providerDisplayName(provider)} ${$t("context.sessionQuota")} ${pct!==null?`${Math.round(pct)}%`:""}`:`${providerDisplayName(provider)} ${label}`}>
      {#if !open}
        <Gauge size={14}/><span>{label}</span>
        <i aria-hidden="true"><b style={`width:${pct??0}%`}></b></i>
      {:else}
        <span class="context-window-head"><strong>{$t("context.sessionQuota")}</strong>{#if pct!==null}<b>{Math.round(pct)}%</b>{/if}</span>
        <span class="context-window-bar" aria-hidden="true"><i style={`width:${pct??0}%`}></i></span>
        <span class="context-window-values">
          {#if usage?.usedTokens!==null&&usage?.usedTokens!==undefined}<small>{$t("context.sessionUsed",{count:formatContextTokens(usage.usedTokens)})}</small>{/if}
          {#if usage?.windowTokens}<small>{$t("context.sessionLimit",{count:formatContextTokens(usage.windowTokens)})}</small>{/if}
          {#if remaining!==null}<small class="remaining">{$t("context.sessionRemaining",{count:formatContextTokens(remaining)})}</small>
          {:else if usage?.lastCompactedAt}<small>{$t("context.nextResponseRefresh")}</small>
          {:else}<small>{$t("context.afterFirstResponse")}</small>{/if}
        </span>
      {/if}
    </button>
    {#if open&&canCompact}<button type="button" class="compact-button" disabled={busy||compacting} onclick={()=>oncompact?.()} title={busy?$t("context.responseInProgress"):$t("context.compactNow")}>{#if compacting}<RefreshCw class="spin" size={14}/>{:else}<Sparkles size={14}/>{/if}{busy?$t("context.responseInProgress"):compacting?$t("context.compacting"):$t("context.compactNow")}</button>{/if}
  </div>
</div>
