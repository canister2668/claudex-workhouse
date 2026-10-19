import { afterEach, describe, expect, it, vi } from "vitest";
import { waitForCodexCompaction } from "../../src/server/codex/compaction.js";

afterEach(() => vi.useRealTimers());

describe("Codex long-history compaction", () => {
  it("allows HTTPS fallback and compaction to finish after the former two-minute cutoff", async () => {
    vi.useFakeTimers();
    let finish!: (value: string) => void;
    const completion = waitForCodexCompaction(new Promise<string>(resolve => { finish=resolve; }));
    await vi.advanceTimersByTimeAsync(240_000);
    finish("compacted");
    await expect(completion).resolves.toBe("compacted");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("retains a bounded deadline and identifies local timeout separately", async () => {
    vi.useFakeTimers();
    const completion = waitForCodexCompaction(new Promise(() => {}));
    const failure = expect(completion).rejects.toMatchObject({code:"CODEX_COMPACTION_TIMEOUT"});
    await vi.advanceTimersByTimeAsync(600_000);
    await failure;
    expect(vi.getTimerCount()).toBe(0);
  });
  it("propagates the provider failure immediately and clears the deadline timer", async () => {
    vi.useFakeTimers();
    const error=Object.assign(new Error("capacity"),{providerError:{codexErrorCode:"serverOverloaded"}});
    await expect(waitForCodexCompaction(Promise.reject(error))).rejects.toBe(error);
    expect(vi.getTimerCount()).toBe(0);
  });
});
