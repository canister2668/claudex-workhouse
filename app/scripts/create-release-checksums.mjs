#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Claudex Workhouse.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SAFE_ASSET = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;

function compareNames(left, right) {
  return left === right ? 0 : left < right ? -1 : 1;
}

function sha256File(file) {
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

export function createReleaseChecksums(directory) {
  const resolved = path.resolve(directory);
  if (!fs.lstatSync(resolved).isDirectory()) {
    throw new Error("Release asset directory is unavailable.");
  }
  const names = fs.readdirSync(resolved)
    .filter((name) => name !== "SHA256SUMS")
    .sort(compareNames);
  if (names.length === 0) throw new Error("Release asset directory is empty.");
  const lines = names.map((name) => {
    if (!SAFE_ASSET.test(name)) throw new Error(`Unsafe release asset name: ${name}`);
    const file = path.join(resolved, name);
    const status = fs.lstatSync(file);
    if (!status.isFile() || status.size <= 0 || status.size > 2 * 1024 * 1024 * 1024) {
      throw new Error(`${name} must be a non-empty bounded regular file.`);
    }
    return `${sha256File(file)}  ${name}`;
  });
  const output = path.join(resolved, "SHA256SUMS");
  const temporary = `${output}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${lines.join("\n")}\n`, { mode: 0o644, flag: "wx" });
  fs.renameSync(temporary, output);
  return { output, names };
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const directory = process.env.CLAUDEX_WORKHOUSE_RELEASE_ASSET_DIRECTORY?.trim();
  if (!directory) throw new Error("CLAUDEX_WORKHOUSE_RELEASE_ASSET_DIRECTORY is required.");
  const result = createReleaseChecksums(directory);
  process.stdout.write(`${result.output}\n`);
}
