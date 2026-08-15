<script lang="ts">
  import{onMount}from"svelte";
  import{ExternalLink,X}from"@lucide/svelte";
  import{pullRequestDraft}from"./pull-request";
  import{t}from"./i18n";
  export let task:any;export let events:any[]=[];export let api:(path:string,init?:RequestInit)=>Promise<any>;export let onclose:()=>void;export let oncreated:(task:any)=>void;
  const draftValue=pullRequestDraft(task,events);
  let title=draftValue.title,body=draftValue.body,base="",draft=false,confirmed=false,busy=true,error="",preview:any=null,url:string|null=task.metadata?.pullRequestUrl??null;
  onMount(async()=>{try{const data=await api(`/api/tasks/${task.provider}/${encodeURIComponent(task.id)}/pull-request/preview`);preview=data.preview;url=data.pullRequestUrl??preview.existingUrl??url;base=preview.base??"";}catch(value){error=value instanceof Error?value.message:String(value);}finally{busy=false;}});
  async function createPullRequest(){
    if(busy||!confirmed||!preview?.eligible)return;busy=true;error="";
    try{
      const data=await api(`/api/tasks/${task.provider}/${encodeURIComponent(task.id)}/pull-request`,{method:"POST",headers:{"Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({title,body,base,draft,confirm:true})});
      url=data.url;oncreated(data.task);
    }catch(value){error=value instanceof Error?value.message:String(value);}finally{busy=false;}
  }
  function openUrl(){if(url)window.open(url,"_blank","noopener,noreferrer");}
</script>
<div class="modal-backdrop" role="presentation">
  <div class="modal pr-dialog" role="dialog" aria-modal="true" aria-label={$t("pr.title")}>
    <header><h2>{$t("pr.title")}</h2><button type="button" aria-label={$t("common.close")} onclick={onclose}><X size={18}/></button></header>
    {#if busy&&!preview}<p>{$t("pr.loading")}</p>{/if}
    {#if preview}
      <div class="pr-preflight">
        <strong>{preview.repository}</strong>
        <small>{$t("pr.branchState",{branch:preview.branch,base:preview.base})}</small>
        <small>{$t("pr.pushState",{upstream:preview.upstream??$t("pr.none"),ahead:preview.ahead,behind:preview.behind})}</small>
        {#if preview.dirty}<small class="field-warning">{$t("pr.dirtyWarning")}</small>{/if}
        {#if !preview.pushed}<small class="field-warning">{$t("pr.pushRequired")}</small>{/if}
      </div>
    {/if}
    <label>{$t("pr.prTitle")}<input bind:value={title} maxlength="256"/></label>
    <label>{$t("pr.base")}<input bind:value={base} maxlength="200"/></label>
    <label>{$t("pr.body")}<textarea bind:value={body} rows="12" maxlength="65536"></textarea></label>
    <label class="character-check"><input type="checkbox" bind:checked={draft}/><span><strong>{$t("pr.draft")}</strong></span></label>
    {#if !url}<label class="danger-confirm"><input type="checkbox" bind:checked={confirmed}/>{$t("pr.confirmCreate")}</label>{/if}
    {#if error}<p class="preset-sync-error">{error}</p>{/if}
    <footer>
      <button type="button" onclick={onclose}>{$t("common.cancel")}</button>
      {#if url}<button type="button" class="primary" onclick={openUrl}><ExternalLink size={16}/>{$t("pr.open")}</button>
      {:else}<button type="button" class="primary" disabled={busy||!confirmed||!preview?.eligible||!title.trim()||!base.trim()||base===preview?.branch} onclick={createPullRequest}>{$t("pr.create")}</button>{/if}
    </footer>
  </div>
</div>
