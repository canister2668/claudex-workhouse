<script lang="ts">
  import { HardDrive, RefreshCw, ShieldCheck, Trash2 } from "@lucide/svelte";
  import { onMount } from "svelte";
  import { formatDateTime, locale, t } from "./i18n";
  import { normalizeTempStorageOverview } from "./temp-storage-view";
  import { providerDisplayName } from "./provider-display";

  export let api:(path:string,init?:RequestInit)=>Promise<any>;
  type Artifact={id:string;hostId:string;workspaceId:string;workspaceName:string;taskId:string;provider:string;kind:string;name:string;sizeBytes:number;status:"present"|"missing-on-disk"|"identity-changed";createdAt:string;verifiedAt:string|null};
  type ArtifactOverview={generatedAt:string;summary:{total:number;present:number;missing:number;changed:number};entries:Artifact[]};
  type TempEntry={id:string;name:string;kind:string;sizeBytes:number;modifiedAt:string;deletable:boolean;blockedReason:string|null};

  let artifacts:ArtifactOverview|null=null,artifactLoading=false,artifactError="",showMissing=false;
  let tempScan:any=null,tempLoading=false,tempDeleting=false,tempError="",poll:ReturnType<typeof setTimeout>|null=null;
  let selected=new Set<string>();
  $: tempOverview=normalizeTempStorageOverview(tempScan?.overview??null) as any;
  $: visibleArtifacts=artifacts?.entries.filter(item=>showMissing||item.status!=="missing-on-disk")??[];
  $: groups=[...visibleArtifacts.reduce((map,item)=>{const group=map.get(item.workspaceId)??{id:item.workspaceId,name:item.workspaceName,items:[] as Artifact[]};group.items.push(item);map.set(item.workspaceId,group);return map;},new Map<string,{id:string;name:string;items:Artifact[]}>()).values()];
  $: tempEntries=(tempOverview?.roots?.flatMap((root:any)=>root.overview.entries)??[]) as TempEntry[];
  $: tempHasEntries=tempEntries.length>0;
  $: deletableEntries=tempEntries.filter(item=>item.deletable);
  $: oldEntries=deletableEntries.filter(item=>Date.now()-new Date(item.modifiedAt).getTime()>=Number(tempScan?.policy?.retentionMs??24*60*60_000));

  function formatBytes(value:number){if(!Number.isFinite(value)||value<=0)return"0 B";const units=["B","KB","MB","GB","TB"],unit=Math.min(Math.floor(Math.log(value)/Math.log(1024)),units.length-1);return`${(value/1024**unit).toFixed(unit===0?0:value/1024**unit>=10?1:2)} ${units[unit]}`;}
  function applyTemp(value:any){tempScan=value?.scan??value?.status??value;tempLoading=tempScan?.state==="running";tempError=typeof tempScan?.error==="string"?tempScan.error:"";const allowed=new Set((normalizeTempStorageOverview(tempScan?.overview??null) as any)?.roots?.flatMap((root:any)=>root.overview.entries).filter((item:any)=>item.deletable).map((item:any)=>item.id)??[]);selected=new Set([...selected].filter(id=>allowed.has(id)));if(tempLoading){if(poll)clearTimeout(poll);poll=setTimeout(()=>void loadTemp(),1000);}}
  async function loadArtifacts(){artifactLoading=true;artifactError="";try{artifacts=await api("/api/infrastructure/artifacts");}catch(error){artifactError=error instanceof Error?error.message:String(error);}finally{artifactLoading=false;}}
  async function loadTemp(){try{applyTemp(await api("/api/infrastructure/temp-storage"));}catch(error){tempLoading=false;tempError=error instanceof Error?error.message:String(error);}}
  async function scanTemp(){if(tempLoading||tempDeleting)return;tempLoading=true;tempError="";try{applyTemp(await api("/api/infrastructure/temp-storage/scan",{method:"POST",body:JSON.stringify({confirmReadOnly:true})}));}catch(error){tempLoading=false;tempError=error instanceof Error?error.message:String(error);}}
  function toggle(id:string){const next=new Set(selected);next.has(id)?next.delete(id):next.add(id);selected=next;}
  function selectAll(){selected=new Set(deletableEntries.map(item=>item.id));}
  async function removeEntries(entries:TempEntry[]){if(!entries.length||tempDeleting)return;if(!confirm($t("infrastructure.temp.deleteConfirm",{count:entries.length,size:formatBytes(entries.reduce((sum,item)=>sum+item.sizeBytes,0))})))return;tempDeleting=true;try{const result=await api("/api/infrastructure/temp-storage/delete",{method:"POST",headers:{"Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({entryIds:entries.map(item=>item.id),confirm:true})});applyTemp({state:"ready",overview:result.overview,stale:true});selected=new Set();await loadArtifacts();}catch(error){tempError=error instanceof Error?error.message:String(error);}finally{tempDeleting=false;}}
  async function removeTemp(){await removeEntries(deletableEntries.filter(item=>selected.has(item.id)));}
  const statusKey=(status:Artifact["status"])=>`artifacts.status.${status}`;
  onMount(()=>{void loadArtifacts();void loadTemp();return()=>{if(poll)clearTimeout(poll);};});
</script>

<section class="artifact-settings" aria-labelledby="artifact-settings-title">
  <header class="page-heading"><span><h3 id="artifact-settings-title">{$t("artifacts.title")}</h3><small>{$t("artifacts.body")}</small></span><button type="button" disabled={artifactLoading} onclick={loadArtifacts}><RefreshCw size={15} class={artifactLoading?"spin":""}/>{$t("common.refresh")}</button></header>
  <p class="boundary"><ShieldCheck size={17}/><span><strong>{$t("artifacts.boundaryTitle")}</strong><small>{$t("artifacts.boundaryBody")}</small></span></p>
  {#if artifactError}<p class="error" role="alert">{artifactError}</p>{/if}
  {#if artifacts}
    <div class="summary"><span><small>{$t("artifacts.recorded")}</small><strong>{artifacts.summary.total}</strong></span><span><small>{$t("artifacts.present")}</small><strong>{artifacts.summary.present}</strong></span><span><small>{$t("artifacts.missing")}</small><strong>{artifacts.summary.missing}</strong></span><span><small>{$t("artifacts.changed")}</small><strong>{artifacts.summary.changed}</strong></span></div>
    <div class="artifact-actions"><button type="button" class:active={showMissing} onclick={()=>showMissing=!showMissing}>{$t(showMissing?"artifacts.hideMissing":"artifacts.showMissing",{count:artifacts.summary.missing})}</button><small>{$t("artifacts.collapsedHint")}</small></div>
    <div class="workspace-groups">
      {#each groups as group (group.id)}
        <details class="workspace-group"><summary><strong>{group.name}</strong><small>{group.items.length} {$t("artifacts.items")}</small></summary><div class="artifact-list">
          {#each group.items as item (item.id)}<article class="artifact-row"><HardDrive size={18}/><span><strong>{item.name}</strong><small>{providerDisplayName(item.provider as any)} · {item.kind} · {formatDateTime(item.createdAt,$locale)}</small></span><em class={item.status}>{$t(statusKey(item.status) as any)}</em></article>{/each}
        </div></details>
      {/each}
      {#if !groups.length}<p class="artifact-empty">{$t("artifacts.empty")}</p>{/if}
    </div>
  {/if}

  <section class="cleanup" aria-labelledby="artifact-temp-title"><header><span><h4 id="artifact-temp-title">{$t("infrastructure.temp.title")}</h4><small>{$t("infrastructure.temp.body")}</small></span><button type="button" disabled={tempLoading||tempDeleting} onclick={scanTemp}><RefreshCw size={14} class={tempLoading?"spin":""}/>{$t(tempOverview?"infrastructure.temp.rescan":"infrastructure.temp.scan")}</button></header>
    {#if tempError}<p class="error" role="alert">{tempError}</p>{/if}
    {#if tempOverview&&tempHasEntries}
      <div class="summary temp"><span><small>{$t("infrastructure.temp.managedPaths")}</small><strong>{tempOverview.roots.length}</strong></span><span><small>{$t("infrastructure.temp.serviceOwned")}</small><strong>{formatBytes(tempOverview.serviceOwnedBytes)}</strong></span><span><small>{$t("infrastructure.temp.safeToDelete")}</small><strong>{formatBytes(tempOverview.deletableBytes)}</strong></span><span><small>{$t("infrastructure.temp.protected")}</small><strong>{formatBytes(tempOverview.protectedBytes)}</strong></span></div>
      <small class="safety">{$t("infrastructure.temp.safetyRecognized")}</small>
      <div class="cleanup-actions"><button type="button" disabled={!deletableEntries.length||tempDeleting} onclick={selectAll}>{$t("artifacts.selectAll",{count:deletableEntries.length})}</button><button type="button" disabled={!selected.size||tempDeleting} onclick={()=>selected=new Set()}>{$t("artifacts.clearSelection")}</button><button class="danger" type="button" disabled={!oldEntries.length||tempDeleting} onclick={()=>removeEntries(oldEntries)}><Trash2 size={14}/>{$t("artifacts.cleanOld",{count:oldEntries.length})}</button><button class="danger" type="button" disabled={!selected.size||tempDeleting} onclick={removeTemp}><Trash2 size={14}/>{$t(tempDeleting?"infrastructure.temp.deleting":"infrastructure.temp.deleteSelected",{count:selected.size})}</button></div>
      {#each tempOverview.roots as root (root.id)}<details class="temp-root"><summary><strong>{root.workspaces.map((workspace:any)=>workspace.displayName).join(", ")||$t("infrastructure.temp.workhouseRuntime")}</strong><small>{root.overview.entries.length} {$t("artifacts.items")} · {formatBytes(root.overview.deletableBytes)} {$t("infrastructure.temp.safeToDelete")}</small></summary><div class="temp-entries">{#each root.overview.entries as item (item.id)}<label class:protected={!item.deletable}><input type="checkbox" disabled={!item.deletable||tempDeleting} checked={selected.has(item.id)} onchange={()=>toggle(item.id)}/><span><strong>{item.name}</strong><small>{formatBytes(item.sizeBytes)} · {formatDateTime(item.modifiedAt,$locale)}</small></span><em>{item.deletable?$t("infrastructure.temp.deletable"):$t(`infrastructure.temp.blocked.${item.blockedReason??"protected"}` as any)}</em></label>{/each}</div></details>{/each}
    {:else if tempOverview&&!tempLoading}
      <p class="artifact-empty">{$t("infrastructure.temp.empty")}</p>
    {:else if !tempLoading}<p class="artifact-empty">{$t("infrastructure.temp.notScanned")}</p>{/if}
  </section>
</section>

<style>
  .artifact-settings{display:grid;grid-auto-rows:max-content;align-content:start;gap:.8rem;padding-bottom:.5rem}.page-heading,.cleanup>header{display:flex;align-items:flex-end;justify-content:space-between;gap:.7rem}.page-heading h3,.cleanup h4{margin:0}.page-heading small,.cleanup small,.workspace-group small,.artifact-row small,.temp-root small,.safety{color:var(--muted)}button{display:inline-flex;align-items:center;gap:.35rem}.boundary{display:flex;align-items:flex-start;gap:.55rem;margin:0;padding:.7rem;border:1px solid color-mix(in srgb,var(--accent) 35%,var(--line));border-radius:12px;background:color-mix(in srgb,var(--accent) 7%,var(--panel))}.boundary span{display:grid;gap:.15rem}.boundary small{color:var(--muted)}.summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.45rem}.summary>span{display:grid;gap:.15rem;padding:.6rem;border-radius:10px;background:var(--panel);border:1px solid var(--line)}.summary small{color:var(--muted)}.artifact-actions,.cleanup-actions{display:flex;align-items:center;gap:.4rem;flex-wrap:wrap}.artifact-actions small{margin-left:auto;color:var(--muted)}.artifact-actions button.active{border-color:var(--accent);color:var(--accent-strong)}.workspace-groups{display:grid;gap:.45rem}.workspace-group,.cleanup,.temp-root{padding:.7rem;border:1px solid var(--line);border-radius:13px;background:var(--panel)}.workspace-group>summary,.temp-root>summary{display:flex;align-items:center;justify-content:space-between;gap:.6rem;cursor:pointer}.workspace-group>summary::marker,.temp-root>summary::marker{color:var(--muted)}.artifact-list,.temp-entries{display:grid;gap:.4rem;max-height:320px;margin-top:.55rem;overflow:auto;overscroll-behavior:contain}.artifact-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:.55rem;padding:.55rem;border-radius:9px;background:var(--bg)}.artifact-row>span{display:grid;min-width:0}.artifact-row strong{overflow:hidden;text-overflow:ellipsis}.artifact-row em,.temp-root label em{font-size:.68rem;font-style:normal;color:var(--muted)}.artifact-row em.present{color:var(--good)}.artifact-row em.identity-changed{color:var(--danger)}.cleanup{display:grid;grid-auto-rows:max-content;align-content:start;align-self:start;height:max-content;gap:.55rem;margin-top:.2rem}.cleanup>header>button{flex:none;white-space:nowrap}.temp-root label{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:.5rem;padding:.5rem;border-radius:9px;background:var(--bg)}.temp-root label>span{display:grid;min-width:0}.temp-root label.protected{opacity:.7}.danger{color:var(--danger)}.error{color:var(--danger)}.artifact-empty{min-height:0;margin:.1rem 0;color:var(--muted)}@media(max-width:720px){.summary{grid-template-columns:1fr 1fr}.page-heading,.cleanup>header{align-items:flex-start}.artifact-actions small{width:100%;margin-left:0}.artifact-row{grid-template-columns:auto 1fr}.artifact-row em{grid-column:2}.temp-root label{grid-template-columns:auto 1fr}.temp-root label em{grid-column:2}.cleanup-actions button{flex:1;justify-content:center}}
</style>
