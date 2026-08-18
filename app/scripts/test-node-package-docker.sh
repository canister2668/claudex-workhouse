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
  -v "$script_dir/test-node-package-container.sh:/harness.sh:ro" \
  "$image" \
  /bin/sh /harness.sh
