import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, test } from "vitest";

/**
 * `runtime/codex-runtime.json` is the single contract that decides which Codex
 * binary every execution path selects, so `ensure` rebuilds it from a release
 * already on disk instead of reaching for the network. These cases pin what
 * that recovery may and may not touch.
 */
const roots: string[] = [];
afterEach(() => { while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true }); });

const RUNTIME_CLI = path.resolve("..", "bin", "codex-runtime.mjs");

/** A complete standalone release, as `releaseComplete()` defines complete. */
function installRelease(root: string, version: string) {
  const target = "x86_64-unknown-linux-gnu";
  const release = path.join(root, "runtime", "codex-home", "packages", "standalone", "releases", `${version}-${target}`);
  fs.mkdirSync(path.join(release, "bin"), { recursive: true });
  fs.mkdirSync(path.join(release, "codex-path"), { recursive: true });
  fs.writeFileSync(path.join(release, "codex-package.json"), JSON.stringify({ version }));
  const binary = path.join(release, "bin", "codex");
  fs.writeFileSync(binary, `#!/bin/sh\necho "codex-cli ${version}"\n`, { mode: 0o755 });
  for (const file of [path.join(release, "bin", "codex-code-mode-host"), path.join(release, "codex-path", "rg")]) {
    fs.writeFileSync(file, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  }
  return binary;
}

function ensure(root: string) {
  return spawnSync(process.execPath, [RUNTIME_CLI, "ensure"], {
    encoding: "utf8",
    // No network is reachable from this fixture's point of view: recovery that
    // needed metadata would fail rather than quietly install something.
    env: { ...process.env, CLAUDEX_WORKHOUSE_ROOT: root }
  });
}

describe("Codex runtime state recovery", () => {
  test("ensure rebuilds a lost state file from the release on disk", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "claudex-codex-recovery-"));
    roots.push(root);
    const binary = installRelease(root, "1.2.3");
    const result = ensure(root);
    expect(result.status, result.stderr).toBe(0);
    const state = JSON.parse(fs.readFileSync(path.join(root, "runtime", "codex-runtime.json"), "utf8"));
    expect(state.version).toBe("1.2.3");
    expect(path.resolve(root, state.binary)).toBe(binary);
    // The digest is of the binary, not of an upstream package archive that is
    // not derivable offline, and it says so.
    expect(state.digestSource).toBe("binary");
  });

  test("recovery leaves the PATH link a shell resolves `codex` through in place", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "claudex-codex-recovery-link-"));
    roots.push(root);
    const binary = installRelease(root, "1.2.3");
    const link = path.join(root, "runtime", "bin", "codex");
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(binary, link);
    const result = ensure(root);
    expect(result.status, result.stderr).toBe(0);
    // Recovering a lost state file is not an install: nothing was replaced, so
    // deleting the installer links here would only break the user's own PATH
    // and hand `codex` to an unrelated global build.
    expect(fs.existsSync(link)).toBe(true);
    expect(fs.realpathSync(link)).toBe(fs.realpathSync(binary));
  });
});
