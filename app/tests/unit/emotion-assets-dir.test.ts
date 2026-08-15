import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { resolveEmotionAssetsDir } from "../../src/server/config.js";

const roots: string[] = [];
function appRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "claudex-emotion-assets-"));
  roots.push(root);
  return root;
}
afterEach(() => { while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true }); });

const make = (root: string, relative: string) => fs.mkdirSync(path.join(root, relative), { recursive: true });

describe("emotion asset catalog directory", () => {
  // `app/dist` is what the static file server publishes as `/emoticons`, and it
  // is the only one of the two that exists in the packaged Windows portable.
  // Reading `app/public` there left the catalog empty, so valid `[[e:...]]`
  // markers had no image to resolve to.
  test("prefers the built directory the static server actually publishes", () => {
    const root = appRoot();
    make(root, "app/dist/emoticons");
    make(root, "app/public/emoticons");
    expect(resolveEmotionAssetsDir(root)).toBe(path.join(root, "app", "dist", "emoticons"));
  });

  test("falls back to the source directory when only a checkout is present", () => {
    const root = appRoot();
    make(root, "app/public/emoticons");
    expect(resolveEmotionAssetsDir(root)).toBe(path.join(root, "app", "public", "emoticons"));
  });

  test("a packaged tree with no source directory still resolves to the built one", () => {
    const root = appRoot();
    make(root, "app/dist/emoticons");
    expect(resolveEmotionAssetsDir(root)).toBe(path.join(root, "app", "dist", "emoticons"));
  });

  test("with neither present it names the built path rather than the source path", () => {
    const root = appRoot();
    expect(resolveEmotionAssetsDir(root)).toBe(path.join(root, "app", "dist", "emoticons"));
  });
});
