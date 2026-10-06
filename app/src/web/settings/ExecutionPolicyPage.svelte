<script lang="ts">
  // 에이전트 › 실행 정책. Global defaults only: default agent, its reasoning
  // effort and automation level, paid credits, and the delegation rules.
  // Per-agent model lists and other values live on each agent page.
  import { CircleAlert } from "@lucide/svelte";
  import { t } from "../i18n";
  import { providerDisplayName } from "../provider-display";
  import { effortLabel } from "../session-ui";
  import AutomationLevelChips from "../AutomationLevelChips.svelte";
  import type { AutomationLevel } from "../automation-level";
  import SettingRow from "../ui/SettingRow.svelte";
  import Switch from "../ui/Switch.svelte";
  import SettingsSection from "./SettingsSection.svelte";

  type ProviderId = "codex" | "claude" | "deepseek" | "ollama" | "antigravity" | "grok";
  type CompatibleProvider = "antigravity" | "deepseek" | "ollama" | "grok";
  type DelegationSettings = { version: 3; claude: { launchMode: "managed" | "direct"; model: string; reasoningEffort: string }; codex: { launchMode: "managed" | "direct"; model: string | null; reasoningEffort: string | null; serviceTier: "priority" | null } } & Record<CompatibleProvider, { launchMode: "managed"; model: string | null; reasoningEffort: string | null }>;

  export let providers: ProviderId[] = ["codex", "claude", "grok", "antigravity", "deepseek", "ollama"];
  export let globalDefaultProvider: ProviderId = "codex";
  export let allowPaidCredits = false;
  export let creditUsageLoading = false;
  // Effort and automation of the default agent. The page edits the same
  // per-provider values the agent pages own, scoped to the chosen default.
  export let globalCodexModel = "";
  export let globalClaudeModel = "";
  export let globalCodexTier:string|null = null;
  export let globalCodexEffort = "";
  export let globalClaudeEffort = "medium";
  export let globalCompatibleEfforts: Record<CompatibleProvider, string>;
  export let globalCodexAutomation: AutomationLevel = "auto";
  export let globalClaudeAutomation: AutomationLevel = "read";
  export let globalCompatibleAutomation: Record<CompatibleProvider, AutomationLevel>;
  export let codexEfforts: Array<{ reasoningEffort: string }> = [];
  export let claudeEfforts: Array<{ id: string; displayName: string }> = [];
  export let compatibleEffortOptions: (provider: CompatibleProvider) => Array<{ id: string; displayName: string }>;
  export let chooseGlobalAutomation: (provider: ProviderId, level: AutomationLevel) => void;
  export let dangerAcknowledged = false;
  export let dangerConfirmed = false;
  export let recordDangerAcknowledgement: () => void;
  // Delegation rules.
  export let delegationSettings: DelegationSettings;
  export let delegationLoading = false;
  export let delegationLoaded = false;

  const isCompatible = (provider: ProviderId): provider is CompatibleProvider => provider !== "codex" && provider !== "claude";
  $: defaultAutomation = globalDefaultProvider === "codex" ? globalCodexAutomation : globalDefaultProvider === "claude" ? globalClaudeAutomation : globalCompatibleAutomation[globalDefaultProvider as CompatibleProvider];
  function setDefaultEffort(value: string) {
    if (globalDefaultProvider === "codex") globalCodexEffort = value;
    else if (globalDefaultProvider === "claude") globalClaudeEffort = value;
    else globalCompatibleEfforts = { ...globalCompatibleEfforts, [globalDefaultProvider]: value };
  }
</script>

<p class="settings-page-body">{$t("settings.page.policy.body")}</p>

