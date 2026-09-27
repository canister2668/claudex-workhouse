// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Claudex Workhouse.

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const tokenFile = process.argv[2];
if (!tokenFile || !path.isAbsolute(tokenFile)) throw new Error("An absolute participant token file path is required.");
const stat = fs.lstatSync(tokenFile);
if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600 || stat.uid !== process.getuid()) {
  throw new Error("The participant token file must be an owner-only regular file.");
}
const token = fs.readFileSync(tokenFile, "utf8").trim();
if (!/^whp_[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("The participant token file is invalid.");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = path.join(root, "app", "dist-server", "external-participant-mcp.js");
const child = spawn(process.execPath, [entry], {
  stdio: "inherit",
  env: {
    CLAUDEX_PARTICIPANT_TOKEN: token,
    CLAUDEX_PARTICIPANT_ORIGIN: "http://127.0.0.1:3410",
  },
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("error", error => { console.error(error.message); process.exitCode = 1; });
child.on("exit", (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
