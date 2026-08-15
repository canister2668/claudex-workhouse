<script lang="ts">
  import { t } from "./i18n";
  import { effortLabel } from "./session-ui";

  export let provider:"codex"|"claude"|"deepseek"|"ollama"|"antigravity"|"grok";
  export let modelLabel:string;
  export let effort:string|null|undefined=null;
  export let serviceTier:string|null|undefined=null;
</script>

<span class="session-model-badges" aria-label={`${$t("model.label")} ${modelLabel}`}>
  <span class="session-model-chip model" title={$t("model.label")}>{modelLabel}</span>
  {#if effort}<span class="session-model-chip" title={$t("model.reasoningEffort")}>{effortLabel(effort)}</span>{/if}
  {#if provider==="codex"&&serviceTier}<span class="session-model-chip" title={$t("model.speed")}>{$t(serviceTier==="priority"?"model.fast":"model.standard")}</span>{/if}
</span>
