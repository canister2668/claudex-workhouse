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

The CLI rewrites some requested models before calling Vertex. Its
`resolveModel()` runs every candidate through `isFlashModel()`, whose last
clause is `model.endsWith("flash")`, and collapses any match onto the CLI's own
current flash model. Measured on 0.55.1 against Vertex:

| Requested | Billed |
|---|---|
| `gemini-3.7-flash`, `gemini-3.6-flash`, `gemini-2.5-flash`, `gemini-3-flash` | `gemini-3.5-flash` |
| `gemini-3.5-flash-lite`, `gemini-3.1-pro-preview`, `gemini-2.5-pro` | unchanged |

Only ids ending in `flash` are affected; the pro and flash-lite families are
honoured. Workhouse does not encode that table: the worker compares the model
the CLI actually billed against the requested one and reports the difference on
the task, so a CLI release that changes or removes the collapse needs no change
here. Choose Vertex Direct when a specific flash version matters, or a non-flash
id under Vertex Agent.

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
