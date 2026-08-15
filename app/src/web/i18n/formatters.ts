import type { SupportedLocale } from "./types";

const localeTag: Record<SupportedLocale, string> = { ko:"ko-KR", en:"en-US", ja:"ja-JP" };

export function formatDateTime(value: string | number | Date, locale: SupportedLocale) {
  return new Intl.DateTimeFormat(localeTag[locale], { year:"numeric", month:locale === "en" ? "short" : "numeric", day:"numeric", hour:"numeric", minute:"2-digit" }).format(new Date(value));
}

export function formatCardDateTime(value: string | number | Date, locale: SupportedLocale) {
  return new Intl.DateTimeFormat(localeTag[locale], { month:"numeric", day:"numeric", hour:"2-digit", minute:"2-digit", hourCycle:"h23" }).format(new Date(value));
}

export function formatRelativeTime(value: string | number | Date, locale: SupportedLocale, now = Date.now()) {
  const delta = new Date(value).getTime() - now;
  const abs = Math.abs(delta);
  const [amount, unit]: [number, Intl.RelativeTimeFormatUnit] = abs < 60_000
    ? [Math.round(delta / 1_000), "second"]
    : abs < 3_600_000 ? [Math.round(delta / 60_000), "minute"]
    : abs < 86_400_000 ? [Math.round(delta / 3_600_000), "hour"]
    : [Math.round(delta / 86_400_000), "day"];
  return new Intl.RelativeTimeFormat(localeTag[locale], { numeric:"auto" }).format(amount, unit);
}

export function formatNumber(value: number, locale: SupportedLocale, options?: Intl.NumberFormatOptions) {
  return new Intl.NumberFormat(localeTag[locale], options).format(value);
}

export function formatCurrency(value: number, currency: string, locale: SupportedLocale) {
  // A provider can settle in any currency, so fall back to a plain code prefix
  // rather than letting Intl throw on one it does not recognize.
  try { return formatNumber(value, locale, { style:"currency", currency }); }
  catch { return `${currency} ${formatNumber(value, locale, { minimumFractionDigits:2, maximumFractionDigits:2 })}`; }
}

export function formatPercentage(value: number, locale: SupportedLocale) {
  return formatNumber(value, locale, { style:"percent", maximumFractionDigits:1 });
}

/** Formats a value that is already expressed on the 0..100 percentage scale. */
export function formatQuotaPercentage(value: number, locale: SupportedLocale) {
  return formatNumber(value, locale, { maximumFractionDigits:1 });
}

export function formatFileSize(bytes: number, locale: SupportedLocale) {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = bytes === 0 ? 0 : Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${formatNumber(value, locale, { maximumFractionDigits:index === 0 ? 0 : 1 })} ${units[index]}`;
}

export function formatList(values: string[], locale: SupportedLocale) {
  return new Intl.ListFormat(localeTag[locale], { style:"long", type:"conjunction" }).format(values);
}
