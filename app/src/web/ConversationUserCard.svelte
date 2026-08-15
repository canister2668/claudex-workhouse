<script lang="ts">
  import { Check, Copy, Paperclip, User } from "@lucide/svelte";
  import { formatCardDateTime, locale, t } from "./i18n";
  import { parseConversationUserContent } from "./conversation-attachments";

  export let userName="";
  export let content="";
  export let timestamp:string|null=null;
  export let roundLabel="";
  export let reminderLabel="";
  let copied=false;
  $: parsed=parseConversationUserContent(content);
  async function copyInput(){
    try{await navigator.clipboard.writeText(content);copied=true;setTimeout(()=>copied=false,1200);}catch{}
  }
</script>

<article class="collaboration-user" class:round-user={Boolean(roundLabel)}>
  <span class="timeline-node user" aria-hidden="true"><User size={13}/></span>
  <header class="conversation-user-heading">
    <span class="conversation-user-icon" aria-hidden="true"><User size={18}/></span>
    <span class="conversation-user-identity">
      <strong>{$t("conversation.myInput")}</strong>
      <span>{userName}{#if roundLabel} · {roundLabel}{/if}</span>
    </span>
    {#if reminderLabel}<span class="personality-reminder-badge">{reminderLabel}</span>{/if}
    {#if timestamp}<time datetime={timestamp}>{formatCardDateTime(timestamp,$locale)}</time>{/if}
    <button type="button" class="conversation-user-copy" aria-label={$t(copied?"common.copied":"common.copy")} title={$t(copied?"common.copied":"common.copy")} onclick={copyInput}>{#if copied}<Check size={14}/>{:else}<Copy size={14}/>{/if}</button>
  </header>
  {#if parsed.text}<p>{parsed.text}</p>{/if}
  {#if parsed.attachments.length}
    <div class="conversation-user-attachments">
      {#each parsed.attachments as attachment (attachment.fileName)}
        {#if attachment.url}
          <a class="conversation-user-image" href={attachment.url} target="_blank" rel="noopener noreferrer" title={attachment.name}>
            <img src={attachment.url} alt={attachment.name} loading="lazy"/>
          </a>
        {:else}
          <span class="conversation-user-file" title={attachment.name}><Paperclip size={13}/>{attachment.name}</span>
        {/if}
      {/each}
    </div>
  {/if}
</article>
