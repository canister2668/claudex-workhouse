<script lang="ts">
  import { Check, X } from "@lucide/svelte";
  import { TONE_PRESETS, type TonePreset } from "./character-settings";
  import { t } from "./i18n";
  // The create panel owns one tone decision per participant: keep the global
  // character preset, or override it for this session only. Both live in one
  // list so the two are visibly exclusive; the old panel split them across a
  // segmented control and a separate per-provider select.
  export let title = "";
  export let nickname = "";
  export let globalTone: TonePreset = "default";
  export let selected: TonePreset | null = null;
  export let customTone = "";
  export let onchoose: (tone: TonePreset | null) => void = () => {};
  export let oncustom: (value: string) => void = () => {};
  export let onclose: () => void = () => {};
  const label = (tone: TonePreset) => $t(`character.tone.${tone}`);
</script>

<div class="modal-backdrop" role="presentation" onclick={(event)=>{if(event.target===event.currentTarget)onclose();}}>
  <div class="modal tone-sheet" role="dialog" aria-modal="true" aria-labelledby="tone-sheet-title">
    <header>
      <h2 id="tone-sheet-title">{title}</h2>
      {#if nickname}<span class="tone-nickname">{nickname}</span>{/if}
      <button class="icon-button" aria-label={$t("a11y.closeDialog")} onclick={onclose}><X size={20}/></button>
    </header>

    <p class="tone-group">{$t("conversation.toneGlobalGroup")}</p>
    <button type="button" class="tone-option" class:active={selected===null} aria-pressed={selected===null} onclick={()=>onchoose(null)}>
      <span><strong>{$t("conversation.useGlobalTone")}</strong><small>{$t("conversation.toneGlobalCurrent",{tone:label(globalTone)})}</small></span>
      {#if selected===null}<Check size={17}/>{/if}
    </button>

    <p class="tone-group">{$t("conversation.toneSessionGroup")}</p>
    {#each TONE_PRESETS as preset}
      <button type="button" class="tone-option" class:active={selected===preset.id} aria-pressed={selected===preset.id} onclick={()=>onchoose(preset.id)}>
        <span><strong>{label(preset.id)}</strong>{#if preset.id==="custom"}<small>{$t("character.customTone")}</small>{/if}</span>
        {#if selected===preset.id}<Check size={17}/>{/if}
      </button>
      {#if preset.id==="custom"&&selected==="custom"}
        <label class="tone-custom">
          <textarea rows="3" maxlength="2000" value={customTone} placeholder={$t("conversation.toneCustomPlaceholder")}
            oninput={(event)=>oncustom((event.currentTarget as HTMLTextAreaElement).value)}></textarea>
        </label>
      {/if}
    {/each}

    <div class="tone-actions"><button type="button" class="primary" onclick={onclose}>{$t("common.done")}</button></div>
  </div>
</div>
