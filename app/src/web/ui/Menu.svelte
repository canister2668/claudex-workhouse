<script lang="ts">
  // A "⋯" trigger that opens a small action sheet in the top layer, placed
  // inside the visible viewport band so it never clips under a scrolling row.
  import type { Snippet } from "svelte";
  import { EllipsisVertical } from "@lucide/svelte";
  import { currentViewportBand, popoverPlacement } from "../mobile-viewport";
  import { dismissOnOutside } from "../outside-dismiss";

  type Props = { label: string; size?: "sm" | "md"; class?: string; children?: Snippet<[{ close: () => void }]> };
  let { label, size = "md", class: className = "", children }: Props = $props();

  let open = $state(false);
  let style = $state("");
  let trigger: HTMLButtonElement | undefined = $state();
  let sheet: HTMLDivElement | undefined = $state();
  const id = `ui-menu-${Math.random().toString(36).slice(2, 9)}`;

  function place() {
    if (!trigger || !sheet) return;
    const band = currentViewportBand(), rect = trigger.getBoundingClientRect();
    const width = Math.min(260, Math.max(180, band.width - 16));
    const spot = popoverPlacement({ top: rect.top, bottom: rect.bottom, left: rect.right - width }, { width, height: sheet.scrollHeight }, band);
    style = `left:${spot.left}px;top:${spot.top}px;width:${width}px;max-height:${spot.maxHeight}px`;
  }
  function close() { if (!open) return; open = false; try { sheet?.hidePopover(); } catch {} }
  function toggle() {
    if (open) return close();
    open = true;
    requestAnimationFrame(() => { try { sheet?.showPopover(); } catch {} place(); });
  }
</script>

<button bind:this={trigger} type="button" class="ui-btn ui-btn-ghost ui-menu-trigger {size === 'sm' ? 'ui-btn-sm' : ''} {className}" data-popup-trigger={id} aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} onclick={toggle}><EllipsisVertical size={size === "sm" ? 15 : 17}/></button>
<div bind:this={sheet} class="ui-menu-sheet" popover="manual" role="menu" aria-label={label} {style} use:dismissOnOutside={{ onDismiss: close, triggerSelector: `[data-popup-trigger="${id}"]` }}>
  {#if children}{@render children({ close })}{/if}
</div>
