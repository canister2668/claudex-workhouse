<script lang="ts">
  // Full-page settings shell: grouped navigation with a search box on the left,
  // one page on the right, and a sticky save bar that counts unsaved changes.
  // The pages themselves are rendered by App through the slot so their state
  // stays bound to the App variables that the rest of the interface reads.
  import { Search, X } from "@lucide/svelte";
  import { dragScrollX } from "../drag-scroll";
  import { t } from "../i18n";
  import { providerDisplayName } from "../provider-display";
  import { filterSettingsGroups, providerOfPage, settingsPageLabel, type SettingsPageId, type SettingsProviderId } from "./settings-nav";

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
  $: pageTitle = settingsPageLabel(page, $t, providerDisplayName);
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
          {#each group.pages as item (item)}
            {@const provider = providerOfPage(item)}
            <button type="button" class:active={page === item} aria-current={page === item ? "page" : undefined} onclick={() => choose(item)}>
              {#if provider}<i class="settings-provider-dot state-{dotState(provider)}" aria-hidden="true"></i>{/if}
              <span>{settingsPageLabel(item, $t, providerDisplayName)}</span>
              {#if dirtyPages.has(item)}<i class="settings-dirty-dot" aria-label={$t("common.changed")}></i>{/if}
            </button>
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
