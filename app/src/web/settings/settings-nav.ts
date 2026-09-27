// Settings information architecture: five groups, one page each, with the
// six agent pages sharing one component. Page ids are also the persisted
// "deck-global-settings-tab" values, so an unknown id falls back to the first.
import type { Translator } from "../i18n";

export type SettingsProviderId = "codex" | "claude" | "antigravity" | "grok" | "deepseek" | "ollama";
export const SETTINGS_PROVIDERS: readonly SettingsProviderId[] = ["claude", "codex", "antigravity", "grok", "deepseek", "ollama"];

export const SETTINGS_PAGE_IDS = [
  "general", "notifications",
  "policy", "provider-claude", "provider-codex", "provider-antigravity", "provider-grok", "provider-deepseek", "provider-ollama",
  "workspace", "hosts", "git",
  "mcp",
  "participants", "storage",
  "access", "system", "about"
] as const;
export type SettingsPageId = (typeof SETTINGS_PAGE_IDS)[number];

export type SettingsGroupId = "personal" | "agents" | "environment" | "integrations" | "admin";
export type SettingsGroup = { id: SettingsGroupId; labelKey: string; pages: SettingsPageId[] };

export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  { id: "personal", labelKey: "settings.group.personal", pages: ["general", "notifications"] },
  { id: "agents", labelKey: "settings.group.agents", pages: ["policy", "provider-claude", "provider-codex", "provider-antigravity", "provider-grok", "provider-deepseek", "provider-ollama"] },
  { id: "environment", labelKey: "settings.group.environment", pages: ["workspace", "hosts", "git"] },
  { id: "integrations", labelKey: "settings.group.integrations", pages: [
    "mcp",
    "participants", "storage"
  ] },
  { id: "admin", labelKey: "settings.group.admin", pages: ["access", "system", "about"] }
];

export type ProviderTab = "defaults" | "account" | "character" | "runtime" | "delegation";
export const PROVIDER_TABS: readonly ProviderTab[] = ["defaults", "account", "character", "runtime", "delegation"];

// Keys whose translated text a page should be found by, in addition to its
// own label. Kept as dictionary keys so every locale searches its own words.
const PAGE_KEYWORDS: Record<SettingsPageId, string[]> = {
  general: ["language.label", "settings.section.language", "settings.theme", "settings.palette", "settings.skin", "settings.sessionTextSize", "settings.conversationTextSize", "display.avatars", "display.statusBubbles", "display.enterToSend", "display.rememberLast", "display.hidePaths", "character.avatarDisplay"],
  notifications: ["display.completionNotifications", "display.approvalNotifications", "display.userInputNotifications", "display.failureNotifications", "display.hostOfflineNotifications", "display.handoffNotifications", "display.vibration", "display.quietHours"],
  policy: ["execution.defaultAgent", "billing.allowPaidCredits", "delegation.toOtherProvider", "policy.defaultEffort", "policy.defaultAutomation", "automation.level", "model.reasoningEffort"],
  "provider-claude": ["model.claudeModels", "claudeExecution.switchModelsOnFlag", "auth.connectClaudeSubscription", "character.toneLabel", "runtime.title"],
  "provider-codex": ["model.codexModels", "auth.connectCodex", "model.speed", "character.toneLabel", "runtime.title"],
  "provider-antigravity": ["antigravityExecution.backend", "auth.connectAntigravity", "provider.antigravity", "character.toneLabel"],
  "provider-grok": ["auth.connectGrok", "provider.grok", "character.toneLabel"],
  "provider-deepseek": ["auth.deepseekApiKey", "auth.deepseekBaseUrl", "provider.deepseek"],
  "provider-ollama": ["auth.ollamaToken", "auth.ollamaBaseUrl", "provider.ollama"],
  workspace: ["host.projects", "nav.workspaces", "host.newProject", "host.newWorkspace", "workspace.instructions"],
  hosts: ["infrastructure.title", "infrastructure.executionDevices", "infrastructure.connectWorker", "infrastructure.installServer"],
  git: ["git.settings", "git.connectGitHub", "git.tokenTitle"],
  mcp: ["mcp.title", "mcp.settingsTab"],
  participants: ["settings.page.participants"],
  storage: ["artifacts.title", "snapshot.title", "proton.title", "settings.artifacts", "settings.storage"],
  access: ["accessActivity.title", "settings.page.access"],
  system: ["setup.settingsTitle", "diagnostic.system", "applicationUpdate.title", "runtime.title", "runtime.checkUpdates"],
  about: ["about.title"]
};

export const isProviderPage = (page: SettingsPageId): page is `provider-${SettingsProviderId}` => page.startsWith("provider-");
export const providerOfPage = (page: SettingsPageId): SettingsProviderId | null => isProviderPage(page) ? (page.slice("provider-".length) as SettingsProviderId) : null;
export const providerPage = (provider: SettingsProviderId): SettingsPageId => `provider-${provider}` as SettingsPageId;

export function normalizeSettingsPage(value: string | null | undefined, fallback: SettingsPageId = "general"): SettingsPageId {
  return (SETTINGS_PAGE_IDS as readonly string[]).includes(String(value)) ? (value as SettingsPageId) : legacySettingsTab(value) ?? fallback;
}

// The pre-redesign tab ids still arrive from persisted storage, deep links
// (?view=host), the setup wizard, and the infrastructure actions.
export function legacySettingsTab(tab: string | null | undefined): SettingsPageId | null {
  switch (tab) {
    case "display": return "general";
    case "defaults": return "policy";
    case "characters": return "provider-claude";
    case "account": case "provider-connections": return "provider-codex";
    case "infrastructure": case "host": return "hosts";
    case "external-access": return "access";
    case "proton": return "storage";
    case "workspace": case "storage": case "system": case "about": case "mcp": case "git": return tab;
    default: return null;
  }
}

export function settingsPageLabel(page: SettingsPageId, translate: Translator, providerName: (provider: SettingsProviderId) => string): string {
  const provider = providerOfPage(page);
  if (provider) return providerName(provider);
  return translate(`settings.page.${page}`);
}

export function settingsPageMatches(page: SettingsPageId, query: string, translate: Translator, providerName: (provider: SettingsProviderId) => string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [settingsPageLabel(page, translate, providerName), page, ...(PAGE_KEYWORDS[page] ?? []).map(key => translate(key))].join("\n").toLowerCase();
  return haystack.includes(needle);
}

export function filterSettingsGroups(query: string, translate: Translator, providerName: (provider: SettingsProviderId) => string, visible: (page: SettingsPageId) => boolean = () => true): SettingsGroup[] {
  return SETTINGS_GROUPS.map(group => ({ ...group, pages: group.pages.filter(page => visible(page) && settingsPageMatches(page, query, translate, providerName)) })).filter(group => group.pages.length > 0);
}
