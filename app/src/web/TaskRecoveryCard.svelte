<script lang="ts">
  import { providerDisplayName } from "./provider-display";
  import { RotateCcw, X } from "@lucide/svelte";
  import type { ApiRequestOptions } from "./api-client";
  import { t } from "./i18n";
  import { permissionLabel } from "./session-ui";

  export let api:(path:string,init?:RequestInit,options?:ApiRequestOptions)=>Promise<any>;
  export let task:any;
  export let onstarted:(task:any)=>void|Promise<void>;

  let recovery:any=null,loading=false,open=false,prompt="",submitting=false,lastKey="",notice="";
  $:{
    const key=`${task?.id??""}:${task?.status??""}:${task?.updatedAt??""}`;
    if(key!==lastKey){lastKey=key;open=false;recovery=null;loading=false;if(task?.id&&task?.provider&&task?.status==="stopped")void load(key);}
  }
  async function load(key:string){
    const current=task?.id,provider=task?.provider;if(!current||!provider)return;loading=true;
    try{const data=await api(`/api/tasks/${provider}/${encodeURIComponent(current)}/recovery`,{}, {caller:"TaskRecoveryCard.preview"});if(lastKey===key)recovery=data.recovery??null;}catch{if(lastKey===key)recovery=null;}finally{if(lastKey===key)loading=false;}
  }
  function requestKey(){
    if(globalThis.crypto?.randomUUID)return globalThis.crypto.randomUUID();
    const bytes=new Uint8Array(16);globalThis.crypto?.getRandomValues?.(bytes);bytes[6]=(bytes[6]&0x0f)|0x40;bytes[8]=(bytes[8]&0x3f)|0x80;
    const hex=[...bytes].map(value=>value.toString(16).padStart(2,"0")).join("");
    return`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  }
  function visibleBlocked(value:any){return["recovery-in-progress","recovery-failed","thread-advanced","host-missing","host-offline","workspace-unavailable","workspace-source-mismatch","permission-unavailable"].includes(value?.reason);}
  function show(){prompt=recovery?.prompt??"";notice="";open=true;}
  async function submit(){
    if(!recovery?.eligible||!prompt.trim()||submitting)return;submitting=true;
    try{
      const data=await api(`/api/tasks/${task.provider}/${encodeURIComponent(task.id)}/recovery`,{method:"POST",headers:{"Idempotency-Key":requestKey()},body:JSON.stringify({confirm:true,prompt:prompt.trim()})});
      open=false;recovery={...recovery,eligible:false,reason:"already-resumed",attempt:{status:"started",resumedTaskId:data.task?.id,error:null}};
      if(data.task)await onstarted(data.task);
    }catch(error){notice=error instanceof Error?error.message:String(error);}finally{submitting=false;}
  }
</script>

{#if recovery?.eligible||visibleBlocked(recovery)}
  <section class="task-recovery-card" aria-label={$t("recovery.title")}>
    <span><RotateCcw size={20}/><span><strong>{$t("recovery.title")}</strong><small>
      {#if recovery.eligible}{$t("recovery.body")}
      {:else if recovery.reason==="recovery-in-progress"}{$t("recovery.inProgress")}
      {:else if recovery.reason==="recovery-failed"}{$t("recovery.failed")}
      {:else if recovery.reason==="thread-advanced"}{$t("recovery.threadAdvanced")}
      {:else if recovery.reason==="host-offline"||recovery.reason==="host-missing"}{$t("recovery.hostUnavailable")}
      {:else if recovery.reason==="permission-unavailable"}{$t("recovery.permissionUnavailable")}
      {:else}{$t("recovery.workspaceUnavailable")}{/if}
      {#if !recovery.eligible&&recovery.attempt?.error}<em>{recovery.attempt.error}</em>{/if}
    </small></span></span>
    {#if recovery.eligible}<button type="button" class="primary" onclick={show}>{$t("recovery.action")}</button>{/if}
  </section>
{/if}

{#if open&&recovery}
  <div class="modal-backdrop" role="presentation" onclick={(event)=>event.target===event.currentTarget&&!submitting&&(open=false)}>
    <div class="modal recovery-modal" role="dialog" aria-modal="true" aria-labelledby="recovery-title">
      <header><h2 id="recovery-title">{$t("recovery.confirmTitle")}</h2><button type="button" class="icon-button" aria-label={$t("common.close")} disabled={submitting} onclick={()=>open=false}><X size={20}/></button></header>
      <dl>
        <div><dt>{$t("approval.provider")}</dt><dd>{providerDisplayName(recovery.provider)}</dd></div>
        <div><dt>{$t("session.thread")}</dt><dd><code>{recovery.threadId}</code></dd></div>
        <div><dt>{$t("session.workspace")}</dt><dd>{recovery.workspaceName??recovery.workspaceId}</dd></div>
        <div><dt>{$t("session.model")}</dt><dd>{recovery.model??$t("model.default")}</dd></div>
        <div><dt>{$t("approval.access")}</dt><dd>{permissionLabel(recovery.effectivePermission)}</dd></div>
      </dl>
      {#if recovery.permissionDowngraded}<p class="warning">{$t("recovery.permissionDowngraded",{from:permissionLabel(recovery.originalPermission),to:permissionLabel(recovery.effectivePermission)})}</p>{/if}
      {#if notice}<p class="warning" role="alert">{notice}</p>{/if}
      <label>{$t("recovery.prompt")}<textarea bind:value={prompt} rows="7" maxlength="20000"></textarea></label>
      <p class="note">{$t("recovery.noFallback")}</p>
      <button type="button" class="primary" disabled={submitting||!prompt.trim()} onclick={submit}>{$t(submitting?"recovery.starting":"recovery.confirm")}</button>
    </div>
  </div>
{/if}

<style>
  .task-recovery-card{display:flex;align-items:center;justify-content:space-between;gap:.75rem;margin:.65rem 0;padding:.75rem;border:1px solid var(--warn);border-radius:13px;background:color-mix(in srgb,var(--surface) 92%,var(--warn))}
  .task-recovery-card>span{display:flex;align-items:center;gap:.6rem;min-width:0}.task-recovery-card>span>span{display:grid;gap:.15rem}.task-recovery-card small,.note{color:var(--muted)}.task-recovery-card small em{display:block;margin-top:.2rem;color:var(--warn);font-style:normal}
  .recovery-modal dl{display:grid;grid-template-columns:1fr 1fr;gap:.45rem;margin:0}.recovery-modal dl div{min-width:0;padding:.55rem;border-radius:9px;background:var(--surface-2)}dt{font-size:.68rem;color:var(--muted)}dd{margin:.15rem 0 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.recovery-modal label{display:grid;gap:.3rem}.warning{color:var(--warn)}.note{margin:.1rem 0;font-size:.75rem}
  @media(max-width:600px){.task-recovery-card{align-items:flex-start;flex-direction:column}.task-recovery-card>button{width:100%}.recovery-modal dl{grid-template-columns:1fr}}
</style>
