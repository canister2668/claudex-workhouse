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
  // Context is the number that ends a session, so it escalates before the
  // provider quota does: 80% warns, 90% is critical, and each threshold
  // carries a short word so the bar is never the only signal.
  $: tone=pct!==null&&pct>=90?"critical":pct!==null&&pct>=80?"warning":"normal";
  $: toneLabel=tone==="critical"?$t("context.toneCritical"):tone==="warning"?$t("context.toneWarning"):"";
  $: label=compacting?$t("context.compacting"):usage?.lastCompactedAt&&usage.usedTokens===null?$t("context.compacted"):pct!==null?`${$t("context.label")} ${Math.round(pct)}%`:usage?.usedTokens!==null&&usage?.usedTokens!==undefined?`${$t("context.label")} ${formatContextTokens(usage.usedTokens)}`:$t("context.pending");
</script>

<div class="context-meter {tone}" class:open>
  <div class:context-detail={open}>
    <button type="button" class:context-summary={!open} class:context-window-card={open} class:context-window-toggle={open} class:warning={open&&tone==="warning"} class:critical={open&&tone==="critical"} onclick={()=>open=!open} aria-expanded={open} aria-label={open?`${providerDisplayName(provider)} ${$t("context.sessionQuota")} ${pct!==null?`${Math.round(pct)}%`:""}${toneLabel?` · ${toneLabel}`:""}`:`${providerDisplayName(provider)} ${label}${toneLabel?` · ${toneLabel}`:""}`}>
      {#if !open}
        <Gauge size={14}/><span>{label}</span>
        {#if toneLabel}<em class="context-tone">{toneLabel}</em>{/if}
        <i aria-hidden="true"><b style={`width:${pct??0}%`}></b></i>
      {:else}
        <span class="context-window-head"><strong>{$t("context.sessionQuota")}</strong>{#if toneLabel}<em class="context-tone">{toneLabel}</em>{/if}{#if pct!==null}<b>{Math.round(pct)}%</b>{/if}</span>
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
