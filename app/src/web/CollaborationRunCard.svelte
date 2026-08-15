<script lang="ts">
  import { Check, ChevronDown, ChevronUp, Clipboard, ExternalLink, MoreHorizontal } from "@lucide/svelte";
  import ApprovalPanel from "./ApprovalPanel.svelte";
  import UserInputPanel from "./UserInputPanel.svelte";
  import ConversationProcessFold from "./ConversationProcessFold.svelte";
  import EmotionAvatar from "./EmotionAvatar.svelte";
  import { emotionAssetUrl, emotionLabel } from "./collaboration-assets";
  import { resolveConversationScenePosition } from "./collaboration-presentation";
  import { inlineSceneKey } from "./collaboration-identity";
  import { turnUsageLabelKey, type TurnOutputUsage } from "./conversation";
  import { formatContextTokens } from "./context-usage";
  import { formatCardDateTime, locale, t } from "./i18n";
  import { renderMarkdown } from "./markdown";
  import { statusLabel } from "./session-ui";
  import TurnUsageDetails from "./TurnUsageDetails.svelte";
  export let sessionId="";export let run:any;export let person:any;export let task:any=null;export let output="";export let outputUsage:TurnOutputUsage|null=null;export let timestamp:string|null=null;export let frames:any[]=[];export let inlinePresentation:any=null;export let outfit="normal";export let notice:any=null;export let process:any[]=[];export let sessionTask:any=null;export let collapsed=false;export let processExpanded=false;export let reminder:any=null;export let showRound=false;export let codexAvatar:"Gpt-Codex"|"Gpt-Sol"="Gpt-Sol";export let api:(path:string,init?:RequestInit)=>Promise<any>;export let onopen:(task:any)=>void=()=>{};export let ontoggle:()=>void=()=>{};export let ontoggleProcess:()=>void=()=>{};export let providerLabel="";export let roleLabel="";export let hostLabel="";export let permissionLabel="";
  let copied="";
  // The dashed "awaiting" treatment and the accent speaker ring are mutually
  // exclusive: the ring takes over the moment streamed output arrives.
  $: awaitingOutput=!output&&["starting","running"].includes(run.status);
  $: activeSpeaker=!awaitingOutput&&["starting","running","waiting-approval","waiting-user"].includes(run.status);
  const sceneCount=()=>inlinePresentation?.scenes?.length??(output?Math.max(1,frames.length):0);
  const preview=()=>String(inlinePresentation?.scenes?.[0]?.text??output??"").replace(/\s+/g," ").trim().slice(0,120);
  async function copyValue(key:string,value:string){
    if(!value)return;
    try{await navigator.clipboard.writeText(value);copied=key;setTimeout(()=>copied="",1200);}catch{}
  }
  async function markdownClick(event:MouseEvent){
    const target=event.target;if(!(target instanceof Element))return;
    const button=target.closest<HTMLButtonElement>("button[data-copy-code]");if(!button)return;
    const code=button.closest(".markdown-code-block")?.querySelector("pre code");if(!code)return;
    try{await navigator.clipboard.writeText((code.textContent??"").replace(/\n$/,""));}catch{return;}
    const label=button.querySelector<HTMLElement>("[data-copy-label]");button.classList.add("copied");button.setAttribute("aria-label",$t("common.copied"));button.title=$t("common.copied");if(label)label.textContent=$t("common.copied");
    setTimeout(()=>{if(!button.isConnected)return;button.classList.remove("copied");button.setAttribute("aria-label",$t("common.copy"));button.title=$t("common.copy");if(label)label.textContent=$t("common.copy");},1500);
  }
  function markdownInteractions(node:HTMLElement){node.addEventListener("click",markdownClick);return{destroy:()=>node.removeEventListener("click",markdownClick)};}
</script>

