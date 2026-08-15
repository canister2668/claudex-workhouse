#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  verifyReleaseManifest,
  type ReleaseVerificationPolicy,
  type VerifiedRelease
} from "../src/server/deployment/release-manifest.js";

const SHA256 = /^[a-f0-9]{64}$/;
const GIT_SHA = /^[a-f0-9]{40,64}$/;
const STABLE_VERSION = /^([0-9]+)\.([0-9]+)\.([0-9]+)$/;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_SIGNATURE_BYTES = 64 * 1024;
const API_VERSION = "2026-03-10";
const MAX_RELEASE_PAGES = 100;

export type PromotionPhase =
  | "prepare"
  | "stage"
  | "publish"
  | "promote"
  | "finalize";

export interface ChannelState {
  readonly version: string;
  readonly releaseSequence: number;
  readonly manifestSha256: string;
}

export interface ReleaseListing {
  readonly tagName: string;
  readonly isDraft: boolean;
  readonly isPrerelease: boolean;
}

export interface ReleaseAssetInventoryItem {
  readonly name: string;
  readonly size: number;
  readonly sha256: string;
}

export interface RemoteReleaseAsset {
  readonly name: string;
  readonly size: number;
  readonly digest: string | null;
  readonly state: string;
}

export interface PromotionGuardInput {
  readonly phase: PromotionPhase;
  readonly live: ChannelState | null;
  readonly expectedPrevious: ChannelState | null;
  readonly next: ChannelState;
  readonly currentTag: string;
  readonly releases: readonly ReleaseListing[];
}

export interface PromotionGuardResult {
  readonly action: "proceed" | "already-applied";
  readonly live: ChannelState | null;
}

type ApiRequest = (path: string) => Promise<unknown>;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function positiveInteger(value: string, name: string): number {
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`${name} must be a positive integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${name} exceeds the safe integer range.`);
  }
  return parsed;
}

function promotionPhase(value: string): PromotionPhase {
  if (
    value !== "prepare" &&
    value !== "stage" &&
    value !== "publish" &&
    value !== "promote" &&
    value !== "finalize"
  ) {
    throw new Error("CLAUDEX_WORKHOUSE_PROMOTION_PHASE is invalid.");
  }
  return value;
}

function stableVersionParts(value: string): readonly [number, number, number] {
  const match = STABLE_VERSION.exec(value);
  if (!match) {
    throw new Error(`Stable release versions must be MAJOR.MINOR.PATCH: ${value}`);
  }
  const parts = match.slice(1).map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part))) {
    throw new Error(`Stable release version exceeds the safe integer range: ${value}`);
  }
  return parts as unknown as readonly [number, number, number];
}

function compareVersions(left: string, right: string): number {
  const leftParts = stableVersionParts(left);
  const rightParts = stableVersionParts(right);
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] < rightParts[index] ? -1 : 1;
    }
  }
  return 0;
}

function validState(value: ChannelState | null, label: string): ChannelState | null {
  if (value === null) return null;
  stableVersionParts(value.version);
  if (!Number.isSafeInteger(value.releaseSequence) || value.releaseSequence < 1) {
    throw new Error(`${label} release sequence is invalid.`);
  }
  if (!SHA256.test(value.manifestSha256)) {
    throw new Error(`${label} manifest SHA-256 is invalid.`);
  }
  return value;
}

function sameState(left: ChannelState | null, right: ChannelState | null): boolean {
  return left === null
    ? right === null
    : right !== null &&
      left.version === right.version &&
      left.releaseSequence === right.releaseSequence &&
      left.manifestSha256 === right.manifestSha256;
}

function describeState(value: ChannelState | null): string {
  return value === null
    ? "no stable release"
    : `${value.version}/sequence-${value.releaseSequence}/${value.manifestSha256}`;
}

function normalizeReleaseListing(value: unknown): ReleaseListing {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("GitHub release listing contains an invalid item.");
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.tagName !== "string" ||
    typeof record.isDraft !== "boolean" ||
    typeof record.isPrerelease !== "boolean"
  ) {
    throw new Error("GitHub release listing contains invalid fields.");
  }
  return {
    tagName: record.tagName,
    isDraft: record.isDraft,
    isPrerelease: record.isPrerelease
  };
}

function stableReleaseVersion(tagName: string): string | null {
  const version = tagName.startsWith("v") ? tagName.slice(1) : "";
  return STABLE_VERSION.test(version) ? version : null;
}

