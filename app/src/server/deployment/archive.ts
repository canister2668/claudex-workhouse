import crypto from "node:crypto";
import { gzipSync } from "node:zlib";
import type {
  DeploymentArtifact,
  DeploymentBundle,
  DeploymentBundleArchive
} from "./types.js";

const TAR_BLOCK_SIZE = 512;

function writeAscii(target: Buffer, offset: number, length: number, value: string): void {
  const encoded = Buffer.from(value, "ascii");
  if (encoded.length > length) throw new Error("Deployment archive field is too long.");
  encoded.copy(target, offset);
}

function octal(value: number, length: number): string {
  const digits = Math.trunc(value).toString(8);
  if (digits.length > length - 1) throw new Error("Deployment archive value is too large.");
  return `${digits.padStart(length - 1, "0")}\0`;
}

function tarHeader(name: string, artifact: DeploymentArtifact): Buffer {
  if (
    !/^[A-Za-z0-9._/-]+$/.test(name) ||
    name.startsWith("/") ||
    name.includes("../") ||
    Buffer.byteLength(name, "utf8") > 100
  ) {
    throw new Error("Deployment archive contains an unsafe path.");
  }
  const contentSize = Buffer.byteLength(artifact.content, "utf8");
  const header = Buffer.alloc(TAR_BLOCK_SIZE);
  writeAscii(header, 0, 100, name);
  writeAscii(header, 100, 8, octal(artifact.mode, 8));
  writeAscii(header, 108, 8, octal(0, 8));
  writeAscii(header, 116, 8, octal(0, 8));
  writeAscii(header, 124, 12, octal(contentSize, 12));
  writeAscii(header, 136, 12, octal(0, 12));
  header.fill(0x20, 148, 156);
  writeAscii(header, 156, 1, "0");
  writeAscii(header, 257, 6, "ustar\0");
  writeAscii(header, 263, 2, "00");
  writeAscii(header, 265, 32, "claudex");
  writeAscii(header, 297, 32, "claudex");
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  writeAscii(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
  return header;
}

function tarEntry(directoryName: string, artifact: DeploymentArtifact): Buffer[] {
  const name = `${directoryName}/${artifact.path}`;
  const content = Buffer.from(artifact.content, "utf8");
  const paddingLength =
    (TAR_BLOCK_SIZE - (content.length % TAR_BLOCK_SIZE)) % TAR_BLOCK_SIZE;
  return [
    tarHeader(name, artifact),
    content,
    ...(paddingLength ? [Buffer.alloc(paddingLength)] : [])
  ];
}

/**
 * Produces a deterministic, self-contained archive from a validated in-memory
 * deployment bundle. The archive is returned inline because plans are
 * immutable snapshots and are intentionally not persisted as server state.
 */
export function createDeploymentBundleArchive(
  bundle: DeploymentBundle
): DeploymentBundleArchive {
  const directoryName = `claudex-workhouse-${bundle.plan.id}`;
  const tar = Buffer.concat([
    ...bundle.artifacts.flatMap((artifact) => tarEntry(directoryName, artifact)),
    Buffer.alloc(TAR_BLOCK_SIZE * 2)
  ]);
  const compressed = gzipSync(tar, { level: 9 });
  return Object.freeze({
    fileName: `claudex-workhouse-${bundle.plan.id}.tar.gz`,
    directoryName,
    mediaType: "application/gzip",
    encoding: "base64",
    sha256: crypto.createHash("sha256").update(compressed).digest("hex"),
    size: compressed.length,
    content: compressed.toString("base64")
  });
}
