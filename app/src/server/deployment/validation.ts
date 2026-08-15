import crypto from "node:crypto";
import path from "node:path";
import {
  DeploymentValidationError,
  type DeploymentArchitecture,
  type DeploymentInstallMethod,
  type DeploymentPlan,
  type DeploymentPlanDraft,
  type DeploymentPlanFactoryOptions,
  type DeploymentPlatform,
  type DeploymentTarget,
  type HostRole,
  type PublicAccessMode,
  type SignedManifestTrust,
  type TrustedReleaseMetadata,
  type TrustedWorkerPackageMetadata
} from "./types.js";

const TARGETS = new Set<DeploymentTarget>(["main-server", "worker"]);
const PLATFORMS = new Set<DeploymentPlatform>(["synology", "qnap", "docker-nas", "linux", "windows"]);
const ARCHITECTURES = new Set<DeploymentArchitecture>(["x64", "arm64"]);
const INSTALL_METHODS = new Set<DeploymentInstallMethod>([
  "docker-compose",
  "portable-worker",
  "powershell-worker",
  "shell-worker"
]);
const ROLES = new Set<HostRole>(["main-server", "worker"]);
const PUBLIC_ACCESS = new Set<PublicAccessMode>([
  "local-only",
  "cloudflare-existing",
  "tailscale-existing",
  "custom-reverse-proxy"
]);
const MAIN_SERVER_PLATFORMS = new Set<DeploymentPlatform>(["synology", "qnap", "docker-nas", "linux"]);
const SAFE_DATA_COMPONENT =
  /^[\p{L}\p{N}](?:[\p{L}\p{N}._ -]*[\p{L}\p{N}._-])?$/u;
const FORBIDDEN_DATA_PREFIXES = [
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
const SHA256 = /^[a-f0-9]{64}$/;
const IMAGE_DIGEST = /^sha256:[a-f0-9]{64}$/;
const IMAGE_REPOSITORY =
  /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[0-9]{2,5})?(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)+$/;
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const SAFE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SAFE_RELATIVE_PATH = /^[A-Za-z0-9][A-Za-z0-9._ /-]{0,255}$/;
const MAX_WORKER_PACKAGE_BYTES = 256 * 1024 * 1024;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(field: string, message: string): never {
  throw new DeploymentValidationError(field, message);
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) fail(field, "must be a non-empty string");
  return value;
}

function enumValue<T extends string>(value: unknown, values: ReadonlySet<T>, field: string): T {
  if (typeof value !== "string" || !values.has(value as T)) fail(field, "contains an unsupported value");
  return value as T;
}

function isoDate(value: unknown, field: string): string {
  const text = stringValue(value, field);
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== text) {
    fail(field, "must be a canonical ISO-8601 timestamp");
  }
  return text;
}

function rolesValue(value: unknown): readonly HostRole[] {
  if (!Array.isArray(value) || value.length === 0) fail("roles", "must contain at least one role");
  const roles = value.map((role, index) => enumValue(role, ROLES, `roles[${index}]`));
  if (new Set(roles).size !== roles.length) fail("roles", "must not contain duplicate roles");
  return Object.freeze(
    (["main-server", "worker"] as const).filter((role) => roles.includes(role))
  );
}

export function validateDeploymentDataPath(value: unknown): string {
  const dataPath = stringValue(value, "dataPath");
  if (dataPath.length > 240) fail("dataPath", "is too long");
  if (!dataPath.startsWith("/") || path.posix.normalize(dataPath) !== dataPath) {
    fail("dataPath", "must be a normalized absolute POSIX path");
  }
  const components = dataPath.slice(1).split("/");
  if (components.length < 2 || components.some((component) => !SAFE_DATA_COMPONENT.test(component))) {
    fail(
      "dataPath",
      "must contain at least two safe path components without traversal, control characters, or shell syntax"
    );
  }
  if (
    FORBIDDEN_DATA_PREFIXES.some(
      (prefix) => dataPath === prefix || dataPath.startsWith(`${prefix}/`)
    )
  ) {
    fail("dataPath", "must not be placed below an operating-system directory");
  }
  return dataPath;
}

export function validateDeploymentPort(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1024 || value > 65535) {
    fail("port", "must be an integer from 1024 through 65535");
  }
  return value;
}

