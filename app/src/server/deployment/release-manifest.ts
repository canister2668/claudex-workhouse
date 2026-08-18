import crypto from "node:crypto";
import { z } from "zod";
import type {
  DeploymentArchitecture,
  TrustedReleaseMetadata,
  TrustedWorkerPackageMetadata
} from "./types.js";

const MAX_MANIFEST_BYTES = 1024 * 1024;
const DEFAULT_MAX_FUTURE_SKEW_MS = 5 * 60_000;
const SHA256 = /^[a-f0-9]{64}$/;
const IMAGE_DIGEST = /^sha256:[a-f0-9]{64}$/;
const IMAGE_REPOSITORY =
  /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[0-9]{2,5})?(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)+$/;
const SEMVER = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const SAFE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SAFE_RELATIVE_PATH = /^[A-Za-z0-9][A-Za-z0-9._ /-]{0,255}$/;
const REQUIREMENT = /^>=([0-9]+)\.([0-9]+)\.([0-9]+)$/;
const RELEASE_CHANNEL = /^[a-z][a-z0-9-]{0,31}$/;
const WORKER_KEYS = ["windows-x64", "linux-x64", "linux-arm64"] as const;
const updaterProtocolSchema=z.number().int().positive().max(1_000_000);

export type ReleaseWorkerKey = typeof WORKER_KEYS[number];
export type ReleaseWorkerPlatform = "windows" | "linux";
export type ReleaseWorkerArchitecture = DeploymentArchitecture;

function canonicalTimestamp() {
  return z.string().superRefine((value, context) => {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "must be a canonical ISO-8601 timestamp" });
    }
  });
}

