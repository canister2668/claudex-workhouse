import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  parseReleaseManifest,
  toTrustedReleaseMetadata,
  toTrustedWorkerPackageMetadata,
  verifyReleaseManifest,
  type ReleaseKeyRing,
  type ReleaseManifest,
  type ReleaseVerificationPolicy
} from "../../src/server/deployment/release-manifest.js";

const NOW = new Date("2026-07-27T12:00:00.000Z");
const MANIFEST_URL = "https://releases.example.test/stable/release-manifest.json";
const SIGNATURE_URL = "https://releases.example.test/stable/release-manifest.json.sig";
const IMAGE_REPOSITORY = "ghcr.io/canister2668/claudex-workhouse";
const KEY_ID = "release-test-1";
const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" }
});

const policy: ReleaseVerificationPolicy = {
  allowedManifestOrigins: ["https://releases.example.test/"],
  allowedWorkerOrigins: ["https://github.com/"],
  allowedImageRepositories: [IMAGE_REPOSITORY]
};

function worker(
  platform: "windows" | "linux",
  architecture: "x64" | "arm64"
) {
  const windows = platform === "windows";
  const key = `${platform}-${architecture}`;
  const filename = `claudex-workhouse-worker-${key}.${windows ? "zip" : "tar.gz"}`;
  return {
    platform,
    architecture,
    format: windows ? "zip" as const : "tar.gz" as const,
    filename,
    url: `https://github.com/canister2668/claudex-workhouse/releases/download/v1.0.0/${filename}`,
    size: windows ? 20_000_000 : 12_000_000,
    sha256: crypto.createHash("sha256").update(key).digest("hex"),
    entrypoint: windows ? "worker/Worker CLI.cmd" : "worker/bin/claudex-workhouse-worker",
    ...(windows ? { launcher: "worker/Start Claudex Workhouse Worker.cmd" } : {})
  };
}

function manifest(overrides: Record<string, unknown> = {}): ReleaseManifest {
  const base = {
    schemaVersion: 1 as const,
    channel: "stable",
    version: "1.0.0",
    releaseSequence: 7,
    publishedAt: "2026-07-27T11:00:00.000Z",
    expiresAt: "2026-08-27T12:00:00.000Z",
    server: {
      image: IMAGE_REPOSITORY,
      tag: "1.0.0",
      digest: `sha256:${"a".repeat(64)}`,
      platforms: ["linux/amd64", "linux/arm64"]
    },
    workers: {
      "windows-x64": worker("windows", "x64"),
      "linux-x64": worker("linux", "x64"),
      "linux-arm64": worker("linux", "arm64")
    },
    requirements: { docker: ">=24.0.0", compose: ">=2.20.0" },
    legal:{license:"AGPL-3.0-only"as const,notice:"NOTICE.md"as const,thirdPartyNotices:"THIRD_PARTY_NOTICES.md"as const},
    signing: { keyId: KEY_ID, algorithm: "rsa-sha256" as const }
  };
  return parseReleaseManifest({ ...base, ...overrides });
}
function windowsServer(){
  const filename="claudex-workhouse-server-windows-x64.exe";
  return{platform:"windows"as const,architecture:"x64"as const,format:"exe"as const,filename,url:`https://github.com/canister2668/claudex-workhouse/releases/download/v1.0.0/${filename}`,size:120_000_000,sha256:"c".repeat(64),authenticode:{status:"unsigned"as const}};
}
function windowsPortable(){
  const filename="claudex-workhouse-server-windows-x64-portable.zip";
  return{platform:"windows"as const,architecture:"x64"as const,format:"zip"as const,filename,url:`https://github.com/canister2668/claudex-workhouse/releases/download/v1.0.0/${filename}`,size:150_000_000,sha256:"d".repeat(64),minimumUpdaterProtocolVersion:1};
}

function keyRing(overrides: Record<string, unknown> = {}): ReleaseKeyRing {
  return {
    schemaVersion: 1,
    keys: [{
      keyId: KEY_ID,
      algorithm: "rsa-sha256",
      publicKeyPem: publicKey,
      notBefore: "2026-01-01T00:00:00.000Z",
      expiresAt: "2027-01-01T00:00:00.000Z",
      revoked: false,
      ...overrides
    }]
  };
}

function signed(value = manifest()) {
  const manifestBytes = Buffer.from(JSON.stringify(value));
  const signatureBytes = crypto.sign("RSA-SHA256", manifestBytes, {
    key: privateKey,
    padding: crypto.constants.RSA_PKCS1_PADDING
  });
  return { manifestBytes, signatureBytes };
}

