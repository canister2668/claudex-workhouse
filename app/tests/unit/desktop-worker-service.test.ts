import { describe, expect, it } from "vitest";
import { systemdExecArgument } from "../../src/server/desktop-worker/service.js";

describe("desktop Worker service rendering", () => {
  it("quotes spaces, percent specifiers, quotes, and backslashes in systemd arguments", () => {
    expect(systemdExecArgument("/home/한 글/100%/node")).toBe(
      '"/home/한 글/100%%/node"'
    );
    expect(systemdExecArgument('/home/user/a"b\\node')).toBe(
      '"/home/user/a\\"b\\\\node"'
    );
  });

  it("rejects arguments that could inject another unit line", () => {
    expect(() => systemdExecArgument("/tmp/node\nEnvironment=BAD=1")).toThrow(
      /Invalid systemd executable path/
    );
  });
});
