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

// Emoticons are not hashed: every outfit serves stable paths, and the emotion
// catalog reads this very directory. `emptyOutDir:false` therefore left a
// renamed asset behind under both names, so the catalog kept offering the old
// one and the naming convention held only in `public`. Mirror it exactly.
const emoticons = path.join(root, "emoticons");
const source = new URL("../public/emoticons", import.meta.url).pathname;
let removed = 0;
const mirror = (relative) => {
  let entries = [];
  try { entries = fs.readdirSync(path.join(emoticons, relative), { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const next = path.join(relative, entry.name);
    if (entry.isDirectory()) { mirror(next); continue; }
    if (fs.existsSync(path.join(source, next))) continue;
    fs.rmSync(path.join(emoticons, next), { force: true });
    removed += 1;
  }
};
if (fs.existsSync(source)) {
  mirror("");
  console.log(`emoticons mirrored (${removed} stale file${removed === 1 ? "" : "s"} removed)`);
}
