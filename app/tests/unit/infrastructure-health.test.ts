import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  healthConnectionStatus,
  healthOverall,
  isCloudflareAccessRedirect,
  normalizeExecutionHostDiagnostics,
  normalizeSystemDiagnostics,
  probeDirectoryWritable,
  probeSqliteDatabase,
  runMainServerHealthChecks
} from "../../src/server/infrastructure/index.js";
import type { HealthCheckResult } from "../../src/server/infrastructure/index.js";
import { REDACTED } from "../../src/server/sensitive-data.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function temporaryRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "claudex-infrastructure-health-"));
  roots.push(root);
  return root;
}

function check(run: { checks: HealthCheckResult[] }, key: string) {
  const value = run.checks.find((item) => item.key === key);
  expect(value, `missing health check ${key}`).toBeDefined();
  return value!;
}

describe("infrastructure health normalization", () => {
  it("keeps connection and health state independent", () => {
    expect(healthConnectionStatus("degraded")).toBe("online");
    expect(healthConnectionStatus("reconnecting")).toBe("connecting");
    expect(healthConnectionStatus("disabled")).toBe("offline");
    expect(healthConnectionStatus(undefined)).toBe("unknown");
    expect(healthOverall([
      { key: "connection", label: "Connection", status: "passed", summary: "Online" },
      { key: "runtime", label: "Runtime", status: "warning", summary: "Claude missing" }
    ])).toBe("warning");
  });

  it("normalizes current system diagnostics and sanitizes nested failures", () => {
    const run = normalizeSystemDiagnostics({
      report: {
        server: "ok",
        database: { ok: false, error: "Authorization: Bearer database-secret" },
        databaseQueue: { available: true, recovering: false, queueDepth: 2, maxPending: 256 },
        storage: { freeBytes: 256 * 1024 * 1024 },
        sse: { connections: 24, limit: 24 },
        websocket: { status: "failed", detail: { access_token: "websocket-secret" } },
        localHost: "online"
      }
    }, {
      id: "system-run",
      targetId: "main",
      startedAt: "2026-07-27T00:00:00.000Z",
      completedAt: "2026-07-27T00:00:01.000Z"
    });

    expect(run).toMatchObject({ id: "system-run", targetType: "server", targetId: "main", overall: "failed" });
    expect(check(run, "server.process").status).toBe("passed");
    expect(check(run, "database.ping")).toMatchObject({ status: "failed", detail: `Authorization: Bearer ${REDACTED}` });
    expect(check(run, "storage.free").status).toBe("failed");
    expect(check(run, "transport.sse").status).toBe("failed");
    expect(check(run, "transport.websocket").detail).toContain(REDACTED);
    expect(JSON.stringify(run)).not.toContain("database-secret");
    expect(JSON.stringify(run)).not.toContain("websocket-secret");
    expect(run.checks.filter((item) => item.remediation).every((item) => item.remediation?.safe === true)).toBe(true);
  });

  it("reports an online Worker with one missing provider runtime as warning, not offline", () => {
    const run = normalizeExecutionHostDiagnostics({
      workerConnection: "normal",
      protocolVersion: 1,
      workerVersion: "0.2.2",
      operatingSystem: "Windows 11",
      architecture: "x64",
      workspaceRoots: [{ name: "Project", path: "C:\\Project" }],
      runtimes: {
        claude: { installed: false },
        codex: { installed: true, version: "codex 1.2.3" }
      },
      accounts: {
        claude: { state: "unknown", errorCategory: "runtime_unavailable" },
        codex: { state: "connected" }
      },
      git: "git version 2.47.0",
      githubCli: "gh version 2.70.0",
      eventSpool: "normal",
      diskFreeBytes: 20 * 1024 * 1024 * 1024,
      tasks: [{ provider: "codex", status: "completed" }]
    }, {
      id: "worker-run",
      targetId: "worker-1",
      connectionStatus: "online",
      expectedProtocolVersion: 1
    });

    expect(run).toMatchObject({ targetType: "execution-host", targetId: "worker-1", overall: "warning" });
    expect(check(run, "worker.connection").status).toBe("passed");
    expect(check(run, "runtime.claude")).toMatchObject({ status: "warning", remediation: { kind: "rediscover-binary", safe: true } });
    expect(check(run, "runtime.codex").status).toBe("passed");
    expect(check(run, "worker.execution-ready").status).toBe("passed");
  });

  it("fails execution readiness for a protocol mismatch or when both runtimes are absent", () => {
    const run = normalizeExecutionHostDiagnostics({
      workerConnection: "normal",
      protocolVersion: 2,
      workerVersion: "0.1.0",
      operatingSystem: "Linux",
      architecture: "arm64",
      workspaceRoots: [{ name: "Root", path: "/srv/work" }],
      runtimes: {
        claude: { installed: false },
        codex: { installed: false }
      },
      accounts: {
        claude: { state: "unavailable" },
        codex: { state: "unavailable" }
      },
      git: "unavailable",
      eventSpool: "normal"
    }, { targetId: "worker-2", expectedProtocolVersion: 1 });

    expect(run.overall).toBe("failed");
    expect(check(run, "worker.protocol").status).toBe("failed");
    expect(check(run, "worker.execution-ready").status).toBe("failed");
  });
});

