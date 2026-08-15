import { sanitizeSensitiveText } from "../sensitive-data.js";
import type {
  HealthCheckOverall,
  HealthCheckStatus,
  InfrastructureConnectionStatus,
  InfrastructureHealthStatus
} from "./types.js";

const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const WINDOWS_ABSOLUTE_PATH = /\b[A-Za-z]:\\[^\r\n,;"']+/g;
const UNIX_ABSOLUTE_PATH = /\/(?:[^\s"'`]+\/)*[^\s"'`]*/g;
const HOME_PATH = /(^|[\s("'`])~\/[^\s"'`]*/g;

type UnknownRecord = Record<string, unknown>;

export interface InfrastructureSupportBundleInput {
  generatedAt?: string;
  appVersion?: unknown;
  installMethod?: unknown;
  publicAccess?: unknown;
  ownerClaimStatus?: unknown;
  roles?: unknown;
  platform?: unknown;
  architecture?: unknown;
  operatingSystemVersion?: unknown;
  nodeVersion?: unknown;
  serverHealth?: unknown;
  executionHosts?: unknown;
}

export interface SupportBundleHealthCheck {
  key: string;
  label: string;
  status: HealthCheckStatus;
  summary: string;
}

export interface SupportBundleHealthRun {
  targetType: "server" | "execution-host";
  startedAt: string | null;
  completedAt: string | null;
  overall: HealthCheckOverall;
  checks: SupportBundleHealthCheck[];
}

export interface InfrastructureSupportBundle {
  type: "claudex-workhouse-support-bundle";
  schemaVersion: 1;
  generatedAt: string;
  privacy: {
    credentialsIncluded: false;
    rawLogsIncluded: false;
    absolutePathsIncluded: false;
    hostIdentifiersIncluded: false;
    accountIdentifiersIncluded: false;
  };
  application: {
    version: string;
    installMethod: string;
  };
  environment: {
    platform: string;
    architecture: string;
    operatingSystemVersion: string;
    nodeVersion: string;
  };
  installation: {
    roles: Array<"main-server" | "worker">;
    publicAccess: "local-only" | "cloudflare-existing" | "tailscale-existing" | "custom-reverse-proxy" | "unknown";
    ownerClaimStatus: "claimed" | "pending" | "expired" | "unknown";
  };
  server: {
    connectionStatus: "online";
    health: SupportBundleHealthRun | null;
  };
  executionHosts: Array<{
    sequence: number;
    platform: string;
    architecture: string;
    workerVersion: string;
    roles: Array<"worker">;
    connectionStatus: InfrastructureConnectionStatus;
    healthStatus: InfrastructureHealthStatus;
    disabled: boolean;
    revoked: boolean;
    lastSeenAt: string | null;
    health: SupportBundleHealthRun | null;
  }>;
}

function record(value: unknown): UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}

function safeTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

/**
 * Diagnostic exports deliberately use a stricter text policy than ordinary
 * UI diagnostics: paths and account identifiers are never useful enough here
 * to justify including them in a support attachment.
 */
function safeSupportText(value: unknown, limit = 240): string {
  return sanitizeSensitiveText(value)
    .replace(EMAIL, "[REDACTED_EMAIL]")
    .replace(WINDOWS_ABSOLUTE_PATH, "[REDACTED_PATH]")
    .replace(HOME_PATH, (_match, prefix: string) => `${prefix}[REDACTED_PATH]`)
    .replace(UNIX_ABSOLUTE_PATH, "[REDACTED_PATH]")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, limit);
}

function metadataText(value: unknown, fallback = "unknown"): string {
  const safe = safeSupportText(value, 120);
  if (!safe || safe.includes("[REDACTED_") || !/^[\p{L}\p{N}\s._()+-]+$/u.test(safe)) return fallback;
  return safe;
}

function platformText(value: unknown): string {
  const safe = metadataText(value).toLowerCase();
  return [
    "linux",
    "win32",
    "windows",
    "darwin",
    "freebsd",
    "openbsd",
    "aix",
    "android",
    "synology",
    "qnap",
    "docker-nas"
  ].includes(safe) ? safe : "unknown";
}

function architectureText(value: unknown): string {
  const safe = metadataText(value).toLowerCase();
  return ["x64", "arm64", "arm", "ia32", "ppc64", "s390x", "riscv64"].includes(safe) ? safe : "unknown";
}

function versionText(value: unknown): string {
  const safe = metadataText(value);
  return /^v?\d[\p{L}\p{N}._()+-]{0,79}$/u.test(safe) ? safe : "unknown";
}

function installMethodText(value: unknown): string {
  const safe = metadataText(value);
  return ["docker-compose", "portable-worker", "powershell-worker", "shell-worker", "unknown"].includes(safe)
    ? safe
    : "unknown";
}

function healthStatus(value: unknown): InfrastructureHealthStatus {
  return value === "healthy" || value === "warning" || value === "failed" || value === "unknown"
    ? value
    : "unknown";
}

function connectionStatus(value: unknown): InfrastructureConnectionStatus {
  return value === "online" || value === "offline" || value === "connecting" || value === "unknown"
    ? value
    : "unknown";
}

function healthRun(value: unknown): SupportBundleHealthRun | null {
  const source = record(value);
  const targetType = source.targetType === "execution-host"
    ? "execution-host"
    : source.targetType === "server"
      ? "server"
      : null;
  const overall = source.overall === "healthy" || source.overall === "warning" || source.overall === "failed"
    ? source.overall
    : null;
  if (!targetType || !overall || !Array.isArray(source.checks)) return null;

  const checks: SupportBundleHealthCheck[] = [];
  for (const rawCheck of source.checks.slice(0, 100)) {
    const check = record(rawCheck);
    const status = check.status === "passed" || check.status === "warning" || check.status === "failed" || check.status === "skipped"
      ? check.status
      : null;
    const key = typeof check.key === "string" && /^[a-z0-9._-]{1,120}$/i.test(check.key) ? check.key : "";
    if (!status || !key) continue;
    checks.push({
      key,
      label: safeSupportText(check.label, 120) || key,
      status,
      summary: safeSupportText(check.summary, 300) || status
    });
  }

  return {
    targetType,
    startedAt: safeTimestamp(source.startedAt),
    completedAt: safeTimestamp(source.completedAt),
    overall,
    checks
  };
}

function publicAccess(value: unknown): InfrastructureSupportBundle["installation"]["publicAccess"] {
  return value === "local-only"
    || value === "cloudflare-existing"
    || value === "tailscale-existing"
    || value === "custom-reverse-proxy"
    ? value
    : "unknown";
}

function claimStatus(value: unknown): InfrastructureSupportBundle["installation"]["ownerClaimStatus"] {
  return value === "claimed" || value === "pending" || value === "expired" ? value : "unknown";
}

function roles(value: unknown): Array<"main-server" | "worker"> {
  if (!Array.isArray(value)) return ["main-server"];
  const result = value.filter((role): role is "main-server" | "worker" => role === "main-server" || role === "worker");
  return Array.from(new Set(result)).slice(0, 2);
}

export function createInfrastructureSupportBundle(
  input: InfrastructureSupportBundleInput
): InfrastructureSupportBundle {
  const generatedAt = safeTimestamp(input.generatedAt) ?? new Date().toISOString();
  const hosts = Array.isArray(input.executionHosts) ? input.executionHosts.slice(0, 100) : [];

  return {
    type: "claudex-workhouse-support-bundle",
    schemaVersion: 1,
    generatedAt,
    privacy: {
      credentialsIncluded: false,
      rawLogsIncluded: false,
      absolutePathsIncluded: false,
      hostIdentifiersIncluded: false,
      accountIdentifiersIncluded: false
    },
    application: {
      version: versionText(input.appVersion),
      installMethod: installMethodText(input.installMethod)
    },
    environment: {
      platform: platformText(input.platform),
      architecture: architectureText(input.architecture),
      operatingSystemVersion: versionText(input.operatingSystemVersion),
      nodeVersion: versionText(input.nodeVersion)
    },
    installation: {
      roles: roles(input.roles),
      publicAccess: publicAccess(input.publicAccess),
      ownerClaimStatus: claimStatus(input.ownerClaimStatus)
    },
    server: {
      connectionStatus: "online",
      health: healthRun(input.serverHealth)
    },
    executionHosts: hosts.map((value, index) => {
      const host = record(value);
      return {
        sequence: index + 1,
        platform: platformText(host.platform),
        architecture: architectureText(host.architecture),
        workerVersion: versionText(host.workerVersion ?? host.appVersion),
        roles: ["worker"] as Array<"worker">,
        connectionStatus: connectionStatus(host.connectionStatus ?? host.status),
        healthStatus: healthStatus(host.healthStatus),
        disabled: Boolean(host.disabledAt),
        revoked: Boolean(host.revokedAt),
        lastSeenAt: safeTimestamp(host.lastSeenAt),
        health: healthRun(host.health ?? host.lastHealthCheck)
      };
    })
  };
}
