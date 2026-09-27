import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { translateFor } from "../../src/web/i18n/index.js";
import { providerDisplayName } from "../../src/web/provider-display.js";
import { SETTINGS_GROUPS, SETTINGS_PAGE_IDS, filterSettingsGroups, legacySettingsTab, normalizeSettingsPage, providerOfPage, providerPage, settingsPageLabel, settingsPageMatches } from "../../src/web/settings/settings-nav.js";
import { countSettingChanges, countSignatureChanges } from "../../src/web/settings/settings-changes.js";

const ko = (key: string, params?: Record<string, string | number>) => translateFor("ko", key, params);
const web = (file: string) => fs.readFileSync(path.join(process.cwd(), "src", "web", file), "utf8");

describe("settings information architecture", () => {
  it("groups every page exactly once under the five groups", () => {
    const listed = SETTINGS_GROUPS.flatMap(group => group.pages);
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual([...SETTINGS_PAGE_IDS].sort());
    expect(SETTINGS_GROUPS.map(group => group.id)).toEqual(["personal", "agents", "environment", "integrations", "admin"]);
    expect(SETTINGS_GROUPS[1].pages).toEqual(["policy", "provider-claude", "provider-codex", "provider-antigravity", "provider-grok", "provider-deepseek", "provider-ollama"]);
  });

  it("labels pages in Korean and agents by their display name", () => {
    expect(settingsPageLabel("general", ko, providerDisplayName)).toBe("일반·화면");
    expect(settingsPageLabel("hosts", ko, providerDisplayName)).toBe("호스트·Worker");
    expect(settingsPageLabel("provider-antigravity", ko, providerDisplayName)).toBe("Gemini");
    for (const locale of ["en", "ko", "ja"] as const) {
      for (const page of SETTINGS_PAGE_IDS) {
        const label = settingsPageLabel(page, (key, params) => translateFor(locale, key, params), providerDisplayName);
        expect(label, `${locale}:${page}`).not.toMatch(/^settings\./);
      }
    }
  });

  it("maps the old modal tab ids, deep links, and the setup wizard onto pages", () => {
    expect(legacySettingsTab("display")).toBe("general");
    expect(legacySettingsTab("defaults")).toBe("policy");
    expect(legacySettingsTab("account")).toBe("provider-codex");
    expect(legacySettingsTab("infrastructure")).toBe("hosts");
    expect(legacySettingsTab("host")).toBe("hosts");
    expect(legacySettingsTab("external-access")).toBe("access");
    expect(legacySettingsTab("nonsense")).toBeNull();
    expect(normalizeSettingsPage("provider-claude")).toBe("provider-claude");
    expect(normalizeSettingsPage("characters")).toBe("provider-claude");
    expect(normalizeSettingsPage(null)).toBe("general");
    expect(providerOfPage("provider-grok")).toBe("grok");
    expect(providerOfPage("git")).toBeNull();
    expect(providerPage("ollama")).toBe("provider-ollama");
  });

  it("finds pages by their own label and by the labels of the settings they hold", () => {
    expect(settingsPageMatches("general", "언어", ko, providerDisplayName)).toBe(true);
    expect(settingsPageMatches("notifications", "진동", ko, providerDisplayName)).toBe(true);
    expect(settingsPageMatches("provider-deepseek", "api 키", ko, providerDisplayName)).toBe(true);
    expect(settingsPageMatches("git", "언어", ko, providerDisplayName)).toBe(false);
    const groups = filterSettingsGroups("Proton", ko, providerDisplayName);
    expect(groups.map(group => group.pages)).toEqual([["storage"]]);
    expect(filterSettingsGroups("", ko, providerDisplayName)).toHaveLength(SETTINGS_GROUPS.length);
  });

  it("renders the settings as a full page with a grouped nav, search, and a sticky save bar", () => {
    const view = web("settings/SettingsView.svelte");
    expect(view).toContain('class="global-settings settings-page"');
    expect(view).toContain('class="settings-search"');
    expect(view).toContain('class="settings-tabs settings-nav"');
    expect(view).toContain('class="settings-save-row sticky"');
    expect(view).toContain('$t("settings.revert")');
    expect(view).toContain('$t("settings.changedCount", { count: changeCount })');
    const app = web("App.svelte");
    expect(app).not.toContain('class="modal global-settings"');
    expect(app).toContain("<SettingsView bind:page={globalTab}");
    expect(app).toContain("<ProviderPage provider={settingsProvider} bind:tab={providerSettingsTab}");
    expect(app).toContain('<InfrastructureSettings {api} showAccessActivity={false} showParticipants={false} showExternalAccess={false}');
    expect(app).toContain("<AccessSecurityPage {api}/>");
    expect(app).toContain("<ExternalParticipantSettings {api}/>");
    expect(web("settings/ProviderPage.svelte")).toContain("PROVIDER_TABS");
    expect(web("styles.css")).toContain(".settings-page .settings-tab-panel{flex:1;width:100%;max-width:760px");
  });
});

describe("settings change counting", () => {
  it("counts changed keys instead of reporting a bare dirty flag", () => {
    const before = JSON.stringify({ a: 1, b: "x", nested: { p: 1, q: 2 } });
    expect(countSignatureChanges(before, before)).toBe(0);
    expect(countSignatureChanges(before, JSON.stringify({ a: 2, b: "x", nested: { p: 1, q: 2 } }))).toBe(1);
    expect(countSignatureChanges(before, JSON.stringify({ a: 2, b: "y", nested: { p: 9, q: 3 } }))).toBe(4);
    expect(countSettingChanges({ defaults: before, display: "{}" }, { defaults: before, display: JSON.stringify({ theme: "dark" }) })).toBe(1);
  });

  it("treats a missing baseline as unchanged", () => {
    expect(countSettingChanges({}, { defaults: JSON.stringify({ a: 1 }) })).toBe(0);
    expect(countSignatureChanges(undefined, "{}")).toBe(0);
  });
});
