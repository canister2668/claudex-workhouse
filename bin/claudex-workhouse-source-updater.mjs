#!/usr/bin/env node
// Applies an application update to a Git source checkout that the server has
// already authorized.
//
// The server verifies the release, snapshots the data, writes a request into
// <dataRoot>/runtime/application-updates/requests and starts this process
// detached, because the restart at the end stops the server that launched it.
// Here the signed manifest is verified again, the checkout is fast-forwarded to
// the release tag (never merged, never reset over local work), dependencies are
// installed from the lockfile, the app is rebuilt and the service restarted.
// If anything after the fast-forward fails, the checkout goes back to the
// commit it was on, is rebuilt, and the service restarted on that.
//
// Usage:
//   claudex-workhouse-source-updater --request <file> [--data-root <dir>] [--dry-run]
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(here, "..");
const appDirectory = path.join(repository, "app");
const serverDirectory = path.join(appDirectory, "dist-server");

// Loaded before the checkout moves; the build below replaces these files.
const moduleUrl = (...segments) => pathToFileURL(path.join(serverDirectory, ...segments)).href;
const { parseSourceCheckoutUpdateRequest, assertSourceRequestMatchesRelease, assertCheckoutMayMove, sourceCheckoutUpdateResult } =
  await import(moduleUrl("deployment", "source-checkout-update.js"));
const { verifyReleaseManifest } = await import(moduleUrl("deployment", "release-manifest.js"));

function fail(message) {
  process.stderr.write(`claudex-workhouse-source-updater: ${message}\n`);
  process.exit(2);
}

const values = process.argv.slice(2);
let requestFile = null;
let dataRoot = process.env.CLAUDEX_WORKHOUSE_DATA_ROOT?.trim() || process.env.CLAUDEX_WORKHOUSE_ROOT?.trim() || repository;
let dryRun = false;
for (let index = 0; index < values.length; index += 1) {
  const value = values[index];
  if (value === "--request") requestFile = values[++index] ?? fail("--request requires a file");
  else if (value === "--data-root") dataRoot = values[++index] ?? fail("--data-root requires a directory");
  else if (value === "--dry-run") dryRun = true;
  else fail(`unknown argument: ${value}`);
}
if (!requestFile) fail("--request is required");

const resultsDirectory = path.join(dataRoot, "runtime", "application-updates", "results");
const port = Number(process.env.CLAUDEX_WORKHOUSE_PORT || 3410);
const log = (line) => process.stdout.write(`[${new Date().toISOString()}] ${line}\n`);

const raw = (() => {
  try {
    return JSON.parse(fs.readFileSync(requestFile, "utf8"));
  } catch (error) {
    fail(`request is unreadable: ${error instanceof Error ? error.message : String(error)}`);
  }
})();
const request = parseSourceCheckoutUpdateRequest(raw);
const keyRingFile = process.env.CLAUDEX_WORKHOUSE_RELEASE_KEY_RING_FILE?.trim() || path.join(repository, "deploy", "release-key-ring.json");

function run(command, args, options = {}) {
  log(`$ ${command} ${args.join(" ")}`);
  return execFileSync(command, args, { cwd: repository, shell: false, stdio: ["ignore", "pipe", "inherit"], encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...options });
}
const git = (...args) => run("git", args).trim();

async function download(url, limit) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > limit) throw new Error(`${url} returned more than ${limit} bytes`);
  return bytes;
}

function buildAndRestart() {
  const env = { ...process.env, CI: "true" };
  run("pnpm", ["install", "--frozen-lockfile"], { cwd: appDirectory, env, stdio: ["ignore", "inherit", "inherit"] });
  run("pnpm", ["build"], { cwd: appDirectory, env, stdio: ["ignore", "inherit", "inherit"] });
  run(process.execPath, [path.join(repository, "bin", "claudex-workhouse.mjs"), "restart"], { stdio: ["ignore", "inherit", "inherit"] });
}

