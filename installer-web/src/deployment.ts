import { sha256Hex } from "./release";
import type {
  AccessMode,
  InstallerArtifact,
  InstallerBundle,
  InstallerPlan,
  VerifiedRelease
} from "./types";

const SAFE_DATA_COMPONENT =
  /^[\p{L}\p{N}](?:[\p{L}\p{N}._ -]*[\p{L}\p{N}._-])?$/u;
const FORBIDDEN_PREFIXES = [
  "/bin",
  "/boot",
  "/dev",
  "/etc",
  "/lib",
  "/lib64",
  "/proc",
  "/root",
  "/run",
  "/sbin",
  "/sys",
  "/tmp",
  "/usr",
  "/var/run",
  "/var/tmp"
];

function normalizePosixPath(value: string): string {
  const output: string[] = [];
  for (const component of value.split("/")) {
    if (!component || component === ".") continue;
    if (component === "..") output.pop();
    else output.push(component);
  }
  return `/${output.join("/")}`;
}

export function validateDataPath(value: string): string {
  const dataPath = value.trim();
  if (
    dataPath.length < 3 ||
    dataPath.length > 240 ||
    !dataPath.startsWith("/") ||
    normalizePosixPath(dataPath) !== dataPath
  ) {
    throw new Error("저장 경로는 정규화된 절대 POSIX 경로여야 합니다.");
  }
  const components = dataPath.slice(1).split("/");
  if (components.length < 2 || components.some((item) => !SAFE_DATA_COMPONENT.test(item))) {
    throw new Error(
      "저장 경로에는 경로 이동·제어 문자·쉘 문법이 없는 안전한 구성요소가 두 개 이상 필요합니다."
    );
  }
  if (
    FORBIDDEN_PREFIXES.some(
      (prefix) => dataPath === prefix || dataPath.startsWith(`${prefix}/`)
    )
  ) {
    throw new Error("운영체제 디렉터리 아래에는 설치할 수 없습니다.");
  }
  return dataPath;
}

export function validatePort(value: number): number {
  if (!Number.isInteger(value) || value < 1024 || value > 65535) {
    throw new Error("포트는 1024~65535 범위의 정수여야 합니다.");
  }
  return value;
}

