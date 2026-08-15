import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  WORKER_PROVIDERS,
  providerCapabilities,
  resolveLaunchPlan,
  resolveWorkerGrokBinary,
  workerRuntimePaths,
  type ProviderCapabilities,
  type WorkerProviderId
} from "../../src/server/desktop-worker/provider-adapters.js";

const roots: string[] = [];
function installation() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "claudex-worker-adapters-"));
  roots.push(root);
  const home = path.join(root, "runtime", "local-worker");
  fs.mkdirSync(home, { recursive: true });
  return { root, home };
}
afterEach(() => { while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true }); });

const executable = (file: string) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, "#!/bin/sh\n", { mode: 0o755 }); return file; };

function config(home: string) {
  return { runtimeHome: home, serverUrl: "http://127.0.0.1:3410", workspaces: [], roots: [], tasks: [] } as any;
}

function capabilitiesFor(root: string, home: string, options: { claude?: boolean; codex?: boolean } = {}) {
  return providerCapabilities({
    config: config(home),
    paths: workerRuntimePaths(config(home), home),
    claudeBinary: options.claude === false ? null : executable(path.join(root, "runtime", "claude-bin", "claude")),
    codexBinary: options.codex === false ? null : executable(path.join(root, "runtime", "codex-bin", "codex")),
    platform: "linux",
    // Pinned to the fixture: otherwise a real `~/.grok` on the machine running
    // the suite decides whether Grok looks installed.
    homeDir: path.join(root, "home")
  });
}
const byId = (list: ProviderCapabilities[], id: WorkerProviderId) => list.find(item => item.provider === id)!;

