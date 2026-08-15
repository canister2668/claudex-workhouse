import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  RELEASE_STATE_SETTING_KEY,
  ReleaseService,
  ReleaseServiceError,
  releaseServiceConfigFromEnvironment,
  type PersistedReleaseState,
  type ReleaseStateAcceptance,
  type ReleaseStateStore
} from "../../src/server/deployment/release-service.js";

const NOW = new Date("2026-07-27T12:00:00.000Z");
const created: string[] = [];
const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" }
});

afterEach(() => {
  for (const directory of created.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "claudex-release-service-"));
  created.push(root);
  const keyRingFile = path.join(root, "release-key-ring.json");
  fs.writeFileSync(keyRingFile, JSON.stringify({
    schemaVersion: 1,
    keys: [{
      keyId: "release-test",
      algorithm: "rsa-sha256",
      publicKeyPem: publicKey,
      notBefore: "2026-01-01T00:00:00.000Z",
      expiresAt: "2027-01-01T00:00:00.000Z",
      revoked: false
    }]
  }));
  const worker = (platform: "windows" | "linux", architecture: "x64" | "arm64") => {
    const windows = platform === "windows";
    const filename = `claudex-workhouse-worker-${platform}-${architecture}.${windows ? "zip" : "tar.gz"}`;
    return {
      platform,
      architecture,
      format: windows ? "zip" : "tar.gz",
      filename,
      url: `https://releases.example.test/v1.0.0/${filename}`,
      size: 1024,
      sha256: crypto.createHash("sha256").update(filename).digest("hex"),
      entrypoint: windows ? "worker/Worker CLI.cmd" : "worker/bin/claudex-workhouse-worker",
      ...(windows ? { launcher: "worker/Start Worker.cmd" } : {})
    };
  };
  const manifest = {
    schemaVersion: 1,
    channel: "stable",
    version: "1.0.0",
    releaseSequence: 4,
    publishedAt: "2026-07-27T11:00:00.000Z",
    expiresAt: "2026-09-01T00:00:00.000Z",
    server: {
      image: "ghcr.io/canister2668/claudex-workhouse",
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
    signing: { keyId: "release-test", algorithm: "rsa-sha256" }
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  const signatureBytes = crypto.sign("RSA-SHA256", manifestBytes, {
    key: privateKey,
    padding: crypto.constants.RSA_PKCS1_PADDING
  });
  return { root, keyRingFile, manifest, manifestBytes, signatureBytes };
}

class MemoryReleaseStore implements ReleaseStateStore {
  state: PersistedReleaseState | null = null;

  async getSystemSetting(key: string) {
    expect(key).toBe(RELEASE_STATE_SETTING_KEY);
    return this.state ? { value: this.state, updatedAt: this.state.verifiedAt } : null;
  }

  async acceptReleaseState(
    state: PersistedReleaseState,
    _updatedAt: string
  ): Promise<ReleaseStateAcceptance> {
    if (this.state?.channel !== undefined && this.state.channel !== state.channel) {
      return { accepted: false, reason: "channel-mismatch", current: this.state };
    }
    if (this.state && state.releaseSequence < this.state.releaseSequence) {
      return { accepted: false, reason: "downgrade", current: this.state };
    }
    if (
      this.state &&
      state.releaseSequence === this.state.releaseSequence &&
      state.manifestSha256 !== this.state.manifestSha256
    ) {
      return { accepted: false, reason: "equivocation", current: this.state };
    }
    const reused = Boolean(
      this.state &&
      state.releaseSequence === this.state.releaseSequence &&
      state.manifestSha256 === this.state.manifestSha256
    );
    this.state = state;
    return { accepted: true, reused, current: state };
  }
}

function response(bytes: Uint8Array, url: string) {
  const result = new Response(bytes, {
    status: 200,
    headers: { "content-length": String(bytes.byteLength) }
  });
  Object.defineProperty(result, "url", { value: url });
  return result;
}

describe("integrated release service", () => {
  it("defaults the application update check to the signed public stable channel", () => {
    const config = releaseServiceConfigFromEnvironment("/opt/claudex-workhouse", {})!;
    expect(config).toMatchObject({
      keyRingFile: "/opt/claudex-workhouse/deploy/release-key-ring.json",
      manifestUrl: "https://canister2668.github.io/claudex-workhouse/releases/stable/release-manifest.json",
      signatureUrl: "https://canister2668.github.io/claudex-workhouse/releases/stable/release-manifest.json.sig",
      expectedChannel: "stable"
    });
  });

  it("fetches from fixed same-origin URLs, verifies, and stores the accepted release state", async () => {
    const value = fixture();
    const store = new MemoryReleaseStore();
    const config = releaseServiceConfigFromEnvironment(value.root, {
      CLAUDEX_WORKHOUSE_RELEASE_KEY_RING_FILE: value.keyRingFile,
      CLAUDEX_WORKHOUSE_RELEASE_MANIFEST_URL: "https://releases.example.test/stable/release-manifest.json",
      CLAUDEX_WORKHOUSE_RELEASE_MANIFEST_SIGNATURE_URL: "https://releases.example.test/stable/release-manifest.json.sig"
    })!;
    const requested: string[] = [];
    const service = new ReleaseService(config, store, async (input) => {
      const url = String(input);
      requested.push(url);
      return response(
        url.endsWith(".sig") ? value.signatureBytes : value.manifestBytes,
        url
      );
    });
    const verified = await service.current(NOW);
    expect(requested.sort()).toEqual([config.manifestUrl, config.signatureUrl].sort());
    expect(verified.manifest.version).toBe("1.0.0");
    expect(store.state).toMatchObject({
      schemaVersion: 1,
      channel: "stable",
      releaseSequence: 4,
      manifestSha256: verified.manifestSha256,
      verifiedKeyId: "release-test"
    });
  });

  it("fails closed for a partial integrated configuration instead of falling back", () => {
    expect(() => releaseServiceConfigFromEnvironment("/tmp", {
      CLAUDEX_WORKHOUSE_RELEASE_MANIFEST_URL: "https://releases.example.test/manifest.json"
    })).toThrowError(expect.objectContaining({ code: "RELEASE_CONFIG_INCOMPLETE" }));
  });

  it("rejects manifest and signature URLs on different origins", () => {
    expect(() => releaseServiceConfigFromEnvironment("/tmp", {
      CLAUDEX_WORKHOUSE_RELEASE_KEY_RING_FILE: "keys.json",
      CLAUDEX_WORKHOUSE_RELEASE_MANIFEST_URL: "https://releases.example.test/manifest.json",
      CLAUDEX_WORKHOUSE_RELEASE_MANIFEST_SIGNATURE_URL: "https://other.example.test/manifest.sig"
    })).toThrowError(expect.objectContaining({ code: "RELEASE_CONFIG_ORIGIN_MISMATCH" }));
  });

  it("enforces response size before reading the download", async () => {
    const value = fixture();
    const store = new MemoryReleaseStore();
    const config = releaseServiceConfigFromEnvironment(value.root, {
      CLAUDEX_WORKHOUSE_RELEASE_KEY_RING_FILE: value.keyRingFile,
      CLAUDEX_WORKHOUSE_RELEASE_MANIFEST_URL: "https://releases.example.test/manifest.json",
      CLAUDEX_WORKHOUSE_RELEASE_MANIFEST_SIGNATURE_URL: "https://releases.example.test/manifest.sig"
    })!;
    const service = new ReleaseService(config, store, async (input) => {
      const url = String(input);
      const bytes = url.endsWith(".sig") ? value.signatureBytes : value.manifestBytes;
      const result = response(bytes, url);
      if (!url.endsWith(".sig")) result.headers.set("content-length", String(1024 * 1024 + 1));
      return result;
    });
    await expect(service.current(NOW)).rejects.toMatchObject({
      code: "RELEASE_DOWNLOAD_SIZE_INVALID"
    });
  });

  it("passes stored sequence state into verification and blocks downgrade", async () => {
    const value = fixture();
    const store = new MemoryReleaseStore();
    store.state = {
      schemaVersion: 1,
      channel: "stable",
      releaseSequence: 5,
      version: "1.1.0",
      manifestSha256: "b".repeat(64),
      imageDigest: `sha256:${"b".repeat(64)}`,
      verifiedKeyId: "release-test",
      verifiedAt: NOW.toISOString(),
      manifestUrl: "https://releases.example.test/previous.json"
    };
    const config = releaseServiceConfigFromEnvironment(value.root, {
      CLAUDEX_WORKHOUSE_RELEASE_KEY_RING_FILE: value.keyRingFile,
      CLAUDEX_WORKHOUSE_RELEASE_MANIFEST_URL: "https://releases.example.test/manifest.json",
      CLAUDEX_WORKHOUSE_RELEASE_MANIFEST_SIGNATURE_URL: "https://releases.example.test/manifest.sig"
    })!;
    const service = new ReleaseService(config, store, async (input) => {
      const url = String(input);
      return response(url.endsWith(".sig") ? value.signatureBytes : value.manifestBytes, url);
    });
    await expect(service.current(NOW)).rejects.toMatchObject({ code: "RELEASE_DOWNGRADE" });
  });

  it("reports invalid configured fetch timeouts without network access", async () => {
    const value = fixture();
    const store = new MemoryReleaseStore();
    const config = releaseServiceConfigFromEnvironment(value.root, {
      CLAUDEX_WORKHOUSE_RELEASE_KEY_RING_FILE: value.keyRingFile,
      CLAUDEX_WORKHOUSE_RELEASE_MANIFEST_URL: "https://releases.example.test/manifest.json",
      CLAUDEX_WORKHOUSE_RELEASE_MANIFEST_SIGNATURE_URL: "https://releases.example.test/manifest.sig"
    })!;
    const service = new ReleaseService(
      { ...config, timeoutMs: 999 },
      store,
      async () => {
        throw new ReleaseServiceError("SHOULD_NOT_FETCH", "unexpected");
      }
    );
    await expect(service.current(NOW)).rejects.toMatchObject({ code: "RELEASE_CONFIG_INVALID" });
  });
});
