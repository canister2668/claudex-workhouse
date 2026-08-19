#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PRIVATE_VERSION_MAX = "1.0.3";

function versionParts(value) {
  const match = /^([0-9]+)\.([0-9]+)\.([0-9]+)(?:-[0-9A-Za-z.-]+)?$/.exec(value);
  if (!match) {
    throw new Error(`Package version must be valid MAJOR.MINOR.PATCH semver: ${value}`);
  }
  const parts = match.slice(1).map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part))) {
    throw new Error(`Package version exceeds the safe integer range: ${value}`);
  }
  return parts;
}

function compareVersionCore(left, right) {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] < rightParts[index] ? -1 : 1;
    }
  }
  return 0;
}

export function assertPrivateVersionPolicy(packageJson) {
  if (packageJson.private !== true) return;
  if (typeof packageJson.version !== "string") {
    throw new Error("Private package version must be a string.");
  }
  if (compareVersionCore(packageJson.version, PRIVATE_VERSION_MAX) > 0) {
    throw new Error(
      `Private Claudex Workhouse versions must not exceed ${PRIVATE_VERSION_MAX}: ${packageJson.version}`
    );
  }
}

export function verifyPrivateVersionFile(packageFile) {
  const packageJson = JSON.parse(fs.readFileSync(packageFile, "utf8"));
  assertPrivateVersionPolicy(packageJson);
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const packageFile = path.resolve(path.dirname(currentFile), "../package.json");
  verifyPrivateVersionFile(packageFile);
  process.stdout.write(`Private version policy passed (maximum ${PRIVATE_VERSION_MAX}).\n`);
}
