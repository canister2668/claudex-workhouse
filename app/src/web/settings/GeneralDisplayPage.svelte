<script lang="ts">
  // 개인 › 일반·화면. Language, appearance (one accent colour + card style),
  // reading sizes, agent display, and behaviour toggles. Every control writes
  // the same stored key it did in the old modal.
  import { Check } from "@lucide/svelte";
  import { locale, t, type SupportedLocale } from "../i18n";
  import { AVATAR_COLLAPSE_DELAYS, AVATAR_TRAY_SHAPES, type AvatarTrayShape } from "../avatar-notice";
  import { PALETTES, SKINS, TEXT_SIZES, type Palette, type Skin, type TextSize } from "../ui-theme";
  import SettingRow from "../ui/SettingRow.svelte";
  import Switch from "../ui/Switch.svelte";
  import SettingsSection from "./SettingsSection.svelte";

  type AvatarDisplay = "character" | "name-mark";

  export let theme: "auto" | "light" | "dark" = "auto";
  export let palette: Palette = "forest";
  export let skin: Skin = "soft";
  export let sessionTextSize: TextSize = "medium";
  export let conversationTextSize: TextSize = "medium";
  export let applyTheme: (value: "auto" | "light" | "dark") => void;
  export let applyPalette: (value: Palette) => void;
  export let applySkin: (value: Skin) => void;
  export let applySessionTextSize: (value: TextSize) => void;
  export let applyConversationTextSize: (value: TextSize) => void;
  export let paletteSwatches: Record<Palette, [string, string, string]>;
  export let localeSaving = false;
  export let localeNotice = "";
  export let chooseLocale: (event: Event) => void;
  export let avatarDisplay: AvatarDisplay = "character";
  export let updateAvatarDisplay: (value: AvatarDisplay) => void;
  export let showAvatars = true;
  export let showSpeech = true;
  export let avatarAutoCollapse = true;
  export let avatarCollapseDelayMs = 5000;
  export let avatarTrayShape: AvatarTrayShape = "auto";
  export let changeAvatarTrayShape: (shape: AvatarTrayShape) => void;
  export let scrollAutoSwitch = true;
  export let immersiveScroll = true;
  export let enterToSend = true;
  export let rememberLast = true;
  export let hideLocalPaths = false;
</script>

<p class="settings-page-body">{$t("settings.page.general.body")}</p>