function privateIpv4(hostname: string): boolean {
  const octets = hostname.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  return (
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

export function validateServerOrigin(value: string, accessMode: AccessMode): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("접속 주소가 올바르지 않습니다.");
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("접속 주소에는 경로, query, fragment 또는 자격증명을 넣을 수 없습니다.");
  }
  const host = url.hostname.toLowerCase();
  if (["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"].includes(host)) {
    throw new Error("다른 장치에서 열 수 있는 NAS 또는 Linux 주소를 입력하세요.");
  }
  if (accessMode === "local-only") {
    const localHost =
      privateIpv4(host) || host.endsWith(".local") || (!host.includes(".") && host.length > 0);
    if (!localHost || (url.protocol !== "http:" && url.protocol !== "https:")) {
      throw new Error("로컬 설치에는 사설 IP, .local 또는 로컬 호스트 이름을 사용하세요.");
    }
  } else if (url.protocol !== "https:") {
    throw new Error("Tailscale과 Cloudflare 주소는 HTTPS여야 합니다.");
  }
  return url.origin;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function renderCompose(plan: InstallerPlan, imageReference: string): string {
  const bind = plan.accessMode === "local-only" ? "0.0.0.0" : "127.0.0.1";
  return `name: claudex-workhouse
services:
  claudex-workhouse:
    image: ${imageReference}
    restart: unless-stopped
    user: "10001:10001"
    ports:
      - "\${CLAUDEX_WORKHOUSE_BIND_ADDRESS:-${bind}}:\${CLAUDEX_WORKHOUSE_PORT}:3410"
    environment:
      CLAUDEX_WORKHOUSE_ROOT: /opt/claudex-workhouse
      HOME: /opt/claudex-workhouse/runtime/home
      CLAUDEX_WORKHOUSE_HOST: 0.0.0.0
      CLAUDEX_WORKHOUSE_PORT: 3410
      CLAUDEX_WORKHOUSE_EXTERNAL_ORIGIN: "\${CLAUDEX_WORKHOUSE_EXTERNAL_ORIGIN}"
      CLAUDEX_WORKHOUSE_BOOTSTRAP_ORIGIN: "\${CLAUDEX_WORKHOUSE_EXTERNAL_ORIGIN}"
      CLAUDEX_WORKHOUSE_VERSION: "\${CLAUDEX_WORKHOUSE_VERSION}"
      CLAUDEX_WORKHOUSE_INSTALL_METHOD: docker-compose
      CLAUDEX_WORKHOUSE_DEPLOYMENT_PLATFORM: ${plan.platform}
      CLAUDEX_WORKHOUSE_PUBLIC_ACCESS: "\${CLAUDEX_WORKHOUSE_PUBLIC_ACCESS}"
      CLAUDEX_WORKHOUSE_RELEASE_KEY_RING_FILE: /opt/claudex-workhouse/deploy/release-key-ring.json
      CLAUDEX_WORKHOUSE_RELEASE_MANIFEST_URL: "\${CLAUDEX_WORKHOUSE_RELEASE_MANIFEST_URL}"
      CLAUDEX_WORKHOUSE_RELEASE_MANIFEST_SIGNATURE_URL: "\${CLAUDEX_WORKHOUSE_RELEASE_MANIFEST_SIGNATURE_URL}"
      CLAUDEX_WORKHOUSE_RELEASE_CHANNEL: "\${CLAUDEX_WORKHOUSE_RELEASE_CHANNEL}"
      CLAUDEX_WORKHOUSE_RELEASE_IMAGE_REPOSITORIES: "\${CLAUDEX_WORKHOUSE_RELEASE_IMAGE_REPOSITORIES}"
      CLAUDEX_WORKHOUSE_RELEASE_WORKER_ORIGINS: "\${CLAUDEX_WORKHOUSE_RELEASE_WORKER_ORIGINS}"
      CLAUDEX_WORKHOUSE_OWNER_CLAIM: required
      CLAUDEX_WORKHOUSE_HOST_ROLES: "main-server,worker"
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

function renderEnv(plan: InstallerPlan, release: VerifiedRelease): string {
  const bind = plan.accessMode === "local-only" ? "0.0.0.0" : "127.0.0.1";
  const workerOrigins = [
    ...new Set(
      Object.values(release.manifest.workers).map((worker) => new URL(worker.url).origin)
    )
  ].join(",");
  return `CLAUDEX_WORKHOUSE_VERSION=${release.manifest.version}
CLAUDEX_WORKHOUSE_DATA_PATH=${plan.dataPath}
CLAUDEX_WORKHOUSE_PORT=${plan.port}
CLAUDEX_WORKHOUSE_BIND_ADDRESS=${bind}
CLAUDEX_WORKHOUSE_EXTERNAL_ORIGIN=${plan.serverOrigin}
CLAUDEX_WORKHOUSE_PUBLIC_ACCESS=${plan.accessMode}
CLAUDEX_WORKHOUSE_RELEASE_MANIFEST_URL=${release.manifestUrl}
CLAUDEX_WORKHOUSE_RELEASE_MANIFEST_SIGNATURE_URL=${release.signatureUrl}
CLAUDEX_WORKHOUSE_RELEASE_MANIFEST_SHA256=${release.manifestSha256}
CLAUDEX_WORKHOUSE_RELEASE_CHANNEL=${release.manifest.channel}
CLAUDEX_WORKHOUSE_RELEASE_IMAGE_REPOSITORIES=${release.manifest.server.image}
CLAUDEX_WORKHOUSE_RELEASE_WORKER_ORIGINS=${workerOrigins}
`;
}

function renderInstallScript(
  plan: InstallerPlan,
  release: VerifiedRelease,
  imageReference: string
): string {
  const key = release.verifiedKey.publicKeyPem.replace(/\r\n/g, "\n").trimEnd();
  return `#!/bin/sh
set -eu
umask 077

SCRIPT_DIR=$(CDPATH= cd "$(dirname "$0")" && pwd)
DEPLOY_ROOT=${shellQuote(plan.dataPath)}
PORT=${shellQuote(String(plan.port))}
IMAGE_REFERENCE=${shellQuote(imageReference)}
IMAGE_REPOSITORY=${shellQuote(release.manifest.server.image)}
IMAGE_TAG=${shellQuote(release.manifest.server.tag)}
IMAGE_DIGEST=${shellQuote(release.manifest.server.digest)}
RELEASE_VERSION=${shellQuote(release.manifest.version)}
MANIFEST_URL=${shellQuote(release.immutableManifestUrl)}
MANIFEST_SIGNATURE_URL=${shellQuote(release.immutableSignatureUrl)}
MANIFEST_SHA256=${shellQuote(release.manifestSha256)}
SIGNING_KEY_SHA256=${shellQuote(release.verifiedKey.publicKeySha256)}

need_command() {
  command -v "$1" >/dev/null 2>&1 || {
    printf 'Required command not found: %s\\n' "$1" >&2
    exit 10
  }
}

for command_name in docker curl openssl sha256sum cmp id stat chmod uname awk grep wc tr node; do
  need_command "$command_name"
done
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
  *) printf 'Could not determine the Docker Compose version: %s\\n' "$COMPOSE_VERSION" >&2; exit 10 ;;
esac
COMPOSE_MAJOR=\${COMPOSE_VERSION%%.*}
COMPOSE_REMAINDER=\${COMPOSE_VERSION#*.}
COMPOSE_MINOR=\${COMPOSE_REMAINDER%%.*}
case "$COMPOSE_MAJOR:$COMPOSE_MINOR" in
  *[!0-9:]*|:*|*:) printf 'Could not determine the Docker Compose version: %s\\n' "$COMPOSE_VERSION" >&2; exit 10 ;;
esac
if [ "$COMPOSE_MAJOR" -lt 2 ] || { [ "$COMPOSE_MAJOR" -eq 2 ] && [ "$COMPOSE_MINOR" -lt 20 ]; }; then
  printf 'Docker Compose 2.20 or newer is required; found %s.\\n' "$COMPOSE_VERSION" >&2
  exit 10
fi

case "$(uname -m)" in
  x86_64|amd64) PLATFORM=linux/amd64 ;;
  aarch64|arm64) PLATFORM=linux/arm64 ;;
  *) printf 'Unsupported host architecture: %s\\n' "$(uname -m)" >&2; exit 15 ;;
