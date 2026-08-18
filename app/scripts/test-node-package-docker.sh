#!/bin/sh
# Runs the published Node package the way an operator installs it, so the
# node-package install method is exercised against a real global install
# instead of being asserted from a unit test's fixture.
#
# The NAS host is itself a source checkout, so nothing here can be observed
# without a container: `npm install -g` would replace a package this host does
# not have, and the install method would still resolve to source-checkout.
#
# Usage:
#   sh app/scripts/test-node-package-docker.sh <tarball>
#
# Build the tarball first — it is assembled from a scrub tree, never from the
# private tree directly:
#   node scripts/public-release/build-node-package.mjs --output <directory>
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(dirname -- "$script_dir")
image=${CLAUDEX_WORKHOUSE_NODE_PACKAGE_IMAGE:-"node:22-bookworm-slim"}
port=${CLAUDEX_WORKHOUSE_NODE_PACKAGE_PORT:-3411}

tarball=${1:-}
if [ -z "$tarball" ]; then
  echo "Usage: sh app/scripts/test-node-package-docker.sh <tarball>" >&2
  exit 2
fi
if [ ! -f "$tarball" ]; then
  echo "Node package tarball not found: $tarball" >&2
  exit 2
fi
if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required to run the Node package harness on this host." >&2
  exit 1
fi

tarball_dir=$(CDPATH= cd -- "$(dirname -- "$tarball")" && pwd)
tarball_name=$(basename -- "$tarball")
expected_version=$(node -p "require('$app_dir/package.json').version")

# The container is disposable and binds inside its own network namespace, so a
# harness run cannot collide with the service already running on this host.
docker run --rm --init \
  -e CLAUDEX_WORKHOUSE_DATA_ROOT=/data \
  -e CLAUDEX_WORKHOUSE_PORT="$port" \
  -e CLAUDEX_WORKHOUSE_EXPECTED_VERSION="$expected_version" \
  -e CLAUDEX_WORKHOUSE_TARBALL="/pkg/$tarball_name" \
  -v "$tarball_dir:/pkg:ro" \
  "$image" \
  /bin/sh -eu -c '
    apt-get update >/dev/null 2>&1
    apt-get install -y --no-install-recommends curl python3 >/dev/null 2>&1
    mkdir -p /data

    echo "installing $CLAUDEX_WORKHOUSE_TARBALL"
    npm install -g --no-fund --no-audit "$CLAUDEX_WORKHOUSE_TARBALL" >/tmp/install.log 2>&1 || {
      tail -40 /tmp/install.log >&2
      echo "FAIL: npm install -g did not succeed" >&2
      exit 1
    }

    command -v claudex-workhouse >/dev/null 2>&1 || {
      echo "FAIL: the package did not provide the claudex-workhouse command" >&2
      exit 1
    }

    claudex-workhouse start >/tmp/start.log 2>&1 || {
      tail -40 /tmp/start.log >&2
      echo "FAIL: claudex-workhouse start did not succeed" >&2
      exit 1
    }

    ready=""
    i=0
    while [ "$i" -lt 90 ]; do
      if curl -fsS "http://127.0.0.1:$CLAUDEX_WORKHOUSE_PORT/api/health/ready" >/dev/null 2>&1; then
        ready=yes
        break
      fi
      i=$((i + 1))
      sleep 1
    done
    [ -n "$ready" ] || {
      tail -40 /data/logs/claudex-workhouse.log 2>/dev/null >&2 || true
      echo "FAIL: the server never became ready" >&2
      exit 1
    }

    status=$(curl -fsS "http://127.0.0.1:$CLAUDEX_WORKHOUSE_PORT/api/application-updates") || {
      echo "FAIL: the application update status is unreachable" >&2
      exit 1
    }
    printf "%s" "$status" | python3 -c "
import json,os,sys
value=json.load(sys.stdin)
current=value.get(\"current\") or {}
method=current.get(\"installMethod\")
version=current.get(\"version\")
expected=os.environ[\"CLAUDEX_WORKHOUSE_EXPECTED_VERSION\"]
print(f\"installMethod={method} version={version} state={value.get(\x27state\x27)} reason={value.get(\x27reason\x27)}\")
problems=[]
if method!=\"node-package\": problems.append(f\"installMethod is {method}, expected node-package\")
if version!=expected: problems.append(f\"version is {version}, expected {expected}\")
if problems:
    for item in problems: print(\"FAIL:\",item,file=sys.stderr)
    sys.exit(1)
print(\"OK: the global npm install reports itself as a node-package install\")
"
  '
