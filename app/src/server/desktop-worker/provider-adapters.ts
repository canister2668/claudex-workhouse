// Per-provider execution contracts for the Desktop Worker.
//
// The Worker used to accept only `claude` and `codex` and reject everything
// else with a flat "Unsupported provider." The runtime screen meanwhile listed
// all six, so a Windows user saw DeepSeek, Ollama, Gemini and Grok offered and
// got a generic failure on use. This module is the single place that decides
// what each provider can actually do on this host, and the same table drives
// both the capability response the UI renders and the launch the Worker
// performs — so the UI cannot advertise something the Worker will refuse.
//
// The argument vectors below mirror the live server's own provider adapters
// (`src/server/providers/*.ts`) exactly. They are duplicated deliberately
// rather than imported: those adapters own database rows, snapshots and the
// server's config object, none of which exist inside a Worker process. What
// must stay identical is the child process contract, and the parity tests
// assert that against the live adapters' source.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compatibleProviderConfig, compatibleProviderEnvironment, type CompatibleProviderId } from "../compatible-provider-config.js";
import { antigravityBinary, antigravityTaskEnvironment, geminiCliEnvironment } from "../antigravity-environment.js";
import { resolveGeminiCliEntry } from "../gemini-cli-runtime.js";
import { normalizeAntigravityExecutionSettings } from "../antigravity-execution-settings.js";
import { grokTaskEnvironment } from "../grok-task-environment.js";
import { managedCodexBinary, managedCodexRuntimeFault } from "../codex-runtime.js";
import type { WorkerConfig } from "./config.js";

export const WORKER_PROVIDERS = ["claude", "codex", "deepseek", "ollama", "antigravity", "grok"] as const;
export type WorkerProviderId = (typeof WORKER_PROVIDERS)[number];

export type ProviderOperation = "start" | "status" | "stop" | "resume" | "fork" | "compact" | "delete";

export type ProviderCapabilities = {
  provider: WorkerProviderId;
  /** How the provider reaches its model, which is what the UI labels it as. */
  management: "managed-cli" | "external-cli" | "api-backend";
  /** The executable or engine a launch actually runs. */
  runtimeKind: "own-cli" | "claude-code-engine" | "app-server";
  /** False when a launch would certainly fail; `reason` says why. */
  runnable: boolean;
  reason: string | null;
  operations: Record<ProviderOperation, boolean>;
  /**
   * Whether this provider keeps its own store of sessions created outside
   * Workhouse. DeepSeek and Ollama drive the Claude Code engine against a
   * different endpoint and own no session store of their own, so they report
   * false rather than borrowing Claude's transcripts and mislabelling them.
   */
  externalSessionDiscovery: boolean;
  /** Named so the UI can say what actually answers a DeepSeek or Ollama task. */
  backend: string | null;
};

/**
 * Every provider supports the same task operations, because every one of them
 * is launched as a fresh child process carrying the prior session id. Grok's
 * fork is implemented on `GrokProvider.forkThread` like the rest; the only
 * genuinely provider-specific answer in this file is external session
 * discovery.
 */
const ALL_OPERATIONS: Record<ProviderOperation, boolean> = { start: true, status: true, stop: true, resume: true, fork: true, compact: true, delete: true };
const NO_OPERATIONS: Record<ProviderOperation, boolean> = { start: false, status: false, stop: false, resume: false, fork: false, compact: false, delete: false };

export type ProviderRuntimePaths = {
  /** The Worker's own home, used for state files and spool. */
  home: string;
  /** The installation data root, two levels above the Worker home. */
  dataRoot: string;
  /** Loopback port of the server this Worker is paired to. */
  port: number;
};

export function workerRuntimePaths(config: WorkerConfig, home: string): ProviderRuntimePaths {
  let port = 3410;
  try { port = Number(new URL(String(config.serverUrl)).port || 3410) || 3410; } catch { /* keep the default loopback port */ }
  return { home, dataRoot: path.dirname(path.dirname(home)), port };
}

const executable = (file: string | null | undefined) => {
  if (!file) return false;
  try { return fs.statSync(file).isFile(); } catch { return false; }
};

