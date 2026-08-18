import fs from "node:fs";
import path from "node:path";
import {
  ReleaseManifestError,
  parseReleaseKeyRing,
  verifyReleaseManifest,
  type PreviouslyVerifiedRelease,
  type ReleaseVerificationPolicy,
  type VerifiedRelease
} from "./release-manifest.js";

export const RELEASE_STATE_SETTING_KEY = "deployment.release-state.v1";
const DEFAULT_IMAGE_REPOSITORY = "ghcr.io/canister2668/claudex-workhouse";
const DEFAULT_RELEASE_ORIGIN = "https://canister2668.github.io";
// The manifest is served from Pages, but the artifacts it names live on the
// release itself. Trusting only the manifest origin rejected every artifact a
// release actually publishes, which only the compose bundle avoided because it
// writes this explicitly. Both are defaults; naming the variable still replaces
// them outright.
const DEFAULT_ARTIFACT_ORIGIN = "https://github.com";
const DEFAULT_RELEASE_PATH = "/claudex-workhouse/releases/stable/release-manifest.json";
const MAX_KEY_RING_BYTES = 256 * 1024;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_SIGNATURE_BYTES = 16 * 1024;
const DEFAULT_FETCH_TIMEOUT_MS = 10_000;
const SHA256 = /^[a-f0-9]{64}$/;
const CHANNEL = /^[a-z][a-z0-9-]{0,31}$/;

export interface PersistedReleaseState {
  readonly schemaVersion: 1;
  readonly channel: string;
  readonly releaseSequence: number;
  readonly version: string;
  readonly manifestSha256: string;
  readonly imageDigest: string;
  readonly verifiedKeyId: string;
  readonly verifiedAt: string;
  readonly manifestUrl: string;
}

export interface ReleaseStateAcceptance {
  readonly accepted: boolean;
  readonly reused?: boolean;
  readonly reason?: "downgrade" | "equivocation" | "channel-mismatch" | "invalid-state";
  readonly current: PersistedReleaseState | null;
}

export interface ReleaseStateStore {
  getSystemSetting(key: string): Promise<{ value: unknown; updatedAt: string } | null>;
  acceptReleaseState(
    state: PersistedReleaseState,
    updatedAt: string
  ): Promise<ReleaseStateAcceptance>;
}

export interface ReleaseServiceConfig {
  readonly keyRingFile: string;
  readonly manifestUrl: string;
  readonly signatureUrl: string;
  readonly expectedChannel: string;
  readonly policy: ReleaseVerificationPolicy;
  readonly timeoutMs?: number;
}

export interface ReleaseServiceEnvironment {
  readonly CLAUDEX_WORKHOUSE_RELEASE_KEY_RING_FILE?: string;
  readonly CLAUDEX_WORKHOUSE_RELEASE_MANIFEST_URL?: string;
  readonly CLAUDEX_WORKHOUSE_RELEASE_MANIFEST_SIGNATURE_URL?: string;
  readonly CLAUDEX_WORKHOUSE_RELEASE_CHANNEL?: string;
  readonly CLAUDEX_WORKHOUSE_RELEASE_IMAGE_REPOSITORIES?: string;
  readonly CLAUDEX_WORKHOUSE_RELEASE_WORKER_ORIGINS?: string;
}

export interface ReleaseFetch {
  (input: string | URL, init?: RequestInit): Promise<Response>;
}

export class ReleaseServiceError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ReleaseServiceError";
  }
}

function httpsUrl(value: string, field: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ReleaseServiceError("RELEASE_CONFIG_INVALID", `${field} must be an absolute HTTPS URL.`);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname.includes("..") ||
    url.href !== value
  ) {
    throw new ReleaseServiceError(
      "RELEASE_CONFIG_INVALID",
      `${field} must be a canonical HTTPS URL without credentials, query, hash, or traversal.`
    );
  }
  return url;
}

