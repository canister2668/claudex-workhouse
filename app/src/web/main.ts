// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Claudex Workhouse.

import { mount } from "svelte";
import App from "./App.svelte";
import { initializeLocale } from "./i18n";
import { normalizePalette, normalizeSkin, normalizeTextSize } from "./ui-theme";

// Visible crash reporter: a blank screen on mobile gives no console, so
// surface uncaught errors as an on-screen banner instead.
function showFatal(message: string) {
  let box = document.getElementById("fatal-error") as HTMLPreElement | null;
  if (!box) {
    box = document.createElement("pre");
    box.id = "fatal-error";
    box.style.cssText = "position:fixed;left:8px;right:8px;bottom:8px;z-index:99999;background:#4a1f1f;color:#ffd6d6;padding:10px;border-radius:10px;font-size:11px;line-height:1.4;white-space:pre-wrap;word-break:break-all;max-height:45vh;overflow:auto;margin:0";
    document.body.appendChild(box);
  }
  box.textContent = `${box.textContent ? box.textContent + "\n\n" : ""}${message}`.slice(-4000);
}
window.addEventListener("error", (event) => showFatal(`JS ERROR: ${event.message}\n${event.error?.stack ?? `${event.filename}:${event.lineno}`}`));
window.addEventListener("unhandledrejection", (event) => showFatal(`PROMISE ERROR: ${event.reason?.message ?? String(event.reason)}\n${event.reason?.stack ?? ""}`));
import "./styles.css";
import "./sessions.css";

// Apply the saved theme before first paint so there is no flash of the wrong scheme.
const savedTheme = localStorage.getItem("deck-theme");
if (savedTheme === "light" || savedTheme === "dark") document.documentElement.dataset.theme = savedTheme;
const savedPalette = normalizePalette(localStorage.getItem("deck-palette"));
if (savedPalette !== "forest") document.documentElement.dataset.palette = savedPalette;
const savedSkin = normalizeSkin(localStorage.getItem("deck-skin"));
if (savedSkin !== "soft") document.documentElement.dataset.skin = savedSkin;
const savedSessionTextSize = normalizeTextSize(localStorage.getItem("deck-session-text-size"));
if (savedSessionTextSize !== "medium") document.documentElement.dataset.sessionTextSize = savedSessionTextSize;
const savedConversationTextSize = normalizeTextSize(localStorage.getItem("deck-conversation-text-size"));
if (savedConversationTextSize !== "medium") document.documentElement.dataset.conversationTextSize = savedConversationTextSize;

try {
  mount(App, { target: document.getElementById("app")! });
  void initializeLocale();
} catch (error) {
  showFatal(`MOUNT ERROR: ${error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error)}`);
}

// The service worker is push-only: it has no fetch handler and never caches the
// shell, API responses, or transcripts. Register it only when a previous
// installation already has a worker; App.svelte registers it on push setup.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      if (registrations.length) navigator.serviceWorker.register("/sw.js").catch(() => {});
    }).catch(() => {});
  });
}