/**
 * Resolves the Grok CLI the same way the server's `resolveGrokBinary` does:
 * the versioned `~/.grok/bin` directory first, then the installation's managed
 * `runtime/bin`. Returning null is what makes the capability report say Grok is
 * not installed instead of letting a launch fail later with ENOENT.
 */
export function resolveWorkerGrokBinary(paths: ProviderRuntimePaths, platform: NodeJS.Platform = process.platform, homeDir = os.homedir()): string | null {
  const name = platform === "win32" ? "grok.exe" : "grok";
  const versioned = path.join(homeDir, ".grok", "bin");
  try {
    const managed = fs.readdirSync(versioned)
      .filter(entry => new RegExp(`^grok(?:-[0-9][a-z0-9._-]*)?(?:\\.exe)?$`, "i").test(entry))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
      .map(entry => path.join(versioned, entry))
      .find(executable);
    if (managed) return managed;
  } catch { /* Grok has not been installed for this account */ }
  const managedBin = path.join(paths.dataRoot, "runtime", "bin", name);
  return executable(managedBin) ? managedBin : null;
}

export function resolveWorkerAntigravityBinary(paths: ProviderRuntimePaths): string | null {
  const binary = antigravityBinary({ root: paths.dataRoot, dataRoot: paths.dataRoot } as any);
  return executable(binary) ? binary : null;
}

/**
 * Builds the truthful capability matrix for this host.
 *
 * `providerBinary` for Claude and Codex is whatever the Worker would actually
 * launch, so the matrix cannot claim a provider is runnable while the launch
 * resolver would pick nothing.
 */
export function providerCapabilities(input: {
  config: WorkerConfig;
  paths: ProviderRuntimePaths;
  claudeBinary: string | null;
  codexBinary: string | null;
  platform?: NodeJS.Platform;
  /** Injectable so a capability check is decided by the installation under
   * test rather than by whatever the machine running it happens to have. */
  homeDir?: string;
}): ProviderCapabilities[] {
  const { config, paths } = input;
  const platform = input.platform ?? process.platform;
  const homeDir = input.homeDir ?? os.homedir();
  const claudeReady = executable(input.claudeBinary);
  const compatible = (provider: CompatibleProviderId): ProviderCapabilities => {
    let configured: { apiKey: string; baseUrl: string; label: string } | null = null;
    // A settings file that cannot be read, or that records a base URL the URL
    // validator rejects, is a configuration fault of its own. Reporting it as
    // "no API key" — which is what treating every failure as an absent config
    // did — sends the user to add a key they already have.
    let settingsFault: string | null = null;
    try { configured = compatibleProviderConfig(provider, paths.dataRoot) as any; }
    catch (error) { configured = null; settingsFault = `The ${provider} provider settings could not be read: ${error instanceof Error ? error.message : String(error)}`; }
    // Three independent prerequisites, reported separately: the shared Claude
    // Code engine has to exist, the settings have to be readable, and the
    // endpoint needs a key. Collapsing them into one "unavailable" is what made
    // the failure unactionable.
    const reason = !claudeReady
      ? "The Claude Code runtime that DeepSeek and Ollama execute through is not installed on this host."
      : settingsFault
        ? settingsFault
        : !configured?.apiKey
          ? `A ${configured?.label ?? provider} API key is required. Add it in Provider settings.`
          : null;
    return {
      provider,
      management: "api-backend",
      runtimeKind: "claude-code-engine",
      runnable: reason === null,
      reason,
      operations: reason === null ? ALL_OPERATIONS : { ...NO_OPERATIONS, status: true },
      externalSessionDiscovery: false,
      backend: configured?.baseUrl ? new URL(configured.baseUrl).origin : null
    };
  };
  const externalCli = (provider: "antigravity" | "grok", binary: string | null, label: string): ProviderCapabilities => {
    const reason = binary ? null : `The ${label} CLI is not installed on this host. Install and sign in to it, then refresh Provider status.`;
    return {
      provider,
      management: "external-cli",
      runtimeKind: "own-cli",
      runnable: reason === null,
      reason,
      operations: reason === null ? ALL_OPERATIONS : { ...NO_OPERATIONS, status: true },
      // Neither CLI exposes a machine-readable store of sessions started
      // outside Workhouse, so neither can honestly offer discovery.
      externalSessionDiscovery: false,
      backend: null
    };
  };
  // A recorded-but-broken managed runtime is a diagnosable installation fault,
  // and `managedCodexBinary()` still answers a path for it. Deciding it here
  // means both a launch and a session command report the fault by name instead
  // of failing later with an ENOENT from a child process.
  const codexFault = managedCodexRuntimeFault(paths.dataRoot, platform);
  const codexReady = codexFault === null && executable(input.codexBinary);
  return [
    {
      provider: "claude",
      management: "managed-cli",
      runtimeKind: "own-cli",
      runnable: claudeReady,
      reason: claudeReady ? null : "The managed Claude runtime is not installed on this host.",
      operations: claudeReady ? ALL_OPERATIONS : { ...NO_OPERATIONS, status: true },
      externalSessionDiscovery: true,
      backend: null
    },
    {
      provider: "codex",
      management: "managed-cli",
      runtimeKind: "app-server",
      runnable: codexReady,
      reason: codexReady ? null : codexFault ?? "The managed Codex runtime is not installed on this host.",
      operations: codexReady ? ALL_OPERATIONS : { ...NO_OPERATIONS, status: true },
      externalSessionDiscovery: true,
      backend: null
    },
    compatible("deepseek"),
    compatible("ollama"),
    externalCli("antigravity", resolveWorkerAntigravityBinary(paths), "Gemini Antigravity"),
    externalCli("grok", resolveWorkerGrokBinary(paths, platform, homeDir), "Grok")
  ];
}

