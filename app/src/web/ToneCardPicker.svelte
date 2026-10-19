<script lang="ts">
  import { onDestroy } from "svelte";
  import { Star } from "@lucide/svelte";
  import { TONE_PRESETS, type TonePreset } from "./character-settings";
  import { subscribeEmotionStream, type EmotionAsset } from "./emotion-stream";
  import { t } from "./i18n";
  import { MAX_TONE_FAVORITES, normalizeToneFavorites, tonePreviewSources, toggleToneFavorite } from "./tone-preview";

  // Picture grid for choosing a character tone: one card per preset, drawn
  // with the current outfit's emotion art for that tone. The card body picks
  // the tone; the star beside it pins the tone into the three quick slots of
  // the avatar menu. A full set of three refuses further pins instead of
  // evicting one, and says so under the grid.
  export let outfit = "";
  export let selected: TonePreset | null = null;
  export let favorites: TonePreset[] = [];
  export let onselect: (tone: TonePreset) => void = () => {};
  export let onfavorites: ((tones: TonePreset[]) => void) | undefined = undefined;
  export let disabled = false;
  export let selectionDisabled = false;
  export let label = "";

  let catalog: Record<string, EmotionAsset[]> = {};
  const unsubscribe = subscribeEmotionStream(snapshot => { catalog = snapshot.assets; });
  onDestroy(unsubscribe);

  // Index into each card's fallback chain; a load error steps to the next
  // emotion, and running out leaves the empty art box.
  let failed: Record<string, number> = {};
  let failedOutfit = outfit;
  $: if (outfit !== failedOutfit) { failed = {}; failedOutfit = outfit; }

  $: pinned = normalizeToneFavorites(favorites);
  $: full = pinned.length >= MAX_TONE_FAVORITES;
  $: available = catalog[outfit] ?? null;
  $: sourcesFor = (tone: TonePreset) => tonePreviewSources(outfit, tone, available);

  function fail(tone: TonePreset) { failed = { ...failed, [tone]: (failed[tone] ?? 0) + 1 }; }
  function pin(tone: TonePreset) {
    if (disabled || !onfavorites) return;
    const { next, changed } = toggleToneFavorite(pinned, tone);
    if (changed) onfavorites(next);
  }
</script>

<div class="tone-card-picker" class:disabled>
  <div class="tone-card-grid" role="radiogroup" aria-label={label || $t("character.toneCards")}>
    {#each TONE_PRESETS as preset (preset.id)}
      {@const tone = preset.id}
      {@const sources = sourcesFor(tone)}
      {@const src = sources[failed[tone] ?? 0]}
      {@const isPinned = pinned.includes(tone)}
      <div class="tone-card" class:on={selected === tone}>
        <button type="button" class="tone-card-pick" title={$t(`character.tone.${tone}`)} role="radio" aria-checked={selected === tone} disabled={disabled || selectionDisabled} onclick={() => onselect(tone)}>
          <span class="tone-card-art">{#if src}<img {src} alt="" loading="lazy" decoding="async" draggable="false" onerror={() => fail(tone)}/>{/if}</span>
          <span class="tone-card-name">{$t(`character.tone.${tone}`)}</span>
        </button>
        {#if onfavorites}
          {@const blocked = !isPinned && full}
          {@const pinLabel = isPinned ? $t("character.toneUnfavorite") : blocked ? $t("character.toneFavoritesFull", { max: MAX_TONE_FAVORITES }) : $t("character.toneFavorite")}
          <button type="button" class="tone-card-pin" class:pinned={isPinned} aria-pressed={isPinned} aria-label={pinLabel} title={pinLabel} disabled={disabled || blocked} onclick={() => pin(tone)}>
            <Star size={14} fill={isPinned ? "currentColor" : "none"}/>
          </button>
        {/if}
      </div>
    {/each}
  </div>
  {#if onfavorites}
    <p class="tone-card-note" class:full aria-live="polite">
      {full ? $t("character.toneFavoritesFull", { max: MAX_TONE_FAVORITES }) : $t("character.toneFavoriteCount", { count: pinned.length, max: MAX_TONE_FAVORITES })}
    </p>
  {/if}
</div>

<style>
  .tone-card-picker{display:grid;gap:var(--space-2);min-width:0}
  .tone-card-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(calc(var(--space-6) * 2.5),1fr));gap:var(--space-2)}
  .tone-card{position:relative;min-width:0;border:1px solid var(--line);border-radius:var(--radius-md);background:var(--surface-2);transition:background .15s,border-color .15s}
  .tone-card:hover{border-color:var(--line-strong)}
  .tone-card.on{border-color:var(--accent);background:var(--accent-soft)}
  .tone-card-pick{display:grid;justify-items:center;gap:var(--space-1);width:100%;height:auto;min-height:0;padding:var(--space-1) var(--space-1) var(--space-2);border:0;border-radius:inherit;background:transparent;color:var(--muted);font-size:var(--text-xs);font-weight:600;line-height:1.2;box-shadow:none;cursor:pointer}
  .tone-card.on .tone-card-pick,.tone-card-pick:hover{color:var(--text)}
  .tone-card-pick:focus-visible,.tone-card-pin:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
  .tone-card-art{display:block;width:100%;aspect-ratio:1;overflow:hidden;border-radius:var(--radius-sm);background:var(--surface-3)}
  .tone-card-art img{display:block;width:100%;height:100%;object-fit:cover}
  .tone-card-name{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .tone-card-pin{position:absolute;top:var(--space-1);right:var(--space-1);display:inline-flex;align-items:center;justify-content:center;width:calc(var(--space-5) + var(--space-1));height:calc(var(--space-5) + var(--space-1));min-height:0;padding:0;border:1px solid var(--line);border-radius:var(--radius-pill);background:var(--surface);color:var(--muted);box-shadow:none;cursor:pointer;transition:color .15s,border-color .15s}
  .tone-card-pin:hover:not(:disabled){color:var(--text);border-color:var(--accent)}
  .tone-card-pin.pinned{border-color:var(--accent);color:var(--accent-strong)}
  .tone-card-pin:disabled{opacity:1;background:var(--surface-2);border-color:var(--line);color:var(--muted);cursor:not-allowed}
  .tone-card-note{margin:0;color:var(--muted);font-size:var(--text-xs)}
  .tone-card-note.full{color:var(--warn)}
  .disabled .tone-card-pick{cursor:not-allowed;opacity:.6}
  @media (max-width:760px){.tone-card-pin{width:calc(var(--space-6) + var(--space-1));height:calc(var(--space-6) + var(--space-1))}}
</style>
