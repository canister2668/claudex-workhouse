import { describe, expect, it } from "vitest";
import { stripAnsi } from "../../src/server/process.js";

describe("output safety", () => {
  it("removes ANSI control sequences without treating HTML as markup", () => {
    expect(stripAnsi("\u001b[31mfailed\u001b[0m <script>alert(1)</script>")).toBe("failed <script>alert(1)</script>");
  });
});
