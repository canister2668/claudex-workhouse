<script lang="ts">
  import { providerDisplayName } from "./provider-display";
  import{Clock3,LoaderCircle,Search}from"@lucide/svelte";
  import{onDestroy}from"svelte";
  import{locale,t}from"./i18n";
  import{formatDateTime}from"./i18n";
  export let api:(path:string,init?:RequestInit)=>Promise<any>;
  export let query="";
  export let workspaces:Array<{id:string;displayName:string}>=[];
  export let initialProvider:""|"codex"|"claude"="";
  export let onopen:(result:any)=>void;
  let provider:""|"codex"|"claude"=initialProvider,workspaceId="",status="",from="",to="";
  let results:any[]=[],cursor:string|null=null,loading=false,error="",nativeFallback=false,serverElapsedMs:number|null=null,responseElapsedMs:number|null=null,timer:ReturnType<typeof setTimeout>|null=null,generation=0,requestController:AbortController|null=null;
  const fieldLabel=(field:string)=>field==="title"?$t("historySearch.field.title"):field==="prompt"?$t("historySearch.field.prompt"):field==="result"?$t("historySearch.field.result"):field==="error"?$t("historySearch.field.error"):$t("historySearch.field.provider");
  function params(nextCursor?:string|null){const p=new URLSearchParams({q:query.trim(),limit:"30"});if(nextCursor)p.set("cursor",nextCursor);if(provider)p.set("provider",provider);if(workspaceId)p.set("workspaceId",workspaceId);if(status)p.set("status",status);if(from)p.set("from",new Date(`${from}T00:00:00`).toISOString());if(to)p.set("to",new Date(`${to}T23:59:59.999`).toISOString());return p;}
  async function load(more=false){
    const q=query.trim(),request=++generation;if(!q){results=[];cursor=null;error="";return;}
    requestController?.abort();const controller=new AbortController();requestController=controller;
    loading=true;error="";
    const startedAt=performance.now();
    try{const data=await api(`/api/history/search?${params(more?cursor:null)}`,{signal:controller.signal});if(request!==generation)return;results=more?[...results,...(data.results??[])]:data.results??[];cursor=data.nextCursor??null;nativeFallback=Boolean(data.nativeFallback);serverElapsedMs=Number.isFinite(data.serverElapsedMs)?Number(data.serverElapsedMs):null;responseElapsedMs=Math.max(0,Math.round(performance.now()-startedAt));}
    catch(value){if(request===generation&&!controller.signal.aborted)error=value instanceof Error?value.message:String(value);}
    finally{if(requestController===controller)requestController=null;if(request===generation)loading=false;}
  }
  function schedule(){generation++;if(timer)clearTimeout(timer);timer=setTimeout(()=>{timer=null;void load(false);},250);}
  $:{query;provider;workspaceId;status;from;to;schedule();}
  onDestroy(()=>{generation++;if(timer)clearTimeout(timer);requestController?.abort();});
</script>

<section class="history-search" aria-label={$t("historySearch.title")}>
  <div class="history-search-filters">
    <label>{$t("historySearch.provider")}<select bind:value={provider}><option value="">{$t("common.all")}</option><option value="codex">Codex</option><option value="claude">Claude</option></select></label>
    <label>{$t("session.workspace")}<select bind:value={workspaceId}><option value="">{$t("common.all")}</option>{#each workspaces as item}<option value={item.id}>{item.displayName}</option>{/each}</select></label>
    <label>{$t("historySearch.status")}<select bind:value={status}><option value="">{$t("common.all")}</option><option value="running">{$t("task.status.running")}</option><option value="waiting">{$t("task.status.waiting")}</option><option value="completed">{$t("task.status.completed")}</option><option value="failed">{$t("task.status.failed")}</option><option value="stopped">{$t("task.status.stopped")}</option></select></label>
    <label>{$t("historySearch.from")}<input type="date" bind:value={from}/></label>
    <label>{$t("historySearch.to")}<input type="date" bind:value={to}/></label>
  </div>
  {#if responseElapsedMs!==null}<p class="history-search-timing">{$t("historySearch.timing",{response:responseElapsedMs,server:serverElapsedMs??"-"})}</p>{/if}
  {#if nativeFallback&&provider!=="claude"}<p class="history-search-degraded">{$t("historySearch.codexFallback")}</p>{/if}
  {#if loading&&!results.length}<div class="empty"><LoaderCircle class="spin" size={24}/><p>{$t("historySearch.searching")}</p></div>
  {:else if error}<div class="empty"><p>{error}</p><button onclick={()=>load(false)}>{$t("common.retry")}</button></div>
  {:else if !results.length}<div class="empty"><Search size={25}/><p>{$t(cursor?"historySearch.rangeEmpty":"historySearch.empty")}</p>{#if cursor}<button disabled={loading} onclick={()=>load(true)}>{$t("historySearch.continue")}</button>{/if}</div>
  {:else}<div class="history-search-results">
    {#each results as item (item.id)}
      <button class="history-search-card" onclick={()=>onopen(item)}>
        <header><span class="engine {item.provider}">{providerDisplayName(item.provider)}</span><strong>{item.title}</strong><span>{fieldLabel(item.matchField)}</span></header>
        <p>{item.before}{#if item.match}<mark>{item.match}</mark>{/if}{item.after}</p>
        <footer><span>{item.source==="workhouse"?$t("historySearch.source.workhouse"):$t("historySearch.source.codex")}</span>{#if item.workspaceId}<span>{workspaces.find(workspace=>workspace.id===item.workspaceId)?.displayName??item.workspaceId}</span>{/if}<span>{item.status}</span><span><Clock3 size={13}/>{formatDateTime(item.updatedAt,$locale)}</span></footer>
      </button>
    {/each}
    {#if cursor}<button class="history-search-more" disabled={loading} onclick={()=>load(true)}>{#if loading}<LoaderCircle class="spin" size={16}/>{/if}{$t("historySearch.more")}</button>{/if}
  </div>{/if}
</section>
