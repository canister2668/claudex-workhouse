import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { RemoteTaskManager, providerSessions } from "../../src/server/desktop-worker/tasks.js";
import { WORKER_PROVIDERS } from "../../src/server/desktop-worker/provider-adapters.js";

const roots: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true }); });

const executable = (file: string) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, "#!/bin/sh\nexit 0\n", { mode: 0o755 }); return file; };

/**
 * A Worker installation on disk: the runtime home two levels below the data
 * root, one registered workspace, and whichever provider runtimes the case
 * under test wants present.
 */
function installation(options: { claude?: boolean; codex?: boolean; grok?: boolean; antigravity?: boolean; keys?: boolean } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "claudex-worker-routing-"));
  roots.push(root);
  // Grok is discovered under the user's home directory, so a machine that
  // genuinely has the Grok CLI installed would otherwise decide this fixture's
  // capability answers — and, worse, actually launch it.
  vi.stubEnv("HOME", path.join(root, "home"));
  vi.stubEnv("USERPROFILE", path.join(root, "home"));
  const home = path.join(root, "runtime", "local-worker");
  const workspace = path.join(root, "workspace");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  if (options.claude !== false) executable(path.join(root, "runtime", "claude-bin", "claude"));
  if (options.codex !== false) executable(path.join(root, "runtime", "codex-bin", "codex"));
  if (options.grok) executable(path.join(root, "runtime", "bin", "grok"));
  if (options.antigravity) executable(path.join(root, "runtime", "bin", "agy"));
  if (options.keys) {
    const file = path.join(root, "config", "compatible-providers.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ version: 1, deepseek: { baseUrl: null, apiKey: "sk-fixture-deepseek" }, ollama: { baseUrl: null, apiKey: "fixture-ollama" } }));
  }
  const config: any = {
    runtimeHome: home,
    serverUrl: "http://127.0.0.1:3410",
    hostId: "local",
    managedLocal: true,
    claudeBinary: path.join(root, "runtime", "claude-bin", "claude"),
    codexBinary: path.join(root, "runtime", "codex-bin", "codex"),
    roots: [{ id: "root", displayName: "root", canonicalPath: root, allowCreate: true, allowRegister: true, allowClone: true, allowDelete: true }],
    workspaces: [{ id: "workspace", projectId: "p", hostId: "local", rootId: "root", relativePath: "workspace", canonicalPath: workspace, displayName: "workspace", workspaceType: "directory", createdAt: "", updatedAt: "" }],
    tasks: []
  };
  return { root, home, workspace, config };
}

function manager(config: any) {
  const instance = new RemoteTaskManager(config, () => true, () => {});
  instance.close();
  return instance;
}

