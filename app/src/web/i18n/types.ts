export const SUPPORTED_LOCALES = ["ko", "en", "ja"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export type InterpolationValues = Record<string, string | number>;

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}