function validatePlanShape(input: unknown): DeploymentPlan {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    fail("plan", "must be an object");
  }
  const value = input as Record<string, unknown>;
  const id = stringValue(value.id, "id");
  if (!UUID.test(id)) fail("id", "must be a UUID");
  const target = enumValue(value.target, TARGETS, "target");
  const platform = enumValue(value.platform, PLATFORMS, "platform");
  const architecture =
    value.architecture === undefined
      ? undefined
      : enumValue(value.architecture, ARCHITECTURES, "architecture");
  const installMethod = enumValue(value.installMethod, INSTALL_METHODS, "installMethod");
  const roles = rolesValue(value.roles);
  const publicAccess = enumValue(value.publicAccess, PUBLIC_ACCESS, "publicAccess");
  const createdAt = isoDate(value.createdAt, "createdAt");

  let dataPath: string | undefined;
  let port: number | undefined;
  if (target === "main-server") {
    if (!MAIN_SERVER_PLATFORMS.has(platform)) {
      fail("platform", "Windows main server is not supported in this release");
    }
    if (installMethod !== "docker-compose") {
      fail("installMethod", "main servers require Docker Compose");
    }
    if (!roles.includes("main-server")) fail("roles", "a main-server plan must include main-server");
    dataPath = validateDeploymentDataPath(value.dataPath);
    port = validateDeploymentPort(value.port);
  } else {
    if (platform !== "windows" && platform !== "linux") {
      fail("platform", "workers are supported only on Windows and Linux");
    }
    if (roles.length !== 1 || roles[0] !== "worker") {
      fail("roles", "a worker plan must contain only the worker role");
    }
    if (value.dataPath !== undefined || value.port !== undefined) {
      fail("dataPath", "worker storage and ports are managed in the current user's profile");
    }
    if (
      platform === "windows" &&
      installMethod !== "portable-worker" &&
      installMethod !== "powershell-worker"
    ) {
      fail("installMethod", "Windows workers require the portable or PowerShell flow");
    }
    if (
      platform === "linux" &&
      installMethod !== "portable-worker" &&
      installMethod !== "shell-worker"
    ) {
      fail("installMethod", "Linux workers require the portable or shell flow");
    }
    if (platform === "windows" && architecture === "arm64") {
      fail("architecture", "the current Windows Worker package supports x64 only");
    }
  }

  return Object.freeze({
    id,
    target,
    platform,
    ...(architecture ? { architecture } : {}),
    installMethod,
    roles,
    ...(dataPath ? { dataPath } : {}),
    ...(port ? { port } : {}),
    publicAccess,
    createdAt
  });
}

export function validateDeploymentPlan(input: unknown): DeploymentPlan {
  return validatePlanShape(input);
}

export function createDeploymentPlan(
  draft: DeploymentPlanDraft,
  options: DeploymentPlanFactoryOptions = {}
): DeploymentPlan {
  const target = draft.target;
  const platform = draft.platform;
  const defaultInstallMethod =
    target === "main-server"
      ? "docker-compose"
      : platform === "windows"
        ? "portable-worker"
        : "portable-worker";
  const value = {
    id: draft.id ?? options.createId?.() ?? crypto.randomUUID(),
    target,
    platform,
    ...(draft.architecture ? { architecture: draft.architecture } : {}),
    installMethod: draft.installMethod ?? defaultInstallMethod,
    roles: draft.roles ?? (target === "main-server" ? ["main-server"] : ["worker"]),
    ...(draft.dataPath !== undefined ? { dataPath: draft.dataPath } : {}),
    ...(draft.port !== undefined
      ? { port: draft.port }
      : target === "main-server"
        ? { port: 3410 }
        : {}),
    publicAccess: draft.publicAccess ?? "local-only",
    createdAt: draft.createdAt ?? (options.now?.() ?? new Date()).toISOString()
  };
  return validatePlanShape(value);
}

function validateHttpsUrl(value: unknown, field: string): string {
  const text = stringValue(value, field);
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    fail(field, "must be an absolute HTTPS URL");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname.includes("..")
  ) {
    fail(field, "must be an HTTPS URL without credentials, query, hash, or traversal");
  }
  return url.href;
}

function validateSha256(value: unknown, field: string): string {
  const text = stringValue(value, field).toLowerCase();
  if (!SHA256.test(text)) fail(field, "must be a lowercase SHA-256 digest");
  return text;
}

function validateSigningKey(value: unknown, expectedHash: unknown, prefix: string): {
  readonly pem: string;
  readonly sha256: string;
} {
  const pem = stringValue(value, `${prefix}.signingPublicKeyPem`).replace(/\r\n/g, "\n");
  if (
    !/^-----BEGIN PUBLIC KEY-----\n(?:[A-Za-z0-9+/=]+\n)+-----END PUBLIC KEY-----\n$/.test(pem)
  ) {
    fail(
      `${prefix}.signingPublicKeyPem`,
      "must be a PEM-encoded public key ending in one newline"
    );
  }
  try {
    const key = crypto.createPublicKey(pem);
    if (key.asymmetricKeyType !== "rsa") {
      fail(`${prefix}.signingPublicKeyPem`, "must contain an RSA public key");
    }
  } catch (error) {
    if (error instanceof DeploymentValidationError) throw error;
    fail(`${prefix}.signingPublicKeyPem`, "cannot be parsed as a public key");
  }
  const sha256 = validateSha256(expectedHash, `${prefix}.signingPublicKeySha256`);
  const actual = crypto.createHash("sha256").update(pem, "utf8").digest("hex");
  if (actual !== sha256) {
    fail(`${prefix}.signingPublicKeySha256`, "does not match the supplied public key");
  }
  return Object.freeze({ pem, sha256 });
}