export function assertPromotionState(input: PromotionGuardInput): PromotionGuardResult {
  const previous = validState(input.expectedPrevious, "Expected previous");
  const next = validState(input.next, "Next");
  const live = validState(input.live, "Live");
  stableVersionParts(next.version);
  if (input.currentTag !== `v${next.version}`) {
    throw new Error("Release tag does not exactly match the next stable version.");
  }
  const expectedSequence = previous === null ? 1 : previous.releaseSequence + 1;
  if (next.releaseSequence !== expectedSequence) {
    throw new Error(
      `Next release sequence ${next.releaseSequence} must be ${expectedSequence}.`
    );
  }
  if (previous !== null && compareVersions(next.version, previous.version) <= 0) {
    throw new Error(
      `Next stable version ${next.version} must be greater than ${previous.version}.`
    );
  }

  let action: PromotionGuardResult["action"] = "proceed";
  if (input.phase === "finalize") {
    if (!sameState(live, next)) {
      throw new Error(
        `Live stable state is stale: expected ${describeState(next)}, received ${describeState(live)}.`
      );
    }
  } else if (input.phase === "promote" && sameState(live, next)) {
    action = "already-applied";
  } else if (!sameState(live, previous)) {
    throw new Error(
      `Live stable state changed: expected ${describeState(previous)}, received ${describeState(live)}.`
    );
  }

  const releases = input.releases.map(normalizeReleaseListing);
  const tags = new Set<string>();
  for (const release of releases) {
    if (tags.has(release.tagName)) {
      throw new Error(`GitHub returned duplicate release tag ${release.tagName}.`);
    }
    tags.add(release.tagName);
  }
  const stableReleases = releases.flatMap((release) => {
    const version = stableReleaseVersion(release.tagName);
    if (!version) return [];
    if (release.isPrerelease) {
      throw new Error(`Stable release tag ${release.tagName} must not be a prerelease.`);
    }
    return [{ ...release, version }];
  });
  const current = stableReleases.find((release) => release.tagName === input.currentTag);
  for (const release of stableReleases) {
    if (release.isDraft && release.tagName !== input.currentTag) {
      throw new Error(`Another stable draft is pending: ${release.tagName}.`);
    }
  }

  if (input.phase === "prepare") {
    if (current && !current.isDraft) {
      throw new Error(`Immutable release ${input.currentTag} is already published.`);
    }
  } else if (input.phase === "stage") {
    if (!current?.isDraft) {
      throw new Error(`Stage deployment requires the current draft ${input.currentTag}.`);
    }
  } else if (input.phase === "publish") {
    if (!current) {
      throw new Error(`Release ${input.currentTag} does not exist.`);
    }
  } else if (!current || current.isDraft) {
    throw new Error(`${input.phase} requires published release ${input.currentTag}.`);
  }

  for (const release of stableReleases) {
    if (release.isDraft) continue;
    if (live !== null && compareVersions(release.version, live.version) === 0) {
      if (release.tagName !== `v${live.version}`) {
        throw new Error(
          `Published release ${release.tagName} conflicts with live stable ${live.version}.`
        );
      }
      continue;
    }
    const aheadOfLive = live === null || compareVersions(release.version, live.version) > 0;
    if (!aheadOfLive) continue;
    const ownPendingRelease =
      release.tagName === input.currentTag &&
      (input.phase === "publish" ||
        input.phase === "promote" ||
        input.phase === "finalize");
    if (!ownPendingRelease) {
      throw new Error(
        `Published release ${release.tagName} has not been safely promoted from the live stable channel.`
      );
    }
  }

  return { action, live };
}

