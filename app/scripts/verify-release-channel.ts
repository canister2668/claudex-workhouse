#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  verifyReleaseManifest,
  type ReleaseVerificationPolicy
} from "../src/server/deployment/release-manifest.js";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function origins(name: string): string[] {
  const values = required(name)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!values.length) throw new Error(`${name} must contain at least one HTTPS origin.`);
  return values;
}

function versionParts(value: string): readonly [number, number, number] {
  const match = /^([0-9]+)\.([0-9]+)\.([0-9]+)$/.exec(value);
  if (!match) throw new Error(`Stable public release versions must be MAJOR.MINOR.PATCH: ${value}`);
  const parts = match.slice(1).map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part))) {
    throw new Error(`Release version exceeds the safe integer range: ${value}`);
  }
  return parts as unknown as readonly [number, number, number];
}

function compareVersions(left: string, right: string): number {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] < rightParts[index] ? -1 : 1;
    }
  }
  return 0;
}

const currentDirectory = process.env.CLAUDEX_WORKHOUSE_CURRENT_CHANNEL_DIRECTORY?.trim();
const nextVersion = required("CLAUDEX_WORKHOUSE_NEXT_RELEASE_VERSION");
versionParts(nextVersion);

if (!currentDirectory) {
  process.stdout.write(`${JSON.stringify({
    current: null,
    nextVersion,
    nextSequence: 1
  })}\n`);
  process.exit(0);
}

const directory = path.resolve(currentDirectory);
const manifestFile = path.join(directory, "release-manifest.json");
const signatureFile = path.join(directory, "release-manifest.json.sig");
if (!fs.existsSync(manifestFile) || !fs.existsSync(signatureFile)) {
  throw new Error("The current channel directory must contain both manifest and signature files.");
}
const keyRing = JSON.parse(fs.readFileSync(required("CLAUDEX_WORKHOUSE_RELEASE_KEY_RING_FILE"), "utf8"));
const policy: ReleaseVerificationPolicy = {
  allowedManifestOrigins: origins("CLAUDEX_WORKHOUSE_RELEASE_MANIFEST_ORIGINS"),
  allowedWorkerOrigins: origins("CLAUDEX_WORKHOUSE_RELEASE_WORKER_ORIGINS"),
  allowedImageRepositories: required("CLAUDEX_WORKHOUSE_RELEASE_IMAGE_REPOSITORIES")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
};
const verified = verifyReleaseManifest({
  manifestBytes: fs.readFileSync(manifestFile),
  signatureBytes: fs.readFileSync(signatureFile),
  manifestUrl: required("CLAUDEX_WORKHOUSE_CURRENT_MANIFEST_URL"),
  signatureUrl: required("CLAUDEX_WORKHOUSE_CURRENT_SIGNATURE_URL"),
  keyRing,
  policy,
  now: new Date()
});
if (verified.manifest.channel !== "stable") {
  throw new Error(`Expected the stable channel, received ${verified.manifest.channel}.`);
}
if (compareVersions(nextVersion, verified.manifest.version) <= 0) {
  throw new Error(
    `The next stable version ${nextVersion} must be greater than ${verified.manifest.version}.`
  );
}
if (verified.manifest.releaseSequence >= Number.MAX_SAFE_INTEGER) {
  throw new Error("The stable release sequence cannot be incremented safely.");
}
process.stdout.write(`${JSON.stringify({
  current: {
    version: verified.manifest.version,
    releaseSequence: verified.manifest.releaseSequence,
    manifestSha256: verified.manifestSha256
  },
  nextVersion,
  nextSequence: verified.manifest.releaseSequence + 1
})}\n`);