<SettingsSection title={$t("execution.defaults")}>
  <SettingRow label={$t("execution.defaultAgent")} stacked>
    <div class="segments provider-segments">{#each providers as provider}<button type="button" class:active={globalDefaultProvider === provider} onclick={() => globalDefaultProvider = provider}>{providerDisplayName(provider)}</button>{/each}</div>
  </SettingRow>
  <p class="settings-note">{$t("policy.defaultAgentNote", { name: providerDisplayName(globalDefaultProvider) })}</p>
  <SettingRow label={$t("policy.defaultEffort")}>
    {#if globalDefaultProvider === "codex"}
      <select aria-label={$t("policy.defaultEffort")} value={globalCodexEffort} onchange={(event) => setDefaultEffort((event.currentTarget as HTMLSelectElement).value)}>{#each codexEfforts as effort}<option value={effort.reasoningEffort}>{effortLabel(effort.reasoningEffort)}</option>{/each}</select>
    {:else if globalDefaultProvider === "claude"}
      <select aria-label={$t("policy.defaultEffort")} value={globalClaudeEffort} onchange={(event) => setDefaultEffort((event.currentTarget as HTMLSelectElement).value)}>{#each claudeEfforts as effort}<option value={effort.id}>{$t(`session.effort.${effort.id}`)}</option>{/each}</select>
    {:else if isCompatible(globalDefaultProvider)}
      <select aria-label={$t("policy.defaultEffort")} value={globalCompatibleEfforts[globalDefaultProvider]} onchange={(event) => setDefaultEffort((event.currentTarget as HTMLSelectElement).value)}>{#each compatibleEffortOptions(globalDefaultProvider) as effort}<option value={effort.id}>{$t(`session.effort.${effort.id}`)}</option>{/each}</select>
    {/if}
  </SettingRow>
  <SettingRow label={$t("policy.defaultAutomation")} stacked>
    <AutomationLevelChips provider={globalDefaultProvider} value={defaultAutomation} onchange={(level) => chooseGlobalAutomation(globalDefaultProvider, level)}/>
    {#if defaultAutomation === "full" && !dangerAcknowledged}<label class="danger-confirm"><input type="checkbox" bind:checked={dangerConfirmed} onchange={() => dangerConfirmed && recordDangerAcknowledgement()}/>{$t("permission.fullAutoRiskAcknowledge")}</label>{/if}
  </SettingRow>
  <SettingRow label={$t("billing.allowPaidCredits")} help={$t("billing.allowPaidCreditsBody")}><Switch bind:checked={allowPaidCredits} disabled={creditUsageLoading} label={$t("billing.allowPaidCredits")}/></SettingRow>
  <p class="settings-note warn-text"><CircleAlert size={14}/>{$t("billing.providerAccountNote")}</p>
</SettingsSection>

<SettingsSection title={$t("policy.delegationTitle")} description={$t("delegation.body")}>
  {#if delegationLoading && !delegationLoaded}<p class="provider-waiting">{$t("delegation.loading")}</p>{/if}
  <section class="delegation-card">
    <h4>Codex → Claude</h4>
    <SettingRow label={$t("delegation.launchMode")}>
      <div class="segments"><button type="button" disabled={delegationLoading} class:active={delegationSettings.claude.launchMode === "managed"} onclick={() => delegationSettings = { ...delegationSettings, claude: { ...delegationSettings.claude, launchMode: "managed" } }}>{$t("delegation.managed")}</button><button type="button" disabled={delegationLoading} class:active={delegationSettings.claude.launchMode === "direct"} onclick={() => delegationSettings = { ...delegationSettings, claude: { ...delegationSettings.claude, launchMode: "direct" } }}>{$t("delegation.directCli")}</button></div>
    </SettingRow>
    <p class="settings-note">{$t("settings.provider.delegationCompatible", { name: providerDisplayName("claude") })}<br/><strong>{globalClaudeModel} · {globalClaudeEffort}</strong></p>
    <small class="field-help">{$t("delegation.managedBody")}</small>
  </section>
  <section class="delegation-card">
    <h4>Claude → Codex</h4>
    <SettingRow label={$t("delegation.launchMode")}>
      <div class="segments"><button type="button" disabled={delegationLoading} class:active={delegationSettings.codex.launchMode === "managed"} onclick={() => delegationSettings = { ...delegationSettings, codex: { ...delegationSettings.codex, launchMode: "managed" } }}>{$t("delegation.managed")}</button><button type="button" disabled={delegationLoading} class:active={delegationSettings.codex.launchMode === "direct"} onclick={() => delegationSettings = { ...delegationSettings, codex: { ...delegationSettings.codex, launchMode: "direct" } }}>{$t("delegation.directCli")}</button></div>
    </SettingRow>
    <p class="settings-note">{$t("settings.provider.delegationCompatible", { name: providerDisplayName("codex") })}<br/><strong>{globalCodexModel} · {globalCodexEffort} · {$t(globalCodexTier === "priority" ? "model.fast" : "model.standard")}</strong></p>
    <small class="field-help">{$t("delegation.codexBody")}</small>
  </section>
</SettingsSection>