<SettingsSection title={$t("settings.section.language")}>
  <SettingRow label={$t("language.label")} id="settings-locale">
    <select id="settings-locale" class="language-select" value={$locale} disabled={localeSaving} onchange={chooseLocale} aria-label={$t("language.label")}><option value="ko">{$t("language.option.ko")}</option><option value="en">{$t("language.option.en")}</option><option value="ja">{$t("language.option.ja")}</option></select>
  </SettingRow>
  {#if localeNotice}<p class="locale-notice" class:error={localeNotice === $t("language.saveFailed")} aria-live="polite">{localeNotice}</p>{/if}
</SettingsSection>

<SettingsSection title={$t("settings.section.appearance")}>
  <SettingRow label={$t("settings.theme")}>
    <div class="segments three"><button type="button" class:active={theme === "auto"} onclick={() => applyTheme("auto")}>{$t("settings.theme.auto")}</button><button type="button" class:active={theme === "light"} onclick={() => applyTheme("light")}>{$t("settings.theme.light")}</button><button type="button" class:active={theme === "dark"} onclick={() => applyTheme("dark")}>{$t("settings.theme.dark")}</button></div>
  </SettingRow>
  <SettingRow label={$t("settings.section.accent")} help={$t("settings.section.accentBody")} stacked>
    <div class="accent-picker" role="group" aria-label={$t("settings.palette")}>
      {#each PALETTES as option}
        <button type="button" class="accent-swatch" class:active={palette === option} aria-pressed={palette === option} title={$t(`settings.palette.${option}`)} aria-label={$t(`settings.palette.${option}`)} style={`--swatch:${paletteSwatches[option][0]}`} onclick={() => applyPalette(option)}>{#if palette === option}<Check size={14}/>{/if}</button>
      {/each}
      <span class="accent-picker-label">{$t(`settings.palette.${palette}`)}</span>
    </div>
    <div class="skin-grid" role="group" aria-label={$t("settings.skin")}>
      {#each SKINS as option}
        <button type="button" class:active={skin === option} aria-pressed={skin === option} onclick={() => applySkin(option)}>
          <span class="skin-preview skin-preview-{option}" aria-hidden="true"><i></i><i></i></span>
          <strong>{$t(`settings.skin.${option}`)}</strong>{#if skin === option}<Check size={15}/>{/if}
        </button>
      {/each}
    </div>
  </SettingRow>
</SettingsSection>

<SettingsSection title={$t("settings.section.reading")}>
  <SettingRow label={$t("settings.sessionTextSize")}>
    <div class="segments four text-size-segments">{#each TEXT_SIZES as option}<button type="button" class:active={sessionTextSize === option} aria-pressed={sessionTextSize === option} onclick={() => applySessionTextSize(option)}>{$t(`settings.textSize.${option}`)}</button>{/each}</div>
  </SettingRow>
  <SettingRow label={$t("settings.conversationTextSize")}>
    <div class="segments four text-size-segments">{#each TEXT_SIZES as option}<button type="button" class:active={conversationTextSize === option} aria-pressed={conversationTextSize === option} onclick={() => applyConversationTextSize(option)}>{$t(`settings.textSize.${option}`)}</button>{/each}</div>
  </SettingRow>
</SettingsSection>

<SettingsSection title={$t("settings.section.agentDisplay")}>
  <SettingRow label={$t("character.avatarDisplay")} help={$t("character.avatarDisplayBody")}>
    <div class="segments"><button type="button" class:active={avatarDisplay === "character"} onclick={() => updateAvatarDisplay("character")}>{$t("character.avatarDisplay.character")}</button><button type="button" class:active={avatarDisplay === "name-mark"} onclick={() => updateAvatarDisplay("name-mark")}>{$t("character.avatarDisplay.nameMark")}</button></div>
  </SettingRow>
  <SettingRow label={$t("display.avatars")} help={$t("display.avatarsBody")}><Switch bind:checked={showAvatars} label={$t("display.avatars")}/></SettingRow>
  <SettingRow label={$t("display.statusBubbles")} help={$t("display.statusBubblesBody")}><Switch bind:checked={showSpeech} label={$t("display.statusBubbles")}/></SettingRow>
  <SettingRow label={$t("display.autoCollapse")} help={$t("display.autoCollapseBody")}><Switch bind:checked={avatarAutoCollapse} label={$t("display.autoCollapse")}/></SettingRow>
  <SettingRow label={$t("display.collapseDelay")} help={$t("display.collapseDelayBody")}>
    <select bind:value={avatarCollapseDelayMs} disabled={!avatarAutoCollapse} aria-label={$t("display.collapseDelay")}>{#each AVATAR_COLLAPSE_DELAYS as delay}<option value={delay}>{$t("format.seconds", { count: delay / 1000 })}</option>{/each}</select>
  </SettingRow>
  <SettingRow label={$t("display.noticeShape")} help={$t("display.noticeShapeBody")}>
    <select value={avatarTrayShape} onchange={(event) => changeAvatarTrayShape((event.currentTarget as HTMLSelectElement).value as AvatarTrayShape)} disabled={!showAvatars || !showSpeech} aria-label={$t("display.noticeShape")}>{#each AVATAR_TRAY_SHAPES as shape}<option value={shape}>{$t(`display.noticeShape.${shape}`)}</option>{/each}</select>
  </SettingRow>
</SettingsSection>

<SettingsSection title={$t("settings.section.behavior")}>
  <SettingRow label={$t("display.scrollButton")} help={$t("display.scrollButtonBody")}><Switch bind:checked={scrollAutoSwitch} label={$t("display.scrollButton")}/></SettingRow>
  <SettingRow label={$t("display.immersiveScroll")} help={$t("display.immersiveScrollBody")}><Switch bind:checked={immersiveScroll} label={$t("display.immersiveScroll")}/></SettingRow>
  <SettingRow label={$t("display.enterToSend")} help={$t("display.enterToSendBody")}><Switch bind:checked={enterToSend} label={$t("display.enterToSend")}/></SettingRow>
  <SettingRow label={$t("display.rememberLast")} help={$t("display.rememberLastBody")}><Switch bind:checked={rememberLast} label={$t("display.rememberLast")}/></SettingRow>
  <SettingRow label={$t("display.hidePaths")} help={$t("display.hidePathsBody")}><Switch bind:checked={hideLocalPaths} label={$t("display.hidePaths")}/></SettingRow>
</SettingsSection>
