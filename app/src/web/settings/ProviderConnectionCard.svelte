<script lang="ts">
  // The sign-in card for one agent. OAuth/device providers show their login
  // buttons and the running attempt; DeepSeek and Ollama show their API
  // address and secret form. Markup moved out of the old 계정 › 공급자 연결 tab.
  import { t } from "../i18n";
  import { providerDisplayName } from "../provider-display";

  type ProviderId = "codex" | "claude" | "deepseek" | "ollama" | "antigravity" | "grok";
  type ConnectionAuthProvider = "codex" | "claude" | "antigravity" | "grok";
  type ProviderAccount = { provider: ProviderId; state: "unavailable" | "disconnected" | "unknown" | "connected"; accountType: string | null; planType: string | null; emailMasked: string | null; errorCategory: string | null; checkedAt: string };
  type AuthAttempt = { provider: ConnectionAuthProvider; attemptId: string; method: string; state: "starting" | "waiting" | "code_required" | "verifying" | "completed" | "failed" | "cancelled" | "timeout"; createdAt: string; expiresAt: string; url: string | null; userCode: string | null; codeRequired: boolean; errorCategory: string | null; inputNonce?: string };
  type AuthFeedback = { tone: "info" | "success" | "error"; message: string };
  type CompatibleProviderUiSettings = { provider: "deepseek" | "ollama"; baseUrl: string; secretConfigured: boolean; secretSource: "workhouse" | "environment" | null };

  export let provider: ProviderId;
  export let account: ProviderAccount | undefined = undefined;
  export let providerAccountsLoading = false;
  export let attempt: AuthAttempt | undefined = undefined;
  export let runningAttempt: AuthAttempt | null = null;
  export let feedback: AuthFeedback | undefined = undefined;
  export let authCode = "";
  export let antigravityUsesVertex = false;
  export let providerName: (provider: ConnectionAuthProvider) => string;
  export let accountStatusLabel: (provider: ConnectionAuthProvider, attempt: AuthAttempt | null, account: ProviderAccount | undefined) => string;
  export let planLabel: (account: ProviderAccount | undefined) => string;
  export let authErrorLabel: (category: string | null | undefined) => string;
  export let startProviderLogin: (provider: ConnectionAuthProvider, method: "device" | "browser" | "subscription" | "console" | "sso" | "google-oauth" | "google-cloud") => void;
  export let submitAuthCode: (provider: "claude" | "antigravity") => void;
  export let cancelProviderLogin: (provider: ConnectionAuthProvider) => void;
  export let logoutProvider: (provider: ConnectionAuthProvider) => void;
  export let copy: (value: string | null) => void;
  export let onauthcode: (provider: ConnectionAuthProvider, value: string) => void = () => {};
  // API providers.
  export let compatibleSettings: CompatibleProviderUiSettings | undefined = undefined;
  export let compatibleSecret = "";
  export let compatibleProviderSaving: "deepseek" | "ollama" | null = null;
  export let updateCompatibleBaseUrl: (provider: "deepseek" | "ollama", baseUrl: string) => void = () => {};
  export let updateCompatibleSecret: (provider: "deepseek" | "ollama", secret: string) => void = () => {};
  export let saveCompatibleProvider: (provider: "deepseek" | "ollama") => void = () => {};
  export let loadProviderAccounts: () => void = () => {};

  const isAuth = (value: ProviderId): value is ConnectionAuthProvider => value === "codex" || value === "claude" || value === "antigravity" || value === "grok";
  const isApi = (value: ProviderId): value is "deepseek" | "ollama" => value === "deepseek" || value === "ollama";
</script>

