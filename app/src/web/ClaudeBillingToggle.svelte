<script lang="ts">
  // Session-header switch for the Claude billing source. It flips the same
  // installation-wide setting as Settings › Claude › Account; the next message
  // in any Claude session runs on the chosen source.
  import { onMount } from "svelte";
  import { t } from "./i18n";
  import { requestJson } from "./api-client";
  import Switch from "./ui/Switch.svelte";

  type Billing = { mode: "subscription" | "api"; apiKeyConfigured: boolean; credit: { remainingUsd: number; source: "organization" | "local" } };

  let billing = $state<Billing | null>(null);
  let saving = $state(false);
  let useApi = $state(false);
  let error = $state("");

  const title = $derived(error || (!billing?.apiKeyConfigured ? $t("claudeBilling.toggleNeedsKey") : $t(useApi ? "claudeBilling.toggleOnTitle" : "claudeBilling.toggleOffTitle")));

  async function load() {
    try { const data = await requestJson("/api/system-settings/claude-billing"); if (data?.settings) { billing = data.settings; useApi = data.settings.mode === "api"; } error = ""; }
    catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
  }

  async function change(checked: boolean) {
    saving = true;
    try {
      const data = await requestJson("/api/system-settings/claude-billing", { method: "PUT", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ mode: checked ? "api" : "subscription" }) });
      if (data?.settings) { billing = data.settings; useApi = data.settings.mode === "api"; }
      error = "";
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
      useApi = billing?.mode === "api";
    } finally { saving = false; }
  }

  onMount(load);
</script>

{#if billing}
  <span class="claude-billing-toggle" class:on={useApi} {title}>
    <span class="claude-billing-toggle-label">{$t("claudeBilling.toggleLabel")}{#if useApi}<b>${billing.credit.remainingUsd.toFixed(2)}</b>{/if}</span>
    <Switch bind:checked={useApi} disabled={saving || (!useApi && !billing.apiKeyConfigured)} label={$t("claudeBilling.useApi")} onchange={change}/>
  </span>
{/if}

<style>
  .claude-billing-toggle { display: inline-flex; align-items: center; gap: var(--space-1); min-height: 28px; padding: 0 var(--space-1) 0 var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-pill); background: var(--surface-2); color: var(--muted); font-size: var(--text-xs); font-weight: 600; white-space: nowrap; }
  .claude-billing-toggle.on { border-color: var(--accent); color: var(--text); }
  .claude-billing-toggle-label { display: inline-flex; align-items: baseline; gap: var(--space-1); }
  .claude-billing-toggle-label b { color: var(--accent-strong); font-weight: 700; font-variant-numeric: tabular-nums; }
  .claude-billing-toggle :global(.ui-switch) { transform: scale(.85); }
</style>
