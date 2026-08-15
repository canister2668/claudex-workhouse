import { describe, expect, it } from "vitest";
import { MODEL_PROVIDERS, normalizeGlobalModelSettings, normalizeModelCandidates } from "../../src/web/global-model-shape.js";

const entry = { id: "m", displayName: "M", source: "runtime", validatedAt: null };

describe("global model settings shape", () => {
  it("fills in every provider a partial response omits", () => {
    const candidates = normalizeModelCandidates({ claude: [entry], codex: [] });
    for (const provider of MODEL_PROVIDERS) expect(Array.isArray(candidates[provider]), provider).toBe(true);
    expect(candidates.claude).toEqual([entry]);
    expect(candidates.deepseek).toEqual([]);
    // The crash this guards: spreading a missing provider threw "is not iterable".
    expect(() => [...candidates.antigravity]).not.toThrow();
  });

  it("accepts a missing, null, or non-object response", () => {
    for (const value of [undefined, null, "", 3, []]) {
      const candidates = normalizeModelCandidates(value);
      const settings = normalizeGlobalModelSettings(value);
      for (const provider of MODEL_PROVIDERS) {
        expect(candidates[provider]).toEqual([]);
        expect(settings[provider].models).toEqual([]);
      }
    }
  });

  it("keeps a provider entry that carries no models array", () => {
    const settings = normalizeGlobalModelSettings({ version: 1, codex: {}, claude: { models: [entry] }, ollama: { models: "nope" } });
    expect(settings.codex.models).toEqual([]);
    expect(settings.ollama.models).toEqual([]);
    expect(settings.claude.models).toEqual([entry]);
    expect(() => settings.deepseek.models.map((item) => item.id)).not.toThrow();
  });

  it("drops non-object entries rather than passing them to the UI", () => {
    expect(normalizeModelCandidates({ codex: [entry, null, "x", 1] }).codex).toEqual([entry]);
  });
});
