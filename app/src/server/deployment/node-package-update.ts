// The decision half of the npm host updater. Reading a request, checking it
// against the signed release, and describing the outcome are the parts worth
// testing on their own; downloading, installing and restarting live in
// bin/claudex-workhouse-updater.mjs, which is I/O and has to run from a copy of
// itself because the install it performs replaces the package it came from.
//
// The request file is written by the server into a 0700 directory, but it is
// still a file on disk that outlives the process which wrote it. Everything it
// claims about the artifact is therefore re-checked against the manifest the
// updater verifies for itself: the signature is the authority, the request is
// only the instruction to look.
import crypto from "node:crypto";
import type { VerifiedRelease } from "./release-manifest.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const SEMVER = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/;
const MAX_ARTIFACT_BYTES = 512 * 1024 * 1024;

export class NodePackageUpdateError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "NodePackageUpdateError";
  }
}

export interface NodePackageUpdateRequest {
  readonly attemptId: string;
  readonly sourceVersion: string;
  readonly targetVersion: string;
  readonly manifestSha256: string;
  readonly artifact: { readonly url: string; readonly filename: string; readonly size: number; readonly sha256: string };
  readonly manifest: { readonly url: string; readonly signatureUrl: string; readonly signingPublicKeyPem: string; readonly signingPublicKeySha256: string; readonly keyId: string };
}

export type NodePackageUpdateState = "completed" | "rolled-back" | "failed";

function refuse(code: string, message: string): never {
  throw new NodePackageUpdateError(code, message);
}

function httpsUrl(value: unknown, field: string) {
  if (typeof value !== "string") refuse("UPDATE_REQUEST_INVALID", `${field} must be a string.`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    refuse("UPDATE_REQUEST_INVALID", `${field} is not a URL.`);
  }
  if (url.protocol !== "https:") refuse("UPDATE_REQUEST_INVALID", `${field} must be https.`);
  return url.href;
}

export function parseNodePackageUpdateRequest(value: unknown): NodePackageUpdateRequest {
  const input = value as Record<string, any> | null;
  if (!input || typeof input !== "object") refuse("UPDATE_REQUEST_INVALID", "Update request is not an object.");
  if (input.schemaVersion !== 1) refuse("UPDATE_REQUEST_INVALID", "Unsupported update request schema.");
  // Every other install method is somebody else's updater. Attempting one here
  // would install an npm package over a container or a portable tree.
  if (input.installMethod !== "node-package") refuse("UPDATE_REQUEST_UNSUPPORTED", `This updater applies node-package requests only, not ${String(input.installMethod)}.`);
  if (typeof input.attemptId !== "string" || !UUID.test(input.attemptId)) refuse("UPDATE_REQUEST_INVALID", "Attempt id is not a UUID.");
  for (const field of ["sourceVersion", "targetVersion"]) {
    if (typeof input[field] !== "string" || !SEMVER.test(input[field])) refuse("UPDATE_REQUEST_INVALID", `${field} is not a version.`);
  }
  if (typeof input.manifestSha256 !== "string" || !SHA256.test(input.manifestSha256)) refuse("UPDATE_REQUEST_INVALID", "Manifest SHA-256 is invalid.");
  const artifact = input.artifact as Record<string, any> | undefined;
  if (!artifact || typeof artifact !== "object") refuse("UPDATE_REQUEST_INVALID", "Artifact is missing.");
  if (typeof artifact.sha256 !== "string" || !SHA256.test(artifact.sha256)) refuse("UPDATE_REQUEST_INVALID", "Artifact SHA-256 is invalid.");
  if (!Number.isSafeInteger(artifact.size) || artifact.size <= 0 || artifact.size > MAX_ARTIFACT_BYTES) refuse("UPDATE_REQUEST_INVALID", "Artifact size is out of range.");
  // The filename reaches a shell-free npm invocation, but it also becomes a
  // path on disk, so it stays a plain file name.
  if (typeof artifact.filename !== "string" || !/^claudex-workhouse-[0-9]+\.[0-9]+\.[0-9]+\.tgz$/.test(artifact.filename)) refuse("UPDATE_REQUEST_INVALID", "Artifact filename is not an official package name.");
  const manifest = input.manifest as Record<string, any> | undefined;
  if (!manifest || typeof manifest !== "object") refuse("UPDATE_REQUEST_INVALID", "Manifest reference is missing.");
  if (typeof manifest.signingPublicKeyPem !== "string" || !manifest.signingPublicKeyPem.includes("BEGIN PUBLIC KEY")) refuse("UPDATE_REQUEST_INVALID", "Signing public key is not a PEM public key.");
  if (typeof manifest.signingPublicKeySha256 !== "string" || !SHA256.test(manifest.signingPublicKeySha256)) refuse("UPDATE_REQUEST_INVALID", "Signing key SHA-256 is invalid.");
  if (typeof manifest.keyId !== "string" || !/^[A-Za-z0-9._-]{1,80}$/.test(manifest.keyId)) refuse("UPDATE_REQUEST_INVALID", "Signing key id is invalid.");
  const pemDigest = crypto.createHash("sha256").update(manifest.signingPublicKeyPem).digest("hex");
  if (pemDigest !== manifest.signingPublicKeySha256) refuse("UPDATE_REQUEST_INVALID", "Signing public key does not match its digest.");
  return {
    attemptId: input.attemptId,
    sourceVersion: input.sourceVersion,
    targetVersion: input.targetVersion,
    manifestSha256: input.manifestSha256,
    artifact: { url: httpsUrl(artifact.url, "artifact.url"), filename: artifact.filename, size: artifact.size, sha256: artifact.sha256 },
    manifest: {
      url: httpsUrl(manifest.url, "manifest.url"),
      signatureUrl: httpsUrl(manifest.signatureUrl, "manifest.signatureUrl"),
      signingPublicKeyPem: manifest.signingPublicKeyPem,
      signingPublicKeySha256: manifest.signingPublicKeySha256,
      keyId: manifest.keyId
    }
  };
}