describe("Windows Worker six-provider routing", () => {
  test("the Worker reports a capability entry for every provider the product exposes", () => {
    const { config } = installation();
    const tasks = manager(config);
    expect(tasks.capabilities().map(item => item.provider).sort()).toEqual([...WORKER_PROVIDERS].sort());
  });

  // The regression this replaces: the Worker answered a flat "Unsupported
  // provider." for four of the six, while the UI offered all six.
  test.each(["deepseek", "ollama", "antigravity", "grok"] as const)("%s is no longer rejected as an unknown provider", async provider => {
    const { config } = installation();
    const tasks = manager(config);
    const error = await tasks.command("provider.task.start", { provider, taskId: `${provider}:t`, workspaceId: "workspace", prompt: "hello" }).catch(e => e);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).not.toMatch(/Unsupported provider/);
    // It refuses for a specific, actionable reason instead.
    expect(error.code).toBe("PROVIDER_CAPABILITY_UNAVAILABLE");
    expect(error.message).toMatch(/API key|not installed|Claude Code runtime/i);
  });

  test("a provider that is genuinely unknown is still rejected", async () => {
    const { config } = installation();
    const tasks = manager(config);
    const error = await tasks.command("provider.task.start", { provider: "not-a-provider", taskId: "x", workspaceId: "workspace", prompt: "hi" }).catch(e => e);
    expect(error.code).toBe("PROVIDER_UNSUPPORTED");
  });

  // Capability parity: what the matrix advertises is exactly what start admits.
  test("no provider is advertised as runnable while its launch is refused, or the reverse", async () => {
    const { config } = installation({ grok: true, antigravity: true, keys: true });
    const tasks = manager(config);
    for (const capability of tasks.capabilities()) {
      const error = await tasks.command("provider.task.start", { provider: capability.provider, taskId: `${capability.provider}:11111111-1111-4111-8111-111111111111`, workspaceId: "workspace", prompt: "hello" }).catch(e => e);
      const refusedForCapability = error instanceof Error && error.code === "PROVIDER_CAPABILITY_UNAVAILABLE";
      expect(refusedForCapability, `${capability.provider} advertised runnable=${capability.runnable}`).toBe(!capability.runnable);
    }
  });

  test("session discovery states every provider's answer, including the negative ones", async () => {
    const { config } = installation();
    const tasks = manager(config);
    const result = await providerSessions(config, tasks) as any;
    expect(Object.keys(result.discovery).sort()).toEqual([...WORKER_PROVIDERS].sort());
    expect(result.discovery.claude.externalSessionDiscovery).toBe(true);
    expect(result.discovery.codex.externalSessionDiscovery).toBe(true);
    for (const provider of ["deepseek", "ollama", "antigravity", "grok"] as const) {
      expect(result.discovery[provider].externalSessionDiscovery, provider).toBe(false);
      expect(result.discovery[provider].reason, provider).toBeTruthy();
    }
  });

  // DeepSeek and Ollama borrow the Claude Code engine, so the reason has to
  // say that rather than implying a missing DeepSeek CLI.
  test.each(["deepseek", "ollama"] as const)("%s explains that it has no session store of its own", async provider => {
    const { config } = installation();
    const tasks = manager(config);
    const result = await providerSessions(config, tasks) as any;
    expect(result.discovery[provider].reason).toMatch(/Claude Code engine/i);
  });

  test.each(["deepseek", "ollama", "antigravity", "grok"] as const)("%s refuses session browsing with an unsupported-operation code", async provider => {
    const { config } = installation();
    const tasks = manager(config);
    const error = await tasks.command("provider.thread.command", { provider, operation: "list", params: {} }).catch(e => e);
    expect(error.code).toBe("PROVIDER_SESSION_DISCOVERY_UNSUPPORTED");
  });

  // Codex scopes thread listing by working directory. Substituting a different
  // workspace for an unresolvable id returned a plausible session list from
  // somewhere else with no error at all, which is worse than a refusal.
  test("a session command naming an unknown Workspace is refused, not silently rehomed", async () => {
    const { config } = installation();
    const tasks = manager(config);
    const error = await tasks.command("provider.thread.command", { provider: "codex", operation: "list", workspaceId: "does-not-exist", params: {} }).catch(e => e);
    expect(error.code).toBe("WORKSPACE_NOT_FOUND");
    expect(error.statusCode).toBe(404);
  });

  test("an unknown session operation is refused by name rather than forwarded", async () => {
    const { config } = installation();
    const tasks = manager(config);
    const error = await tasks.command("provider.thread.command", { provider: "codex", operation: "thread/evaluate", params: {} }).catch(e => e);
    expect(error.code).toBe("PROVIDER_SESSION_OPERATION_UNSUPPORTED");
  });

  // Reproduces a real crash: the Codex runtime here exits immediately, so the
  // client writes to a dead pipe. That raised EPIPE as an unhandled stream
  // error — which on Windows is a Worker process crash, not a failed request —
  // and left the caller waiting out its whole timeout with nothing rejected.
  test("a provider runtime that exits immediately fails the request instead of the process", async () => {
    const { root, config } = installation();
    fs.writeFileSync(path.join(root, "runtime", "codex-bin", "codex"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    const tasks = manager(config);
    const unhandled: unknown[] = [];
    const capture = (error: unknown) => unhandled.push(error);
    process.on("uncaughtException", capture);
    try {
      const started = Date.now();
      const error = await tasks.command("provider.thread.command", { provider: "codex", operation: "list", params: {} }).catch(e => e);
      expect(error).toBeInstanceOf(Error);
      // Rejected promptly rather than after the 30s request budget.
      expect(Date.now() - started).toBeLessThan(25_000);
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(unhandled).toEqual([]);
    } finally { process.off("uncaughtException", capture); }
  }, 40_000);

  test("the Worker advertises the new provider commands", async () => {
    const { config } = installation();
    const tasks = manager(config);
    const result = await tasks.command("provider.capabilities.read", {}) as any;
    expect(result.capabilities).toHaveLength(WORKER_PROVIDERS.length);
  });
});
