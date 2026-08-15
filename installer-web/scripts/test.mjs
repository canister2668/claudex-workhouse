import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { build } from "../../app/node_modules/esbuild/lib/main.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(scriptDir);
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "claudex-installer-tests-"));
const outfile = path.join(temporary, "core.test.mjs");

try {
  await build({
    entryPoints: [path.join(root, "tests", "core.test.ts")],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: ["node22"],
    sourcemap: false
  });
  const result = spawnSync(process.execPath, ["--test", outfile], {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe"
  });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  if (result.status !== 0) process.exit(result.status ?? 1);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
