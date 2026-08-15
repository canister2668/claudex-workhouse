<script lang="ts">
  import{CheckCircle2,CloudUpload,LoaderCircle,X}from"@lucide/svelte";
  import{t}from"./i18n";
  import type{TaskOutcomeFile}from"./task-outcome";
  export let api:(path:string,init?:RequestInit)=>Promise<any>;
  export let task:any;
  export let candidates:TaskOutcomeFile[]=[];
  export let onclose:()=>void;
  let relativePath=candidates.find(item=>item.pathBase==="workspace")?.path??"",busy=false,error="",upload:any=null,completed=false;
  const sha256Label="SHA-256",examplePath="dist/result.zip";
  const formatBytes=(value:number)=>value<1024?`${value} B`:value<1024**2?`${(value/1024).toFixed(1)} KiB`:value<1024**3?`${(value/1024**2).toFixed(1)} MiB`:`${(value/1024**3).toFixed(2)} GiB`;
  async function prepare(){if(!relativePath.trim()||busy)return;busy=true;error="";try{const data=await api(`/api/tasks/${encodeURIComponent(task.provider)}/${encodeURIComponent(task.id)}/proton-uploads/prepare`,{method:"POST",headers:{"Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({workspaceId:task.workspaceId,relativePath:relativePath.trim(),confirmExternalUpload:true})});upload=data.upload;}catch(e){error=e instanceof Error?e.message:String(e)}finally{busy=false;}}
  async function execute(){if(!upload||busy)return;busy=true;error="";try{const data=await api(`/api/proton-drive/uploads/${encodeURIComponent(upload.id)}/execute`,{method:"POST",headers:{"Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({expectedSha256:upload.sourceSha256,confirmUpload:true})});upload=data.upload;completed=true;}catch(e){error=e instanceof Error?e.message:String(e)}finally{busy=false;}}
</script>
<div class="modal-backdrop proton-upload-backdrop" role="presentation" onclick={(event)=>event.target===event.currentTarget&&!busy&&onclose()}>
  <div class="modal proton-upload-dialog" role="dialog" aria-modal="true" aria-labelledby="proton-upload-title">
    <header><span><CloudUpload size={21}/><h2 id="proton-upload-title">{$t("proton.uploadTitle")}</h2></span><button type="button" class="icon-button" disabled={busy} aria-label={$t("common.close")} onclick={onclose}><X size={18}/></button></header>
    {#if completed}
      <div class="proton-upload-complete"><CheckCircle2 size={28}/><strong>{$t("proton.uploadCompleted")}</strong><code>{upload.remotePath}</code><small>{sha256Label} · {upload.sourceSha256}</small></div>
      <button type="button" class="primary" onclick={onclose}>{$t("common.close")}</button>
    {:else if upload}
      <div class="proton-upload-review"><dl><div><dt>{$t("proton.source")}</dt><dd><code>{upload.sourceRelativePath}</code></dd></div><div><dt>{$t("proton.size")}</dt><dd>{formatBytes(upload.sourceSize)}</dd></div><div><dt>{sha256Label}</dt><dd><code>{upload.sourceSha256}</code></dd></div><div><dt>{$t("proton.destination")}</dt><dd><code>{upload.remotePath}</code></dd></div></dl><p>{$t("proton.confirmBody")}</p></div>
      <div class="dialog-actions"><button type="button" disabled={busy} onclick={onclose}>{$t("common.cancel")}</button><button type="button" class="primary" disabled={busy} onclick={execute}>{#if busy}<LoaderCircle class="spin" size={15}/>{/if}{$t(busy?"proton.uploading":"proton.confirmUpload")}</button></div>
    {:else}
      <label>{$t("proton.workspaceFile")}<input list="proton-upload-candidates" bind:value={relativePath} maxlength="4096" autocomplete="off" spellcheck="false" placeholder={examplePath}/></label>
      <datalist id="proton-upload-candidates">{#each candidates.filter(item=>item.pathBase==="workspace") as item}<option value={item.path}></option>{/each}</datalist>
      <small>{$t("proton.workspaceOnly")}</small>
      <div class="dialog-actions"><button type="button" disabled={busy} onclick={onclose}>{$t("common.cancel")}</button><button type="button" class="primary" disabled={busy||!relativePath.trim()} onclick={prepare}>{#if busy}<LoaderCircle class="spin" size={15}/>{/if}{$t(busy?"proton.preparing":"proton.reviewUpload")}</button></div>
    {/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  </div>
</div>
<style>
  .proton-upload-backdrop{z-index:90}.proton-upload-dialog{width:min(620px,calc(100vw - 1rem));display:grid;gap:1rem}.proton-upload-dialog>header,.proton-upload-dialog>header>span,.dialog-actions{display:flex;align-items:center;gap:.55rem}.proton-upload-dialog>header{justify-content:space-between}.proton-upload-dialog h2{margin:0;font-size:1.05rem}.proton-upload-dialog label{display:grid;gap:.35rem}.proton-upload-dialog input{width:100%}.proton-upload-dialog>small,.proton-upload-review p{color:var(--muted)}.dialog-actions{justify-content:flex-end}.dialog-actions button{min-width:120px;display:inline-flex;align-items:center;justify-content:center;gap:.35rem}.proton-upload-review dl{display:grid;gap:.55rem;margin:0}.proton-upload-review dl>div{display:grid;grid-template-columns:100px minmax(0,1fr);gap:.65rem}.proton-upload-review dt{color:var(--muted)}.proton-upload-review dd{margin:0;min-width:0}.proton-upload-review code,.proton-upload-complete code{display:block;overflow-wrap:anywhere;white-space:normal}.proton-upload-complete{display:grid;justify-items:center;gap:.55rem;text-align:center}.error{margin:0;color:var(--danger)}
  @media(max-width:520px){.proton-upload-review dl>div{grid-template-columns:1fr;gap:.2rem}.dialog-actions{display:grid;grid-template-columns:1fr 1fr}.dialog-actions button{min-width:0}}
</style>
