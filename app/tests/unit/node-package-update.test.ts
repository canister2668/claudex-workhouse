import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  assertDownloadedArtifact,
  assertRequestMatchesRelease,
  nodePackageUpdateResult,
  parseNodePackageUpdateRequest
} from "../../src/server/deployment/node-package-update.js";

const pem = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ type: "spki", format: "pem" }).toString();
const pemDigest = crypto.createHash("sha256").update(pem).digest("hex");
const artifactBytes = new Uint8Array(64).fill(7);
const artifactDigest = crypto.createHash("sha256").update(artifactBytes).digest("hex");

function request(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    attemptId: "3f1d3a70-6c53-4f24-8a51-0b6d9b3f2c11",
    installMethod: "node-package",
    sourceVersion: "1.0.1",
    targetVersion: "1.0.2",
    manifestSha256: "a".repeat(64),
    snapshotId: "snapshot",
    artifact: {
      registry: "https://registry.npmjs.org",
      name: "claudex-workhouse",
      url: "https://github.com/owner/repo/releases/download/v1.0.2/claudex-workhouse-1.0.2.tgz",
      filename: "claudex-workhouse-1.0.2.tgz",
      size: artifactBytes.byteLength,
      sha256: artifactDigest
    },
    manifest: {
      url: "https://example.test/stable/release-manifest.json",
      signatureUrl: "https://example.test/stable/release-manifest.json.sig",
      signingPublicKeyPem: pem,
      signingPublicKeySha256: pemDigest,
      keyId: "release-2026-08-public"
    },
    createdAt: "2026-08-18T00:00:00.000Z",
    ...overrides
  };
}

function release(overrides: Record<string, unknown> = {}) {
  const parsed = request();
  return {
    manifestSha256: parsed.manifestSha256,
    keyId: parsed.manifest.keyId,
    signingPublicKeySha256: pemDigest,
    signingPublicKeyPem: pem,
    manifestUrl: parsed.manifest.url,
    signatureUrl: parsed.manifest.signatureUrl,
    verifiedAt: "2026-08-18T00:00:00.000Z",
    manifest: {
      version: "1.0.2",
      nodePackage: {
        registry: "https://registry.npmjs.org",
        name: "claudex-workhouse",
        format: "tgz",
        filename: parsed.artifact.filename,
        url: parsed.artifact.url,
        size: parsed.artifact.size,
        sha256: parsed.artifact.sha256
      },
      ...(overrides.manifest as Record<string, unknown> ?? {})
    },
    ...overrides
  } as any;
}

describe("node package update request", () => {
  it("accepts the request the server writes", () => {
    const parsed = parseNodePackageUpdateRequest(request());
    expect(parsed).toMatchObject({ attemptId: request().attemptId, targetVersion: "1.0.2" });
    expect(parsed.artifact.sha256).toBe(artifactDigest);
  });

  it("applies only node-package requests", () => {
    // Installing an npm package over a container or a portable tree is the one
    // mistake this updater must never make.
    for (const installMethod of ["docker-compose", "windows-portable", "source-checkout", "unknown"]) {
      expect(() => parseNodePackageUpdateRequest(request({ installMethod })))
        .toThrow(/applies node-package requests only/);
    }
  });

  it("refuses a request whose fields cannot be trusted", () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ["schema", { schemaVersion: 2 }],
      ["attempt id", { attemptId: "not-a-uuid" }],
      ["version", { targetVersion: "latest" }],
      ["manifest digest", { manifestSha256: "zz" }]
    ];
    for (const [label, overrides] of cases) {
      expect(() => parseNodePackageUpdateRequest(request(overrides)), label).toThrow();
    }
    // http, and a filename that is a path rather than the official package
    expect(() => parseNodePackageUpdateRequest(request({ artifact: { ...request().artifact, url: "http://example.test/a.tgz" } }))).toThrow(/https/);
    expect(() => parseNodePackageUpdateRequest(request({ artifact: { ...request().artifact, filename: "../evil.tgz" } }))).toThrow(/official package name/);
    // a key that does not hash to the digest travelling beside it
    expect(() => parseNodePackageUpdateRequest(request({ manifest: { ...request().manifest, signingPublicKeySha256: "b".repeat(64) } }))).toThrow(/does not match its digest/);
  });
});

describe("node package update release binding", () => {
  it("accepts a release that describes the same artifact", () => {
    const parsed = parseNodePackageUpdateRequest(request());
    expect(assertRequestMatchesRelease(parsed, release()).sha256).toBe(artifactDigest);
  });

  it("refuses a release that differs from the request in any respect", () => {
    const parsed = parseNodePackageUpdateRequest(request());
    const cases: Array<[string, Record<string, unknown>]> = [
      ["another manifest", { manifestSha256: "c".repeat(64) }],
      ["another key", { keyId: "release-other" }],
      ["another signing key", { signingPublicKeySha256: "d".repeat(64) }],
      ["another version", { manifest: { version: "1.0.3" } }]
    ];
    for (const [label, overrides] of cases) {
      expect(() => assertRequestMatchesRelease(parsed, release(overrides)), label).toThrow(/UPDATE_RELEASE_MISMATCH|Verified/);
    }
    const swapped = release();
    swapped.manifest.nodePackage = { ...swapped.manifest.nodePackage, sha256: "e".repeat(64) };
    expect(() => assertRequestMatchesRelease(parsed, swapped)).toThrow(/digest does not match the signed release/);
    const missing = release();
    missing.manifest.nodePackage = undefined;
    expect(() => assertRequestMatchesRelease(parsed, missing)).toThrow(/publishes no node package/);
  });
});

describe("node package artifact and result", () => {
  it("checks the downloaded bytes against the signed size and digest", () => {
    const parsed = parseNodePackageUpdateRequest(request());
    expect(() => assertDownloadedArtifact(artifactBytes, parsed)).not.toThrow();
    expect(() => assertDownloadedArtifact(new Uint8Array(63).fill(7), parsed)).toThrow(/expected 64/);
    expect(() => assertDownloadedArtifact(new Uint8Array(64).fill(8), parsed)).toThrow(/digest does not match/);
  });

  it("reports an outcome the server can reconcile", () => {
    const parsed = parseNodePackageUpdateRequest(request());
    const completed = nodePackageUpdateResult({ request: parsed, state: "completed", rollbackPerformed: false, completedAt: "2026-08-18T01:00:00.000Z" });
    expect(completed).toMatchObject({ schemaVersion: 1, state: "completed", rollbackPerformed: false, error: null, attemptId: parsed.attemptId });
    const failed = nodePackageUpdateResult({ request: parsed, state: "rolled-back", rollbackPerformed: true, error: new Error("x".repeat(2000)), completedAt: "2026-08-18T01:00:00.000Z" });
    expect(failed.state).toBe("rolled-back");
    expect(failed.error).toHaveLength(1000);
  });
});
