export type InfrastructureConnectionStatus = "online" | "offline" | "connecting" | "unknown";
export type InfrastructureHealthStatus = "healthy" | "warning" | "failed" | "unknown";

export type HealthCheckStatus = "passed" | "warning" | "failed" | "skipped";
export type HealthCheckOverall = Exclude<InfrastructureHealthStatus, "unknown">;
export type HealthCheckTargetType = "server" | "execution-host";
export type HealthRemediationKind =
  | "retry"
  | "restart-service"
  | "rediscover-binary"
  | "open-settings"
  | "documentation";

export interface HealthCheckRemediation {
  kind: HealthRemediationKind;
  /** English text for support bundles and logs; the UI prefers `labelKey`. */
  label: string;
  labelKey?: string;
  /**
   * Infrastructure health checks only describe operations that are safe to
   * expose in the UI. The executor still has to authorize and validate the
   * requested target.
   */
  safe: true;
  payload?: Record<string, unknown>;
}

export interface HealthCheckResult {
  key: string;
  label: string;
  status: HealthCheckStatus;
  /**
   * English text kept for support bundles and logs. The UI renders `summaryKey`
   * when present and only falls back to this for runs stored before keys existed.
   */
  summary: string;
  summaryKey?: string;
  summaryParams?: Record<string, string | number>;
  detail?: string;
  remediation?: HealthCheckRemediation;
}

export interface HealthCheckRun {
  id: string;
  targetType: HealthCheckTargetType;
  targetId: string;
  startedAt: string;
  completedAt: string | null;
  overall: HealthCheckOverall;
  checks: HealthCheckResult[];
}

export interface HealthRunOptions {
  id?: string;
  startedAt?: string;
  completedAt?: string | null;
}

export interface SystemDiagnosticsNormalizationOptions extends HealthRunOptions {
  targetId?: string;
  diskWarningBytes?: number;
  diskFailureBytes?: number;
}

export interface ExecutionHostDiagnosticsNormalizationOptions extends HealthRunOptions {
  targetId: string;
  connectionStatus?: unknown;
  capabilities?: unknown;
  expectedProtocolVersion?: number;
  diskWarningBytes?: number;
  diskFailureBytes?: number;
}
