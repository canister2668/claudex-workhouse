import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const installerRoot = path.dirname(scriptDirectory);
const fixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "claudex-installer-shot-"));
const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const now = new Date();
const keyStart = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
const keyEnd = new Date(now.getTime() + 366 * 24 * 60 * 60 * 1000).toISOString();
const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
const baseUrl = "https://installer.demo/releases/download/v1.0.0";
const worker = (platform, architecture, format) => {
  const filename = `claudex-workhouse-worker-${platform}-${architecture}.${format}`;
  return {
    platform,
    architecture,
    format,
    filename,
    url: `${baseUrl}/${filename}`,
    size: platform === "windows" ? 48_230_400 : 42_991_616,
    sha256: platform === "windows" ? "b".repeat(64) : "c".repeat(64),
    entrypoint: platform === "windows" ? "app/desktop-worker/cli.js" : "bin/worker",
    ...(platform === "windows" ? { launcher: "Start Claudex Workhouse Worker.vbs" } : {})
  };
};
const manifest = {
  schemaVersion: 1,
  channel: "stable",
  version: "1.0.0",
  releaseSequence: 24,
  publishedAt: now.toISOString(),
  expiresAt,
  server: {
    image: "ghcr.io/canister2668/claudex-workhouse",
    tag: "1.0.0",
    digest: `sha256:${"a".repeat(64)}`,
    platforms: ["linux/amd64", "linux/arm64"]
  },
  workers: {
    "windows-x64": worker("windows", "x64", "zip"),
    "linux-x64": worker("linux", "x64", "tar.gz"),
    "linux-arm64": worker("linux", "arm64", "tar.gz")
  },
  requirements: { docker: ">=24.0.0", compose: ">=2.20.0" },
  legal: {
    license: "AGPL-3.0-only",
    notice: "NOTICE.md",
    thirdPartyNotices: "THIRD_PARTY_NOTICES.md"
  },
  signing: { keyId: "screenshot-demo-key", algorithm: "rsa-sha256" }
};

try {
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  const signature = crypto.sign("sha256", manifestBytes, privateKey);
  const keyRingFile = path.join(fixtureDirectory, "key-ring.json");
  fs.writeFileSync(keyRingFile, `${JSON.stringify({
    schemaVersion: 1,
    keys: [{
      keyId: "screenshot-demo-key",
      algorithm: "rsa-sha256",
      publicKeyPem,
      notBefore: keyStart,
      expiresAt: keyEnd,
      revoked: false
    }]
  })}\n`);
  const result = spawnSync(process.execPath, [path.join(scriptDirectory, "build.mjs")], {
    cwd: installerRoot,
    env: {
      ...process.env,
      CLAUDEX_INSTALLER_MANIFEST_URL: "https://installer.demo/releases/stable/release-manifest.json",
      CLAUDEX_INSTALLER_MANIFEST_SIGNATURE_URL: "https://installer.demo/releases/stable/release-manifest.json.sig",
      CLAUDEX_INSTALLER_KEY_RING_FILE: keyRingFile,
      CLAUDEX_INSTALLER_RELEASE_CHANNEL: "stable",
      CLAUDEX_INSTALLER_IMAGE_REPOSITORIES: "ghcr.io/canister2668/claudex-workhouse",
      CLAUDEX_INSTALLER_WORKER_ORIGINS: "https://installer.demo"
    },
    encoding: "utf8"
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout);
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
  const releaseDirectory = path.join(installerRoot, "dist", "releases", "stable");
  fs.mkdirSync(releaseDirectory, { recursive: true });
  fs.writeFileSync(path.join(releaseDirectory, "release-manifest.json"), manifestBytes);
  fs.writeFileSync(path.join(releaseDirectory, "release-manifest.json.sig"), signature);
  process.stdout.write(result.stdout);
  process.stdout.write("sanitized installer screenshot fixture ready\n");
} finally {
  fs.rmSync(fixtureDirectory, { recursive: true, force: true });
}