function hashFile(file: string): string {
  const hash = crypto.createHash("sha256");
  const descriptor = fs.openSync(file, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const count = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      hash.update(buffer.subarray(0, count));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest("hex");
}

function compareNames(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

// Windows targets are in development and a release ships none of them, so the
// inventory lists only what is published. Restoring them here is part of
// releasing Windows again.
export function expectedReleaseAssetNames(version: string): readonly string[] {
  stableVersionParts(version);
  return [
    "SHA256SUMS",
    `claudex-workhouse-installer-site-${version}.tar.gz`,
    "claudex-workhouse-worker-linux-arm64.tar.gz",
    "claudex-workhouse-worker-linux-arm64.tar.gz.spdx.json",
    "claudex-workhouse-worker-linux-x64.tar.gz",
    "claudex-workhouse-worker-linux-x64.tar.gz.spdx.json",
    "release-manifest.json",
    "release-manifest.json.sig"
  ].sort(compareNames);
}

export function createReleaseAssetInventory(
  directory: string,
  version: string
): readonly ReleaseAssetInventoryItem[] {
  const resolved = path.resolve(directory);
  const status = fs.lstatSync(resolved);
  if (!status.isDirectory()) throw new Error("Release asset directory is unavailable.");
  const expected = expectedReleaseAssetNames(version);
  const actual = fs.readdirSync(resolved).sort(compareNames);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Release asset directory must contain exactly: ${expected.join(", ")}.`
    );
  }
  return expected.map((name) => {
    const file = path.join(resolved, name);
    const fileStatus = fs.lstatSync(file);
    if (!fileStatus.isFile() || fileStatus.size <= 0 || fileStatus.size > 2 * 1024 * 1024 * 1024) {
      throw new Error(`${name} must be a non-empty bounded regular file.`);
    }
    return { name, size: fileStatus.size, sha256: hashFile(file) };
  });
}

function normalizeExpectedInventory(value: unknown): readonly ReleaseAssetInventoryItem[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Expected release asset inventory must be a non-empty array.");
  }
  const names = new Set<string>();
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Expected release asset inventory contains an invalid item.");
    }
    const record = item as Record<string, unknown>;
    if (
      typeof record.name !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(record.name) ||
      !Number.isSafeInteger(record.size) ||
      Number(record.size) <= 0 ||
      Number(record.size) > 2 * 1024 * 1024 * 1024 ||
      typeof record.sha256 !== "string" ||
      !SHA256.test(record.sha256) ||
      names.has(record.name)
    ) {
      throw new Error("Expected release asset inventory contains invalid fields.");
    }
    names.add(record.name);
    return {
      name: record.name,
      size: Number(record.size),
      sha256: record.sha256
    };
  }).sort((left, right) => compareNames(left.name, right.name));
}

export function assertExactReleaseAssets(
  expectedInput: unknown,
  remoteInput: readonly RemoteReleaseAsset[]
): void {
  const expected = normalizeExpectedInventory(expectedInput);
  const remote = remoteInput.map((item) => {
    if (
      !item ||
      typeof item.name !== "string" ||
      !Number.isSafeInteger(item.size) ||
      item.size <= 0 ||
      typeof item.state !== "string" ||
      (item.digest !== null && typeof item.digest !== "string")
    ) {
      throw new Error("GitHub release contains an invalid asset record.");
    }
    return item;
  }).sort((left, right) => compareNames(left.name, right.name));
  if (
    remote.length !== expected.length ||
    JSON.stringify(remote.map((item) => item.name)) !==
      JSON.stringify(expected.map((item) => item.name))
  ) {
    throw new Error("GitHub draft release asset names do not match the exact allowlist.");
  }
  for (let index = 0; index < expected.length; index += 1) {
    const wanted = expected[index];
    const actual = remote[index];
    if (
      actual.state !== "uploaded" ||
      actual.size !== wanted.size ||
      actual.digest !== `sha256:${wanted.sha256}`
    ) {
      throw new Error(`GitHub release asset ${wanted.name} does not match its expected digest.`);
    }
  }
}

async function boundedResponseBytes(response: Response, maximum: number, label: string): Promise<Buffer> {
  const length = response.headers.get("content-length");
  if (length !== null) {
    const parsed = Number(length);
    if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > maximum) {
      throw new Error(`${label} has an invalid Content-Length.`);
    }
  }
  if (!response.body) throw new Error(`${label} response body is unavailable.`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const value = await reader.read();
    if (value.done) break;
    total += value.value.byteLength;
    if (total > maximum) {
      await reader.cancel();
      throw new Error(`${label} exceeds its download limit.`);
    }
    chunks.push(value.value);
  }
  if (total <= 0) throw new Error(`${label} is empty.`);
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
}

async function fetchStableRelease(input: {
  manifestUrl: string;
  signatureUrl: string;
  keyRingFile: string;
  policy: ReleaseVerificationPolicy;
}): Promise<VerifiedRelease | null> {
  const cacheNonce = crypto.randomBytes(16).toString("hex");
  const uncachedUrl = (value: string, suffix: string): string => {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new Error("Stable release URLs must be trusted canonical HTTPS URLs.");
    }
    url.searchParams.set("claudex-release-guard", `${cacheNonce}-${suffix}`);
    return url.href;
  };
  const [manifestResponse, signatureResponse] = await Promise.all([
    fetch(uncachedUrl(input.manifestUrl, "manifest"), {
      redirect: "follow",
      cache: "no-store",
      headers: { "Cache-Control": "no-cache", Pragma: "no-cache" }
    }),
    fetch(uncachedUrl(input.signatureUrl, "signature"), {
      redirect: "follow",
      cache: "no-store",
      headers: { "Cache-Control": "no-cache", Pragma: "no-cache" }
    })
  ]);
  if (manifestResponse.status === 404 && signatureResponse.status === 404) return null;
  if (!manifestResponse.ok || !signatureResponse.ok) {
    throw new Error(
      `Stable manifest/signature fetch was inconsistent: ${manifestResponse.status}/${signatureResponse.status}.`
    );
  }
  for (const [response, label] of [
    [manifestResponse, "Stable manifest"],
    [signatureResponse, "Stable signature"]
  ] as const) {
    const finalUrl = new URL(response.url);
    if (finalUrl.protocol !== "https:" || finalUrl.username || finalUrl.password) {
      throw new Error(`${label} redirected outside HTTPS.`);
    }
  }
  const [manifestBytes, signatureBytes] = await Promise.all([
    boundedResponseBytes(manifestResponse, MAX_MANIFEST_BYTES, "Stable manifest"),
    boundedResponseBytes(signatureResponse, MAX_SIGNATURE_BYTES, "Stable signature")
  ]);
  const keyRing = JSON.parse(fs.readFileSync(input.keyRingFile, "utf8"));
  return verifyReleaseManifest({
    manifestBytes,
    signatureBytes,
    manifestUrl: input.manifestUrl,
    signatureUrl: input.signatureUrl,
    keyRing,
    policy,
    now: new Date()
  });
}

function githubHeaders(token: string): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": API_VERSION,
    "User-Agent": "claudex-workhouse-release-guard"
  };
}

function repositoryName(value: string): string {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) {
    throw new Error("GITHUB_REPOSITORY is invalid.");
  }
  return value;
}

async function githubApi(pathName: string, token: string): Promise<unknown> {
  const response = await fetch(`https://api.github.com/${pathName}`, {
    headers: githubHeaders(token),
    redirect: "error",
    cache: "no-store"
  });
  if (!response.ok) {
    throw new Error(`GitHub API request failed with HTTP ${response.status}.`);
  }
  const bytes = await boundedResponseBytes(response, 8 * 1024 * 1024, "GitHub API response");
  return JSON.parse(bytes.toString("utf8"));
}

