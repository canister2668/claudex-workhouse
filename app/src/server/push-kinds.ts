export const PUSH_KINDS = ["approval", "user-input", "completed", "failed", "host-offline", "handoff", "quota-started", "quota-cancelled", "quota-failed"] as const;
export type PushKind = typeof PUSH_KINDS[number];
