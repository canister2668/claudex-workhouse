<script lang="ts">
  // 연동 › 저장소·Proton Drive. Artifacts, local snapshots, and Proton Drive
  // on one page, switched by in-page sub-tabs so each existing component keeps
  // its own width.
  import { t } from "../i18n";
  import ArtifactSettings from "../ArtifactSettings.svelte";
  import SnapshotSettings from "../SnapshotSettings.svelte";
  import ProtonDriveSettings from "../ProtonDriveSettings.svelte";

  type StorageTab = "artifacts" | "snapshots" | "proton";
  export let api: (path: string, init?: RequestInit) => Promise<any>;
  export let tab: StorageTab = "artifacts";
  const tabs: Array<{ id: StorageTab; labelKey: string }> = [{ id: "artifacts", labelKey: "settings.artifacts" }, { id: "snapshots", labelKey: "settings.storage" }, { id: "proton", labelKey: "proton.title" }];
</script>

<p class="settings-page-body">{$t("settings.page.storage.body")}</p>
<nav class="settings-subtabs" aria-label={$t("storage.sections")}>
  {#each tabs as item}<button type="button" class:active={tab === item.id} aria-current={tab === item.id ? "page" : undefined} onclick={() => tab = item.id}>{$t(item.labelKey)}</button>{/each}
</nav>
{#if tab === "artifacts"}<ArtifactSettings {api}/>{:else if tab === "snapshots"}<SnapshotSettings {api}/>{:else}<ProtonDriveSettings {api}/>{/if}
