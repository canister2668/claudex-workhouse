import {expect,it} from "vitest";
import {normalizeToneFavorites,toggleToneFavorite,tonePreviewSources} from "../../src/web/tone-preview";
it("keeps three unique known favorites without silently evicting one",()=>{
  expect(normalizeToneFavorites(["secretary","bad","secretary","tsundere","default","custom"])).toEqual(["secretary","tsundere","default"]);
  expect(toggleToneFavorite(["secretary","tsundere","default"],"custom")).toEqual({next:["secretary","tsundere","default"],changed:false});
  expect(toggleToneFavorite(["secretary","tsundere","default"],"tsundere")).toEqual({next:["secretary","default"],changed:true});
});
it("shows neutral for the default tone and happy for baby talk",()=>{
  const assets=[{emotion:"neutral",file:"neutral.webp"},{emotion:"happy",file:"happy.webp"},{emotion:"chu",file:"chu.webp"}];
  expect(tonePreviewSources("normal","default",assets)).toEqual(["/emoticons/normal/neutral.webp"]);
  expect(tonePreviewSources("normal","baby-talk-cutesy",assets)[0]).toMatch(/happy.webp$/);
});
it("uses installed emotion files and falls back to neutral",()=>{
  const sources=tonePreviewSources("normal","tsundere",[{emotion:"pout",file:"pout_2.webp"},{emotion:"neutral",file:"neutral.webp"}]);
  expect(sources).toHaveLength(2);expect(sources[0]).toMatch(/normal\/pout_2.webp$/);expect(sources[1]).toMatch(/normal\/neutral.webp$/);
  expect(tonePreviewSources("normal","secretary",[{emotion:"neutral",file:"neutral.webp"}])).toHaveLength(1);
});
