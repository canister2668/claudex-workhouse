import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { screenHelperCommand } from "./pty-helpers/command.js";

// Claude Code cloud sessions run on Anthropic infrastructure and draw from the
// one-time cloud-session credit before the subscription. The CLI's /usage
// screen caches the account's usage response in ~/.claude.json; the credit is
// the `iguana_necktie` bucket there (limit_dollars 250 on Max, resets_at at the
// promotion's expiry). The CLI never names it, so an absent bucket is "unknown".
const CLOUD_CREDIT_BUCKET = "iguana_necktie";

export type CloudCreditState = "available" | "exhausted" | "expired" | "unknown";
export type CloudCredit = {
  state: CloudCreditState;
  limitUsd: number | null;
  usedUsd: number | null;
  remainingUsd: number | null;
  expiresAt: string | null;
  fetchedAt: string | null;
};
export type CloudSessionRecord = {
  sessionId: string;
  url: string;
  title: string | null;
  workspaceId: string;
  repository: string;
  remote: string | null;
  branch: string | null;
  head: string | null;
  upload: "bundle" | "auto";
  task: string;
  createdAt: string;
  paidConfirmed: boolean;
  lastMessageAt: string | null;
};

const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;

export function cloudCreditFromUsageCache(cache: unknown, now = Date.now()): CloudCredit {
  const record = cache && typeof cache === "object" ? cache as any : null;
  const bucket = record?.utilization?.[CLOUD_CREDIT_BUCKET];
  const fetchedAt = finite(record?.fetchedAtMs);
  const limitUsd = finite(bucket?.limit_dollars);
  if (!bucket || limitUsd === null) return { state: "unknown", limitUsd: null, usedUsd: null, remainingUsd: null, expiresAt: null, fetchedAt: fetchedAt === null ? null : new Date(fetchedAt).toISOString() };
  const usedUsd = finite(bucket.used_dollars);
  const remainingUsd = finite(bucket.remaining_dollars) ?? (usedUsd === null ? null : Math.max(0, limitUsd - usedUsd));
  const expiry = typeof bucket.resets_at === "string" ? Date.parse(bucket.resets_at) : NaN;
  const state: CloudCreditState = Number.isFinite(expiry) && expiry <= now ? "expired" : remainingUsd === null ? "unknown" : remainingUsd <= 0 || bucket.locked_reason ? "exhausted" : "available";
  return { state, limitUsd, usedUsd, remainingUsd, expiresAt: Number.isFinite(expiry) ? new Date(expiry).toISOString() : null, fetchedAt: fetchedAt === null ? null : new Date(fetchedAt).toISOString() };
}

// The usage probe drops CLAUDE_CONFIG_DIR, so its cache lands in ~/.claude.json;
// read the config-dir copy too and keep whichever reading is newer.
export function readCloudCredit(home = os.homedir(), configDir = process.env.CLAUDE_CONFIG_DIR): CloudCredit {
  const candidates = [...new Set([path.join(home, ".claude.json"), path.join(configDir || path.join(home, ".claude"), ".claude.json")])];
  let newest: { at: number; cache: unknown } | null = null;
  for (const file of candidates) {
    try {
      const cache = JSON.parse(fs.readFileSync(file, "utf8"))?.cachedUsageUtilization;
      const at = finite(cache?.fetchedAtMs) ?? -1;
      if (cache && (!newest || at > newest.at)) newest = { at, cache };
    } catch { /* a missing or unreadable CLI state file is not an error */ }
  }
  return cloudCreditFromUsageCache(newest?.cache ?? null);
}

export function cloudCreditNeedsConfirmation(credit: CloudCredit) {
  return credit.state !== "available";
}

export class CloudCreditConfirmationRequiredError extends Error {
  readonly statusCode = 402;
  readonly code = "CLOUD_CREDIT_CONFIRMATION_REQUIRED";
  constructor(readonly credit: CloudCredit) {
    super(credit.state === "unknown" ? "The cloud-session credit balance is unknown." : "The cloud-session credit is used up or expired; continuing draws from the subscription.");
  }
}

function run(command: string, args: string[], options: { cwd?: string; timeoutMs: number; env?: NodeJS.ProcessEnv }) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, shell: false, windowsHide: true, env: options.env ?? process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", settled = false;
    const finish = (error?: Error, code: number | null = null) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve({ code, stdout, stderr }); };
    const timer = setTimeout(() => { child.kill("SIGTERM"); finish(new Error(`${path.basename(command)} timed out.`)); }, options.timeoutMs); timer.unref?.();
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => { stdout = `${stdout}${chunk}`.slice(-65_536); });
    child.stderr.on("data", chunk => { stderr = `${stderr}${chunk}`.slice(-4_000); });
    child.once("error", error => finish(error));
    child.once("exit", code => finish(undefined, code));
  });
}

const failure = (message: string, statusCode: number, code: string) => Object.assign(new Error(message), { statusCode, code });

