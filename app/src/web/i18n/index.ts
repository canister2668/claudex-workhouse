import { derived, get } from "svelte/store";
import { requestJson } from "../api-client";
import { en, type TranslationKey } from "./en";
import { ja } from "./ja";
import { ko } from "./ko";
import { detectBrowserLocale, getCachedLocale, locale, setLocale } from "./locale-store";
import { isSupportedLocale, type InterpolationValues, type SupportedLocale } from "./types";

export { locale, setLocale } from "./locale-store";
export * from "./formatters";
export * from "./types";
export type { TranslationKey } from "./en";

const dictionaries = { en, ko, ja } as const;
const warned = new Set<string>();
const development = import.meta.env?.DEV === true;

function interpolate(template: string, params: InterpolationValues = {}, key?: string) {
  return template.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (_, name: string) => {
    if (Object.hasOwn(params, name)) return String(params[name]);
    if (development && key && !warned.has(`${key}:${name}`)) {
      warned.add(`${key}:${name}`);
      console.warn(`[i18n] missing interpolation variable "${name}" for "${key}"`);
    }
    return `{${name}}`;
  });
}

export function translateFor(locale: SupportedLocale, key: TranslationKey | string, params?: InterpolationValues) {
  const current = dictionaries[locale] as Record<string, string>;
  const fallback = en as Record<string, string>;
  const template = current[key] ?? fallback[key];
  if (template === undefined) {
    if (development && !warned.has(key)) { warned.add(key); console.warn(`[i18n] missing key: ${key}`); }
    return development ? `[missing:${key}]` : key;
  }
  return interpolate(template, params, key);
}

export type Translator = (key: TranslationKey | string, params?: InterpolationValues) => string;
export const t = derived(locale, ($locale): Translator => (key, params) => translateFor($locale, key, params));
export const translate: Translator = (key, params) => translateFor(get(locale), key, params);
export const currentLocale = () => get(locale);

export function plural(baseKey: string, count: number, params: InterpolationValues = {}) {
  const current = get(locale);
  const category = new Intl.PluralRules(current).select(count);
  const specific = `${baseKey}.${category}`;
  const other = `${baseKey}.other`;
  const dictionary = dictionaries[current] as Record<string, string>;
  return translateFor(current, dictionary[specific] || (en as Record<string,string>)[specific] ? specific : other, { count, ...params });
}

export async function initializeLocale() {
  let response: any = null;
  try { response = await requestJson("/api/system-settings/locale"); } catch { /* keep cache/browser preview */ }
  const browser = typeof navigator === "undefined" ? "en" : detectBrowserLocale(navigator.languages, navigator.language);
  const resolved: SupportedLocale = isSupportedLocale(response?.locale)
    ? response.locale
    : getCachedLocale() ?? browser ?? "en";
  setLocale(resolved);
  if (response && response.saved !== true) {
    try { await requestJson("/api/system-settings/locale", { method:"PUT", headers:{"Idempotency-Key":crypto.randomUUID()}, body:JSON.stringify({ locale:resolved }) }); } catch { /* server will remain authoritative once saving succeeds */ }
  }
  return resolved;
}

export async function saveLocale(next: SupportedLocale) {
  if (!isSupportedLocale(next)) throw Object.assign(new Error("Unsupported locale"), { code:"LOCALE_SAVE_FAILED" });
  const previous = get(locale);
  setLocale(next);
  try {
    const response: any = await requestJson("/api/system-settings/locale", { method:"PUT", headers:{"Idempotency-Key":crypto.randomUUID()}, body:JSON.stringify({ locale:next }) });
    if (!isSupportedLocale(response?.locale)) throw new Error("Invalid locale response");
    setLocale(response.locale);
    return response.locale;
  } catch (error) {
    setLocale(previous);
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), { code:"LOCALE_SAVE_FAILED" });
  }
}

export function dictionaryKeyCount() { return Object.keys(en).length; }
export function translateError(error: unknown) {
  const source = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const code = typeof source.code === "string" ? source.code : "UNKNOWN";
  const original = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const key = `error.${code}`;
  const localized = (en as Record<string,string>)[key] ? translate(key) : translate("error.title");
  return { title:localized, message:original && original !== localized ? original : "", code };
}
export function validateDictionaries() {
  const reference = Object.keys(en).sort();
  return (["ko", "ja"] as const).flatMap((language) => {
    const keys = Object.keys(dictionaries[language]).sort();
    const missing = reference.filter((key) => !keys.includes(key));
    const extra = keys.filter((key) => !reference.includes(key));
    const interpolation = reference.flatMap((key) => {
      const expected = [...en[key as TranslationKey].matchAll(/\{([^}]+)\}/g)].map(match => match[1]).sort().join(",");
      const actual = [...(dictionaries[language][key as TranslationKey] ?? "").matchAll(/\{([^}]+)\}/g)].map(match => match[1]).sort().join(",");
      return expected === actual ? [] : [`${language}:${key}:${expected}!=${actual}`];
    });
    return [...missing.map(key => `${language}:missing:${key}`), ...extra.map(key => `${language}:extra:${key}`), ...interpolation];
  });
}
