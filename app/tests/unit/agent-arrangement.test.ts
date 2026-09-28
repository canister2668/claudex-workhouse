import { describe, expect, it } from "vitest";
import { agentPhase, emptyArrangement, fitActiveRow, formatElapsed, markSeen, nextArrangement, pileOf, pileWidth, type AgentPhase, type ArrangementInput } from "../../src/web/agent-arrangement";

type P = "codex" | "claude" | "grok" | "antigravity";
const providers: P[] = ["codex", "claude", "grok", "antigravity"];
const inputs = (phases: Partial<Record<P, AgentPhase>>, startedAt: Partial<Record<P, string>> = {}): ArrangementInput<P>[] =>
  providers.map(provider => ({ provider, phase: phases[provider] ?? "idle", startedAt: startedAt[provider] ?? null }));

describe("agent phase", () => {
  it("maps task statuses and liveness phases onto the ring states", () => {
    expect(agentPhase("running")).toBe("running");
    expect(agentPhase("acting")).toBe("running");
    expect(agentPhase("queued")).toBe("running");
    expect(agentPhase("waiting-approval")).toBe("waiting");
    expect(agentPhase("waiting-user")).toBe("waiting");
    expect(agentPhase("failed")).toBe("failed");
    expect(agentPhase("completed")).toBe("done");
    expect(agentPhase("stopped")).toBe("stopped");
    expect(agentPhase("")).toBe("idle");
    expect(agentPhase(undefined, "running")).toBe("running");
  });
  it("does not send a running task to the pile before its stream reports", () => {
    expect(agentPhase("idle", "running")).toBe("running");
    expect(agentPhase("idle", "completed")).toBe("idle");
  });
});

describe("active row order", () => {
  it("orders agents that are already active on first load by task start", () => {
    const state = nextArrangement(emptyArrangement<P>(), inputs({ codex: "running", grok: "waiting", claude: "running" }, { codex: "2026-09-28T10:05:00Z", claude: "2026-09-28T10:00:00Z", grok: "2026-09-28T10:02:00Z" }));
    expect(state.active).toEqual(["claude", "grok", "codex"]);
    expect(pileOf(state, providers)).toEqual(["antigravity"]);
  });

  it("appends a newly active agent at the right end without moving the others", () => {
    let state = nextArrangement(emptyArrangement<P>(), inputs({ grok: "running" }));
    state = nextArrangement(state, inputs({ grok: "running", codex: "running" }));
    // Codex is declared before Grok but started later: it must not jump ahead.
    expect(state.active).toEqual(["grok", "codex"]);
    state = nextArrangement(state, inputs({ grok: "waiting", codex: "running", claude: "running" }, { claude: "2020-01-01T00:00:00Z" }));
    expect(state.active).toEqual(["grok", "codex", "claude"]);
  });

  it("keeps an agent's place while it moves between running and waiting", () => {
    let state = nextArrangement(emptyArrangement<P>(), inputs({ codex: "running", claude: "running" }));
    state = nextArrangement(state, inputs({ codex: "waiting", claude: "running" }));
    state = nextArrangement(state, inputs({ codex: "running", claude: "waiting" }));
    expect(state.active).toEqual(["codex", "claude"]);
  });

  it("returns only the finished agent to the pile, with an unseen marker", () => {
    let state = nextArrangement(emptyArrangement<P>(), inputs({ codex: "running", claude: "running", grok: "running" }));
    state = nextArrangement(state, inputs({ codex: "running", claude: "done", grok: "running" }));
    expect(state.active).toEqual(["codex", "grok"]);
    expect(pileOf(state, providers)).toEqual(["claude", "antigravity"]);
    expect(state.unseen).toEqual({ claude: "done" });
    state = markSeen(state, "claude");
    expect(state.unseen).toEqual({});
  });

  it("puts a re-activated agent at the end instead of its old slot", () => {
    let state = nextArrangement(emptyArrangement<P>(), inputs({ codex: "running", claude: "running" }));
    state = nextArrangement(state, inputs({ codex: "done", claude: "running" }));
    state = nextArrangement(state, inputs({ codex: "running", claude: "running" }));
    expect(state.active).toEqual(["claude", "codex"]);
    expect(state.unseen).toEqual({});
  });

  it("keeps an observed failure in the active row until it is seen", () => {
    let state = nextArrangement(emptyArrangement<P>(), inputs({ codex: "running", claude: "running" }));
    state = nextArrangement(state, inputs({ codex: "failed", claude: "running" }));
    expect(state.active).toEqual(["codex", "claude"]);
    expect(state.unseen).toEqual({ codex: "failed" });
    state = nextArrangement(state, inputs({ codex: "failed", claude: "running", grok: "running" }));
    expect(state.active).toEqual(["codex", "claude", "grok"]);
    state = markSeen(state, "codex");
    expect(state.active).toEqual(["claude", "grok"]);
    expect(pileOf(state, providers)).toEqual(["codex", "antigravity"]);
  });

  it("does not mark results that were already there on first load", () => {
    const state = nextArrangement(emptyArrangement<P>(), inputs({ codex: "done", claude: "failed" }));
    expect(state.active).toEqual([]);
    expect(state.unseen).toEqual({});
  });

  it("drops a provider that disconnects", () => {
    let state = nextArrangement(emptyArrangement<P>(), inputs({ codex: "running", claude: "running" }));
    state = nextArrangement(state, inputs({ codex: "running", claude: "done" }).filter(input => input.provider !== "claude"));
    expect(state.active).toEqual(["codex"]);
    expect(state.unseen).toEqual({});
  });
});

describe("active row fit", () => {
  const metrics = { pill: 200, circle: 40, gap: 6, more: 34 };
  const active: P[] = ["codex", "claude", "grok", "antigravity"];
  it("uses pills while every active agent fits as one", () => {
    expect(fitActiveRow(active.slice(0, 2), { ...metrics, available: 406 })).toEqual({ mode: "pill", visible: ["codex", "claude"], hidden: [] });
  });
  it("falls back to circles, then hides the oldest behind +N", () => {
    expect(fitActiveRow(active, { ...metrics, available: 300 })).toEqual({ mode: "circle", visible: active, hidden: [] });
    // Four circles need 178px; with 130px, two circles (86) + gap + chip (34) = 126 fit.
    expect(fitActiveRow(active, { ...metrics, available: 130 })).toEqual({ mode: "circle", visible: ["grok", "antigravity"], hidden: ["codex", "claude"] });
    expect(fitActiveRow(active, { ...metrics, available: 20 })).toEqual({ mode: "circle", visible: [], hidden: active });
  });
  it("returns an empty row when nothing is active", () => {
    expect(fitActiveRow([], { ...metrics, available: 0 })).toEqual({ mode: "circle", visible: [], hidden: [] });
  });
  it("measures the half-overlapping pile", () => {
    expect(pileWidth(0, 40)).toBe(0);
    expect(pileWidth(1, 40)).toBe(40);
    expect(pileWidth(4, 40)).toBe(100);
  });
  it("formats elapsed time compactly", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(192_000)).toBe("3:12");
    expect(formatElapsed(3_723_000)).toBe("1:02:03");
  });
});
