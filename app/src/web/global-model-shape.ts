export type GlobalModelEntry={id:string;displayName:string;source:"runtime"|"custom";validatedAt:string|null};
export type GlobalModelSettings={version:1;claude:{models:GlobalModelEntry[]};codex:{models:GlobalModelEntry[]};deepseek:{models:GlobalModelEntry[]};ollama:{models:GlobalModelEntry[]};antigravity:{models:GlobalModelEntry[]};grok:{models:GlobalModelEntry[]}};

// A model settings response is keyed by provider. A response that omits one
// provider — an older server, a provider added after that response was cached,
// or a partial failure — used to replace the whole client-side record, so the
// missing key became `undefined` and the next `[...candidates[provider]]`
// threw "is not iterable" and took the entire UI down with a fatal overlay.
// Both readers normalize onto a complete record instead.
export const MODEL_PROVIDERS = ["claude", "codex", "grok", "deepseek", "ollama", "antigravity"] as const;
export type ModelProvider = (typeof MODEL_PROVIDERS)[number];

export function emptyGlobalModelSettings(): GlobalModelSettings {
  return { version: 1, claude: { models: [] }, codex: { models: [] }, grok: { models: [] }, deepseek: { models: [] }, ollama: { models: [] }, antigravity: { models: [] } } as GlobalModelSettings;
}

const entries = (value: unknown): GlobalModelEntry[] =>
  Array.isArray(value) ? (value.filter((item) => item && typeof item === "object") as GlobalModelEntry[]) : [];

export function normalizeGlobalModelSettings(value: unknown): GlobalModelSettings {
  const source = value && typeof value === "object" ? (value as Record<string, any>) : {};
  const settings = emptyGlobalModelSettings() as Record<string, any>;
  if (typeof source.version === "number") settings.version = source.version;
  for (const provider of MODEL_PROVIDERS) settings[provider] = { models: entries(source[provider]?.models) };
  return settings as GlobalModelSettings;
}

export function normalizeModelCandidates(value: unknown): Record<ModelProvider, GlobalModelEntry[]> {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return Object.fromEntries(MODEL_PROVIDERS.map((provider) => [provider, entries(source[provider])])) as Record<ModelProvider, GlobalModelEntry[]>;
}
