<script lang="ts">
  import{Check,CircleAlert,CloudUpload,FileDiff,FlaskConical,X}from"@lucide/svelte";
  import{onDestroy,onMount}from"svelte";
  import{hasTaskOutcomeDetails,taskOutcomeSummary}from"./task-outcome";
  import{t}from"./i18n";
  import ProtonUploadDialog from"./ProtonUploadDialog.svelte";
  export let task:any;export let events:any[]=[];export let api:((path:string,init?:RequestInit)=>Promise<any>)|null=null;export let mobileCollapsible=false;export let mobileExpanded=false;export let mobileDismissed=false;export let onclose:(()=>void)|null=null;export let autoCloseMs=12_000;export let rail=false;export let hideOnWide=false;
  const gaugeLength=2*Math.PI*12;
  let countdown=1;
  let countdownOpen=false;
  let compactViewport=true;
  let countdownTimer:ReturnType<typeof setInterval>|null=null;
  let closeTimer:ReturnType<typeof setTimeout>|null=null;
  let countdownClosing=false;
  let protonUploadOpen=false;
  let railExpanded=false;
  function stopCountdown(){if(countdownTimer)clearInterval(countdownTimer);if(closeTimer)clearTimeout(closeTimer);countdownTimer=null;closeTimer=null;}
  function finishCountdown(){if(countdownClosing)return;countdownClosing=true;stopCountdown();countdown=0;onclose?.();}
  function startCountdown(){
    stopCountdown();countdownClosing=false;countdown=1;
    const deadline=Date.now()+autoCloseMs;
    const update=()=>{
      countdown=Math.max(0,(deadline-Date.now())/autoCloseMs);
      if(countdown>0)return;
      finishCountdown();
    };
    countdownTimer=setInterval(update,100);
    closeTimer=setTimeout(finishCountdown,autoCloseMs);
  }
  function syncCountdown(){
    const visible=mobileExpanded||!mobileCollapsible||!compactViewport;
    const next=Boolean(!rail&&!(hideOnWide&&!compactViewport)&&mobileCollapsible&&visible&&!mobileDismissed&&["completed","failed"].includes(task.status));
    if(next!==countdownOpen){countdownOpen=next;if(next)startCountdown();else stopCountdown();}
  }
  $: {mobileExpanded;mobileCollapsible;mobileDismissed;compactViewport;task.status;syncCountdown();}
  onMount(()=>{
    const update=()=>{compactViewport=window.innerWidth<=900;syncCountdown();};
    update();window.addEventListener("resize",update);
    return()=>window.removeEventListener("resize",update);
  });
  onDestroy(stopCountdown);
  $: summary=taskOutcomeSummary(task,events);
</script>
{#if ["completed","failed"].includes(task.status)&&hasTaskOutcomeDetails(summary)}
<section id={mobileCollapsible&&!rail?"mobile-task-outcome":undefined} class="task-outcome" class:failed={task.status==="failed"} class:mobile-collapsible={mobileCollapsible&&!rail} class:mobile-expanded={mobileExpanded} class:mobile-dismissed={mobileDismissed&&!rail} class:outcome-rail={rail} class:hide-on-wide={hideOnWide} role={mobileCollapsible&&!rail&&mobileExpanded&&!mobileDismissed?"dialog":undefined} aria-label={$t("outcome.title")}>
  <header>{#if task.status==="failed"}<CircleAlert size={18}/>{:else}<Check size={18}/>{/if}<strong>{$t(task.status==="failed"?"outcome.failed":"outcome.title")}</strong>{#if task.status==="completed"&&api&&task.id&&task.workspaceId&&(task.executionHostId??"local")==="local"}<button type="button" class="proton-upload-action" title={$t("proton.uploadAction")} onclick={()=>{stopCountdown();protonUploadOpen=true;}}><CloudUpload size={15}/><span>{$t("proton.uploadAction")}</span></button>{/if}{#if !rail}<button type="button" class="outcome-close" aria-label={$t("outcome.hide")} title={$t("outcome.hide")} data-remaining-seconds={Math.ceil(countdown*autoCloseMs/1000)} onclick={()=>onclose?.()}><svg class="outcome-close-gauge" viewBox="0 0 30 30" aria-hidden="true"><circle class="track" cx="15" cy="15" r="12"/><circle class="progress" cx="15" cy="15" r="12" stroke-dasharray={gaugeLength} stroke-dashoffset={gaugeLength*(1-countdown)}/></svg><X size={15}/></button>{/if}</header>
  {#if rail}<div class="outcome-rail-counts"><span><FileDiff size={14}/>{$t("outcome.files")} <strong>{summary.files.length}</strong></span><span><FlaskConical size={14}/>{$t("outcome.tests")} <strong>{summary.checks.length}</strong></span></div>{/if}
  {#if summary.failure}<div class="failure-summary"><strong>{summary.failure.reasonKey?$t(summary.failure.reasonKey):summary.failure.reason}</strong><small>{$t(summary.failure.actionKey)}</small></div>{/if}
  {#if summary.headline&&summary.headlineIsModel}<p class="outcome-ai-summary"><strong>{$t("outcome.aiSummary")}</strong><span>{summary.headline}</span></p>{/if}
  {#if !rail||railExpanded}<div class="outcome-grid">
    <article><strong><FileDiff size={15}/>{$t("outcome.files")} <em>{summary.files.length}</em></strong>{#if summary.files.length}<ul>{#each summary.files as file}<li><code class="path-tail-ellipsis" title={file} dir="rtl"><bdi dir="ltr">{file}</bdi></code></li>{/each}</ul>{:else}<small>{$t("outcome.noFiles")}</small>{/if}</article>
    <article><strong><FlaskConical size={15}/>{$t("outcome.tests")} <em>{summary.checks.length}</em></strong>{#if summary.checks.length}<ul>{#each summary.checks as check}<li class={check.status} title={$t(`outcome.check.${check.status}`)}><span>{check.status==="passed"?"✓":check.status==="failed"?"!":check.status==="unverified"?"?":"…"}</span><code>{check.command}</code><small>{$t(`outcome.check.${check.status}`)}</small></li>{/each}</ul>{:else}<small>{$t("outcome.noTests")}</small>{/if}</article>
  </div>{/if}
  {#if rail}<button type="button" class="outcome-rail-toggle" aria-expanded={railExpanded} onclick={()=>railExpanded=!railExpanded}>{$t(railExpanded?"outcome.hideDetails":"outcome.viewDetails")}</button>{/if}
</section>
{/if}
{#if protonUploadOpen&&api}<ProtonUploadDialog {api} {task} candidates={summary.uploadCandidates} onclose={()=>protonUploadOpen=false}/>{/if}
