import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { mapClaudeResetCredits, mapCodexQuota, mapCodexResetCredits } from "../../src/server/quota.js";
import { CLAUDE_RESET_CREDITS_OK_MS, CLAUDE_RESET_CREDITS_RATE_LIMIT_MS, createClaudeResetCreditsReader, readClaudeAccessToken } from "../../src/server/claude-reset-credits.js";

const NOW = Date.UTC(2026, 9, 11, 4, 0, 0);
const epoch = (iso: string) => Date.parse(iso) / 1000;

describe("Codex reset credits", () => {
  it("lists available credits by expiry and keeps the reported count", () => {
    const mapped = mapCodexResetCredits({ availableCount: 3, credits: [
      { id: "b", resetType: "codexRateLimits", status: "available", grantedAt: 1, expiresAt: epoch("2026-11-10T00:00:00Z"), title: "Full reset", description: null },
      { id: "a", resetType: "codexRateLimits", status: "available", grantedAt: 1, expiresAt: epoch("2026-10-30T00:00:00Z"), title: "Full reset", description: null },
      { id: "used", resetType: "codexRateLimits", status: "redeemed", grantedAt: 1, expiresAt: null, title: null, description: null }
    ] }, NOW);
    expect(mapped).toEqual({ available: 3, credits: [
      { id: "a", title: "Full reset", count: 1, expiresAt: "2026-10-30T00:00:00.000Z", usableNow: null },
      { id: "b", title: "Full reset", count: 1, expiresAt: "2026-11-10T00:00:00.000Z", usableNow: null }
    ] });
  });

  it("treats a missing summary as unknown, and a count-only summary as known", () => {
    expect(mapCodexResetCredits(null)).toBeNull();
    expect(mapCodexResetCredits({ credits: [] })).toBeNull();
    expect(mapCodexResetCredits({ availableCount: 2, credits: null })).toEqual({ available: 2, credits: [] });
  });

  it("carries the summary through the Codex quota mapping", () => {
    const quota = mapCodexQuota({ rateLimits: { primary: { usedPercent: 10, windowDurationMins: 300 } }, rateLimitResetCredits: { availableCount: 0, credits: [] } });
    expect(quota?.resetCredits).toEqual({ available: 0, credits: [] });
    expect(mapCodexQuota({ rateLimits: { primary: { usedPercent: 10, windowDurationMins: 300 } } })).not.toHaveProperty("resetCredits");
  });
});

describe("Claude reset credits", () => {
  const grant = { id: "launch", label: "Launch reset", resets_total: 1, resets_left: 1, starts_at: "2026-09-22T16:00:00+00:00", ends_at: "2026-10-22T16:00:00+00:00", paused: false, usable_now: true };

  it("sums remaining resets across live grants", () => {
    const mapped = mapClaudeResetCredits({ cedar_ember: { eligible: true, grants: [grant, { ...grant, id: "spent", resets_left: 0 }, { ...grant, id: "old", ends_at: "2026-10-01T00:00:00Z" }, { ...grant, id: "two", resets_left: 2, ends_at: null, usable_now: false }] } }, NOW);
    expect(mapped).toEqual({ available: 3, credits: [
      { id: "launch", title: "Launch reset", count: 1, expiresAt: "2026-10-22T16:00:00.000Z", usableNow: true },
      { id: "two", title: "Launch reset", count: 2, expiresAt: null, usableNow: false }
    ] });
  });

  it("does not report zero passes when the program is not offered", () => {
    expect(mapClaudeResetCredits({ cedar_ember: { eligible: false, ineligible_reason: "surface", grants: [] } })).toBeNull();
    expect(mapClaudeResetCredits({ cedar_ember: null })).toBeNull();
    expect(mapClaudeResetCredits({ cedar_ember: { eligible: true, grants: [] } })).toEqual({ available: 0, credits: [] });
  });
});

describe("Claude reset credit reader", () => {
  const homes: string[] = [];
  afterEach(() => { for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true }); });
  function home(oauth: Record<string, unknown>) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "reset-credits-"));
    homes.push(directory);
    fs.mkdirSync(path.join(directory, ".claude"));
    fs.writeFileSync(path.join(directory, ".claude", ".credentials.json"), JSON.stringify({ claudeAiOauth: oauth }));
    return directory;
  }
  const body = { cedar_ember: { eligible: true, grants: [{ id: "launch", label: "Launch", resets_left: 1, ends_at: "2026-10-22T16:00:00Z", usable_now: true }] } };

  it("skips an expired token instead of refreshing it", () => {
    const file = path.join(home({ accessToken: "t", expiresAt: NOW + 30_000 }), ".claude", ".credentials.json");
    expect(readClaudeAccessToken(file, NOW)).toBeNull();
    expect(readClaudeAccessToken(file, NOW - 3_600_000)).toBe("t");
  });

  it("identifies as the CLI, caches success, and backs off on 429", async () => {
    let now = NOW;
    const calls: Array<Record<string, string>> = [];
    let status = 200;
    const reader = createClaudeResetCreditsReader({
      claudeBinary: "claude", cwd: "/", home: home({ accessToken: "secret", expiresAt: NOW + 3_600_000_000 }), now: () => now, cliVersion: async () => "9.9.9",
      fetcher: async (_url, init) => { calls.push(init.headers); return { status, ok: status === 200, headers: { get: () => null }, json: async () => body }; }
    });
    expect((await reader.current())?.available).toBe(1);
    expect(calls[0]).toMatchObject({ Authorization: "Bearer secret", "x-app": "cli", "User-Agent": "claude-cli/9.9.9 (external, cli)" });
    now += CLAUDE_RESET_CREDITS_OK_MS - 1;
    await reader.current();
    expect(calls).toHaveLength(1);
    now += 1; status = 429;
    expect((await reader.current())?.available).toBe(1);
    expect(calls).toHaveLength(2);
    now += CLAUDE_RESET_CREDITS_RATE_LIMIT_MS - 1;
    await reader.current();
    expect(calls).toHaveLength(2);
  });
});
