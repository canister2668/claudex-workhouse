<script lang="ts">
  // ⌘K palette: navigate, start a task per agent, jump to a settings page,
  // or open a recent session. Rendered in the top layer; closes on Escape,
  // on a click outside, and after running a command.
  import { Search } from "@lucide/svelte";
  import { tick } from "svelte";
  import { t } from "./i18n";
  import { filterPaletteCommands, type PaletteCommand } from "./command-palette";

  type Props = { open?: boolean; commands: PaletteCommand[]; onclose?: () => void };
  let { open = $bindable(false), commands, onclose }: Props = $props();

  let query = $state("");
  let cursor = $state(0);
  let input: HTMLInputElement | undefined = $state();
  const visible = $derived(filterPaletteCommands(commands, query));
  const groups = $derived.by(() => {
    const order: string[] = [];
    const byGroup = new Map<string, PaletteCommand[]>();
    for (const command of visible) {
      if (!byGroup.has(command.group)) { byGroup.set(command.group, []); order.push(command.group); }
      byGroup.get(command.group)!.push(command);
    }
    return order.map(group => ({ group, items: byGroup.get(group)! }));
  });

  $effect(() => {
    if (open) { query = ""; cursor = 0; void tick().then(() => input?.focus()); }
  });
  $effect(() => { if (cursor >= visible.length) cursor = Math.max(0, visible.length - 1); });

  function close() { open = false; onclose?.(); }
  function run(command: PaletteCommand) { close(); command.run(); }
  function onkeydown(event: KeyboardEvent) {
    if (event.key === "Escape") { event.preventDefault(); close(); }
    else if (event.key === "ArrowDown") { event.preventDefault(); cursor = Math.min(visible.length - 1, cursor + 1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); cursor = Math.max(0, cursor - 1); }
    else if (event.key === "Enter") { event.preventDefault(); const command = visible[cursor]; if (command) run(command); }
  }
  const indexOf = (command: PaletteCommand) => visible.indexOf(command);
</script>

{#if open}
  <div class="palette-backdrop" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) close(); }}>
    <div class="command-palette" role="dialog" aria-modal="true" aria-label={$t("palette.title")} tabindex="-1" onkeydown={onkeydown}>
      <label class="palette-input"><Search size={17}/><input bind:this={input} bind:value={query} type="text" placeholder={$t("palette.placeholder")} aria-label={$t("palette.placeholder")} autocomplete="off" spellcheck="false"/><kbd>{$t("palette.escape")}</kbd></label>
      <div class="palette-list" role="listbox" aria-label={$t("palette.title")}>
        {#each groups as entry (entry.group)}
          <div class="palette-group" role="group" aria-label={entry.group}>
            <span class="palette-group-label">{entry.group}</span>
            {#each entry.items as command (command.id)}
              {@const index = indexOf(command)}
              <button type="button" role="option" aria-selected={index === cursor} class="palette-item" class:active={index === cursor} onmouseenter={() => cursor = index} onclick={() => run(command)}>
                <span class="palette-item-label">{command.label}</span>
                {#if command.hint}<small class="palette-item-hint">{command.hint}</small>{/if}
              </button>
            {/each}
          </div>
        {:else}
          <p class="palette-empty">{$t("palette.empty")}</p>
        {/each}
      </div>
    </div>
  </div>
{/if}
