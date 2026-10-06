<script lang="ts">
  // 에이전트 › <provider>. One page per agent with a status header and five
  // tabs: execution defaults, account & connection, character, runtime, and
  // delegation. It merges what used to live in 계정 › 공급자 연결,
  // 실행 기본값 › <provider>, 대화·캐릭터 › <provider>, and 시스템 › 런타임.
  import { CircleAlert, RefreshCw } from "@lucide/svelte";
  import { formatDateTime, locale, t } from "../i18n";
  import { providerDisplayName } from "../provider-display";
  import { modelLabel } from "../session-ui";
  import ModelPicker from "../ModelPicker.svelte";
  import { TONE_PRESETS, type CharacterSettings } from "../character-settings";
  import { isClaudeCatalogFallback, type ClaudeCatalogMeta } from "../claude-model-filter";
  import type { GlobalModelEntry, GlobalModelSettings } from "../global-model-shape";
  import type { AutomationLevel } from "../automation-level";
  import type { WorkMode } from "../work-mode";
  import WorkModeChips from "../WorkModeChips.svelte";
  import AutomationLevelChips from "../AutomationLevelChips.svelte";
  import SettingRow from "../ui/SettingRow.svelte";
  import AvatarOutfitPicker from "../AvatarOutfitPicker.svelte";
  import Switch from "../ui/Switch.svelte";
  import SettingsSection from "./SettingsSection.svelte";
  import ProviderConnectionCard from "./ProviderConnectionCard.svelte";
  import { PROVIDER_TABS, type ProviderTab } from "./settings-nav";

  type ProviderId = "codex" | "claude" | "deepseek" | "ollama" | "antigravity" | "grok";
  type CompatibleProvider = "antigravity" | "deepseek" | "ollama" | "grok";
  type ConnectionAuthProvider = "codex" | "claude" | "antigravity" | "grok";
  type ProviderAccount = { provider: ProviderId; state: "unavailable" | "disconnected" | "unknown" | "connected"; accountType: string | null; planType: string | null; emailMasked: string | null; errorCategory: string | null; checkedAt: string };
  type RuntimeStatus = { provider: ProviderId; name: string; current: string | null; latest: string | null; updateAvailable: boolean | null; managed: boolean; source: string; checkedAt: string | null; canUpdate: boolean; checksum: string | null; checksumSource?: "package" | "binary" | null; fault?: string | null; management: "managed" | "external" | "api"; dependsOn: "codex" | "claude" | null; configured: boolean | null };
  type AntigravityExecutionSettings = { version: 1; backend: "consumer" | "vertex" | "vertex-agent"; vertex: { projectId: string; location: string; credentialsPath: string; creditsUrl: string } };
  type GeminiCliReadiness = { installed: boolean; source: string | null; version: string | null; ripgrep: boolean; projectId: string; location: string; credentials: string };
  type DelegationSettings = { version: 3; claude: { launchMode: "managed" | "direct"; model: string; reasoningEffort: string }; codex: { launchMode: "managed" | "direct"; model: string | null; reasoningEffort: string | null; serviceTier: "priority" | null } } & Record<CompatibleProvider, { launchMode: "managed"; model: string | null; reasoningEffort: string | null }>;

  export let provider: ProviderId;
  export let tab: ProviderTab = "defaults";
  // Header.
  export let account: ProviderAccount | undefined = undefined;
  export let providerAccountsLoading = false;
  export let runtime: RuntimeStatus | undefined = undefined;
  export let planLabel: (account: ProviderAccount | undefined) => string;
  export let accountStatusLabel: (provider: ConnectionAuthProvider, attempt: any, account: ProviderAccount | undefined) => string;
  export let runningAttempt: any = null;
  export let onreconnect: (provider: ProviderId) => void;
  export let onrefreshaccounts: () => void = () => {};
  // Defaults tab — shared.
  export let globalModelSettings: GlobalModelSettings;
  export let globalModelCandidates: Record<ProviderId, GlobalModelEntry[]>;
  export let toggleGlobalModel: (provider: ProviderId, item: GlobalModelEntry) => void;
  export let dangerAcknowledged = false;
  export let dangerConfirmed = false;
  export let recordDangerAcknowledgement: () => void;
  export let chooseGlobalWorkMode: (provider: ProviderId, mode: WorkMode) => void;
  export let chooseGlobalAutomation: (provider: ProviderId, level: AutomationLevel) => void;
  // Defaults tab — Codex.
  export let globalCodexWorkMode: WorkMode = "default";
  export let globalCodexModel = "";
  export let globalCodexEffort = "";
  export let globalCodexTier: string | null = null;
  export let globalCodexAutomation: AutomationLevel = "auto";
  export let codexModels: any[] = [];
  export let codexModelInfo: any = null;
  export let globalCodexModelChanged: () => void = () => {};
  export let refreshCodexModelCatalog: () => void = () => {};
  export let codexCatalogRefreshing = false;
  // Defaults tab — Claude.
  export let globalClaudeWorkMode: WorkMode = "default";
  export let globalClaudeModel = "";
  export let globalClaudeEffort = "medium";
  export let globalClaudeAutomation: AutomationLevel = "read";
  export let claudeModels: Array<{ id: string; displayName: string }> = [];
  export let claudeEfforts: Array<{ id: string; displayName: string }> = [];
  export let claudeSwitchModelsOnFlag = true;
  export let claudeExecutionLoading = false;
  export let refreshClaudeModelCatalog: () => void = () => {};
  export let claudeCatalogRefreshing = false;
  export let claudeCatalogMeta: ClaudeCatalogMeta | null = null;
  // Defaults tab — compatible providers.
  export let globalCompatibleModels: Record<CompatibleProvider, string>;
  export let globalCompatibleEfforts: Record<CompatibleProvider, string>;
  export let globalCompatibleWorkModes: Record<CompatibleProvider, WorkMode>;
  export let globalCompatibleAutomation: Record<CompatibleProvider, AutomationLevel>;
  export let compatibleModels: Array<{ id: string; displayName: string }> = [];
  export let compatibleEfforts: Array<{ id: string; displayName: string }> = [];
  export let refreshCompatibleModelCatalog: (provider: CompatibleProvider) => void = () => {};
  export let providerCatalogRefreshing: Partial<Record<ProviderId, boolean>> = {};
  // Custom model row (Codex / Claude).
  export let customModelDraft: Record<"claude" | "codex", { id: string; displayName: string }>;
  export let modelValidation: Partial<Record<"claude" | "codex", { busy: boolean; valid?: boolean; detail?: string }>> = {};
  export let addCustomModel: (provider: "codex" | "claude") => void = () => {};
  export let validateCustomModel: (provider: "codex" | "claude") => void = () => {};
  // Antigravity execution backend.
  export let antigravityExecution: AntigravityExecutionSettings;
  export let antigravityUsesVertex = false;
  export let antigravityExecutionLoading = false;
  export let antigravityExecutionTesting = false;
  export let antigravityCredentialUploading = false;
  export let antigravityExecutionNotice = "";
  export let antigravityCredentialNotice = "";
  export let geminiCliReadiness: GeminiCliReadiness | null = null;
  export let testAntigravityExecution: () => void = () => {};
  export let uploadAntigravityCredentials: (event: Event) => void = () => {};
  // Account tab.
  export let authAttempts: Record<string, any> = {};
  export let authCodes: Record<string, string> = {};
  export let authFeedback: Record<string, any> = {};
  export let providerName: (provider: ConnectionAuthProvider) => string;
  export let authErrorLabel: (category: string | null | undefined) => string;
  export let startProviderLogin: (provider: ConnectionAuthProvider, method: any) => void;
  export let submitAuthCode: (provider: "claude" | "antigravity") => void;
  export let cancelProviderLogin: (provider: ConnectionAuthProvider) => void;
  export let logoutProvider: (provider: ConnectionAuthProvider) => void;
  export let copy: (value: string | null) => void;
  export let onauthcode: (provider: ConnectionAuthProvider, value: string) => void;
  export let compatibleProviderSettings: Record<"deepseek" | "ollama", any>;
  export let compatibleProviderSecrets: Record<"deepseek" | "ollama", string>;
  export let compatibleProviderSaving: "deepseek" | "ollama" | null = null;
  export let updateCompatibleBaseUrl: (provider: "deepseek" | "ollama", baseUrl: string) => void;
  export let updateCompatibleSecret: (provider: "deepseek" | "ollama", secret: string) => void;
  export let saveCompatibleProvider: (provider: "deepseek" | "ollama") => void;
  export let loadProviderAccounts: () => void;
  export let providerAuthNotice = "";
  // Character tab.
  export let characterSettings: CharacterSettings;
  export let updateCharacter: (provider: ProviderId, patch: Partial<CharacterSettings["providers"]["codex"]>) => void;
  export let providerOutfits: Record<ProviderId, string[]>;
  export let charactersLoading = false;
  export let charactersLoaded = false;
  // Runtime tab.
  export let runtimeAutoUpdate: { version: 1; providers: Record<"codex" | "claude", boolean> };
  export let runtimeBusy: "check" | "codex" | "claude" | null = null;
  export let runtimeSettingsBusy: "codex" | "claude" | null = null;
  export let runtimeNotice = "";
  export let checkUpdates: () => void;
  export let updateRuntime: (provider: "codex" | "claude") => void;
  export let toggleRuntimeAutoUpdate: (provider: "codex" | "claude", enabled: boolean) => void;
  // Delegation tab.
  export let delegationSettings: DelegationSettings;
  export let delegationLoading = false;

  const isCompatible = (value: ProviderId): value is CompatibleProvider => value !== "codex" && value !== "claude";
  const isAuthProvider = (value: ProviderId): value is ConnectionAuthProvider => value === "codex" || value === "claude" || value === "antigravity" || value === "grok";
  const markText: Record<ProviderId, string> = { codex: "C", claude: "Cl", grok: "G", antigravity: "Ag", deepseek: "DS", ollama: "OL" };
  $: name = providerDisplayName(provider);
  $: character = characterSettings.providers[provider];
  $: currentAutomation = provider === "codex" ? globalCodexAutomation : provider === "claude" ? globalClaudeAutomation : globalCompatibleAutomation[provider as CompatibleProvider];
  $: connectionState = account?.state ?? "unknown";
  $: connectionText = isAuthProvider(provider)
    ? accountStatusLabel(provider, runningAttempt, account)
    : $t(connectionState === "connected" ? "status.connected" : connectionState === "unavailable" ? "auth.runtimeUnavailable" : "auth.connectionRequired");
  $: runtimeText = runtime?.current ? $t("settings.provider.runtimeVersion", { version: runtime.current }) : runtime?.management === "api" ? $t("settings.provider.apiProvider") : $t("settings.provider.runtimeUnknown");
  $: showDangerAcknowledge = currentAutomation === "full" && !dangerAcknowledged;
  const tabLabel = (value: ProviderTab) => $t(`settings.providerTab.${value}`);
