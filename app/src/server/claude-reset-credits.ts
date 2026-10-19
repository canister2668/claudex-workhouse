import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runCommand } from "./process.js";
import { mapClaudeResetCredits, type QuotaResetCredits } from "./quota.js";

// The `/usage` screen the quota probe scrapes does not list banked usage-limit
// resets; the CLI reads them from the `cedar_ember` block of its OAuth usage
// endpoint instead. This module performs that single read-only GET with the
// CLI's own stored subscription token. It never refreshes or rewrites the
// token: an expired one simply skips the read until the CLI renews it, so the
// CLI's refresh-token rotation is never raced. Redemption is out of scope.

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage?cedar_ember=1&skip_spend=1";
// The endpoint answers `eligible:false, ineligible_reason:"surface"` unless the
// request identifies itself as the Claude Code CLI, the surface the passes are
// offered on.
const FALLBACK_CLI_VERSION = "2.1.296";
export const CLAUDE_RESET_CREDITS_OK_MS = 15 * 60_000;
export const CLAUDE_RESET_CREDITS_RETRY_MS = 5 * 60_000;
// The usage endpoint throttles hard and is shared with the `/usage` probe.
export const CLAUDE_RESET_CREDITS_RATE_LIMIT_MS = 30 * 60_000;

type Fetcher = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ status: number; ok: boolean; headers: { get(name: string): string | null }; json(): Promise<unknown> }>;
type ReaderOptions = { claudeBinary: string; cwd: string; home?: string; fetcher?: Fetcher; now?: () => number; cliVersion?: () => Promise<string> };

export function claudeCredentialsPath(home = process.env.HOME || os.homedir()) {
  return path.join(home, ".claude", ".credentials.json");
}

export function readClaudeAccessToken(file: string, now = Date.now()): string | null {
  try {
    const oauth = (JSON.parse(fs.readFileSync(file, "utf8")) as any)?.claudeAiOauth;
    const token = typeof oauth?.accessToken === "string" ? oauth.accessToken.trim() : "";
    const expiresAt = Number(oauth?.expiresAt);
    if (!token) return null;
    if (Number.isFinite(expiresAt) && expiresAt > 0 && expiresAt - 60_000 <= now) return null;
    return token;
  } catch { return null; }
}

export function createClaudeResetCreditsReader(options: ReaderOptions) {
  const now = options.now ?? Date.now;
  const fetcher = options.fetcher ?? (fetch as unknown as Fetcher);
  let last: QuotaResetCredits | null = null;
  let nextReadAt = 0;
  let pending: Promise<QuotaResetCredits | null> | null = null;
  let version: Promise<string> | null = null;
  const cliVersion = options.cliVersion ?? (async () => {
    const result = await runCommand(options.claudeBinary, ["--version"], { cwd: options.cwd, timeoutMs: 20_000, outputLimit: 4096, env: { ...process.env, DISABLE_AUTOUPDATER: "1" } }).catch(() => null);
    return /(\d+\.\d+\.\d+)/.exec(result?.stdout ?? "")?.[1] ?? FALLBACK_CLI_VERSION;
  });

  async function read(): Promise<QuotaResetCredits | null> {
    const token = readClaudeAccessToken(claudeCredentialsPath(options.home), now());
    if (!token) { nextReadAt = now() + CLAUDE_RESET_CREDITS_RETRY_MS; return last; }
    version ??= cliVersion().catch(() => FALLBACK_CLI_VERSION);
    try {
      const response = await fetcher(USAGE_URL, {
        headers: { Authorization: `Bearer ${token}`, "anthropic-beta": "oauth-2025-04-20", "Content-Type": "application/json", "x-app": "cli", "User-Agent": `claude-cli/${await version} (external, cli)` },
        signal: AbortSignal.timeout(10_000)
      });
      if (response.status === 429) {
        const retryAfter = Number(response.headers.get("retry-after"));
        nextReadAt = now() + Math.max(CLAUDE_RESET_CREDITS_RATE_LIMIT_MS, Number.isFinite(retryAfter) ? retryAfter * 1000 : 0);
        return last;
      }
      if (!response.ok) throw new Error(`Claude usage returned HTTP ${response.status}.`);
      last = mapClaudeResetCredits(await response.json(), now());
      nextReadAt = now() + CLAUDE_RESET_CREDITS_OK_MS;
      return last;
    } catch {
      nextReadAt = now() + CLAUDE_RESET_CREDITS_RETRY_MS;
      return last;
    }
  }

  return {
    async current(): Promise<QuotaResetCredits | null> {
      if (now() < nextReadAt) return last;
      pending ??= read().finally(() => { pending = null; });
      return pending;
    }
  };
}
