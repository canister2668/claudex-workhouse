<script lang="ts">
  // Claude billing source: the signed-in subscription or a Console API key
  // (which spends the monthly Max/Team API credits). Saves on its own, like
  // the provider connection controls, because it changes who pays for the
  // next Claude request rather than a draft preference.
  import { onMount } from "svelte";
  import { CircleAlert, ExternalLink, RefreshCw } from "@lucide/svelte";
  import { formatDateTime, locale, t } from "../i18n";
  import { requestJson } from "../api-client";
  import SettingRow from "../ui/SettingRow.svelte";
  import Switch from "../ui/Switch.svelte";
  import SettingsSection from "./SettingsSection.svelte";

  type Billing = {
    mode: "subscription" | "api";
    apiKeyConfigured: boolean;
    apiKeyHint: string | null;
    adminKeyConfigured: boolean;
    adminKeyHint: string | null;
    environmentKeyPresent: boolean;
    monthlyCreditUsd: number;
    cycleResetDay: number;
    credit: { source: "organization" | "local"; cycleStart: string; spentUsd: number; remainingUsd: number; runs: number | null; error: string | null };
  };

  const CONSOLE_BILLING_URL = "https://platform.claude.com/settings/billing";

  let billing = $state<Billing | null>(null);
  let loading = $state(false);
  let saving = $state(false);
  let notice = $state("");
  let useApi = $state(false);
  let apiKey = $state("");
  let adminKey = $state("");
  let monthlyCredit = $state(100);
  let resetDay = $state(1);

  const usd = (value: number) => `$${value.toFixed(2)}`;
  const spentPercent = $derived(billing && billing.monthlyCreditUsd > 0 ? Math.min(100, (billing.credit.spentUsd / billing.monthlyCreditUsd) * 100) : 0);
  // The switch can be on before a key exists; nothing is saved until one is entered.
  const needsKey = $derived(useApi && !billing?.apiKeyConfigured);

  function apply(next: Billing) {
    billing = next;
    useApi = next.mode === "api";
    monthlyCredit = next.monthlyCreditUsd;
    resetDay = next.cycleResetDay;
  }

  async function load() {
    loading = true;
    try { const data = await requestJson("/api/system-settings/claude-billing"); if (data?.settings) apply(data.settings); notice = ""; }
    catch (error) { notice = error instanceof Error ? error.message : String(error); }
    finally { loading = false; }
  }

  async function save(body: Record<string, unknown>) {
    saving = true;
    try {
      const data = await requestJson("/api/system-settings/claude-billing", { method: "PUT", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify(body) });
      if (data?.settings) apply(data.settings);
      apiKey = "";
      adminKey = "";
      notice = $t(billing?.mode === "api" ? "claudeBilling.savedApi" : "claudeBilling.savedSubscription");
    } catch (error) {
      notice = error instanceof Error ? error.message : String(error);
      if (billing) useApi = billing.mode === "api";
    } finally { saving = false; }
  }

  function toggle(checked: boolean) {
    if (checked && !billing?.apiKeyConfigured) { notice = ""; return; }
    void save({ mode: checked ? "api" : "subscription" });
  }

  function saveKey() {
    const key = apiKey.trim();
    if (!key) return;
    void save({ mode: useApi ? "api" : billing?.mode ?? "subscription", apiKey: key });
  }

  function clearKey() { void save({ mode: "subscription", clearApiKey: true }); }

  function saveAdminKey() {
    const key = adminKey.trim();
    if (key) void save({ mode: billing?.mode ?? "subscription", adminKey: key });
  }

  function clearAdminKey() { void save({ mode: billing?.mode ?? "subscription", clearAdminKey: true }); }

  function saveCycle() {
    const credit = Number(monthlyCredit), day = Math.round(Number(resetDay));
    if (!Number.isFinite(credit) || credit < 0 || !Number.isInteger(day) || day < 1 || day > 31) { notice = $t("claudeBilling.cycleInvalid"); return; }
    void save({ mode: billing?.mode ?? "subscription", monthlyCreditUsd: credit, cycleResetDay: day });
  }

  onMount(load);
</script>