function validateManifest(input: unknown, prefix = "manifest"): SignedManifestTrust {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    fail(prefix, "must be an object");
  }
  const value = input as Record<string, unknown>;
  if (value.signatureAlgorithm !== "rsa-sha256") {
    fail(`${prefix}.signatureAlgorithm`, "must be rsa-sha256");
  }
  const key = validateSigningKey(
    value.signingPublicKeyPem,
    value.signingPublicKeySha256,
    prefix
  );
  const channelUrl = value.channelUrl === undefined
    ? undefined
    : validateHttpsUrl(value.channelUrl, `${prefix}.channelUrl`);
  const channelSignatureUrl = value.channelSignatureUrl === undefined
    ? undefined
    : validateHttpsUrl(value.channelSignatureUrl, `${prefix}.channelSignatureUrl`);
  if (Boolean(channelUrl) !== Boolean(channelSignatureUrl)) {
    fail(prefix, "channelUrl and channelSignatureUrl must be supplied together");
  }
  if (
    channelUrl &&
    channelSignatureUrl &&
    new URL(channelUrl).origin !== new URL(channelSignatureUrl).origin
  ) {
    fail(prefix, "channel manifest and signature URLs must use the same origin");
  }
  return Object.freeze({
    url: validateHttpsUrl(value.url, `${prefix}.url`),
    signatureUrl: validateHttpsUrl(value.signatureUrl, `${prefix}.signatureUrl`),
    ...(channelUrl && channelSignatureUrl ? { channelUrl, channelSignatureUrl } : {}),
    sha256: validateSha256(value.sha256, `${prefix}.sha256`),
    signatureAlgorithm: "rsa-sha256",
    signingPublicKeySha256: key.sha256,
    signingPublicKeyPem: key.pem
  });
}

export function validateTrustedReleaseMetadata(input: unknown): TrustedReleaseMetadata {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    fail("release", "trusted release metadata is required");
  }
  const value = input as Record<string, unknown>;
  if (value.schemaVersion !== 1) fail("release.schemaVersion", "must be 1");
  const version = stringValue(value.version, "release.version");
  if (!VERSION.test(version)) fail("release.version", "must be a semantic version");
  if (typeof value.image !== "object" || value.image === null || Array.isArray(value.image)) {
    fail("release.image", "must be an object");
  }
  const image = value.image as Record<string, unknown>;
  const repository = stringValue(image.repository, "release.image.repository");
  if (!IMAGE_REPOSITORY.test(repository) || repository.includes("@")) {
    fail("release.image.repository", "must be a tag-free registry/repository path");
  }
  const digest = stringValue(image.digest, "release.image.digest").toLowerCase();
  if (!IMAGE_DIGEST.test(digest)) {
    fail("release.image.digest", "must be a sha256 image digest");
  }
  return Object.freeze({
    schemaVersion: 1,
    version,
    image: Object.freeze({ repository, digest }),
    manifest: validateManifest(value.manifest)
  });
}

