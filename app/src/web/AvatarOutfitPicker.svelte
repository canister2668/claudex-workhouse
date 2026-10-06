<script lang="ts">
  import { ChevronDown, X } from "@lucide/svelte";
  import { emotionAssetUrl } from "./collaboration-assets";
  import { defaultMember, groupOutfits, loadCostumeMemory, outfitMeta, rememberCostume, type OutfitCharacter, type OutfitVariant } from "./avatar-outfits";
  import { t } from "./i18n";

  // Picture grid for choosing an avatar outfit: one tile per character. The
  // first tap switches to that character (in its remembered costume); tapping
  // the selected tile again opens the costume sheet with the chan/kun twin and
  // every installed costume. The sheet replaces the grid in place instead of
  // floating outside it, because the avatar popover closes on outside clicks.
  export let outfits: readonly string[] = [];
  export let value = "";
  export let onselect: (outfit: string) => void = () => {};
  export let compact = false;
  export let label = "";

  let memory: Record<string, string> = loadCostumeMemory();
  // The tap shows its result at once: the parent's value can lag behind a
  // server round trip, so the picker highlights its own pick until it arrives.
  let picked = "";
  let flash = "";
  let sheetCharacter: string | null = null;
  let sheetVariant: OutfitVariant = "chan";

  $: groups = groupOutfits(outfits);
  $: if (picked && (picked === value || !outfits.includes(picked))) picked = "";
  $: selectedId = picked || value;
  $: current = outfitMeta(selectedId);
  $: sheet = sheetCharacter ? groups.flatMap(group => group.characters).find(entry => entry.character === sheetCharacter) ?? null : null;
  $: sheetVariants = sheet ? [...new Set(sheet.members.map(member => member.variant))] : [];
  $: sheetMembers = sheet ? sheet.members.filter(member => member.variant === sheetVariant || (sheetVariants.length === 1)) : [];

  $: shown = (entry: OutfitCharacter) => entry.members.find(member => member.id === selectedId) ?? defaultMember(entry, memory[entry.character]);
  $: isSelected = (entry: OutfitCharacter) => entry.members.some(member => member.id === selectedId);

  function choose(id: string) {
    rememberCostume(id);
    memory = loadCostumeMemory();
    sheetCharacter = null;
    picked = id;
    setTimeout(() => { if (picked === id) picked = ""; }, 5000);
    flash = outfitMeta(id).character;
    setTimeout(() => { if (flash === outfitMeta(id).character) flash = ""; }, 600);
    onselect(id);
  }
  function tap(entry: OutfitCharacter) {
    if (isSelected(entry)) {
      if (entry.members.length > 1) { sheetCharacter = entry.character; sheetVariant = current.variant ?? "chan"; }
      return;
    }
    choose(defaultMember(entry, memory[entry.character]).id);
  }
  function sheetKey(event: KeyboardEvent) {
    // Keep Escape from also closing the surrounding avatar popover.
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); sheetCharacter = null; }
  }
</script>

<div class="outfit-picker" class:compact class:sheet-open={Boolean(sheet)} role="radiogroup" aria-label={label || $t("character.avatarOutfit")}>
  {#if sheet}
    {@const head = shown(sheet)}
    <div class="outfit-sheet" role="dialog" aria-label={$t("avatar.costumeFor", { name: sheet.label })} tabindex="-1" onkeydown={sheetKey}>
      <div class="outfit-sheet-head">
        <img src={emotionAssetUrl(head.id, "neutral.webp")} alt="" draggable="false"/>
        <strong>{sheet.label}</strong>
        <button type="button" class="outfit-sheet-close" aria-label={$t("common.close")} title={$t("common.close")} onclick={() => sheetCharacter = null}><X size={15}/></button>
      </div>
      {#if sheetVariants.length > 1}
        <div class="outfit-variant-switch" role="group" aria-label={$t("avatar.outfitTwin")}>
          {#each sheetVariants as variant}
            {#if variant}<button type="button" class:on={sheetVariant === variant} aria-pressed={sheetVariant === variant} onclick={() => sheetVariant = variant}>{$t(`avatar.outfitVariant.${variant}`)}</button>{/if}
          {/each}
        </div>
      {/if}
      <div class="outfit-grid outfit-costumes">
        {#each sheetMembers as member (member.id)}
          <button type="button" role="radio" aria-checked={selectedId === member.id} class="outfit-tile" class:on={selectedId === member.id} onclick={() => choose(member.id)}>
            <img src={emotionAssetUrl(member.id, "neutral.webp")} alt="" loading="lazy" decoding="async" draggable="false"/>
            <span class="outfit-name">{$t(`avatar.costume.${member.costume}`)}</span>
          </button>
        {/each}
      </div>
    </div>
  {:else}
    {#each groups as group (group.series)}
      {#if groups.length > 1}<p class="outfit-group-title">{$t(`avatar.outfitGroup.${group.series}`)}</p>{/if}
      <div class="outfit-grid">
        {#each group.characters as entry (entry.character)}
          {@const member = shown(entry)}
          {@const selected = isSelected(entry)}
          <button type="button" role="radio" aria-checked={selected} class="outfit-tile" class:on={selected} class:flash={flash === entry.character} title={entry.label} onclick={() => tap(entry)}>
            <img src={emotionAssetUrl(member.id, "neutral.webp")} alt="" loading="lazy" decoding="async" draggable="false"/>
            <span class="outfit-name">{entry.label}</span>
            {#if member.variant && entry.members.some(item => item.variant === "kun")}<span class="outfit-variant" data-variant={member.variant}>{$t(`avatar.outfitVariant.${member.variant}`)}</span>{/if}
            {#if selected && entry.members.length > 1}<span class="outfit-more">{$t("avatar.changeCostume")}<ChevronDown size={11}/></span>{/if}
          </button>
        {/each}
      </div>
    {/each}
  {/if}
</div>
