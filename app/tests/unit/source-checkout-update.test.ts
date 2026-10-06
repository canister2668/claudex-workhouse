import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertCheckoutMayMove,
  assertSourceRequestMatchesRelease,
  parseSourceCheckoutUpdateRequest,
  sourceCheckoutUpdateResult
} from "../../src/server/deployment/source-checkout-update.js";

const pem = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ type: "spki", format: "pem" }).toString();
const pemDigest = crypto.createHash("sha256").update(pem).digest("hex");

function request(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    attemptId: "3f1d3a70-6c53-4f24-8a51-0b6d9b3f2c11",
    installMethod: "source-checkout",
    sourceVersion: "1.0.4",
    targetVersion: "1.0.5",
    manifestSha256: "a".repeat(64),
    snapshotId: "snapshot",
    artifact: { tag: "v1.0.5" },
    manifest: {
      url: "https://example.test/stable/release-manifest.json",
      signatureUrl: "https://example.test/stable/release-manifest.json.sig",
      signingPublicKeyPem: pem,
      signingPublicKeySha256: pemDigest,
      keyId: "release-2026-08-public"
    },
    createdAt: "2026-10-07T00:00:00.000Z",
    ...overrides
  };
}

const release = (overrides: Record<string, unknown> = {}) => ({
  manifestSha256: "a".repeat(64),
  keyId: "release-2026-08-public",
  signingPublicKeySha256: pemDigest,
  manifest: { version: "1.0.5" },
  ...overrides
}) as any;

describe("source checkout update decisions", () => {
  it("accepts a source-checkout request naming the release tag of its target", () => {
    expect(parseSourceCheckoutUpdateRequest(request())).toMatchObject({ targetVersion: "1.0.5", tag: "v1.0.5" });
  });

  it("refuses other install methods and any ref that is not the target's release tag", () => {
    expect(() => parseSourceCheckoutUpdateRequest(request({ installMethod: "node-package" }))).toThrow(/source-checkout requests only/);
    for (const tag of ["v1.0.4", "main", "v1.0.5;rm", "refs/heads/v1.0.5", ""]) {
      expect(() => parseSourceCheckoutUpdateRequest(request({ artifact: { tag } }))).toThrow(/Release tag/);
    }
    expect(() => parseSourceCheckoutUpdateRequest(request({ manifest: { ...request().manifest, signingPublicKeySha256: "b".repeat(64) } }))).toThrow(/digest/);
  });

  it("only proceeds when the verified release is the one the request named", () => {
    const parsed = parseSourceCheckoutUpdateRequest(request());
    expect(() => assertSourceRequestMatchesRelease(parsed, release())).not.toThrow();
    expect(() => assertSourceRequestMatchesRelease(parsed, release({ manifest: { version: "1.0.6" } }))).toThrow(/not 1.0.5/);
    expect(() => assertSourceRequestMatchesRelease(parsed, release({ manifestSha256: "c".repeat(64) }))).toThrow(/manifest/);
  });

  it("moves the checkout only by fast-forward from a clean branch to a tag carrying the target version", () => {
    const parsed = parseSourceCheckoutUpdateRequest(request());
    const ok = { trackedChanges: "", branch: "main", headIsAncestorOfTag: true, tagPackageVersion: "1.0.5", request: parsed };
    expect(() => assertCheckoutMayMove(ok)).not.toThrow();
    expect(() => assertCheckoutMayMove({ ...ok, trackedChanges: " M app/src/server/index.ts\n" })).toThrow(/uncommitted/);
    expect(() => assertCheckoutMayMove({ ...ok, branch: "" })).toThrow(/not on a branch/);
    expect(() => assertCheckoutMayMove({ ...ok, headIsAncestorOfTag: false })).toThrow(/fast-forwarded/);
    expect(() => assertCheckoutMayMove({ ...ok, tagPackageVersion: "1.0.4" })).toThrow(/carries app\/package.json 1.0.4/);
  });

  it("writes the result shape the server reconciles", () => {
    const parsed = parseSourceCheckoutUpdateRequest(request());
    expect(sourceCheckoutUpdateResult({ request: parsed, state: "rolled-back", rollbackPerformed: true, error: new Error("build failed"), completedAt: "2026-10-07T00:00:00.000Z" }))
      .toEqual({ schemaVersion: 1, attemptId: parsed.attemptId, state: "rolled-back", sourceVersion: "1.0.4", targetVersion: "1.0.5", manifestSha256: "a".repeat(64), rollbackPerformed: true, error: "build failed", completedAt: "2026-10-07T00:00:00.000Z" });
  });

  it("ships an updater that loads its modules before moving the checkout and never resets over local work", () => {
    const updater = fs.readFileSync(path.join(process.cwd(), "..", "bin", "claudex-workhouse-source-updater.mjs"), "utf8");
    expect(updater.indexOf("await import(moduleUrl(")).toBeLessThan(updater.indexOf('"merge", "--ff-only"'));
    expect(updater).toContain('"reset", "--keep"');
    expect(updater).not.toMatch(/"reset", "--hard"|"clean"|"checkout", "--force"/);
  });
});