export function validateTrustedWorkerPackageMetadata(
  input: unknown
): TrustedWorkerPackageMetadata {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    fail("workerPackage", "trusted Worker package metadata is required");
  }
  const value = input as Record<string, unknown>;
  if (value.schemaVersion !== 1) fail("workerPackage.schemaVersion", "must be 1");
  const version = stringValue(value.version, "workerPackage.version");
  if (!VERSION.test(version)) fail("workerPackage.version", "must be a semantic version");
  const platform = enumValue(value.platform, new Set(["windows", "linux"] as const), "workerPackage.platform");
  const architecture = enumValue(value.architecture, ARCHITECTURES, "workerPackage.architecture");
  const format = enumValue(value.format, new Set(["zip", "tar.gz"] as const), "workerPackage.format");
  if (platform === "windows" && (architecture !== "x64" || format !== "zip")) {
    fail("workerPackage", "Windows packages must be x64 ZIP archives");
  }
  if (platform === "linux" && format !== "tar.gz") {
    fail("workerPackage.format", "Linux packages must be tar.gz archives");
  }
  if (typeof value.artifact !== "object" || value.artifact === null || Array.isArray(value.artifact)) {
    fail("workerPackage.artifact", "must be an object");
  }
  const artifact = value.artifact as Record<string, unknown>;
  const fileName = stringValue(artifact.fileName, "workerPackage.artifact.fileName");
  if (!SAFE_FILE_NAME.test(fileName)) {
    fail("workerPackage.artifact.fileName", "must be a safe base name");
  }
  if (
    (format === "zip" && !fileName.endsWith(".zip")) ||
    (format === "tar.gz" && !fileName.endsWith(".tar.gz"))
  ) {
    fail("workerPackage.artifact.fileName", "must match the declared archive format");
  }
  const artifactUrl = validateHttpsUrl(artifact.url, "workerPackage.artifact.url");
  if (!new URL(artifactUrl).pathname.endsWith(`/${fileName}`)) {
    fail("workerPackage.artifact.url", "must end with the declared artifact file name");
  }
  const entrypoint = stringValue(artifact.entrypoint, "workerPackage.artifact.entrypoint");
  const artifactSize = artifact.size;
  const minimumUpdaterProtocolVersion=artifact.minimumUpdaterProtocolVersion??1;
  if(typeof minimumUpdaterProtocolVersion!=="number"||!Number.isSafeInteger(minimumUpdaterProtocolVersion)||minimumUpdaterProtocolVersion<1||minimumUpdaterProtocolVersion>1_000_000)fail("workerPackage.artifact.minimumUpdaterProtocolVersion","must be a positive supported protocol version");
  if (
    typeof artifactSize !== "number" ||
    !Number.isSafeInteger(artifactSize) ||
    artifactSize < 1 ||
    artifactSize > MAX_WORKER_PACKAGE_BYTES
  ) {
    fail(
      "workerPackage.artifact.size",
      `must be an integer from 1 through ${MAX_WORKER_PACKAGE_BYTES} bytes`
    );
  }
  if (
    !SAFE_RELATIVE_PATH.test(entrypoint) ||
    path.posix.isAbsolute(entrypoint) ||
    path.posix.normalize(entrypoint) !== entrypoint ||
    entrypoint.split("/").includes("..")
  ) {
    fail("workerPackage.artifact.entrypoint", "must be a normalized safe relative path");
  }
  const launcher =
    artifact.launcher === undefined
      ? undefined
      : stringValue(artifact.launcher, "workerPackage.artifact.launcher");
  if (
    launcher !== undefined &&
    (!SAFE_RELATIVE_PATH.test(launcher) ||
      path.posix.isAbsolute(launcher) ||
      path.posix.normalize(launcher) !== launcher ||
      launcher.split("/").includes(".."))
  ) {
    fail("workerPackage.artifact.launcher", "must be a normalized safe relative path");
  }
  if (platform === "windows" && launcher === undefined) {
    fail("workerPackage.artifact.launcher", "is required for the Windows portable UI");
  }
  if (platform === "linux" && launcher !== undefined) {
    fail("workerPackage.artifact.launcher", "is supported only by Windows packages");
  }
  return Object.freeze({
    schemaVersion: 1,
    version,
    platform,
    architecture,
    format,
    artifact: Object.freeze({
      url: artifactUrl,
      sha256: validateSha256(artifact.sha256, "workerPackage.artifact.sha256"),
      size: artifactSize,
      minimumUpdaterProtocolVersion,
      fileName,
      entrypoint,
      ...(launcher ? { launcher } : {})
    }),
    manifest: validateManifest(value.manifest, "workerPackage.manifest")
  });
}

function isPrivateIpv4(hostname: string): boolean {
  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  return (
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168) ||
    octets[0] === 127
  );
}

export function validateServerOrigin(value: unknown, access: PublicAccessMode): string {
  const text = stringValue(value, "serverOrigin");
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    fail("serverOrigin", "must be an absolute HTTP(S) origin");
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    fail("serverOrigin", "must be an origin without credentials, path, query, or hash");
  }
  const localHost =
    url.hostname === "localhost" ||
    !url.hostname.includes(".") ||
    url.hostname.endsWith(".local") ||
    isPrivateIpv4(url.hostname) ||
    url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(access === "local-only" && url.protocol === "http:" && localHost)) {
    fail("serverOrigin", "HTTP is allowed only for a local-only private-network origin");
  }
  return url.origin;
}

export function validatePairingCode(value: unknown): string {
  const code = stringValue(value, "pairingCode").toUpperCase();
  if (!/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(code)) {
    fail("pairingCode", "must be a Claudex one-time Worker pairing code");
  }
  return code;
}
