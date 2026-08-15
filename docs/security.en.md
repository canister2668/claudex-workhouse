# Security

[English](security.en.md) · [한국어](security.ko.md) · [日本語](security.ja.md)

Previous: [Provider authentication](provider-authentication.en.md) · [Guidebook](guide.en.md) · Next: [Deployment and operations →](deployment.en.md)

## Boundaries

- The server binds only `127.0.0.1:3410`; no NAS interface or external port is opened.
- Only fixed `projectId` values are accepted. Paths are resolved server-side and exact-realpath checked at startup and before task creation.
- Provider commands use `spawn(binary, args, { shell: false })`. Workspace file APIs retain their existing realpath, symlink, size, and Git-metadata checks, but do not deny a file merely because its name looks sensitive.
- Request bodies are limited to 64 KiB and prompts to 20,000 characters. Command time/output are bounded.
- Mutations require same Origin, `Sec-Fetch-Site` when present, `X-Claudex-Workhouse-Request: 1`, and a UUID idempotency key.
- Rate limits are 120 requests/minute generally and 6 task creates/minute.
- CSP, `frame-ancestors 'none'`, nosniff, no-referrer, permissions policy, and API `no-store` are enabled.
- The service worker caches only the application shell, never `/api` content, task logs, tokens, or results.
- SSE requires the normal Access identity, an exact allowed Origin, an owned task in an enabled project, and bounded connection limits (8 total, 3 per task). Responses use `no-store`, disable proxy buffering, and never expose the app-server socket.
- Stream spools are sanitized before append, mode 0600 under `data/stream-events` mode 0700, rotate at 8 MiB, and are retained for 24 hours. Structured secret values such as authorization headers, OAuth tokens, API keys, passwords, private keys, JWTs, and environment assignments are replaced with `[REDACTED]`.
- Task result/error/log fields and automatic diagnostic metadata are sanitized before SQLite persistence. Worker state files, audit details, HTTP errors, task/runtime/collaboration SSE, and Desktop Worker event relay use the same sanitizer. Sanitization failure omits the affected value instead of persisting the original.
- Fastify logging redacts Access JWT, cookie, authorization headers and sanitizes request-handler errors before logging. Authentication URLs and one-time login codes remain confined to the dedicated, authenticated login event flow and are not copied into ordinary task events or audit details.
- Agent event metadata must be a JSON object and is limited to 8 KiB after sanitization. Secret-like keys and values, bearer/JWT strings, environment assignments, and private-key blocks are masked before browser delivery. Normal hashes, UUIDs, task/thread IDs, paths, and other identifiers are preserved.
- Automatic handoff patches omit changed files with known secret-like names without failing the handoff. The manifest reports only the excluded count. A file explicitly opened, edited, or downloaded by the user is not blocked or redacted.
- Authenticated settings can register external HTTP MCP endpoints for supported providers. Remote URLs must use HTTPS (HTTP is accepted only for localhost), each entry is assigned an allowlisted read-only role, and the operator must attest that the third-party tools are read-only. Workhouse does not install or inspect third-party server code and cannot technically prevent a server from misrepresenting a write-capable tool. Bearer tokens are stored as secrets and are never loaded back into the form. Grok does not receive this configuration.
- The built-in Emotion MCP accepts requests only from a loopback peer and rejects Cloudflare-proxied requests. Its artwork is immutable, bundled, same-origin content; writable state stays under `data/emotion`.
- Codex model, effort, service tier, and permission profile values are revalidated against the current app-server catalog immediately before worker launch. `:danger-full-access` additionally requires explicit browser confirmation; global Codex configuration is never rewritten.
- Codex stop requires a recorded PID, PGID, process start time, worker marker, and command match, or a linked cx job. External CLI/VS Code threads never receive a stop control merely because a persisted turn looks active.
- Permanent deletion is distinct from stop and archive. It requires a UUID idempotency key, a separate warning dialog with explicit acknowledgement, no active verified worker, and an audit record that excludes transcript content. Deletion does not revert files or Git history.

## Authentication

Production mode verifies `Cf-Access-Jwt-Assertion` using the Access team JWKS, exact issuer, Application AUD, and exact email `admin@example.com`. Missing Team Domain/AUD fails closed with HTTP 503. Browser-supplied email headers are not trusted.

Test authentication requires all of: `authMode=test`, `CLAUDEX_WORKHOUSE_TEST_MODE=1`, a loopback peer, and the exact configured test identity header. Never use test mode in the DSM startup task.

## Single-user provider credential scope

Claudex Workhouse targets a single-user, self-hosted environment. Claude Code, Codex, GitHub CLI, Git credential helpers, and operating-system credential stores are host-scoped, not separated by web identity. Each provider process uses the operating-system user and provider login state of the host on which that process runs; Cloudflare Access and the Claudex browser session authenticate access to Workhouse, not to the provider account.

Claudex Workhouse does not restrict the owner from directly opening or modifying local provider configuration, authentication files, `.env` files, Git credentials, or SSH files. Provider CLI access to `HOME`, `.claude`, and `.codex` is also unchanged. Do not expose one installation to mutually untrusted users: they would share the execution host's provider identity and filesystem authority.

The redaction layer protects automatic copies in provider output, errors, logs, persistence, event delivery, diagnostics, and automatic handoff collection. It is intentionally not applied to file content that the user explicitly opens, edits, or downloads.

## Claude stop safety

Only owned jobs expose stop. Before signaling, Claudex Workhouse compares PID, process start time, process group, worker command, and random command marker. It sends TERM to that process group, waits five seconds, and sends KILL only if the same identity remains.

## ACL

The independent DSM shared folder has explicit full-access ACEs for `admin`, the dedicated service account, and `administrators`; no `everyone` ACE is present. Child files inherit only these ACEs. POSIX mode may display `777` under Synology ACL and is not the authority. See `storage-and-permissions.md`.
