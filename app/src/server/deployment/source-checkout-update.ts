// The decision half of the source-checkout updater. A Git checkout has no
// downloadable artifact: the signed release names a version, and the updater in
// bin/claudex-workhouse-source-updater.mjs fast-forwards the checkout to the
// matching release tag, reinstalls, rebuilds and restarts. Reading the request,
// checking it against the signed release, deciding whether the checkout may
// move, and describing the outcome are the parts tested here; the Git, pnpm and
// restart calls are I/O and live in the updater.
//
// The request is a file the server wrote, so everything it claims is checked
// again against the release the updater verifies for itself.
import crypto from "node:crypto";
import type { VerifiedRelease } from "./release-manifest.js";
import { nodePackageUpdateResult, type NodePackageUpdateState } from "./node-package-update.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const SEMVER = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/;
const RELEASE_TAG = /^v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/;

export class SourceCheckoutUpdateError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "SourceCheckoutUpdateError";
  }
}

export interface SourceCheckoutUpdateRequest {
  readonly attemptId: string;
  readonly sourceVersion: string;
  readonly targetVersion: string;
  readonly manifestSha256: string;
  readonly tag: string;
  readonly manifest: { readonly url: string; readonly signatureUrl: string; readonly signingPublicKeyPem: string; readonly signingPublicKeySha256: string; readonly keyId: string };
}

function refuse(code: string, message: string): never {
  throw new SourceCheckoutUpdateError(code, message);
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

export function parseSourceCheckoutUpdateRequest(value: unknown): SourceCheckoutUpdateRequest {
  const input = value as Record<string, any> | null;
  if (!input || typeof input !== "object") refuse("UPDATE_REQUEST_INVALID", "Update request is not an object.");
  if (input.schemaVersion !== 1) refuse("UPDATE_REQUEST_INVALID", "Unsupported update request schema.");
  if (input.installMethod !== "source-checkout") refuse("UPDATE_REQUEST_UNSUPPORTED", `This updater applies source-checkout requests only, not ${String(input.installMethod)}.`);
  if (typeof input.attemptId !== "string" || !UUID.test(input.attemptId)) refuse("UPDATE_REQUEST_INVALID", "Attempt id is not a UUID.");
  for (const field of ["sourceVersion", "targetVersion"]) {
    if (typeof input[field] !== "string" || !SEMVER.test(input[field])) refuse("UPDATE_REQUEST_INVALID", `${field} is not a version.`);
  }
  if (typeof input.manifestSha256 !== "string" || !SHA256.test(input.manifestSha256)) refuse("UPDATE_REQUEST_INVALID", "Manifest SHA-256 is invalid.");
  const tag = input.artifact?.tag;
  // The tag reaches git as a single argument; it must also be exactly the
  // release tag for the target version, never a branch or another ref.
  if (typeof tag !== "string" || !RELEASE_TAG.test(tag) || tag !== `v${input.targetVersion}`) refuse("UPDATE_REQUEST_INVALID", "Release tag does not name the target version.");
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
    tag,
    manifest: {
      url: httpsUrl(manifest.url, "manifest.url"),
      signatureUrl: httpsUrl(manifest.signatureUrl, "manifest.signatureUrl"),
      signingPublicKeyPem: manifest.signingPublicKeyPem,
      signingPublicKeySha256: manifest.signingPublicKeySha256,
      keyId: manifest.keyId
    }
  };
}

export function assertSourceRequestMatchesRelease(request: SourceCheckoutUpdateRequest, release: VerifiedRelease) {
  if (release.manifestSha256 !== request.manifestSha256) refuse("UPDATE_RELEASE_MISMATCH", "Verified manifest is not the one the request named.");
  if (release.keyId !== request.manifest.keyId) refuse("UPDATE_RELEASE_MISMATCH", "Verified release was signed by a different key.");
  if (release.signingPublicKeySha256 !== request.manifest.signingPublicKeySha256) refuse("UPDATE_RELEASE_MISMATCH", "Verified signing key does not match the request.");
  if (release.manifest.version !== request.targetVersion) refuse("UPDATE_RELEASE_MISMATCH", `Verified release is ${release.manifest.version}, not ${request.targetVersion}.`);
}

// What the checkout must look like before it may move. Tracked changes would be
// carried into or lost by the fast-forward, so they stop the update; untracked
// files (scratch work, local data) are left alone. Only a fast-forward is
// allowed: a checkout whose history diverged from the release is a development
// tree, and merging into it is the developer's call, not the updater's.
export function assertCheckoutMayMove(input: { trackedChanges: string; branch: string; headIsAncestorOfTag: boolean; tagPackageVersion: string; request: SourceCheckoutUpdateRequest }) {
  if (input.tagPackageVersion !== input.request.targetVersion) refuse("UPDATE_TAG_MISMATCH", `Tag ${input.request.tag} carries app/package.json ${input.tagPackageVersion}, not ${input.request.targetVersion}.`);
  if (!input.branch) refuse("UPDATE_CHECKOUT_DETACHED", "The checkout is not on a branch.");
  if (input.trackedChanges.trim()) refuse("UPDATE_CHECKOUT_DIRTY", "The checkout has uncommitted changes to tracked files; commit or stash them first.");
  if (!input.headIsAncestorOfTag) refuse("UPDATE_CHECKOUT_DIVERGED", `The checkout's branch ${input.branch} is not behind ${input.request.tag}; it cannot be fast-forwarded.`);
}

export type SourceCheckoutUpdateState = NodePackageUpdateState;
export const sourceCheckoutUpdateResult = nodePackageUpdateResult;
