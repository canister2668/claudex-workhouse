import { describe, expect, it } from "vitest";
import { createInfrastructureSupportBundle } from "../../src/server/infrastructure/index.js";

describe("infrastructure support bundle", () => {
  it("exports only a bounded diagnostic allowlist without credentials, identifiers, or paths", () => {
    const bundle = createInfrastructureSupportBundle({
      generatedAt: "2026-07-27T12:00:00.000Z",
      appVersion: "1.2.3",
      installMethod: "docker-compose",
      publicAccess: "cloudflare-existing",
      ownerClaimStatus: "claimed",
      roles: ["main-server", "worker"],
      platform: "linux",
      architecture: "x64",
      operatingSystemVersion: "6.1.0",
      nodeVersion: "v22.18.0",
      serverHealth: {
        id: "server-secret-id",
        targetType: "server",
        targetId: "local",
        startedAt: "2026-07-27T11:59:58.000Z",
        completedAt: "2026-07-27T12:00:00.000Z",
        overall: "failed",
        checks: [{
          key: "database.ping",
          label: "SQLite access",
          status: "failed",
          summary: "Authorization: Bearer secret-bearer /volume1/homes/alice/data owner@example.test",
          detail: "claimToken=owner-claim-secret",
          remediation: { payload: { token: "remediation-secret" } }
        }]
      },
      executionHosts: [{
        id: "worker-permanent-id",
        displayName: "Alice Desktop",
        email: "owner@example.test",
        platform: "win32",
        architecture: "x64",
        workerVersion: "1.2.3",
        connectionStatus: "online",
        healthStatus: "warning",
        disabledAt: null,
        revokedAt: null,
        lastSeenAt: "2026-07-27T11:58:00.000Z",
        credential: "worker-credential-secret",
        workspaceRoots: ["C:\\Users\\Alice\\Secret Project"],
        lastHealthCheck: {
          targetType: "execution-host",
          targetId: "worker-permanent-id",
          startedAt: "2026-07-27T11:57:00.000Z",
          completedAt: "2026-07-27T11:57:01.000Z",
          overall: "warning",
          checks: [{
            key: "runtime.claude",
            label: "Claude executable",
            status: "warning",
            summary: "OPENAI_API_KEY=provider-secret"
          }]
        }
      }]
    });

    expect(bundle).toMatchObject({
      type: "claudex-workhouse-support-bundle",
      schemaVersion: 1,
      generatedAt: "2026-07-27T12:00:00.000Z",
      privacy: {
        credentialsIncluded: false,
        rawLogsIncluded: false,
        absolutePathsIncluded: false,
        hostIdentifiersIncluded: false,
        accountIdentifiersIncluded: false
      },
      application: { version: "1.2.3", installMethod: "docker-compose" },
      installation: {
        roles: ["main-server", "worker"],
        publicAccess: "cloudflare-existing",
        ownerClaimStatus: "claimed"
      }
    });
    expect(bundle.executionHosts).toHaveLength(1);
    expect(bundle.executionHosts[0]).toMatchObject({
      sequence: 1,
      platform: "win32",
      architecture: "x64",
      connectionStatus: "online",
      healthStatus: "warning"
    });

    const serialized = JSON.stringify(bundle);
    for (const forbidden of [
      "secret-bearer",
      "owner-claim-secret",
      "remediation-secret",
      "provider-secret",
      "worker-credential-secret",
      "owner@example.test",
      "/volume1/homes/alice/data",
      "C:\\Users\\Alice\\Secret Project",
      "server-secret-id",
      "worker-permanent-id",
      "Alice Desktop"
    ]) expect(serialized).not.toContain(forbidden);
    expect(serialized).toContain("[REDACTED]");
    expect(serialized).toContain("[REDACTED_PATH]");
    expect(Object.keys(bundle.executionHosts[0])).not.toContain("id");
  });

  it("normalizes unknown states and refuses arbitrary metadata strings", () => {
    const bundle = createInfrastructureSupportBundle({
      appVersion: "https://example.test/download?token=secret",
      installMethod: "docker-compose; cat /etc/passwd",
      publicAccess: "internet-port-forward",
      ownerClaimStatus: "secret",
      platform: "linux",
      architecture: "x64",
      executionHosts: [{
        platform: "linux",
        architecture: "arm64",
        connectionStatus: "mystery",
        healthStatus: "mystery",
        lastSeenAt: "not-a-date"
      }]
    });

    expect(bundle.application).toEqual({ version: "unknown", installMethod: "unknown" });
    expect(bundle.installation.publicAccess).toBe("unknown");
    expect(bundle.installation.ownerClaimStatus).toBe("unknown");
    expect(bundle.executionHosts[0]).toMatchObject({
      connectionStatus: "unknown",
      healthStatus: "unknown",
      lastSeenAt: null
    });
  });
});
