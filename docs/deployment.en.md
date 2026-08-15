# Deployment

[English](deployment.en.md) · [한국어](deployment.ko.md) · [日本語](deployment.ja.md)

Previous: [Security](security.en.md) · [Guidebook](guide.en.md) · Next: [Testing →](testing.en.md)

## Build

```sh
cd $CLAUDEX_WORKHOUSE_ROOT/app
pnpm install
pnpm check && pnpm test && pnpm build
node $CLAUDEX_WORKHOUSE_ROOT/bin/claudex-workhouse.mjs restart
```

On the first `start`, Claudex Workhouse installs missing Claude Code and Codex runtimes
from their official distribution endpoints. Existing managed binaries are left
untouched. Set `CLAUDEX_WORKHOUSE_SKIP_RUNTIME_BOOTSTRAP=1` only when an external
provisioner owns both runtimes, or provide explicit `CLAUDEX_WORKHOUSE_CLAUDE_BIN` and
`CLAUDEX_WORKHOUSE_CODEX_BIN` executable paths.

Do not set test-authentication environment variables for production. Until Access values are configured, the loopback service runs fail-closed: `/api/health/live` works, protected API calls return setup-required.

## Auto-start after a NAS reboot

Cloudflare Tunnel routes `claudex-workhouse.example.com` to `http://127.0.0.1:3410`. If nothing
starts Claudex Workhouse after a reboot, that loopback port has no listener, `cloudflared`
gets connection-refused, and the external URL returns **HTTP 502 Bad Gateway**. A DSM
boot task is therefore required.

### Boot wrapper

Boot the service through the wrapper, not the raw manager:

```text
$CLAUDEX_WORKHOUSE_ROOT/bin/boot-start.sh
```

The wrapper runs as the dedicated DSM service account, without sudo/chmod/chown/synoacltool:

- sets `HOME=$HOME` and `PATH=/usr/local/bin:/usr/bin:/bin`;
- waits (default 120 s, 3 s poll) for `$CLAUDEX_WORKHOUSE_ROOT` to be mounted and writable,
  so a Boot-up event that fires before `/volume2` is ready retries safely instead of
  failing;
- is idempotent: if `/api/health/live` already returns 200 it exits 0 without starting
  a second supervisor;
- delegates the start to `claudex-workhouse.mjs start`, which cleans stale PID files and never
  creates a duplicate supervisor;
- then waits (default 60 s) for `/api/health/live` == 200 before reporting success;
- only ever starts Claudex Workhouse — it never signals `cx` brokers/workers or Claude
  sessions;
- logs to `logs/claudex-workhouse-boot.log` (same 10 MiB × 4 rotation as the supervisor).

Exit codes: `0` healthy, `10` volume never ready, `11` `claudex-workhouse.mjs start` failed,
`12` started but health never reached 200.

### DSM Task Scheduler (manual, administrator)

`esynoscheduler.db` is root-owned, so this one step must be done by hand in the DSM UI.
Do not edit DSM internal scheduler files and do not create a root task.

Control Panel > Task Scheduler > **Create > Triggered Task > User-defined script**:

- Task name: `Claudex Workhouse Startup`
- User: the dedicated DSM service account that owns the application files
- Event: `Boot-up`
- Run command: `$CLAUDEX_WORKHOUSE_ROOT/bin/boot-start.sh`

Fallback if the wrapper is not used (no volume-wait, no health-gate):
`/usr/local/bin/node $CLAUDEX_WORKHOUSE_ROOT/bin/claudex-workhouse.mjs start`

After creating it, select the task and **Run** it once, then verify:

```sh
node $CLAUDEX_WORKHOUSE_ROOT/bin/claudex-workhouse.mjs status      # running supervisor=… bind=127.0.0.1:3410
curl -sS http://127.0.0.1:3410/api/health/live          # {"ok":true,"status":"live"}
```

To remove auto-start later, delete the `Claudex Workhouse Startup` task in Task Scheduler.

## Logs and health

```sh
node $CLAUDEX_WORKHOUSE_ROOT/bin/claudex-workhouse.mjs status
node $CLAUDEX_WORKHOUSE_ROOT/bin/claudex-workhouse.mjs logs
curl -sS http://127.0.0.1:3410/api/health/live
```

The full protected `/api/health` additionally checks SQLite, Codex, Claude, and whether Access values are configured.

## Updating

Back up changed source/config first, build to completion, then restart only Claudex Workhouse. A failed web process is restarted automatically. Neither normal restart nor stop targets `cx` or Claude worker process groups.

### Claudex Workhouse application updates

Global Settings > System shows **Claudex Workhouse updates** separately from
Provider runtime updates. Only an owner-confirmed signed stable release can be
applied. Active tasks, collaborations, or maintenance block the update; a
verified SQLite/config snapshot is created before any payload changes.

Docker/NAS installations use the host-side updater without mounting the Docker
socket in the app container. Windows portable installations use an
out-of-process updater and retain the previous payload for rollback. The
Windows launcher is currently Authenticode unsigned: trust comes from the
signed release manifest, exact SHA-256, GitHub artifact attestation, and the
published Defender result. Source checkouts are not auto-updated.

See [release verification](release/verification.md) and
[key rotation](release/key-rotation.md).

### Managed Claude Code runtime

Claudex Workhouse runs `runtime/claude-bin/claude` and does not search a VS Code extension directory.
Manage that binary with the official Anthropic release manifest wrapper:

```sh
node $CLAUDEX_WORKHOUSE_ROOT/bin/claude-runtime.mjs status
node $CLAUDEX_WORKHOUSE_ROOT/bin/claude-runtime.mjs check latest
node $CLAUDEX_WORKHOUSE_ROOT/bin/claude-runtime.mjs update latest
```

`update` downloads only from `downloads.claude.ai`, checks the manifest version,
artifact size, SHA-256, and executable version, then atomically replaces the runtime.
The previous executable is retained in `backups/claude-runtime` (four newest copies).
Claudex Workhouse disables Claude's internal auto-updater for its managed worker processes so
an update cannot bypass these checks and backups. Restart Claudex Workhouse after a runtime
update when no Claude task is actively starting.

### Managed Codex runtime and UI updates

Claudex Workhouse uses the root-owned npm fallback at `/usr/local/bin/codex` and an independent official standalone runtime. On Windows and Linux/NAS it executes the regular file at `runtime/codex-home/packages/standalone/releases/<version>-<target>/bin/codex[.exe]`; neither `current` nor a visible-bin symlink/junction is used as the execution path. The hash-bound `runtime/codex-runtime.json` selects the active release, independent of the DSM user package cache. Codex authentication and native session history remain normal Provider user identity/state rather than Workhouse deployment files.

Global Settings > Runtime checks both Providers for updates. On every supported OS, Codex verifies the OpenAI release metadata and `codex-package_SHA256SUMS`, requires both package digests to agree, extracts into a versioned directory, and atomically switches the state file. Existing Workers are not signalled; newly started Codex app-servers use the selected binary.

Avatar state is driven by the managed Claude/Codex workers from provider stream
events. Deployment does not add lifecycle hooks or Workhouse paths to
`~/.claude/settings.json`, `~/.codex/hooks.json`, or project configuration.

The usage popover asks Claude Code's official `/usage` command through an
isolated safe-mode pseudo-terminal. Claudex Workhouse does not read Claude credential
files or call Anthropic's undocumented consumer OAuth endpoints. The probe uses
Python 3's standard library and returns only parsed plan percentages and Claude's
reset labels; terminal/account text is discarded.
