<script lang="ts">
  import { ChevronDown, ChevronUp } from "@lucide/svelte";
  import { presentEvent } from "./events";
  import { processRowKey } from "./collaboration-identity";
  import { locale, t } from "./i18n";
  export let sessionId="";
  export let runId="";
  export let participantId="";
  export let rows:any[]=[];
  export let expanded=false;
  export let label="";
  export let ontoggle:()=>void=()=>{};
</script>

{#if rows.length}<button type="button" class="run-process-toggle" aria-expanded={expanded} onclick={ontoggle}>{#if expanded}<ChevronUp size={15}/>{:else}<ChevronDown size={15}/>{/if}<span>{$t("conversation.process")}</span><small>{rows.length}</small></button>{/if}
{#if rows.length&&expanded}<div class="run-process" aria-label={label||$t("conversation.process")}>
  {#each rows as row (processRowKey(sessionId,{id:runId},{id:participantId},row))}<div class="run-process-row"><div><span>{presentEvent(row.event).label}{#if row.event.timestamp} · {new Date(row.event.timestamp).toLocaleTimeString($locale)}{/if}</span><p>{row.summary}</p></div></div>{/each}
</div>{/if}
