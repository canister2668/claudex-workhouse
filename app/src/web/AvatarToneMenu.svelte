<script lang="ts">
  import { onDestroy } from "svelte";
  import { ChevronDown, ChevronUp, RotateCcw } from "@lucide/svelte";
  import type { TonePreset } from "./character-settings";
  import { subscribeEmotionStream, type EmotionAsset } from "./emotion-stream";
  import { t } from "./i18n";
  import ToneCardPicker from "./ToneCardPicker.svelte";
  import { MAX_TONE_FAVORITES, normalizeToneFavorites, tonePreviewSources } from "./tone-preview";

  // Quick tone switch for the avatar menu, the tone counterpart of the outfit
  // picker: three pinned tones as picture cards, a scope toggle that decides
  // whether a pick lasts one reply or the rest of the session, and the full
  // tone grid folded underneath. Everything expands in place because the
  // avatar popover closes on outside clicks.
  export let outfit = "";
  export let favorites: TonePreset[] = [];
  export let selected: TonePreset | null = null;
  export let customTone = "";
  export let disabled = false;
  export let selectionDisabled = false;
  export let activeScope: "once" | "session" = "once";
  export let onselect: (tone: TonePreset | null, scope: "once" | "session") => void = () => {};
  export let onfavorites: (tones: TonePreset[]) => void = () => {};

  type Scope = "once" | "session";
  // An active session override opens on that scope, so the reset and any new
  // pick act on what is already in force.
  let scope: Scope = activeScope;
  $: scope = activeScope;
  let expanded = false;
  let notice = "";

  let catalog: Record<string, EmotionAsset[]> = {};
  const unsubscribe = subscribeEmotionStream(snapshot => { catalog = snapshot.assets; });
  onDestroy(unsubscribe);

  let failed: Record<string, number> = {};
  let failedOutfit = outfit;
  $: if (outfit !== failedOutfit) { failed = {}; failedOutfit = outfit; }

  $: pinned = normalizeToneFavorites(favorites);
  $: slots = Array.from({ length: MAX_TONE_FAVORITES }, (_, index) => pinned[index] ?? null);
  $: available = catalog[outfit] ?? null;
  $: currentLabel = selected ? $t("character.toneCurrent", { tone: $t(`character.tone.${selected}`) }) : $t("character.toneCurrentDefault");

  function fail(tone: TonePreset) { failed = { ...failed, [tone]: (failed[tone] ?? 0) + 1 }; }
  function choose(tone: TonePreset) {
    if (disabled || selectionDisabled) return;
    // A custom tone with no text would send an empty directive.
    if (tone === "custom" && !customTone.trim()) { notice = $t("character.toneCustomEmpty"); return; }
    notice = "";
    expanded = false;
    onselect(tone, scope);
  }
  function reset() {
    if (disabled || selectionDisabled || selected === null) return;
    notice = "";
    onselect(null, scope);
  }
</script>

