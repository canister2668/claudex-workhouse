<script lang="ts">
  // Full-page settings shell: grouped navigation with a search box on the left,
  // one page on the right, and a sticky save bar that counts unsaved changes.
  // The pages themselves are rendered by App through the slot so their state
  // stays bound to the App variables that the rest of the interface reads.
  import { Search, X } from "@lucide/svelte";
  import { dragScrollX } from "../drag-scroll";
  import { t } from "../i18n";
  import { providerDisplayName } from "../provider-display";
  import { SETTINGS_PROVIDERS, filterSettingsGroups, providerOfPage, providerPage, settingsPageLabel, type SettingsPageId, type SettingsProviderId } from "./settings-nav";

  export let page: SettingsPageId = "general";
  export let providerStates: Partial<Record<SettingsProviderId, "connected" | "disconnected" | "unknown" | "unavailable">> = {};
  export let dirtyPages: ReadonlySet<SettingsPageId> = new Set();
  export let changeCount = 0;
  export let saving = false;
  export let saveDisabled = false;
  export let notice = "";
  export let noticeError = false;
  export let showSaveBar = true;
  export let onselect: (page: SettingsPageId) => void = () => {};
  export let onsave: () => void = () => {};
  export let onrevert: () => void = () => {};
  export let onclose: () => void = () => {};

  let query = "";
  $: groups = filterSettingsGroups(query, $t, providerDisplayName);
  // The six agent pages share one nav entry ("에이전트별 설정") so the nav, and the
  // phone's horizontal tab row in particular, stays short; the agent is then
  // picked from a chip row at the top of the page.
  const AGENTS = "agents" as const;
  type NavItem = SettingsPageId | typeof AGENTS;
  let lastProvider: SettingsProviderId = "claude";
  $: lastProvider = providerOfPage(page) ?? lastProvider;
  $: agentPage = providerOfPage(page) !== null;
  function navItems(pages: readonly SettingsPageId[]): NavItem[] {
    const items: NavItem[] = [];
    for (const item of pages) {
      if (providerOfPage(item)) { if (!items.includes(AGENTS)) items.push(AGENTS); }
      else items.push(item);
    }
    return items;
  }
  $: agentsDirty = SETTINGS_PROVIDERS.some(provider => dirtyPages.has(providerPage(provider)));
  $: pageTitle = agentPage ? $t("settings.page.agents") : settingsPageLabel(page, $t, providerDisplayName);
  function choose(next: SettingsPageId) { onselect(next); }
  const dotState = (provider: SettingsProviderId) => providerStates[provider] ?? "unknown";
</script>

<section class="global-settings settings-page" aria-labelledby="global-title">
  <aside class="settings-nav-pane">
    <header class="settings-nav-head">
      <h2 id="global-title">{$t("settings.title")}</h2>
      <button type="button" class="icon-button" aria-label={$t("settings.close")} title={$t("settings.close")} onclick={onclose}><X size={19}/></button>
    </header>
    <label class="settings-search"><Search size={15}/><input type="search" bind:value={query} placeholder={$t("settings.searchPlaceholder")} aria-label={$t("settings.searchPlaceholder")}/></label>
    <nav class="settings-tabs settings-nav" aria-label={$t("settings.title")} use:dragScrollX>
      {#each groups as group (group.id)}
        <div class="settings-nav-group" role="group" aria-label={$t(group.labelKey)}>
          <span class="settings-nav-group-label">{$t(group.labelKey)}</span>
          {#each navItems(group.pages) as item (item)}
            {#if item === AGENTS}
              <button type="button" class:active={agentPage} aria-current={agentPage ? "page" : undefined} onclick={() => choose(providerPage(lastProvider))}>
                <span>{$t("settings.page.agents")}</span>
                {#if agentsDirty}<i class="settings-dirty-dot" aria-label={$t("common.changed")}></i>{/if}
              </button>
            {:else}
              <button type="button" class:active={page === item} aria-current={page === item ? "page" : undefined} onclick={() => choose(item)}>
                <span>{settingsPageLabel(item, $t, providerDisplayName)}</span>
                {#if dirtyPages.has(item)}<i class="settings-dirty-dot" aria-label={$t("common.changed")}></i>{/if}
              </button>
            {/if}
          {/each}
        </div>
      {:else}
        <p class="settings-search-empty">{$t("settings.searchEmpty", { query })}</p>
      {/each}
    </nav>
  </aside>
  <div class="settings-content-pane">
    <header class="settings-content-head">
      <h3 class="settings-content-title">{pageTitle}</h3>
    </header>
    {#if agentPage}
      <nav class="settings-provider-switch" aria-label={$t("settings.page.agents")} use:dragScrollX>
        {#each SETTINGS_PROVIDERS as provider (provider)}
          <button type="button" class:active={providerOfPage(page) === provider} aria-current={providerOfPage(page) === provider ? "page" : undefined} onclick={() => choose(providerPage(provider))}>
            <i class="settings-provider-dot state-{dotState(provider)}" aria-hidden="true"></i>
            <span>{providerDisplayName(provider)}</span>
            {#if dirtyPages.has(providerPage(provider))}<i class="settings-dirty-dot" aria-label={$t("common.changed")}></i>{/if}
          </button>
        {/each}
      </nav>
    {/if}
    <div class="settings-tab-panel settings-content settings-tab-{page}">
      <slot/>
    </div>
    {#if showSaveBar}
      <div class="settings-save-row sticky">
        <span class:error={noticeError}>{notice || (changeCount ? $t("settings.changedCount", { count: changeCount }) : $t("settings.allSaved"))}</span>
        <div class="settings-save-actions">
          <button type="button" class="ui-btn ui-btn-ghost" disabled={saving || !changeCount} onclick={onrevert}>{$t("settings.revert")}</button>
          <button type="button" class="primary" disabled={saving || saveDisabled} onclick={onsave}>{saving ? $t("common.saving") : $t("common.save")}</button>
        </div>
      </div>
    {/if}
  </div>
</section>
