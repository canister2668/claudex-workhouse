// Display metadata for avatar outfit folders under app/public/emoticons.
// Folder names stay the stable ids stored in settings and state files; this
// table only decides how a picker labels and groups them. Unknown folders still
// appear (as "classic", labelled by folder name) so a newly installed set is
// never hidden by a missing entry here.
//
// AI Families V5 ids are <character>[-kun][-<costume>]: "Claude-code",
// "Claude-code-kun", "Claude-code-dress", "Claude-code-kun-formal".

export type OutfitSeries = "v5" | "classic";
export type OutfitVariant = "chan" | "kun" | null;
// formal is the -kun counterpart of the -chan dress.
export const COSTUMES = ["default", "dress", "formal", "swimsuit", "pajamas", "towel"] as const;
export type Costume = (typeof COSTUMES)[number];
export type OutfitMeta = { id: string; label: string; series: OutfitSeries; variant: OutfitVariant; costume: Costume; character: string };

const CLASSIC: Record<string, string> = {
  normal: "Claude", capy: "Fable", "Gpt-Codex": "Codex", "Gpt-Sol": "Sol", Grok: "Grok",
  Antigravity: "Gemini", "Gemma-e4b": "Gemma E4B", DeepSeek: "DeepSeek", Ollama: "Ollama", WhaleGirl: "Whale"
};

// AI Families V5 chibi sets. Three ids carry "-v5" because the classic set
// already owns the plain folder name.
const V5: Record<string, string> = {
  "Claude-code": "Claude Code", "Fable-code": "Fable Code",
  "Gpt-Codex-v5": "Codex", "Gpt-Sol-v5": "Sol", "Astra-code": "Astra Code", "Chat-code": "Chat Code",
  "Gemini-code": "Gemini Code", "Gemma-e4b-v5": "Gemma E4B",
  "Grok-code": "Grok Code",
  "DeepSeek-code": "DeepSeek Code", "Ollama-code": "Ollama Code", "Whale-code": "Whale Code"
};

export function outfitMeta(id: string): OutfitMeta {
  if (CLASSIC[id]) return { id, label: CLASSIC[id], series: "classic", variant: null, costume: "default", character: id };
  let rest = id, costume: Costume = "default";
  for (const candidate of COSTUMES) {
    if (candidate !== "default" && rest.endsWith(`-${candidate}`)) { rest = rest.slice(0, -candidate.length - 1); costume = candidate; break; }
  }
  const kun = rest.endsWith("-kun");
  const base = kun ? rest.slice(0, -4) : rest;
  const v5Key = V5[base] ? base : V5[`${base}-v5`] ? `${base}-v5` : null;
  if (v5Key) return { id, label: V5[v5Key], series: "v5", variant: kun ? "kun" : "chan", costume, character: v5Key };
  return { id, label: id, series: "classic", variant: null, costume: "default", character: id };
}

// One picker tile per character: a V5 character's chan/kun twins and every
// costume share a tile, and the costume sheet chooses among its members.
export type OutfitCharacter = { character: string; label: string; series: OutfitSeries; members: OutfitMeta[] };
export type OutfitGroup = { series: OutfitSeries; characters: OutfitCharacter[] };

const costumeRank = (meta: OutfitMeta) => (meta.variant === "kun" ? 100 : 0) + COSTUMES.indexOf(meta.costume);

// V5 first, classic after; within a series the server's order (the allow-list
// order) decides where each character first appears.
export function groupOutfits(outfits: readonly string[]): OutfitGroup[] {
  const characters = new Map<string, OutfitCharacter>();
  for (const id of outfits) {
    const meta = outfitMeta(id);
    const entry = characters.get(meta.character) ?? { character: meta.character, label: meta.label, series: meta.series, members: [] };
    entry.members.push(meta);
    characters.set(meta.character, entry);
  }
  for (const entry of characters.values()) entry.members.sort((a, b) => costumeRank(a) - costumeRank(b));
  const groups: OutfitGroup[] = [];
  for (const series of ["v5", "classic"] as const) {
    const list = [...characters.values()].filter(entry => entry.series === series);
    if (list.length) groups.push({ series, characters: list });
  }
  return groups;
}

// The member a tile shows and applies on first tap: the remembered choice for
// that character if it is still installed, otherwise the -chan default.
export function defaultMember(entry: OutfitCharacter, remembered?: string | null): OutfitMeta {
  return entry.members.find(member => member.id === remembered)
    ?? entry.members.find(member => member.variant !== "kun" && member.costume === "default")
    ?? entry.members[0];
}

const MEMORY_KEY = "deck-avatar-costume-memory";
export function loadCostumeMemory(): Record<string, string> {
  try { const value = JSON.parse(localStorage.getItem(MEMORY_KEY) || "{}"); return value && typeof value === "object" ? value : {}; } catch { return {}; }
}
export function rememberCostume(id: string) {
  try { const memory = loadCostumeMemory(); memory[outfitMeta(id).character] = id; localStorage.setItem(MEMORY_KEY, JSON.stringify(memory)); } catch { /* storage unavailable */ }
}