export class ClaudeCloudSessions {
  private readonly file: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: { appRoot: string; dataDir: string; claudeBinary: () => string }) {
    this.file = path.join(options.dataDir, "claude-cloud", "sessions.json");
  }

  list(): CloudSessionRecord[] {
    try {
      const value = JSON.parse(fs.readFileSync(this.file, "utf8"));
      return Array.isArray(value) ? value : [];
    } catch { return []; }
  }

  get(sessionId: string) {
    return this.list().find(item => item.sessionId === sessionId) ?? null;
  }

  private write(items: CloudSessionRecord[]) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(items, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, this.file);
  }

  private update<T>(change: (items: CloudSessionRecord[]) => T) {
    const next = this.queue.then(() => { const items = this.list(); const result = change(items); this.write(items); return result; });
    this.queue = next.catch(() => undefined);
    return next;
  }

  async create(input: { workspaceId: string; repository: string; task: string; bundle: boolean; paidConfirmed: boolean }) {
    const helper = screenHelperCommand(this.options.appRoot, "claude-cloud", [this.options.claudeBinary(), input.repository, input.task, input.bundle ? "bundle" : "auto"]);
    const result = await run(helper.command, helper.args, { cwd: this.options.appRoot, timeoutMs: 330_000, env: { ...process.env, DISABLE_AUTOUPDATER: "1" } });
    let body: any;
    try { body = JSON.parse(result.stdout.trim().split("\n").pop() ?? ""); }
    catch { throw failure(`Cloud session helper failed (${result.code}): ${result.stderr.trim().slice(-400)}`, 502, "CLOUD_SESSION_HELPER_FAILED"); }
    if (!body?.ok) throw failure(String(body?.error ?? "The cloud session was not created."), body?.code === "CLOUD_SESSION_NOT_CREATED" ? 502 : 409, String(body?.code ?? "CLOUD_SESSION_NOT_CREATED"));
    const record: CloudSessionRecord = {
      sessionId: body.sessionId, url: body.url, title: body.title ?? null, workspaceId: input.workspaceId,
      repository: body.repository, remote: body.remote ?? null, branch: body.branch ?? null, head: body.head ?? null,
      upload: input.bundle || !body.remote ? "bundle" : "auto", task: input.task, createdAt: new Date().toISOString(),
      paidConfirmed: input.paidConfirmed, lastMessageAt: null,
    };
    await this.update(items => { items.unshift(record); });
    return record;
  }

  async send(sessionId: string, message: string) {
    const record = this.get(sessionId);
    if (!record) throw failure("Cloud session not found.", 404, "CLOUD_SESSION_NOT_FOUND");
    const env: NodeJS.ProcessEnv = { ...process.env, DISABLE_AUTOUPDATER: "1" };
    delete env.CLAUDE_CONFIG_DIR;
    const result = await run(this.options.claudeBinary(), ["-p", message, "--cloud", sessionId, "--output-format", "json"], { cwd: os.homedir(), timeoutMs: 120_000, env });
    let body: any = null;
    try { body = JSON.parse(result.stdout.trim()); } catch { /* configuration errors print plain text to stderr */ }
    if (!body?.ok) throw failure(String(body?.error ?? (result.stderr.trim() || "The message was not delivered.")).slice(0, 600), 502, "CLOUD_SESSION_SEND_FAILED");
    const at = new Date().toISOString();
    await this.update(items => { const item = items.find(entry => entry.sessionId === sessionId); if (item) item.lastMessageAt = at; });
    return { sessionId, url: record.url, sentAt: at };
  }

  // Cloud sessions push their work to claude/* branches. Report those branches
  // and their pull requests; the conversation itself is only on claude.ai.
  async github(sessionId: string) {
    const record = this.get(sessionId);
    if (!record) throw failure("Cloud session not found.", 404, "CLOUD_SESSION_NOT_FOUND");
    const slug = /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?$/.exec(record.remote ?? "")?.[1];
    if (!slug) return { repository: null, branches: [], pullRequests: [] };
    const branches = await run("gh", ["api", `repos/${slug}/branches?per_page=100`, "--paginate", "--jq", '.[] | select(.name | startswith("claude/")) | .name'], { timeoutMs: 30_000 });
    if (branches.code !== 0) throw failure(branches.stderr.trim().slice(0, 400) || "GitHub branch lookup failed.", 502, "CLOUD_SESSION_GITHUB_FAILED");
    const prs = await run("gh", ["pr", "list", "-R", slug, "--state", "all", "--search", "head:claude/", "--json", "number,state,headRefName,title,url"], { timeoutMs: 30_000 });
    if (prs.code !== 0) throw failure(prs.stderr.trim().slice(0, 400) || "GitHub pull request lookup failed.", 502, "CLOUD_SESSION_GITHUB_FAILED");
    return { repository: slug, branches: branches.stdout.split("\n").map(item => item.trim()).filter(Boolean), pullRequests: JSON.parse(prs.stdout || "[]") };
  }
}
