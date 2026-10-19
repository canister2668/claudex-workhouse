# Claudex Workhouse workspace runbook

This is the operational companion to the repository-wide `AGENTS.md`. It
contains execution details that must be checked against the current source
before use. It does not grant permission to commit, push, publish, or modify
external infrastructure.

## Change classification

| Change | Build | Restart | Live verification |
|---|---:|---:|---:|
| Documentation, comments, or tests only | No | No | No |
| Web UI or service TypeScript | Yes | Yes | Yes |
| Runtime-loaded assets or server configuration | Usually | Yes | Yes |
| Database schema or live persisted state | As applicable | Usually | DB checks and affected behavior |
| Packaging or release scripts only | Targeted verification | No | No, unless deployed |

When classification is uncertain, inspect how the changed file reaches
`app/dist`, `app/dist-server`, the live database, or the running process. Do not
restart merely because a task is ending.

## Managed Workspace instructions

The Workspace settings screen can store a versioned instruction profile for
each registered Workspace. Profiles may use managed Markdown, the repository's
`AGENTS.md`, `CLAUDE.md`, and `docs/WORKSPACE_RUNBOOK.md`, or both. A new task
captures the effective text, source hashes, and completion policy as an
immutable session snapshot. Follow-ups, queued messages, recovery, forks,
handoffs, collaborations, and remote Worker execution retain that snapshot;
editing the profile affects new sessions rather than silently changing an
existing one. Explicitly moving a session to another Workspace is the exception:
the next request captures and injects the destination Workspace profile.

The owner may separately allow managed agents to edit only the managed Markdown
through the task-scoped local MCP channel. This permission defaults off. The
agent cannot choose another Workspace or alter activation, sources, completion
policy, or the permission itself. Agent edits are recorded with the source task
and apply to the next task; they never replace the active session snapshot.

Completion policies are agent guidance describing check, test, build, restart,
and direct behavior verification expectations. Workhouse does not execute or
prove those actions merely because a policy is selected. They do not grant
authority to commit, push,
publish, disclose credentials, perform destructive actions, or expand the
current user request. Repository documents on remote Workspaces are read
through bounded, Workspace-scoped Worker file APIs before the snapshot is
created.

## Standard validation before restart

Run from the repository root unless a command says otherwise:

```sh
git status --short
cd app
pnpm check
pnpm test
pnpm build
```

Use targeted tests while iterating. Before declaring a broad runtime change
complete, run the applicable full checks above unless the user narrows the
validation scope. Record failures and distinguish pre-existing failures from
regressions with evidence.

`pnpm build` produces both `app/dist` and `app/dist-server`. Restarting without
rebuilding can serve stale compiled code while health checks still pass.

## Restart gate

Before restart:

1. Confirm the build succeeded and `git status --short` contains no surprising
   changes. Preserve unrelated files; do not clean or discard them.
2. For schema migrations, direct live-database edits, or destructive fixtures,
   create and verify a WAL-consistent SQLite backup using the supported
   snapshot/maintenance path for the current change. Do not copy only the main
   SQLite file while the service is writing.
3. Inspect active work in the authenticated Workhouse task overview. The
   launcher `status` command reports only the supervisor, not active tasks.
4. A provider worker remaining active is expected and is not alone a blocker.
   If another task currently depends on uninterrupted browser/SSE interaction,
   defer the restart or obtain an explicit deployment decision.
5. If the user prohibited restart, or any precondition cannot be established,
   stop and report `restart pending — <reason>`.

## Ordered restart and service verification

From the repository root:

```sh
node bin/claudex-workhouse.mjs status
node bin/claudex-workhouse.mjs restart
node bin/claudex-workhouse.mjs status
node bin/claudex-workhouse.mjs logs
curl -fsS http://127.0.0.1:3410/api/health/live
curl -fsS http://127.0.0.1:3410/api/health/ready
```