esac

for required_file in compose.yaml .env README-FIRST.txt; do
  [ -f "$SCRIPT_DIR/$required_file" ] || {
    printf 'Deployment bundle is incomplete; missing %s.\\n' "$required_file" >&2
    exit 12
  }
done

CURRENT_UID=$(id -u)
CURRENT_GID=$(id -g)
if [ "$CURRENT_UID" != "0" ] && { [ "$CURRENT_UID" != "10001" ] || [ "$CURRENT_GID" != "10001" ]; }; then
  printf 'Run this installer as root, or pre-create the data directories as uid:gid 10001:10001. Current identity is %s:%s.\\n' "$CURRENT_UID" "$CURRENT_GID" >&2
  exit 14
fi
if [ "$CURRENT_UID" = "0" ]; then need_command chown; fi

mkdir -p "$DEPLOY_ROOT"
prepare_bind_directory() {
  directory=$1
  mkdir -p "$directory"
  owner=$(stat -c '%u:%g' "$directory" 2>/dev/null || stat -f '%u:%g' "$directory" 2>/dev/null) || {
    printf 'Cannot inspect deployment directory ownership: %s\\n' "$directory" >&2
    exit 14
  }
  if [ "$owner" != "10001:10001" ]; then
    [ "$CURRENT_UID" = "0" ] || {
      printf 'Deployment directory must be owned by uid:gid 10001:10001: %s\\n' "$directory" >&2
      exit 14
    }
    chown 10001:10001 "$directory"
  fi
  chmod 700 "$directory"
}
for directory_name in config data logs runtime snapshots workspaces; do
  prepare_bind_directory "$DEPLOY_ROOT/$directory_name"
done

VERIFY_DIR=$(mktemp -d "\${TMPDIR:-/tmp}/claudex-install.XXXXXX")
MANIFEST_FILE="$VERIFY_DIR/release-manifest.json"
SIGNATURE_FILE="$VERIFY_DIR/release-manifest.json.sig"
PUBLIC_KEY_FILE="$VERIFY_DIR/release-signing-key.pem"
cleanup() {
  rm -f "$MANIFEST_FILE" "$SIGNATURE_FILE" "$PUBLIC_KEY_FILE"
  rmdir "$VERIFY_DIR" 2>/dev/null || true
}
trap cleanup EXIT HUP INT TERM
cat >"$PUBLIC_KEY_FILE" <<'CLAUDEX_RELEASE_PUBLIC_KEY'
${key}
CLAUDEX_RELEASE_PUBLIC_KEY

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
for signed_value in "$IMAGE_REPOSITORY" "$IMAGE_TAG" "$IMAGE_DIGEST" "$RELEASE_VERSION"; do
  grep -F -- "$signed_value" "$MANIFEST_FILE" >/dev/null || {
    printf 'The signed manifest does not contain an expected release value.\\n' >&2
    exit 11
  }