function writeCompatibleKeys(root: string) {
  const file = path.join(root, "config", "compatible-providers.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ version: 1, deepseek: { baseUrl: null, apiKey: "sk-deepseek-fixture" }, ollama: { baseUrl: null, apiKey: "ollama-fixture" } }));
}

describe("worker provider capability matrix", () => {
  test("every provider the product exposes has an entry", () => {
    const { root, home } = installation();
    const list = capabilitiesFor(root, home);
    expect(list.map(item => item.provider).sort()).toEqual([...WORKER_PROVIDERS].sort());
  });

  // The defect this whole matrix exists for: the runtime screen listed six
  // providers while the Worker accepted two, so four of them were offered and
  // then failed with a generic error.
  test("all six become runnable once their runtime and credentials exist", () => {
    const { root, home } = installation();
    writeCompatibleKeys(root);
    executable(path.join(root, "runtime", "bin", "agy"));
    executable(path.join(root, "runtime", "bin", "grok"));
    const list = providerCapabilities({
      config: config(home),
      paths: workerRuntimePaths(config(home), home),
      claudeBinary: executable(path.join(root, "runtime", "claude-bin", "claude")),
      codexBinary: executable(path.join(root, "runtime", "codex-bin", "codex")),
      platform: "linux",
      homeDir: path.join(root, "home")
    });
    for (const capability of list) {
      expect(capability.runnable, `${capability.provider}: ${capability.reason}`).toBe(true);
      expect(capability.operations.start).toBe(true);
    }
  });

  test.each(["deepseek", "ollama"] as const)("%s is unavailable with a specific reason when no API key is configured", provider => {
    const { root, home } = installation();
    const capability = byId(capabilitiesFor(root, home), provider);
    expect(capability.runnable).toBe(false);
    expect(capability.reason).toMatch(/API key/i);
    // Status stays available so the UI can still show why it is unavailable.
    expect(capability.operations.status).toBe(true);
    expect(capability.operations.start).toBe(false);
  });

  test.each(["deepseek", "ollama"] as const)("%s reports the missing shared engine rather than a missing key", provider => {
    const { root, home } = installation();
    writeCompatibleKeys(root);
    const capability = byId(capabilitiesFor(root, home, { claude: false }), provider);
    expect(capability.runnable).toBe(false);
    expect(capability.reason).toMatch(/Claude Code runtime/i);
  });

  test.each(["antigravity", "grok"] as const)("%s reports that its external CLI is not installed", provider => {
    const { root, home } = installation();
    const capability = byId(capabilitiesFor(root, home), provider);
    expect(capability.runnable).toBe(false);
    expect(capability.reason).toMatch(/not installed/i);
    expect(capability.management).toBe("external-cli");
  });

  // Truthfulness of the management labels the runtime screen renders.
  test.each([
    ["claude", "managed-cli", "own-cli"],
    ["codex", "managed-cli", "app-server"],
    ["deepseek", "api-backend", "claude-code-engine"],
    ["ollama", "api-backend", "claude-code-engine"],
    ["antigravity", "external-cli", "own-cli"],
    ["grok", "external-cli", "own-cli"]
  ] as const)("%s is described as %s running on %s", (provider, management, runtimeKind) => {
    const { root, home } = installation();
    const capability = byId(capabilitiesFor(root, home), provider);
    expect(capability.management).toBe(management);
    expect(capability.runtimeKind).toBe(runtimeKind);
  });

  // Only Claude and Codex own a store of sessions created outside Workhouse.
  // DeepSeek and Ollama drive the Claude Code engine, so their transcripts are
  // Claude's; claiming them would attribute a session to a runtime that never ran.
  test.each([
    ["claude", true], ["codex", true],
    ["deepseek", false], ["ollama", false], ["antigravity", false], ["grok", false]
  ] as const)("%s external session discovery is %s", (provider, expected) => {
    const { root, home } = installation();
    expect(byId(capabilitiesFor(root, home), provider).externalSessionDiscovery).toBe(expected);
  });

  test("an unavailable provider offers no operation other than status", () => {
    const { root, home } = installation();
    for (const capability of capabilitiesFor(root, home).filter(item => !item.runnable)) {
      const enabled = Object.entries(capability.operations).filter(([, value]) => value).map(([key]) => key);
      expect(enabled, capability.provider).toEqual(["status"]);
    }
  });

  // `managedCodexBinary()` answers a path even for a damaged record, so without
  // this the capability table called Codex runnable and the launch died on an
  // ENOENT from the child process instead of naming the installation fault.
  test("a damaged managed Codex record makes Codex unrunnable with the fault as its reason", () => {
    const { root, home } = installation();
    const release = path.join(root, "runtime", "codex-home", "packages", "standalone", "releases", "1.2.3-x86_64-unknown-linux-gnu", "bin", "codex");
    executable(release);
    fs.mkdirSync(path.join(root, "runtime"), { recursive: true });
    fs.writeFileSync(path.join(root, "runtime", "codex-runtime.json"), JSON.stringify({
      schema: 1, source: "openai-standalone", version: "1.2.3", sha256: "a".repeat(64),
      binary: path.relative(root, release).split(path.sep).join("/")
    }));
    fs.rmSync(release);
    const codex = byId(capabilitiesFor(root, home), "codex");
    expect(codex.runnable).toBe(false);
    expect(codex.reason).toContain("1.2.3");
    expect(codex.operations.start).toBe(false);
  });

  test("unreadable provider settings are reported as a settings fault, not as a missing key", () => {
    const { root, home } = installation();
    const file = path.join(root, "config", "compatible-providers.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // A key is present; the base URL is what the URL validator rejects. Saying
    // "add an API key" here sends the user to add one they already have.
    fs.writeFileSync(file, JSON.stringify({ version: 1, deepseek: { baseUrl: "api.deepseek.com", apiKey: "sk-deepseek-fixture" }, ollama: { baseUrl: null, apiKey: "ollama-fixture" } }));
    const deepseek = byId(capabilitiesFor(root, home), "deepseek");
    expect(deepseek.runnable).toBe(false);
    expect(deepseek.reason).toContain("settings");
    expect(deepseek.reason).not.toContain("API key is required");
  });

  test("the Grok CLI is found in the versioned home directory first", () => {
    const { root, home } = installation();
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "claudex-grok-home-"));
    roots.push(homeDir);
    executable(path.join(homeDir, ".grok", "bin", "grok-1.4.0"));
    expect(resolveWorkerGrokBinary(workerRuntimePaths(config(home), home), "linux", homeDir)).toContain("grok-1.4.0");
    expect(resolveWorkerGrokBinary(workerRuntimePaths(config(home), home), "linux", path.join(root, "empty"))).toBeNull();
  });
});

