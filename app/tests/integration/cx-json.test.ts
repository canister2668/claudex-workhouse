import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

const cwd = "/tmp/claudex-workhouse-cx-json-tests";
const cxBinary = "/usr/local/bin/cx";
beforeAll(() => fs.mkdirSync(cwd, { recursive: true }));
function cx(args: string[]) { return spawnSync(cxBinary, args, { cwd, encoding: "utf8" }); }

describe.skipIf(!fs.existsSync(cxBinary))("cx JSON contract", () => {
  it.each([
    ["ls", ["ls", cwd, "--json"]],
    ["status", ["status", "--json"]]
  ])("returns parseable %s JSON on stdout", (command, args) => {
    const result = cx(args);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, command });
  },15000);

  it("reports a healthy doctor result or only transient broker failures", () => {
    const result = cx(["doctor", "--json"]);
    const body = JSON.parse(result.stdout);
    const checks = body.result.checks as Array<{name:string;ok:boolean}>;
    const failed = checks.filter((item) => !item.ok);
    expect(result.status).toBe(failed.length ? 1 : 0);
    expect(body.result.passed).toBe(checks.length - failed.length);
    expect(body.result.failed).toBe(failed.length);
    expect(failed.every((item) => item.name.startsWith("broker "))).toBe(true);
  });

  it("returns JSON and a nonzero exit for failures", () => {
    const result = cx(["show", "missing-claudex-workhouse-job", "--json"]);
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, command: "show" });
    expect(result.stderr).toContain("No cx job matches");
  });
});
