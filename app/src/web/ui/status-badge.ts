// The five task states the interface is allowed to show. Every status a
// provider reports collapses onto one of these so a row never carries two
// competing colours, and the label is always one word.
export type BadgeState = "running" | "attention" | "delayed" | "failed" | "completed";

export const BADGE_STATES: readonly BadgeState[] = ["running", "attention", "delayed", "failed", "completed"];

// warn carries every live state (running, needs you, delayed); ok and err are
// reserved for the two terminal answers.
export const BADGE_TONE: Record<BadgeState, "ok" | "warn" | "err"> = {
  running: "warn",
  attention: "warn",
  delayed: "warn",
  failed: "err",
  completed: "ok"
};

const RUNNING = new Set(["pending", "queued", "running", "starting", "reasoning", "acting"]);
const ATTENTION = new Set(["waiting", "waiting-user", "waiting-approval", "cancel-requested", "partial", "stop-unconfirmed"]);
const FAILED = new Set(["failed", "stopped", "cancelled", "archived"]);

export function taskBadgeState(status: string | null | undefined, options: { delayed?: boolean } = {}): BadgeState {
  const value = String(status ?? "");
  if (ATTENTION.has(value)) return "attention";
  if (RUNNING.has(value)) return options.delayed ? "delayed" : "running";
  if (FAILED.has(value)) return "failed";
  if (value === "completed") return "completed";
  // Unknown values are treated as still running rather than silently done:
  // the false "완료" is the worse mistake.
  return options.delayed ? "delayed" : "running";
}

export const badgeLabelKey = (state: BadgeState) => `status.badge.${state}`;
