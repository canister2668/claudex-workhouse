import { writable } from "svelte/store";
import { isSupportedLocale, type SupportedLocale } from "./types";

export const LOCALE_CACHE_KEY = "claudex-ui-locale";

export function mapBrowserLocale(value: string | null | undefined): SupportedLocale {
  const language = (value ?? "").trim().toLowerCase().split("-")[0];
  return language === "ko" || language === "ja" || language === "en" ? language : "en";
}

export function detectBrowserLocale(languages?: readonly string[], language?: string): SupportedLocale {
  for (const candidate of languages ?? []) {
    const mapped = mapBrowserLocale(candidate);
    if (candidate && (candidate.toLowerCase().startsWith("ko") || candidate.toLowerCase().startsWith("ja") || candidate.toLowerCase().startsWith("en"))) return mapped;
  }
  return mapBrowserLocale(language);
}

function cachedLocale(): SupportedLocale | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const cached = localStorage.getItem(LOCALE_CACHE_KEY);
    return isSupportedLocale(cached) ? cached : null;
  } catch { return null; }
}

function initialLocale(): SupportedLocale {
  const cached = cachedLocale();
  if (cached) return cached;
  if (typeof window !== "undefined" && typeof navigator !== "undefined") return detectBrowserLocale(navigator.languages, navigator.language);
  // Non-browser consumers preserve the legacy Korean UI. Browser clients use
  // the explicit detection chain above and unsupported browser tags map to en.
  return "ko";
}

function applyLocale(locale: SupportedLocale) {
  if (typeof document !== "undefined") document.documentElement.lang = locale;
  if (typeof localStorage !== "undefined") {
    try { localStorage.setItem(LOCALE_CACHE_KEY, locale); } catch { /* cache is best effort */ }
  }
}

const store = writable<SupportedLocale>(initialLocale());
export const locale = { subscribe: store.subscribe };

export function setLocale(locale: SupportedLocale) {
  applyLocale(locale);
  store.set(locale);
}

export function getCachedLocale() { return cachedLocale(); }

if (typeof document !== "undefined") {
  const cached = cachedLocale();
  applyLocale(cached ?? initialLocale());
}