function strictHttpsUrl(field: string) {
  return z.string().max(2048).superRefine((value, context) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      context.addIssue({ code: z.ZodIssueCode.custom, message: `${field} must be an absolute HTTPS URL` });
      return;
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
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${field} must be a canonical HTTPS URL without credentials, query, hash, or traversal`
      });
    }
  });
}

const safeRelativePathSchema = z.string().max(256).superRefine((value, context) => {
  if (
    !SAFE_RELATIVE_PATH.test(value) ||
    value.startsWith("/") ||
    value.startsWith("\\") ||
    value.includes("\\") ||
    value.split("/").includes("..") ||
    value.split("/").includes(".") ||
    value.includes("//")
  ) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "must be a normalized safe POSIX relative path" });
  }
});

const workerArtifactSchema = z.object({
  platform: z.enum(["windows", "linux"]),
  architecture: z.enum(["x64", "arm64"]),
  format: z.enum(["zip", "tar.gz"]),
  filename: z.string().regex(SAFE_FILE_NAME),
  url: strictHttpsUrl("worker URL"),
  size: z.number().int().positive().max(2 * 1024 * 1024 * 1024),
  sha256: z.string().regex(SHA256),
  minimumUpdaterProtocolVersion:updaterProtocolSchema.optional(),
  entrypoint: safeRelativePathSchema,
  launcher: safeRelativePathSchema.optional()
}).strict();
const nodePackageArtifactSchema=z.object({
  registry:z.literal("https://registry.npmjs.org"),
  name:z.literal("claudex-workhouse"),
  format:z.literal("tgz"),
  filename:z.string().regex(/^claudex-workhouse-\d+\.\d+\.\d+\.tgz$/),
  url:strictHttpsUrl("Node package URL"),
  size:z.number().int().positive().max(2*1024*1024*1024),
  sha256:z.string().regex(SHA256),
  // Optional so a manifest published before the npm distribution became
  // updatable still parses. The updater refuses the target when it is absent
  // rather than guessing that an older contract is compatible.
  minimumUpdaterProtocolVersion:updaterProtocolSchema.optional()
}).strict();
const windowsPortableArtifactSchema=z.object({
  platform:z.literal("windows"),
  architecture:z.literal("x64"),
  format:z.literal("zip"),
  filename:z.literal("claudex-workhouse-server-windows-x64-portable.zip"),
  url:strictHttpsUrl("Windows portable server URL"),
  size:z.number().int().positive().max(2*1024*1024*1024),
  sha256:z.string().regex(SHA256),
  minimumUpdaterProtocolVersion:updaterProtocolSchema
}).strict();
const windowsServerArtifactSchema=z.object({
  platform:z.literal("windows"),
  architecture:z.literal("x64"),
  format:z.literal("exe"),
  filename:z.string().regex(SAFE_FILE_NAME).refine(value=>value.endsWith(".exe"),"must end with .exe"),
  url:strictHttpsUrl("Windows server URL"),
  size:z.number().int().positive().max(2*1024*1024*1024),
  sha256:z.string().regex(SHA256),
  authenticode:z.union([
    z.object({status:z.literal("unsigned")}).strict(),
    z.object({
      status:z.literal("valid"),
      certificateSha256:z.string().regex(SHA256),
      subject:z.string().min(1).max(512),
      timestamped:z.literal(true)
    }).strict()
  ])
}).strict();

const releaseManifestSchema = z.object({
  schemaVersion: z.union([z.literal(1),z.literal(2),z.literal(3)]),
  channel: z.string().regex(RELEASE_CHANNEL),
  version: z.string().regex(SEMVER),
  releaseSequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  publishedAt: canonicalTimestamp(),
  expiresAt: canonicalTimestamp(),
  server: z.object({
    image: z.string().regex(IMAGE_REPOSITORY),
    tag: z.string().regex(SEMVER),
    digest: z.string().regex(IMAGE_DIGEST),
    platforms: z.array(z.enum(["linux/amd64", "linux/arm64"])).length(2),
    minimumUpdaterProtocolVersion:updaterProtocolSchema.optional()
  }).strict(),
  // The npm tarball a release also publishes as an asset, so an installer can
  // verify the bytes it fetched against this signed manifest.
  nodePackage:nodePackageArtifactSchema.optional(),
  windowsServer:windowsServerArtifactSchema.optional(),
  windowsPortable:windowsPortableArtifactSchema.optional(),
  workers: z.object({
    // Optional: Windows targets are in development and a release ships none
    // of them, so a manifest may carry no Windows worker at all.
    "windows-x64": workerArtifactSchema.optional(),
    "linux-x64": workerArtifactSchema,
    "linux-arm64": workerArtifactSchema
  }).strict(),
  requirements: z.object({
    docker: z.string().regex(REQUIREMENT),
    compose: z.string().regex(REQUIREMENT)
  }).strict(),
  legal:z.object({
    license:z.literal("AGPL-3.0-only"),
    notice:z.literal("NOTICE.md"),
    thirdPartyNotices:z.literal("THIRD_PARTY_NOTICES.md")
  }).strict().optional(),
  signing: z.object({
    keyId: z.string().regex(KEY_ID),
    algorithm: z.literal("rsa-sha256")
  }).strict()
}).strict().superRefine((manifest, context) => {
  // A Windows record stays forbidden below the schema version that introduced
  // it, but is no longer required at or above it: Windows targets are in
  // development and a release ships none of them.
  if(manifest.schemaVersion<2&&manifest.windowsServer){
    context.addIssue({code:z.ZodIssueCode.custom,path:["windowsServer"],message:"is supported only by schemaVersion 2 and newer"});
  }
  if(manifest.schemaVersion!==3&&manifest.nodePackage){
    context.addIssue({code:z.ZodIssueCode.custom,path:["nodePackage"],message:"is supported only by schemaVersion 3"});
  }
  if(manifest.schemaVersion!==3&&manifest.windowsPortable){
    context.addIssue({code:z.ZodIssueCode.custom,path:["windowsPortable"],message:"is supported only by schemaVersion 3"});
  }
  if(manifest.schemaVersion===3){
    if(manifest.server.minimumUpdaterProtocolVersion===undefined)context.addIssue({code:z.ZodIssueCode.custom,path:["server","minimumUpdaterProtocolVersion"],message:"is required for schemaVersion 3"});
    for(const key of WORKER_KEYS)if(manifest.workers[key]&&manifest.workers[key].minimumUpdaterProtocolVersion===undefined)context.addIssue({code:z.ZodIssueCode.custom,path:["workers",key,"minimumUpdaterProtocolVersion"],message:"is required for schemaVersion 3"});
  }else{
    if(manifest.server.minimumUpdaterProtocolVersion!==undefined)context.addIssue({code:z.ZodIssueCode.custom,path:["server","minimumUpdaterProtocolVersion"],message:"is supported only by schemaVersion 3"});
    for(const key of WORKER_KEYS)if(manifest.workers[key]?.minimumUpdaterProtocolVersion!==undefined)context.addIssue({code:z.ZodIssueCode.custom,path:["workers",key,"minimumUpdaterProtocolVersion"],message:"is supported only by schemaVersion 3"});
  }
  if (Date.parse(manifest.publishedAt) >= Date.parse(manifest.expiresAt)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["expiresAt"],
      message: "must be later than publishedAt"
    });
  }
  if (manifest.server.tag !== manifest.version) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["server", "tag"],
      message: "must exactly match the release version"
    });
  }
  const platforms = new Set(manifest.server.platforms);
  if (
    platforms.size !== 2 ||
    !platforms.has("linux/amd64") ||
    !platforms.has("linux/arm64")
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["server", "platforms"],
      message: "must bind exactly linux/amd64 and linux/arm64"
    });
  }
  const expected: Record<ReleaseWorkerKey, {
    platform: ReleaseWorkerPlatform;
    architecture: ReleaseWorkerArchitecture;
    format: "zip" | "tar.gz";
    suffix: string;
  }> = {
    "windows-x64": { platform: "windows", architecture: "x64", format: "zip", suffix: ".zip" },
    "linux-x64": { platform: "linux", architecture: "x64", format: "tar.gz", suffix: ".tar.gz" },
    "linux-arm64": { platform: "linux", architecture: "arm64", format: "tar.gz", suffix: ".tar.gz" }
  };
  for (const key of WORKER_KEYS) {
    const worker = manifest.workers[key];
    if (!worker) continue;
    const binding = expected[key];
    if (
      worker.platform !== binding.platform ||
      worker.architecture !== binding.architecture ||
      worker.format !== binding.format
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["workers", key],
        message: `must bind exactly to ${binding.platform}/${binding.architecture}/${binding.format}`
      });
    }
    if (!worker.filename.endsWith(binding.suffix)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["workers", key, "filename"],
        message: `must end with ${binding.suffix}`
      });
    }
    const url = new URL(worker.url);
    if (!url.pathname.endsWith(`/${worker.filename}`)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["workers", key, "url"],
        message: "must end with the bound worker filename"
      });
    }
    if (worker.platform === "windows" && !worker.launcher) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["workers", key, "launcher"],
        message: "is required for the Windows portable worker"
      });
    }
    if (worker.platform === "linux" && worker.launcher !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["workers", key, "launcher"],
        message: "is supported only for the Windows portable worker"
      });
    }
  }
  const workerDirectories = new Set(
    WORKER_KEYS.flatMap((key) => {
      const worker = manifest.workers[key];
      return worker ? [new URL(".", worker.url).href] : [];
    })
  );
  if(manifest.windowsServer){
    const server=manifest.windowsServer;
    if(!new URL(server.url).pathname.endsWith(`/${server.filename}`)){
      context.addIssue({code:z.ZodIssueCode.custom,path:["windowsServer","url"],message:"must end with the bound Windows server filename"});
    }
    workerDirectories.add(new URL(".",server.url).href);
  }
  if(manifest.windowsPortable){
    const portable=manifest.windowsPortable;
    if(!new URL(portable.url).pathname.endsWith(`/${portable.filename}`))context.addIssue({code:z.ZodIssueCode.custom,path:["windowsPortable","url"],message:"must end with the bound Windows portable filename"});
    workerDirectories.add(new URL(".",portable.url).href);
  }
  if (workerDirectories.size !== 1) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["workers"],
      message: "must share one immutable release asset directory"
    });
  }
});

const releaseKeySchema = z.object({
  keyId: z.string().regex(KEY_ID),
  algorithm: z.literal("rsa-sha256"),
  publicKeyPem: z.string().min(1).max(16 * 1024),
  notBefore: canonicalTimestamp(),
  expiresAt: canonicalTimestamp(),
  revoked: z.boolean()
}).strict().superRefine((key, context) => {
  if (Date.parse(key.notBefore) >= Date.parse(key.expiresAt)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["expiresAt"],
      message: "must be later than notBefore"
    });
  }
});

const releaseKeyRingSchema = z.object({
  schemaVersion: z.literal(1),
  keys: z.array(releaseKeySchema).min(1).max(32)
}).strict().superRefine((ring, context) => {
  const seen = new Set<string>();
  ring.keys.forEach((key, index) => {
    if (seen.has(key.keyId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["keys", index, "keyId"],
        message: "must be unique"
      });
    }
    seen.add(key.keyId);
  });
});

export type ReleaseManifest = Readonly<z.infer<typeof releaseManifestSchema>>;
export type ReleaseKey = Readonly<z.infer<typeof releaseKeySchema>>;
export type ReleaseKeyRing = Readonly<z.infer<typeof releaseKeyRingSchema>>;

export interface PreviouslyVerifiedRelease {
  readonly channel: string;
  readonly releaseSequence: number;
  readonly manifestSha256: string;
}

export interface ReleaseVerificationPolicy {
  readonly allowedManifestOrigins: readonly string[];
  readonly allowedWorkerOrigins: readonly string[];
  readonly allowedImageRepositories: readonly string[];
}

export interface VerifyReleaseManifestInput {
  readonly manifestBytes: Uint8Array;
  readonly signatureBytes: Uint8Array;
  readonly manifestUrl: string;
  readonly signatureUrl: string;
  readonly keyRing: unknown;
  readonly policy: ReleaseVerificationPolicy;
  readonly previous?: PreviouslyVerifiedRelease | null;
  readonly now?: Date;
  readonly maxFutureSkewMs?: number;
}

export interface VerifiedRelease {
  readonly manifest: ReleaseManifest;
  readonly manifestUrl: string;
  readonly signatureUrl: string;
  readonly manifestSha256: string;
  readonly keyId: string;
  readonly signingPublicKeyPem: string;
  readonly signingPublicKeySha256: string;
  readonly verifiedAt: string;
}

export class ReleaseManifestError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ReleaseManifestError";
  }
}

function parseWith<T>(schema: z.ZodType<T>, input: unknown, code: string, label: string): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.length ? ` at ${issue.path.join(".")}` : "";
    throw new ReleaseManifestError(code, `${label} is invalid${path}: ${issue?.message ?? "unknown validation error"}.`);
  }
  return parsed.data;
}

function frozen<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) frozen(child);
  return Object.freeze(value);
}

export function parseReleaseManifest(input: unknown): ReleaseManifest {
  return frozen(parseWith(releaseManifestSchema, input, "MANIFEST_INVALID", "Release manifest"));
}

export function parseReleaseKeyRing(input: unknown): ReleaseKeyRing {
  const ring = parseWith(releaseKeyRingSchema, input, "KEY_RING_INVALID", "Release key ring");
  for (const key of ring.keys) {
    let parsed: crypto.KeyObject;
    try {
      parsed = crypto.createPublicKey(key.publicKeyPem);
    } catch {
      throw new ReleaseManifestError("KEY_RING_INVALID", `Release key ${key.keyId} is not a parseable public key.`);
    }
    if (parsed.asymmetricKeyType !== "rsa") {
      throw new ReleaseManifestError("KEY_RING_INVALID", `Release key ${key.keyId} must be an RSA public key.`);
    }
  }
  return frozen(ring);
}

function canonicalHttpsUrl(value: string, field: string): string {
  const parsed = strictHttpsUrl(field).safeParse(value);
  if (!parsed.success) throw new ReleaseManifestError("URL_INVALID", parsed.error.issues[0]?.message ?? `${field} is invalid.`);
  return value;
}

function normalizedOrigins(values: readonly string[], field: string): Set<string> {
  if (!Array.isArray(values) || values.length === 0) {
    throw new ReleaseManifestError("POLICY_INVALID", `${field} must contain at least one trusted HTTPS origin.`);
  }
  const origins = new Set<string>();
  for (const value of values) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new ReleaseManifestError("POLICY_INVALID", `${field} entries must be HTTPS origins.`);
    }
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      throw new ReleaseManifestError("POLICY_INVALID", `${field} entries must be HTTPS origins without a path.`);
    }
    origins.add(url.origin);
  }
  return origins;
}

function assertPolicy(manifest: ReleaseManifest, manifestUrl: string, signatureUrl: string, policy: ReleaseVerificationPolicy): void {
  const manifestOrigins = normalizedOrigins(policy.allowedManifestOrigins, "allowedManifestOrigins");
  const workerOrigins = normalizedOrigins(policy.allowedWorkerOrigins, "allowedWorkerOrigins");
  if (!Array.isArray(policy.allowedImageRepositories) || policy.allowedImageRepositories.length === 0) {
    throw new ReleaseManifestError("POLICY_INVALID", "allowedImageRepositories must contain at least one repository.");
  }
  const manifestOrigin = new URL(manifestUrl).origin;
  if (!manifestOrigins.has(manifestOrigin) || !manifestOrigins.has(new URL(signatureUrl).origin)) {
    throw new ReleaseManifestError("MANIFEST_ORIGIN_REJECTED", "Manifest and signature origins are not trusted by release policy.");
  }
  if (!policy.allowedImageRepositories.includes(manifest.server.image)) {
    throw new ReleaseManifestError("IMAGE_REPOSITORY_REJECTED", "Server image repository is not trusted by release policy.");
  }
  for (const key of WORKER_KEYS) {
    const worker = manifest.workers[key];
    if (!worker) continue;
    if (!workerOrigins.has(new URL(worker.url).origin)) {
      throw new ReleaseManifestError("WORKER_ORIGIN_REJECTED", `Worker artifact origin is not trusted for ${key}.`);
    }
  }
  if(manifest.windowsServer&&!workerOrigins.has(new URL(manifest.windowsServer.url).origin)){
    throw new ReleaseManifestError("WINDOWS_SERVER_ORIGIN_REJECTED","Windows server artifact origin is not trusted.");
  }
  if(manifest.windowsPortable&&!workerOrigins.has(new URL(manifest.windowsPortable.url).origin))throw new ReleaseManifestError("WINDOWS_PORTABLE_ORIGIN_REJECTED","Windows portable server artifact origin is not trusted.");
}

function validatedPrevious(previous: PreviouslyVerifiedRelease | null | undefined): PreviouslyVerifiedRelease | null {
  if (previous === undefined || previous === null) return null;
  if (
    typeof previous.channel !== "string" ||
    !RELEASE_CHANNEL.test(previous.channel) ||
    !Number.isSafeInteger(previous.releaseSequence) ||
    previous.releaseSequence <= 0 ||
    !SHA256.test(previous.manifestSha256)
  ) {
    throw new ReleaseManifestError("PREVIOUS_STATE_INVALID", "Previously verified release state is invalid.");
  }
  return previous;
}

function decodeManifest(bytes: Uint8Array): unknown {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 2 || bytes.byteLength > MAX_MANIFEST_BYTES) {
    throw new ReleaseManifestError("MANIFEST_SIZE_INVALID", `Release manifest must be between 2 and ${MAX_MANIFEST_BYTES} bytes.`);
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ReleaseManifestError("MANIFEST_ENCODING_INVALID", "Release manifest must be valid UTF-8.");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ReleaseManifestError("MANIFEST_JSON_INVALID", "Release manifest must contain valid JSON.");
  }
}

export function verifyReleaseManifest(input: VerifyReleaseManifestInput): VerifiedRelease {
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new ReleaseManifestError("TIME_INVALID", "Verification time is invalid.");
  const maxFutureSkewMs = input.maxFutureSkewMs ?? DEFAULT_MAX_FUTURE_SKEW_MS;
  if (!Number.isSafeInteger(maxFutureSkewMs) || maxFutureSkewMs < 0 || maxFutureSkewMs > 60 * 60_000) {
    throw new ReleaseManifestError("POLICY_INVALID", "maxFutureSkewMs must be from zero through one hour.");
  }
  if (!(input.signatureBytes instanceof Uint8Array) || input.signatureBytes.byteLength < 64 || input.signatureBytes.byteLength > 16 * 1024) {
    throw new ReleaseManifestError("SIGNATURE_SIZE_INVALID", "Detached signature size is invalid.");
  }

  const manifestUrl = canonicalHttpsUrl(input.manifestUrl, "manifestUrl");
  const signatureUrl = canonicalHttpsUrl(input.signatureUrl, "signatureUrl");
  const manifest = parseReleaseManifest(decodeManifest(input.manifestBytes));
  const keyRing = parseReleaseKeyRing(input.keyRing);
  const key = keyRing.keys.find((candidate) => candidate.keyId === manifest.signing.keyId);
  if (!key) throw new ReleaseManifestError("KEY_UNKNOWN", `Release signing key is not trusted: ${manifest.signing.keyId}.`);
  if (key.revoked) throw new ReleaseManifestError("KEY_REVOKED", `Release signing key has been revoked: ${key.keyId}.`);

  const nowMs = now.getTime();
  const keyNotBefore = Date.parse(key.notBefore);
  const keyExpiresAt = Date.parse(key.expiresAt);
  if (nowMs < keyNotBefore) throw new ReleaseManifestError("KEY_NOT_YET_VALID", `Release signing key is not active yet: ${key.keyId}.`);
  if (nowMs >= keyExpiresAt) throw new ReleaseManifestError("KEY_EXPIRED", `Release signing key has expired: ${key.keyId}.`);

  const raw = Buffer.from(input.manifestBytes.buffer, input.manifestBytes.byteOffset, input.manifestBytes.byteLength);
  const signature = Buffer.from(input.signatureBytes.buffer, input.signatureBytes.byteOffset, input.signatureBytes.byteLength);
  const signatureValid = crypto.verify(
    "RSA-SHA256",
    raw,
    { key: key.publicKeyPem, padding: crypto.constants.RSA_PKCS1_PADDING },
    signature
  );
  if (!signatureValid) throw new ReleaseManifestError("SIGNATURE_INVALID", "Release manifest detached signature verification failed.");

  const publishedAt = Date.parse(manifest.publishedAt);
  const expiresAt = Date.parse(manifest.expiresAt);
  if (publishedAt > nowMs + maxFutureSkewMs) {
    throw new ReleaseManifestError("MANIFEST_FROM_FUTURE", "Release manifest publishedAt is too far in the future.");
  }
  if (expiresAt <= nowMs) throw new ReleaseManifestError("MANIFEST_EXPIRED", "Release manifest has expired.");
  if (publishedAt < keyNotBefore || publishedAt >= keyExpiresAt || expiresAt > keyExpiresAt) {
    throw new ReleaseManifestError("KEY_VALIDITY_MISMATCH", "Release manifest validity is outside the signing key validity window.");
  }

  assertPolicy(manifest, manifestUrl, signatureUrl, input.policy);
  const manifestSha256 = crypto.createHash("sha256").update(raw).digest("hex");
  const previous = validatedPrevious(input.previous);
  if (previous?.channel === manifest.channel) {
    if (manifest.releaseSequence < previous.releaseSequence) {
      throw new ReleaseManifestError("RELEASE_DOWNGRADE", "Release sequence is lower than the previously verified sequence.");
    }
    if (
      manifest.releaseSequence === previous.releaseSequence &&
      manifestSha256 !== previous.manifestSha256
    ) {
      throw new ReleaseManifestError("RELEASE_EQUIVOCATION", "The same release sequence was observed with different signed bytes.");
    }
  }

  const normalizedPublicKey = crypto.createPublicKey(key.publicKeyPem).export({
    type: "spki",
    format: "pem"
  }).toString();
  return frozen({
    manifest,
    manifestUrl,
    signatureUrl,
    manifestSha256,
    keyId: key.keyId,
    signingPublicKeyPem: normalizedPublicKey,
    signingPublicKeySha256: crypto.createHash("sha256").update(normalizedPublicKey, "utf8").digest("hex"),
    verifiedAt: now.toISOString()
  });
}

export function toTrustedReleaseMetadata(release: VerifiedRelease): TrustedReleaseMetadata {
  // Any worker URL fixes the immutable per-release asset directory. The
  // Windows worker is optional, so fall back to a worker that always ships.
  const immutableBase = new URL(".", (release.manifest.workers["windows-x64"] ?? release.manifest.workers["linux-x64"]).url);
  return frozen({
    schemaVersion: 1,
    version: release.manifest.version,
    image: {
      repository: release.manifest.server.image,
      digest: release.manifest.server.digest
    },
    manifest: {
      url: new URL("release-manifest.json", immutableBase).href,
      signatureUrl: new URL("release-manifest.json.sig", immutableBase).href,
      channelUrl: release.manifestUrl,
      channelSignatureUrl: release.signatureUrl,
      sha256: release.manifestSha256,
      signatureAlgorithm: "rsa-sha256",
      signingPublicKeySha256: release.signingPublicKeySha256,
      signingPublicKeyPem: release.signingPublicKeyPem
    }
  });
}

export function toTrustedWorkerPackageMetadata(
  release: VerifiedRelease,
  platform: ReleaseWorkerPlatform,
  architecture: ReleaseWorkerArchitecture
): TrustedWorkerPackageMetadata {
  const key = `${platform}-${architecture}` as ReleaseWorkerKey;
  if (!WORKER_KEYS.includes(key)) {
    throw new ReleaseManifestError("WORKER_UNSUPPORTED", `No public Worker package is supported for ${platform}/${architecture}.`);
  }
  const worker = release.manifest.workers[key];
  if (!worker) {
    throw new ReleaseManifestError("WORKER_UNSUPPORTED", `This release ships no Worker package for ${platform}/${architecture}.`);
  }
  const immutableBase = new URL(".", worker.url);
  return frozen({
    schemaVersion: 1,
    version: release.manifest.version,
    platform,
    architecture,
    format: worker.format,
    artifact: {
      url: worker.url,
      sha256: worker.sha256,
      size: worker.size,
      minimumUpdaterProtocolVersion:worker.minimumUpdaterProtocolVersion??1,
      fileName: worker.filename,
      entrypoint: worker.entrypoint,
      ...(worker.launcher ? { launcher: worker.launcher } : {})
    },
    manifest: {
      url: new URL("release-manifest.json", immutableBase).href,
      signatureUrl: new URL("release-manifest.json.sig", immutableBase).href,
      channelUrl: release.manifestUrl,
      channelSignatureUrl: release.signatureUrl,
      sha256: release.manifestSha256,
      signatureAlgorithm: "rsa-sha256",
      signingPublicKeySha256: release.signingPublicKeySha256,
      signingPublicKeyPem: release.signingPublicKeyPem
    }
  });
}
