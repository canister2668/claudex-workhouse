// Removes hashed build artifacts older than 7 days from dist/assets (and old
// workbox runtimes). Runs after every build; keeps the previous builds around
// so clients on the old shell never 404 mid-deploy.
import fs from "node:fs";
import path from "node:path";

const KEEP_MS = 7 * 86400000;
const root = new URL("../dist", import.meta.url).pathname;

for (const dir of [path.join(root, "assets"), root]) {
  let entries = [];
  try { entries = fs.readdirSync(dir); } catch { continue; }
  for (const name of entries) {
    const isHashedAsset = dir.endsWith("assets") || /^workbox-[a-f0-9]+\.js$/.test(name);
    if (!isHashedAsset) continue;
    const file = path.join(dir, name);
    try {
      const stat = fs.statSync(file);
      if (stat.isFile() && Date.now() - stat.mtimeMs > KEEP_MS) fs.rmSync(file, { force: true });
    } catch { /* ignore */ }
  }
}
console.log("dist pruned (kept last 7 days of hashed assets)");