describe("worker launch plans", () => {
  // Provider-prefixed and UUID-shaped, because the shared task environment
  // helpers reject anything else — the same id shape the server allocates.
  const FIXTURE_UUID = "11111111-1111-4111-8111-111111111111";
  const base = (root: string, home: string, provider: WorkerProviderId, taskId = `${provider}:${FIXTURE_UUID}`) => ({
    provider,
    paths: workerRuntimePaths(config(home), home),
    runner: (name: string) => `/dist-server/${name}`,
    stateFile: path.join(home, "state.json"),
    taskId,
    mode: "new" as const,
    cwd: root,
    marker: "claudex-workhouse-worker:fixture",
    prompt: "do the thing",
    profile: ":read-only",
    model: "default",
    effort: "default",
    workMode: "plan",
    automationLevel: "read",
    runtimeProfile: "default",
    threadId: "",
    sessionId: "",
    claudeBinary: "/runtime/claude-bin/claude",
    homeDir: path.join(root, "home")
  });

  // DeepSeek and Ollama drive the very same worker script as Claude. That is
  // the actual product behaviour, and it is why they are labelled an API
  // backend rather than a CLI of their own.
  test.each(["deepseek", "ollama"] as const)("%s runs the Claude Code engine against its own endpoint", provider => {
    const { root, home } = installation();
    writeCompatibleKeys(root);
    const plan = resolveLaunchPlan(base(root, home, provider));
    expect(plan.runner).toBe("claude-worker.js");
    expect(plan.args[0]).toBe("/dist-server/claude-worker.js");
    expect(plan.environment.ANTHROPIC_BASE_URL).toBeTruthy();
    expect(plan.environment.CLAUDEX_WORKHOUSE_PROVIDER_ID).toBe(provider);
    expect(plan.backend).toBe(new URL(String(plan.environment.ANTHROPIC_BASE_URL)).origin);
  });

  test("the Claude and compatible argument vectors are identical apart from the endpoint", () => {
    const { root, home } = installation();
    writeCompatibleKeys(root);
    const shared = `claude:${"11111111-1111-4111-8111-111111111111"}`;
    const claude = resolveLaunchPlan(base(root, home, "claude", shared));
    const deepseek = resolveLaunchPlan(base(root, home, "deepseek", shared));
    expect(deepseek.args).toEqual(claude.args);
    expect(claude.environment.ANTHROPIC_BASE_URL).toBeUndefined();
  });

  test.each(["deepseek", "ollama"] as const)("%s refuses to launch without a key instead of running unauthenticated", provider => {
    const { root, home } = installation();
    expect(() => resolveLaunchPlan(base(root, home, provider))).toThrow(/API key/i);
  });

  test("Grok runs its own CLI with the automation level in its argument vector", () => {
    const { root, home } = installation();
    const binary = executable(path.join(root, "runtime", "bin", "grok"));
    const plan = resolveLaunchPlan(base(root, home, "grok"));
    expect(plan.runner).toBe("grok-worker.js");
    expect(plan.args).toContain(binary);
    expect(plan.args).toContain("read");
  });

  test("Gemini runs the Antigravity CLI by default and the Vertex worker when configured", () => {
    const { root, home } = installation();
    executable(path.join(root, "runtime", "bin", "agy"));
    expect(resolveLaunchPlan(base(root, home, "antigravity")).runner).toBe("antigravity-worker.js");
    const execution = { version: 1, backend: "vertex", vertex: { projectId: "demo-project", location: "global", credentialsPath: path.join(root, "creds.json"), creditsUrl: "" } };
    const vertex = resolveLaunchPlan({ ...base(root, home, "antigravity"), antigravityExecution: execution });
    expect(vertex.runner).toBe("vertex-worker.js");
    expect(vertex.backend).toBe("vertex-api");
  });

  // A Vertex backend with no project is not a usable configuration, and the
  // shared normalizer falls back to the consumer CLI rather than launching a
  // worker that cannot authenticate.
  test("an incomplete Vertex configuration falls back to the Antigravity CLI", () => {
    const { root, home } = installation();
    executable(path.join(root, "runtime", "bin", "agy"));
    expect(resolveLaunchPlan({ ...base(root, home, "antigravity"), antigravityExecution: { backend: "vertex" } }).runner).toBe("antigravity-worker.js");
  });

  test.each(["antigravity", "grok"] as const)("%s refuses to launch when its CLI is absent", provider => {
    const { root, home } = installation();
    expect(() => resolveLaunchPlan(base(root, home, provider))).toThrow(/not installed/i);
  });

  // A secret must reach the child process and nothing else.
  test("provider credentials appear only in the child environment, never in the argument vector", () => {
    const { root, home } = installation();
    writeCompatibleKeys(root);
    const plan = resolveLaunchPlan(base(root, home, "deepseek"));
    expect(JSON.stringify(plan.args)).not.toContain("sk-deepseek-fixture");
    expect(plan.environment.ANTHROPIC_AUTH_TOKEN).toBe("sk-deepseek-fixture");
    expect(JSON.stringify(plan.backend)).not.toContain("sk-deepseek-fixture");
  });

  test("a compact request reuses the resume mode the worker scripts understand", () => {
    const { root, home } = installation();
    writeCompatibleKeys(root);
    const plan = resolveLaunchPlan({ ...base(root, home, "ollama"), mode: "compact", threadId: "abc" });
    expect(plan.args).not.toContain("compact");
    expect(plan.args).toContain("resume");
  });
});