async function listStableReleases(
  repository: string,
  request: ApiRequest
): Promise<readonly ReleaseListing[]> {
  const releases: ReleaseListing[] = [];
  for (let page = 1; page <= MAX_RELEASE_PAGES; page += 1) {
    const value = await request(
      `repos/${repository}/releases?per_page=100&page=${page}`
    );
    if (!Array.isArray(value)) throw new Error("GitHub releases response is invalid.");
    for (const item of value) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new Error("GitHub releases response contains an invalid item.");
      }
      const record = item as Record<string, unknown>;
      releases.push(normalizeReleaseListing({
        tagName: record.tag_name,
        isDraft: record.draft,
        isPrerelease: record.prerelease
      }));
    }
    if (value.length < 100) return releases;
  }
  throw new Error("GitHub releases pagination exceeded the safety limit.");
}

export async function getReleaseByTagIncludingDrafts(
  repository: string,
  tag: string,
  request: ApiRequest
): Promise<Record<string, unknown>> {
  repositoryName(repository);
  if (!/^v[0-9]+\.[0-9]+\.[0-9]+$/.test(tag)) {
    throw new Error("Release tag is invalid.");
  }
  let releaseId: number | null = null;
  for (let page = 1; page <= MAX_RELEASE_PAGES; page += 1) {
    const value = await request(
      `repos/${repository}/releases?per_page=100&page=${page}`
    );
    if (!Array.isArray(value)) throw new Error("GitHub releases response is invalid.");
    for (const item of value) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new Error("GitHub releases response contains an invalid item.");
      }
      const record = item as Record<string, unknown>;
      if (record.tag_name !== tag) continue;
      if (!Number.isSafeInteger(record.id) || Number(record.id) <= 0 || releaseId !== null) {
        throw new Error(`GitHub release ${tag} has an invalid or duplicate release ID.`);
      }
      releaseId = Number(record.id);
    }
    if (releaseId !== null) break;
    if (value.length < 100) break;
    if (page === MAX_RELEASE_PAGES) {
      throw new Error("GitHub releases pagination exceeded the safety limit.");
    }
  }
  if (releaseId === null) throw new Error(`GitHub release ${tag} does not exist.`);
  const release = await request(`repos/${repository}/releases/${releaseId}`);
  if (!release || typeof release !== "object" || Array.isArray(release)) {
    throw new Error("GitHub release response is invalid.");
  }
  const record = release as Record<string, unknown>;
  if (
    record.id !== releaseId ||
    record.tag_name !== tag ||
    typeof record.draft !== "boolean" ||
    typeof record.prerelease !== "boolean"
  ) {
    throw new Error("GitHub release detail does not match the selected release.");
  }
  return record;
}

