import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SESSION_VIEW_TABS, groupSessions, sessionGroupKey, viewTabStatusFilter } from "../../src/web/session-groups";
import { filterPaletteCommands, isPaletteShortcut, paletteCommandMatches, type PaletteCommand } from "../../src/web/command-palette";

const app = fs.readFileSync(path.join(process.cwd(), "src", "web", "App.svelte"), "utf8");
const styles = fs.readFileSync(path.join(process.cwd(), "src", "web", "styles.css"), "utf8");
const snippet = app.slice(app.indexOf("{#snippet shellUtilities"), app.indexOf("{/snippet}", app.indexOf("{#snippet shellUtilities")));

describe("app shell", () => {
  it("renders one top header at every width and the bottom tab bar with a more sheet on phones", () => {
    expect(app).toContain('<header class="mobile-topbar app-topbar">');
    expect(app).toContain('{#if !compactShell}<nav class="primary-nav topbar-nav" aria-label={$t("nav.primary")}>{@render primaryNavButtons(true)}</nav>{/if}');
    expect(app).not.toContain('class="app-sidebar"');
    expect(app).not.toContain("session-split");
    expect(app).toContain('<nav class="primary-nav mobile-tabbar" aria-label={$t("nav.primary")}>');
    expect(app).toContain('class="new-button tab-create"');
    expect(app).toContain("const MOBILE_NAV_WIDTH=760");
    expect(app).toContain("$: compactShell=viewportWidth<=MOBILE_NAV_WIDTH");
    expect(app).toContain("$: if(!compactShell&&overflowOpen)closeOverflow();");
    expect(styles).toContain(".app-topbar{display:flex;");
    expect(styles).not.toContain("--sidebar-width");
  });

  it("renders the utility actions from one definition for the sidebar and the phone sheet", () => {
    expect(app).toContain("{#snippet shellUtilities(labelled:boolean)}");
    expect(app.match(/\{@render shellUtilities\(/g)).toHaveLength(2);
    for (const key of ["quota.title", "a11y.openSettings", "a11y.openSearch", "common.refresh"]) expect(snippet).toContain(`aria-label={$t("${key}")}`);
    const clicks = snippet.match(/onclick=\{\(\)=>\{/g) ?? [];
    expect(clicks.length).toBeGreaterThanOrEqual(4);
    expect(snippet.match(/closeOverflow\(\)/g)).toHaveLength(clicks.length);
  });

  it("keeps the phone sheet in the top layer, placed inside the visible band, dismissed by tapping away", () => {
    expect(app).toContain('class="topbar-overflow more-sheet" popover="manual"');
    expect(app).toContain("use:dismissOnOutside={{onDismiss:closeOverflow");
    expect(app).toContain("const band=currentViewportBand(),rect=trigger.getBoundingClientRect();");
    expect(app).toContain("popoverPlacement({top:rect.top,bottom:rect.bottom,left:rect.right-width}");
    expect(app).toContain('window.visualViewport?.addEventListener("resize",overflowReposition)');
    const base = styles.slice(styles.indexOf(".topbar-overflow{"), styles.indexOf("}", styles.indexOf(".topbar-overflow{")));
    expect(base).not.toMatch(/display:/);
    expect(styles).toContain(".topbar-overflow:popover-open{display:grid}");
  });

  it("keeps a single agent avatar dock in the header, with status dots as the alternative", () => {
    expect(app).toContain("{#if showAvatars}{@render agentDock()}{:else if !compactShell}");
    expect(app.match(/\{@render agentDock\(\)\}/g)).toHaveLength(1);
    expect(app.match(/<AgentAvatarDock /g)?.length).toBe(1);
    expect(app).toContain('class="sidebar-agent-dot tone-{agentStateTone(recent)}"');
  });

  it("keeps the engine tabs one click away and the filter chips reactive", () => {
    expect(app).toContain('<nav class="filters engine-tabs" aria-label={$t("session.engineFilter")}>');
    expect(app).toContain("$: filterChips=activeFilterChips(engine,");
    expect(app).toContain("{#each filterChips as chip (chip.id)}");
    expect(app).not.toMatch(/\{#if activeFilterChips\(\)/);
  });

  it("opens the command palette with ⌘K / Ctrl+K", () => {
    expect(app).toContain('window.addEventListener("keydown",paletteKey)');
    expect(app).toContain("<CommandPalette bind:open={paletteOpen} commands={paletteCommands()}/>");
    expect(isPaletteShortcut({ key: "k", metaKey: true, ctrlKey: false, altKey: false })).toBe(true);
    expect(isPaletteShortcut({ key: "K", metaKey: false, ctrlKey: true, altKey: false })).toBe(true);
    expect(isPaletteShortcut({ key: "k", metaKey: false, ctrlKey: false, altKey: false })).toBe(false);
    expect(isPaletteShortcut({ key: "k", metaKey: true, ctrlKey: false, altKey: true })).toBe(false);
  });

  it("keeps the brand mark as the favicon and the brand copy hidden on phones", () => {
    expect(app).toContain('class="brand-app-icon" src="/icons/favicon.svg"');
    expect(styles).toContain(".brand-app-icon{display:block");
    expect(styles).toMatch(/@media\(max-width:599px\)\{[\s\S]*?\.brand-copy\{display:none\}/);
  });
});

describe("command palette filtering", () => {
  const commands: PaletteCommand[] = [
    { id: "a", group: "이동", label: "세션", run() {} },
    { id: "b", group: "새 작업", label: "Claude로 새 작업", keywords: ["claude", "작업 생성"], run() {} },
    { id: "c", group: "설정", label: "설정 › 일반·화면", keywords: ["general"], run() {} },
    { id: "d", group: "최근 세션", label: "README 정리", hint: "Codex · 3분 전", keywords: ["codex"], run() {} }
  ];
  it("matches on label, hint, and keywords, requiring every word", () => {
    expect(paletteCommandMatches(commands[1], "claude")).toBe(true);
    expect(paletteCommandMatches(commands[1], "claude 작업")).toBe(true);
    expect(paletteCommandMatches(commands[1], "claude git")).toBe(false);
    expect(paletteCommandMatches(commands[3], "codex")).toBe(true);
    expect(filterPaletteCommands(commands, "")).toHaveLength(4);
  });
  it("ranks label prefixes above keyword hits", () => {
    expect(filterPaletteCommands(commands, "설정").map(command => command.id)).toEqual(["c"]);
    expect(filterPaletteCommands(commands, "새 작업").map(command => command.id)).toEqual(["b"]);
  });
});

describe("session grouping", () => {
  const now = new Date("2026-09-27T12:00:00.000Z");
  it("groups running first, then today, yesterday, earlier", () => {
    expect(sessionGroupKey({ status: "running", updatedAt: "2026-09-01T00:00:00.000Z" }, now)).toBe("running");
    expect(sessionGroupKey({ status: "waiting", updatedAt: "2026-09-01T00:00:00.000Z" }, now)).toBe("running");
    expect(sessionGroupKey({ status: "completed", updatedAt: "2026-09-27T01:00:00.000Z" }, now)).toBe("today");
    expect(sessionGroupKey({ status: "failed", updatedAt: "2026-09-26T13:00:00.000Z" }, now)).toBe("yesterday");
    expect(sessionGroupKey({ status: "completed", updatedAt: "2026-09-20T13:00:00.000Z" }, now)).toBe("earlier");
    expect(sessionGroupKey({ status: "completed", updatedAt: "not a date" }, now)).toBe("earlier");
    const grouped = groupSessions([
      { id: 1, status: "completed", updatedAt: "2026-09-20T13:00:00.000Z" },
      { id: 2, status: "running", updatedAt: "2026-09-27T11:00:00.000Z" },
      { id: 3, status: "completed", updatedAt: "2026-09-27T09:00:00.000Z" }
    ], now);
    expect(grouped.map(group => [group.key, group.items.map(item => item.id)])).toEqual([["running", [2]], ["today", [3]], ["earlier", [1]]]);
  });
  it("maps the five view tabs onto the status filter", () => {
    expect(SESSION_VIEW_TABS).toEqual(["all", "active", "waiting", "failed", "collaboration"]);
    expect(viewTabStatusFilter("active")).toBe("active");
    expect(viewTabStatusFilter("collaboration")).toBe("");
    expect(viewTabStatusFilter("all")).toBe("");
    expect(app).toContain('<nav class="session-view-tabs" aria-label={$t("session.statusFilter")}>');
    expect(app).toContain('<h3 class="session-group-head"><span>{$t(`sessions.group.${group.key}`)}</span>');
    expect(app).toContain('class="session-filter-pop" popover="manual"');
    expect(app).toContain('{$t("bulk.select")}');
    expect(app).not.toContain('{$t("bulk.description")}');
  });
});
