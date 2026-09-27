<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLButtonAttributes } from "svelte/elements";

  type Props = {
    variant?: "primary" | "secondary" | "ghost" | "danger";
    size?: "sm" | "md";
    loading?: boolean;
    icon?: Snippet;
    children?: Snippet;
    class?: string;
  } & HTMLButtonAttributes;

  let { variant = "secondary", size = "md", loading = false, icon, children, class: className = "", type = "button", disabled, ...rest }: Props = $props();
</script>

<button {type} class="ui-btn ui-btn-{variant} {size === 'sm' ? 'ui-btn-sm' : ''} {className}" class:ui-btn-loading={loading} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
  {#if loading}<i class="ui-spinner" aria-hidden="true"></i>{:else if icon}{@render icon()}{/if}
  {#if children}{@render children()}{/if}
</button>
