import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BADGE_STATES, BADGE_TONE, badgeLabelKey, taskBadgeState } from "../../src/web/ui/status-badge";
import { en } from "../../src/web/i18n/en";
import { ko } from "../../src/web/i18n/ko";
import { ja } from "../../src/web/i18n/ja";

const web = (file: string) => fs.readFileSync(path.join(process.cwd(), "src", "web", file), "utf8");

describe("status badge", () => {
  it("defines exactly five task states with one tone each", () => {
    expect(BADGE_STATES).toEqual(["running", "attention", "delayed", "failed", "completed"]);
    expect(BADGE_TONE).toEqual({ running: "warn", attention: "warn", delayed: "warn", failed: "err", completed: "ok" });
  });

  it("collapses every provider status onto one of the five", () => {
    expect(taskBadgeState("running")).toBe("running");
    expect(taskBadgeState("pending")).toBe("running");
    expect(taskBadgeState("queued")).toBe("running");
    expect(taskBadgeState("running", { delayed: true })).toBe("delayed");
    expect(taskBadgeState("waiting")).toBe("attention");
    expect(taskBadgeState("waiting-user")).toBe("attention");
    expect(taskBadgeState("waiting-approval")).toBe("attention");
    expect(taskBadgeState("failed")).toBe("failed");
    expect(taskBadgeState("stopped")).toBe("failed");
    expect(taskBadgeState("completed")).toBe("completed");
    expect(taskBadgeState(undefined)).toBe("running");
  });

  it("has one word per state in every locale", () => {
    for (const state of BADGE_STATES) {
      const key = badgeLabelKey(state);
      for (const dictionary of [en, ko, ja] as Array<Record<string, string>>) {
        expect(dictionary[key], key).toBeTruthy();
        expect(dictionary[key].length, key).toBeLessThanOrEqual(16);
      }
    }
    expect((ko as Record<string, string>)["status.badge.attention"]).toBe("확인 필요");
    expect((ko as Record<string, string>)["status.badge.delayed"]).toBe("응답 지연");
  });

  it("never pairs a healthy connection label with a red indicator in the session rail", () => {
    const app = web("App.svelte");
    expect(app).not.toContain('$t("common.normal"):$t("common.unknown")');
    expect(app).toContain('{#if workerOnline(selected.executionHostId)===false}');
    expect(web("SessionBadges.svelte")).toContain("<StatusBadge");
  });

  it("ships the ultra reasoning effort label in every locale", () => {
    for (const dictionary of [en, ko, ja] as Array<Record<string, string>>) expect(dictionary["session.effort.ultra"]).toBeTruthy();
  });
});
