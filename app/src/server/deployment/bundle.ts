import crypto from "node:crypto";
import {
  DeploymentValidationError,
  type DeploymentArtifact,
  type DeploymentBundle,
  type DeploymentPlan,
  type TrustedReleaseMetadata
} from "./types.js";
import {
  validateDeploymentPlan,
  validateServerOrigin,
  validateTrustedReleaseMetadata
} from "./validation.js";

export interface MainServerBundleOptions {
  readonly release?: TrustedReleaseMetadata;
  readonly serverOrigin: string;
}

function sha256(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

function artifact(
  path: DeploymentArtifact["path"],
  mediaType: DeploymentArtifact["mediaType"],
  mode: DeploymentArtifact["mode"],
  content: string
): DeploymentArtifact {
  const normalized = content.endsWith("\n") ? content : `${content}\n`;
  return Object.freeze({ path, mediaType, mode, sha256: sha256(normalized), content: normalized });
}

function renderCompose(plan: DeploymentPlan, imageReference: string): string {
  const bindAddress = plan.publicAccess === "local-only" ? "0.0.0.0" : "127.0.0.1";
  return `name: claudex-workhouse
services:
  claudex-workhouse:
    image: "\${CLAUDEX_WORKHOUSE_IMAGE_REFERENCE:-${imageReference}}"
    restart: unless-stopped
    user: "10001:10001"
    ports:
      - "\${CLAUDEX_WORKHOUSE_BIND_ADDRESS:-${bindAddress}}:\${CLAUDEX_WORKHOUSE_PORT}:3410"
    environment:
      CLAUDEX_WORKHOUSE_ROOT: /opt/claudex-workhouse
      HOME: /opt/claudex-workhouse/runtime/home
      CLAUDEX_WORKHOUSE_HOST: 0.0.0.0
      CLAUDEX_WORKHOUSE_PORT: 3410
      CLAUDEX_WORKHOUSE_EXTERNAL_ORIGIN: "\${CLAUDEX_WORKHOUSE_EXTERNAL_ORIGIN}"
      CLAUDEX_WORKHOUSE_BOOTSTRAP_ORIGIN: "\${CLAUDEX_WORKHOUSE_EXTERNAL_ORIGIN}"
      CLAUDEX_WORKHOUSE_VERSION: "\${CLAUDEX_WORKHOUSE_VERSION}"
      CLAUDEX_WORKHOUSE_IMAGE_DIGEST: "\${CLAUDEX_WORKHOUSE_IMAGE_DIGEST}"
      CLAUDEX_WORKHOUSE_UPDATER_PROTOCOL_VERSION: "\${CLAUDEX_WORKHOUSE_UPDATER_PROTOCOL_VERSION}"
      CLAUDEX_WORKHOUSE_INSTALL_METHOD: docker-compose
      CLAUDEX_WORKHOUSE_DEPLOYMENT_PLATFORM: ${plan.platform}
      CLAUDEX_WORKHOUSE_PUBLIC_ACCESS: "\${CLAUDEX_WORKHOUSE_PUBLIC_ACCESS}"
      CLAUDEX_WORKHOUSE_OWNER_CLAIM: required
      CLAUDEX_WORKHOUSE_HOST_ROLES: "${plan.roles.join(",")}"
      CLAUDEX_WORKHOUSE_RELEASE_KEY_RING_FILE: /opt/claudex-workhouse/deploy/release-key-ring.json
      CLAUDEX_WORKHOUSE_RELEASE_MANIFEST_URL: "\${CLAUDEX_WORKHOUSE_RELEASE_MANIFEST_URL}"
      CLAUDEX_WORKHOUSE_RELEASE_MANIFEST_SIGNATURE_URL: "\${CLAUDEX_WORKHOUSE_RELEASE_MANIFEST_SIGNATURE_URL}"
      CLAUDEX_WORKHOUSE_RELEASE_IMAGE_REPOSITORIES: "\${CLAUDEX_WORKHOUSE_RELEASE_IMAGE_REPOSITORIES}"
      CLAUDEX_WORKHOUSE_RELEASE_WORKER_ORIGINS: "\${CLAUDEX_WORKHOUSE_RELEASE_WORKER_ORIGINS}"
    volumes:
      - "\${CLAUDEX_WORKHOUSE_DATA_PATH}/config:/opt/claudex-workhouse/config"
      - "\${CLAUDEX_WORKHOUSE_DATA_PATH}/data:/opt/claudex-workhouse/data"
      - "\${CLAUDEX_WORKHOUSE_DATA_PATH}/logs:/opt/claudex-workhouse/logs"
      - "\${CLAUDEX_WORKHOUSE_DATA_PATH}/runtime:/opt/claudex-workhouse/runtime"
      - "\${CLAUDEX_WORKHOUSE_DATA_PATH}/snapshots:/opt/claudex-workhouse/snapshots"
      - "\${CLAUDEX_WORKHOUSE_DATA_PATH}/workspaces:/opt/claudex-workhouse/workspaces"
    tmpfs:
      - /opt/claudex-workhouse/run:mode=700,uid=10001,gid=10001
      - /tmp:mode=1777
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
`;
}

function renderEnv(
  plan: DeploymentPlan,
  release: TrustedReleaseMetadata,
  serverOrigin: string
): string {
  const bindAddress = plan.publicAccess === "local-only" ? "0.0.0.0" : "127.0.0.1";
  const releaseOrigin = new URL(release.manifest.url).origin;
  const channelUrl = release.manifest.channelUrl ?? release.manifest.url;
  const channelSignatureUrl =
    release.manifest.channelSignatureUrl ?? release.manifest.signatureUrl;
  return `CLAUDEX_WORKHOUSE_VERSION=${release.version}
CLAUDEX_WORKHOUSE_IMAGE_DIGEST=${release.image.digest}
CLAUDEX_WORKHOUSE_IMAGE_REFERENCE=${release.image.repository}@${release.image.digest}
CLAUDEX_WORKHOUSE_UPDATER_PROTOCOL_VERSION=1
CLAUDEX_WORKHOUSE_DATA_PATH=${plan.dataPath}
CLAUDEX_WORKHOUSE_PORT=${plan.port}
CLAUDEX_WORKHOUSE_BIND_ADDRESS=${bindAddress}
CLAUDEX_WORKHOUSE_EXTERNAL_ORIGIN=${serverOrigin}
CLAUDEX_WORKHOUSE_PUBLIC_ACCESS=${plan.publicAccess}
CLAUDEX_WORKHOUSE_RELEASE_MANIFEST_URL=${channelUrl}
CLAUDEX_WORKHOUSE_RELEASE_MANIFEST_SIGNATURE_URL=${channelSignatureUrl}
CLAUDEX_WORKHOUSE_RELEASE_MANIFEST_SHA256=${release.manifest.sha256}
CLAUDEX_WORKHOUSE_RELEASE_IMAGE_REPOSITORIES=${release.image.repository}
CLAUDEX_WORKHOUSE_RELEASE_WORKER_ORIGINS=${releaseOrigin}
`;
}

function renderInstallScript(
  plan: DeploymentPlan,
  release: TrustedReleaseMetadata,
  imageReference: string
): string {
  const publicKey = release.manifest.signingPublicKeyPem.endsWith("\n")
    ? release.manifest.signingPublicKeyPem
    : `${release.manifest.signingPublicKeyPem}\n`;
  return `#!/bin/sh
set -eu
umask 077

SCRIPT_DIR=$(CDPATH= cd "$(dirname "$0")" && pwd)
DEPLOY_ROOT='${plan.dataPath}'
PORT='${plan.port}'
IMAGE_REFERENCE='${imageReference}'
RELEASE_VERSION='${release.version}'
REQUESTED_ARCHITECTURE='${plan.architecture ?? "auto"}'
MANIFEST_URL='${release.manifest.url}'
MANIFEST_SIGNATURE_URL='${release.manifest.signatureUrl}'
MANIFEST_SHA256='${release.manifest.sha256}'
SIGNING_KEY_SHA256='${release.manifest.signingPublicKeySha256}'

need_command() {
  command -v "$1" >/dev/null 2>&1 || {
    printf 'Required command not found: %s\\n' "$1" >&2
    exit 10
  }
}

need_command docker
need_command curl
need_command openssl
need_command sha256sum
need_command cmp
need_command wc
need_command tr
need_command grep
need_command id
need_command stat
need_command chmod
need_command uname
need_command awk
need_command node
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]" 2>/dev/null) || {
  printf 'Node.js 20 or newer is required for host-side updates.\n' >&2
  exit 10
}
case "$NODE_MAJOR" in *[!0-9]*|'') exit 10 ;; esac
[ "$NODE_MAJOR" -ge 20 ] || {
  printf 'Node.js 20 or newer is required for host-side updates.\n' >&2
  exit 10
}
COMPOSE_VERSION=$(docker compose version --short 2>/dev/null) || {
  printf 'Docker Compose v2 is required.\\n' >&2
  exit 10
}
COMPOSE_VERSION=\${COMPOSE_VERSION#v}
case "$COMPOSE_VERSION" in
  *.*) ;;
  *)
    printf 'Could not determine the Docker Compose version: %s\\n' "$COMPOSE_VERSION" >&2
    exit 10
    ;;
esac
COMPOSE_MAJOR=\${COMPOSE_VERSION%%.*}
COMPOSE_REMAINDER=\${COMPOSE_VERSION#*.}
COMPOSE_MINOR=\${COMPOSE_REMAINDER%%.*}
case "$COMPOSE_MAJOR:$COMPOSE_MINOR" in
  *[!0-9:]*|:*|*:)
    printf 'Could not determine the Docker Compose version: %s\\n' "$COMPOSE_VERSION" >&2
    exit 10
    ;;
esac
if [ "$COMPOSE_MAJOR" -lt 2 ] || { [ "$COMPOSE_MAJOR" -eq 2 ] && [ "$COMPOSE_MINOR" -lt 20 ]; }; then
  printf 'Docker Compose 2.20 or newer is required; found %s.\\n' "$COMPOSE_VERSION" >&2
  exit 10
fi

case "$(uname -m)" in
  x86_64|amd64) DETECTED_ARCHITECTURE=x64 ;;
  aarch64|arm64) DETECTED_ARCHITECTURE=arm64 ;;
  *)
    printf 'Unsupported host architecture: %s\\n' "$(uname -m)" >&2
    exit 15
    ;;
esac
if [ "$REQUESTED_ARCHITECTURE" != "auto" ] && [ "$REQUESTED_ARCHITECTURE" != "$DETECTED_ARCHITECTURE" ]; then
  printf 'Deployment plan architecture %s does not match host architecture %s.\\n' "$REQUESTED_ARCHITECTURE" "$DETECTED_ARCHITECTURE" >&2
  exit 15
fi
for required_file in compose.yaml .env README-FIRST.txt; do
  if [ ! -f "$SCRIPT_DIR/$required_file" ]; then
    printf 'Deployment bundle is incomplete; missing %s.\\n' "$required_file" >&2
    exit 12
  fi
done

CURRENT_UID=$(id -u)
CURRENT_GID=$(id -g)
if [ "$CURRENT_UID" != "0" ] && { [ "$CURRENT_UID" != "10001" ] || [ "$CURRENT_GID" != "10001" ]; }; then
  printf 'Data directories must be prepared by root or by uid:gid 10001:10001. Current identity is %s:%s.\\n' "$CURRENT_UID" "$CURRENT_GID" >&2
  exit 14
fi

mkdir -p "$DEPLOY_ROOT"
prepare_bind_directory() {
  directory=$1
  mkdir -p "$directory"
  owner=$(stat -c '%u:%g' "$directory" 2>/dev/null || stat -f '%u:%g' "$directory" 2>/dev/null) || {
    printf 'Cannot inspect deployment directory ownership: %s\\n' "$directory" >&2
    exit 14
  }
  if [ "$owner" != "10001:10001" ]; then
    if [ "$CURRENT_UID" != "0" ]; then
      printf 'Deployment directory must be owned by uid:gid 10001:10001: %s\\n' "$directory" >&2
      exit 14
    fi
    chown 10001:10001 "$directory"
  fi
  chmod 700 "$directory"
}
if [ "$CURRENT_UID" = "0" ]; then
  need_command chown
fi
prepare_bind_directory "$DEPLOY_ROOT/config"
prepare_bind_directory "$DEPLOY_ROOT/data"
prepare_bind_directory "$DEPLOY_ROOT/logs"
prepare_bind_directory "$DEPLOY_ROOT/runtime"
prepare_bind_directory "$DEPLOY_ROOT/snapshots"
prepare_bind_directory "$DEPLOY_ROOT/workspaces"

VERIFY_DIR=$(mktemp -d "\${TMPDIR:-/tmp}/claudex-install.XXXXXX")
MANIFEST_FILE="$VERIFY_DIR/release-manifest"
SIGNATURE_FILE="$VERIFY_DIR/release-manifest.sig"
PUBLIC_KEY_FILE="$VERIFY_DIR/release-signing-key.pem"
cleanup() {
  rm -f "$MANIFEST_FILE" "$SIGNATURE_FILE" "$PUBLIC_KEY_FILE"
  rmdir "$VERIFY_DIR" 2>/dev/null || true
}
trap cleanup EXIT HUP INT TERM

cat >"$PUBLIC_KEY_FILE" <<'CLAUDEX_RELEASE_PUBLIC_KEY'
${publicKey}CLAUDEX_RELEASE_PUBLIC_KEY

printf '%s  %s\\n' "$SIGNING_KEY_SHA256" "$PUBLIC_KEY_FILE" | sha256sum -c - >/dev/null
download_bounded() {
  url=$1
  destination=$2
  maximum=$3
  label=$4
  curl --fail --show-error --silent --location --proto '=https' --proto-redir '=https' \\
    --max-filesize "$maximum" "$url" --output "$destination"
  size=$(wc -c <"$destination" | tr -d ' ')
  case "$size" in
    *[!0-9]*|'') printf '%s size could not be determined.\\n' "$label" >&2; exit 11 ;;
  esac
  [ "$size" -le "$maximum" ] || {
    printf '%s exceeds its allowed size.\\n' "$label" >&2
    exit 11
  }
}
download_bounded "$MANIFEST_URL" "$MANIFEST_FILE" 1048576 'Release manifest'
download_bounded "$MANIFEST_SIGNATURE_URL" "$SIGNATURE_FILE" 16384 'Release signature'
printf '%s  %s\\n' "$MANIFEST_SHA256" "$MANIFEST_FILE" | sha256sum -c - >/dev/null
openssl dgst -sha256 -verify "$PUBLIC_KEY_FILE" -signature "$SIGNATURE_FILE" "$MANIFEST_FILE" >/dev/null
grep -F -- "$IMAGE_REFERENCE" "$MANIFEST_FILE" >/dev/null || {
  printf 'The signed manifest does not contain the selected image digest.\\n' >&2
  exit 11
}
grep -F -- "$RELEASE_VERSION" "$MANIFEST_FILE" >/dev/null || {
  printf 'The signed manifest does not contain the selected release version.\\n' >&2
  exit 11
}

install_if_absent_or_same() {
  source_file=$1
  destination_file=$2
  mode=$3
  if [ -e "$destination_file" ]; then
    cmp -s "$source_file" "$destination_file" || {
      printf 'Existing deployment file differs; refusing to overwrite: %s\\n' "$destination_file" >&2
      exit 12
    }
  else
    cp "$source_file" "$destination_file"
    chmod "$mode" "$destination_file"
  fi
}

install_if_absent_or_same "$SCRIPT_DIR/compose.yaml" "$DEPLOY_ROOT/compose.yaml" 600
install_if_absent_or_same "$SCRIPT_DIR/.env" "$DEPLOY_ROOT/.env" 600
cd "$DEPLOY_ROOT"
docker compose --env-file .env -f compose.yaml config --quiet

host_port_in_use() {
  HOST_LISTENERS=
  if command -v ss >/dev/null 2>&1; then
    HOST_LISTENERS=$(ss -ltn 2>/dev/null) || return 2
  elif command -v netstat >/dev/null 2>&1; then
    HOST_LISTENERS=$(netstat -ltn 2>/dev/null) || return 2
  else
    return 2
  fi
  printf '%s\\n' "$HOST_LISTENERS" | awk -v port="$PORT" '
    {
      local_address = $4
      if (local_address ~ ("[.:]" port "$")) found = 1
    }
    END { exit found ? 0 : 1 }
  '
}

port_belongs_to_current_compose() {
  CURRENT_PUBLISHED_PORT=$(docker compose --env-file .env -f compose.yaml port claudex-workhouse 3410 2>/dev/null) || return 1
  printf '%s\\n' "$CURRENT_PUBLISHED_PORT" | awk -v port="$PORT" '
    $0 ~ ("[.:]" port "$") { found = 1 }
    END { exit found ? 0 : 1 }
  '
}

if host_port_in_use; then
  if port_belongs_to_current_compose; then
    printf 'Host port %s is already owned by this Claudex Workhouse Compose deployment; continuing a safe rerun.\\n' "$PORT"
  else
    printf 'Host port %s is already in use by another process. Choose another port and generate a new deployment plan.\\n' "$PORT" >&2
    exit 13
  fi
else
  PORT_PROBE_STATUS=$?
  if [ "$PORT_PROBE_STATUS" -eq 2 ]; then
    printf 'Warning: host port %s could not be inspected because neither ss nor netstat was available; Docker will perform the authoritative bind check.\\n' "$PORT" >&2
  fi
fi

docker compose --env-file .env -f compose.yaml pull
if ! docker compose --env-file .env -f compose.yaml up -d; then
  printf 'Container startup failed. If Docker reported that the address is already in use, choose another published port, generate a new plan, and use a fresh deployment directory; existing files are never overwritten.\\n' >&2
  exit 13
fi

attempt=0
until curl --fail --silent --show-error "http://127.0.0.1:$PORT/api/health/ready" >/dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    printf 'Claudex Workhouse did not become healthy on port %s.\\n' "$PORT" >&2
    exit 13
  fi
  sleep 2
done

UPDATER_DIR="$DEPLOY_ROOT/updater"
mkdir -p "$UPDATER_DIR"
chmod 700 "$UPDATER_DIR"
install_runtime_asset() {
  container_path=$1
  destination=$2
  mode=$3
  maximum=$4
  temporary=$(mktemp "$UPDATER_DIR/.asset.XXXXXX")
  docker compose --env-file .env -f compose.yaml cp "claudex-workhouse:$container_path" "$temporary" || {
    rm -f "$temporary"
    printf 'The signed image does not contain required host updater asset: %s\\n' "$container_path" >&2
    exit 16
  }
  [ ! -L "$temporary" ] && [ -f "$temporary" ] || { rm -f "$temporary"; exit 16; }
  asset_size=$(wc -c <"$temporary" | tr -d ' ')
  case "$asset_size" in *[!0-9]*|'') rm -f "$temporary"; exit 16 ;; esac
  [ "$asset_size" -ge 1 ] && [ "$asset_size" -le "$maximum" ] || { rm -f "$temporary"; exit 16; }
  chmod "$mode" "$temporary"
  mv "$temporary" "$destination"
}
install_runtime_asset /opt/claudex-workhouse/deploy/updater/docker-host-updater.mjs "$UPDATER_DIR/docker-host-updater.mjs" 700 1048576
install_runtime_asset /opt/claudex-workhouse/deploy/release-key-ring.json "$UPDATER_DIR/release-key-ring.json" 600 1048576
WRAPPER_TEMP=$(mktemp "$UPDATER_DIR/.wrapper.XXXXXX")
cat >"$WRAPPER_TEMP" <<'CLAUDEX_HOST_UPDATER_WRAPPER'
#!/bin/sh
set -eu
umask 077
DEPLOY_ROOT='${plan.dataPath}'
ATTEMPT_ID=\${1:-}
case "$ATTEMPT_ID" in ''|*[!0-9a-fA-F-]*) printf 'Usage: %s <update-attempt-id>\\n' "$0" >&2; exit 2 ;; esac
[ "\${#ATTEMPT_ID}" -eq 36 ] || { printf 'Update attempt id must be a UUID.\\n' >&2; exit 2; }
REQUEST_FILE="$DEPLOY_ROOT/runtime/application-updates/requests/$ATTEMPT_ID.json"
[ -f "$REQUEST_FILE" ] && [ ! -L "$REQUEST_FILE" ] || { printf 'Update request not found: %s\\n' "$REQUEST_FILE" >&2; exit 2; }
WORKHOUSE_RELEASE_KEY_RING_FILE="$DEPLOY_ROOT/updater/release-key-ring.json" \\
WORKHOUSE_COMPOSE_DIRECTORY="$DEPLOY_ROOT" \\
WORKHOUSE_HEALTH_ORIGIN='http://127.0.0.1:${plan.port}' \\
node "$DEPLOY_ROOT/updater/docker-host-updater.mjs" "$REQUEST_FILE"
CLAUDEX_HOST_UPDATER_WRAPPER
chmod 700 "$WRAPPER_TEMP"
mv "$WRAPPER_TEMP" "$UPDATER_DIR/apply-update.sh"

printf 'Claudex Workhouse is healthy. Host updater: %s <update-attempt-id>\\n' "$UPDATER_DIR/apply-update.sh"
printf 'Owner claim information follows:\\n'
if ! docker compose --env-file .env -f compose.yaml exec -T claudex-workhouse node -e \\
  "fetch('http://127.0.0.1:3410/api/bootstrap/owner-claim/local').then(async response=>{if(!response.ok){process.stderr.write('Owner claim request failed with HTTP '+response.status);process.exit(1);}const payload=await response.json();const claimUrl=typeof payload.claimUrl==='string'?payload.claimUrl:'';const expiresAt=typeof payload.qr?.expiresAt==='string'?payload.qr.expiresAt:typeof payload.enrollment?.expiresAt==='string'?payload.enrollment.expiresAt:'';const fingerprint=typeof payload.serverFingerprint==='string'?payload.serverFingerprint:typeof payload.qr?.serverFingerprint==='string'?payload.qr.serverFingerprint:'';if(!claimUrl||!expiresAt||!fingerprint){process.stderr.write('Owner claim response did not contain the expected URL, expiry, and fingerprint.');process.exit(1);}process.stdout.write('Owner claim URL (contains a ten-minute one-time secret; do not share):\\\\n'+claimUrl+'\\\\n\\\\nExpires at: '+expiresAt+'\\\\nServer fingerprint: '+fingerprint+'\\\\n');}).catch(error=>{process.stderr.write(error instanceof Error?error.message:String(error));process.exit(1);})"; then
  printf '\\nOwner claim information is unavailable or this server has already been claimed.\\n'
fi
printf '\\n'
`;
}

function renderReadme(
  plan: DeploymentPlan,
  release: TrustedReleaseMetadata,
  serverOrigin: string,
  imageReference: string
): string {
  const platformName = {
    synology: "Synology DSM with Container Manager",
    qnap: "QNAP with Container Station",
    "docker-nas": "Docker-compatible NAS",
    linux: "Linux with Docker Compose",
    windows: "Windows"
  }[plan.platform];
  return `Claudex Workhouse main-server deployment

Platform: ${platformName}
Release: ${release.version}
Image: ${imageReference}
Roles: ${plan.roles.join(", ")}
Data directory: ${plan.dataPath}
Published port: ${plan.port}
Configured origin: ${serverOrigin}
Access mode: ${plan.publicAccess}

Before starting:
1. Confirm this bundle came from the Claudex Workhouse UI you intended to use.
2. Confirm the signing-key fingerprint shown by the UI is:
   ${release.manifest.signingPublicKeySha256}
3. Ensure Docker, Docker Compose 2.20 or newer, and Node.js 20 or newer are installed.
4. The container runs as uid:gid 10001:10001. Run install.sh as root so it
   can assign that ownership to newly selected bind directories, or pre-create
   config/data/logs/runtime/snapshots/workspaces with that exact ownership and run as
   uid:gid 10001:10001. The installer never invokes an elevation tool itself.

Run once on the target device:

  sh ./install.sh

The installer verifies the pinned signed release manifest, installs the two
deployment files without overwriting a different existing configuration, pulls
the digest-pinned image, starts it, checks /api/health/ready, and installs the
host-side updater and local public-key ring under ${plan.dataPath}/updater.
A safe retry repeats verification and startup.

After Workhouse creates an application update request, run the printed command
on this host with that request's attempt id:

  ${plan.dataPath}/updater/apply-update.sh <update-attempt-id>

The updater accepts only that fixed request directory, re-verifies the signed
manifest against the installed key ring, pulls a digest-pinned image, checks
live and ready health, and restores the previous .env and container on failure.

If the browser loses the successful claim response or its owner cookie, run this
command locally on the server. It revokes the previous owner credential and
prints a new ten-minute claim URL:

  docker compose --env-file .env -f compose.yaml exec -T claudex-workhouse \\
    node app/dist-server/bootstrap/owner-recovery-cli.js

For Synology, run the command over SSH with the directory-ownership prerequisite
above, or import compose.yaml and .env into Container Manager after preparing the
same bind directories. For QNAP, use the equivalent Container Station flow.

This bundle does not configure a tunnel, reverse proxy, firewall, scheduled
update execution, backup, or restore operation. Existing Cloudflare/Tailscale/custom access is selected
only as an address and bind-policy choice.
`;
}

export function generateMainServerBundle(
  inputPlan: DeploymentPlan,
  options: MainServerBundleOptions
): DeploymentBundle {
  const plan = validateDeploymentPlan(inputPlan);
  if (plan.target !== "main-server") {
    throw new DeploymentValidationError("target", "only main-server plans produce Compose bundles");
  }
  if (!options?.release) {
    throw new DeploymentValidationError(
      "release",
      "trusted release metadata is not configured; bundle generation is disabled"
    );
  }
  const release = validateTrustedReleaseMetadata(options.release);
  const serverOrigin = validateServerOrigin(options.serverOrigin, plan.publicAccess);
  const imageReference = `${release.image.repository}@${release.image.digest}`;
  const artifacts = Object.freeze([
    artifact("compose.yaml", "application/yaml", 0o600, renderCompose(plan, imageReference)),
    artifact(".env", "text/plain", 0o600, renderEnv(plan, release, serverOrigin)),
    artifact("install.sh", "text/x-shellscript", 0o700, renderInstallScript(plan, release, imageReference)),
    artifact(
      "README-FIRST.txt",
      "text/plain",
      0o600,
      renderReadme(plan, release, serverOrigin, imageReference)
    )
  ]);
  return Object.freeze({
    kind: "claudex-deployment-bundle",
    formatVersion: 1,
    plan,
    release: Object.freeze({
      version: release.version,
      imageReference,
      manifestSha256: release.manifest.sha256,
      signingPublicKeySha256: release.manifest.signingPublicKeySha256
    }),
    artifacts
  });
}
