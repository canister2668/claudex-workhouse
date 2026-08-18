#!/usr/bin/env node
// Applies a node-package application update the server has already authorized.
//
// The server verifies the release, snapshots the data, and writes a request
// into <dataRoot>/runtime/application-updates/requests. It cannot perform the
// install itself: the install replaces the very package the server is running
// from. This runs afterwards, re-verifies everything from the signature down,
// installs, reports the outcome, and restarts the service.
//
// Every module it needs is imported before npm touches the package directory.
// Node keeps what it has already loaded, so replacing the files underneath is
// safe; nothing here may import lazily after that point.
//
// Usage:
//   claudex-workhouse-updater [--request <file>] [--data-root <dir>] [--dry-run]
//
// With no --request it applies the oldest pending request it finds.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "..");
const serverDirectory = path.join(packageRoot, "app", "dist-server");

const moduleUrl = (...segments) => pathToFileURL(path.join(serverDirectory, ...segments)).href;
const { parseNodePackageUpdateRequest, assertRequestMatchesRelease, assertDownloadedArtifact, nodePackageUpdateResult } =
  await import(moduleUrl("deployment", "node-package-update.js"));
const { verifyReleaseManifest } = await import(moduleUrl("deployment", "release-manifest.js"));

function fail(message) {
  process.stderr.write(`claudex-workhouse-updater: ${message}\n`);
  process.exit(2);
}

const values = process.argv.slice(2);
let requestFile = null;
let dataRoot = process.env.CLAUDEX_WORKHOUSE_DATA_ROOT?.trim() || process.env.CLAUDEX_WORKHOUSE_ROOT?.trim() || "/opt/claudex-workhouse";
let dryRun = false;
for (let index = 0; index < values.length; index += 1) {
  const value = values[index];
  if (value === "--request") requestFile = values[++index] ?? fail("--request requires a file");
  else if (value === "--data-root") dataRoot = values[++index] ?? fail("--data-root requires a directory");
  else if (value === "--dry-run") dryRun = true;
  else fail(`unknown argument: ${value}`);
}

const requestsDirectory = path.join(dataRoot, "runtime", "application-updates", "requests");
const resultsDirectory = path.join(dataRoot, "runtime", "application-updates", "results");

if (!requestFile) {
  let pending = [];
  try {
    pending = fs.readdirSync(requestsDirectory).filter((name) => name.endsWith(".json")).sort();
  } catch {
    pending = [];
  }
  if (!pending.length) {
    process.stdout.write("no pending application update request\n");
    process.exit(0);
  }
  requestFile = path.join(requestsDirectory, pending[0]);
}

const raw = (() => {
  try {
    return JSON.parse(fs.readFileSync(requestFile, "utf8"));
  } catch (error) {
    fail(`request is unreadable: ${error instanceof Error ? error.message : String(error)}`);
  }
})();

const request = parseNodePackageUpdateRequest(raw);
const keyRingFile = process.env.CLAUDEX_WORKHOUSE_RELEASE_KEY_RING_FILE?.trim() || path.join(packageRoot, "deploy", "release-key-ring.json");

async function download(url, limit) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > limit) throw new Error(`${url} returned more than ${limit} bytes`);
  return bytes;
}

function npm(args) {
  execFileSync("npm", args, { stdio: "inherit", shell: false });
}

function writeResult(state, rollbackPerformed, error) {
  const payload = nodePackageUpdateResult({ request, state, rollbackPerformed, error, completedAt: new Date().toISOString() });
  fs.mkdirSync(resultsDirectory, { recursive: true, mode: 0o700 });
  const file = path.join(resultsDirectory, `${request.attemptId}.json`);
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
  return payload;
}

let installed = false;
try {
  // The manifest is re-verified here rather than trusted from the request: the
  // request is a file, the signature is the authority.
  const [manifestBytes, signatureBytes] = await Promise.all([
    download(request.manifest.url, 4 * 1024 * 1024),
    download(request.manifest.signatureUrl, 64 * 1024)
  ]);
  const release0 = (() => { try { return JSON.parse(Buffer.from(manifestBytes).toString("utf8"))?.server ?? {}; } catch { return {}; } })();
  const release = verifyReleaseManifest({
    manifestBytes,
    signatureBytes,
    manifestUrl: request.manifest.url,
    signatureUrl: request.manifest.signatureUrl,
    keyRing: JSON.parse(fs.readFileSync(keyRingFile, "utf8")),
    policy: {
      allowedManifestOrigins: [new URL(request.manifest.url).origin],
      allowedWorkerOrigins: [new URL(request.artifact.url).origin],
      // The policy covers the container image too, and refuses an empty list.
      // This updater installs a tarball and never pulls an image, so it names
      // the repository the release itself declares rather than widening the
      // check to nothing.
      allowedImageRepositories: [release0.image ?? "ghcr.io/canister2668/claudex-workhouse"]
    }
  });
  assertRequestMatchesRelease(request, release);

  const artifact = await download(request.artifact.url, request.artifact.size);
  assertDownloadedArtifact(artifact, request);

  if (dryRun) {
    process.stdout.write(`verified ${request.targetVersion} (${request.artifact.filename}); dry run, nothing installed\n`);
    process.exit(0);
  }

  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "claudex-workhouse-update-"));
  const tarball = path.join(staging, request.artifact.filename);
  fs.writeFileSync(tarball, artifact, { mode: 0o600 });
  try {
    npm(["install", "-g", "--no-fund", "--no-audit", tarball]);
    installed = true;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }

  writeResult("completed", false, undefined);
  fs.rmSync(requestFile, { force: true });
  // Restarting runs the newly installed launcher on purpose.
  npm(["exec", "--yes", "--", "claudex-workhouse", "restart"]);
  process.stdout.write(`applied ${request.sourceVersion} -> ${request.targetVersion}\n`);
} catch (error) {
  let rolledBack = false;
  if (installed) {
    // The install succeeded and something after it did not. Put the version
    // the server was running back, so the service is not left on a build no
    // attempt recorded.
    try {
      npm(["install", "-g", "--no-fund", "--no-audit", `claudex-workhouse@${request.sourceVersion}`]);
      rolledBack = true;
    } catch { /* reported through the result below */ }
  }
  // A dry run reports only. Recording an attempt or consuming the request would
  // make the rehearsal indistinguishable from the real thing.
  if (!dryRun) {
    writeResult(rolledBack ? "rolled-back" : "failed", rolledBack, error);
    fs.rmSync(requestFile, { force: true });
  }
  process.stderr.write(`claudex-workhouse-updater: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
