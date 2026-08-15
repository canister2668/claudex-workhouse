<script lang="ts">
  import {onMount} from "svelte";
  import {ArchiveRestore, CircleAlert, Database, Pin, PinOff, RefreshCw, ScanSearch, Trash2} from "@lucide/svelte";
  import {formatDateTime,formatFileSize,locale,t} from "./i18n";

  export let api:(path:string,init?:RequestInit)=>Promise<any>;
  type Item={id:string;kind:string;origin:string;state:string;createdAt:string;sizeBytes:number;fileCount:number;verification:string;pinned:boolean;protectedReason:string|null;purgeAfter:string|null;lastError:string|null};
  let items:Item[]=[],summary:any=null,legacy:any=null,view:"ready"|"trashed"|"error"|"legacy"="ready",loading=false,busy="",notice="",degraded="";
  const uuid=()=>crypto.randomUUID();
  const visible=()=>items.filter(item=>item.state===view);
  async function load(){loading=true;notice="";try{const[list,totals]=await Promise.all([api("/api/snapshots"),api("/api/snapshots/summary")]);items=list.items??[];summary=totals.summary;degraded=totals.status==="degraded"?totals.error??$t("snapshot.degraded"):"";}catch(error){notice=error instanceof Error?error.message:String(error);}finally{loading=false;}}
  async function mutate(item:Item,action:"pin"|"trash"|"untrash"|"purge"){
    if(busy)return;
    if(action==="trash"&&!confirm($t("snapshot.trashConfirm")))return;
    let body:any={confirm:true},method="POST",url=`/api/snapshots/${item.id}/${action}`;
    if(action==="pin"){method="PATCH";url=`/api/snapshots/${item.id}`;body={pinned:!item.pinned};}
    if(action==="purge"){const expected=`PURGE ${item.id}`,typed=prompt($t("snapshot.purgeConfirm",{confirmation:expected}));if(typed!==expected)return;body={confirmation:typed};}
    busy=item.id;notice="";try{await api(url,{method,headers:{"Idempotency-Key":uuid()},body:JSON.stringify(body)});await load();}catch(error){notice=error instanceof Error?error.message:String(error);}finally{busy="";}
  }
  async function scanLegacy(){if(busy)return;busy="legacy";notice="";try{legacy=(await api("/api/snapshots/scan",{method:"POST",headers:{"Idempotency-Key":uuid()},body:JSON.stringify({confirmReadOnly:true})})).legacy;}catch(error){notice=error instanceof Error?error.message:String(error);}finally{busy="";}}
  async function importLegacy(item:any){if(busy||!confirm($t("snapshot.importConfirm",{name:item.name})))return;busy=item.id;notice="";try{await api("/api/snapshots/imports",{method:"POST",headers:{"Idempotency-Key":uuid()},body:JSON.stringify({legacyId:item.id,confirmMove:true})});await load();busy="";await scanLegacy();}catch(error){notice=error instanceof Error?error.message:String(error);}finally{busy="";}}
  onMount(load);
</script>