<section class="tone-menu" aria-label={$t("character.toneQuickTitle")}>
  <header class="tone-menu-head">
    <strong>{$t("character.toneQuickTitle")}</strong>
    <span class="tone-menu-current">{currentLabel}</span>
  </header>

  <div class="tone-scope" role="radiogroup" aria-label={$t("character.toneScope")}>
    <button type="button" role="radio" aria-checked={scope === "once"} class:on={scope === "once"} {disabled} onclick={() => scope = "once"}>{$t("character.toneScopeOnce")}</button>
    <button type="button" role="radio" aria-checked={scope === "session"} class:on={scope === "session"} {disabled} onclick={() => scope = "session"}>{$t("character.toneScopeSession")}</button>
  </div>

  {#if pinned.length}
    <div class="tone-quick-grid" role="radiogroup" aria-label={$t("character.toneQuickTitle")}>
      {#each slots as tone, index (tone ?? `empty-${index}`)}
        {#if tone}
          {@const src = tonePreviewSources(outfit, tone, available)[failed[tone] ?? 0]}
          <button type="button" role="radio" aria-checked={selected === tone} class="tone-quick-card" title={$t(`character.tone.${tone}`)} class:on={selected === tone} disabled={disabled || selectionDisabled} onclick={() => choose(tone)}>
            <span class="tone-quick-art">{#if src}<img {src} alt="" loading="lazy" decoding="async" draggable="false" onerror={() => fail(tone)}/>{/if}</span>
            <span class="tone-quick-name">{$t(`character.tone.${tone}`)}</span>
          </button>
        {:else}
          <span class="tone-quick-card empty" aria-hidden="true"><span class="tone-quick-art"></span><span class="tone-quick-name">{$t("character.toneQuickSlotEmpty")}</span></span>
        {/if}
      {/each}
    </div>
  {:else}
    <p class="tone-menu-empty">{$t("character.toneQuickEmpty")}</p>
  {/if}

  {#if notice}<p class="tone-menu-notice" role="status">{notice}</p>{/if}

  <div class="tone-menu-actions">
    <button type="button" class="tone-menu-expand" aria-expanded={expanded} onclick={() => expanded = !expanded}>
      {expanded ? $t("character.toneHideAll") : $t("character.toneShowAll")}
      {#if expanded}<ChevronUp size={14}/>{:else}<ChevronDown size={14}/>{/if}
    </button>
    <button type="button" class="tone-menu-reset" disabled={disabled || selectionDisabled || selected === null} onclick={reset}>
      <RotateCcw size={14}/>{$t("character.toneReset")}
    </button>
  </div>

  {#if expanded}
    <ToneCardPicker {outfit} {selected} favorites={pinned} {disabled} {selectionDisabled} onselect={choose} {onfavorites}/>
  {/if}
</section>

<style>
  .tone-menu{display:grid;gap:var(--space-2);min-width:0}
  .tone-menu-head{display:flex;align-items:baseline;gap:var(--space-2);min-width:0}
  .tone-menu-head strong{color:var(--text);font-size:var(--text-sm);font-weight:700}
  .tone-menu-current{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted);font-size:var(--text-xs);text-align:right}
  .tone-scope{display:grid;grid-template-columns:1fr 1fr;gap:var(--space-1);padding:var(--space-1);border:1px solid var(--line);border-radius:var(--radius-pill);background:var(--surface-2)}
  .tone-scope button{min-height:calc(var(--space-6) + var(--space-1));padding:0 var(--space-2);border:0;border-radius:var(--radius-pill);background:transparent;color:var(--muted);font-size:var(--text-xs);font-weight:600;box-shadow:none;cursor:pointer;transition:background .15s,color .15s}
  .tone-scope button:hover:not(:disabled){color:var(--text);background:var(--surface-3)}
  .tone-scope button.on{background:var(--accent-soft);color:var(--text)}
  .tone-quick-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--space-2)}
  .tone-quick-card{display:grid;justify-items:center;gap:var(--space-1);min-width:0;height:auto;min-height:0;padding:var(--space-1) var(--space-1) var(--space-2);border:1px solid var(--line);border-radius:var(--radius-md);background:var(--surface-2);color:var(--muted);font-size:var(--text-xs);font-weight:600;line-height:1.2;box-shadow:none;cursor:pointer;transition:background .15s,border-color .15s,color .15s}
  .tone-quick-card:hover:not(:disabled){color:var(--text);border-color:var(--line-strong)}
  .tone-quick-card.on{border-color:var(--accent);background:var(--accent-soft);color:var(--text)}
  .tone-quick-card:disabled{cursor:not-allowed;opacity:.6}
  .tone-quick-card.empty{border-style:dashed;background:transparent;cursor:default}
  .tone-quick-card:focus-visible,.tone-scope button:focus-visible,.tone-menu-actions button:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
  .tone-quick-art{display:block;width:100%;aspect-ratio:1;overflow:hidden;border-radius:var(--radius-sm);background:var(--surface-3)}
  .tone-quick-art img{display:block;width:100%;height:100%;object-fit:cover}
  .tone-quick-name{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .tone-menu-empty,.tone-menu-notice{margin:0;padding:var(--space-2);border-radius:var(--radius-sm);font-size:var(--text-xs)}
  .tone-menu-empty{border:1px dashed var(--line);color:var(--muted)}
  .tone-menu-notice{background:var(--warn-soft);color:var(--text)}
  .tone-menu-actions{display:flex;gap:var(--space-2)}
  .tone-menu-actions button{display:inline-flex;align-items:center;justify-content:center;gap:var(--space-1);flex:1;min-width:0;min-height:calc(var(--space-6) + var(--space-1));padding:0 var(--space-2);border:1px solid var(--line);border-radius:var(--radius-control-sm);background:var(--surface-2);color:var(--text);font-size:var(--text-xs);font-weight:600;box-shadow:none;cursor:pointer;transition:background .15s,border-color .15s}
  .tone-menu-actions button:hover:not(:disabled){background:var(--surface-3)}
  .tone-menu-actions button:disabled{color:var(--muted);cursor:not-allowed;opacity:.6}
</style>
