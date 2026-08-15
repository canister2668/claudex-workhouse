// Proton Drive stores the spelling a folder was created with, and the CLI
// matches remote paths literally. A person reading "/my-files/wh업로드" and a
// folder created as "/my-files/WH업로드" mean the same place, but the literal
// lookup misses and every command fails with a plain "not found". The same
// happens when two clients disagree about Unicode composition: Hangul typed on
// one platform can arrive decomposed from another, so the bytes differ while
// the text is identical on screen.
//
// This module resolves a requested path onto the spelling that actually exists.
// It never guesses: a segment that matches more than one entry is reported as
// ambiguous rather than picked, and a segment that matches nothing keeps the
// requested spelling so an upload can still create it.

export type ProtonDirectoryEntry = {
  name: string;
  uid?: string;
  kind?: "file" | "folder";
  size?: number;
  mediaType?: string;
  modifiedAt?: string;
  sha1?: string;
};

export type ProtonSegmentMatch =
  | { status: "exact" | "corrected"; name: string }
  | { status: "missing" }
  | { status: "ambiguous"; candidates: string[] };

export type ProtonPathResolution = { path: string; corrected: boolean; resolvedSegments: number };

export const PROTON_PATH_AMBIGUOUS = "PROTON_PATH_AMBIGUOUS";

export function protonPathSegments(remotePath: string) {
  return remotePath.split("/").filter(Boolean);
}

// Composition first, then case. Both directions of Unicode normalization exist
// in the wild, so comparing on NFC makes "가" typed either way one value.
export function comparableSegment(value: string) {
  return value.normalize("NFC").toLowerCase();
}

export function matchSegment(entries: ProtonDirectoryEntry[], wanted: string): ProtonSegmentMatch {
  const names = entries.map((entry) => entry.name).filter((name) => typeof name === "string" && name.length > 0);
  if (names.includes(wanted)) return { status: "exact", name: wanted };
  const target = comparableSegment(wanted);
  const candidates = names.filter((name) => comparableSegment(name) === target);
  if (candidates.length === 1) return { status: "corrected", name: candidates[0]! };
  if (candidates.length > 1) return { status: "ambiguous", candidates: [...candidates].sort() };
  return { status: "missing" };
}

// The CLI reports each node with its decrypted name wrapped in a result object
// ({ok,value}) because decryption can fail per node, and it marks folders with
// either a "type" field or a "folder" member depending on the node. Read all of
// that defensively: the shape is the CLI's, not a contract we own.
function decodedName(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.ok === false) return null;
    if (typeof record.value === "string") return record.value;
  }
  return null;
}

export function protonDirectoryEntries(value: unknown): ProtonDirectoryEntry[] {
  const rows = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? (["items", "entries", "children", "nodes", "files", "results"] as const)
          .map((key) => (value as Record<string, unknown>)[key])
          .find((candidate): candidate is unknown[] => Array.isArray(candidate)) ?? []
      : [];
  const named: ProtonDirectoryEntry[] = [];
  for (const row of rows) {
    if (typeof row === "string") { named.push({ name: row.split("/").filter(Boolean).at(-1) ?? row }); continue; }
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const raw = ["name", "title", "filename", "fileName", "path"].map((key) => decodedName(record[key])).find((candidate) => typeof candidate === "string" && candidate.length > 0);
    // A node whose name could not be decrypted is unusable as a path segment,
    // and silently naming it something else would be worse than skipping it.
    if (typeof raw !== "string") continue;
    const revision = record.activeRevision && typeof record.activeRevision === "object" ? record.activeRevision as Record<string, unknown> : null;
    const digests = revision?.claimedDigests && typeof revision.claimedDigests === "object" ? revision.claimedDigests as Record<string, unknown> : null;
    const size = Number(revision?.claimedSize);
    const kind = record.type === "file" || record.file ? "file" : record.type === "folder" || record.folder ? "folder" : undefined;
    named.push({
      name: raw.split("/").filter(Boolean).at(-1) ?? raw,
      ...(typeof record.uid === "string" ? { uid: record.uid } : {}),
      ...(kind ? { kind } : {}),
      ...(Number.isFinite(size) && size >= 0 ? { size } : {}),
      ...(typeof record.mediaType === "string" ? { mediaType: record.mediaType } : {}),
      ...(typeof record.modificationTime === "string" ? { modifiedAt: record.modificationTime } : {}),
      ...(typeof digests?.sha1 === "string" ? { sha1: digests.sha1 } : {})
    });
  }
  return named;
}

export type ProtonPathProbe = {
  // Resolves true when the literal path exists, so an already-correct path costs
  // nothing beyond the caller's own lookup.
  exists?: (remotePath: string) => Promise<boolean>;
  // Lists one directory. Throwing or resolving empty both mean "cannot look
  // further", and the remaining segments keep their requested spelling.
  listDirectory: (remotePath: string) => Promise<ProtonDirectoryEntry[]>;
};

export async function resolveProtonPath(remotePath: string, probe: ProtonPathProbe): Promise<ProtonPathResolution> {
  const segments = protonPathSegments(remotePath);
  if (!segments.length) return { path: remotePath, corrected: false, resolvedSegments: 0 };
  if (probe.exists && await probe.exists(remotePath).catch(() => false)) {
    return { path: remotePath, corrected: false, resolvedSegments: segments.length };
  }

  const resolved: string[] = [];
  let corrected = false;
  for (const [index, segment] of segments.entries()) {
    const parent = `/${resolved.join("/")}`;
    let entries: ProtonDirectoryEntry[];
    try { entries = await probe.listDirectory(parent); }
    catch { resolved.push(...segments.slice(index)); return { path: `/${resolved.join("/")}`, corrected, resolvedSegments: index }; }
    const match = matchSegment(entries, segment);
    if (match.status === "ambiguous") {
      throw Object.assign(
        new Error(`Proton Drive has more than one entry matching "${segment}" in ${parent}: ${match.candidates.join(", ")}. Use the exact name.`),
        { statusCode: 409, code: PROTON_PATH_AMBIGUOUS, candidates: match.candidates }
      );
    }
    if (match.status === "missing") {
      // Nothing below an absent segment can be resolved, and an upload may be
      // about to create it. Keep the request as written from here on.
      resolved.push(...segments.slice(index));
      return { path: `/${resolved.join("/")}`, corrected, resolvedSegments: index };
    }
    if (match.status === "corrected") corrected = true;
    resolved.push(match.name);
  }
  return { path: `/${resolved.join("/")}`, corrected, resolvedSegments: segments.length };
}