function verify(
  value = manifest(),
  overrides: Partial<Parameters<typeof verifyReleaseManifest>[0]> = {}
) {
  const signedValue = signed(value);
  return verifyReleaseManifest({
    ...signedValue,
    manifestUrl: MANIFEST_URL,
    signatureUrl: SIGNATURE_URL,
    keyRing: keyRing(),
    policy,
    now: NOW,
    ...overrides
  });
}

describe("public release manifest trust", () => {
  it("verifies exact signed bytes and adapts the verified release to existing deployment inputs", () => {
    const release = verify();
    expect(release.manifest.releaseSequence).toBe(7);
    expect(release.keyId).toBe(KEY_ID);
    expect(release.manifestSha256).toMatch(/^[a-f0-9]{64}$/);

    const server = toTrustedReleaseMetadata(release);
    expect(server).toMatchObject({
      version: "1.0.0",
      image: {
        repository: IMAGE_REPOSITORY,
        digest: `sha256:${"a".repeat(64)}`
      },
      manifest: {
        url: "https://github.com/canister2668/claudex-workhouse/releases/download/v1.0.0/release-manifest.json",
        signatureUrl: "https://github.com/canister2668/claudex-workhouse/releases/download/v1.0.0/release-manifest.json.sig",
        channelUrl: MANIFEST_URL,
        channelSignatureUrl: SIGNATURE_URL,
        sha256: release.manifestSha256
      }
    });

    const windows = toTrustedWorkerPackageMetadata(release, "windows", "x64");
    expect(windows).toMatchObject({
      version: "1.0.0",
      platform: "windows",
      architecture: "x64",
      format: "zip",
      artifact: {
        fileName: "claudex-workhouse-worker-windows-x64.zip",
        entrypoint: "worker/Worker CLI.cmd",
        launcher: "worker/Start Claudex Workhouse Worker.cmd"
      }
    });
  });

  it("rejects a manifest changed after signing", () => {
    const original = signed();
    const changed = Buffer.from(
      original.manifestBytes.toString("utf8").replace(
        '"publishedAt":"2026-07-27T11:00:00.000Z"',
        '"publishedAt":"2026-07-27T11:00:00.001Z"'
      )
    );
    expect(() => verifyReleaseManifest({
      manifestBytes: changed,
      signatureBytes: original.signatureBytes,
      manifestUrl: MANIFEST_URL,
      signatureUrl: SIGNATURE_URL,
      keyRing: keyRing(),
      policy,
      now: NOW
    })).toThrowError(expect.objectContaining({ code: "SIGNATURE_INVALID" }));
  });

  it("rejects an unknown signing key", () => {
    expect(() => verify(manifest(), {
      keyRing: keyRing({ keyId: "different-key" })
    })).toThrowError(expect.objectContaining({ code: "KEY_UNKNOWN" }));
  });

  it("rejects a revoked signing key", () => {
    expect(() => verify(manifest(), {
      keyRing: keyRing({ revoked: true })
    })).toThrowError(expect.objectContaining({ code: "KEY_REVOKED" }));
  });

  it("rejects an expired signing key", () => {
    expect(() => verify(manifest(), {
      keyRing: keyRing({ expiresAt: "2026-07-27T11:59:59.000Z" })
    })).toThrowError(expect.objectContaining({ code: "KEY_EXPIRED" }));
  });

  it("rejects a signing key before its activation time", () => {
    expect(() => verify(manifest(), {
      keyRing: keyRing({ notBefore: "2026-07-27T12:00:01.000Z" })
    })).toThrowError(expect.objectContaining({ code: "KEY_NOT_YET_VALID" }));
  });

  it("rejects an expired manifest", () => {
    const expired = manifest({ expiresAt: "2026-07-27T11:59:59.000Z" });
    expect(() => verify(expired)).toThrowError(expect.objectContaining({ code: "MANIFEST_EXPIRED" }));
  });

  it("rejects a publishedAt timestamp beyond the bounded future skew", () => {
    const future = manifest({
      publishedAt: "2026-07-27T12:05:00.001Z",
      expiresAt: "2026-08-27T12:00:00.000Z"
    });
    expect(() => verify(future)).toThrowError(expect.objectContaining({ code: "MANIFEST_FROM_FUTURE" }));
  });

  it("rejects a release sequence downgrade", () => {
    const value = manifest();
    expect(() => verify(value, {
      previous: {
        channel: "stable",
        releaseSequence: 8,
        manifestSha256: "b".repeat(64)
      }
    })).toThrowError(expect.objectContaining({ code: "RELEASE_DOWNGRADE" }));
  });

  it("rejects equivocation at an already observed release sequence", () => {
    const value = manifest();
    expect(() => verify(value, {
      previous: {
        channel: "stable",
        releaseSequence: value.releaseSequence,
        manifestSha256: "b".repeat(64)
      }
    })).toThrowError(expect.objectContaining({ code: "RELEASE_EQUIVOCATION" }));
  });

  it("rejects a manifest with a required Worker package missing", () => {
    const value = manifest();
    const workers = { ...value.workers } as Record<string, unknown>;
    delete workers["linux-arm64"];
    expect(() => parseReleaseManifest({ ...value, workers })).toThrowError(
      expect.objectContaining({ code: "MANIFEST_INVALID" })
    );
  });

  it("rejects unknown manifest fields instead of silently ignoring them", () => {
    expect(() => parseReleaseManifest({ ...manifest(), unexpected: true })).toThrowError(
      expect.objectContaining({ code: "MANIFEST_INVALID" })
    );
  });
  it("accepts schema v2 with an explicitly unsigned Windows server EXE in the immutable asset directory",()=>{
    const value=manifest({schemaVersion:2,windowsServer:windowsServer()});
    expect(value.windowsServer).toMatchObject({platform:"windows",format:"exe",authenticode:{status:"unsigned"}});
    expect(verify(value).manifest.windowsServer?.sha256).toBe("c".repeat(64));
    // A schema v2 manifest may carry no Windows server: those targets are in
    // development and a release ships none of them.
    expect(parseReleaseManifest({...value,windowsServer:undefined}).windowsServer).toBeUndefined();
    expect(()=>parseReleaseManifest({...manifest(),windowsServer:windowsServer()})).toThrowError(expect.objectContaining({code:"MANIFEST_INVALID"}));
  });
  it("rejects Windows server origin, filename, and Authenticode binding changes",()=>{
    const base=windowsServer();
    expect(()=>verify(manifest({schemaVersion:2,windowsServer:{...base,url:base.url.replace("https://github.com/","https://downloads.example.test/")}}))).toThrowError(expect.objectContaining({code:"MANIFEST_INVALID"}));
    expect(()=>parseReleaseManifest({...manifest({schemaVersion:2,windowsServer:base}),windowsServer:{...base,filename:"server.zip"}})).toThrowError(expect.objectContaining({code:"MANIFEST_INVALID"}));
    expect(()=>parseReleaseManifest({...manifest({schemaVersion:2,windowsServer:base}),windowsServer:{...base,authenticode:{status:"unsigned",subject:"unexpected"}}})).toThrowError(expect.objectContaining({code:"MANIFEST_INVALID"}));
  });
  it("requires schema v3 to bind the portable ZIP and every updater protocol",()=>{
    const base=manifest({schemaVersion:2,windowsServer:windowsServer()});
    const value=parseReleaseManifest({
      ...base,
      schemaVersion:3,
      server:{...base.server,minimumUpdaterProtocolVersion:1},
      windowsPortable:windowsPortable(),
      workers:Object.fromEntries(Object.entries(base.workers).map(([key,worker])=>[key,{...worker,minimumUpdaterProtocolVersion:1}]))
    });
    expect(verify(value).manifest.windowsPortable?.sha256).toBe("d".repeat(64));
    // Likewise the portable ZIP: absent is valid, present below v3 is not.
    expect(parseReleaseManifest({...value,windowsPortable:undefined}).windowsPortable).toBeUndefined();
    expect(()=>parseReleaseManifest({...value,server:{...value.server,minimumUpdaterProtocolVersion:undefined}})).toThrowError(expect.objectContaining({code:"MANIFEST_INVALID"}));
    const workers={...value.workers,"linux-x64":{...value.workers["linux-x64"],minimumUpdaterProtocolVersion:undefined}};
    expect(()=>parseReleaseManifest({...value,workers})).toThrowError(expect.objectContaining({code:"MANIFEST_INVALID"}));
  });

  it("rejects Worker URL origins outside the explicit release policy", () => {
    const value = manifest();
    const workers = Object.fromEntries(
      Object.entries(value.workers).map(([key, worker]) => [
        key,
        {
          ...worker,
          url: worker.url.replace("https://github.com/", "https://downloads.example.test/")
        }
      ])
    );
    expect(() => verify(parseReleaseManifest({ ...value, workers }))).toThrowError(
      expect.objectContaining({ code: "WORKER_ORIGIN_REJECTED" })
    );
  });

  it.each([
    ["zero size", { size: 0 }],
    ["bad digest", { sha256: "A".repeat(64) }],
    ["wrong architecture", { architecture: "arm64" }]
  ])("rejects strict Worker binding for %s", (_label, workerOverride) => {
    const value = manifest();
    const workers = {
      ...value.workers,
      "linux-x64": { ...value.workers["linux-x64"], ...workerOverride }
    };
    expect(() => parseReleaseManifest({ ...value, workers })).toThrowError(
      expect.objectContaining({ code: "MANIFEST_INVALID" })
    );
  });
});
