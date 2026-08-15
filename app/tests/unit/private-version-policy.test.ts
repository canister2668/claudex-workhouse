import { describe, expect, it } from "vitest";
import {
  assertPrivateVersionPolicy,
  PRIVATE_VERSION_MAX
} from "../../scripts/verify-private-version.mjs";

describe("private version policy", () => {
  it("allows versions up to and including 1.0.0 while private", () => {
    expect(PRIVATE_VERSION_MAX).toBe("1.0.0");
    expect(() => assertPrivateVersionPolicy({ private: true, version: "0.1.0" })).not.toThrow();
    expect(() => assertPrivateVersionPolicy({ private: true, version: "1.0.0" })).not.toThrow();
  });

  it("blocks versions above 1.0.0 while private", () => {
    expect(() => assertPrivateVersionPolicy({ private: true, version: "1.0.1" }))
      .toThrow(/must not exceed 1\.0\.0/);
    expect(() => assertPrivateVersionPolicy({ private: true, version: "1.1.0-beta.1" }))
      .toThrow(/must not exceed 1\.0\.0/);
  });

  it("does not impose the private cap after the package is made public", () => {
    expect(() => assertPrivateVersionPolicy({ private: false, version: "2.0.0" })).not.toThrow();
  });
});
