<script lang="ts">
  import { liveLabel, ownershipLabel, statusLabel } from "./session-ui";
  import { providerDisplayName } from "./provider-display";
  export let provider:"codex"|"claude"|"deepseek"|"ollama"|"antigravity"|"grok";
  export let status:string;
  export let liveMode:"Live"|"Delayed"|"History";
  export let ownership:string|null|undefined=null;
</script>

<span class="engine {provider}">{providerDisplayName(provider)}</span>
<span class="state-text s-{status}">{statusLabel(status)}</span>
{#if ownership}<span class="ownership-badge">{ownershipLabel(ownership)}</span>{/if}
<span class="live-badge {liveMode.toLowerCase()}">{liveLabel(liveMode)}</span>
