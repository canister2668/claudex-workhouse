import { describe, expect, test } from "vitest";
import { setupProviderReadiness } from "../../src/server/setup-readiness.js";

const runtimes = [{ provider: "claude", current: "2.0.0" }, { provider: "codex", current: "0.60.0" }];
const accounts = [{ provider: "claude", state: "connected" }, { provider: "codex", state: "connected" }];

describe("setup screen provider readiness", () => {
  test("both probes answered: state comes from the probes themselves", () => {
    const providers = setupProviderReadiness({ value: runtimes, pending: false }, { value: accounts, pending: false });
    expect(providers.map(item => item.state)).toEqual(["ready", "ready"]);
    expect(providers.every(item => !item.probePending)).toBe(true);
  });

  test("a late accounts probe never turns an installed provider into a diagnosis", () => {
    // The runtime list came back inside the budget while the accounts probe —
    // which reaches the auth refresh and the DeepSeek/Ollama health checks —
    // was still running. The installation is fine and must not be reported as
    // needing diagnosis.
    const providers = setupProviderReadiness({ value: runtimes, pending: false }, { value: [], pending: true });
    for (const item of providers) {
      expect(item.state).toBe("checking");
      expect(item.accountState).toBe("checking");
      expect(item.installed).toBe(true);
      expect(item.version).not.toBeNull();
    }
  });

  test("a late runtime probe leaves the account answer intact", () => {
    const providers = setupProviderReadiness({ value: [], pending: true }, { value: accounts, pending: false });
    for (const item of providers) {
      expect(item.state).toBe("checking");
      // The accounts probe did answer, so its answer is reported rather than
      // being downgraded by the other probe's lateness.
      expect(item.accountState).toBe("connected");
    }
  });

  test("a settled empty result still means not installed", () => {
    const providers = setupProviderReadiness({ value: [], pending: false }, { value: [], pending: false });
    expect(providers.map(item => item.state)).toEqual(["not-installed", "not-installed"]);
    expect(providers.map(item => item.accountState)).toEqual(["unavailable", "unavailable"]);
  });

  test("an installed provider that is signed out is login-required, not diagnostic", () => {
    const providers = setupProviderReadiness(
      { value: runtimes, pending: false },
      { value: [{ provider: "claude", state: "disconnected" }, { provider: "codex", state: "connected" }], pending: false }
    );
    expect(providers.find(item => item.provider === "claude")?.state).toBe("login-required");
    expect(providers.find(item => item.provider === "codex")?.state).toBe("ready");
  });
});