<SettingsSection title={$t("claudeBilling.title")} description={$t("claudeBilling.body")}>
  <svelte:fragment slot="actions"><button type="button" disabled={loading} onclick={load}><RefreshCw size={14} class={loading ? "spin" : ""}/>{$t(loading ? "status.checking" : "common.refreshStatus")}</button></svelte:fragment>

  <SettingRow label={$t("claudeBilling.useApi")} help={$t("claudeBilling.useApiBody")}>
    <Switch bind:checked={useApi} disabled={!billing || saving} label={$t("claudeBilling.useApi")} onchange={toggle}/>
  </SettingRow>

  {#if billing}
    {#if useApi || billing.apiKeyConfigured}
      <div class="compatible-provider-form claude-billing-key">
        <label>{$t("claudeBilling.apiKey")}
          <input type="password" bind:value={apiKey} autocomplete="off" spellcheck="false" placeholder={billing.apiKeyHint ? $t("claudeBilling.apiKeyReplace", { hint: billing.apiKeyHint }) : "sk-ant-api03-…"}/>
        </label>
        <small>{$t(needsKey ? "claudeBilling.apiKeyRequired" : "claudeBilling.apiKeyHelp")}</small>
        <div class="provider-auth-actions">
          <button type="button" disabled={saving || !apiKey.trim()} onclick={saveKey}>{$t(needsKey ? "claudeBilling.saveAndSwitch" : "claudeBilling.saveKey")}</button>
          {#if billing.apiKeyConfigured}<button type="button" class="auth-logout" disabled={saving} onclick={clearKey}>{$t("claudeBilling.clearKey")}</button>{/if}
        </div>
      </div>
    {/if}

    {#if billing.mode === "api"}
      <div class="claude-credit" aria-live="polite">
        <div class="claude-credit-head">
          <span>{$t("claudeBilling.remaining")}</span>
          <strong>{usd(billing.credit.remainingUsd)}</strong>
        </div>
        <div class="claude-credit-bar" class:warn={spentPercent >= 75} class:err={spentPercent >= 100} role="meter" aria-valuemin="0" aria-valuemax={billing.monthlyCreditUsd} aria-valuenow={billing.credit.spentUsd} aria-label={$t("claudeBilling.spent")}><i style={`width:${spentPercent}%`}></i></div>
        <small>{billing.credit.source === "organization"
          ? $t("claudeBilling.spentSummaryOrganization", { spent: usd(billing.credit.spentUsd), total: usd(billing.monthlyCreditUsd), since: formatDateTime(billing.credit.cycleStart, $locale) })
          : $t("claudeBilling.spentSummary", { spent: usd(billing.credit.spentUsd), total: usd(billing.monthlyCreditUsd), runs: billing.credit.runs ?? 0, since: formatDateTime(billing.credit.cycleStart, $locale) })}</small>
        <small class="claude-credit-source" class:warn-text={Boolean(billing.credit.error)}>{$t(billing.credit.source === "organization" ? "claudeBilling.sourceOrganization" : billing.credit.error ? "claudeBilling.sourceFallback" : "claudeBilling.sourceLocal")}</small>
        <div class="compatible-provider-form claude-credit-cycle">
          <label>{$t("claudeBilling.monthlyCredit")}<input type="number" min="0" step="1" bind:value={monthlyCredit}/></label>
          <label>{$t("claudeBilling.resetDay")}<input type="number" min="1" max="31" step="1" bind:value={resetDay}/></label>
          <div class="provider-auth-actions"><button type="button" disabled={saving} onclick={saveCycle}>{$t("claudeBilling.saveCycle")}</button></div>
        </div>
        <div class="compatible-provider-form claude-admin-key">
          <label>{$t("claudeBilling.adminKey")}
            <input type="password" bind:value={adminKey} autocomplete="off" spellcheck="false" placeholder={billing.adminKeyHint ? $t("claudeBilling.apiKeyReplace", { hint: billing.adminKeyHint }) : "sk-ant-admin01-…"}/>
          </label>
          <small>{$t("claudeBilling.adminKeyHelp")}</small>
          <div class="provider-auth-actions">
            <button type="button" disabled={saving || !adminKey.trim()} onclick={saveAdminKey}>{$t("claudeBilling.saveKey")}</button>
            {#if billing.adminKeyConfigured}<button type="button" class="auth-logout" disabled={saving} onclick={clearAdminKey}>{$t("claudeBilling.clearKey")}</button>{/if}
          </div>
        </div>
        <p class="settings-note"><CircleAlert size={14}/>{$t("claudeBilling.estimateNote")}</p>
        <a class="claude-credit-link" href={CONSOLE_BILLING_URL} target="_blank" rel="noreferrer noopener">{$t("claudeBilling.openConsole")}<ExternalLink size={12}/></a>
      </div>
    {:else if billing.environmentKeyPresent}
      <p class="settings-note warn-text"><CircleAlert size={14}/>{$t("claudeBilling.environmentKey")}</p>
    {/if}
    <p class="settings-note"><CircleAlert size={14}/>{$t("claudeBilling.scopeNote")}</p>
  {/if}
  {#if notice}<p class="runtime-notice" aria-live="polite">{notice}</p>{/if}
</SettingsSection>

<style>
  .claude-billing-key { padding: 0 0 var(--space-2); }
  .claude-credit { display: grid; gap: var(--space-2); margin-top: var(--space-2); padding: var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface-2); }
  .claude-credit-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-2); }
  .claude-credit-head span { color: var(--muted); font-size: var(--text-sm); font-weight: 600; }
  .claude-credit-head strong { font-size: var(--text-lg); font-weight: 700; font-variant-numeric: tabular-nums; }
  .claude-credit-bar { height: var(--space-2); border-radius: var(--radius-pill); background: var(--surface-3); overflow: hidden; }
  .claude-credit-bar i { display: block; height: 100%; border-radius: inherit; background: var(--accent); transition: width .15s; }
  .claude-credit-bar.warn i { background: var(--warn); }
  .claude-credit-bar.err i { background: var(--err); }
  .claude-admin-key { margin-top: 0; }
  .claude-credit > small { color: var(--muted); font-size: var(--text-xs); font-variant-numeric: tabular-nums; }
  .claude-credit-cycle { grid-template-columns: 1fr 1fr; align-items: end; margin-top: 0; }
  .claude-credit-cycle .provider-auth-actions { grid-column: 1 / -1; }
  .claude-credit-link { display: inline-flex; align-items: center; gap: var(--space-1); color: var(--accent-strong); font-size: var(--text-xs); font-weight: 600; text-decoration: none; }
  .claude-credit-link:hover { text-decoration: underline; }
  .claude-credit-link:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
