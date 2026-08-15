#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir=$(dirname -- "$script_dir")
playwright_version="1.61.1"
playwright_image=${CLAUDEX_WORKHOUSE_PLAYWRIGHT_IMAGE:-"mcr.microsoft.com/playwright:v${playwright_version}-noble"}
base_url=${CLAUDEX_WORKHOUSE_E2E_BASE_URL:-"http://127.0.0.1:3410"}

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required to run Playwright E2E tests on this host." >&2
  exit 1
fi

if [ ! -x "$app_dir/node_modules/.bin/playwright" ]; then
  echo "Playwright is not installed. Run pnpm install in $app_dir first." >&2
  exit 1
fi

prepare_output_dir() {
  output_dir=$1
  if [ -L "$output_dir" ]; then
    echo "Refusing to clean symlinked E2E output directory: $output_dir" >&2
    exit 1
  fi

  mkdir -p "$output_dir"
  find "$output_dir" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
}

# Remove artifacts from the previous run before starting. Artifacts produced by
# this run remain available for debugging, including when Playwright fails.
prepare_output_dir "$app_dir/test-results"
prepare_output_dir "$app_dir/playwright-report"

docker run --rm --init --network host --ipc host \
  -e HOME=/tmp \
  -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  -e CLAUDEX_WORKHOUSE_E2E_BASE_URL="$base_url" \
  -e CLAUDEX_CAPTURE_README="${CLAUDEX_CAPTURE_README:-}" \
  -e CLAUDEX_CAPTURE_LOCALE="${CLAUDEX_CAPTURE_LOCALE:-}" \
  -e CLAUDEX_CAPTURE_INSTALLER="${CLAUDEX_CAPTURE_INSTALLER:-}" \
  -e CLAUDEX_CAPTURE_EXTERNAL_ACCESS="${CLAUDEX_CAPTURE_EXTERNAL_ACCESS:-}" \
  -e CLAUDEX_WORKHOUSE_EXPECTED_PLAYWRIGHT_VERSION="$playwright_version" \
  -e CLAUDEX_WORKHOUSE_HOST_UID="$(id -u)" \
  -e CLAUDEX_WORKHOUSE_HOST_GID="$(id -g)" \
  -v "$app_dir:/work" \
  -v "$app_dir/../docs:/docs" \
  -v "$app_dir/../installer-web:/installer-web:ro" \
  -w /work \
  "$playwright_image" \
  /bin/bash -lc '
    actual_version=$(node -p "require(\"./node_modules/@playwright/test/package.json\").version")
    if [ "$actual_version" != "$CLAUDEX_WORKHOUSE_EXPECTED_PLAYWRIGHT_VERSION" ]; then
      echo "Playwright version mismatch: project=$actual_version image=$CLAUDEX_WORKHOUSE_EXPECTED_PLAYWRIGHT_VERSION" >&2
      exit 1
    fi

    status=0
    node_modules/.bin/playwright test "$@" || status=$?
    chown -R "$CLAUDEX_WORKHOUSE_HOST_UID:$CLAUDEX_WORKHOUSE_HOST_GID" test-results playwright-report 2>/dev/null || true
    exit "$status"
  ' claudex-workhouse-playwright "$@"
