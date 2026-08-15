import { z } from "zod";

export const supportedLocaleSchema = z.enum(["ko", "en", "ja"]);
export type SupportedLocale = z.infer<typeof supportedLocaleSchema>;

export const uiLocaleSettingsSchema = z.object({ locale: supportedLocaleSchema }).strict();

export function normalizeStoredLocale(value: unknown): SupportedLocale | null {
  const parsed = uiLocaleSettingsSchema.safeParse(value);
  return parsed.success ? parsed.data.locale : null;
}

const TASK_SUFFIXES={
  compact:{en:"Context compact",ko:"컨텍스트 정리",ja:"コンテキスト整理"},
  controlHandoff:{en:"Control handoff",ko:"제어권 인계",ja:"制御の引き継ぎ"}
} as const;
export function localizedTaskSuffix(locale:SupportedLocale,key:keyof typeof TASK_SUFFIXES){return TASK_SUFFIXES[key][locale];}
