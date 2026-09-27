<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLSelectAttributes } from "svelte/elements";

  export type SelectOption = { value: string; label: string; disabled?: boolean; group?: string };

  type Props = {
    value?: string;
    options?: SelectOption[];
    size?: "sm" | "md";
    class?: string;
    children?: Snippet;
    onchange?: (value: string, event: Event) => void;
  } & Omit<HTMLSelectAttributes, "value" | "onchange" | "size">;

  let { value = $bindable(""), options = [], size = "md", class: className = "", children, onchange, ...rest }: Props = $props();

  const groups = $derived.by(() => {
    const seen: Array<{ group: string | undefined; items: SelectOption[] }> = [];
    for (const option of options) {
      const current = seen.at(-1);
      if (current && current.group === option.group) current.items.push(option);
      else seen.push({ group: option.group, items: [option] });
    }
    return seen;
  });

  function handleChange(event: Event) {
    const next = (event.currentTarget as HTMLSelectElement).value;
    value = next;
    onchange?.(next, event);
  }
</script>

<span class="ui-select {size === 'sm' ? 'ui-select-sm' : ''} {className}">
  <select bind:value onchange={handleChange} {...rest}>
    {#if children}{@render children()}{/if}
    {#each groups as entry}
      {#if entry.group}
        <optgroup label={entry.group}>{#each entry.items as option}<option value={option.value} disabled={option.disabled}>{option.label}</option>{/each}</optgroup>
      {:else}
        {#each entry.items as option}<option value={option.value} disabled={option.disabled}>{option.label}</option>{/each}
      {/if}
    {/each}
  </select>
  <svg class="ui-select-chevron" aria-hidden="true" viewBox="0 0 16 16" width="14" height="14"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
</span>
