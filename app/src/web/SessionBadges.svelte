<script lang="ts">
  import { liveLabel, ownershipLabel } from "./session-ui";
  import { providerDisplayName } from "./provider-display";
  import StatusBadge from "./ui/StatusBadge.svelte";
  import { taskBadgeState } from "./ui/status-badge";
  const activeStatuses=new Set(["pending","queued","running","waiting"]);
  export let provider:"codex"|"claude"|"deepseek"|"ollama"|"antigravity"|"grok";
  export let status:string;
  export let liveMode:"Live"|"Delayed"|"History";
  export let ownership:string|null|undefined=null;
</script>

<span class="engine {provider}">{providerDisplayName(provider)}</span>
<StatusBadge state={taskBadgeState(status,{delayed:liveMode==="Delayed"&&activeStatuses.has(status)})}/>
{#if ownership}<span class="ownership-badge">{ownershipLabel(ownership)}</span>{/if}
<span class="live-badge {liveMode.toLowerCase()}">{liveLabel(liveMode)}</span>
