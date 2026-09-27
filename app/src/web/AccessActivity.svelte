<script lang="ts">
  import { onMount } from "svelte";
  import { t, locale, formatDateTime } from "./i18n";
  export let api:(path:string,init?:RequestInit)=>Promise<any>;
  type Entry={actor:string;peerIp:string;reportedIp:string|null;source:string|null;userAgent:string;firstSeenAt:string;lastSeenAt:string;current:boolean};
  let entries:Entry[]=[];
  let loading=true, error="", disposed=false;
  async function refresh(){
    loading=true;
    try { const result=await api("/api/security/access-activity"); if(!disposed){entries=result.entries;error="";} }
    catch(e){if(!disposed)error=e instanceof Error?e.message:String(e);}
    finally{if(!disposed)loading=false;}
  }
  onMount(()=>{void refresh();const timer=setInterval(()=>{if(!document.hidden&&!loading)void refresh();},30_000);return()=>{disposed=true;clearInterval(timer);};});
</script>
<section class="access-activity" aria-labelledby="access-activity-title">
  <header><h3 id="access-activity-title">{$t("accessActivity.title")}</h3><button type="button" on:click={refresh} disabled={loading}>{$t("accessActivity.refresh")}</button></header>
  <p>{$t("accessActivity.description")}</p>
  {#if error}<p role="alert">{error}</p>
  {:else if loading && !entries.length}<p role="status">{$t("accessActivity.loading")}</p>
  {:else if !entries.length}<p>{$t("accessActivity.empty")}</p>
  {:else}
    <ul>{#each entries as entry}
      <li>
        <div><strong>{entry.reportedIp ?? entry.peerIp}</strong> {#if entry.current}<span class="badge">{$t("accessActivity.current")}</span>{/if}</div>
        <div>{entry.actor}</div>
        {#if entry.reportedIp}<small>{$t("accessActivity.reported")} ({entry.source}) · {$t("accessActivity.peer")}: {entry.peerIp}</small>{:else}<small>{$t("accessActivity.peer")}</small>{/if}
        <small>{$t("accessActivity.lastSeen")}: {formatDateTime(entry.lastSeenAt,$locale)}</small>
        <small>{$t("accessActivity.firstSeen")}: {formatDateTime(entry.firstSeenAt,$locale)}</small>
        <small>{entry.userAgent || $t("accessActivity.unknownBrowser")}</small>
      </li>
    {/each}</ul>
  {/if}
</section>
<style>
  .access-activity{min-width:0;border:1px solid var(--line);border-radius:12px;padding:1rem}header{display:flex;align-items:center;justify-content:space-between;gap:.5rem}h3{margin:0;font-size:1rem}button{min-height:44px;flex-shrink:0}p,small{color:var(--muted);font-size:.8rem}ul{display:grid;gap:.5rem;padding:0;list-style:none;max-height:420px;overflow:auto}li{display:grid;gap:.3rem;padding:.7rem;border:1px solid var(--line);border-radius:8px;overflow-wrap:anywhere}.badge{font-size:.75rem;color:var(--accent)}
</style>
