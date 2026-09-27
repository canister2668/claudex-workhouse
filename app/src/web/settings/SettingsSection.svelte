<script lang="ts">
  // A titled block inside a settings page: heading, optional description,
  // optional action slot on the right. Sections stack with hairlines between
  // them; there is no card inside the page.
  export let title = "";
  export let description = "";
  export let id: string | undefined = undefined;
</script>

<section class="settings-section" aria-labelledby={id}>
  {#if title || $$slots.actions}
    <header class="settings-section-head">
      <span>{#if title}<h4 {id}>{title}</h4>{/if}{#if description}<small>{description}</small>{/if}</span>
      {#if $$slots.actions}<div class="settings-section-actions"><slot name="actions"/></div>{/if}
    </header>
  {/if}
  <slot/>
</section>