export function capabilityError(capability: ProviderCapabilities) {
  return Object.assign(new Error(capability.reason ?? `${capability.provider} cannot run on this host.`), {
    code: "PROVIDER_CAPABILITY_UNAVAILABLE",
    statusCode: 409,
    provider: capability.provider
  });
}

export type LaunchPlan = { runner: string; args: string[]; environment: NodeJS.ProcessEnv; backend: string | null };

/**
 * Produces the child process contract for one launch.
 *
 * The `claude`, `deepseek` and `ollama` vectors are identical because the
 * compatible providers drive the very same `claude-worker.js`; only the
 * endpoint environment differs. That is the actual product behaviour and the
 * reason those two providers are described as an API backend rather than as a
 * CLI of their own.
 */
export function resolveLaunchPlan(input: {
  provider: WorkerProviderId;
  paths: ProviderRuntimePaths;
  runner: (name: string) => string;
  stateFile: string;
  taskId: string;
  mode: "new" | "resume" | "fork" | "compact";
  cwd: string;
  marker: string;
  prompt: string;
  profile: string;
  model: string;
  effort: string;
  workMode: string;
  automationLevel: string;
  runtimeProfile: string;
  threadId: string;
  sessionId: string;
  claudeBinary: string;
  antigravityExecution?: unknown;
  googleSearchMode?: string;
  homeDir?: string;
}): LaunchPlan {
  const { provider, paths } = input;
  if (provider === "claude" || provider === "deepseek" || provider === "ollama") {
    const args = [
      input.runner("claude-worker.js"), input.stateFile, input.taskId, input.claudeBinary,
      input.mode === "compact" ? "resume" : input.mode, input.cwd, input.marker,
      input.profile, input.model, input.effort, input.workMode, input.threadId, input.prompt
    ];
    if (provider === "claude") return { runner: "claude-worker.js", args, environment: {}, backend: null };
    const config = compatibleProviderConfig(provider, paths.dataRoot);
    if (!config.apiKey) throw Object.assign(new Error(`A ${config.label} API key is required.`), { code: "PROVIDER_AUTH_REQUIRED", statusCode: 409 });
    return {
      runner: "claude-worker.js",
      args,
      // The key reaches the child through its environment only. It is never
      // returned to the server, written to task metadata, or logged.
      environment: {
        ...compatibleProviderEnvironment(provider, paths.dataRoot, input.model),
        CLAUDEX_WORKHOUSE_PROVIDER_ID: provider,
        CLAUDEX_WORKHOUSE_PROVIDER_LABEL: config.label
      },
      backend: new URL(config.baseUrl).origin
    };
  }
  if (provider === "grok") {
    const binary = resolveWorkerGrokBinary(paths, process.platform, input.homeDir);
    if (!binary) throw Object.assign(new Error("The Grok CLI is not installed on this host."), { code: "PROVIDER_CAPABILITY_UNAVAILABLE", statusCode: 409 });
    return {
      runner: "grok-worker.js",
      args: [
        input.runner("grok-worker.js"), input.stateFile, input.taskId, binary,
        input.mode === "compact" ? "resume" : input.mode, input.cwd, input.marker,
        input.profile, input.model, input.effort, input.workMode, input.automationLevel,
        input.threadId, input.sessionId, input.prompt
      ],
      environment: grokTaskEnvironment(binary, path.dirname(input.stateFile), paths.port, input.taskId, input.runtimeProfile as any),
      backend: null
    };
  }
  const execution = normalizeAntigravityExecutionSettings(input.antigravityExecution);
  const vertex = execution.backend === "vertex";
  const configLike = { dataDir: path.join(paths.dataRoot, "data") } as any;
  if (execution.backend === "vertex-agent") {
    const entry = resolveGeminiCliEntry(paths.dataRoot);
    if (!entry) throw Object.assign(new Error("The Gemini CLI is not installed on this host."), { code: "PROVIDER_CAPABILITY_UNAVAILABLE", statusCode: 409 });
    return {
      runner: "gemini-cli-worker.js",
      args: [
        input.runner("gemini-cli-worker.js"), input.stateFile, input.taskId, entry.kind, entry.entry,
        input.mode === "compact" ? "resume" : input.mode, input.cwd, input.marker,
        input.profile, input.model, input.workMode, input.sessionId, input.threadId, input.prompt
      ],
      environment: {
        ...geminiCliEnvironment(configLike, execution),
        CLAUDEX_WORKHOUSE_DATA_ROOT: paths.dataRoot,
        CLAUDEX_WORKHOUSE_CURRENT_TASK_ID: input.taskId,
        CLAUDEX_WORKHOUSE_RUNTIME_PROFILE: input.runtimeProfile
      },
      backend: "gemini-cli-vertex"
    };
  }
  const environment = {
    ...antigravityTaskEnvironment({ dataDir: path.join(paths.dataRoot, "data") } as any, path.dirname(input.stateFile), paths.port, input.taskId, execution, undefined, undefined, input.runtimeProfile as any),
    CLAUDEX_WORKHOUSE_DATA_ROOT: paths.dataRoot,
    CLAUDEX_WORKHOUSE_CURRENT_TASK_ID: input.taskId,
    CLAUDEX_WORKHOUSE_RUNTIME_PROFILE: input.runtimeProfile
  };
  if (vertex) {
    return {
      runner: "vertex-worker.js",
      args: [
        input.runner("vertex-worker.js"), input.stateFile, input.taskId,
        input.mode === "compact" ? "resume" : input.mode, input.cwd, input.marker,
        input.model, input.sessionId, input.threadId, JSON.stringify(execution),
        input.googleSearchMode ?? "default", input.prompt
      ],
      environment,
      backend: "vertex-api"
    };
  }
  const binary = resolveWorkerAntigravityBinary(paths);
  if (!binary) throw Object.assign(new Error("The Gemini Antigravity CLI is not installed on this host."), { code: "PROVIDER_CAPABILITY_UNAVAILABLE", statusCode: 409 });
  return {
    runner: "antigravity-worker.js",
    args: [
      input.runner("antigravity-worker.js"), input.stateFile, input.taskId, binary,
      input.mode === "compact" ? "resume" : input.mode, input.cwd, input.marker,
      input.profile, input.model, input.effort, execution.backend, input.runtimeProfile,
      input.threadId, input.prompt
    ],
    environment,
    backend: "antigravity-cli"
  };
}
