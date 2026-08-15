import crypto from "node:crypto";
import { sanitizeSensitiveText, sanitizeSensitiveValue } from "../sensitive-data.js";
import type {
  ExecutionHostDiagnosticsNormalizationOptions,
  HealthCheckOverall,
  HealthCheckRemediation,
  HealthCheckResult,
  HealthCheckRun,
  HealthCheckStatus,
  HealthRemediationKind,
  InfrastructureConnectionStatus,
  SystemDiagnosticsNormalizationOptions
} from "./types.js";

const DEFAULT_DISK_WARNING_BYTES = 2 * 1024 * 1024 * 1024;
const DEFAULT_DISK_FAILURE_BYTES = 512 * 1024 * 1024;

// Remediation button labels, shared across checks.
export const REMEDIATION_LABEL = {
  storageTroubleshooting: { key: "infrastructure.remediationLabel.storageTroubleshooting", text: "View storage troubleshooting" },
  storageManagement: { key: "infrastructure.remediationLabel.storageManagement", text: "View storage management" },
  rediscoverBinary: { key: "infrastructure.remediationLabel.rediscoverBinary", text: "Locate the executable again" },
  openProviderConnections: { key: "infrastructure.remediationLabel.openProviderConnections", text: "Open provider connections" },
  rerunDiagnostics: { key: "infrastructure.remediationLabel.rerunDiagnostics", text: "Run diagnostics again" },
  restartService: { key: "infrastructure.remediationLabel.restartService", text: "Restart the service" },
  recheckConnection: { key: "infrastructure.remediationLabel.recheckConnection", text: "Check the connection again" },
  openWorkspaceSettings: { key: "infrastructure.remediationLabel.openWorkspaceSettings", text: "Open workspace settings" },
  restartWorker: { key: "infrastructure.remediationLabel.restartWorker", text: "Restart the worker process" },
  workerCompatibility: { key: "infrastructure.remediationLabel.workerCompatibility", text: "Worker compatibility guide" },
  workerUpdate: { key: "infrastructure.remediationLabel.workerUpdate", text: "Worker update guide" },
  openDeviceSettings: { key: "infrastructure.remediationLabel.openDeviceSettings", text: "Open device settings" },
  taskFailureDiagnostics: { key: "infrastructure.remediationLabel.taskFailureDiagnostics", text: "View task failure diagnostics" },
  openOwnerClaim: { key: "infrastructure.remediationLabel.openOwnerClaim", text: "Open owner claim" },
  newOwnerClaim: { key: "infrastructure.remediationLabel.newOwnerClaim", text: "Create a new claim" },
  sqliteRecovery: { key: "infrastructure.remediationLabel.sqliteRecovery", text: "SQLite recovery guide" },
  dataPathPermissions: { key: "infrastructure.remediationLabel.dataPathPermissions", text: "Check data path permissions" },
  spoolPathPermissions: { key: "infrastructure.remediationLabel.spoolPathPermissions", text: "Check spool path permissions" },
  releaseNotes: { key: "infrastructure.remediationLabel.releaseNotes", text: "View release information" },
  installationGuide: { key: "infrastructure.remediationLabel.installationGuide", text: "Check the installation method" },
  openConnectionSettings: { key: "infrastructure.remediationLabel.openConnectionSettings", text: "Open connection settings" },
  openExternalAccessSettings: { key: "infrastructure.remediationLabel.openExternalAccessSettings", text: "Open external access settings" },
  cloudflareAccessGuide: { key: "infrastructure.remediationLabel.cloudflareAccessGuide", text: "Cloudflare Access connection guide" },
  // The card already names the tool, so this stays generic and needs no parameter.
  installGuide: { key: "infrastructure.remediationLabel.installGuide", text: "View the install guide" }
} as const;
// Summary text lives in the dictionary; this only pairs a key with its English form.
const summary = (id: string, text: string, params?: Record<string, string | number>) =>
  ({ key: `infrastructure.summary.${id}`, text, ...(params ? { params } : {}) });

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}

