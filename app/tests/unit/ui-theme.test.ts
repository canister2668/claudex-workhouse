import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PALETTES, SKINS, TEXT_SIZES, normalizePalette, normalizeSkin, normalizeTextSize } from "../../src/web/ui-theme.js";

const web=(file:string)=>fs.readFileSync(path.join(process.cwd(),"src","web",file),"utf8");

describe("display themes",()=>{
  it("normalizes persisted values to safe defaults",()=>{
    expect(PALETTES).toEqual(["forest","ocean","violet","sunset","rose","mono"]);
    expect(SKINS).toEqual(["soft","elevated","outline","compact","terminal","flat"]);
    expect(normalizePalette("ocean")).toBe("ocean");
    expect(normalizePalette("unknown")).toBe("forest");
    expect(normalizeSkin("compact")).toBe("compact");
    expect(normalizeSkin("unknown")).toBe("soft");
    expect(TEXT_SIZES).toEqual(["small","medium","comfortable","large"]);
    expect(normalizeTextSize("large")).toBe("large");
    expect(normalizeTextSize("unknown")).toBe("medium");
  });

  it("applies palette and skin before mounting the app",()=>{
    const source=web("main.ts");
    expect(source.indexOf('localStorage.getItem("deck-palette")')).toBeLessThan(source.indexOf("mount(App"));
    expect(source.indexOf('localStorage.getItem("deck-skin")')).toBeLessThan(source.indexOf("mount(App"));
    expect(source.indexOf('localStorage.getItem("deck-session-text-size")')).toBeLessThan(source.indexOf("mount(App"));
    expect(source.indexOf('localStorage.getItem("deck-conversation-text-size")')).toBeLessThan(source.indexOf("mount(App"));
  });

  it("offers explicit save, discard, and continue choices on dirty close",()=>{
    const source=web("App.svelte");
    expect(source).toContain("settingsClosePrompt=true");
    expect(source).toContain("saveAndCloseGlobalSettings");
    expect(source).toContain("discardAndCloseGlobalSettings");
    expect(source).toContain('$t("settings.keepEditing")');
    expect(source).toContain("async function saveGlobalSettings():Promise<boolean>");
  });
});
