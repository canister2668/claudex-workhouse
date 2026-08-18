import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Outfit assets are addressed by a bare lowercase name. The rule is easy to
// state and was still broken twice, because nothing checked how the code
// arrives at a filename — only that the files on disk were named correctly.
//
// The avatar kept composing `${outfit}_${emotion}.webp` after the outfit-name
// prefix was removed from the tree. That is worse than a 404: the codex face
// falls back to Gpt-Codex when its first URL fails, and the two outfits are
// different characters, so a missing Gpt-Sol file quietly rendered Codex.
// Anything that builds a filename out of an outfit, a provider, or any other
// prefix reintroduces exactly that failure.
// Resolved from this file, not the working directory: the suite is normally
// run from `app`, but a run started at the repository root would otherwise
// scan nothing and pass.
const APP = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ROOTS = [join(APP, "src", "web"), join(APP, "src", "server"), join(APP, "..", "hooks")];
const EXTENSIONS = [".ts", ".mjs", ".svelte"];
// One interpolation, or a bare name with an optional numeric variant. Nothing
// may sit in front of it inside the filename.
const ALLOWED = /^(?:\$\{[^{}]*\}|[a-z][a-z0-9]*(?:_[0-9]+)?)$/;

function sources() {
  const files: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (EXTENSIONS.includes(extname(path))) files.push(path);
    }
  };
  for (const root of ROOTS) visit(root);
  return files;
}

describe("emotion asset filenames", () => {
  it("never composes an asset filename from a prefix", () => {
    const offenders: string[] = [];
    for (const file of sources()) {
      if (file.endsWith("emotion-asset-filenames.test.ts")) continue;
      const source = readFileSync(file, "utf8");
      // Every literal that ends in an image extension, quoted or templated.
      for (const match of source.matchAll(/[`"']((?:[^`"'\\\n]|\\.)*?)\.(?:webp|png|gif)[`"']/g)) {
        const name = match[1]!;
        // An extension on its own is a format list, and a literal carrying a
        // directory is some other asset — an outfit filename never holds a
        // path, because the outfit segment is added when the URL is built.
        if (!name || name.includes("/")) continue;
        if (ALLOWED.test(name)) continue;
        const line = source.slice(0, match.index).split("\n").length;
        offenders.push(`${relative(APP, file)}:${line}  ${match[0]}`);
      }
    }
    expect(offenders, `asset filenames must be a bare name, not a composed one:\n${offenders.join("\n")}`).toEqual([]);
  });
});
