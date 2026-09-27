<script lang="ts">
  // 관리 › 시스템·업데이트. First-run panel, diagnostics, application update,
  // and the managed runtime overview. Per-agent runtime detail lives on the
  // agent pages.
  import { RefreshCw } from "@lucide/svelte";
  import { t } from "../i18n";
  import SettingRow from "../ui/SettingRow.svelte";
  import Switch from "../ui/Switch.svelte";
  import SettingsSection from "./SettingsSection.svelte";

  type ProviderId = "codex" | "claude" | "deepseek" | "ollama" | "antigravity" | "grok";
  type RuntimeStatus = { provider: ProviderId; name: string; current: string | null; latest: string | null; updateAvailable: boolean | null; managed: boolean; source: string; checkedAt: string | null; canUpdate: boolean; checksum: string | null; checksumSource?: "package" | "binary" | null; fault?: string | null; management: "managed" | "external" | "api"; dependsOn: "codex" | "claude" | null; configured: boolean | null };
  type ApplicationUpdateStatus = { state: string; current: { version: string; installMethod: string }; target: { version: string; publishedAt: string; manifestSha256: string; keyId: string } | null; updateAvailable: boolean; reason: string | null; blockers: Array<{ kind: string; id: string; status: string }>; recentAttempts: Array<{ id: string; state: string; sourceVersion: string; targetVersion: string; rollbackPerformed: boolean; error: string | null; updatedAt: string }> };

  export let setupShowOnStartup = true;
  export let setupPreferenceBusy = false;
  export let setupPreferenceNotice = "";
  export let setSetupStartupVisibility: (show: boolean) => void;
  export let reopenSetup: () => void;
  export let systemDiagnostic: any = null;
  export let diagnosticBusy = false;
  export let loadSystemDiagnostic: () => void;
  export let copySystemDiagnostic: () => void;
  export let applicationUpdate: ApplicationUpdateStatus | null = null;
  export let applicationUpdateBusy: false | "check" | "apply" = false;
  export let applicationUpdateNotice = "";
  export let checkApplicationUpdate: () => void;
  export let applyApplicationUpdate: () => void;
  export let runtimeCards: RuntimeStatus[] = [];
  export let runtimeBusy: "check" | "codex" | "claude" | null = null;
  export let runtimeNotice = "";
  export let checkUpdates: () => void;
  export let updateRuntime: (provider: "codex" | "claude") => void;
  export let onopenprovider: (provider: ProviderId) => void = () => {};
</script>

<p class="settings-page-body">{$t("settings.page.system.body")}</p>

