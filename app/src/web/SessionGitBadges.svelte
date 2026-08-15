<script lang="ts">
  import { GitCommitHorizontal, Upload } from "@lucide/svelte";
  import type { SessionGitSummary } from "./session-git-state";
  import { t } from "./i18n";

  export let summary:SessionGitSummary|null=null;

  const dirtyLabel=()=>summary?.changedCount===null
    ?$t("session.gitWorkspaceDirtyUnknown")
    :$t("session.gitWorkspaceDirty",{count:summary?.changedCount??0});
</script>

{#if summary&&(summary.dirty||summary.ahead>0)}
  {#if summary.dirty}<span class="session-git-badge dirty" title={$t("session.gitWorkspaceScope")}><GitCommitHorizontal size={12}/>{dirtyLabel()}</span>{/if}
  {#if summary.ahead>0}<span class="session-git-badge unpushed" title={$t("session.gitWorkspaceScope")}><Upload size={12}/>{$t("session.gitUnpushed",{count:summary.ahead})}</span>{/if}
{/if}
