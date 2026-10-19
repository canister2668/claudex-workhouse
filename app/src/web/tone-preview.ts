import { emotionAssetUrl } from "./collaboration-assets";
import { TONE_PRESETS, type TonePreset } from "./character-settings";
import type { EmotionAssetEntry } from "./emotion-state";

// A tone card shows the avatar's own emotion art instead of a label-only
// option. Each tone lists the emotions that read as that tone, best first;
// not every outfit ships every emotion, so the card walks this list against
// the installed catalog and always ends on `neutral`, which every outfit has.
export const TONE_PREVIEW_EMOTIONS:Record<TonePreset,readonly string[]>={
  "default":["neutral"],
  "playful-school-friend":["laughing","excited","wink"],
  "baby-talk-cutesy":["happy"],
  "flirty-friend":["wink","love","smug"],
  "coy-affection":["chu","embarrassed","love"],
  "tsundere":["pout","embarrassed","angry"],
  "sharp-tongue":["speechless","smug","disgusted"],
  "mesugaki-brat":["smug","laughing","wink"],
  "aristocratic-ojosama":["proud","smug","happy"],
  "contempt-roleplay":["disgusted","disappointed","speechless"],
  "lewd-guardian-comedy":["love","embarrassed","nervous"],
  "secretary":["reading","thinking"],
  "whale-girl":["excited","happy","surprised"],
  "custom":["thinking"]
};

export const MAX_TONE_FAVORITES=3;
export const DEFAULT_TONE_FAVORITES:readonly TonePreset[]=["default","flirty-friend","tsundere"];

const KNOWN_TONES=new Set<string>(TONE_PRESETS.map(preset=>preset.id));
export function isTonePreset(value:unknown):value is TonePreset{return typeof value==="string"&&KNOWN_TONES.has(value);}

// Emotions to try for one tone. With a catalog for the outfit, emotions the
// outfit does not ship are dropped up front so the card does not flash a
// broken image; without one (catalog not loaded yet) the full list is kept and
// the card falls back image by image on load errors.
export function toneEmotionChain(tone:TonePreset,available?:readonly EmotionAssetEntry[]|null):string[]{
  const wanted=[...TONE_PREVIEW_EMOTIONS[tone]??[],"neutral"];
  const installed=available?.length?new Set(available.map(asset=>asset.emotion)):null;
  const chain=installed?wanted.filter(emotion=>emotion==="neutral"||installed.has(emotion)):wanted;
  return [...new Set(chain)];
}

// Image URLs in fallback order. A catalog entry names the real file (some
// emotions ship as `coding_2.webp` and the like); otherwise `<emotion>.webp`.
export function tonePreviewSources(outfit:string,tone:TonePreset,available?:readonly EmotionAssetEntry[]|null):string[]{
  if(!outfit)return [];
  return toneEmotionChain(tone,available).map(emotion=>{
    const file=available?.find(asset=>asset.emotion===emotion&&asset.file===`${emotion}.webp`)?.file??available?.find(asset=>asset.emotion===emotion)?.file??`${emotion}.webp`;
    return emotionAssetUrl(outfit,file);
  });
}

// Favorites arrive from storage or a parent and may be stale: drop unknown
// tones and duplicates, keep the order, cap at three.
export function normalizeToneFavorites(values:unknown):TonePreset[]{
  if(!Array.isArray(values))return [];
  return [...new Set(values.filter(isTonePreset))].slice(0,MAX_TONE_FAVORITES);
}

// Adding to a full list is refused rather than evicting the oldest pick, so a
// favorite never disappears without the user removing it.
export function toggleToneFavorite(favorites:readonly TonePreset[],tone:TonePreset):{next:TonePreset[];changed:boolean}{
  const current=normalizeToneFavorites(favorites);
  if(current.includes(tone))return{next:current.filter(item=>item!==tone),changed:true};
  if(current.length>=MAX_TONE_FAVORITES)return{next:current,changed:false};
  return{next:[...current,tone],changed:true};
}
