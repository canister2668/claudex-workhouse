import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { managedCodexRuntime, managedCodexRuntimeFault, managedCodexRuntimeState } from "../../src/server/codex-runtime.js";
import { codexRuntimeSelection } from "../../src/server/codex/app-server.js";

const roots: string[] = [];
function dataRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "claudex-codex-runtime-"));
  roots.push(root);
  return root;
}
afterEach(() => { while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true }); });

const DIGEST = "a".repeat(64);

function installRelease(root: string, version: string) {
  const release = path.join(root, "runtime", "codex-home", "packages", "standalone", "releases", `${version}-x86_64-unknown-linux-gnu`, "bin");
  fs.mkdirSync(release, { recursive: true });
  const binary = path.join(release, "codex");
  fs.writeFileSync(binary, "#!/bin/sh\n", { mode: 0o755 });
  return binary;
}

function writeState(root: string, value: unknown) {
  fs.mkdirSync(path.join(root, "runtime"), { recursive: true });
  fs.writeFileSync(path.join(root, "runtime", "codex-runtime.json"), JSON.stringify(value));
}

describe("managed Codex runtime contract", () => {
  test("a complete record selects the versioned binary the state file names", () => {
    const root = dataRoot();
    const binary = installRelease(root, "1.2.3");
    writeState(root, { schema: 1, source: "openai-standalone", version: "1.2.3", sha256: DIGEST, binary: path.relative(root, binary).split(path.sep).join("/") });
    const state = managedCodexRuntimeState(root, "linux");
    expect(state.status).toBe("ok");
    expect(state.status === "ok" && state.runtime.binary).toBe(binary);
    expect(managedCodexRuntime(root, "linux")?.version).toBe("1.2.3");
  });

  test("no state file and no legacy runtime is absent, not corrupt", () => {
    expect(managedCodexRuntimeState(dataRoot(), "linux").status).toBe("absent");
  });

  // The distinction this whole type exists for: a recorded runtime whose binary
  // has gone missing must not quietly become "nothing is installed", because
  // that is what let an unmanaged `codex` on PATH take over the session.
  test("a recorded runtime whose binary is gone is corrupt", () => {
    const root = dataRoot();
    const binary = installRelease(root, "1.2.3");
    writeState(root, { schema: 1, source: "openai-standalone", version: "1.2.3", sha256: DIGEST, binary: path.relative(root, binary).split(path.sep).join("/") });
    fs.rmSync(binary);
    const state = managedCodexRuntimeState(root, "linux");
    expect(state.status).toBe("corrupt");
    expect(state.status === "corrupt" && state.reason).toContain("1.2.3");
  });

  test("a state file pointing outside the managed release directory is corrupt", () => {
    const root = dataRoot();
    writeState(root, { schema: 1, source: "openai-standalone", version: "1.2.3", sha256: DIGEST, binary: "runtime/codex-bin/codex" });
    expect(managedCodexRuntimeState(root, "linux").status).toBe("corrupt");
  });

  test("an unparsable state file is corrupt rather than absent", () => {
    const root = dataRoot();
    fs.mkdirSync(path.join(root, "runtime"), { recursive: true });
    fs.writeFileSync(path.join(root, "runtime", "codex-runtime.json"), "{ not json");
    expect(managedCodexRuntimeState(root, "linux").status).toBe("corrupt");
  });

  test("runtime selection refuses to fall back to a different Codex when the record is damaged", () => {
    const root = dataRoot();
    const binary = installRelease(root, "1.2.3");
    writeState(root, { schema: 1, source: "openai-standalone", version: "1.2.3", sha256: DIGEST, binary: path.relative(root, binary).split(path.sep).join("/") });
    fs.rmSync(binary);
    const env = { CLAUDEX_WORKHOUSE_DATA_ROOT: root } as NodeJS.ProcessEnv;
    // On POSIX the previous behaviour returned the global `/usr/local/bin/codex`
    // here, which is the silent downgrade the contract forbids.
    const selection = codexRuntimeSelection(root, env, "linux");
    expect(selection.source).toBe("corrupt");
    expect(selection.binary).toBeNull();
    expect(selection.reason).toBeTruthy();
  });

  // `digestSource` exists so a digest of the binary is never read as a digest
  // of the upstream package. That only holds if a reader can actually see the
  // difference, so the runtime record carries it.
  test("a digest rebuilt from the binary is reported as a binary digest", () => {
    const root = dataRoot();
    const binary = installRelease(root, "1.2.3");
    const relative = path.relative(root, binary).split(path.sep).join("/");
    writeState(root, { schema: 1, source: "openai-standalone", version: "1.2.3", sha256: DIGEST, digestSource: "binary", binary: relative });
    expect(managedCodexRuntime(root, "linux")?.checksumSource).toBe("binary");
    writeState(root, { schema: 1, source: "openai-standalone", version: "1.2.3", sha256: DIGEST, binary: relative });
    expect(managedCodexRuntime(root, "linux")?.checksumSource).toBe("package");
  });

  test("a damaged record is a named fault for every launch path, not only app-server", () => {
    const root = dataRoot();
    const binary = installRelease(root, "1.2.3");
    writeState(root, { schema: 1, source: "openai-standalone", version: "1.2.3", sha256: DIGEST, binary: path.relative(root, binary).split(path.sep).join("/") });
    fs.rmSync(binary);
    expect(managedCodexRuntimeFault(root, "linux")).toContain("1.2.3");
    // A healthy installation reports no fault, so the check cannot block one.
    installRelease(root, "1.2.3");
    expect(managedCodexRuntimeFault(root, "linux")).toBeNull();
  });

  test("an explicitly configured binary still wins over the managed record", () => {
    const root = dataRoot();
    const selection = codexRuntimeSelection(root, { CLAUDEX_WORKHOUSE_DATA_ROOT: root, CLAUDEX_WORKHOUSE_CODEX_BIN: "/opt/codex" } as NodeJS.ProcessEnv, "linux");
    expect(selection).toEqual({ binary: "/opt/codex", source: "configured" });
  });
});