<section class="snapshot-settings">
  <header class="snapshot-heading"><span><h3>{$t("snapshot.title")}</h3><small>{$t("snapshot.body")}</small></span><button type="button" onclick={load} disabled={loading}><RefreshCw size={15} class={loading?"spin":""}/>{$t("common.refresh")}</button></header>
  {#if degraded}<p class="snapshot-warning"><CircleAlert size={16}/><span><strong>{$t("snapshot.degraded")}</strong><small>{degraded}</small></span></p>{/if}
  <div class="snapshot-summary">
    <article><strong>{formatFileSize(summary?.totalBytes??0,$locale)}</strong><small>{$t("snapshot.total")}</small></article>
    <article><strong>{summary?.activeCount??0}</strong><small>{$t("snapshot.active")}</small></article>
    <article><strong>{summary?.trashCount??0}</strong><small>{$t("snapshot.trashCount")}</small></article>
    <article><strong>{summary?.lastAutomaticAt?formatDateTime(summary.lastAutomaticAt,$locale):$t("common.none")}</strong><small>{$t("snapshot.lastAutomatic")}</small></article>
  </div>
  <nav class="snapshot-tabs" aria-label={$t("snapshot.title")}><button class:active={view==="ready"} onclick={()=>view="ready"}>{$t("snapshot.activeTab")}</button><button class:active={view==="trashed"} onclick={()=>view="trashed"}>{$t("snapshot.trashTab")}</button>{#if summary?.errors}<button class:active={view==="error"} onclick={()=>view="error"}>{$t("snapshot.errorTab")}</button>{/if}<button class:active={view==="legacy"} onclick={()=>view="legacy"}>{$t("snapshot.legacyTab")}</button></nav>
  {#if view!=="legacy"}
    <div class="snapshot-list">
      {#each visible() as item (item.id)}
        <article class:error={item.state==="error"}>
          <Database size={19}/><span><strong>{$t(item.kind==="database"?"snapshot.kind.database":"snapshot.kind.legacy")}</strong><small>{formatDateTime(item.createdAt,$locale)} · {formatFileSize(item.sizeBytes,$locale)} · {$t("snapshot.files",{count:item.fileCount})}</small><small>{item.verification==="verified"?$t("snapshot.verified"):$t("snapshot.unverified")}{item.protectedReason?` · ${$t("snapshot.protected")}`:""}</small>{#if item.lastError}<em>{item.lastError}</em>{/if}</span>
          <div class="snapshot-actions"><button type="button" title={$t(item.pinned?"snapshot.unpin":"snapshot.pin")} disabled={busy===item.id} onclick={()=>mutate(item,"pin")}>{#if item.pinned}<PinOff size={15}/>{:else}<Pin size={15}/>{/if}</button>{#if item.state==="ready"}<button type="button" class="danger-lite" disabled={busy===item.id||item.pinned||Boolean(item.protectedReason)} onclick={()=>mutate(item,"trash")}><Trash2 size={15}/>{$t("snapshot.moveTrash")}</button>{:else if item.state==="trashed"}<button type="button" disabled={busy===item.id} onclick={()=>mutate(item,"untrash")}><ArchiveRestore size={15}/>{$t("snapshot.untrash")}</button><button type="button" class="danger-lite" disabled={busy===item.id||item.pinned||Boolean(item.protectedReason)} onclick={()=>mutate(item,"purge")}><Trash2 size={15}/>{$t("snapshot.purge")}</button>{/if}</div>
        </article>
      {:else}<p class="snapshot-empty">{$t("snapshot.empty")}</p>{/each}
    </div>
  {:else}
    <section class="legacy-panel"><p>{$t("snapshot.legacyBody")}</p><p class="snapshot-warning"><CircleAlert size={16}/><span><strong>{$t("snapshot.legacyReadOnly")}</strong><small>{$t("snapshot.runtimeExcluded")}</small></span></p><button type="button" onclick={scanLegacy} disabled={busy==="legacy"}><ScanSearch size={15}/>{$t(busy==="legacy"?"snapshot.scanning":"snapshot.scanLegacy")}</button>{#if legacy}<div class="legacy-summary"><strong>{$t("snapshot.legacyCount",{count:legacy.items.length})}</strong><span>{formatFileSize(legacy.totalBytes,$locale)}</span></div><div class="legacy-list">{#each legacy.items as item}<article><span><strong>{item.name}</strong><small>{item.source} · {item.kind} · {$t("snapshot.files",{count:item.fileCount})}</small></span><div><em>{formatFileSize(item.sizeBytes,$locale)}</em><button type="button" disabled={Boolean(busy)} onclick={()=>importLegacy(item)}>{$t("snapshot.import")}</button></div></article>{/each}</div>{/if}</section>
  {/if}
  {#if notice}<p class="snapshot-notice" role="status">{notice}</p>{/if}
</section>

<style>
  .snapshot-settings{display:grid;gap:.8rem}.snapshot-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:.7rem}.snapshot-heading h3{margin:0}.snapshot-heading small,.snapshot-list small,.legacy-list small{color:var(--muted)}.snapshot-heading button,.snapshot-actions button,.legacy-panel>button{display:inline-flex;align-items:center;gap:.35rem}.snapshot-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.5rem}.snapshot-summary article{display:grid;gap:.2rem;padding:.7rem;border:1px solid var(--line);border-radius:12px;background:var(--panel)}.snapshot-summary strong{font-size:.95rem;overflow:hidden;text-overflow:ellipsis}.snapshot-summary small{color:var(--muted)}.snapshot-tabs{display:flex;gap:.35rem;border-bottom:1px solid var(--line)}.snapshot-tabs button{border:0;border-radius:8px 8px 0 0}.snapshot-tabs button.active{color:var(--accent);background:color-mix(in srgb,var(--accent) 12%,transparent)}.snapshot-list,.legacy-list{display:grid;gap:.45rem}.snapshot-list>article{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:.65rem;padding:.7rem;border:1px solid var(--line);border-radius:12px}.snapshot-list>article>span{display:grid;gap:.15rem;min-width:0}.snapshot-list em{font-style:normal;color:var(--danger);font-size:.75rem}.snapshot-actions{display:flex;gap:.35rem;flex-wrap:wrap;justify-content:flex-end}.snapshot-warning{display:flex;align-items:flex-start;gap:.5rem;margin:0;padding:.65rem;border:1px solid color-mix(in srgb,var(--warn) 50%,var(--line));border-radius:10px;color:var(--warn)}.snapshot-warning span{display:grid;gap:.15rem}.snapshot-warning small{color:var(--muted)}.snapshot-empty,.snapshot-notice{color:var(--muted)}.legacy-panel{display:grid;gap:.65rem}.legacy-panel p{margin:0}.legacy-summary{display:flex;justify-content:space-between}.legacy-list{max-height:320px;overflow:auto}.legacy-list article{display:flex;justify-content:space-between;gap:.7rem;padding:.55rem;border-bottom:1px solid var(--line)}.legacy-list article span{display:grid;min-width:0}.legacy-list article>div{display:flex;align-items:center;gap:.45rem}.legacy-list strong{overflow:hidden;text-overflow:ellipsis}.legacy-list em{font-style:normal;white-space:nowrap}@media(max-width:720px){.snapshot-summary{grid-template-columns:1fr 1fr}.snapshot-list>article{grid-template-columns:auto 1fr}.snapshot-actions{grid-column:1/-1;justify-content:flex-start}.legacy-list article{align-items:flex-start}.legacy-list article>div{display:grid;justify-items:end}}
</style>
