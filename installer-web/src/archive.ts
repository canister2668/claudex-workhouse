import type { InstallerArtifact, InstallerBundle } from "./types";

const BLOCK = 512;

function ascii(target: Uint8Array, offset: number, length: number, value: string): void {
  const bytes = new TextEncoder().encode(value);
  if (bytes.length > length || bytes.some((byte) => byte > 0x7f)) {
    throw new Error("tar header 값이 너무 길거나 ASCII가 아닙니다.");
  }
  target.set(bytes, offset);
}

function octal(value: number, length: number): string {
  const digits = Math.trunc(value).toString(8);
  if (digits.length > length - 1) throw new Error("tar 값이 너무 큽니다.");
  return `${digits.padStart(length - 1, "0")}\0`;
}

function header(name: string, artifact: InstallerArtifact, size: number): Uint8Array {
  if (
    !/^[A-Za-z0-9._/-]+$/.test(name) ||
    name.startsWith("/") ||
    name.includes("../") ||
    new TextEncoder().encode(name).length > 100
  ) {
    throw new Error("안전하지 않은 archive 경로입니다.");
  }
  const output = new Uint8Array(BLOCK);
  ascii(output, 0, 100, name);
  ascii(output, 100, 8, octal(artifact.mode, 8));
  ascii(output, 108, 8, octal(0, 8));
  ascii(output, 116, 8, octal(0, 8));
  ascii(output, 124, 12, octal(size, 12));
  ascii(output, 136, 12, octal(0, 12));
  output.fill(0x20, 148, 156);
  ascii(output, 156, 1, "0");
  ascii(output, 257, 6, "ustar\0");
  ascii(output, 263, 2, "00");
  ascii(output, 265, 32, "claudex");
  ascii(output, 297, 32, "claudex");
  const checksum = output.reduce((sum, byte) => sum + byte, 0);
  ascii(output, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
  return output;
}

export function createTar(bundle: InstallerBundle): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (const artifact of bundle.artifacts) {
    const content = encoder.encode(artifact.content);
    const entryHeader = header(
      `${bundle.directoryName}/${artifact.path}`,
      artifact,
      content.length
    );
    const padding = new Uint8Array((BLOCK - (content.length % BLOCK)) % BLOCK);
    chunks.push(entryHeader, content, padding);
    length += entryHeader.length + content.length + padding.length;
  }
  chunks.push(new Uint8Array(BLOCK * 2));
  length += BLOCK * 2;
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

export function gzipSupported(): boolean {
  return typeof CompressionStream !== "undefined";
}

export async function createTarGzip(bundle: InstallerBundle): Promise<Uint8Array> {
  if (!gzipSupported()) throw new Error("이 브라우저는 gzip 생성을 지원하지 않습니다.");
  const tar = createTar(bundle);
  const stream = new Blob([tar.slice().buffer])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