<SettingsSection title={$t("setup.settingsTitle")}>
  <SettingRow label={$t("setup.showOnStartup")} help={$t("setup.showOnStartupBody")}><Switch checked={setupShowOnStartup} disabled={setupPreferenceBusy} label={$t("setup.showOnStartup")} onchange={(checked) => setSetupStartupVisibility(checked)}/></SettingRow>
  <div class="settings-section-foot"><button type="button" onclick={reopenSetup}>{$t("setup.openNow")}</button></div>
  {#if setupPreferenceNotice}<p class="runtime-notice" aria-live="polite">{setupPreferenceNotice}</p>{/if}
</SettingsSection>

<SettingsSection title={$t("diagnostic.system")} description={$t("diagnostic.safeReport")}>
  <svelte:fragment slot="actions"><button type="button" disabled={diagnosticBusy} onclick={loadSystemDiagnostic}><RefreshCw size={14}/>{$t(diagnosticBusy ? "diagnostic.running" : "diagnostic.run")}</button></svelte:fragment>
  {#if systemDiagnostic}<pre class="system-diagnostic">{JSON.stringify(systemDiagnostic, null, 2)}</pre><div class="settings-section-foot"><button type="button" onclick={copySystemDiagnostic}>{$t("diagnostic.copyReport")}</button></div>{/if}
</SettingsSection>

<SettingsSection title={$t("applicationUpdate.title")} description={$t("applicationUpdate.separate")}>
  <svelte:fragment slot="actions"><button type="button" disabled={Boolean(applicationUpdateBusy)} onclick={checkApplicationUpdate}><RefreshCw size={14} class={applicationUpdateBusy === "check" ? "spin" : ""}/>{$t(applicationUpdateBusy === "check" ? "status.checking" : "applicationUpdate.check")}</button></svelte:fragment>
  {#if applicationUpdate}
    <div class="runtime-card application-update-card" class:verified={applicationUpdate.state === "up-to-date"}>
      <span class="application-update-current"><strong>{$t("applicationUpdate.installed", { version: applicationUpdate.current.version })}</strong><small>{$t("applicationUpdate.method", { method: applicationUpdate.current.installMethod })}</small></span>
      {#if applicationUpdate.target}<span class="application-update-target"><code title={applicationUpdate.target.manifestSha256}>{$t("applicationUpdate.signature", { key: applicationUpdate.target.keyId, hash: applicationUpdate.target.manifestSha256.slice(0, 12) })}</code><small>{$t("applicationUpdate.target", { version: applicationUpdate.target.version })}</small></span>{/if}
      {#if applicationUpdate.updateAvailable}<button type="button" class="runtime-update" disabled={Boolean(applicationUpdateBusy) || applicationUpdate.blockers.length > 0} onclick={applyApplicationUpdate}>{$t(applicationUpdateBusy === "apply" ? "applicationUpdate.applying" : "common.update")}</button>{/if}
      <span class="application-update-detail">{#if applicationUpdate.updateAvailable && applicationUpdate.blockers.length}<small class="runtime-notice">{$t("applicationUpdate.blocked", { count: applicationUpdate.blockers.length })}</small>{/if}{#if applicationUpdate.updateAvailable}<small>{$t("applicationUpdate.snapshotRestart")}</small>{:else if applicationUpdate.reason === "source-checkout-not-updatable"}<small>{$t("applicationUpdate.sourceCheckout")}</small>{/if}{#if applicationUpdate.recentAttempts[0]}<small>{$t("applicationUpdate.recent", { source: applicationUpdate.recentAttempts[0].sourceVersion, target: applicationUpdate.recentAttempts[0].targetVersion, state: applicationUpdate.recentAttempts[0].state })}</small>{/if}</span>
    </div>
  {/if}
  {#if applicationUpdateNotice}<p class="runtime-notice" aria-live="polite">{applicationUpdateNotice}</p>{/if}
</SettingsSection>

<SettingsSection title={$t("runtime.title")} description={$t("settings.system.runtimeSummary")}>
  <svelte:fragment slot="actions"><button type="button" disabled={Boolean(runtimeBusy)} onclick={checkUpdates}><RefreshCw size={14} class={runtimeBusy === "check" ? "spin" : ""}/>{$t(runtimeBusy === "check" ? "status.checking" : "runtime.checkUpdates")}</button></svelte:fragment>
  <div class="runtime-summary-list">
    {#each runtimeCards as item (item.provider)}
      <div class="runtime-summary-row">
        <button type="button" class="runtime-summary-open" onclick={() => onopenprovider(item.provider)}>
          <span class="provider-mark {item.provider}">{item.provider === "codex" ? "C" : item.provider === "claude" ? "Cl" : item.provider === "grok" ? "G" : item.provider === "antigravity" ? "Ag" : item.provider === "deepseek" ? "DS" : "OL"}</span>
          <span class="runtime-summary-copy"><strong>{item.name}</strong><small>{item.current ?? (item.management === "api" ? $t(item.configured ? "runtime.apiConfigured" : "runtime.apiMissing") : $t("common.unavailable"))}</small></span>
          <span class="runtime-badge" data-management={item.management}>{$t(item.management === "managed" ? "runtime.badge.managed" : item.management === "external" ? "runtime.badge.external" : "runtime.badge.api")}</span>
        </button>
        {#if item.updateAvailable && item.canUpdate}<button type="button" class="runtime-update" disabled={Boolean(runtimeBusy)} onclick={() => updateRuntime(item.provider as "codex" | "claude")}>{$t(runtimeBusy === item.provider ? "runtime.updatingShort" : "common.update")}</button>{/if}
      </div>
    {/each}
  </div>
  {#if runtimeNotice}<p class="runtime-notice" aria-live="polite">{runtimeNotice}</p>{/if}
</SettingsSection>
