# Rollback

## Codex standalone runtime

The previous root-owned npm installation remains available at
`/usr/local/bin/codex`. On Windows, Claudex Workhouse selects an actual release
file under `runtime/codex-home/packages/standalone/releases` through
`runtime/codex-runtime.json`; it does not use a `current` or visible-bin
junction. Retained Windows releases are rollback material, but selecting one
requires writing a matching version, target, binary path, and verified package
SHA-256 to the state file. Do not point it at an arbitrary executable.

On Linux/NAS, select an exact retained standalone version by rerunning the
official installer:

```sh
CODEX_RELEASE=0.144.3 CODEX_NON_INTERACTIVE=1 \
CODEX_HOME=$CLAUDEX_WORKHOUSE_ROOT/runtime/codex-home \
CODEX_INSTALL_DIR=$CLAUDEX_WORKHOUSE_ROOT/runtime/codex-bin \
PATH=$CLAUDEX_WORKHOUSE_ROOT/runtime/codex-bin:/usr/local/bin:/usr/bin:/bin \
sh /tmp/codex-install.sh
node $CLAUDEX_WORKHOUSE_ROOT/bin/claudex-workhouse.mjs restart
```

Download `/tmp/codex-install.sh` from `https://chatgpt.com/codex/install.sh`
immediately before use. Removing `runtime/codex-bin/codex` makes Claudex Workhouse fall back
to `/usr/local/bin/codex` on its next restart.

## Claude Code runtime

Restore the newest managed binary backup, or name a file listed in
`backups/claude-runtime`:

```sh
node $CLAUDEX_WORKHOUSE_ROOT/bin/claude-runtime.mjs rollback
node $CLAUDEX_WORKHOUSE_ROOT/bin/claude-runtime.mjs status
node $CLAUDEX_WORKHOUSE_ROOT/bin/claudex-workhouse.mjs restart
```

The rollback command first backs up the current binary, validates the selected
backup by executing `--version`, and atomically replaces `runtime/claude-bin/claude`.
To return to an official channel release later, run
`node $CLAUDEX_WORKHOUSE_ROOT/bin/claude-runtime.mjs update latest`.

## Codex full-session management rollback

Pre-change backup: `$CLAUDEX_WORKHOUSE_ROOT/backups/20260711-144127-codex-full-session-management`.

Full rollback:

```sh
node $CLAUDEX_WORKHOUSE_ROOT/bin/claudex-workhouse.mjs stop
BK=$CLAUDEX_WORKHOUSE_ROOT/backups/20260711-144127-codex-full-session-management
rm -rf $CLAUDEX_WORKHOUSE_ROOT/app $CLAUDEX_WORKHOUSE_ROOT/config $CLAUDEX_WORKHOUSE_ROOT/docs
cp -a "$BK/files/app" $CLAUDEX_WORKHOUSE_ROOT/app
cp -a "$BK/files/config" $CLAUDEX_WORKHOUSE_ROOT/config
cp -a "$BK/files/docs" $CLAUDEX_WORKHOUSE_ROOT/docs
cp -a "$BK/files/README.md" $CLAUDEX_WORKHOUSE_ROOT/README.md
cp -p "$BK/claudex-workhouse.sqlite" $CLAUDEX_WORKHOUSE_ROOT/data/claudex-workhouse.sqlite
rm -f $CLAUDEX_WORKHOUSE_ROOT/data/claudex-workhouse.sqlite-wal $CLAUDEX_WORKHOUSE_ROOT/data/claudex-workhouse.sqlite-shm
node $CLAUDEX_WORKHOUSE_ROOT/bin/claudex-workhouse.mjs start
```

Verify the backup before restore with `sha256sum -c "$BK/SHA256SUMS"`. The backup DB passed `PRAGMA integrity_check` and an independent copy/open test. Restoring it is the down migration; native Codex and Claude storage is unaffected.

Canonical pre-change backup:

```text
$HOME/.local/share/codex-mobile/backups/20260711-120455-claudex-workhouse
```

A protected copy is at `$CLAUDEX_WORKHOUSE_ROOT/backups/20260711-120455-claudex-workhouse`.

## Claudex Workhouse only

```sh
node $CLAUDEX_WORKHOUSE_ROOT/bin/claudex-workhouse.mjs stop
```

Remove the DSM boot task, then remove the Cloudflare Tunnel hostname and Access application if they were later created. Archive or remove `$CLAUDEX_WORKHOUSE_ROOT` only after deciding whether to retain `data/claudex-workhouse.sqlite`, logs, and audit history. Removing Claudex Workhouse does not remove `/usr/local/bin/cx` or Claude Code.

## cx JSON change only

```sh
cp -p $HOME/.local/share/codex-mobile/backups/20260711-120455-claudex-workhouse/files$HOME/.local/share/codex-mobile/cx.mjs \
  $HOME/.local/share/codex-mobile/cx.mjs
cx doctor
```

This restores the pre-Claudex-Workhouse human-only output while leaving the independent runtime and CLI version intact.

## cx README only

```sh
cp -p $HOME/.local/share/codex-mobile/backups/20260711-120455-claudex-workhouse/files$HOME/.local/share/codex-mobile/README.md \
  $HOME/.local/share/codex-mobile/README.md
```

## Configuration or source

New Claudex Workhouse files had no predecessor. Restore an individual future backup over the corresponding file, run `pnpm check && pnpm test && pnpm build`, and restart. Do not restore the old `/srv/legacy/claudex-workhouse` path; it was rejected for inherited ACL exposure and was never used.

## Auto-start (boot wrapper + DSM task) rollback

The reboot auto-start change added the boot wrapper `bin/boot-start.sh` and updated docs.
Pre-change copies are in `backups/20260711-140319-autostart-fix/`.

Remove auto-start entirely:

```sh
# 1. Delete the DSM boot task: Control Panel > Task Scheduler > "Claudex Workhouse Startup" > Delete
# 2. Remove the boot wrapper (claudex-workhouse.mjs is unchanged and keeps working):
rm -f $CLAUDEX_WORKHOUSE_ROOT/bin/boot-start.sh
```

Restore the docs to their pre-change text:

```sh
BK=$CLAUDEX_WORKHOUSE_ROOT/backups/20260711-140319-autostart-fix
cp -p "$BK/docs/deployment.md"        $CLAUDEX_WORKHOUSE_ROOT/docs/deployment.en.md
cp -p "$BK/docs/known-limitations.md" $CLAUDEX_WORKHOUSE_ROOT/docs/known-limitations.en.md
cp -p "$BK/docs/rollback.md"          $CLAUDEX_WORKHOUSE_ROOT/docs/rollback.md
cp -p "$BK/README.md"                 $CLAUDEX_WORKHOUSE_ROOT/README.md
```

`bin/claudex-workhouse.mjs` was not modified by this change, but a copy is kept at
`$BK/bin/claudex-workhouse.mjs` for completeness.

## Full rollback verification

```sh
test ! -e $CLAUDEX_WORKHOUSE_ROOT/run/supervisor.pid
cx doctor
claude --version
netstat -lnt 2>/dev/null | grep ':3410' && echo 'unexpected listener' || true
```
