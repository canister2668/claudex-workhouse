import { describe, expect, test } from "vitest";
import { ProviderStatusCache } from "../../src/server/provider-status-cache.js";

function controllable() {
  let release: (value: any) => void = () => {};
  let started = 0;
  const read = () => {
    started += 1;
    return new Promise<any>(resolve => { release = resolve; });
  };
  return { read, resolve: (value: any) => release(value), get started() { return started; } };
}

describe("provider status snapshot cache", () => {
  test("concurrent readers share one provider.status.read", async () => {
    const source = controllable();
    const cache = new ProviderStatusCache({ read: source.read, available: () => true });
    // The three endpoints that describe provider state, asked at once — which
    // is exactly what one setup screen load does.
    const readers = [cache.get(), cache.get(), cache.get()];
    expect(source.started).toBe(1);
    source.resolve({ accounts: { codex: { state: "connected" } } });
    const results = await Promise.all(readers);
    expect(source.started).toBe(1);
    for (const value of results) expect(value?.accounts.codex.state).toBe("connected");
  });

  test("a second read inside the TTL reuses the snapshot and starts no probe", async () => {
    let started = 0;
    let clock = 1_000;
    const cache = new ProviderStatusCache({
      read: async () => { started += 1; return { generation: started }; },
      available: () => true,
      ttlMs: 10_000,
      now: () => clock
    });
    expect((await cache.get())?.generation).toBe(1);
    clock += 9_000;
    expect((await cache.get())?.generation).toBe(1);
    expect(started).toBe(1);
    clock += 2_000;
    // Expired: the known snapshot is served immediately, marked stale, and the
    // refresh runs behind the request rather than in front of it.
    const stale = await cache.get();
    expect(stale?.generation).toBe(1);
    expect(stale?.stale).toBe(true);
    await Promise.resolve();
    expect(started).toBe(2);
    expect((await cache.get())?.generation).toBe(2);
  });

  test("a cold cache is the only read that waits for the probe", async () => {
    const source = controllable();
    const cache = new ProviderStatusCache({ read: source.read, available: () => true, ttlMs: 0 });
    const cold = cache.get();
    source.resolve({ generation: 1 });
    expect((await cold)?.generation).toBe(1);
    // Every later read answers without waiting on the probe it starts.
    const settled = await Promise.race([cache.get(), Promise.resolve("would have blocked")]);
    expect((settled as any)?.generation).toBe(1);
  });

  test("a failed probe is not retried until the error window has passed", async () => {
    let attempts = 0;
    let clock = 1_000;
    const cache = new ProviderStatusCache({
      read: async () => { attempts += 1; throw new Error("worker timed out"); },
      available: () => true,
      ttlMs: 0,
      errorTtlMs: 5_000,
      now: () => clock
    });
    expect(await cache.get()).toBeNull();
    expect(attempts).toBe(1);
    // Retrying a chain that just timed out only makes the next caller wait for
    // the same timeout again.
    clock += 1_000;
    expect(await cache.get()).toBeNull();
    expect(attempts).toBe(1);
    clock += 5_000;
    expect(await cache.get()).toBeNull();
    expect(attempts).toBe(2);
  });

  test("no probe is started while a runtime update is replacing the executables", async () => {
    let started = 0;
    const cache = new ProviderStatusCache({
      read: async () => { started += 1; return { generation: started }; },
      available: () => true
    });
    await cache.get();
    expect(started).toBe(1);
    let observed: any = null;
    await cache.duringMutation(async () => {
      expect(cache.updating).toBe(true);
      observed = await cache.get();
      // Still one: the update must not spawn a probe against a locked binary.
      expect(started).toBe(1);
    });
    expect(observed?.updateInProgress).toBe(true);
    expect(observed?.generation).toBe(1);
    expect(cache.updating).toBe(false);
  });

  test("the snapshot is refreshed once the update finishes", async () => {
    let started = 0;
    const cache = new ProviderStatusCache({
      read: async () => { started += 1; return { generation: started }; },
      available: () => true,
      ttlMs: 60_000
    });
    await cache.get();
    await cache.duringMutation(async () => {});
    // The mutation itself waits for the replacement, so the caller that
    // triggered the update reports the new runtime even though the TTL has not
    // expired — and it is the only caller that paid for the probe.
    expect(started).toBe(2);
    expect((await cache.get())?.generation).toBe(2);
  });

  test("a reader during the post-update refresh is answered from the previous snapshot", async () => {
    const source = controllable();
    const cache = new ProviderStatusCache({ read: source.read, available: () => true, ttlMs: 60_000 });
    const first = cache.get();
    source.resolve({ generation: 1 });
    await first;
    // The refresh started by the finishing mutation is still in flight here.
    const mutation = cache.duringMutation(async () => {});
    await Promise.resolve();
    const during = await cache.get();
    expect(during?.generation).toBe(1);
    expect(during?.stale).toBe(true);
    source.resolve({ generation: 2 });
    await mutation;
    expect((await cache.get())?.generation).toBe(2);
  });

  test("overlapping mutations keep suppression until the last one finishes", async () => {
    const cache = new ProviderStatusCache({ read: async () => ({}), available: () => true });
    let inner: Promise<void> | null = null;
    await cache.duringMutation(async () => {
      inner = cache.duringMutation(async () => { expect(cache.updating).toBe(true); });
      await inner;
      expect(cache.updating).toBe(true);
    });
    expect(cache.updating).toBe(false);
  });

  test("a failed probe preserves the last known snapshot instead of emptying it", async () => {
    let attempt = 0;
    const cache = new ProviderStatusCache({
      read: async () => { attempt += 1; if (attempt > 1) throw new Error("worker offline"); return { generation: 1 }; },
      available: () => true,
      ttlMs: 0
    });
    expect((await cache.get())?.generation).toBe(1);
    expect((await cache.get())?.generation).toBe(1);
  });

  test("an unavailable worker is never probed", async () => {
    let started = 0;
    const cache = new ProviderStatusCache({ read: async () => { started += 1; return {}; }, available: () => false });
    expect(await cache.get()).toBeNull();
    expect(started).toBe(0);
  });
});
