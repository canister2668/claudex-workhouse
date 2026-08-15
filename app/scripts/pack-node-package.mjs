#!/usr/bin/env node
// Packs the publishable Node server package from this public checkout.
//
// The release workflow runs in the public repository, where the checkout is
// already the generated public tree, so there is nothing to scrub here — the
// tree's own public source proof is what establishes that. Developing locally
// in the private tree, use `scripts/public-release/build-node-package.mjs`
// instead: it generates and inspects a scrub tree first, then stages through
// the very same code as this script.
//
// The build is expected to have run: `app/dist` and `app/dist-server` are read,
// never produced here, so the packaged bytes are the ones the release already
// tested.
//
// Usage:
//   node app/scripts/pack-node-package.mjs --output <directory> [--root <tree>]

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PACKAGE_NAME, stageNodePackage } from "./stage-node-package.mjs";

function fail(message) {
  process.stderr.write(`node package pack: ${message}\n`);
  process.exit(2);
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const values = process.argv.slice(2);
let output = null;
let root = path.resolve(scriptDirectory, "../..");
for (let index = 0; index < values.length; index += 1) {
  const value = values[index];
  if (value === "--output") output = values[++index] ?? fail("--output requires a directory");
  else if (value === "--root") root = path.resolve(values[++index] ?? fail("--root requires a directory"));
  else fail(`unknown argument: ${value}`);
}
if (!output) fail("--output <directory> is required");
output = path.resolve(output);
fs.mkdirSync(output, { recursive: true });

const stageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "claudex-node-package-"));
try {
  const stage = path.join(stageRoot, PACKAGE_NAME);
  const version = stageNodePackage({ publicRoot: root, stage, fail });
  const packed = JSON.parse(execFileSync("npm", ["pack", "--json", "--pack-destination", output], { cwd: stage, encoding: "utf8" }));
  const tarball = path.join(output, packed[0].filename);
  if (!fs.existsSync(tarball)) fail("npm pack did not produce the tarball");
  const digest = crypto.createHash("sha256").update(fs.readFileSync(tarball)).digest("hex");
  process.stdout.write(`tarball=${tarball}\nfilename=${packed[0].filename}\nversion=${version}\nfiles=${packed[0].entryCount}\nbytes=${fs.statSync(tarball).size}\nsha256=${digest}\n`);
} finally {
  fs.rmSync(stageRoot, { recursive: true, force: true });
}
