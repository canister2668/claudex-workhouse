import { describe, expect, it } from "vitest";
import { buildSay, particle } from "../../src/web/create-summary.js";

const rendered = (template: string, values: Record<string, string>) =>
  buildSay(template, values).map((part) => part.value).join("");

describe("create panel summary sentence", () => {
  it("agrees the Korean particle with the preceding value", () => {
    expect(particle("Codex", "이가")).toBe("가");
    expect(particle("클로드", "이가")).toBe("가");
    expect(particle("코덱스", "이가")).toBe("가");
    expect(particle("독립 검토", "을를")).toBe("를");
    expect(particle("전체 권한", "을를")).toBe("을");
    expect(particle("전체 권한", "으로")).toBe("으로");
    expect(particle("자동", "으로")).toBe("으로");
    expect(particle("계획 먼저", "으로")).toBe("로");
  });

  it("treats a latin or numeric tail as having no final consonant", () => {
    expect(particle("gpt-5.4", "이가")).toBe("가");
    expect(particle("claudex-workhouse", "을를")).toBe("를");
  });

  it("renders slots and text in template order", () => {
    const parts = buildSay("{provider}[이가] {workspace}에서 {automation}[으로] 실행", {
      provider: "Codex", workspace: "claudex-workhouse", automation: "전체 권한"
    });
    expect(parts.map((part) => part.kind)).toEqual(["slot", "text", "slot", "text", "slot", "text"]);
    expect(parts.filter((part) => part.kind === "slot").map((part) => part.value))
      .toEqual(["Codex", "claudex-workhouse", "전체 권한"]);
    expect(rendered("{provider}[이가] {workspace}에서 {automation}[으로] 실행", {
      provider: "Codex", workspace: "claudex-workhouse", automation: "전체 권한"
    })).toBe("Codex가 claudex-workhouse에서 전체 권한으로 실행");
  });

  it("drops an empty slot together with its particle and extra spacing", () => {
    expect(rendered("{first}[이가] {others}[와과] 대화", { first: "Codex", others: "" }))
      .toBe("Codex가 대화");
    expect(rendered("{first}[이가] {others}[와과] 대화", { first: "Codex", others: "Claude" }))
      .toBe("Codex가 Claude와 대화");
  });

  it("leaves a template without markers untouched", () => {
    expect(rendered("{provider} runs in {workspace}", { provider: "Codex", workspace: "app" }))
      .toBe("Codex runs in app");
  });
});