Record the supervisor PID before restart and confirm that it changes. Poll the
status and both health endpoints for a bounded stabilization period; a brief
connection refusal during startup is not final failure. Re-check status after
health succeeds and inspect recent logs for startup errors or repeated child
restarts.

Restarting the Workhouse supervisor intentionally leaves provider workers and
their native sessions running. Never add worker termination to this routine.

Liveness and readiness do not prove the requested change works. Exercise the
changed API, UI interaction, persistence path, or recovery flow directly after
restart.

## Browser E2E on the NAS

The NAS host lacks the native Chromium GTK/ATK libraries. Use the pinned Docker
runner from `app/`:

```sh
pnpm test:e2e:docker -- --project=mobile-360
pnpm test:e2e:docker -- --project=mobile-412
pnpm test:e2e:docker -- --project=tablet-800
```

Choose only the viewports and specs relevant to the change unless release
validation requires the complete matrix. By default this command tests the
already-running service at `http://127.0.0.1:3410`; therefore build and restart
must happen before live E2E. Use `CLAUDEX_WORKHOUSE_E2E_BASE_URL` only when the
target is intentionally different.

## Gemini CLI runtime (Vertex Agent backend)

The Gemini provider's `vertex-agent` backend runs the official Gemini CLI from
the Workhouse-managed runtime directory rather than from the system `PATH`:

```sh
node scripts/install-gemini-cli.mjs          # latest
node scripts/install-gemini-cli.mjs 0.55.1   # pinned
node scripts/install-gemini-cli.mjs --check  # report entry, version, ripgrep
```

It installs into `runtime/gemini-cli/` and never touches an OS package manager.
`CLAUDEX_WORKHOUSE_GEMINI_CLI` overrides the location for a non-standard
install. The backend reuses the Vertex project, region, and service-account key
from Gemini execution settings; the CLI's own state lives in
`data/provider-auth/gemini-cli-home/`, kept apart from the Antigravity OAuth
home. Missing `rg` is a performance note, not a blocker: the CLI falls back to
its built-in search tool.

The CLI's legacy resolver rewrites some requested models before calling Vertex.
Its `resolveModel()` runs every candidate through `isFlashModel()`, whose last
clause is `model.endsWith("flash")`, and collapses any match onto the CLI's own
current flash model. Measured on 0.55.1 against Vertex before the Workhouse
runtime setting below was applied:

| Requested | Billed |
|---|---|
| `gemini-3.7-flash`, `gemini-3.6-flash`, `gemini-2.5-flash`, `gemini-3-flash` | `gemini-3.5-flash` |
| `gemini-3.5-flash-lite`, `gemini-3.1-pro-preview`, `gemini-2.5-pro` | unchanged |

Only ids ending in `flash` are affected; the pro and flash-lite families are
honoured. Workhouse enables `experimental.dynamicModelConfiguration` in its
isolated Gemini CLI home so a model id selected from the live Vertex catalog is
treated as a raw id instead of that legacy alias. A direct 0.55.1 Vertex run
confirmed that `gemini-3.8-flash` remained `gemini-3.8-flash` in the CLI's billed
model statistics with this setting. The worker still compares billed and
requested models and reports any future rewrite on the task.

Workhouse removes its earlier `general.maxAttempts=1` override: that setting
also disabled transient HTTP 429 backoff. Network retries now use the native
CLI policy (the installed 0.55.1 default is 10 attempts, subject to model
availability policy overrides). The bundle preload separately prevents
`InvalidStreamError` content retries and retries after any response chunk has
already been emitted. Transport retries before output remain enabled.
Workhouse removes its former `model.compressionThreshold=0.1` override, using
the CLI default (0.5 in 0.55.1) unless another threshold was explicitly set.
Automatic compression may defer retryable quota, network, or server failures
for ten minutes on the current chat only when measured context is below 80%
of the model window. Manual compression, cancellation, permanent errors, and
near-window contexts do not use that deferral. It does not repair an oversized
session or bypass native context-window checks.

