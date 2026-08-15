#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const PROOF_FILE = ".claudex-public-source.json";

function fail(message) {
  throw new Error(message);
}

function filesBelow(root) {
  const files = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (current === root && (entry.name === ".git" || entry.name === PROOF_FILE)) continue;
      const absolute = path.join(current, entry.name);
      if (entry.isSymbolicLink()) fail(`Public source proof does not accept symbolic links: ${path.relative(root, absolute)}`);
      if (entry.isDirectory()) stack.push(absolute);
      else if (entry.isFile()) files.push(absolute);
      else fail(`Public source proof found a non-regular file: ${path.relative(root, absolute)}`);
    }
  }
  return files.sort((left, right) => {
    const a = path.relative(root, left).split(path.sep).join("/");
    const b = path.relative(root, right).split(path.sep).join("/");
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

function portableContent(file) {
  const content = fs.readFileSync(file);
  const sample = content.subarray(0, Math.min(content.length, 8192));
  if (sample.includes(0)) return content;
  // Git for Windows may check text files out with CRLF. The projection is
  // generated on Linux, so normalize text newlines to make the proof portable
  // while retaining every byte of binary files.
  return Buffer.from(content.toString("utf8").replaceAll("\r\n", "\n"), "utf8");
}

export function publicSourceTreeSha256(root) {
  const resolved = path.resolve(root);
  const hash = crypto.createHash("sha256");
  for (const file of filesBelow(resolved)) {
    const relative = path.relative(resolved, file).split(path.sep).join("/");
    hash.update(relative, "utf8");
    hash.update("\0", "utf8");
    hash.update(portableContent(file));
    hash.update("\0", "utf8");
  }
  return hash.digest("hex");
}

export function writePublicSourceProof(root) {
  const resolved = path.resolve(root);
  const proof = { schema: 1, kind: "claudex-public-source", treeSha256: publicSourceTreeSha256(resolved) };
  fs.writeFileSync(path.join(resolved, PROOF_FILE), `${JSON.stringify(proof, null, 2)}\n`, { mode: 0o644 });
  return proof;
}

export function verifyPublicSourceProof(root) {
  const resolved = path.resolve(root);
  const file = path.join(resolved, PROOF_FILE);
  if (!fs.existsSync(file)) fail(`Public source proof is missing: ${file}`);
  const proof = JSON.parse(fs.readFileSync(file, "utf8"));
  if (proof?.schema !== 1 || proof?.kind !== "claudex-public-source" || !/^[a-f0-9]{64}$/.test(proof?.treeSha256 ?? "")) {
    fail(`Public source proof is invalid: ${file}`);
  }
  const actual = publicSourceTreeSha256(resolved);
  if (actual !== proof.treeSha256) fail("Public source tree does not match its generated proof.");
  return proof;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const index = process.argv.indexOf("--root");
  if (index < 0 || !process.argv[index + 1]) fail("Usage: public-source-proof.mjs --root <directory>");
  const proof = verifyPublicSourceProof(process.argv[index + 1]);
  process.stdout.write(`public source proof verified: ${proof.treeSha256}\n`);
}
