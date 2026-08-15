#!/bin/sh
# Claudex Workhouse boot-time starter.
#
# Purpose: bring Claudex Workhouse up safely after a NAS reboot, when the DSM
# Task Scheduler "Boot-up" event may fire before /volume2 is mounted.
#
# Contract (see docs/deployment.md):
#   - Runs as the dedicated service user. Never uses sudo / chmod / chown / synoacltool.
#   - Waits for the Claudex Workhouse install root to be present and writable, with a cap.
#   - Idempotent: if the service already answers /api/health/live it exits 0
#     without starting a second supervisor.
#   - Delegates the actual start to the existing manager
#     (claudex-workhouse.mjs start), which handles stale PID files and duplicate
#     supervisors on its own.
#   - Waits (bounded) for /api/health/live == 200 before reporting success.
#   - Only ever starts Claudex Workhouse. It never signals cx brokers/workers or
#     Claude sessions.
#   - Logs to logs/claudex-workhouse-boot.log with the same 10 MiB x4 rotation
#     policy the supervisor uses. No secrets are written.
#
# Exit codes:
#   0  running and healthy (started now, or already healthy)
#   10 volume / install root never became ready
#   11 claudex-workhouse.mjs start failed
#   12 started but /api/health/live never returned 200

set -u

# --- Environment (explicit; do not inherit an odd boot PATH) ---------------
# Resolve the service user's home from /etc/passwd directly: getent is absent
# on this NAS, and the old fallback (/var/lib/claudex-workhouse) does not exist
# and is not writable by the service user, which broke $HOME/.codex for codex.
_home="$(awk -F: -v u="$(id -un)" '$1==u {print $6; exit}' /etc/passwd 2>/dev/null)"
HOME="${HOME:-${_home:-/var/lib/claudex-workhouse}}"
export HOME
PATH="/usr/local/bin:/usr/bin:/bin"
export PATH

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT="${CLAUDEX_WORKHOUSE_ROOT:-$(dirname -- "$SCRIPT_DIR")}"
export CLAUDEX_WORKHOUSE_ROOT="$ROOT"

MANAGER="$ROOT/bin/claudex-workhouse.mjs"
PIDFILE="$ROOT/run/supervisor.pid"
LOG_DIR="$ROOT/logs"
LOG_FILE="$LOG_DIR/claudex-workhouse-boot.log"

HEALTH_URL="${CLAUDEX_WORKHOUSE_HEALTH_URL:-http://127.0.0.1:3410/api/health/live}"

# Readiness target: the file whose existence proves the install root is
# mounted and readable. Overridable for testing the wait loop only.
READY_TARGET="${CLAUDEX_WORKHOUSE_BOOT_READY_TARGET:-$MANAGER}"

# Tunables (bounded; no infinite fast retry).
VOL_WAIT_MAX="${CLAUDEX_WORKHOUSE_BOOT_VOL_WAIT_MAX:-120}"   # seconds
VOL_WAIT_STEP="${CLAUDEX_WORKHOUSE_BOOT_VOL_WAIT_STEP:-3}"   # seconds
HEALTH_WAIT_MAX="${CLAUDEX_WORKHOUSE_BOOT_HEALTH_WAIT_MAX:-60}"  # seconds
HEALTH_WAIT_STEP="${CLAUDEX_WORKHOUSE_BOOT_HEALTH_WAIT_STEP:-2}" # seconds

NODE_BIN="${CLAUDEX_WORKHOUSE_NODE_BIN:-/usr/local/bin/node}"

# --- Logging (size-based rotation, mirrors supervisor.js) ------------------
rotate_log() {
  # 10 MiB threshold, keep .1 .. .4
  [ -f "$LOG_FILE" ] || return 0
  size=$(wc -c < "$LOG_FILE" 2>/dev/null || echo 0)
  [ "${size:-0}" -lt 10485760 ] && return 0
  i=4
  while [ "$i" -ge 1 ]; do
    if [ "$i" -eq 1 ]; then src="$LOG_FILE"; else src="$LOG_FILE.$((i-1))"; fi
    [ -e "$src" ] && mv -f "$src" "$LOG_FILE.$i"
    i=$((i-1))
  done
}

