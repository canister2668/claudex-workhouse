import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { sanitizeSensitiveText } from "../sensitive-data.js";
import{sqliteMaintenanceInvocation}from"../db/sqlite-platform.js";
import { createHealthCheckRun, healthCheck, REMEDIATION_LABEL, safeHealthRemediation } from "./health.js";
import type { HealthCheckResult, HealthCheckRun, HealthRunOptions } from "./types.js";

export interface SqliteHealthProbe {
  ping: boolean;
  quickCheck: boolean;
  detail?: string;
}

export interface MainServerHealthInput extends HealthRunOptions {
  targetId?: string;
  dataDir: string;
  spoolDir?: string;
  dbPath: string;
  version?: string | null;
  installMethod?: string | null;
  internalUrl?: string | null;
  externalUrl?: string | null;
  externalHealth?: unknown;
  externalSse?: unknown;
  externalWebsocket?: unknown;
  publicAccess?: "local-only" | "cloudflare-existing" | "tailscale-existing" | "custom-reverse-proxy" | string | null;
  claimState?: "unclaimed" | "pending" | "claimed" | "expired" | "not-required" | string | null;
  localWorker?: boolean | { enabled: boolean; status?: unknown } | null;
  sse?: unknown;
  websocket?: unknown;
  database?: { ping(): Promise<unknown> };
  httpTimeoutMs?: number;
  diskWarningBytes?: number;
  diskFailureBytes?: number;
  pythonBinary?: string;
  appRoot?:string;
  platform?:NodeJS.Platform;
  nodeBinary?:string;
  fetchHealth?: (url: URL, options: { signal: AbortSignal; redirect: "manual" }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
  sqliteProbe?: (dbPath: string) => Promise<SqliteHealthProbe>;
  diskFreeBytes?: number;
}

const DEFAULT_DISK_WARNING_BYTES = 2 * 1024 * 1024 * 1024;
const DEFAULT_DISK_FAILURE_BYTES = 512 * 1024 * 1024;

function errorDetail(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error ?? "Unknown diagnostic error.");
  return sanitizeSensitiveText(value).replace(/[\r\n]+/g, " ").slice(0, 1200);
}

function validHttpUrl(value: unknown): URL | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

function displayOrigin(url: URL): string {
  return sanitizeSensitiveText(url.origin).slice(0, 300);
}

export function isCloudflareAccessRedirect(status: number | null | undefined, location: string | null | undefined): boolean {
  if (typeof status !== "number" || ![301, 302, 303, 307, 308].includes(status) || !location) return false;
  try {
    const url = new URL(location);
    return url.hostname.toLowerCase().endsWith(".cloudflareaccess.com")
      && url.pathname.toLowerCase().startsWith("/cdn-cgi/access/login/");
  } catch {
    return false;
  }
}

