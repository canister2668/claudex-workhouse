import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createReleaseChecksums } from "../../scripts/create-release-checksums.mjs";

const created: string[] = [];
afterEach(() => {
  for (const directory of created.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

describe("unified release checksums", () => {
  it("binds every existing release asset in deterministic name order", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "claudex-checksums-"));
    created.push(directory);
    fs.writeFileSync(path.join(directory, "z.zip"), "zip");
    fs.writeFileSync(path.join(directory, "a.json"), "manifest");
    createReleaseChecksums(directory);
    expect(fs.readFileSync(path.join(directory, "SHA256SUMS"), "ascii")).toBe(
      `${sha256("manifest")}  a.json\n${sha256("zip")}  z.zip\n`
    );
  });

  it("replaces a previous checksum file without hashing it into itself", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "claudex-checksums-"));
    created.push(directory);
    fs.writeFileSync(path.join(directory, "asset.bin"), "first");
    createReleaseChecksums(directory);
    fs.writeFileSync(path.join(directory, "asset.bin"), "second");
    createReleaseChecksums(directory);
    const value = fs.readFileSync(path.join(directory, "SHA256SUMS"), "ascii");
    expect(value).toBe(`${sha256("second")}  asset.bin\n`);
    expect(value).not.toContain("SHA256SUMS");
  });

  it("rejects directories and symbolic links from the public inventory", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "claudex-checksums-"));
    created.push(directory);
    fs.mkdirSync(path.join(directory, "nested"));
    expect(() => createReleaseChecksums(directory)).toThrow(/regular file/);
  });
});
