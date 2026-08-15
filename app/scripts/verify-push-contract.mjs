import fs from "node:fs";

function kindsFromServer(source) {
  const match = source.match(/PUSH_KINDS\s*=\s*\[([^\]]+)\]/);
  if (!match) throw new Error("PUSH_KINDS contract was not found.");
  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
}

function kindsFromServiceWorker(source, label) {
  const match = source.match(/const allowed=new Set\(\[([^\]]+)\]\)/);
  if (!match) throw new Error(`${label} Push allowlist was not found.`);
  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
}

const expected = kindsFromServer(fs.readFileSync("src/server/push-kinds.ts", "utf8"));
for (const file of ["public/sw.js", "dist/sw.js"]) {
  const actual = kindsFromServiceWorker(fs.readFileSync(file, "utf8"), file);
  if (new Set(actual).size !== actual.length || JSON.stringify([...actual].sort()) !== JSON.stringify([...expected].sort())) {
    throw new Error(`${file} Push kinds differ from the server contract: expected ${expected.join(", ")}, received ${actual.join(", ")}`);
  }
}