function commaValues(value: string | undefined): string[] {
  return (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function originValues(value: string | undefined, ...fallback: string[]): string[] {
  const configured = commaValues(value);
  const values = configured.length ? configured : fallback;
  return values.map((item) => {
    let url: URL;
    try {
      url = new URL(item);
    } catch {
      throw new ReleaseServiceError("RELEASE_CONFIG_INVALID", "Worker origins must be absolute HTTPS origins.");
    }
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      throw new ReleaseServiceError("RELEASE_CONFIG_INVALID", "Worker origins must be HTTPS origins without a path.");
    }
    return url.origin;
  });
}

/**
 * Returns null only when none of the integrated release settings is present.
 * A partial configuration fails closed instead of silently selecting legacy
 * trusted-metadata files.
 */
export function releaseServiceConfigFromEnvironment(
  root: string,
  environment: ReleaseServiceEnvironment = process.env
): ReleaseServiceConfig | null {
  const explicitKeyRing = environment.CLAUDEX_WORKHOUSE_RELEASE_KEY_RING_FILE?.trim();
  const explicitManifest = environment.CLAUDEX_WORKHOUSE_RELEASE_MANIFEST_URL?.trim();
  const explicitSignature = environment.CLAUDEX_WORKHOUSE_RELEASE_MANIFEST_SIGNATURE_URL?.trim();
  const anyExplicit = Boolean(explicitKeyRing || explicitManifest || explicitSignature);
  const keyRing = explicitKeyRing || path.join(root, "deploy", "release-key-ring.json");
  const manifest = explicitManifest || `${DEFAULT_RELEASE_ORIGIN}${DEFAULT_RELEASE_PATH}`;
  const signature = explicitSignature || `${DEFAULT_RELEASE_ORIGIN}${DEFAULT_RELEASE_PATH}.sig`;
  if (anyExplicit && (!explicitKeyRing || !explicitManifest || !explicitSignature)) {
    throw new ReleaseServiceError(
      "RELEASE_CONFIG_INCOMPLETE",
      "Integrated release verification requires a local key-ring file plus manifest and signature URLs."
    );
  }
  const manifestUrl = httpsUrl(manifest, "Release manifest URL");
  const signatureUrl = httpsUrl(signature, "Release signature URL");
  if (manifestUrl.origin !== signatureUrl.origin) {
    throw new ReleaseServiceError(
      "RELEASE_CONFIG_ORIGIN_MISMATCH",
      "Release manifest and signature must use the same trusted HTTPS origin."
    );
  }
  const expectedChannel = environment.CLAUDEX_WORKHOUSE_RELEASE_CHANNEL?.trim() || "stable";
  if (!CHANNEL.test(expectedChannel)) {
    throw new ReleaseServiceError("RELEASE_CONFIG_INVALID", "Release channel is invalid.");
  }
  const repositories = commaValues(environment.CLAUDEX_WORKHOUSE_RELEASE_IMAGE_REPOSITORIES);
  const allowedImageRepositories = repositories.length ? repositories : [DEFAULT_IMAGE_REPOSITORY];
  if (allowedImageRepositories.some((item) => item.includes("@") || item.includes(":latest"))) {
    throw new ReleaseServiceError("RELEASE_CONFIG_INVALID", "Allowed image repositories must not contain a tag or digest.");
  }
  return {
    keyRingFile: path.isAbsolute(keyRing) ? path.normalize(keyRing) : path.resolve(root, keyRing),
    manifestUrl: manifestUrl.href,
    signatureUrl: signatureUrl.href,
    expectedChannel,
    policy: {
      allowedManifestOrigins: [manifestUrl.origin],
      allowedWorkerOrigins: originValues(
        environment.CLAUDEX_WORKHOUSE_RELEASE_WORKER_ORIGINS,
        manifestUrl.origin,
        DEFAULT_ARTIFACT_ORIGIN
      ),
      allowedImageRepositories
    }
  };
}

function previousState(value: unknown): PreviouslyVerifiedRelease | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new ReleaseServiceError("RELEASE_STATE_INVALID", "Stored release state is invalid.");
  }
  const state = value as Record<string, unknown>;
  if (
    state.schemaVersion !== 1 ||
    typeof state.channel !== "string" ||
    !CHANNEL.test(state.channel) ||
    !Number.isSafeInteger(state.releaseSequence) ||
    Number(state.releaseSequence) <= 0 ||
    typeof state.manifestSha256 !== "string" ||
    !SHA256.test(state.manifestSha256)
  ) {
    throw new ReleaseServiceError("RELEASE_STATE_INVALID", "Stored release state is invalid.");
  }
  return {
    channel: state.channel,
    releaseSequence: Number(state.releaseSequence),
    manifestSha256: state.manifestSha256
  };
}

function readKeyRing(file: string): unknown {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size < 2 || stat.size > MAX_KEY_RING_BYTES) {
      throw new Error("key ring is not a bounded regular file");
    }
    return parseReleaseKeyRing(JSON.parse(fs.readFileSync(file, "utf8")) as unknown);
  } catch (error) {
    if (error instanceof ReleaseManifestError) throw error;
    throw new ReleaseServiceError("RELEASE_KEY_RING_INVALID", "Pinned release key ring cannot be read or parsed.");
  }
}

