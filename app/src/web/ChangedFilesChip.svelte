<script lang="ts">
  // "변경 파일 N" in the session heading. Desktop opens a popover under the
  // chip; phones get the same list as a bottom sheet. Hidden with no changes.
  import { FileDiff, X } from "@lucide/svelte";
  import { currentViewportBand, popoverPlacement } from "./mobile-viewport";
  import { dismissOnOutside } from "./outside-dismiss";
  import { t } from "./i18n";
  import type { ChangedFileEntry } from "./session-panel";

  type Props = { files: ChangedFileEntry[]; canOpen: (file: ChangedFileEntry) => boolean; onopen: (file: ChangedFileEntry) => void };
  let { files, canOpen, onopen }: Props = $props();

  const SHEET_WIDTH = 760;
  let open = $state(false);
  let sheet = $state(false);
  let style = $state("");
  let trigger: HTMLButtonElement | undefined = $state();
  let pop: HTMLDivElement | undefined = $state();
  const id = `changed-files-${Math.random().toString(36).slice(2, 9)}`;
  const totals = $derived(files.reduce((sum, file) => ({ add: sum.add + file.add, del: sum.del + file.del }), { add: 0, del: 0 }));

  function place() {
    if (!trigger || !pop) return;
    sheet = window.innerWidth <= SHEET_WIDTH;
    if (sheet) { style = ""; return; }
    const band = currentViewportBand(), rect = trigger.getBoundingClientRect();
    const width = Math.min(420, Math.max(260, band.width - 24));
    const spot = popoverPlacement({ top: rect.top, bottom: rect.bottom, left: rect.right - width }, { width, height: pop.scrollHeight }, band);
    style = `left:${spot.left}px;top:${spot.top}px;width:${width}px;max-height:${spot.maxHeight}px`;
  }
  function close() { if (!open) return; open = false; try { pop?.hidePopover(); } catch {} }
  function toggle() {
    if (open) return close();
    open = true;
    requestAnimationFrame(() => { try { pop?.showPopover(); } catch {} place(); });
  }
  function choose(file: ChangedFileEntry) { if (!canOpen(file)) return; close(); onopen(file); }
  // The list is live: a session that stops reporting files closes the sheet.
  $effect(() => { if (!files.length) close(); });
</script>

{#if files.length}
  <button bind:this={trigger} type="button" class="changed-files-chip" data-popup-trigger={id} aria-haspopup="dialog" aria-expanded={open} aria-label={$t("session.changedFilesChip", { count: files.length })} title={$t("conversation.changedFiles")} onclick={toggle}>
    <FileDiff size={14}/><span class="changed-files-chip-label">{$t("session.changedFilesChip", { count: files.length })}</span><b class="changed-files-chip-count" aria-hidden="true">{files.length}</b>
  </button>
{/if}
<div bind:this={pop} class="changed-files-pop" class:sheet popover="manual" role="dialog" aria-label={$t("conversation.changedFiles")} {style} use:dismissOnOutside={{ onDismiss: close, triggerSelector: `[data-popup-trigger="${id}"]` }}>
  <header>
    <strong>{$t("conversation.changedFiles")}</strong>
    <span class="changed-files-pop-total"><em>+{totals.add}</em><i>-{totals.del}</i></span>
    <button type="button" class="ui-btn ui-btn-ghost ui-btn-sm changed-files-pop-close" aria-label={$t("common.close")} title={$t("common.close")} onclick={close}><X size={15}/></button>
  </header>
  <div class="changed-files-pop-list">
    {#each files as file (file.path)}
      {@const openable = canOpen(file)}
      <button type="button" disabled={!openable} title={openable ? $t("workspace.openFile") : $t("workspace.filePathUnresolved")} onclick={() => choose(file)}>
        <code class="path-tail-ellipsis" title={file.path} dir="rtl"><bdi dir="ltr">{file.path}</bdi></code>
        <span><em>+{file.add}</em><i>-{file.del}</i></span>
      </button>
    {/each}
  </div>
</div>