function reportOf(value: unknown): UnknownRecord {
  const outer = record(value);
  return Object.prototype.hasOwnProperty.call(outer, "report") ? record(outer.report) : outer;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function safeText(value: unknown, limit: number): string {
  return sanitizeSensitiveText(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").trim().slice(0, limit);
}

function safeDetail(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const sanitized = sanitizeSensitiveValue(value, { maxDepth: 5, maxEntries: 80, maxStringLength: 800 });
  if (typeof sanitized === "string") return safeText(sanitized, 1200) || undefined;
  try {
    return safeText(JSON.stringify(sanitized), 1200) || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Diagnostics text is produced outside the UI, so every string ships as a
 * dictionary key alongside English text. The key is what the panel renders; the
 * text is what support bundles and logs keep.
 */
export type LocalizedText = string | { key: string; text: string; params?: Record<string, string | number> };
const textOf = (value: LocalizedText) => (typeof value === "string" ? value : value.text);
const keyOf = (value: LocalizedText) => (typeof value === "string" ? undefined : value.key);
const paramsOf = (value: LocalizedText) => (typeof value === "string" ? undefined : value.params);

export function safeHealthRemediation(
  kind: HealthRemediationKind,
  label: LocalizedText,
  payload?: Record<string, unknown>
): HealthCheckRemediation {
  const sanitized = payload
    ? sanitizeSensitiveValue(payload, { maxDepth: 4, maxEntries: 40, maxStringLength: 400 })
    : undefined;
  return {
    kind,
    label: safeText(textOf(label), 120),
    ...(keyOf(label) ? { labelKey: keyOf(label) } : {}),
    safe: true,
    ...(sanitized && typeof sanitized === "object" && !Array.isArray(sanitized)
      ? { payload: sanitized as Record<string, unknown> }
      : {})
  };
}

export function healthCheck(
  key: string,
  label: string,
  status: HealthCheckStatus,
  summary: LocalizedText,
  detail?: unknown,
  remediation?: HealthCheckRemediation
): HealthCheckResult {
  const sanitizedDetail = safeDetail(detail);
  return {
    key,
    label: safeText(label, 120),
    status,
    summary: safeText(textOf(summary), 300),
    ...(keyOf(summary) ? { summaryKey: keyOf(summary) } : {}),
    ...(paramsOf(summary) ? { summaryParams: paramsOf(summary) } : {}),
    ...(sanitizedDetail ? { detail: sanitizedDetail } : {}),
    ...(remediation ? { remediation } : {})
  };
}

export function healthOverall(checks: readonly HealthCheckResult[]): HealthCheckOverall {
  if (checks.some((check) => check.status === "failed")) return "failed";
  if (checks.some((check) => check.status === "warning")) return "warning";
  return "healthy";
}

export function createHealthCheckRun(
  targetType: HealthCheckRun["targetType"],
  targetId: string,
  checks: HealthCheckResult[],
  options: { id?: string; startedAt?: string; completedAt?: string | null } = {}
): HealthCheckRun {
  const startedAt = options.startedAt ?? new Date().toISOString();
  return {
    id: options.id ?? crypto.randomUUID(),
    targetType,
    targetId,
    startedAt,
    completedAt: options.completedAt === undefined ? new Date().toISOString() : options.completedAt,
    overall: healthOverall(checks),
    checks
  };
}

export function healthConnectionStatus(value: unknown): InfrastructureConnectionStatus {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["online", "normal", "local", "ready", "connected", "degraded"].includes(normalized)) return "online";
  if (["connecting", "pairing", "reconnecting", "starting"].includes(normalized)) return "connecting";
  if (["offline", "disabled", "revoked", "stopped", "unpaired", "disconnected", "failed"].includes(normalized)) return "offline";
  return "unknown";
}

function diskCheck(
  key: string,
  label: string,
  value: unknown,
  warningBytes = DEFAULT_DISK_WARNING_BYTES,
  failureBytes = DEFAULT_DISK_FAILURE_BYTES
): HealthCheckResult {
  const freeBytes = finiteNumber(value);
  if (freeBytes === null || freeBytes < 0) return healthCheck(key, label, "skipped", summary("storage.unreported", "Free storage was not reported."));
  const gib = freeBytes / (1024 * 1024 * 1024);
  const detail = `${gib.toFixed(gib >= 10 ? 1 : 2)} GiB available`;
  if (freeBytes < failureBytes) {
    return healthCheck(key, label, "failed", summary("storage.critical", "There is not enough storage to run tasks and the database safely."), detail, safeHealthRemediation("documentation", REMEDIATION_LABEL.storageTroubleshooting, { topic: "storage" }));
  }
  if (freeBytes < warningBytes) {
    return healthCheck(key, label, "warning", summary("storage.low", "Free storage is below the recommended threshold."), detail, safeHealthRemediation("documentation", REMEDIATION_LABEL.storageManagement, { topic: "storage" }));
  }
  return healthCheck(key, label, "passed", summary("storage.ok", "There is enough storage available."), detail);
}

function statusValue(value: unknown): string {
  if (typeof value === "string") return value.trim().toLowerCase();
  const item = record(value);
  return String(item.status ?? item.state ?? "").trim().toLowerCase();
}

function failedIndicator(value: unknown): boolean {
  if (value === false) return true;
  const status = statusValue(value);
  return ["failed", "failure", "error", "unavailable", "offline", "broken"].includes(status);
}

function passedIndicator(value: unknown): boolean {
  if (value === true) return true;
  const status = statusValue(value);
  return ["ok", "passed", "healthy", "normal", "available", "online", "ready", "connected"].includes(status);
}

function diagnosticError(value: unknown): unknown {
  const item = record(value);
  return item.error ?? item.detail ?? item.message ?? item.reason;
}

function runtimeFor(report: UnknownRecord, provider: "claude" | "codex"): UnknownRecord {
  const runtimes = report.runtimes;
  if (Array.isArray(runtimes)) return record(runtimes.find((item) => record(item).provider === provider));
  return record(record(runtimes)[provider]);
}

function accountFor(report: UnknownRecord, provider: "claude" | "codex"): UnknownRecord {
  const accounts = report.accounts ?? report.providerAccounts;
  if (Array.isArray(accounts)) return record(accounts.find((item) => record(item).provider === provider));
  return record(record(accounts)[provider]);
}

function runtimeInstalled(runtime: UnknownRecord): boolean | null {
  if (typeof runtime.installed === "boolean") return runtime.installed;
  if (typeof runtime.current === "string") return runtime.current.trim().length > 0;
  if (typeof runtime.version === "string") return runtime.version.trim().length > 0;
  if (statusValue(runtime) === "unavailable") return false;
  return null;
}

function runtimeVersion(runtime: UnknownRecord): string | undefined {
  const value = runtime.version ?? runtime.current;
  return typeof value === "string" && value.trim() ? safeText(value, 120) : undefined;
}

function runtimeCheck(report: UnknownRecord, provider: "claude" | "codex"): HealthCheckResult {
  const runtime = runtimeFor(report, provider);
  const installed = runtimeInstalled(runtime);
  // Keyed per provider rather than interpolated: an English executable name embedded
  // in a Korean or Japanese sentence would not read correctly.
  const name = provider === "claude" ? "Claude Code executable" : "Codex executable";
  if (installed === true) return healthCheck(`runtime.${provider}`, name, "passed", summary(`runtime.${provider}.found`, `${name} was found.`), runtimeVersion(runtime));
  if (installed === false) {
    return healthCheck(`runtime.${provider}`, name, "warning", summary(`runtime.${provider}.missing`, `${name} was not found.`), diagnosticError(runtime), safeHealthRemediation("rediscover-binary", REMEDIATION_LABEL.rediscoverBinary, { provider }));
  }
  return healthCheck(`runtime.${provider}`, name, "warning", summary(`runtime.${provider}.unknown`, `${name} status could not be determined.`), diagnosticError(runtime), safeHealthRemediation("rediscover-binary", REMEDIATION_LABEL.rediscoverBinary, { provider }));
}

function accountCheck(report: UnknownRecord, provider: "claude" | "codex"): HealthCheckResult {
  const account = accountFor(report, provider);
  const name = provider === "claude" ? "Claude authentication" : "Codex account/read";
  const providerName = provider === "claude" ? "Claude" : "Codex";
  const state = String(account.state ?? "").trim().toLowerCase();
  if (state === "connected") return healthCheck(`provider.${provider}.auth`, name, "passed", summary("auth.connected", `${providerName} authentication is connected.`, { provider: providerName }));
  if (state === "disconnected") {
    return healthCheck(`provider.${provider}.auth`, name, "warning", summary("auth.required", `${providerName} authentication is required.`, { provider: providerName }), account.errorCategory, safeHealthRemediation("open-settings", REMEDIATION_LABEL.openProviderConnections, { section: "provider-connections", provider }));
  }
  if (state === "unavailable") {
    return healthCheck(`provider.${provider}.auth`, name, "warning", summary("auth.runtimeUnavailable", "Authentication could not be checked because the provider runtime is unavailable."), account.errorCategory, safeHealthRemediation("rediscover-binary", REMEDIATION_LABEL.rediscoverBinary, { provider }));
  }
  return healthCheck(`provider.${provider}.auth`, name, "warning", summary("auth.unknown", "Provider authentication status could not be determined."), account.errorCategory, safeHealthRemediation("retry", REMEDIATION_LABEL.rerunDiagnostics, { target: "execution-host" }));
}

export function normalizeSystemDiagnostics(
  input: unknown,
  options: SystemDiagnosticsNormalizationOptions = {}
): HealthCheckRun {
  const report = reportOf(input);
  const checks: HealthCheckResult[] = [];
  const server = report.server;
  checks.push(
    failedIndicator(server)
      ? healthCheck("server.process", "Claudex server process", "failed", summary("server.notHealthy", "The server process did not report a healthy state."), diagnosticError(server), safeHealthRemediation("restart-service", REMEDIATION_LABEL.restartService, { target: "server" }))
      : passedIndicator(server) || String(server).toLowerCase() === "ok"
        ? healthCheck("server.process", "Claudex server process", "passed", summary("server.running", "The server process is running."))
        : healthCheck("server.process", "Claudex server process", "warning", summary("server.unknown", "The server process state could not be determined."), diagnosticError(server), safeHealthRemediation("retry", REMEDIATION_LABEL.rerunDiagnostics, { target: "server" }))
  );

  const database = record(report.database);
  if (database.ok === true || passedIndicator(database)) checks.push(healthCheck("database.ping", "SQLite access", "passed", summary("database.responded", "SQLite answered the request.")));
  else if (database.ok === false || failedIndicator(database)) checks.push(healthCheck("database.ping", "SQLite access", "failed", summary("database.failed", "The SQLite request failed."), diagnosticError(database), safeHealthRemediation("retry", REMEDIATION_LABEL.rerunDiagnostics, { check: "database.ping" })));
  else checks.push(healthCheck("database.ping", "SQLite access", "warning", summary("database.unknown", "SQLite status could not be determined."), diagnosticError(database), safeHealthRemediation("retry", REMEDIATION_LABEL.rerunDiagnostics, { check: "database.ping" })));

  const queue = record(report.databaseQueue);
  if (Object.keys(queue).length) {
    const queueDepth = finiteNumber(queue.queueDepth) ?? 0;
    if (queue.available === false) checks.push(healthCheck("database.worker", "SQLite Worker", "failed", summary("dbWorker.unavailable", "The SQLite worker is unavailable."), queue.lastRestartReason, safeHealthRemediation("restart-service", REMEDIATION_LABEL.restartService, { target: "server" })));
    else if (queue.recovering === true || queueDepth >= (finiteNumber(queue.maxPending) ?? 256) * 0.8) checks.push(healthCheck("database.worker", "SQLite Worker", "warning", queue.recovering === true ? summary("dbWorker.recovering", "The SQLite worker is recovering.") : summary("dbWorker.queueHigh", "The SQLite request queue is heavily used."), { queueDepth, maxPending: queue.maxPending }, safeHealthRemediation("retry", REMEDIATION_LABEL.rerunDiagnostics, { check: "database.worker" })));
    else checks.push(healthCheck("database.worker", "SQLite Worker", "passed", summary("dbWorker.ok", "The SQLite worker can serve requests."), { queueDepth }));
  }

  const storage = record(report.storage);
  checks.push(diskCheck("storage.free", "Free storage", storage.freeBytes, options.diskWarningBytes, options.diskFailureBytes));

  const sse = record(report.sse);
  if (Object.keys(sse).length) {
    const connections = finiteNumber(sse.connections);
    const limit = finiteNumber(sse.limit);
    if (failedIndicator(sse)) checks.push(healthCheck("transport.sse", "SSE connections", "failed", summary("sse.failed", "The SSE connection state was reported as failed."), diagnosticError(sse), safeHealthRemediation("retry", REMEDIATION_LABEL.recheckConnection, { transport: "sse" })));
    else if (connections !== null && limit !== null && limit > 0 && connections >= limit) checks.push(healthCheck("transport.sse", "SSE connections", "failed", summary("sse.atLimit", "SSE connections have reached the server limit."), { connections, limit }, safeHealthRemediation("retry", REMEDIATION_LABEL.recheckConnection, { transport: "sse" })));
    else if (connections !== null && limit !== null && limit > 0 && connections >= limit * 0.8) checks.push(healthCheck("transport.sse", "SSE connections", "warning", summary("sse.nearLimit", "SSE connections are close to the server limit."), { connections, limit }));
    else checks.push(healthCheck("transport.sse", "SSE connections", "passed", summary("sse.ok", "The SSE connection layer is healthy."), connections === null ? undefined : { connections, limit }));
  } else checks.push(healthCheck("transport.sse", "SSE connections", "skipped", summary("sse.unreported", "This diagnostic run did not report SSE status.")));

  const websocket = report.websocket ?? report.webSocket ?? report.workerWebSocket;
  if (websocket === undefined) checks.push(healthCheck("transport.websocket", "Worker WebSocket endpoint", "skipped", summary("websocket.unreported", "This diagnostic run did not report WebSocket endpoint status.")));
  else if (failedIndicator(websocket)) checks.push(healthCheck("transport.websocket", "Worker WebSocket endpoint", "failed", summary("websocket.failed", "The worker WebSocket endpoint check failed."), diagnosticError(websocket), safeHealthRemediation("retry", REMEDIATION_LABEL.recheckConnection, { transport: "websocket" })));
  else if (passedIndicator(websocket)) checks.push(healthCheck("transport.websocket", "Worker WebSocket endpoint", "passed", summary("websocket.ok", "The worker WebSocket endpoint can accept requests.")));
  else checks.push(healthCheck("transport.websocket", "Worker WebSocket endpoint", "warning", summary("websocket.unknown", "The worker WebSocket endpoint status could not be determined."), diagnosticError(websocket), safeHealthRemediation("retry", REMEDIATION_LABEL.recheckConnection, { transport: "websocket" })));

  const localConnection = healthConnectionStatus(report.localHost);
  if (localConnection === "online") checks.push(healthCheck("worker.local", "Local worker role", "passed", summary("localWorker.ok", "The main server can act as a local worker.")));
  else if (localConnection === "offline") checks.push(healthCheck("worker.local", "Local worker role", "warning", summary("localWorker.offline", "The local worker role is offline."), undefined, safeHealthRemediation("restart-service", REMEDIATION_LABEL.restartWorker, { target: "local-worker" })));
  else checks.push(healthCheck("worker.local", "Local worker role", "skipped", summary("localWorker.unreported", "The local worker role status was not reported.")));

  return createHealthCheckRun("server", options.targetId ?? "local", checks, options);
}

function workspaceCheck(report: UnknownRecord): HealthCheckResult {
  const roots = array(report.workspaceRoots);
  const access = report.workspaceAccess;
  if (failedIndicator(access) || roots.some((root) => {
    const state = statusValue(root);
    return ["unavailable", "path-missing", "permission-denied", "invalid", "failed"].includes(state) || record(root).accessible === false;
  })) {
    return healthCheck("workspace.access", "Workspace access", "failed", summary("workspace.inaccessible", "A registered workspace path cannot be accessed."), diagnosticError(access), safeHealthRemediation("open-settings", REMEDIATION_LABEL.openWorkspaceSettings, { section: "workspace" }));
  }
  if (roots.length) return healthCheck("workspace.access", "Workspace access", "passed", summary("workspace.rootsAvailable", `${roots.length} workspace roots are available.`, { count: roots.length }));
  if (passedIndicator(access)) return healthCheck("workspace.access", "Workspace access", "passed", summary("workspace.accessible", "The workspace paths can be accessed."));
  return healthCheck("workspace.access", "Workspace access", "warning", summary("workspace.unknown", "No workspace root is registered, or its access state could not be determined."), diagnosticError(access), safeHealthRemediation("open-settings", REMEDIATION_LABEL.openWorkspaceSettings, { section: "workspace" }));
}

function commandCheck(key: string, label: string, value: unknown, documentationTopic: string): HealthCheckResult {
  if (typeof value === "string" && value.trim() && !["unavailable", "missing", "not-found", "unknown"].includes(value.trim().toLowerCase())) {
    return healthCheck(key, label, "passed", summary("tool.available", `${label} is available.`, { name: label }), value);
  }
  if (passedIndicator(value) || record(value).installed === true) return healthCheck(key, label, "passed", summary("tool.available", `${label} is available.`, { name: label }), record(value).version);
  if (failedIndicator(value) || record(value).installed === false || (typeof value === "string" && value.trim())) {
    return healthCheck(key, label, "warning", summary("tool.missing", `${label} was not found.`, { name: label }), diagnosticError(value), safeHealthRemediation("documentation", REMEDIATION_LABEL.installGuide, { topic: documentationTopic }));
  }
  return healthCheck(key, label, "skipped", summary("tool.unreported", `The worker did not report ${label} status.`, { name: label }));
}

export function normalizeExecutionHostDiagnostics(
  input: unknown,
  options: ExecutionHostDiagnosticsNormalizationOptions
): HealthCheckRun {
  const report = reportOf(input);
  const checks: HealthCheckResult[] = [];
  const rawConnection = options.connectionStatus ?? report.workerConnection ?? report.connection;
  const connection = healthConnectionStatus(rawConnection);
  if (connection === "online") checks.push(healthCheck("worker.connection", "Worker connection", "passed", summary("workerConnection.online", "The worker is connected to the central server.")));
  else if (connection === "connecting") checks.push(healthCheck("worker.connection", "Worker connection", "warning", summary("workerConnection.connecting", "The worker is connecting to the central server."), undefined, safeHealthRemediation("retry", REMEDIATION_LABEL.recheckConnection, { hostId: options.targetId })));
  else if (connection === "offline") checks.push(healthCheck("worker.connection", "Worker connection", "failed", summary("workerConnection.offline", "The worker is not connected to the central server."), diagnosticError(rawConnection), safeHealthRemediation("restart-service", REMEDIATION_LABEL.restartWorker, { hostId: options.targetId })));
  else checks.push(healthCheck("worker.connection", "Worker connection", "warning", summary("workerConnection.unknown", "The worker connection state could not be determined."), diagnosticError(rawConnection), safeHealthRemediation("retry", REMEDIATION_LABEL.recheckConnection, { hostId: options.targetId })));

  const capabilities = { ...record(options.capabilities), ...record(report.capabilities) };
  const protocolValue = finiteNumber(report.protocolVersion ?? capabilities.protocolVersion);
  const expectedProtocolVersion = options.expectedProtocolVersion ?? 1;
  const local = String(rawConnection ?? "").toLowerCase() === "local";
  if (local && protocolValue === null) checks.push(healthCheck("worker.protocol", "Worker protocol version", "skipped", summary("workerProtocol.localSkip", "A local worker does not need the remote protocol check.")));
  else if (protocolValue === null) checks.push(healthCheck("worker.protocol", "Worker protocol version", "warning", summary("workerProtocol.unreported", "The worker did not report a protocol version."), undefined, safeHealthRemediation("documentation", REMEDIATION_LABEL.workerCompatibility, { topic: "worker-version" })));
  else if (protocolValue !== expectedProtocolVersion) checks.push(healthCheck("worker.protocol", "Worker protocol version", "failed", summary("workerProtocol.mismatch", "The worker and server protocol versions do not match."), { expected: expectedProtocolVersion, actual: protocolValue }, safeHealthRemediation("documentation", REMEDIATION_LABEL.workerUpdate, { topic: "worker-version" })));
  else checks.push(healthCheck("worker.protocol", "Worker protocol version", "passed", summary("workerProtocol.match", "The worker and server protocol versions match."), String(protocolValue)));

  const workerVersion = report.workerVersion;
  checks.push(
    typeof workerVersion === "string" && workerVersion.trim()
      ? healthCheck("worker.version", "Worker version", "passed", summary("workerVersion.known", "The worker version was confirmed."), workerVersion)
      : local
        ? healthCheck("worker.version", "Worker version", "skipped", summary("workerVersion.localSkip", "A local worker uses the server version."))
        : healthCheck("worker.version", "Worker version", "warning", summary("workerVersion.unreported", "The worker version was not reported."), undefined, safeHealthRemediation("documentation", REMEDIATION_LABEL.workerUpdate, { topic: "worker-version" }))
  );

  const operatingSystem = report.operatingSystem ?? report.operatingSystemVersion ?? report.platform;
  const architecture = report.architecture ?? capabilities.architecture;
  if (operatingSystem && architecture) checks.push(healthCheck("worker.platform", "Operating system and architecture", "passed", summary("workerPlatform.known", "The worker platform details were confirmed."), `${safeText(operatingSystem, 120)} · ${safeText(architecture, 40)}`));
  else checks.push(healthCheck("worker.platform", "Operating system and architecture", "warning", summary("workerPlatform.incomplete", "The worker platform details are incomplete."), { operatingSystem, architecture }));

  const workspace = workspaceCheck(report);
  checks.push(workspace);
  const claudeRuntime = runtimeCheck(report, "claude");
  const codexRuntime = runtimeCheck(report, "codex");
  checks.push(claudeRuntime, accountCheck(report, "claude"), codexRuntime, accountCheck(report, "codex"));
  checks.push(commandCheck("tool.git", "Git", report.git, "git"));
  checks.push(commandCheck("tool.github-cli", "GitHub CLI", report.githubCli ?? report.gh, "github-cli"));

  const spool = report.eventSpool ?? report.spool;
  if (spool === undefined) checks.push(healthCheck("worker.spool", "Worker event spool", "skipped", summary("spool.unreported", "The worker did not report event spool status.")));
  else if (failedIndicator(spool)) checks.push(healthCheck("worker.spool", "Worker event spool", "failed", summary("spool.unavailable", "The worker event spool is unavailable."), diagnosticError(spool), safeHealthRemediation("restart-service", REMEDIATION_LABEL.restartWorker, { hostId: options.targetId })));
  else if (passedIndicator(spool) || ["normal", "ok"].includes(String(spool).toLowerCase())) checks.push(healthCheck("worker.spool", "Worker event spool", "passed", summary("spool.ok", "The worker event spool is writable.")));
  else checks.push(healthCheck("worker.spool", "Worker event spool", "warning", summary("spool.unknown", "The worker event spool status could not be determined."), diagnosticError(spool), safeHealthRemediation("retry", REMEDIATION_LABEL.rerunDiagnostics, { hostId: options.targetId })));

  checks.push(diskCheck("worker.storage.free", "Worker free storage", report.diskFreeBytes, options.diskWarningBytes, options.diskFailureBytes));

  const tasks = array(report.tasks).map(record);
  const failedTasks = tasks.filter((task) => statusValue(task) === "failed");
  checks.push(failedTasks.length
    ? healthCheck("worker.recent-tasks", "Recent task failures", "warning", summary("recentTasks.failed", `${failedTasks.length} of the tasks the worker reported are in a failed state.`, { count: failedTasks.length }), undefined, safeHealthRemediation("documentation", REMEDIATION_LABEL.taskFailureDiagnostics, { topic: "task-failures" }))
    : tasks.length
      ? healthCheck("worker.recent-tasks", "Recent task failures", "passed", summary("recentTasks.none", "None of the tasks the worker reported are in a failed state."))
      : healthCheck("worker.recent-tasks", "Recent task failures", "skipped", summary("recentTasks.unreported", "The worker did not report recent task status.")));

  const runtimeAvailability = [claudeRuntime.status, codexRuntime.status];
  if (connection === "offline" || workspace.status === "failed" || runtimeAvailability.every((status) => status !== "passed")) {
    const blocked = connection === "offline"
      ? summary("executionReady.noConnection", "Tasks cannot run because the worker is not connected.")
      : workspace.status === "failed"
        ? summary("executionReady.noWorkspace", "Tasks cannot run because the workspace is not accessible.")
        : summary("executionReady.noRuntime", "Neither the Claude Code nor the Codex executable was found.");
    checks.push(healthCheck("worker.execution-ready", "Execution readiness", "failed", blocked, undefined, safeHealthRemediation("open-settings", REMEDIATION_LABEL.openDeviceSettings, { hostId: options.targetId })));
  } else if (connection === "online") checks.push(healthCheck("worker.execution-ready", "Execution readiness", "passed", summary("executionReady.ok", "The worker can run tasks.")));
  else checks.push(healthCheck("worker.execution-ready", "Execution readiness", "warning", summary("executionReady.unknown", "Worker execution readiness could not be fully confirmed."), undefined, safeHealthRemediation("retry", REMEDIATION_LABEL.rerunDiagnostics, { hostId: options.targetId })));

  return createHealthCheckRun("execution-host", options.targetId, checks, options);
}
