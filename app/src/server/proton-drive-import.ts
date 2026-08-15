import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { ProtonDriveCli } from "./proton-drive-cli.js";
import { comparableSegment, protonPathSegments, type ProtonDirectoryEntry } from "./proton-drive-path.js";
import type { ProtonDriveSettings } from "./proton-drive-settings.js";

// Browser attachments are capped at 90 MiB total by the multipart limit, which is the
// right cap for a phone upload and the wrong one for a file that already lives
// in the user's own Drive. Importing server-side never puts those bytes on the
// browser's path, so the same attachment plumbing carries a 58MB archive.
//
// Only a file the user picked from the configured root is ever fetched: nothing
// here reads a prompt, so no wording in a conversation can pull a file down.

export type ProtonImportCandidate = {
  name: string;
  remotePath: string;
  size: number | null;
  mediaType: string | null;
  modifiedAt: string | null;
};

export type ProtonImportedAttachment = { path: string; name: string; size: number };

const MAX_IMPORT_BYTES = 2 * 1024 * 1024 * 1024;

// The resolver treats case and Unicode composition as the same name, so the
// containment check has to compare the same way — a byte-wise prefix test would
// accept "/my-files/ROOT-evil" for a root of "/my-files/root".
export function insideRemoteRoot(root: string, candidate: string) {
  const rootSegments = protonPathSegments(root).map(comparableSegment);
  const candidateSegments = protonPathSegments(candidate).map(comparableSegment);
  if (candidateSegments.length <= rootSegments.length) return false;
  if (candidateSegments.some((segment) => segment === ".." || segment === ".")) return false;
  return rootSegments.every((segment, index) => candidateSegments[index] === segment);
}

export function importAttachmentName(remoteName: string) {
  const safe = (path.basename(remoteName).replace(/[^\w.\- ()가-힣]/g, "_").slice(0, 80)) || "file";
  return `${crypto.randomUUID().slice(0, 8)}-${safe}`;
}

async function hashFile(file: string) {
  const hash = crypto.createHash("sha1");
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest("hex");
}

export class ProtonDriveImportService {
  constructor(
    private cli: ProtonDriveCli,
    private paths: { uploadsDir: string; tempDir: string },
    private loadSettings: () => Promise<ProtonDriveSettings>
  ) {}

  private async requireEnabled() {
    const settings = await this.loadSettings();
    if (!settings.enabled) throw Object.assign(new Error("Enable Proton Drive in global settings first."), { statusCode: 409, code: "PROTON_DISABLED" });
    return settings;
  }

  // Lists the files directly under the configured root. Folders are reported so
  // the picker can show where it is, but only files can be imported.
  async candidates(subPath = ""): Promise<{ root: string; directory: string; folders: string[]; files: ProtonImportCandidate[] }> {
    const settings = await this.requireEnabled();
    const root = settings.remoteRoot.replace(/\/+$/g, "");
    const relative = protonPathSegments(subPath.replace(/\\/g, "/"));
    if (relative.some((segment) => segment === ".." || segment === ".")) throw Object.assign(new Error("Invalid Proton Drive path."), { statusCode: 400, code: "PROTON_PATH_INVALID" });
    const directory = relative.length ? `${root}/${relative.join("/")}` : root;
    const entries = await this.cli.entries(directory);
    return {
      root,
      directory,
      folders: entries.filter((entry) => entry.kind === "folder").map((entry) => entry.name),
      files: entries.filter((entry) => entry.kind !== "folder").map((entry) => this.candidate(directory, entry))
    };
  }

  private candidate(directory: string, entry: ProtonDirectoryEntry): ProtonImportCandidate {
    return {
      name: entry.name,
      remotePath: `${directory}/${entry.name}`,
      size: typeof entry.size === "number" ? entry.size : null,
      mediaType: entry.mediaType ?? null,
      modifiedAt: entry.modifiedAt ?? null
    };
  }

  async importFile(remotePath: string): Promise<ProtonImportedAttachment> {
    const settings = await this.requireEnabled();
    const root = settings.remoteRoot.replace(/\/+$/g, "");
    const requested = remotePath.trim();
    if (!requested || requested.includes("\0")) throw Object.assign(new Error("A Proton Drive path is required."), { statusCode: 400, code: "PROTON_PATH_INVALID" });
    if (!insideRemoteRoot(root, requested)) throw Object.assign(new Error("Only files below the configured Proton Drive folder can be imported."), { statusCode: 403, code: "PROTON_PATH_OUTSIDE_ROOT" });

    const parent = requested.slice(0, requested.lastIndexOf("/")) || root;
    const wanted = protonPathSegments(requested).at(-1)!;
    const entry = (await this.cli.entries(parent)).find((item) => comparableSegment(item.name) === comparableSegment(wanted));
    if (!entry) throw Object.assign(new Error("The Proton Drive file no longer exists."), { statusCode: 404, code: "PROTON_FILE_NOT_FOUND" });
    if (entry.kind === "folder") throw Object.assign(new Error("Only a file can be attached."), { statusCode: 400, code: "PROTON_NOT_A_FILE" });
    if (typeof entry.size === "number" && entry.size > MAX_IMPORT_BYTES) throw Object.assign(new Error("The Proton Drive file is too large to import."), { statusCode: 413, code: "PROTON_FILE_TOO_LARGE" });

    const stage = path.join(this.paths.tempDir, "proton-imports", crypto.randomUUID());
    fs.mkdirSync(stage, { recursive: true, mode: 0o700 });
    try {
      await this.cli.download(`${parent}/${entry.name}`, stage);
      const written = fs.readdirSync(stage).filter((name) => fs.statSync(path.join(stage, name)).isFile());
      if (written.length !== 1) throw Object.assign(new Error("Proton Drive returned an unexpected download."), { statusCode: 502, code: "PROTON_DOWNLOAD_FAILED" });
      const staged = path.join(stage, written[0]!), stat = fs.statSync(staged);

      // Proton reports the size and digest the uploading client claimed. They
      // detect a truncated or corrupted transfer; they are not proof of content,
      // and the CLI itself marks the digest unverified.
      if (typeof entry.size === "number" && stat.size !== entry.size) {
        throw Object.assign(new Error("The downloaded file size does not match Proton Drive."), { statusCode: 502, code: "PROTON_SIZE_MISMATCH" });
      }
      if (entry.sha1 && await hashFile(staged) !== entry.sha1) {
        throw Object.assign(new Error("The downloaded file does not match the digest Proton Drive reported."), { statusCode: 502, code: "PROTON_DIGEST_MISMATCH" });
      }

      fs.mkdirSync(this.paths.uploadsDir, { recursive: true });
      const name = importAttachmentName(entry.name), destination = path.join(this.paths.uploadsDir, name);
      // Rename cannot cross devices, and the staging directory may be on another
      // filesystem, so fall back to a copy before removing the staged file.
      try { fs.renameSync(staged, destination); }
      catch { fs.copyFileSync(staged, destination); fs.rmSync(staged, { force: true }); }
      fs.chmodSync(destination, 0o600);
      return { path: destination, name: path.basename(entry.name).slice(0, 80) || name, size: fs.statSync(destination).size };
    } finally {
      fs.rmSync(stage, { recursive: true, force: true });
    }
  }
}
