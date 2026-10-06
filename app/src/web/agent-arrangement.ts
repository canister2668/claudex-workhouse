// Header agent arrangement: which avatars stand in the active row, in what
// order, and which ones rest in the pile. Pure so the ordering rules can be
// tested without a DOM.
//
// Rules (approved header design):
// - An agent that is running, waiting for a person, or has finished or failed
//   without the person having seen it stands in the active row; everyone else
//   sits in the pile.
// - The active row is ordered by activation. A newly active agent is appended
//   at the right end, next to the pile, so agents that are already working are
//   never pushed or reordered by later ones.
// - An agent that finishes keeps its place in the active row, marked, until the
//   person looks at it; only then does it return to the pile alone. The others
//   keep their place throughout. A finish already there on first load is old
//   news and rests in the pile.

export type AgentPhase = "running" | "waiting" | "failed" | "done" | "stopped" | "idle";

const RUNNING = new Set(["running", "pending", "queued", "reasoning", "acting"]);
const WAITING = new Set(["waiting", "waiting-user", "waiting-approval"]);

// `live` is the liveness phase from the task stream; `recent` is the task
// status from the last snapshot. A stream that has not produced its first
// event reports "idle" for a running task, which must not send it to the pile.
export function agentPhase(live: string | null | undefined, recent?: string | null): AgentPhase {
  const status = live && !(live === "idle" && recent && (RUNNING.has(recent) || WAITING.has(recent))) ? live : recent ?? "";
  if (RUNNING.has(status)) return "running";
  if (WAITING.has(status)) return "waiting";
  if (status === "failed") return "failed";
  if (status === "completed") return "done";
  if (status === "stopped") return "stopped";
  return "idle";
}

export const isWorkingPhase = (phase: AgentPhase) => phase === "running" || phase === "waiting";

export type ArrangementInput<P extends string = string> = {
  provider: P;
  phase: AgentPhase;
  // Task start time, used only to order agents that are already active when
  // the page first sees them.
  startedAt?: string | null;
};

export type ArrangementState<P extends string = string> = {
  // Active row, oldest activation first.
  active: P[];
  // Finished while observed and not yet looked at.
  unseen: Partial<Record<P, "done" | "failed">>;
  // Last phase seen per provider; absent before the first observation.
  phases: Partial<Record<P, AgentPhase>>;
};

export function emptyArrangement<P extends string>(): ArrangementState<P> {
  return { active: [], unseen: {}, phases: {} };
}

const startedMs = (value?: string | null) => {
  const ms = Date.parse(value ?? "");
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
};

export function nextArrangement<P extends string>(state: ArrangementState<P>, inputs: ArrangementInput<P>[]): ArrangementState<P> {
  const present = new Set(inputs.map(input => input.provider));
  const unseen: Partial<Record<P, "done" | "failed">> = {};
  const phases: Partial<Record<P, AgentPhase>> = {};
  for (const provider of Object.keys(state.unseen) as P[]) if (present.has(provider)) unseen[provider] = state.unseen[provider];
  const joining: { input: ArrangementInput<P>; index: number }[] = [];
  inputs.forEach((input, index) => {
    const previous = state.phases[input.provider];
    phases[input.provider] = input.phase;
    if (isWorkingPhase(input.phase)) {
      delete unseen[input.provider];
      if (!state.active.includes(input.provider)) joining.push({ input, index });
      return;
    }
    // Only a finish observed on this page earns a marker. A failure or
    // completion that is already there on first load is old news.
    if (previous && isWorkingPhase(previous)) {
      if (input.phase === "done") unseen[input.provider] = "done";
      else if (input.phase === "failed") unseen[input.provider] = "failed";
      else delete unseen[input.provider];
    } else if (previous && previous !== input.phase) delete unseen[input.provider];
  });
  const inputFor = new Map(inputs.map(input => [input.provider, input]));
  const stays = (provider: P) => {
    const input = inputFor.get(provider);
    return Boolean(input && (isWorkingPhase(input.phase) || unseen[provider]));
  };
  // Agents that became active in the same update are ordered by task start,
  // then by declared order, so a first load reproduces who started first.
  joining.sort((a, b) => startedMs(a.input.startedAt) - startedMs(b.input.startedAt) || a.index - b.index);
  const active = [...state.active.filter(stays), ...joining.map(entry => entry.input.provider)];
  return { active, unseen, phases };
}

// The person looked at this agent: the unseen-result marker clears and the
// finished agent leaves the active row.
export function markSeen<P extends string>(state: ArrangementState<P>, provider: P): ArrangementState<P> {
  if (!state.unseen[provider]) return state;
  const unseen = { ...state.unseen };
  delete unseen[provider];
  return { ...state, unseen, active: state.active.filter(item => item !== provider) };
}

// Pile keeps the declared provider order so resting agents never shuffle.
export function pileOf<P extends string>(state: ArrangementState<P>, providers: P[]): P[] {
  return providers.filter(provider => !state.active.includes(provider));
}

export type ActiveRowMetrics = {
  // Width available to the active row after the pile.
  available: number;
  pill: number;
  circle: number;
  gap: number;
  // Width of the "+N" chip.
  more: number;
};

export type ActiveRowFit<P extends string = string> = {
  mode: "pill" | "circle";
  visible: P[];
  // Oldest activations first; they sit behind "+N" on the left.
  hidden: P[];
};

const rowWidth = (count: number, item: number, gap: number) => count <= 0 ? 0 : count * item + (count - 1) * gap;

// Pills when every active agent fits as a pill, circles when every one fits as
// a circle, otherwise as many of the newest as fit beside a "+N" chip. The
// newest stay visible because they sit next to the pile where the eye lands
// when something just started.
export function fitActiveRow<P extends string>(active: P[], metrics: ActiveRowMetrics): ActiveRowFit<P> {
  const { available, pill, circle, gap, more } = metrics;
  if (!active.length) return { mode: "circle", visible: [], hidden: [] };
  if (rowWidth(active.length, pill, gap) <= available) return { mode: "pill", visible: [...active], hidden: [] };
  if (rowWidth(active.length, circle, gap) <= available) return { mode: "circle", visible: [...active], hidden: [] };
  let shown = active.length - 1;
  while (shown > 0 && rowWidth(shown, circle, gap) + gap + more > available) shown--;
  return { mode: "circle", visible: active.slice(active.length - shown), hidden: active.slice(0, active.length - shown) };
}

// Width of a pile of `count` circles that overlap by `overlap` of their size.
export function pileWidth(count: number, circle: number, overlap = 0.5) {
  return count <= 0 ? 0 : circle + (count - 1) * circle * (1 - overlap);
}

export function formatElapsed(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600), minutes = Math.floor((total % 3600) / 60), seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}
