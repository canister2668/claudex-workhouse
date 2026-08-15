import type { DeckTask, ProviderId } from "./types.js";

// Every follow-up, recovery, and managed resume launches a fresh provider
// process bound to the session id of the task it continues. Two live turns on
// one session write the same provider transcript and merge into a single event
// stream, so the session card interleaves answers from different processes, the
// turns interrupt each other, and the settled card labels whichever turn
// happened to finish last as the final answer. Admission is therefore
// serialized per session and refused while another turn is still live.
export const liveTurnStatus = (status: string) => ["pending", "queued", "running", "waiting"].includes(status);

export function sessionTurnConflict(active?: DeckTask | null) {
  return Object.assign(
    new Error("This session already has a turn in progress. Wait for it to finish, or queue the message instead of starting another turn."),
    { statusCode: 409, code: "SESSION_TURN_IN_PROGRESS", ...(active ? { taskId: active.id } : {}) },
  );
}

export type ThreadTurnGateDeps = {
  // Latest task on the session, already reconciled against the provider.
  latestThreadTask: (provider: ProviderId, threadId: string) => Promise<DeckTask | null>;
  activeTasks: () => Promise<DeckTask[]>;
  refresh: (task: DeckTask) => Promise<DeckTask>;
};

export function createThreadTurnGate(deps: ThreadTurnGateDeps) {
  const dispatching = new Set<string>();
  const gateKey = (provider: ProviderId, threadId: string) => `${provider}:${threadId}`;

  async function activeThreadTurn(providerId: ProviderId, threadId: string) {
    const latest = await deps.latestThreadTask(providerId, threadId);
    if (latest && liveTurnStatus(latest.status)) return latest;
    const siblings = (await deps.activeTasks()).filter(task => task.provider === providerId && task.threadId === threadId && task.id !== latest?.id && liveTurnStatus(task.status));
    for (const sibling of siblings) {
      // A row left behind by a dead worker must not block the session forever,
      // so every candidate is confirmed against the provider before it counts.
      let current = sibling;
      try { current = await deps.refresh(sibling); } catch { /* keep the stored row */ }
      if (liveTurnStatus(current.status)) return current;
    }
    return null;
  }

  async function withThreadTurn<T>(providerId: ProviderId, threadId: string | null | undefined, run: () => Promise<T>, onBusy?: (active: DeckTask) => Promise<T>): Promise<T> {
    if (!threadId) return run();
    const key = gateKey(providerId, threadId);
    if (dispatching.has(key)) {
      if (!onBusy) throw sessionTurnConflict(null);
      const latest = await deps.latestThreadTask(providerId, threadId);
      if (!latest) throw sessionTurnConflict(null);
      return onBusy(latest);
    }
    dispatching.add(key);
    try {
      const active = await activeThreadTurn(providerId, threadId);
      if (active) {
        if (!onBusy) throw sessionTurnConflict(active);
        return await onBusy(active);
      }
      return await run();
    } finally { dispatching.delete(key); }
  }

  return { dispatching, gateKey, activeThreadTurn, withThreadTurn };
}
