import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertExactReleaseAssets,
  assertPromotionState,
  createReleaseAssetInventory,
  expectedReleaseAssetNames,
  getReleaseByTagIncludingDrafts,
  resolveRemoteTagCommit,
  type ChannelState,
  type ReleaseAssetInventoryItem
} from "../../scripts/verify-release-promotion.js";

const created: string[] = [];
afterEach(() => {
  for (const directory of created.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const previous: ChannelState = {
  version: "1.0.0",
  releaseSequence: 7,
  manifestSha256: "a".repeat(64)
};
const next: ChannelState = {
  version: "1.1.0",
  releaseSequence: 8,
  manifestSha256: "b".repeat(64)
};

function releases(currentDraft = true) {
  return [
    { tagName: "v1.0.0", isDraft: false, isPrerelease: false },
    { tagName: "v1.1.0", isDraft: currentDraft, isPrerelease: false }
  ];
}

describe("release promotion guard", () => {
  it("allows a current draft while the exact expected previous channel is live", () => {
    expect(assertPromotionState({
      phase: "stage",
      live: previous,
      expectedPrevious: previous,
      next,
      currentTag: "v1.1.0",
      releases: releases()
    }).action).toBe("proceed");
  });

  it("blocks a stale retry after a newer live stable release", () => {
    expect(() => assertPromotionState({
      phase: "stage",
      live: { version: "1.2.0", releaseSequence: 9, manifestSha256: "c".repeat(64) },
      expectedPrevious: previous,
      next,
      currentTag: "v1.1.0",
      releases: releases()
    })).toThrow(/Live stable state changed/);
  });

  it("blocks a retry when the live version matches but its sequence or signed bytes changed", () => {
    expect(() => assertPromotionState({
      phase: "publish",
      live: { ...previous, manifestSha256: "f".repeat(64) },
      expectedPrevious: previous,
      next,
      currentTag: "v1.1.0",
      releases: releases()
    })).toThrow(/Live stable state changed/);
    expect(() => assertPromotionState({
      phase: "publish",
      live: { ...previous, releaseSequence: previous.releaseSequence + 1 },
      expectedPrevious: previous,
      next,
      currentTag: "v1.1.0",
      releases: releases()
    })).toThrow(/Live stable state changed/);
  });

  it("blocks another pending stable draft", () => {
    expect(() => assertPromotionState({
      phase: "prepare",
      live: previous,
      expectedPrevious: previous,
      next,
      currentTag: "v1.1.0",
      releases: [
        ...releases(),
        { tagName: "v1.2.0", isDraft: true, isPrerelease: false }
      ]
    })).toThrow(/Another stable draft is pending/);
  });

  it("blocks a different published release that is ahead of live stable", () => {
    expect(() => assertPromotionState({
      phase: "prepare",
      live: previous,
      expectedPrevious: previous,
      next,
      currentTag: "v1.1.0",
      releases: [
        { tagName: "v1.0.0", isDraft: false, isPrerelease: false },
        { tagName: "v1.2.0", isDraft: false, isPrerelease: false }
      ]
    })).toThrow(/has not been safely promoted/);
  });

  it("allows an idempotent promote retry only when the exact next channel is already live", () => {
    expect(assertPromotionState({
      phase: "promote",
      live: next,
      expectedPrevious: previous,
      next,
      currentTag: "v1.1.0",
      releases: releases(false)
    }).action).toBe("already-applied");
  });

  it("requires an exact allowlist, count, size, and digest for immutable assets", () => {
    const expected: ReleaseAssetInventoryItem[] = [{
      name: "release-manifest.json",
      size: 4,
      sha256: crypto.createHash("sha256").update("test").digest("hex")
    }];
    const matching = [{
      name: "release-manifest.json",
      size: 4,
      digest: `sha256:${expected[0].sha256}`,
      state: "uploaded"
    }];
    expect(() => assertExactReleaseAssets(expected, matching)).not.toThrow();
    expect(() => assertExactReleaseAssets(expected, [
      ...matching,
      { name: "unexpected.exe", size: 1, digest: `sha256:${"d".repeat(64)}`, state: "uploaded" }
    ])).toThrow(/exact allowlist/);
    expect(() => assertExactReleaseAssets(expected, [{
      ...matching[0],
      digest: `sha256:${"e".repeat(64)}`
    }])).toThrow(/expected digest/);
  });

  it("creates inventory only for the exact official release asset set", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "release-assets-"));
    created.push(directory);
    for (const name of expectedReleaseAssetNames("1.1.0")) {
      fs.writeFileSync(path.join(directory, name), name);
    }
    // Eleven: the Windows EXE, portable ZIP, their checksums and SBOM, and the
    // Windows Worker left the published set while those targets are in
    // development; the npm tarball and the quick-start bundle joined it.
    expect(createReleaseAssetInventory(directory, "1.1.0")).toHaveLength(11);
    fs.writeFileSync(path.join(directory, "unexpected.exe"), "x");
    expect(() => createReleaseAssetInventory(directory, "1.1.0")).toThrow(/exactly/);
  });

  it("expects exactly the assets the release workflow writes", () => {
    // The guard compares the directory against this list exactly, so an asset
    // the workflow produces but the list omits fails the release at the very
    // last gate — after the image is built and the workers are packed. That is
    // how the quick-start bundle stalled a release once. Read the workflow and
    // require the two to agree.
    const workflow = fs.readFileSync(path.resolve("..", ".github", "workflows", "release.yml"), "utf8");
    const version = "1.1.0";
    const expected = new Set(expectedReleaseAssetNames(version));
    const written = new Set<string>();
    for (const [, name] of workflow.matchAll(/release-assets\/([A-Za-z0-9._${}() -]+?)["'\s]/g)) {
      const resolved = name.replaceAll("${{ needs.preflight.outputs.version }}", version).trim();
      // Files the workflow names through a step output cannot be resolved here.
      if (resolved.includes("${{") || !resolved.includes(".")) continue;
      written.add(resolved);
    }
    expect(written.size).toBeGreaterThan(0);
    expect([...written].filter(name => !expected.has(name))).toEqual([]);
  });

  it("peels annotated remote tags to the release commit", async () => {
    const commit = "a".repeat(40);
    const tagObject = "b".repeat(40);
    const requested: string[] = [];
    const resolved = await resolveRemoteTagCommit(
      "owner/repository",
      "v1.1.0",
      async (requestPath) => {
        requested.push(requestPath);
        return requestPath.includes("/git/ref/")
          ? { object: { type: "tag", sha: tagObject } }
          : { object: { type: "commit", sha: commit } };
      }
    );
    expect(resolved).toBe(commit);
    expect(requested).toEqual([
      "repos/owner/repository/git/ref/tags/v1.1.0",
      `repos/owner/repository/git/tags/${tagObject}`
    ]);
  });

  it("resolves a draft through the authenticated release list and ID endpoint", async () => {
    const requested: string[] = [];
    const release = await getReleaseByTagIncludingDrafts(
      "owner/repository",
      "v1.1.0",
      async (requestPath) => {
        requested.push(requestPath);
        return requestPath.includes("?")
          ? [{ id: 42, tag_name: "v1.1.0", draft: true, prerelease: false }]
          : {
              id: 42,
              tag_name: "v1.1.0",
              draft: true,
              prerelease: false,
              assets: []
            };
      }
    );
    expect(release.draft).toBe(true);
    expect(requested).toEqual([
      "repos/owner/repository/releases?per_page=100&page=1",
      "repos/owner/repository/releases/42"
    ]);
  });
});