log() {
  # Best effort: if the log dir is not writable yet we still emit to stdout,
  # which DSM captures in the task result.
  msg="[$(date '+%Y-%m-%dT%H:%M:%S%z')] $*"
  echo "$msg"
  if mkdir -p "$LOG_DIR" 2>/dev/null && [ -w "$LOG_DIR" ]; then
    rotate_log
    { echo "$msg" >> "$LOG_FILE"; } 2>/dev/null || true
  fi
}

health_code() {
  # Prints the HTTP status, or 000 on connection failure.
  code=$(curl -s -o /dev/null -m 5 -w '%{http_code}' "$HEALTH_URL" 2>/dev/null)
  echo "${code:-000}"
}

log "boot-start begin user=$(id -un 2>/dev/null || echo '?') HOME=$HOME PATH=$PATH root=$ROOT"

# --- 1. Wait for the install root to be mounted and writable ---------------
waited=0
while :; do
  if [ -e "$READY_TARGET" ] && [ -d "$ROOT" ] && [ -w "$ROOT" ]; then
    log "volume ready after ${waited}s (target=$READY_TARGET)"
    break
  fi
  if [ "$waited" -ge "$VOL_WAIT_MAX" ]; then
    log "ERROR volume not ready after ${VOL_WAIT_MAX}s (target=$READY_TARGET, root_writable=$([ -w "$ROOT" ] && echo yes || echo no))"
    exit 10
  fi
  log "waiting for volume... ${waited}/${VOL_WAIT_MAX}s"
  sleep "$VOL_WAIT_STEP"
  waited=$((waited + VOL_WAIT_STEP))
done

# --- 2. Already healthy? then do nothing (idempotent) ----------------------
code=$(health_code)
if [ "$code" = "200" ]; then
  sup=$(cat "$PIDFILE" 2>/dev/null || echo '?')
  log "already healthy (health=200 supervisor=$sup); nothing to do"
  log "boot-start done ok"
  exit 0
fi
log "pre-start health=$code (not yet serving)"

# --- 3. Start via the existing manager (handles stale PID + dup guard) ------
if [ ! -e "$NODE_BIN" ]; then
  # Fall back to PATH lookup if the pinned node path is absent.
  NODE_BIN="node"
fi
log "starting: $NODE_BIN $MANAGER start"
start_out=$("$NODE_BIN" "$MANAGER" start 2>&1)
start_rc=$?
log "manager start rc=$start_rc out=$start_out"
if [ "$start_rc" -ne 0 ]; then
  log "ERROR claudex-workhouse.mjs start failed (rc=$start_rc)"
  exit 11
fi

# --- 4. Wait (bounded) for the web server to actually answer ---------------
waited=0
while :; do
  code=$(health_code)
  if [ "$code" = "200" ]; then
    sup=$(cat "$PIDFILE" 2>/dev/null || echo '?')
    fas=$(ps -ef 2>/dev/null | grep 'dist-server/index.js' | grep -v grep | awk '{print $2}' | tr '\n' ',' | sed 's/,$//')
    log "healthy after ${waited}s health=200 supervisor=$sup fastify=${fas:-?}"
    log "boot-start done ok"
    exit 0
  fi
  if [ "$waited" -ge "$HEALTH_WAIT_MAX" ]; then
    sup=$(cat "$PIDFILE" 2>/dev/null || echo '?')
    log "ERROR health not 200 after ${HEALTH_WAIT_MAX}s (last=$code supervisor=$sup)"
    exit 12
  fi
  sleep "$HEALTH_WAIT_STEP"
  waited=$((waited + HEALTH_WAIT_STEP))
done