Bundled Vertex CLI launches preload `gemini-cli-preload` with Node's `--import`.
It adapts the verified CLI wire-format seam in memory: Gemini 3/4 tool-response
images are nested under the preceding function response, and stripping call-ID
prefixes preserves multimodal fields. Both restored history and fresh results
are adapted just before transmission; native journals and installed CLI files
are untouched. The CLI memory relaunch preserves this preload through
`execArgv`; tool subprocesses do not inherit a `NODE_OPTIONS` override.
An incompatible change to the known upstream seam fails closed and requires
adapter review. Standalone binary overrides do not use this bundle adapter.
The SDK transport boundary preserves original exception identity and cause;
it must not replace a structured network error with a message-only error.
`gemini-cli-policy.ts` is the shared classifier for native network retry,
optional compression deferral, and worker diagnostics. The adapter itself
never retries HTTP calls. A `workhouse_request` event carries only request phase,
HTTP status, duration, and allowlisted failure codes. The worker retains the
last 20 in `requestDiagnostics`, plus a request count and terminal
`failureDetails`. Prompts, response bodies, credentials, URLs, and raw exception
causes must not enter these diagnostic fields. Successful retries do not set a
terminal task failure. A successful CLI result with neither assistant output
nor tool execution is rejected; stderr is never used as an assistant answer.

HTTP 400 model-turn rejection has its own `GEMINI_INVALID_TURN` error code;
a genuine terminal HTTP 429 remains `VERTEX_QUOTA_EXHAUSTED`.

For `vertex-agent`, the Compact action and `/compact`, `/compress`, or
`/summarize` run local maintenance without a model request. Workhouse replays
the native JSONL journal (message replacement, `$set.messages`, and rewinds),
then masks function-response payloads larger than 2,048 characters in messages
older than the last eight. User/assistant prose, call identities and arguments,
and recent messages are retained. This is deterministic tool-output trimming,
not a semantic summary. If no payload qualifies it reports a no-op.

Before writing, the worker verifies a private byte-exact backup alongside the
transcript, checks that the source has not changed, atomically replaces it, and
reads it back. Generation and maintenance share an exclusive per-session lock;
active sessions are rejected. A lock left by a forcibly killed worker fails
closed and requires owner inspection before removal. Do not run an unmanaged
interactive CLI on the same native session concurrently. Compaction emits a
`context_compaction` event and records the backup path. The last API token
reading is invalidated until a new Gemini message has actual token usage.

Context usage comes from the last effective Gemini message's `tokens.input`,
never the invocation's cumulative input counter. Missing/malformed transcripts
produce unknown context usage. Cumulative `result.stats` remains the source
for billable output usage. Structured error-severity events take precedence over
stderr retries when `result.error.message` is empty. Explicit safety blocks,
invalid streams and missing finish reasons have separate classifications; an
empty stream alone does not identify a safety block or quota exhaustion.

The default coding profile exposes question, managed-provider delegation and
workspace-instruction tools through its authenticated MCP channel. Other
profiles do not receive the delegation/instruction allowlist. MCP server-side
ownership, access and workspace-instruction edit checks remain authoritative.

The model catalog itself comes from the live Vertex publisher list, so a model
Google adds to Vertex appears in the picker without a Workhouse change. The CLI
has no self-updater; a new Gemini CLI release is picked up by re-running
`scripts/install-gemini-cli.mjs`.

## Completion report

State each layer separately:

- files changed;
- checks and test counts that actually passed;
- build result;
- restart result and old/new supervisor PID, when performed;
- liveness/readiness results;
- direct verification of the changed behavior;
- whether work is uncommitted, committed, pushed, packaged, or released;
- any `restart pending` or `live verification pending` reason.

Never turn a local build, health response, or untracked package into a claim
that a commit was pushed or a release was published.
