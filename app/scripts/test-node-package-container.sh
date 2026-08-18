#!/bin/sh
# Runs inside the container started by test-node-package-docker.sh.
#
# Kept in its own file rather than inline: the checks need JSON handling, and
# nesting that inside a `docker run sh -c '...'` argument turns every quote into
# an escaping puzzle that has already broken this script once.
set -eu

base="http://127.0.0.1:$CLAUDEX_WORKHOUSE_PORT"

apt-get update >/dev/null 2>&1
apt-get install -y --no-install-recommends curl python3 >/dev/null 2>&1
mkdir -p /data

echo "installing $CLAUDEX_WORKHOUSE_TARBALL"
if ! npm install -g --no-fund --no-audit "$CLAUDEX_WORKHOUSE_TARBALL" >/tmp/install.log 2>&1; then
  tail -40 /tmp/install.log >&2
  echo "FAIL: npm install -g did not succeed" >&2
  exit 1
fi

if ! command -v claudex-workhouse >/dev/null 2>&1; then
  echo "FAIL: the package did not provide the claudex-workhouse command" >&2
  exit 1
fi

if ! claudex-workhouse start >/tmp/start.log 2>&1; then
  tail -40 /tmp/start.log >&2
  echo "FAIL: claudex-workhouse start did not succeed" >&2
  exit 1
fi

ready=""
attempt=0
while [ "$attempt" -lt 90 ]; do
  if curl -fsS "$base/api/health/ready" >/dev/null 2>&1; then
    ready=yes
    break
  fi
  attempt=$((attempt + 1))
  sleep 1
done
if [ -z "$ready" ]; then
  tail -40 /data/logs/claudex-workhouse.log 2>/dev/null >&2 || true
  echo "FAIL: the server never became ready" >&2
  exit 1
fi

# A fresh install answers 428 on the management API until the one-time owner
# claim is done. The raw payload is loopback-only, which is where this runs.
if ! curl -fsS "$base/api/bootstrap/owner-claim/local" -o /tmp/claim-payload.json; then
  echo "FAIL: the owner claim payload is unreachable" >&2
  exit 1
fi
python3 - <<'PY' || exit 1
import json
# The claim fields travel in the qr object the pairing screen encodes.
value = (json.load(open("/tmp/claim-payload.json")) or {}).get("qr") or {}
fields = ("enrollmentId", "claimToken", "serverFingerprint")
missing = [name for name in fields if not value.get(name)]
if missing:
    raise SystemExit(f"FAIL: owner claim payload lacks {missing}")
json.dump({name: value[name] for name in fields}, open("/tmp/claim.json", "w"))
PY
# A state-changing request without an Origin is rejected as cross-site, and the
# launcher configures the external origin as this very loopback URL.
if ! curl -sS -X POST -H "Content-Type: application/json" -H "Origin: $base" -H "X-Claudex-Workhouse-Request: 1" --data @/tmp/claim.json \
  -c /tmp/owner.jar -o /tmp/claim-result.json -w "%{http_code}" \
  "$base/api/bootstrap/owner-claim/complete" > /tmp/claim-code; then
  echo "FAIL: the owner claim request failed" >&2
  exit 1
fi
if [ "$(cat /tmp/claim-code)" != "200" ]; then
  echo "FAIL: the owner claim did not complete (HTTP $(cat /tmp/claim-code))" >&2
  head -c 400 /tmp/claim-result.json >&2; echo >&2
  exit 1
fi

if ! curl -fsS -b /tmp/owner.jar "$base/api/application-updates" -o /tmp/status.json; then
  echo "FAIL: the application update status is unreachable" >&2
  exit 1
fi
python3 - <<'PY'
import json, os
value = json.load(open("/tmp/status.json"))
current = value.get("current") or {}
method, version = current.get("installMethod"), current.get("version")
expected = os.environ["CLAUDEX_WORKHOUSE_EXPECTED_VERSION"]
print(f"installMethod={method} version={version} state={value.get('state')} reason={value.get('reason')}")
problems = []
if method != "node-package":
    problems.append(f"installMethod is {method}, expected node-package")
if version != expected:
    problems.append(f"version is {version}, expected {expected}")
if problems:
    raise SystemExit("\n".join(f"FAIL: {item}" for item in problems))
print("OK: the global npm install reports itself as a node-package install")
PY