done
grep -F -- "$PLATFORM" "$MANIFEST_FILE" >/dev/null || {
  printf 'The signed manifest does not support host platform %s.\\n' "$PLATFORM" >&2
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
    { local_address = $4; if (local_address ~ ("[.:]" port "$")) found = 1 }
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
    printf 'Host port %s is already owned by this deployment; continuing a safe rerun.\\n' "$PORT"
  else
    printf 'Host port %s is already in use by another process. Choose another port and create a new bundle.\\n' "$PORT" >&2
    exit 13
  fi
else
  PORT_PROBE_STATUS=$?
  if [ "$PORT_PROBE_STATUS" -eq 2 ]; then
    printf 'Warning: host port %s could not be inspected; Docker will perform the authoritative bind check.\\n' "$PORT" >&2
  fi
fi

docker compose --env-file .env -f compose.yaml pull
docker compose --env-file .env -f compose.yaml up -d || {
  printf 'Container startup failed. Check whether host port %s is already in use.\\n' "$PORT" >&2
  exit 13
}

attempt=0
until curl --fail --silent --show-error "http://127.0.0.1:$PORT/api/health/ready" >/dev/null; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 30 ] || {
    printf 'Claudex Workhouse did not become healthy on port %s.\\n' "$PORT" >&2
    exit 13
  }
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
DEPLOY_ROOT=${shellQuote(plan.dataPath)}
ATTEMPT_ID=\${1:-}
case "$ATTEMPT_ID" in ''|*[!0-9a-fA-F-]*) printf 'Usage: %s <update-attempt-id>\\n' "$0" >&2; exit 2 ;; esac
[ "\${#ATTEMPT_ID}" -eq 36 ] || { printf 'Update attempt id must be a UUID.\\n' >&2; exit 2; }
REQUEST_FILE="$DEPLOY_ROOT/runtime/application-updates/requests/$ATTEMPT_ID.json"
[ -f "$REQUEST_FILE" ] && [ ! -L "$REQUEST_FILE" ] || { printf 'Update request not found: %s\\n' "$REQUEST_FILE" >&2; exit 2; }
WORKHOUSE_RELEASE_KEY_RING_FILE="$DEPLOY_ROOT/updater/release-key-ring.json" \\
WORKHOUSE_COMPOSE_DIRECTORY="$DEPLOY_ROOT" \\
WORKHOUSE_HEALTH_ORIGIN=${shellQuote(`http://127.0.0.1:${plan.port}`)} \\
node "$DEPLOY_ROOT/updater/docker-host-updater.mjs" "$REQUEST_FILE"
CLAUDEX_HOST_UPDATER_WRAPPER
chmod 700 "$WRAPPER_TEMP"
mv "$WRAPPER_TEMP" "$UPDATER_DIR/apply-update.sh"

printf 'Claudex Workhouse is healthy. Host updater: %s <update-attempt-id>\\n' "$UPDATER_DIR/apply-update.sh"
if ! docker compose --env-file .env -f compose.yaml exec -T claudex-workhouse node -e \\
  "fetch('http://127.0.0.1:3410/api/bootstrap/owner-claim/local').then(async response=>{if(!response.ok)throw new Error('Owner claim request failed with HTTP '+response.status);const payload=await response.json();const claimUrl=typeof payload.claimUrl==='string'?payload.claimUrl:'';const expiresAt=typeof payload.qr?.expiresAt==='string'?payload.qr.expiresAt:typeof payload.enrollment?.expiresAt==='string'?payload.enrollment.expiresAt:'';const fingerprint=typeof payload.serverFingerprint==='string'?payload.serverFingerprint:typeof payload.qr?.serverFingerprint==='string'?payload.qr.serverFingerprint:'';if(!claimUrl||!expiresAt||!fingerprint)throw new Error('Owner claim response is incomplete.');process.stdout.write('Owner claim URL (contains a ten-minute one-time secret; do not share):\\\\n'+claimUrl+'\\\\n\\\\nExpires at: '+expiresAt+'\\\\nServer fingerprint: '+fingerprint+'\\\\n');}).catch(error=>{process.stderr.write(error instanceof Error?error.message:String(error));process.exit(1);})"; then
  printf '\\nOwner claim information is unavailable or this server has already been claimed.\\n'
