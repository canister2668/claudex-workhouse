<script lang="ts">
  import { t } from "./i18n";
  export let continuation:any;
  export let mode:"closed"|"adding-rounds"|"auto-continuing"|"retrying"="closed";
  export let submitting=false;
  export let maximum=0;
  export let onadd:()=>void=()=>{};
  export let onauto:()=>void=()=>{};
  export let onretry:()=>void=()=>{};
</script>

{#if continuation?.available&&mode==="closed"}
  <div class="automatic-continuation-actions" aria-label={$t("conversation.continuation")}>
    {#if continuation.canAddRounds}<button type="button" title={$t("conversation.addRounds",{count:5})} disabled={submitting||maximum>=100} onclick={onadd}>{$t("conversation.addRounds",{count:5})}</button>{/if}
    {#if continuation.canAutoContinue}<button type="button" title={$t("conversation.autoContinue",{count:5})} disabled={submitting} onclick={onauto}>{$t("conversation.autoContinue",{count:5})}</button>{/if}
    {#if continuation.canRetryFailedTurn}<button type="button" disabled={submitting} onclick={onretry}>{$t(continuation.reason==="PROVIDER_OUTPUT_UNAVAILABLE"?"conversation.requestProviderAgain":"conversation.retryFailedTurn")}</button>{/if}
  </div>
{/if}
