<script lang="ts">
  import type { Snippet } from "svelte";
  import { t } from "../i18n";

  type Props = {
    label: string;
    help?: string;
    inherited?: boolean;
    stacked?: boolean;
    id?: string;
    class?: string;
    children?: Snippet;
  };

  let { label, help, inherited = false, stacked = false, id, class: className = "", children }: Props = $props();
</script>

<div class="setting-row {className}" class:setting-row-stacked={stacked} class:setting-row-inherited={inherited}>
  <div class="setting-row-copy">
    {#if id}<label for={id} class="setting-row-label">{label}</label>{:else}<span class="setting-row-label">{label}</span>{/if}
    {#if help}<small class="setting-row-help">{help}</small>{/if}
    {#if inherited}<small class="setting-row-inherit">{$t("settings.inheritsGlobal")}</small>{/if}
  </div>
  <div class="setting-row-control">{#if children}{@render children()}{/if}</div>
</div>