<article id={`collaboration-run-${run.id}`} class="participant-block conversation-provider-turn provider-{person.provider}" class:turn--claude={person.provider==="claude"} class:turn--codex={person.provider==="codex"} class:current-speaker={activeSpeaker} class:awaiting-output={awaitingOutput} class:failed={run.status==="failed"||run.status==="timed-out"}>
  <span class="timeline-node provider-{person.provider}" aria-hidden="true"></span>
  <header><span class="participant-avatar"><EmotionAvatar engine={person.provider} {codexAvatar} onMiniClick={()=>{}} miniLabel={$t("a11y.providerAvatar",{provider:providerLabel})} externalState={{emotion:notice?.emotion??"neutral",line:"",statusLine:""}}/></span><div><strong>{providerLabel}</strong><span>{roleLabel} · {hostLabel} · {permissionLabel}{#if showRound} · {$t("collaboration.round",{count:run.round})}{/if}</span>{#if output&&timestamp}<time class="card-time" datetime={timestamp}>{formatCardDateTime(timestamp,$locale)}</time>{/if}{#if reminder?.targets?.includes(person.provider)}<span class="personality-reminder-badge run-reminder-badge">{$t("collaboration.reminderInjected")}</span>{/if}</div><span class="participant-state" class:live={Boolean(notice)}>{notice?.line??statusLabel(run.status)}</span><button type="button" aria-label={$t("a11y.toggleCollapse")} aria-expanded={!collapsed} onclick={ontoggle}>{#if collapsed}<ChevronDown size={18}/>{:else}<ChevronUp size={18}/>{/if}</button></header>
  {#if collapsed}
    <div class="turn-collapsed-preview"><span>{$t("conversation.sceneCount",{count:sceneCount()})}{#if outputUsage} · {$t(turnUsageLabelKey(outputUsage),{count:formatContextTokens(outputUsage.outputTokens)})}{/if} · {statusLabel(run.status)}</span>{#if preview()}<p>“{preview()}”</p>{/if}{#if sessionTask}<button type="button" onclick={()=>onopen(sessionTask)}><ExternalLink size={14}/>{$t("session.openProviderSession")}</button>{/if}</div>
  {/if}
  {#if !collapsed}<div class="participant-body">
    {#if output}
      {#if inlinePresentation}
        {#if inlinePresentation.leadingText}<div class="provider-output markdown-body inline-leading" use:markdownInteractions>{@html renderMarkdown(inlinePresentation.leadingText)}</div>{/if}
        <div class="inline-emotion-scenes">
          {#each inlinePresentation.scenes as scene,index (inlineSceneKey(sessionId,run,person,scene))}
            {@const assetPosition=resolveConversationScenePosition(scene,index)}
            <figure class="inline-emotion-scene" class:asset-right={assetPosition==="right"} class:no-asset={!scene.asset}>
              {#if scene.asset}<img loading="lazy" decoding="async" width="156" height="156" src={emotionAssetUrl(outfit,scene.asset.file)} alt={`${providerLabel} ${scene.emotion}`}/>{/if}
              <figcaption><span>{emotionLabel(scene.emotion)}</span><div class="markdown-body scene-markdown" use:markdownInteractions>{@html renderMarkdown(scene.text)}</div></figcaption>
            </figure>
          {/each}
        </div>
      {:else}
        {#if frames[0]}<figure class="output-emotion-frame"><img loading="lazy" src={emotionAssetUrl(outfit,frames[0].file)} alt={`${providerLabel} ${frames[0].emotion}`}/><figcaption><strong>{providerLabel}</strong><span>{emotionLabel(frames[0].emotion)}</span></figcaption></figure>{/if}
        <div class="provider-output markdown-body" use:markdownInteractions>{@html renderMarkdown(output)}</div>
        {#if frames[1]}<figure class="output-emotion-frame closing"><img loading="lazy" src={emotionAssetUrl(outfit,frames[1].file)} alt={`${providerLabel} ${frames[1].emotion}`}/><figcaption><strong>{providerLabel}</strong><span>{emotionLabel(frames[1].emotion)}</span></figcaption></figure>{/if}
      {/if}
    {:else if run.status==="timed-out"}<p class="provider-error">{$t("collaboration.responseTimedOut")}</p>{:else if run.errorCategory==="PROVIDER_OUTPUT_UNAVAILABLE"}<p class="provider-error">{$t("collaboration.providerOutputUnavailable")}</p>{:else if task?.error}<p class="provider-error">{task.error}</p>{:else}<p class="provider-waiting">{run.status==="queued"?$t("queue.pending"):$t("collaboration.waitingProvider")}<span class="typing-dots" aria-hidden="true"><i></i><i></i><i></i></span></p>{/if}
    <ConversationProcessFold {sessionId} runId={run.id} participantId={person.id} rows={process} expanded={processExpanded} label={$t("collaboration.publicProcess",{provider:providerLabel})} ontoggle={ontoggleProcess}/>
    {#if task&&run.status==="waiting-approval"}<ApprovalPanel {api} {task}/>{/if}{#if task&&run.status==="waiting-user"}<UserInputPanel {api} {task}/>{/if}
    <footer class="conversation-turn-footer">
      <span class="turn-primary-meta">{permissionLabel}{#if showRound} · {$t("collaboration.round",{count:run.round})}{/if}{#if outputUsage} · <span class="turn-token"><TurnUsageDetails usage={outputUsage}/></span>{/if}</span>
      <span class="turn-footer-actions">
        {#if sessionTask}<button type="button" class="session-open" onclick={()=>onopen(sessionTask)}><ExternalLink size={15}/>{$t("session.openProviderSession")}</button>{/if}
        <details class="turn-details">
          <summary aria-label={$t("conversation.turnDetails")}><MoreHorizontal size={17}/></summary>
          <div>
            <dl>
              <span><dt>{$t("workspace.label")}</dt><dd>{person.workspaceId??$t("common.unknown")}</dd></span>
              <span><dt>{$t("task.label")}</dt><dd>{task?.id??$t("task.pendingId")}</dd></span>
              <span><dt>{$t("session.providerSession")}</dt><dd>{task?.providerSessionId??task?.threadId??person.providerSessionId??$t("common.unknown")}</dd></span>
              <span><dt>{$t("session.host")}</dt><dd>{hostLabel}</dd></span>
              <span><dt>{$t("permission.label")}</dt><dd>{permissionLabel}</dd></span>
              <span><dt>{$t("session.capability")}</dt><dd>{person.capabilitySnapshot?.newSession?$t("session.newProviderSession"):$t("session.capabilityCheck")}</dd></span>
              {#if task?.requestedModel}<span><dt>{$t("model.label")}</dt><dd>{task.requestedModel}</dd></span>{/if}
              {#if timestamp}<span><dt>{$t("common.createdAt")}</dt><dd>{formatCardDateTime(timestamp,$locale)}</dd></span>{/if}
              {#if run.errorCategory}<span><dt>{$t("common.error")}</dt><dd>{run.errorCategory}</dd></span>{/if}
            </dl>
            <div class="turn-detail-actions">
              {#if person.workspaceId}<button type="button" onclick={()=>copyValue("workspace",person.workspaceId)}>{#if copied==="workspace"}<Check size={14}/>{:else}<Clipboard size={14}/>{/if}{$t("workspace.copyId")}</button>{/if}
              {#if task?.id}<button type="button" onclick={()=>copyValue("task",task.id)}>{#if copied==="task"}<Check size={14}/>{:else}<Clipboard size={14}/>{/if}{$t("task.copyId")}</button>{/if}
            </div>
          </div>
        </details>
      </span>
    </footer>
  </div>{/if}
</article>