export async function resolveRemoteTagCommit(
  repository: string,
  tag: string,
  request: ApiRequest
): Promise<string> {
  if (!/^v[0-9]+\.[0-9]+\.[0-9]+$/.test(tag)) {
    throw new Error("Release tag is invalid.");
  }
  const reference = await request(
    `repos/${repository}/git/ref/tags/${encodeURIComponent(tag)}`
  );
  if (!reference || typeof reference !== "object" || Array.isArray(reference)) {
    throw new Error("GitHub tag reference is invalid.");
  }
  let object = (reference as Record<string, unknown>).object;
  for (let depth = 0; depth < 8; depth += 1) {
    if (!object || typeof object !== "object" || Array.isArray(object)) {
      throw new Error("GitHub tag object is invalid.");
    }
    const record = object as Record<string, unknown>;
    if (typeof record.type !== "string" || typeof record.sha !== "string" || !GIT_SHA.test(record.sha)) {
      throw new Error("GitHub tag object contains invalid fields.");
    }
    if (record.type === "commit") return record.sha;
    if (record.type !== "tag") throw new Error(`Unsupported Git tag object type: ${record.type}.`);
    const annotated = await request(`repos/${repository}/git/tags/${record.sha}`);
    if (!annotated || typeof annotated !== "object" || Array.isArray(annotated)) {
      throw new Error("Annotated Git tag response is invalid.");
    }
    object = (annotated as Record<string, unknown>).object;
  }
  throw new Error("Annotated Git tag nesting exceeded the safety limit.");
}

function channelState(release: VerifiedRelease | null): ChannelState | null {
  return release === null
    ? null
    : {
        version: release.manifest.version,
        releaseSequence: release.manifest.releaseSequence,
        manifestSha256: release.manifestSha256
      };
}

function expectedPreviousState(): ChannelState | null {
  const present = required("CLAUDEX_WORKHOUSE_EXPECTED_PREVIOUS_PRESENT");
  if (present === "false") return null;
  if (present !== "true") {
    throw new Error("CLAUDEX_WORKHOUSE_EXPECTED_PREVIOUS_PRESENT must be true or false.");
  }
  return {
    version: required("CLAUDEX_WORKHOUSE_EXPECTED_PREVIOUS_VERSION"),
    releaseSequence: positiveInteger(
      required("CLAUDEX_WORKHOUSE_EXPECTED_PREVIOUS_SEQUENCE"),
      "CLAUDEX_WORKHOUSE_EXPECTED_PREVIOUS_SEQUENCE"
    ),
    manifestSha256: required("CLAUDEX_WORKHOUSE_EXPECTED_PREVIOUS_MANIFEST_SHA256")
  };
}

function nextState(): ChannelState {
  return {
    version: required("CLAUDEX_WORKHOUSE_NEXT_RELEASE_VERSION"),
    releaseSequence: positiveInteger(
      required("CLAUDEX_WORKHOUSE_NEXT_RELEASE_SEQUENCE"),
      "CLAUDEX_WORKHOUSE_NEXT_RELEASE_SEQUENCE"
    ),
    manifestSha256: required("CLAUDEX_WORKHOUSE_NEXT_MANIFEST_SHA256")
  };
}

