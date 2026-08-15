import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { importAttachmentName, insideRemoteRoot, ProtonDriveImportService } from "../../src/server/proton-drive-import.js";
import { DEFAULT_PROTON_DRIVE_SETTINGS } from "../../src/server/proton-drive-settings.js";

const roots: string[] = [];
const temporary = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), "proton-import-")); roots.push(root); return root; };
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

const settings = (patch: Partial<typeof DEFAULT_PROTON_DRIVE_SETTINGS> = {}) => async () => ({ ...DEFAULT_PROTON_DRIVE_SETTINGS, enabled: true, remoteRoot: "/my-files/wh업로드", ...patch });

function service(options: {
  entries: Record<string, any[]>;
  content?: Buffer;
  downloadName?: string;
  onDownload?: (remotePath: string) => void;
}) {
  const root = temporary(), uploadsDir = path.join(root, "uploads"), tempDir = path.join(root, "temp");
  fs.mkdirSync(uploadsDir); fs.mkdirSync(tempDir);
  const cli = {
    entries: async (remotePath: string) => options.entries[remotePath] ?? [],
    download: async (remotePath: string, localFolder: string) => {
      options.onDownload?.(remotePath);
      fs.writeFileSync(path.join(localFolder, options.downloadName ?? "tagloom.zip"), options.content ?? Buffer.from("payload"));
      return { remotePath, output: "" };
    }
  } as any;
  return { service: new ProtonDriveImportService(cli, { uploadsDir, tempDir }, settings()), uploadsDir, tempDir };
}

const zip = Buffer.from("PK archive contents");
const zipSha1 = crypto.createHash("sha1").update(zip).digest("hex");
const fileEntry = { name: "tagloom.zip", kind: "file", size: zip.length, sha1: zipSha1, mediaType: "application/zip", modifiedAt: "2026-08-08T12:29:38.000Z" };

describe("Proton Drive import", () => {
  it("keeps the containment check on the same comparison the resolver uses", () => {
    expect(insideRemoteRoot("/my-files/wh업로드", "/my-files/WH업로드/tagloom.zip")).toBe(true);
    // A byte-wise prefix test would accept this sibling folder.
    expect(insideRemoteRoot("/my-files/root", "/my-files/root-evil/x.zip")).toBe(false);
    expect(insideRemoteRoot("/my-files/root", "/my-files/root")).toBe(false);
    expect(insideRemoteRoot("/my-files/root", "/my-files/root/../../etc/passwd")).toBe(false);
    expect(insideRemoteRoot("/my-files/root", "/my-files/other/x.zip")).toBe(false);
  });

  it("gives every import a unique local name and keeps the readable part", () => {
    const first = importAttachmentName("tagloom.zip"), second = importAttachmentName("tagloom.zip");
    expect(first).not.toBe(second);
    expect(first.endsWith("-tagloom.zip")).toBe(true);
    expect(importAttachmentName("../../etc/passwd")).toMatch(/-passwd$/);
  });

  it("lists files and folders under the configured root only", async () => {
    const { service: subject } = service({
      entries: { "/my-files/wh업로드": [fileEntry, { name: "보관", kind: "folder" }] }
    });
    const listed = await subject.candidates();
    expect(listed.folders).toEqual(["보관"]);
    expect(listed.files).toEqual([{ name: "tagloom.zip", remotePath: "/my-files/wh업로드/tagloom.zip", size: zip.length, mediaType: "application/zip", modifiedAt: "2026-08-08T12:29:38.000Z" }]);
  });

  it("imports a picked file into the attachment directory", async () => {
    const { service: subject, uploadsDir } = service({ entries: { "/my-files/wh업로드": [fileEntry] }, content: zip });
    const attachment = await subject.importFile("/my-files/wh업로드/tagloom.zip");
    expect(attachment.name).toBe("tagloom.zip");
    expect(attachment.size).toBe(zip.length);
    expect(path.dirname(attachment.path)).toBe(uploadsDir);
    expect(fs.readFileSync(attachment.path)).toEqual(zip);
    expect(fs.statSync(attachment.path).mode & 0o777).toBe(0o600);
  });

  it("accepts a mis-cased request and fetches the name Proton stores", async () => {
    const requested: string[] = [];
    const { service: subject } = service({ entries: { "/my-files/WH업로드": [fileEntry] }, content: zip, onDownload: (remotePath) => requested.push(remotePath) });
    await subject.importFile("/my-files/WH업로드/TAGLOOM.ZIP");
    expect(requested).toEqual(["/my-files/WH업로드/tagloom.zip"]);
  });

  it("refuses a path outside the configured root", async () => {
    const { service: subject } = service({ entries: {} });
    await expect(subject.importFile("/my-files/다른폴더/secret.zip")).rejects.toMatchObject({ code: "PROTON_PATH_OUTSIDE_ROOT", statusCode: 403 });
  });

  it("rejects a truncated download instead of attaching it", async () => {
    const { service: subject, uploadsDir } = service({ entries: { "/my-files/wh업로드": [fileEntry] }, content: Buffer.from("short") });
    await expect(subject.importFile("/my-files/wh업로드/tagloom.zip")).rejects.toMatchObject({ code: "PROTON_SIZE_MISMATCH" });
    expect(fs.readdirSync(uploadsDir)).toEqual([]);
  });

  it("rejects content that does not match the digest Proton reported", async () => {
    const wrong = Buffer.alloc(zip.length, 0x41);
    const { service: subject, uploadsDir } = service({ entries: { "/my-files/wh업로드": [fileEntry] }, content: wrong });
    await expect(subject.importFile("/my-files/wh업로드/tagloom.zip")).rejects.toMatchObject({ code: "PROTON_DIGEST_MISMATCH" });
    expect(fs.readdirSync(uploadsDir)).toEqual([]);
  });

  it("removes the staging directory whether the import succeeds or fails", async () => {
    const { service: ok, tempDir: okTemp } = service({ entries: { "/my-files/wh업로드": [fileEntry] }, content: zip });
    await ok.importFile("/my-files/wh업로드/tagloom.zip");
    expect(fs.readdirSync(path.join(okTemp, "proton-imports"))).toEqual([]);
    const { service: bad, tempDir: badTemp } = service({ entries: { "/my-files/wh업로드": [fileEntry] }, content: Buffer.from("short") });
    await expect(bad.importFile("/my-files/wh업로드/tagloom.zip")).rejects.toBeTruthy();
    expect(fs.readdirSync(path.join(badTemp, "proton-imports"))).toEqual([]);
  });

  it("refuses to import a folder", async () => {
    const { service: subject } = service({ entries: { "/my-files/wh업로드": [{ name: "보관", kind: "folder" }] } });
    await expect(subject.importFile("/my-files/wh업로드/보관")).rejects.toMatchObject({ code: "PROTON_NOT_A_FILE" });
  });

  it("stays disabled until Proton Drive is switched on", async () => {
    const root = temporary();
    const subject = new ProtonDriveImportService({} as any, { uploadsDir: root, tempDir: root }, async () => ({ ...DEFAULT_PROTON_DRIVE_SETTINGS, enabled: false }));
    await expect(subject.candidates()).rejects.toMatchObject({ code: "PROTON_DISABLED" });
    await expect(subject.importFile("/my-files/Claudex-Workhouse/x.zip")).rejects.toMatchObject({ code: "PROTON_DISABLED" });
  });
});