</script>

<header class="provider-page-head">
  <span class="provider-mark provider-mark-lg {provider}" aria-hidden="true">{markText[provider]}</span>
  <div class="provider-page-copy">
    <h3>{name}</h3>
    <p class="provider-page-meta">
      {#if planLabel(account)}<span>{planLabel(account)}</span>{/if}
      {#if account?.emailMasked}<span>{account.emailMasked}</span>{/if}
      <span>{runtimeText}</span>
    </p>
    <p class="provider-page-status">
      <i class="settings-provider-dot state-{connectionState}" aria-hidden="true"></i>
      <span class:err-text={connectionState === "disconnected" || connectionState === "unavailable"}>{providerAccountsLoading && !account ? $t("status.checking") : connectionText}</span>
    </p>
  </div>
  <div class="provider-page-actions">
    {#if isAuthProvider(provider) && !runningAttempt && !(provider === "antigravity" && antigravityUsesVertex)}
      <button type="button" class="ui-btn" onclick={() => onreconnect(provider)}><RefreshCw size={14}/>{$t(account?.state === "connected" ? "settings.provider.reconnect" : "auth.connectionRequired")}</button>
    {/if}
  </div>
</header>
<p class="settings-page-body">{$t("settings.provider.pageBody", { name })}</p>

<nav class="settings-subtabs provider-tabs" aria-label={$t("settings.title")}>
  {#each PROVIDER_TABS as item}<button type="button" class:active={tab === item} aria-current={tab === item ? "page" : undefined} onclick={() => tab = item}>{tabLabel(item)}</button>{/each}
</nav>

{#if tab === "defaults"}
  <SettingsSection title={provider === "codex" ? $t("model.codexDefaults") : provider === "claude" ? $t("model.claudeDefaults") : $t("model.providerDefaults", { provider: name })}>
    {#if provider === "codex"}
      <SettingRow label={$t("workMode.label")} stacked><WorkModeChips provider="codex" value={globalCodexWorkMode} onchange={(mode) => chooseGlobalWorkMode("codex", mode)}/></SettingRow>
      <SettingRow label={$t("model.label")} stacked>{#if codexModels.length}<ModelPicker fields={["model","effort","tier"]} layout="stack" provider="codex" models={codexModels} efforts={codexModelInfo?.supportedReasoningEfforts ?? []} hasPriority={Boolean(codexModelInfo?.serviceTiers?.some((item: any) => item.id === "priority"))} bind:model={globalCodexModel} bind:effort={globalCodexEffort} bind:tier={globalCodexTier} idPrefix="defaults-codex" onmodel={() => globalCodexModelChanged()}/>{:else}<small class="field-warning">{$t("model.saveGlobalCodex")}</small>{/if}</SettingRow>
      <SettingRow label={$t("automation.level")} stacked><AutomationLevelChips provider="codex" value={globalCodexAutomation} onchange={(level) => chooseGlobalAutomation("codex", level)}/></SettingRow>
    {:else if provider === "claude"}
      <SettingRow label={$t("workMode.label")} stacked><WorkModeChips provider="claude" value={globalClaudeWorkMode} onchange={(mode) => chooseGlobalWorkMode("claude", mode)}/></SettingRow>
      <ModelPicker fields={["model","effort"]} layout="stack" provider="claude" models={claudeModels} efforts={claudeEfforts} bind:model={globalClaudeModel} bind:effort={globalClaudeEffort} idPrefix="defaults-claude"/>
      <SettingRow label={$t("automation.level")} stacked><AutomationLevelChips provider="claude" value={globalClaudeAutomation} onchange={(level) => chooseGlobalAutomation("claude", level)}/></SettingRow>
      <SettingRow label={$t("claudeExecution.switchModelsOnFlag")} help={$t("claudeExecution.switchModelsOnFlagBody")}><Switch bind:checked={claudeSwitchModelsOnFlag} disabled={claudeExecutionLoading} label={$t("claudeExecution.switchModelsOnFlag")}/></SettingRow>
      <p class="settings-note warn-text"><CircleAlert size={14}/>{$t("claudeExecution.nextTurnNote")}</p>
    {:else if isCompatible(provider)}
      {@const compatible = provider}
      <SettingRow label={$t("workMode.label")} stacked><WorkModeChips provider={compatible} value={globalCompatibleWorkModes[compatible]} onchange={(mode) => chooseGlobalWorkMode(compatible, mode)}/></SettingRow>
      <ModelPicker fields={["model","effort"]} layout="stack" provider={compatible} models={compatibleModels} efforts={compatibleEfforts} model={globalCompatibleModels[compatible]} effort={globalCompatibleEfforts[compatible]} idPrefix={`defaults-${compatible}`} onmodel={(value) => globalCompatibleModels = { ...globalCompatibleModels, [compatible]: value }} oneffort={(value) => globalCompatibleEfforts = { ...globalCompatibleEfforts, [compatible]: value }}/>
      <SettingRow label={$t("automation.level")} stacked><AutomationLevelChips provider={compatible} value={globalCompatibleAutomation[compatible]} onchange={(level) => chooseGlobalAutomation(compatible, level)}/></SettingRow>
    {/if}
    {#if showDangerAcknowledge}<label class="danger-confirm"><input type="checkbox" bind:checked={dangerConfirmed} onchange={() => dangerConfirmed && recordDangerAcknowledgement()}/>{$t("permission.fullAutoRiskAcknowledge")}</label>{/if}
  </SettingsSection>

  {#if provider === "antigravity"}
    <SettingsSection title={$t("antigravityExecution.backend")} description={$t("antigravityExecution.body")}>
      <section class="antigravity-execution-setting">
        <div class="segments three"><button type="button" class:active={antigravityExecution.backend === "consumer"} onclick={() => antigravityExecution = { ...antigravityExecution, backend: "consumer" }}>{$t("antigravityExecution.consumer")}</button><button type="button" class:active={antigravityExecution.backend === "vertex"} onclick={() => antigravityExecution = { ...antigravityExecution, backend: "vertex" }}>{$t("antigravityExecution.vertex")}</button><button type="button" class:active={antigravityExecution.backend === "vertex-agent"} onclick={() => antigravityExecution = { ...antigravityExecution, backend: "vertex-agent" }}>{$t("antigravityExecution.vertexAgent")}</button></div>
        <p class="field-help">{$t(antigravityExecution.backend === "vertex-agent" ? "antigravityExecution.vertexAgentBody" : antigravityExecution.backend === "vertex" ? "antigravityExecution.vertexBody" : "antigravityExecution.consumerBody")}</p>
        {#if antigravityUsesVertex}
          <label>{$t("antigravityExecution.project")}<input bind:value={antigravityExecution.vertex.projectId} autocomplete="off" placeholder={$t("antigravityExecution.projectPlaceholder")}/></label>
          <label>{$t("antigravityExecution.location")}<input bind:value={antigravityExecution.vertex.location} autocomplete="off" placeholder={$t("antigravityExecution.locationPlaceholder")}/></label>
          <label>{$t("antigravityExecution.creditsUrl")}<input type="url" bind:value={antigravityExecution.vertex.creditsUrl} autocomplete="off" placeholder={$t("antigravityExecution.creditsUrlPlaceholder")}/><small>{$t("antigravityExecution.creditsUrlHelp")}</small></label>
          <div class="vertex-credential-upload"><span><strong>{$t("antigravityExecution.credentialsUpload")}</strong><small>{antigravityExecution.vertex.credentialsPath ? $t("antigravityExecution.credentialsConfigured") : $t("antigravityExecution.credentialsHelp")}</small></span><label class="credential-upload-button">{antigravityCredentialUploading ? $t("antigravityExecution.credentialsUploading") : $t(antigravityExecution.vertex.credentialsPath ? "antigravityExecution.credentialsReplace" : "antigravityExecution.credentialsChoose")}<input type="file" disabled={antigravityCredentialUploading} onchange={uploadAntigravityCredentials}/></label></div>
          {#if antigravityCredentialNotice}<p class="credential-upload-notice">{antigravityCredentialNotice}</p>{/if}
        {/if}
        {#if antigravityExecution.backend === "vertex-agent" && geminiCliReadiness}
          <p class="field-help">{$t("antigravityExecution.geminiCliStatus", { state: $t(geminiCliReadiness.installed ? "antigravityExecution.geminiCliReady" : "antigravityExecution.geminiCliMissing"), version: geminiCliReadiness.version ?? "?" })}<br/>{$t("antigravityExecution.geminiCliScope", { project: geminiCliReadiness.projectId || "?", location: geminiCliReadiness.location || "?" })}{#if !geminiCliReadiness.ripgrep}<br/>{$t("antigravityExecution.geminiCliRipgrep")}{/if}{#if !geminiCliReadiness.installed}<br/>{$t("antigravityExecution.geminiCliInstall")}{/if}</p>
        {/if}
        <div class="provider-auth-actions"><button type="button" disabled={antigravityExecutionLoading || antigravityExecutionTesting} onclick={testAntigravityExecution}>{$t(antigravityExecutionTesting ? "antigravityExecution.testing" : "antigravityExecution.applyTest")}</button></div>
        {#if antigravityExecutionNotice}<p>{antigravityExecutionNotice}</p>{/if}
      </section>
    </SettingsSection>
  {/if}

  <SettingsSection title={provider === "codex" ? $t("model.codexModels") : provider === "claude" ? $t("model.claudeModels") : $t("model.providerModels", { provider: name })} description={$t("settings.provider.modelListNote")}>
    <svelte:fragment slot="actions">
      {#if provider === "codex"}<button type="button" disabled={codexCatalogRefreshing} onclick={refreshCodexModelCatalog}><RefreshCw size={14} class={codexCatalogRefreshing ? "spin" : ""}/>{$t(codexCatalogRefreshing ? "model.loading" : "model.load")}</button>
      {:else if provider === "claude"}<button type="button" disabled={claudeCatalogRefreshing} onclick={refreshClaudeModelCatalog}><RefreshCw size={14} class={claudeCatalogRefreshing ? "spin" : ""}/>{$t(claudeCatalogRefreshing ? "model.loading" : "model.load")}</button>
      {:else if isCompatible(provider)}{@const compatible = provider}<button type="button" disabled={providerCatalogRefreshing[compatible]} onclick={() => refreshCompatibleModelCatalog(compatible)}><RefreshCw size={14} class={providerCatalogRefreshing[compatible] ? "spin" : ""}/>{$t(providerCatalogRefreshing[compatible] ? "model.loading" : "model.load")}</button>{/if}
    </svelte:fragment>
    <div class="delegation-model-options">{#each globalModelCandidates[provider] as model}<label title={model.id}><input type="checkbox" checked={globalModelSettings[provider].models.some(item => item.id === model.id)} disabled={globalModelSettings[provider].models.length === 1 && globalModelSettings[provider].models.some(item => item.id === model.id)} onchange={() => toggleGlobalModel(provider, model)}/><span><strong>{modelLabel(model)}</strong><small>{model.source === "custom" ? $t(model.validatedAt ? "model.customValidated" : "model.custom") : provider === "codex" ? $t("model.codexRuntime") : provider === "claude" ? $t("model.claudeRuntime") : $t("model.providerRuntime", { provider: name })}</small></span></label>{/each}</div>
    {#if provider === "codex" || provider === "claude"}
      {@const draft = customModelDraft[provider]}
      <div class="custom-model-row"><input aria-label={$t(provider === "codex" ? "model.codexCustomId" : "model.claudeCustomId")} placeholder={provider === "codex" ? $t("model.customId") : "claude-opus-4-6[1m]"} value={draft.id} oninput={(event) => customModelDraft = { ...customModelDraft, [provider]: { ...draft, id: (event.currentTarget as HTMLInputElement).value } }}/><input aria-label={$t(provider === "codex" ? "model.codexDisplayName" : "model.claudeDisplayName")} placeholder={provider === "codex" ? $t("model.displayNameOptional") : "Opus 4.6 (1M)"} value={draft.displayName} oninput={(event) => customModelDraft = { ...customModelDraft, [provider]: { ...draft, displayName: (event.currentTarget as HTMLInputElement).value } }}/><button type="button" onclick={() => addCustomModel(provider)}>{$t("common.add")}</button><button type="button" disabled={modelValidation[provider]?.busy || !draft.id.trim()} onclick={() => validateCustomModel(provider)}>{$t(modelValidation[provider]?.busy ? "model.validating" : "model.validate")}</button></div>
      {#if modelValidation[provider]?.detail}<small class:validation-ok={modelValidation[provider]?.valid} class:validation-error={modelValidation[provider]?.valid === false}>{modelValidation[provider]?.detail}</small>{/if}
      {#if provider === "claude" && claudeCatalogMeta}<small class="catalog-state" class:stale={claudeCatalogMeta.stale === true}>{isClaudeCatalogFallback(claudeCatalogMeta) ? $t("model.catalogFallbackFilteredState") : claudeCatalogMeta.stale ? "Cached" : "Claude Code"}{claudeCatalogMeta.fetchedAt ? ` · ${formatDateTime(claudeCatalogMeta.fetchedAt, $locale)}` : ""}</small>{/if}
    {/if}
  </SettingsSection>

{:else if tab === "account"}
  <SettingsSection title={$t("settings.providerTab.account")}>
    <svelte:fragment slot="actions"><button type="button" disabled={providerAccountsLoading} onclick={onrefreshaccounts}><RefreshCw size={14} class={providerAccountsLoading ? "spin" : ""}/>{$t(providerAccountsLoading ? "status.checking" : "common.refreshStatus")}</button></svelte:fragment>
    <div class="provider-connections single">
      <ProviderConnectionCard {provider} {account} {providerAccountsLoading} attempt={authAttempts[provider]} {runningAttempt} feedback={authFeedback[provider]} authCode={authCodes[provider] ?? ""} {antigravityUsesVertex} {providerName} {accountStatusLabel} {planLabel} {authErrorLabel} {startProviderLogin} {submitAuthCode} {cancelProviderLogin} {logoutProvider} {copy} {onauthcode}
        compatibleSettings={provider === "deepseek" || provider === "ollama" ? compatibleProviderSettings[provider] : undefined} compatibleSecret={provider === "deepseek" || provider === "ollama" ? compatibleProviderSecrets[provider] : ""} {compatibleProviderSaving} {updateCompatibleBaseUrl} {updateCompatibleSecret} {saveCompatibleProvider} {loadProviderAccounts}/>
    </div>
    <p class="provider-scope-notice">{$t("provider.connectionScope")}</p>
    {#if providerAuthNotice}<p class="runtime-notice" aria-live="polite">{providerAuthNotice}</p>{/if}
  </SettingsSection>

{:else if tab === "character"}
  <SettingsSection title={$t("settings.providerTab.character")} description={$t("character.scopeBody")}>
    {#if charactersLoading && !charactersLoaded}<p class="provider-waiting">{$t("character.loading")}</p>{/if}
    <SettingRow label={$t("character.nickname")} id="character-nickname"><input id="character-nickname" value={character.nickname} maxlength="30" oninput={(event) => updateCharacter(provider, { nickname: (event.currentTarget as HTMLInputElement).value })}/></SettingRow>
    <SettingRow label={$t("character.toneLabel")}><select aria-label={$t("character.toneLabel")} value={character.tonePreset} onchange={(event) => updateCharacter(provider, { tonePreset: (event.currentTarget as HTMLSelectElement).value as any })}>{#each TONE_PRESETS as tone}<option value={tone.id}>{$t(`character.tone.${tone.id}`)}</option>{/each}</select></SettingRow>
    {#if character.tonePreset === "custom"}<SettingRow label={$t("character.customTone")} stacked><textarea rows="4" maxlength="2000" value={character.customTone} oninput={(event) => updateCharacter(provider, { customTone: (event.currentTarget as HTMLTextAreaElement).value })}></textarea></SettingRow>{/if}
    <SettingRow label={$t("character.conversationOnly")} help={$t("character.conversationOnlyBody")}><Switch checked={character.conversationOnly} label={$t("character.conversationOnly")} onchange={(checked) => updateCharacter(provider, { conversationOnly: checked })}/></SettingRow>
    {#if characterSettings.avatarDisplay === "character"}
      <SettingRow label={$t("character.avatarOutfit")} help={$t("character.installedAssetsOnly")} stacked><AvatarOutfitPicker outfits={providerOutfits[provider]} value={character.avatarOutfit} onselect={(outfit) => updateCharacter(provider, { avatarOutfit: outfit })}/></SettingRow>
    {/if}
    <SettingRow label={$t("character.emotionIntensity")}><select aria-label={$t("character.emotionIntensity")} value={character.emotionIntensity} onchange={(event) => updateCharacter(provider, { emotionIntensity: (event.currentTarget as HTMLSelectElement).value as any })}><option value="subtle">{$t("character.emotion.subtle")}</option><option value="natural">{$t("character.emotion.natural")}</option><option value="expressive">{$t("character.emotion.expressive")}</option></select></SettingRow>
  </SettingsSection>

{:else if tab === "runtime"}
  <SettingsSection title={$t("runtime.title")} description={$t("runtime.independentInstall")}>
    <svelte:fragment slot="actions"><button type="button" disabled={Boolean(runtimeBusy)} onclick={checkUpdates}><RefreshCw size={14} class={runtimeBusy === "check" ? "spin" : ""}/>{$t(runtimeBusy === "check" ? "status.checking" : "runtime.checkUpdates")}</button></svelte:fragment>
    {#if runtime}
      {@const item = runtime}
      <div class="runtime-card" class:verified={item.managed}>
        <span>
          <strong>{item.name} {item.current ?? $t("common.unavailable")}</strong>
          {#if item.management === "managed"}
            <small>{item.updateAvailable === true ? $t("runtime.latest", { version: item.latest ?? $t("common.unavailable") }) : $t(item.updateAvailable === false ? "runtime.latestVersion" : item.source?.includes("check-failed") ? "runtime.checkFailed" : item.managed ? "runtime.managedOfficial" : "runtime.managementUnknown")}</small>
          {:else if item.management === "external"}
            <small>{$t(item.current ? "runtime.externalInstalled" : item.configured ? "runtime.externalVersionUnavailable" : "runtime.externalMissing")}</small>
          {:else}
            <small>{$t(item.configured ? "runtime.apiConfigured" : "runtime.apiMissing")}</small>
          {/if}
        </span>
        <span class="runtime-badge" data-management={item.management}>{$t(item.management === "managed" ? "runtime.badge.managed" : item.management === "external" ? "runtime.badge.external" : "runtime.badge.api")}</span>
        {#if item.checksum}<code title={item.checksum}>{item.checksumSource === "binary" ? "BIN SHA" : "SHA"} {item.checksum.slice(0, 12)}</code>{/if}
        {#if item.fault}<small class="runtime-fault">{item.fault}</small>{/if}
        {#if item.management === "managed"}
          <label class="runtime-auto-toggle"><span><strong>{$t("runtime.autoUpdate")}</strong><small>{$t(item.canUpdate ? "runtime.autoUpdateBody" : "runtime.autoUpdateUnavailable")}</small></span><input type="checkbox" checked={runtimeAutoUpdate.providers[item.provider as "codex" | "claude"]} disabled={!item.canUpdate || Boolean(runtimeSettingsBusy)} onchange={(event) => toggleRuntimeAutoUpdate(item.provider as "codex" | "claude", (event.currentTarget as HTMLInputElement).checked)}/></label>
          {#if item.updateAvailable}<button type="button" class="runtime-update" disabled={Boolean(runtimeBusy)} onclick={() => updateRuntime(item.provider as "codex" | "claude")}>{$t(runtimeBusy === item.provider ? "runtime.updatingShort" : "common.update")}</button>{/if}
        {:else}
          <small class="runtime-unmanaged">{$t(item.management === "external" ? "runtime.externalBody" : "runtime.apiBody")}</small>
        {/if}
      </div>
    {/if}
    {#if runtimeNotice}<p class="runtime-notice" aria-live="polite">{runtimeNotice}</p>{/if}
  </SettingsSection>

{:else if tab === "delegation"}
  <SettingsSection title={$t("settings.providerTab.delegation")} description={$t("delegation.body")}>
    {#if provider === "claude"}
      <section class="delegation-card">
        <h4>Codex → Claude</h4>
        <SettingRow label={$t("delegation.launchMode")}><div class="segments"><button type="button" disabled={delegationLoading} class:active={delegationSettings.claude.launchMode === "managed"} onclick={() => delegationSettings = { ...delegationSettings, claude: { ...delegationSettings.claude, launchMode: "managed" } }}>{$t("delegation.managed")}</button><button type="button" disabled={delegationLoading} class:active={delegationSettings.claude.launchMode === "direct"} onclick={() => delegationSettings = { ...delegationSettings, claude: { ...delegationSettings.claude, launchMode: "direct" } }}>{$t("delegation.directCli")}</button></div></SettingRow>
        <p class="settings-note">{$t("settings.provider.delegationCompatible", { name })}<br/><strong>{globalClaudeModel} · {globalClaudeEffort}</strong></p>
        <small class="field-help">{$t("delegation.managedBody")}</small>
      </section>
    {:else if provider === "codex"}
      <section class="delegation-card">
        <h4>Claude → Codex</h4>
        <SettingRow label={$t("delegation.launchMode")}><div class="segments"><button type="button" disabled={delegationLoading} class:active={delegationSettings.codex.launchMode === "managed"} onclick={() => delegationSettings = { ...delegationSettings, codex: { ...delegationSettings.codex, launchMode: "managed" } }}>{$t("delegation.managed")}</button><button type="button" disabled={delegationLoading} class:active={delegationSettings.codex.launchMode === "direct"} onclick={() => delegationSettings = { ...delegationSettings, codex: { ...delegationSettings.codex, launchMode: "direct" } }}>{$t("delegation.directCli")}</button></div></SettingRow>
        <p class="settings-note">{$t("settings.provider.delegationCompatible", { name })}<br/><strong>{globalCodexModel} · {globalCodexEffort} · {$t(globalCodexTier === "priority" ? "model.fast" : "model.standard")}</strong></p>
        <small class="field-help">{$t("delegation.codexBody")}</small>
      </section>
    {:else}
      <p class="settings-note">{$t("settings.provider.delegationCompatible", { name })}</p>
    {/if}
  </SettingsSection>
{/if}