async function readBounded(response: Response, maximum: number, label: string): Promise<Uint8Array> {
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    const size = Number(declared);
    if (!Number.isSafeInteger(size) || size < 1 || size > maximum) {
      throw new ReleaseServiceError("RELEASE_DOWNLOAD_SIZE_INVALID", `${label} Content-Length is invalid.`);
    }
  }
  if (!response.body) throw new ReleaseServiceError("RELEASE_DOWNLOAD_EMPTY", `${label} response has no body.`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      total += item.value.byteLength;
      if (total > maximum) {
        await reader.cancel().catch(() => {});
        throw new ReleaseServiceError("RELEASE_DOWNLOAD_TOO_LARGE", `${label} exceeds its download limit.`);
      }
      chunks.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total < 1) throw new ReleaseServiceError("RELEASE_DOWNLOAD_EMPTY", `${label} response is empty.`);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function acceptanceError(reason: ReleaseStateAcceptance["reason"]): never {
  if (reason === "downgrade") {
    throw new ReleaseManifestError("RELEASE_DOWNGRADE", "Release state changed to a higher sequence during verification.");
  }
  if (reason === "equivocation") {
    throw new ReleaseManifestError("RELEASE_EQUIVOCATION", "Release state observed different bytes at the same sequence.");
  }
  if (reason === "channel-mismatch") {
    throw new ReleaseServiceError("RELEASE_CHANNEL_MISMATCH", "Stored release state belongs to another channel.");
  }
  throw new ReleaseServiceError("RELEASE_STATE_INVALID", "Stored release state could not be accepted.");
}

export class ReleaseService {
  private readonly fetcher: ReleaseFetch;

  constructor(
    private readonly config: ReleaseServiceConfig,
    private readonly store: ReleaseStateStore,
    fetcher: ReleaseFetch = fetch
  ) {
    this.fetcher = fetcher;
  }

  async current(now = new Date()): Promise<VerifiedRelease> {
    const timeoutMs = this.config.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30_000) {
      throw new ReleaseServiceError("RELEASE_CONFIG_INVALID", "Release fetch timeout must be from 1 through 30 seconds.");
    }
    const stored = await this.store.getSystemSetting(RELEASE_STATE_SETTING_KEY);
    const previous = previousState(stored?.value);
    const keyRing = readKeyRing(this.config.keyRingFile);
    const request = async (url: string, maximum: number, label: string) => {
      let response: Response;
      try {
        response = await this.fetcher(url, {
          method: "GET",
          redirect: "error",
          cache: "no-store",
          headers: { accept: "application/octet-stream, application/json;q=0.9" },
          signal: AbortSignal.timeout(timeoutMs)
        });
      } catch {
        throw new ReleaseServiceError("RELEASE_DOWNLOAD_FAILED", `${label} could not be downloaded.`);
      }
      if (!response.ok) {
        throw new ReleaseServiceError("RELEASE_DOWNLOAD_FAILED", `${label} returned HTTP ${response.status}.`);
      }
      if (response.url && new URL(response.url).origin !== new URL(url).origin) {
        throw new ReleaseServiceError("RELEASE_DOWNLOAD_ORIGIN_CHANGED", `${label} response changed trusted origin.`);
      }
      return readBounded(response, maximum, label);
    };
    const [manifestBytes, signatureBytes] = await Promise.all([
      request(this.config.manifestUrl, MAX_MANIFEST_BYTES, "Release manifest"),
      request(this.config.signatureUrl, MAX_SIGNATURE_BYTES, "Release signature")
    ]);
    const verified = verifyReleaseManifest({
      manifestBytes,
      signatureBytes,
      manifestUrl: this.config.manifestUrl,
      signatureUrl: this.config.signatureUrl,
      keyRing,
      policy: this.config.policy,
      previous,
      now
    });
    if (verified.manifest.channel !== this.config.expectedChannel) {
      throw new ReleaseServiceError(
        "RELEASE_CHANNEL_MISMATCH",
        `Expected release channel ${this.config.expectedChannel}, received ${verified.manifest.channel}.`
      );
    }
    const state: PersistedReleaseState = {
      schemaVersion: 1,
      channel: verified.manifest.channel,
      releaseSequence: verified.manifest.releaseSequence,
      version: verified.manifest.version,
      manifestSha256: verified.manifestSha256,
      imageDigest: verified.manifest.server.digest,
      verifiedKeyId: verified.keyId,
      verifiedAt: verified.verifiedAt,
      manifestUrl: verified.manifestUrl
    };
    const accepted = await this.store.acceptReleaseState(state, state.verifiedAt);
    if (!accepted.accepted) acceptanceError(accepted.reason);
    return verified;
  }
}

export function publicReleaseSummary(release: VerifiedRelease) {
  return {
    verification: "verified" as const,
    channel: release.manifest.channel,
    version: release.manifest.version,
    releaseSequence: release.manifest.releaseSequence,
    publishedAt: release.manifest.publishedAt,
    expiresAt: release.manifest.expiresAt,
    server: release.manifest.server,
    workers: release.manifest.workers,
    requirements: release.manifest.requirements,
    keyId: release.keyId,
    manifestSha256: release.manifestSha256,
    verifiedAt: release.verifiedAt
  };
}