{#if isAuth(provider)}
  {@const typedProvider = provider}
  <section class="provider-connection-card" class:connected={account?.state === "connected"}>
    <header><span class="provider-mark {typedProvider}">{typedProvider === "codex" ? "C" : typedProvider === "claude" ? "Cl" : typedProvider === "grok" ? "G" : "Ag"}</span><span><strong>{providerName(typedProvider)}</strong><small>{planLabel(account) || (typedProvider === "antigravity" ? $t("auth.antigravityCli") : typedProvider === "grok" ? $t("auth.grokCli") : "")}{account?.emailMasked ? ` · ${account.emailMasked}` : ""}</small></span><em class:connected={account?.state === "connected"} class:busy={Boolean(runningAttempt)}>{accountStatusLabel(typedProvider, runningAttempt, account)}</em></header>
    {#if typedProvider === "antigravity"}<p class="provider-scope-notice">{$t(antigravityUsesVertex ? "antigravityExecution.accountManaged" : "auth.antigravityConnectionBody")}</p>{/if}
    {#if runningAttempt}
      <div class="auth-progress" aria-live="polite">
        {#if runningAttempt.url}<a class="auth-open" href={runningAttempt.url} target="_blank" rel="noopener noreferrer">{$t(typedProvider === "codex" ? "auth.openOpenAI" : typedProvider === "antigravity" ? "auth.openGoogle" : typedProvider === "grok" ? "auth.openXai" : "auth.openAnthropic")}</a>{/if}
        {#if runningAttempt.userCode}<div class="device-code"><span><small>{$t("auth.oneTimeCode")}</small><code>{runningAttempt.userCode}</code></span><button type="button" onclick={() => copy(runningAttempt?.userCode ?? null)}>{$t("auth.copyCode")}</button></div>{/if}
        {#if (typedProvider === "claude" || typedProvider === "antigravity") && runningAttempt.state === "code_required"}
          <form class="auth-code-form" onsubmit={(event) => { event.preventDefault(); submitAuthCode(typedProvider); }}><label for={`${typedProvider}-auth-code`}>{$t(typedProvider === "antigravity" ? "auth.antigravityCode" : "auth.claudeCode")}</label><div><input id={`${typedProvider}-auth-code`} type="text" autocomplete="one-time-code" maxlength="512" value={authCode} oninput={(event) => onauthcode(typedProvider, (event.currentTarget as HTMLInputElement).value)} placeholder={$t("auth.officialPageCode")}/><button type="submit" disabled={!authCode.trim()}>{$t("auth.submitCode")}</button></div></form>
        {/if}
        <button type="button" class="auth-cancel" onclick={() => cancelProviderLogin(typedProvider)}>{$t("auth.cancelLogin")}</button>
      </div>
    {:else}
      <div class="provider-auth-actions">
        {#if typedProvider === "codex"}
          <button type="button" onclick={() => startProviderLogin("codex", "device")}>{$t(account?.state === "connected" ? "auth.reconnect" : "auth.connectCodex")}</button>
          <button type="button" onclick={() => startProviderLogin("codex", "browser")}>{$t("auth.browserLogin")}</button>
        {:else if typedProvider === "claude"}
          <button type="button" onclick={() => startProviderLogin("claude", "subscription")}>{$t("auth.connectClaudeSubscription")}</button>
          <button type="button" onclick={() => startProviderLogin("claude", "console")}>{$t("auth.connectConsole")}</button>
          <button type="button" onclick={() => startProviderLogin("claude", "sso")}>{$t("auth.connectSso")}</button>
        {:else if typedProvider === "grok"}
          <button type="button" onclick={() => startProviderLogin("grok", "device")}>{$t(account?.state === "connected" ? "auth.reconnect" : "auth.connectGrok")}</button>
        {:else if !antigravityUsesVertex}
          <button type="button" onclick={() => startProviderLogin("antigravity", "google-oauth")}>{$t(account?.state === "connected" ? "auth.reconnect" : "auth.connectAntigravity")}</button>
        {/if}
        {#if account?.state === "connected"}<button type="button" class="auth-logout" onclick={() => logoutProvider(typedProvider)}>{$t("auth.logout")}</button>{/if}
      </div>
    {/if}
    {#if feedback}<p class="auth-feedback {feedback.tone}" role="status" aria-live="polite">{feedback.message}</p>{/if}
    {#if attempt && ["failed", "timeout"].includes(attempt.state)}<p class="auth-error">{authErrorLabel(attempt.errorCategory)}</p>{/if}
  </section>
{:else if isApi(provider) && compatibleSettings}
  {@const typedProvider = provider}
  {@const settings = compatibleSettings}
  <section class="provider-connection-card" class:connected={account?.state === "connected"}>
    <header><span class="provider-mark {typedProvider}">{$t(typedProvider === "deepseek" ? "auth.deepseekMark" : "auth.ollamaMark")}</span><span><strong>{providerDisplayName(typedProvider)}</strong><small>{$t(typedProvider === "deepseek" ? "auth.deepseekApi" : "auth.ollamaRuntime")}</small></span><em class:connected={account?.state === "connected"} class:busy={providerAccountsLoading}>{$t(account?.state === "connected" ? "status.connected" : account?.state === "unavailable" ? "auth.runtimeUnavailable" : "auth.connectionRequired")}</em></header>
    <p class="provider-scope-notice">{$t(typedProvider === "deepseek" ? "auth.deepseekConnectionBody" : "auth.ollamaConnectionBody")}</p>
    <form class="compatible-provider-form" onsubmit={(event) => { event.preventDefault(); saveCompatibleProvider(typedProvider); }}>
      <label>{$t(typedProvider === "deepseek" ? "auth.deepseekBaseUrl" : "auth.ollamaBaseUrl")}<input type="url" required maxlength="2048" value={settings.baseUrl} oninput={(event) => updateCompatibleBaseUrl(typedProvider, (event.currentTarget as HTMLInputElement).value)}/></label>
      <label>{$t(typedProvider === "deepseek" ? "auth.deepseekApiKey" : "auth.ollamaToken")}<input type="password" autocomplete="new-password" maxlength="4096" value={compatibleSecret} oninput={(event) => updateCompatibleSecret(typedProvider, (event.currentTarget as HTMLInputElement).value)} placeholder={$t(settings.secretConfigured ? "auth.secretStored" : "auth.secretEnter")}/></label>
      <small>{$t(typedProvider === "deepseek" ? "auth.deepseekSecretHelp" : "auth.ollamaSecretHelp")}</small>
      <div class="provider-auth-actions"><button type="submit" disabled={compatibleProviderSaving !== null || (!settings.secretConfigured && !compatibleSecret.trim())}>{$t(compatibleProviderSaving === typedProvider ? "common.saving" : "auth.saveConnection")}</button><button type="button" disabled={providerAccountsLoading || compatibleProviderSaving !== null} onclick={() => loadProviderAccounts()}>{$t(providerAccountsLoading ? "status.checking" : "auth.connectionRefresh")}</button></div>
    </form>
  </section>
{/if}