describe("main server health probes", () => {
  it("recognizes only Cloudflare Access login redirects", () => {
    expect(isCloudflareAccessRedirect(302, "https://team.cloudflareaccess.com/cdn-cgi/access/login/agents.example.test?token=secret")).toBe(true);
    expect(isCloudflareAccessRedirect(302, "https://example.test/login")).toBe(false);
    expect(isCloudflareAccessRedirect(200, "https://team.cloudflareaccess.com/cdn-cgi/access/login/agents.example.test")).toBe(false);
    expect(isCloudflareAccessRedirect(302, "not a URL")).toBe(false);
  });

  it("checks HTTP, SQLite, writable directories and disk without leaving probe files", async () => {
    const root = temporaryRoot();
    const dataDir = path.join(root, "data");
    const spoolDir = path.join(dataDir, "stream-events");
    const dbPath = path.join(dataDir, "claudex-workhouse.sqlite");
    fs.mkdirSync(spoolDir, { recursive: true });
    execFileSync("/bin/python3", ["-c", [
      "import sqlite3, sys",
      "db = sqlite3.connect(sys.argv[1])",
      "db.execute('create table sample(value text)')",
      "db.execute(\"insert into sample values ('ok')\")",
      "db.commit()",
      "db.close()"
    ].join(";"), dbPath]);

    const server = http.createServer((request, response) => {
      if (request.url === "/api/health/live") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end('{"ok":true,"status":"live"}');
        return;
      }
      response.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    expect(address && typeof address === "object").toBe(true);
    try {
      const run = await runMainServerHealthChecks({
        id: "main-run",
        targetId: "main",
        dataDir,
        spoolDir,
        dbPath,
        version: "1.3.0",
        installMethod: "docker-compose",
        internalUrl: `http://127.0.0.1:${(address as { port: number }).port}`,
        externalUrl: null,
        publicAccess: "local-only",
        claimState: "claimed",
        localWorker: false,
        sse: true,
        websocket: true,
        diskFreeBytes: 20 * 1024 * 1024 * 1024
      });

      expect(run).toMatchObject({ id: "main-run", targetType: "server", targetId: "main", overall: "healthy" });
      for (const key of ["server.http-health", "database.ping", "database.quick-check", "storage.data-writable", "storage.spool-writable"]) {
        expect(check(run, key).status).toBe("passed");
      }
      expect(fs.readdirSync(dataDir).some((name) => name.startsWith(".claudex-health-"))).toBe(false);
      expect(fs.readdirSync(spoolDir).some((name) => name.startsWith(".claudex-health-"))).toBe(false);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("uses read-only SQLite quick_check and rejects a corrupt database", async () => {
    const root = temporaryRoot();
    const valid = path.join(root, "valid.sqlite");
    const corrupt = path.join(root, "corrupt.sqlite");
    execFileSync("/bin/python3", ["-c", "import sqlite3,sys; db=sqlite3.connect(sys.argv[1]); db.execute('create table ok(value)'); db.commit(); db.close()", valid]);
    fs.writeFileSync(corrupt, "not a sqlite database");
    await expect(probeSqliteDatabase(valid)).resolves.toMatchObject({ ping: true, quickCheck: true });
    await expect(probeSqliteDatabase(corrupt)).rejects.toThrow();
    expect(fs.readFileSync(corrupt, "utf8")).toBe("not a sqlite database");
  });

  it("removes its exact temporary write probe", async () => {
    const root = temporaryRoot();
    await probeDirectoryWritable(root);
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it("sanitizes injected probe errors and exposes only safe remediation descriptions", async () => {
    const root = temporaryRoot();
    fs.mkdirSync(path.join(root, "spool"));
    const run = await runMainServerHealthChecks({
      dataDir: root,
      spoolDir: path.join(root, "spool"),
      dbPath: path.join(root, "missing.sqlite"),
      internalUrl: "http://127.0.0.1:8787",
      fetchHealth: async () => { throw new Error("OPENAI_API_KEY=http-secret"); },
      sqliteProbe: async () => { throw new Error("Authorization: Bearer sqlite-secret"); },
      version: null,
      installMethod: null,
      claimState: "pending",
      localWorker: { enabled: true, status: "offline" },
      diskFreeBytes: 20 * 1024 * 1024 * 1024
    });
    const serialized = JSON.stringify(run);
    expect(run.overall).toBe("failed");
    expect(serialized).not.toContain("http-secret");
    expect(serialized).not.toContain("sqlite-secret");
    expect(serialized).toContain(REDACTED);
    expect(run.checks.filter((item) => item.remediation).every((item) => item.remediation?.safe === true)).toBe(true);
  });

  it("fails closed when real transport probes fail even if connection counters are below their limits", async () => {
    const root = temporaryRoot();
    const spoolDir = path.join(root, "spool");
    fs.mkdirSync(spoolDir);
    const run = await runMainServerHealthChecks({
      dataDir: root,
      spoolDir,
      dbPath: path.join(root, "workhouse.sqlite"),
      internalUrl: "http://127.0.0.1:8787",
      externalUrl: "https://claudex.example.test",
      publicAccess: "custom-reverse-proxy",
      fetchHealth: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ ok: true })
      }),
      sqliteProbe: async () => ({ ping: true, quickCheck: true }),
      diskFreeBytes: 20 * 1024 * 1024 * 1024,
      version: "1.3.0",
      installMethod: "docker-compose",
      claimState: "claimed",
      localWorker: false,
      externalHealth: { ok: false, error: "TLS certificate verification failed" },
      externalSse: { ok: false, error: "External SSE event not received" },
      externalWebsocket: { ok: false, error: "External WebSocket upgrade failed" },
      sse: { ok: false, connections: 0, limit: 24, error: "SSE event not received" },
      websocket: { ok: false, error: "WebSocket upgrade failed" }
    });

    expect(run.overall).toBe("failed");
    expect(check(run, "server.external-connectivity")).toMatchObject({ status: "failed" });
    expect(check(run, "server.external-sse")).toMatchObject({ status: "failed" });
    expect(check(run, "server.external-websocket")).toMatchObject({ status: "failed" });
    expect(check(run, "transport.sse")).toMatchObject({ status: "failed" });
    expect(check(run, "transport.websocket")).toMatchObject({ status: "failed" });
  });

  it("reports Cloudflare Access protected external probes as warnings without exposing redirect URLs", async () => {
    const root = temporaryRoot();
    const spoolDir = path.join(root, "spool");
    fs.mkdirSync(spoolDir);
    const protectedProbe = {
      ok: false,
      status: 302,
      protectedBy: "cloudflare-access",
      location: "https://team.cloudflareaccess.com/cdn-cgi/access/login/agents.example.test?token=secret"
    };
    const run = await runMainServerHealthChecks({
      dataDir: root,
      spoolDir,
      dbPath: path.join(root, "workhouse.sqlite"),
      internalUrl: "http://127.0.0.1:8787",
      externalUrl: "https://agents.example.test",
      publicAccess: "cloudflare-existing",
      fetchHealth: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ ok: true })
      }),
      sqliteProbe: async () => ({ ping: true, quickCheck: true }),
      diskFreeBytes: 20 * 1024 * 1024 * 1024,
      version: "1.3.0",
      installMethod: "host",
      claimState: "claimed",
      localWorker: true,
      externalHealth: protectedProbe,
      externalSse: protectedProbe,
      externalWebsocket: protectedProbe,
      sse: true,
      websocket: true
    });

    expect(run.overall).toBe("warning");
    expect(check(run, "server.external-connectivity")).toMatchObject({ status: "warning", remediation: { safe: true } });
    expect(check(run, "server.external-sse")).toMatchObject({ status: "warning", remediation: { safe: true } });
    expect(check(run, "server.external-websocket")).toMatchObject({ status: "warning", remediation: { safe: true } });
    expect(check(run, "server.external-websocket").detail).toContain("/worker/*");
    expect(JSON.stringify(run)).not.toContain("token=secret");
  });
});
