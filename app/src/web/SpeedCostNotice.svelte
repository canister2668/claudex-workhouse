<script lang="ts" module>
  import { requestJson } from "./api-client";
  type Billing = { mode: "subscription" | "api"; credit: { averageRunUsd: number | null } };
  // Shared by every picker showing the notice; refetched after 30 s so a
  // billing-mode switch is reflected.
  let billingRequest: Promise<Billing | null> | null = null,billingAt = 0;
  const loadBilling = () => {
    if (!billingRequest || Date.now() - billingAt > 30_000) { billingAt = Date.now(); billingRequest = requestJson("/api/system-settings/claude-billing").then((data: any) => data?.settings ?? null).catch(() => null); }
    return billingRequest;
  };
</script>

<script lang="ts">
  // Shown under a speed picker while "Fast" is selected: what the faster tier
  // costs and, for Claude, a per-run estimate from this cycle's API runs.
  import { CircleAlert } from "@lucide/svelte";
  import { t } from "./i18n";

  let { provider, tier }: { provider: string; tier: string | null } = $props();

  let billing = $state<Billing | null>(null);
  const active = $derived(tier === "priority" && (provider === "claude" || provider === "codex"));
  $effect(() => { if (active && provider === "claude") void loadBilling().then(value => { billing = value; }); });

  const usd = (value: number) => `$${value.toFixed(2)}`;
  const average = $derived(billing?.credit?.averageRunUsd ?? null);
</script>

{#if active}
  <p class="settings-note warn-text speed-cost-notice" role="note">
    <CircleAlert size={14}/>
    <span>
      {#if provider === "claude"}
        {$t("speedCost.claude")}
        {$t(billing?.mode === "api" ? "speedCost.claudeApi" : "speedCost.claudeSubscription")}
        <b>{average !== null ? $t("speedCost.claudeEstimate", { standard: usd(average), fast: usd(average * 2) }) : $t("speedCost.claudeEstimateNone")}</b>
      {:else}
        {$t("speedCost.codex")}
        <b>{$t("speedCost.codexEstimate")}</b>
      {/if}
    </span>
  </p>
{/if}

<style>
  .speed-cost-notice b { display: block; margin-top: var(--space-1); font-weight: 600; }
</style>
