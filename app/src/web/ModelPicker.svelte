<script lang="ts">
  // One model picker for every place that chooses agent → model → effort →
  // speed: the task composer, per-session settings, assist, delegation rules,
  // and the agent defaults. Callers pass the option lists they already own and
  // bind the four values; the picker never fetches.
  import { ChevronDown } from "@lucide/svelte";
  import { t } from "./i18n";
  import { modelLabel } from "./session-ui";
  import { providerDisplayName } from "./provider-display";

  type ProviderId = "codex" | "claude" | "deepseek" | "ollama" | "antigravity" | "grok";
  type Field = "provider" | "model" | "effort" | "tier";

  export let fields: Field[] = ["provider", "model", "effort", "tier"];
  // tokens: inline dropdown tokens inside a sentence; stack: label above each
  // control; row: controls side by side with small labels.
  export let layout: "tokens" | "stack" | "row" = "stack";
  export let providers: ProviderId[] = [];
  export let provider: ProviderId = "codex";
  export let disabledProviders: Partial<Record<ProviderId, string>> = {};
  export let models: Array<{ id: string; displayName?: string; hidden?: boolean }> = [];
  export let model = "";
  export let efforts: Array<{ id?: string; reasoningEffort?: string }> = [];
  export let effort = "";
  // When set, the effort list gets an empty option carrying this label (used
  // by delegation, where "" means "the selected model's default").
  export let effortEmptyLabel: string | null = null;
  export let hasPriority = false;
  export let tier: string | null = null;
  export let disabled = false;
  export let size: "sm" | "md" = "md";
  export let idPrefix = "model-picker";
  export let onprovider: (provider: ProviderId) => void = () => {};
  export let onmodel: (model: string) => void = () => {};
  export let oneffort: (effort: string) => void = () => {};
  export let ontier: (tier: string | null) => void = () => {};

  $: effortOptions = efforts.map(item => String(item.id ?? item.reasoningEffort ?? "")).filter(Boolean);
  $: visibleModels = models.filter(item => !item.hidden);
  const has = (field: Field) => fields.includes(field);
  function chooseProvider(event: Event) { provider = (event.currentTarget as HTMLSelectElement).value as ProviderId; onprovider(provider); }
  function chooseModel(event: Event) { model = (event.currentTarget as HTMLSelectElement).value; onmodel(model); }
  function chooseEffort(event: Event) { effort = (event.currentTarget as HTMLSelectElement).value; oneffort(effort); }
  function chooseTier(event: Event) { tier = (event.currentTarget as HTMLSelectElement).value || null; ontier(tier); }
</script>

<div class="model-picker layout-{layout} size-{size}" role="group" aria-label={$t("create.agentToken")}>
  {#if has("provider")}
    <label class="model-picker-field field-provider">
      <span class="model-picker-label">{$t("create.engine")}</span>
      <span class="ui-select model-picker-control" class:ui-select-sm={size==="sm"}><select id={`${idPrefix}-provider`} aria-label={$t("create.engine")} value={provider} {disabled} onchange={chooseProvider}>{#each providers as item (item)}<option value={item} disabled={Boolean(disabledProviders[item])}>{providerDisplayName(item)}</option>{/each}</select><ChevronDown class="ui-select-chevron" size={14}/></span>
    </label>
  {/if}
  {#if has("model")}
    <label class="model-picker-field field-model">
      <span class="model-picker-label">{$t("model.label")}</span>
      <span class="ui-select model-picker-control" class:ui-select-sm={size==="sm"}><select id={`${idPrefix}-model`} aria-label={$t("model.label")} value={model} disabled={disabled || !visibleModels.length} onchange={chooseModel}>{#if !visibleModels.some(item => item.id === model)}<option value={model}>{model || $t("model.default")}</option>{/if}{#each visibleModels as item (item.id)}<option value={item.id}>{modelLabel(item)}</option>{/each}</select><ChevronDown class="ui-select-chevron" size={14}/></span>
    </label>
  {/if}
  {#if has("effort") && (effortOptions.length || effortEmptyLabel)}
    <label class="model-picker-field field-effort">
      <span class="model-picker-label">{$t("model.reasoningEffort")}</span>
      <span class="ui-select model-picker-control" class:ui-select-sm={size==="sm"}><select id={`${idPrefix}-effort`} aria-label={$t("model.reasoningEffort")} value={effort} {disabled} onchange={chooseEffort}>{#if effortEmptyLabel !== null}<option value="">{effortEmptyLabel}</option>{/if}{#each effortOptions as id (id)}<option value={id}>{$t(`session.effort.${id}`)}</option>{/each}</select><ChevronDown class="ui-select-chevron" size={14}/></span>
    </label>
  {/if}
  {#if has("tier") && hasPriority}
    <label class="model-picker-field field-tier">
      <span class="model-picker-label">{$t("model.speed")}</span>
      <span class="ui-select model-picker-control" class:ui-select-sm={size==="sm"}><select id={`${idPrefix}-tier`} aria-label={$t("model.speed")} value={tier ?? ""} {disabled} onchange={chooseTier}><option value="">{$t("model.standard")}</option><option value="priority">{$t("model.fast")}</option></select><ChevronDown class="ui-select-chevron" size={14}/></span>
    </label>
  {/if}
</div>