// The request said what to install; the signature says what the release is.
// They have to be the same thing, or the file on disk was not describing this
// release and nothing may be installed from it.
export function assertRequestMatchesRelease(request: NodePackageUpdateRequest, release: VerifiedRelease) {
  if (release.manifestSha256 !== request.manifestSha256) refuse("UPDATE_RELEASE_MISMATCH", "Verified manifest is not the one the request named.");
  if (release.keyId !== request.manifest.keyId) refuse("UPDATE_RELEASE_MISMATCH", "Verified release was signed by a different key.");
  if (release.signingPublicKeySha256 !== request.manifest.signingPublicKeySha256) refuse("UPDATE_RELEASE_MISMATCH", "Verified signing key does not match the request.");
  if (release.manifest.version !== request.targetVersion) refuse("UPDATE_RELEASE_MISMATCH", `Verified release is ${release.manifest.version}, not ${request.targetVersion}.`);
  const nodePackage = release.manifest.nodePackage;
  if (!nodePackage) refuse("UPDATE_RELEASE_MISMATCH", "Verified release publishes no node package.");
  if (nodePackage.sha256 !== request.artifact.sha256) refuse("UPDATE_RELEASE_MISMATCH", "Artifact digest does not match the signed release.");
  if (nodePackage.size !== request.artifact.size) refuse("UPDATE_RELEASE_MISMATCH", "Artifact size does not match the signed release.");
  if (nodePackage.filename !== request.artifact.filename) refuse("UPDATE_RELEASE_MISMATCH", "Artifact filename does not match the signed release.");
  if (nodePackage.url !== request.artifact.url) refuse("UPDATE_RELEASE_MISMATCH", "Artifact URL does not match the signed release.");
  return nodePackage;
}

export function assertDownloadedArtifact(bytes: Uint8Array, request: NodePackageUpdateRequest) {
  if (bytes.byteLength !== request.artifact.size) refuse("UPDATE_ARTIFACT_REJECTED", `Downloaded ${bytes.byteLength} bytes, expected ${request.artifact.size}.`);
  const digest = crypto.createHash("sha256").update(bytes).digest("hex");
  if (digest !== request.artifact.sha256) refuse("UPDATE_ARTIFACT_REJECTED", "Downloaded artifact digest does not match the signed release.");
}

export function nodePackageUpdateResult(input: {
  request: Pick<NodePackageUpdateRequest, "attemptId" | "sourceVersion" | "targetVersion" | "manifestSha256">;
  state: NodePackageUpdateState;
  rollbackPerformed: boolean;
  error?: unknown;
  completedAt: string;
}) {
  const message = input.error instanceof Error ? input.error.message : input.error === undefined ? null : String(input.error);
  return {
    schemaVersion: 1 as const,
    attemptId: input.request.attemptId,
    state: input.state,
    sourceVersion: input.request.sourceVersion,
    targetVersion: input.request.targetVersion,
    manifestSha256: input.request.manifestSha256,
    rollbackPerformed: input.rollbackPerformed,
    error: message === null ? null : message.slice(0, 1000),
    completedAt: input.completedAt
  };
}
