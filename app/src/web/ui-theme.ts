export const PALETTES = ["forest", "ocean", "violet", "sunset", "rose", "mono"] as const;
export type Palette = typeof PALETTES[number];

export const SKINS = ["soft", "elevated", "outline", "compact", "terminal", "flat"] as const;
export type Skin = typeof SKINS[number];

export const TEXT_SIZES = ["small", "medium", "comfortable", "large"] as const;
export type TextSize = typeof TEXT_SIZES[number];

export function normalizePalette(value: string | null): Palette {
  return PALETTES.includes(value as Palette) ? value as Palette : "forest";
}

export function normalizeSkin(value: string | null): Skin {
  return SKINS.includes(value as Skin) ? value as Skin : "soft";
}

export function normalizeTextSize(value: string | null): TextSize {
  return TEXT_SIZES.includes(value as TextSize) ? value as TextSize : "medium";
}
