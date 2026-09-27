<script lang="ts">
  import { t } from "../i18n";
  import { BADGE_TONE, badgeLabelKey, type BadgeState } from "./status-badge";

  let { state, size = "md", class: className = "" }: { state: BadgeState; size?: "sm" | "md"; class?: string } = $props();
</script>

<span class="status-badge tone-{BADGE_TONE[state]} is-{state} {size === 'sm' ? 'status-badge-sm' : ''} {className}" data-state={state} role="status">
  {#if state === "running"}<i class="status-badge-spinner" aria-hidden="true"></i>{:else}<i class="status-badge-dot" aria-hidden="true"></i>{/if}
  <span>{$t(badgeLabelKey(state))}</span>
</span>
