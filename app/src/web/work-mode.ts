export type WorkMode = "default" | "plan";

type Provider="codex"|"claude"|"deepseek"|"ollama"|"antigravity"|"grok";
export function workModeOf(provider:Provider, permission:string|null|undefined, metadata:Record<string,unknown>|null|undefined):WorkMode {
  if (metadata?.workMode === "plan") return "plan";
  if (metadata?.workMode === "default") return "default";
  return provider !== "codex" && permission === ":read-only" ? "plan" : "default";
}

export function workModeLabel(provider:Provider, mode:WorkMode) {
  if (mode === "plan") return translate("workMode.plan");
  return translate("workMode.default");
}

export function permissionForWorkMode(provider:Provider, mode:WorkMode, current:string) {
  if (provider === "codex") return current;
  if (mode === "plan") return ":read-only";
  return current === ":read-only" ? ":workspace-write" : current;
}
import { translate } from "./i18n";
