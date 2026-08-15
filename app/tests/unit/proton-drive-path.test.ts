import { describe, expect, it } from "vitest";
import { comparableSegment, matchSegment, protonDirectoryEntries, protonPathSegments, resolveProtonPath } from "../../src/server/proton-drive-path.js";

const listing = (tree: Record<string, string[]>) => async (remotePath: string) => {
  const entries = tree[remotePath];
  if (!entries) throw new Error(`no such directory: ${remotePath}`);
  return entries.map((name) => ({ name }));
};

describe("Proton Drive path resolution", () => {
  it("splits and compares segments independently of case and Unicode composition", () => {
    expect(protonPathSegments("/my-files/WH업로드/")).toEqual(["my-files", "WH업로드"]);
    expect(comparableSegment("WH업로드")).toBe(comparableSegment("wh업로드"));
    // The same Hangul written decomposed must compare equal to its composed form.
    expect(comparableSegment("가".normalize("NFD"))).toBe(comparableSegment("가"));
  });

  it("prefers an exact name over one that only matches case-insensitively", () => {
    expect(matchSegment([{ name: "Foo" }, { name: "foo" }], "foo")).toEqual({ status: "exact", name: "foo" });
  });

  it("corrects a unique case-insensitive match and refuses to guess between two", () => {
    expect(matchSegment([{ name: "WH업로드" }], "wh업로드")).toEqual({ status: "corrected", name: "WH업로드" });
    expect(matchSegment([{ name: "Foo" }, { name: "FOO" }], "foo")).toEqual({ status: "ambiguous", candidates: ["FOO", "Foo"] });
    expect(matchSegment([{ name: "other" }], "foo")).toEqual({ status: "missing" });
  });

  it("returns the spelling that exists on the drive", async () => {
    const resolution = await resolveProtonPath("/my-files/wh업로드/tagloom.zip", {
      listDirectory: listing({
        "/": ["my-files"],
        "/my-files": ["WH업로드", "Claudex-Workhouse"],
        "/my-files/WH업로드": ["Tagloom.zip"]
      })
    });
    expect(resolution.path).toBe("/my-files/WH업로드/Tagloom.zip");
    expect(resolution.corrected).toBe(true);
  });

  it("costs nothing when the requested path already exists", async () => {
    let listed = 0;
    const resolution = await resolveProtonPath("/my-files/Exact", {
      exists: async () => true,
      listDirectory: async () => { listed += 1; return []; }
    });
    expect(resolution).toEqual({ path: "/my-files/Exact", corrected: false, resolvedSegments: 2 });
    expect(listed).toBe(0);
  });

  it("keeps the requested spelling for a segment that does not exist yet", async () => {
    // An upload target directory is allowed to be created, so an unknown tail is
    // not an error — it just cannot be corrected.
    const resolution = await resolveProtonPath("/my-files/wh업로드/새폴더/out.zip", {
      listDirectory: listing({ "/": ["my-files"], "/my-files": ["WH업로드"], "/my-files/WH업로드": [] })
    });
    expect(resolution.path).toBe("/my-files/WH업로드/새폴더/out.zip");
    expect(resolution.corrected).toBe(true);
  });

  it("stops resolving when a directory cannot be listed", async () => {
    const resolution = await resolveProtonPath("/my-files/a/b", {
      listDirectory: async (remotePath) => { if (remotePath === "/") return [{ name: "my-files" }]; throw new Error("denied"); }
    });
    expect(resolution.path).toBe("/my-files/a/b");
    expect(resolution.resolvedSegments).toBe(1);
  });

  it("reports ambiguity instead of choosing a folder for the user", async () => {
    await expect(resolveProtonPath("/my-files/foo/x.zip", {
      listDirectory: listing({ "/": ["my-files"], "/my-files": ["Foo", "FOO"] })
    })).rejects.toMatchObject({ code: "PROTON_PATH_AMBIGUOUS", statusCode: 409 });
  });

  it("reads the shape the installed CLI actually returns", () => {
    // Captured from `proton-drive filesystem list --json` on a real account: the
    // decrypted name arrives wrapped in a result object because decryption can
    // fail per node, and folders are marked by either "type" or a "folder"
    // member. Reading `name` as a plain string found nothing at all.
    const listing = [
      { uid: "u1", name: { ok: true, value: "wh업로드" }, type: "folder", modificationTime: "2026-08-08T12:29:38.000Z" },
      { uid: "u2", name: { ok: true, value: "잡동사니" }, folder: {}, modificationTime: "2026-04-06T08:39:53.000Z" },
      {
        uid: "u3", name: { ok: true, value: "tagloom.zip" }, type: "file", mediaType: "application/zip",
        modificationTime: "2026-08-08T12:29:38.000Z",
        activeRevision: { state: "active", storageSize: 60383960, claimedSize: 60379017, claimedDigests: { sha1: "d1546898c36e842549b7c3fe326a6b194465abf5", sha1Verified: false } }
      },
      { uid: "u4", name: { ok: false }, type: "file" }
    ];
    const entries = protonDirectoryEntries(listing);
    expect(entries.map((entry) => entry.name)).toEqual(["wh업로드", "잡동사니", "tagloom.zip"]);
    expect(entries[0]).toMatchObject({ kind: "folder", uid: "u1" });
    expect(entries[1]!.kind).toBe("folder");
    expect(entries[2]).toMatchObject({ kind: "file", size: 60379017, mediaType: "application/zip", sha1: "d1546898c36e842549b7c3fe326a6b194465abf5" });
    // A node whose name will not decrypt cannot be addressed, so it is dropped
    // rather than shown under some invented label.
    expect(entries).toHaveLength(3);
  });

  it("reads directory names out of the shapes the CLI reports", () => {
    expect(protonDirectoryEntries([{ name: "a" }, { title: "b" }, "c", { path: "/my-files/d" }])).toEqual([
      { name: "a" }, { name: "b" }, { name: "c" }, { name: "d" }
    ]);
    expect(protonDirectoryEntries({ items: [{ name: "a" }] })).toEqual([{ name: "a" }]);
    expect(protonDirectoryEntries({ nodes: [{ fileName: "b" }] })).toEqual([{ name: "b" }]);
    expect(protonDirectoryEntries(null)).toEqual([]);
    expect(protonDirectoryEntries({ unrelated: 1 })).toEqual([]);
  });
});