fi
`;
}

function renderReadme(
  plan: InstallerPlan,
  release: VerifiedRelease,
  imageReference: string
): string {
  const platformName =
    plan.platform === "synology"
      ? "Synology DSM 7 with Container Manager"
      : "Linux with Docker Compose";
  return `Claudex Workhouse verified public installer

Platform: ${platformName}
Release: ${release.manifest.version}
Image: ${imageReference}
Data directory: ${plan.dataPath}
Published port: ${plan.port}
Configured origin: ${plan.serverOrigin}
Access mode: ${plan.accessMode}
Manifest SHA-256: ${release.manifestSha256}
Signing key: ${release.verifiedKey.keyId}
Signing-key fingerprint: ${release.verifiedKey.publicKeySha256}

Requirements:
1. Docker and Docker Compose 2.20 or newer.
2. Root access for initial uid:gid 10001:10001 directory preparation, or those
   directories already prepared by an administrator.
3. Node.js 20 or newer, curl, OpenSSL, sha256sum, awk, stat, and standard POSIX tools.

Run on the target NAS or Linux host:

  sh ./install.sh

The installer re-verifies the exact signed manifest selected in the browser,
pulls only the digest-pinned image, starts the service, checks its local health,
installs a host-side updater plus local public-key ring, and prints the one-time
owner claim URL, expiry, and server fingerprint.
The static installer page never creates, receives, or stores the claim token.

After Workhouse creates an application update request, run:

  ${plan.dataPath}/updater/apply-update.sh <update-attempt-id>

The updater is explicit rather than scheduled. It accepts only request files in
the fixed Workhouse runtime directory, re-verifies the signed manifest, checks
both local health routes, and automatically restores the previous image on
failure.

For Synology, upload the complete extracted directory before running install.sh.
The bundle does not configure a Cloudflare or Tailscale account and contains no
provider credential, pairing code, tunnel token, password, or SSH key.
`;
}

async function artifact(
  path: InstallerArtifact["path"],
  mediaType: InstallerArtifact["mediaType"],
  mode: InstallerArtifact["mode"],
  content: string
): Promise<InstallerArtifact> {
  const normalized = content.endsWith("\n") ? content : `${content}\n`;
  return Object.freeze({
    path,
    mediaType,
    mode,
    content: normalized,
    sha256: await sha256Hex(new TextEncoder().encode(normalized))
  });
}

export async function createInstallerBundle(
  input: Omit<InstallerPlan, "dataPath" | "port" | "serverOrigin"> & {
    dataPath: string;
    port: number;
    serverOrigin: string;
  },
  release: VerifiedRelease
): Promise<InstallerBundle> {
  const plan: InstallerPlan = Object.freeze({
    ...input,
    dataPath: validateDataPath(input.dataPath),
    port: validatePort(input.port),
    serverOrigin: validateServerOrigin(input.serverOrigin, input.accessMode)
  });
  if (plan.platform !== "synology" && plan.platform !== "linux") {
    throw new Error("서버 bundle은 Synology 또는 Linux용으로만 생성할 수 있습니다.");
  }
  const imageReference = `${release.manifest.server.image}:${release.manifest.server.tag}@${release.manifest.server.digest}`;
  const artifacts = Object.freeze([
    await artifact("compose.yaml", "application/yaml", 0o600, renderCompose(plan, imageReference)),
    await artifact(".env", "text/plain", 0o600, renderEnv(plan, release)),
    await artifact(
      "install.sh",
      "text/x-shellscript",
      0o700,
      renderInstallScript(plan, release, imageReference)
    ),
    await artifact(
      "README-FIRST.txt",
      "text/plain",
      0o600,
      renderReadme(plan, release, imageReference)
    )
  ]);
  const directoryName = `claudex-workhouse-${plan.id}`;
  return Object.freeze({
    directoryName,
    archiveName: `${directoryName}.tar.gz`,
    plan,
    release,
    artifacts
  });
}