export async function probeDirectoryWritable(directory: string): Promise<void> {
  const file = path.join(directory, `.claudex-health-${crypto.randomUUID()}.tmp`);
  let handle: fs.promises.FileHandle | undefined;
  try {
    handle = await fs.promises.open(file, "wx", 0o600);
    await handle.writeFile("claudex-health\n", "utf8");
    await handle.sync();
  } finally {
    if (handle) {
      await handle.close().catch(() => {});
      await fs.promises.unlink(file).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
  }
}

export function probeSqliteDatabase(
  dbPath: string,
  // Same resolution as the database worker: `/bin/python3` only exists where
  // /bin is merged into /usr/bin, and a packaged install can land on a host
  // where it does not. Falling back to a missing absolute path made the health
  // probe report a broken database on a perfectly healthy one.
  pythonBinary = process.env.PYTHON_BIN?.trim() || "python3",
  timeoutMs = 15_000,
  options:{platform?:NodeJS.Platform;appRoot?:string;nodeBinary?:string}={}
): Promise<SqliteHealthProbe> {
  const script = [
    "import json, pathlib, sqlite3, sys",
    "uri = pathlib.Path(sys.argv[1]).resolve().as_uri() + '?mode=ro'",
    "db = sqlite3.connect(uri, uri=True, timeout=5)",
    "try:",
    "    ping = db.execute('SELECT 1').fetchone()[0] == 1",
    "    rows = [str(row[0]) for row in db.execute('PRAGMA quick_check').fetchmany(20)]",
    "    quick = len(rows) == 1 and rows[0].lower() == 'ok'",
    "    print(json.dumps({'ping': ping, 'quickCheck': quick, 'detail': None if quick else '; '.join(rows)[:800]}))",
    "finally:",
    "    db.close()"
  ].join("\n");
  const launch=options.platform==="win32"||(!options.platform&&process.platform==="win32")
    ?sqliteMaintenanceInvocation({operation:"quick-check",source:dbPath,pythonBinary,platform:options.platform,appRoot:options.appRoot,nodeBinary:options.nodeBinary})
    :{command:pythonBinary,args:["-c",script,dbPath]};
  return new Promise((resolve, reject) => {
    execFile(launch.command,launch.args,{timeout:timeoutMs,maxBuffer:64*1024,windowsHide:true},(error,stdout,stderr)=>{
      if (error) {
        reject(new Error(sanitizeSensitiveText(String(stderr || error.message)).trim().slice(-1200) || "SQLite probe failed."));
        return;
      }
      try {
        const parsed = JSON.parse(String(stdout)) as SqliteHealthProbe;
        if (typeof parsed.ping !== "boolean" || typeof parsed.quickCheck !== "boolean") throw new Error("SQLite probe returned an invalid result.");
        resolve({
          ping: parsed.ping,
          quickCheck: parsed.quickCheck,
          ...(parsed.detail ? { detail: sanitizeSensitiveText(parsed.detail).slice(0, 800) } : {})
        });
      } catch (parseError) {
        reject(new Error(errorDetail(parseError)));
      }
    });
  });
}

async function diskFreeBytes(directory: string): Promise<number> {
  const stat = await fs.promises.statfs(directory);
  return Number(stat.bavail) * Number(stat.bsize);
}

// Summary text lives in the dictionary; this only pairs a key with its English form.
const summary = (id: string, text: string, params?: Record<string, string | number>) =>
  ({ key: `infrastructure.summary.${id}`, text, ...(params ? { params } : {}) });

function diskResult(value: number, warningBytes: number, failureBytes: number): HealthCheckResult {
  const gib = value / (1024 * 1024 * 1024);
  const detail = `${gib.toFixed(gib >= 10 ? 1 : 2)} GiB available`;
  if (value < failureBytes) return healthCheck("storage.free", "Free storage", "failed", summary("storage.criticalSqlite", "There is not enough storage to run tasks and SQLite safely."), detail, safeHealthRemediation("documentation", REMEDIATION_LABEL.storageTroubleshooting, { topic: "storage" }));
  if (value < warningBytes) return healthCheck("storage.free", "Free storage", "warning", summary("storage.low", "Free storage is below the recommended threshold."), detail, safeHealthRemediation("documentation", REMEDIATION_LABEL.storageManagement, { topic: "storage" }));
  return healthCheck("storage.free", "Free storage", "passed", summary("storage.ok", "There is enough storage available."), detail);
}

// The card renders the localized check label next to the summary, so these summaries
// stay generic instead of interpolating an English label into a translated sentence.
function transportResult(key: string, label: string, value: unknown): HealthCheckResult {
  const item = value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
  const status = String(typeof value === "string" ? value : item.status ?? item.state ?? "").toLowerCase();
  const transport = key.split(".").at(-1);
  if (item.protectedBy === "cloudflare-access") {
    const httpStatus = Number(item.status);
    const suffix = Number.isFinite(httpStatus) ? ` (HTTP ${httpStatus})` : "";
    const detail = key === "server.external-websocket"
      ? `Cloudflare Access blocked the anonymous WebSocket upgrade${suffix}. Remote workers need a /worker/* bypass policy or a Cloudflare Access service token.`
      : `Cloudflare Access redirected the anonymous diagnostic request to a login${suffix}. The external edge was reached, but the protected endpoint's real response was not verified.`;
    return healthCheck(
      key,
      label,
      "warning",
      summary("transport.cloudflareAccess", "Cloudflare Access protects this endpoint, so the anonymous diagnostic could not complete."),
      detail,
      safeHealthRemediation("documentation", REMEDIATION_LABEL.cloudflareAccessGuide, { topic: "cloudflare-access" })
    );
  }
  if (value === false || item.ok === false || ["failed", "error", "offline", "unavailable"].includes(status)) return healthCheck(key, label, "failed", summary("transport.failed", "This check failed."), item.error ?? item.detail, safeHealthRemediation("retry", REMEDIATION_LABEL.recheckConnection, { transport }));
  const connections = Number(item.connections);
  const limit = Number(item.limit);
  if (Number.isFinite(connections) && Number.isFinite(limit) && limit > 0) {
    if (connections >= limit) return healthCheck(key, label, "failed", summary("transport.atLimit", "Connections have reached the server limit."), { connections, limit }, safeHealthRemediation("retry", REMEDIATION_LABEL.recheckConnection, { transport }));
    if (connections >= limit * 0.8) return healthCheck(key, label, "warning", summary("transport.nearLimit", "Connections are close to the server limit."), { connections, limit });
    return healthCheck(key, label, "passed", summary("transport.ok", "This layer is healthy."), { connections, limit });
  }
  if (value === true || item.ok === true || item.available === true || ["ok", "passed", "healthy", "online", "available", "ready"].includes(status)) return healthCheck(key, label, "passed", summary("transport.ok", "This layer is healthy."));
  return healthCheck(key, label, "skipped", summary("transport.unreported", "No status was provided for this check."));
}

export async function runMainServerHealthChecks(input: MainServerHealthInput): Promise<HealthCheckRun> {
  const checks: HealthCheckResult[] = [
    healthCheck("server.process", "Claudex server process", "passed", summary("server.diagnosticRunning", "The server process running this diagnostic is alive."), `pid ${process.pid}`)
  ];
  const spoolDir = input.spoolDir ?? input.dataDir;
  const sqlitePromise=(input.sqliteProbe??((dbPath:string)=>probeSqliteDatabase(dbPath,input.pythonBinary,15_000,{platform:input.platform,appRoot:input.appRoot,nodeBinary:input.nodeBinary})))(input.dbPath);
  const databasePingPromise = input.database
    ? input.database.ping().then((value) => value !== false)
    : sqlitePromise.then((result) => result.ping);
  const dataWritablePromise = probeDirectoryWritable(input.dataDir);
  const spoolWritablePromise = probeDirectoryWritable(spoolDir);
  const diskPromise = input.diskFreeBytes === undefined ? diskFreeBytes(input.dataDir) : Promise.resolve(input.diskFreeBytes);

  const internalUrl = validHttpUrl(input.internalUrl);
  const healthPromise = internalUrl
    ? (async () => {
        const healthUrl = new URL("/api/health/live", internalUrl);
        const fetchHealth = input.fetchHealth ?? (async (url, options) => {
          const response = await fetch(url, options);
          return { ok: response.ok, status: response.status, json: () => response.json() };
        });
        const response = await fetchHealth(healthUrl, { signal: AbortSignal.timeout(input.httpTimeoutMs ?? 5_000), redirect: "manual" });
        let body: unknown = null;
        try { body = await response.json(); } catch { /* status remains authoritative */ }
        const bodyOk = body === null || (body !== null && typeof body === "object" && (body as Record<string, unknown>).ok !== false);
        return { ok: response.ok && bodyOk, status: response.status };
      })()
    : Promise.reject(new Error("Internal server URL is not a valid HTTP(S) URL."));

  const [http, databasePing, sqlite, dataWritable, spoolWritable, disk] = await Promise.allSettled([
    healthPromise,
    databasePingPromise,
    sqlitePromise,
    dataWritablePromise,
    spoolWritablePromise,
    diskPromise
  ]);

  if (http.status === "fulfilled" && http.value.ok) checks.push(healthCheck("server.http-health", "HTTP health endpoint", "passed", summary("httpHealth.ok", "The server's HTTP health endpoint responded."), `HTTP ${http.value.status}`));
  else checks.push(healthCheck("server.http-health", "HTTP health endpoint", "failed", summary("httpHealth.failed", "The server process could not confirm its HTTP health endpoint."), http.status === "rejected" ? errorDetail(http.reason) : `HTTP ${http.value.status}`, safeHealthRemediation("retry", REMEDIATION_LABEL.rerunDiagnostics, { check: "server.http-health" })));

  if (databasePing.status === "fulfilled" && databasePing.value) checks.push(healthCheck("database.ping", "SQLite access", "passed", summary("database.responded", "SQLite answered the request.")));
  else checks.push(healthCheck("database.ping", "SQLite access", "failed", summary("database.failed", "The SQLite request failed."), databasePing.status === "rejected" ? errorDetail(databasePing.reason) : undefined, safeHealthRemediation("retry", REMEDIATION_LABEL.rerunDiagnostics, { check: "database.ping" })));

  if (sqlite.status === "fulfilled" && sqlite.value.quickCheck) checks.push(healthCheck("database.quick-check", "SQLite quick_check", "passed", summary("quickCheck.ok", "SQLite quick_check is clean.")));
  else checks.push(healthCheck("database.quick-check", "SQLite quick_check", "failed", summary("quickCheck.failed", "SQLite quick_check did not pass."), sqlite.status === "rejected" ? errorDetail(sqlite.reason) : sqlite.value.detail, safeHealthRemediation("documentation", REMEDIATION_LABEL.sqliteRecovery, { topic: "sqlite-recovery" })));

  if (dataWritable.status === "fulfilled") checks.push(healthCheck("storage.data-writable", "Data directory writes", "passed", summary("dataWritable.ok", "A safe temporary file can be written to the data directory.")));
  else checks.push(healthCheck("storage.data-writable", "Data directory writes", "failed", summary("dataWritable.failed", "The data directory is not writable."), errorDetail(dataWritable.reason), safeHealthRemediation("documentation", REMEDIATION_LABEL.dataPathPermissions, { topic: "data-permissions" })));

  if (spoolWritable.status === "fulfilled") checks.push(healthCheck("storage.spool-writable", "NDJSON spool writes", "passed", summary("spoolWritable.ok", "A safe temporary file can be written to the NDJSON spool path.")));
  else checks.push(healthCheck("storage.spool-writable", "NDJSON spool writes", "failed", summary("spoolWritable.failed", "The NDJSON spool path is not writable."), errorDetail(spoolWritable.reason), safeHealthRemediation("documentation", REMEDIATION_LABEL.spoolPathPermissions, { topic: "data-permissions" })));

  if (disk.status === "fulfilled" && Number.isFinite(disk.value)) checks.push(diskResult(disk.value, input.diskWarningBytes ?? DEFAULT_DISK_WARNING_BYTES, input.diskFailureBytes ?? DEFAULT_DISK_FAILURE_BYTES));
  else checks.push(healthCheck("storage.free", "Free storage", "failed", summary("storage.unknown", "Free storage could not be determined."), disk.status === "rejected" ? errorDetail(disk.reason) : undefined, safeHealthRemediation("retry", REMEDIATION_LABEL.rerunDiagnostics, { check: "storage.free" })));

  checks.push(input.version && input.version.trim()
    ? healthCheck("server.version", "Current version", "passed", summary("version.known", "The server version was confirmed."), input.version)
    : healthCheck("server.version", "Current version", "warning", summary("version.unknown", "The server version could not be determined."), undefined, safeHealthRemediation("documentation", REMEDIATION_LABEL.releaseNotes, { topic: "releases" })));

  checks.push(input.installMethod && input.installMethod.trim()
    ? healthCheck("server.install-method", "Install method", "passed", summary("installMethod.known", "The server install method was confirmed."), input.installMethod)
    : healthCheck("server.install-method", "Install method", "warning", summary("installMethod.unknown", "The server install method could not be determined."), undefined, safeHealthRemediation("documentation", REMEDIATION_LABEL.installationGuide, { topic: "installation" })));

  checks.push(internalUrl
    ? healthCheck("server.internal-url", "Internal URL", "passed", summary("internalUrl.ok", "The server's internal address is well-formed."), displayOrigin(internalUrl))
    : healthCheck("server.internal-url", "Internal URL", "failed", summary("internalUrl.invalid", "The server's internal address is missing or is not a valid HTTP(S) URL."), undefined, safeHealthRemediation("open-settings", REMEDIATION_LABEL.openConnectionSettings, { section: "external-access" })));

  const externalUrl = validHttpUrl(input.externalUrl);
  if (externalUrl) {
    const insecure = externalUrl.protocol !== "https:" && !["localhost", "127.0.0.1", "::1"].includes(externalUrl.hostname);
    checks.push(healthCheck("server.external-url", "External URL", insecure ? "warning" : "passed", insecure ? summary("externalUrl.insecure", "The external address does not use HTTPS.") : summary("externalUrl.ok", "The configured external address is well-formed."), displayOrigin(externalUrl), insecure ? safeHealthRemediation("open-settings", REMEDIATION_LABEL.openExternalAccessSettings, { section: "external-access" }) : undefined));
    checks.push(transportResult("server.external-connectivity", "External HTTP health endpoint", input.externalHealth));
    checks.push(transportResult("server.external-sse", "External SSE connection layer", input.externalSse));
    checks.push(transportResult("server.external-websocket", "External worker WebSocket endpoint", input.externalWebsocket));
  } else if (input.publicAccess === "local-only" || !input.externalUrl) {
    checks.push(healthCheck("server.external-url", "External URL", "skipped", summary("externalUrl.localOnly", "This install is local-network only and uses no external address.")));
    checks.push(healthCheck("server.external-connectivity", "External HTTP health endpoint", "skipped", summary("external.localOnlySkip", "Skipped because this install is local-network only.")));
    checks.push(healthCheck("server.external-sse", "External SSE connection layer", "skipped", summary("external.localOnlySkip", "Skipped because this install is local-network only.")));
    checks.push(healthCheck("server.external-websocket", "External worker WebSocket endpoint", "skipped", summary("external.localOnlySkip", "Skipped because this install is local-network only.")));
  } else {
    checks.push(healthCheck("server.external-url", "External URL", "warning", summary("externalUrl.invalid", "The configured external address is not a valid HTTP(S) URL."), undefined, safeHealthRemediation("open-settings", REMEDIATION_LABEL.openExternalAccessSettings, { section: "external-access" })));
    checks.push(healthCheck("server.external-connectivity", "External HTTP health endpoint", "skipped", summary("external.noUrlSkip", "Skipped because there is no valid external URL.")));
    checks.push(healthCheck("server.external-sse", "External SSE connection layer", "skipped", summary("external.noUrlSkip", "Skipped because there is no valid external URL.")));
    checks.push(healthCheck("server.external-websocket", "External worker WebSocket endpoint", "skipped", summary("external.noUrlSkip", "Skipped because there is no valid external URL.")));
  }

  checks.push(transportResult("transport.sse", "SSE connection layer", input.sse));
  checks.push(transportResult("transport.websocket", "Worker WebSocket endpoint", input.websocket));

  const claimState = String(input.claimState ?? "").toLowerCase();
  if (["claimed", "not-required"].includes(claimState)) checks.push(healthCheck("server.owner-claim", "Owner claim status", "passed", claimState === "claimed" ? summary("ownerClaim.claimed", "Server ownership registration is complete.") : summary("ownerClaim.notRequired", "This configuration does not need an owner claim.")));
  else if (["pending", "unclaimed"].includes(claimState)) checks.push(healthCheck("server.owner-claim", "Owner claim status", "warning", summary("ownerClaim.pending", "Server ownership registration is not finished yet."), undefined, safeHealthRemediation("open-settings", REMEDIATION_LABEL.openOwnerClaim, { section: "owner-claim" })));
  else if (claimState === "expired") checks.push(healthCheck("server.owner-claim", "Owner claim status", "warning", summary("ownerClaim.expired", "The owner claim has expired."), undefined, safeHealthRemediation("retry", REMEDIATION_LABEL.newOwnerClaim, { target: "owner-claim" })));
  else checks.push(healthCheck("server.owner-claim", "Owner claim status", "skipped", summary("ownerClaim.unreported", "No owner claim status was provided.")));

  const localWorker = typeof input.localWorker === "object" && input.localWorker !== null ? input.localWorker : { enabled: input.localWorker === true };
  const localWorkerState = String(localWorker.status ?? "").toLowerCase();
  if (!localWorker.enabled) checks.push(healthCheck("worker.local", "Local worker role", "skipped", summary("localWorker.disabled", "This main server does not use the local worker role.")));
  else if (["offline", "failed", "disabled"].includes(localWorkerState)) checks.push(healthCheck("worker.local", "Local worker role", "warning", summary("localWorker.unavailable", "The local worker role is currently unavailable."), undefined, safeHealthRemediation("restart-service", REMEDIATION_LABEL.restartWorker, { target: "local-worker" })));
  else checks.push(healthCheck("worker.local", "Local worker role", "passed", summary("localWorker.enabled", "This main server uses the local worker role.")));

  return createHealthCheckRun("server", input.targetId ?? "local", checks, input);
}
