// Stages the publishable Node server package from an already-public tree.
//
// This module holds the package's shape — which files reach npm, and what the
// published manifest says — and it lives in the public tree because the release
// workflow runs there, where `scripts/public-release/` does not exist. The
// private builder in `scripts/public-release/build-node-package.mjs` calls the
// same function after generating and inspecting a scrub tree, so the two paths
// cannot drift into publishing different files.
//
// The safety rule is unchanged: a package is only ever assembled from a
// generated public tree. That is not taken on trust from a flag — the root must
// carry a public source proof that its own committed tree still hashes to,
// which the private source cannot produce for itself.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { verifyPublicSourceProof } from "./public-source-proof.mjs";

export const PACKAGE_NAME = "claudex-workhouse";

// Everything the installed server actually reads at runtime. An allowlist
// rather than an ignore list: a new private directory must be added here on
// purpose before it can ever reach npm.
export const ROOT_FILES = ["LICENSE", "LICENSE.ko.md", "LICENSE.ja.md", "NOTICE.md", "NOTICE.ko.md", "NOTICE.ja.md", "THIRD_PARTY_NOTICES.md", "THIRD_PARTY_NOTICES.ko.md", "THIRD_PARTY_NOTICES.ja.md", "README.md"];
// `boot-start.sh` and `container-init.mjs` belong to the Docker image, not to a
// Node install, and the worker entry points ship from their own package.
export const BIN_FILES = ["claudex-workhouse.mjs", "runtime-bootstrap.mjs", "claude-runtime.mjs", "codex-runtime.mjs", "claude-auth-pty.py", "claude-models.py", "claude-usage.py", "antigravity-auth-pty.py", "grok-usage.py"];

function copy(source, target, options = {}) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true, dereference: true, errorOnExist: true, force: false, ...options });
}

/**
 * Copies the runtime payload of `publicRoot` into `stage` and writes the two
 * package manifests. `publicRoot` must be a generated public tree; it is
 * rejected otherwise. Returns the version the package was stamped with.
 *
 * @param {{publicRoot: string, stage: string, fail?: (message: string) => never}} options
 */
export function stageNodePackage({ publicRoot, stage, fail }) {
  const refuse = fail ?? (message => { throw new Error(message); });
  const root = path.resolve(publicRoot);
  // Packing the private tree would publish whatever happened to match, browser
  // gateway included, so the root has to prove it is a generated public tree.
  verifyCommittedPublicSource(root, refuse);

  const publicApp = path.join(root, "app");
  const manifest = JSON.parse(fs.readFileSync(path.join(publicApp, "package.json"), "utf8"));
  const version = String(manifest.version);

  fs.mkdirSync(stage, { recursive: true });
  // The compiler's source maps are a developer artifact and each one embeds the
  // absolute path of the tree that compiled it.
  copy(path.join(publicApp, "dist-server"), path.join(stage, "app", "dist-server"), { filter: source => !source.endsWith(".map") });
  copy(path.join(publicApp, "dist"), path.join(stage, "app", "dist"));
  for (const name of BIN_FILES) {
    const source = path.join(root, "bin", name);
    if (!fs.existsSync(source)) refuse(`the public tree is missing bin/${name}`);
    copy(source, path.join(stage, "bin", name));
  }
  for (const name of ROOT_FILES) {
    const source = path.join(root, name);
    if (fs.existsSync(source)) copy(source, path.join(stage, name));
  }
  // The release service resolves the pinned key ring from <root>/deploy, and it
  // holds public keys only. Leaving it out made every update check in an npm
  // install fail with RELEASE_KEY_RING_INVALID — the install could never learn
  // that a release exists, let alone verify one.
  const keyRing = path.join(root, "deploy", "release-key-ring.json");
  if (!fs.existsSync(keyRing)) refuse("the public tree is missing deploy/release-key-ring.json");
  copy(keyRing, path.join(stage, "deploy", "release-key-ring.json"));

  // Node reads `type` for everything under `app/`. Ship the minimum rather than
  // the development manifest with its devDependencies and private flag.
  fs.writeFileSync(
    path.join(stage, "app", "package.json"),
    `${JSON.stringify({ name: "claudex-workhouse-server-payload", version, private: true, type: "module", license: "AGPL-3.0-only" }, null, 2)}\n`
  );

  // better-sqlite3 is imported only by the two worker processes that win32
  // spawns, so a Linux or macOS install must not fail when its native build
  // does. The Python NDJSON worker serves every other platform.
  const { "better-sqlite3": nativeSqlite, ...runtimeDependencies } = manifest.dependencies ?? {};
  fs.writeFileSync(
    path.join(stage, "package.json"),
    `${JSON.stringify({
      name: PACKAGE_NAME,
      version,
      description: "Claudex Workhouse server — run provider CLI sessions from a browser on your own host.",
      license: "AGPL-3.0-only",
      repository: manifest.repository,
      type: "module",
      bin: { [PACKAGE_NAME]: "bin/claudex-workhouse.mjs" },
      engines: { node: ">=20" },
      // Linux only, and deliberately not darwin: the emotion state lock spawns
      // `/bin/flock`, which is util-linux and absent on macOS. Claiming a
      // platform nothing has ever run on is worse than declining it.
      os: ["linux"],
      dependencies: runtimeDependencies,
      optionalDependencies: nativeSqlite ? { "better-sqlite3": nativeSqlite } : undefined
    }, null, 2)}\n`
  );

  return version;
}

/**
 * The proof covers a pristine generated tree, so it cannot be recomputed once
 * dependencies and build output are in place — `node_modules` alone is a forest
 * of symbolic links the proof refuses outright. Check the committed tree
 * instead: `git archive HEAD` reproduces exactly the bytes the sync wrote, and
 * a private tree cannot produce a matching proof at all because it has none.
 */
function verifyCommittedPublicSource(root, refuse) {
  if (!fs.existsSync(path.join(root, ".claudex-public-source.json"))) {
    refuse(`${root} carries no public source proof, so it is not a generated public tree`);
  }
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "claudex-public-head-"));
  try {
    const archive = path.join(scratch, "head.tar");
    fs.writeFileSync(archive, execFileSync("git", ["archive", "--format=tar", "HEAD"], { cwd: root, maxBuffer: 512 * 1024 * 1024, encoding: "buffer" }));
    const extracted = path.join(scratch, "tree");
    fs.mkdirSync(extracted);
    execFileSync("tar", ["-xf", archive, "-C", extracted], { stdio: "ignore" });
    verifyPublicSourceProof(extracted);
  } catch (error) {
    refuse(`the committed public source does not verify: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