async function runGuard(): Promise<void> {
  const token = required("GH_TOKEN");
  const repository = repositoryName(required("GITHUB_REPOSITORY"));
  const tag = required("GITHUB_REF_NAME");
  const expectedCommit = required("GITHUB_SHA");
  if (!GIT_SHA.test(expectedCommit)) throw new Error("GITHUB_SHA is invalid.");
  const request: ApiRequest = (pathName) => githubApi(pathName, token);
  const resolvedCommit = await resolveRemoteTagCommit(repository, tag, request);
  if (resolvedCommit !== expectedCommit) {
    throw new Error(
      `Remote release tag resolves to ${resolvedCommit}, expected workflow commit ${expectedCommit}.`
    );
  }
  const manifestUrl = required("CLAUDEX_WORKHOUSE_STABLE_MANIFEST_URL");
  const signatureUrl = required("CLAUDEX_WORKHOUSE_STABLE_SIGNATURE_URL");
  const policy: ReleaseVerificationPolicy = {
    allowedManifestOrigins: [new URL(manifestUrl).origin],
    allowedWorkerOrigins: [required("CLAUDEX_WORKHOUSE_RELEASE_WORKER_ORIGIN")],
    allowedImageRepositories: [required("CLAUDEX_WORKHOUSE_RELEASE_IMAGE_REPOSITORY")]
  };
  const liveRelease = await fetchStableRelease({
    manifestUrl,
    signatureUrl,
    keyRingFile: required("CLAUDEX_WORKHOUSE_RELEASE_KEY_RING_FILE"),
    policy
  });
  const releases = await listStableReleases(repository, request);
  const result = assertPromotionState({
    phase: promotionPhase(required("CLAUDEX_WORKHOUSE_PROMOTION_PHASE")),
    live: channelState(liveRelease),
    expectedPrevious: expectedPreviousState(),
    next: nextState(),
    currentTag: tag,
    releases
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

async function runAssetVerification(): Promise<void> {
  const token = required("GH_TOKEN");
  const repository = repositoryName(required("GITHUB_REPOSITORY"));
  const tag = required("GITHUB_REF_NAME");
  const encoded = required("CLAUDEX_WORKHOUSE_EXPECTED_ASSET_INVENTORY_BASE64");
  let expected: unknown;
  try {
    expected = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  } catch {
    throw new Error("Expected release asset inventory is invalid.");
  }
  const normalizedExpected = normalizeExpectedInventory(expected);
  const expectedNames = expectedReleaseAssetNames(
    required("CLAUDEX_WORKHOUSE_NEXT_RELEASE_VERSION")
  );
  if (
    JSON.stringify(normalizedExpected.map((item) => item.name)) !==
    JSON.stringify(expectedNames)
  ) {
    throw new Error("Expected release asset inventory is not the official exact allowlist.");
  }
  const request: ApiRequest = (pathName) => githubApi(pathName, token);
  const release = await getReleaseByTagIncludingDrafts(
    repository,
    tag,
    request
  );
  const phase = promotionPhase(required("CLAUDEX_WORKHOUSE_PROMOTION_PHASE"));
  if (phase !== "prepare" && phase !== "publish") {
    throw new Error("Release asset verification is supported only before publication.");
  }
  if (release.prerelease !== false || (phase === "prepare" && release.draft !== true)) {
    throw new Error("GitHub release state is invalid for exact asset verification.");
  }
  const assets = release.assets;
  if (!Array.isArray(assets)) throw new Error("GitHub release assets are invalid.");
  assertExactReleaseAssets(
    normalizedExpected,
    assets.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new Error("GitHub release contains an invalid asset item.");
      }
      const record = item as Record<string, unknown>;
      return {
        name: record.name as string,
        size: record.size as number,
        digest: (record.digest ?? null) as string | null,
        state: record.state as string
      };
    })
  );
  process.stdout.write(`${JSON.stringify({ verified: true, assets: assets.length })}\n`);
}

function runInventoryCreation(): void {
  const inventory = createReleaseAssetInventory(
    required("CLAUDEX_WORKHOUSE_RELEASE_ASSET_DIRECTORY"),
    required("CLAUDEX_WORKHOUSE_RELEASE_VERSION")
  );
  process.stdout.write(`${JSON.stringify(inventory)}\n`);
}

const invoked =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invoked) {
  const command = process.argv[2];
  const operation =
    command === "guard"
      ? runGuard()
      : command === "assets"
        ? runAssetVerification()
        : command === "inventory"
          ? Promise.resolve(runInventoryCreation())
          : Promise.reject(new Error("Expected guard, assets, or inventory command."));
  operation.catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
