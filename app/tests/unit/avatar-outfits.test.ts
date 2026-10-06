import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PROVIDER_EMOTION_OUTFITS } from "../../src/server/emotion";
import { EMOTION_NAMES } from "../../src/server/mcp-emotion";
import { defaultMember, groupOutfits, outfitMeta } from "../../src/web/avatar-outfits";

const EMOTICONS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "emoticons");

describe("avatar outfits", () => {
  // A provider can only switch to a folder that exists, and the fallback chain
  // drops to neutral when an emotion file is missing; an incomplete set would
  // silently show the wrong face instead of failing.
  it("ships every allowed outfit with the full emotion set", () => {
    const allowed = new Set(Object.values(PROVIDER_EMOTION_OUTFITS).flat());
    for (const outfit of allowed) {
      expect(existsSync(join(EMOTICONS, outfit)), outfit).toBe(true);
      const files = readdirSync(join(EMOTICONS, outfit)).filter(name => name.endsWith(".webp")).map(name => name.slice(0, -5)).sort();
      expect(files, outfit).toEqual([...EMOTION_NAMES].sort());
    }
  });

  it("keeps each provider's classic set first so the fallback does not move", () => {
    expect(PROVIDER_EMOTION_OUTFITS.codex[0]).toBe("Gpt-Codex");
    expect(PROVIDER_EMOTION_OUTFITS.claude[0]).toBe("normal");
    expect(PROVIDER_EMOTION_OUTFITS.antigravity[0]).toBe("Antigravity");
    expect(PROVIDER_EMOTION_OUTFITS.grok[0]).toBe("Grok");
    expect(PROVIDER_EMOTION_OUTFITS.deepseek[0]).toBe("DeepSeek");
    expect(PROVIDER_EMOTION_OUTFITS.ollama[0]).toBe("Ollama");
  });

  it("labels V5 twins and costumes and keeps unknown folders visible", () => {
    expect(outfitMeta("Claude-code")).toMatchObject({ label: "Claude Code", series: "v5", variant: "chan", costume: "default", character: "Claude-code" });
    expect(outfitMeta("Claude-code-kun-formal")).toMatchObject({ label: "Claude Code", variant: "kun", costume: "formal", character: "Claude-code" });
    expect(outfitMeta("Gpt-Sol-v5-swimsuit")).toMatchObject({ label: "Sol", variant: "chan", costume: "swimsuit", character: "Gpt-Sol-v5" });
    expect(outfitMeta("Gpt-Sol-kun")).toMatchObject({ label: "Sol", variant: "kun", costume: "default", character: "Gpt-Sol-v5" });
    expect(outfitMeta("Gpt-Sol")).toMatchObject({ label: "Sol", series: "classic", variant: null });
    expect(outfitMeta("Someone-new-dress")).toMatchObject({ label: "Someone-new-dress", series: "classic", costume: "default" });
  });

  it("collapses twins and costumes into one tile per character", () => {
    const groups = groupOutfits(PROVIDER_EMOTION_OUTFITS.codex);
    expect(groups.map(group => group.series)).toEqual(["v5", "classic"]);
    expect(groups[0].characters.map(entry => entry.character)).toEqual(["Gpt-Codex-v5", "Gpt-Sol-v5", "Astra-code", "Chat-code"]);
    expect(groups[1].characters.map(entry => entry.character)).toEqual(["Gpt-Codex", "Gpt-Sol"]);
    const astra = groups[0].characters[2];
    expect(astra.members.map(member => member.id)).toEqual(["Astra-code", "Astra-code-dress", "Astra-code-swimsuit", "Astra-code-pajamas", "Astra-code-towel", "Astra-code-kun", "Astra-code-kun-formal", "Astra-code-kun-swimsuit", "Astra-code-kun-pajamas", "Astra-code-kun-towel"]);
    expect(defaultMember(astra).id).toBe("Astra-code");
    expect(defaultMember(astra, "Astra-code-kun-towel").id).toBe("Astra-code-kun-towel");
    expect(defaultMember(astra, "Gone-outfit").id).toBe("Astra-code");
  });
});
