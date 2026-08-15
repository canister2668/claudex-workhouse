<script lang="ts">
  import{t}from"./i18n";
  export let serverCount=0;export let localCount=0;export let mergedCount=0;export let droppedCount=0;export let deletedCount=0;export let recovered=false;export let busy=false;
  export let onuseserver:()=>void;export let onmerge:()=>void;
</script>
<section class="preset-sync-notice" role="status">
  <strong>{$t("preset.syncConflict")}</strong>
  <small>{$t("preset.syncConflictBody",{server:serverCount,local:localCount,merged:mergedCount})}</small>
  {#if droppedCount}<small class="preset-sync-warning">{$t("preset.mergeDropped",{count:droppedCount})}</small>{/if}
  {#if deletedCount}<small>{$t("preset.mergeDeleted",{count:deletedCount})}</small>{/if}
  {#if recovered}<small>{$t("preset.serverRecovered")}</small>{/if}
  <div><button type="button" disabled={busy} onclick={onuseserver}>{$t("preset.useServer")}</button><button type="button" class="primary" disabled={busy} onclick={onmerge}>{$t("preset.mergeSave")}</button></div>
</section>