async function waitForReady(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health/ready`, { signal: AbortSignal.timeout(3000) });
      if (response.ok && (await response.json())?.ok === true) return;
    } catch { /* still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error(`The service did not become ready within ${Math.round(timeoutMs / 1000)} seconds.`);
}

function writeResult(state, rollbackPerformed, error) {
  const payload = sourceCheckoutUpdateResult({ request, state, rollbackPerformed, error, completedAt: new Date().toISOString() });
  fs.mkdirSync(resultsDirectory, { recursive: true, mode: 0o700 });
  const file = path.join(resultsDirectory, `${request.attemptId}.json`);
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

let previousHead = null;
try {
  const [manifestBytes, signatureBytes] = await Promise.all([
    download(request.manifest.url, 4 * 1024 * 1024),
    download(request.manifest.signatureUrl, 64 * 1024)
  ]);
  const declared = (() => { try { return JSON.parse(Buffer.from(manifestBytes).toString("utf8")) ?? {}; } catch { return {}; } })();
  const release = verifyReleaseManifest({
    manifestBytes,
    signatureBytes,
    manifestUrl: request.manifest.url,
    signatureUrl: request.manifest.signatureUrl,
    keyRing: JSON.parse(fs.readFileSync(keyRingFile, "utf8")),
    policy: {
      allowedManifestOrigins: [new URL(request.manifest.url).origin],
      // Nothing is downloaded from these; the policy refuses empty lists, so it
      // names what the release itself declares.
      allowedWorkerOrigins: [...new Set(Object.values(declared.workers ?? {}).map((worker) => { try { return new URL(worker?.url).origin; } catch { return null; } }).filter(Boolean).concat(["https://github.com"]))],
      allowedImageRepositories: [declared.server?.image ?? "ghcr.io/canister2668/claudex-workhouse"]
    }
  });
  assertSourceRequestMatchesRelease(request, release);
  log(`verified release ${release.manifest.version} (${release.keyId})`);

  const branch = (() => { try { return git("symbolic-ref", "--short", "-q", "HEAD"); } catch { return ""; } })();
  const trackedChanges = git("status", "--porcelain", "--untracked-files=no");
  git("fetch", "--no-tags", "origin", `+refs/tags/${request.tag}:refs/tags/${request.tag}`);
  const tagCommit = git("rev-parse", "--verify", `refs/tags/${request.tag}^{commit}`);
  const tagPackage = JSON.parse(git("show", `${tagCommit}:app/package.json`));
  let headIsAncestorOfTag = true;
  try { git("merge-base", "--is-ancestor", "HEAD", tagCommit); } catch { headIsAncestorOfTag = false; }
  assertCheckoutMayMove({ trackedChanges, branch, headIsAncestorOfTag, tagPackageVersion: String(tagPackage.version ?? ""), request });

  if (dryRun) {
    log(`dry run: ${branch} would fast-forward to ${request.tag} (${tagCommit.slice(0, 12)}); nothing changed`);
    process.exit(0);
  }

  previousHead = git("rev-parse", "HEAD");
  git("merge", "--ff-only", tagCommit);
  log(`fast-forwarded ${branch} ${previousHead.slice(0, 12)} -> ${tagCommit.slice(0, 12)}`);
  buildAndRestart();
  await waitForReady(5 * 60 * 1000);
  writeResult("completed", false, undefined);
  fs.rmSync(requestFile, { force: true });
  log(`applied ${request.sourceVersion} -> ${request.targetVersion}`);
} catch (error) {
  log(`update failed: ${error instanceof Error ? error.message : String(error)}`);
  let rolledBack = false;
  if (previousHead && !dryRun) {
    try {
      // --keep moves the branch back without touching untracked files and
      // refuses rather than overwrite anything changed since the fast-forward.
      git("reset", "--keep", previousHead);
      buildAndRestart();
      await waitForReady(5 * 60 * 1000);
      rolledBack = true;
      log(`rolled back to ${previousHead.slice(0, 12)}`);
    } catch (rollbackError) {
      log(`rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
    }
  }
  if (!dryRun) {
    writeResult(rolledBack ? "rolled-back" : "failed", rolledBack, error);
    fs.rmSync(requestFile, { force: true });
  }
  process.exit(1);
}
