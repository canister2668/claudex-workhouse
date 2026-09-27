// Session list grouping: running work first, then today, yesterday, and
// everything earlier, so the list reads like a timeline instead of one pile.
export type SessionGroupKey = "running" | "today" | "yesterday" | "earlier";
export const SESSION_GROUP_ORDER: readonly SessionGroupKey[] = ["running", "today", "yesterday", "earlier"];

const ACTIVE = new Set(["pending", "queued", "running", "waiting", "starting", "waiting-user", "cancel-requested"]);

const dayStart = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();

export function sessionGroupKey(item: { status: string; updatedAt: string }, now: Date = new Date()): SessionGroupKey {
  if (ACTIVE.has(item.status)) return "running";
  const updated = new Date(item.updatedAt).getTime();
  if (!Number.isFinite(updated)) return "earlier";
  const today = dayStart(now);
  if (updated >= today) return "today";
  if (updated >= today - 86_400_000) return "yesterday";
  return "earlier";
}

export function groupSessions<T extends { status: string; updatedAt: string }>(items: T[], now: Date = new Date()): Array<{ key: SessionGroupKey; items: T[] }> {
  const buckets = new Map<SessionGroupKey, T[]>();
  for (const item of items) {
    const key = sessionGroupKey(item, now);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }
  return SESSION_GROUP_ORDER.flatMap(key => buckets.has(key) ? [{ key, items: buckets.get(key)! }] : []);
}

// Session view tabs: one status intent each. "collaboration" switches the
// browser to collaboration work instead of filtering tasks.
export type SessionViewTab = "all" | "active" | "waiting" | "failed" | "collaboration";
export const SESSION_VIEW_TABS: readonly SessionViewTab[] = ["all", "active", "waiting", "failed", "collaboration"];
export const viewTabStatusFilter = (tab: SessionViewTab): "" | "active" | "waiting" | "failed" => tab === "active" || tab === "waiting" || tab === "failed" ? tab : "";
