import type { Readable } from "node:stream";

/** Default cap for one app-server JSON line; far below V8's ~512 MiB string limit. */
export const DEFAULT_MAX_APP_SERVER_LINE_BYTES = 64 * 1024 * 1024;
const OVERSIZED_HEAD_BYTES = 512;

export type OversizedLine = { head: string; bytes: number };
export type BoundedLineHandlers = { onLine(line: string): void; onOversized(line: OversizedLine): void };

export function maxAppServerLineBytes(env: NodeJS.ProcessEnv = process.env) {
  const configured = Number(env.CLAUDEX_WORKHOUSE_CODEX_MAX_LINE_BYTES);
  return Number.isSafeInteger(configured) && configured > 0 ? configured : DEFAULT_MAX_APP_SERVER_LINE_BYTES;
}

/**
 * Splits a newline-delimited stream without ever holding more than
 * `maxLineBytes` of one line.
 *
 * `readline` concatenates an unbounded line into a single string, so one
 * oversized app-server message (a resumed thread full of base64 images) throws
 * `RangeError: Invalid string length` from a stream callback and takes the
 * whole process down. Here an oversized line is dropped as it streams in and
 * reported once with its first bytes, so the caller can fail just the request
 * it belonged to.
 */
export class BoundedLineReader {
  private chunks: Buffer[] = [];
  private size = 0;
  private discarding: OversizedLine | null = null;

  constructor(private readonly maxLineBytes: number, private readonly handlers: BoundedLineHandlers) {}

  static attach(stream: Readable, maxLineBytes: number, handlers: BoundedLineHandlers) {
    const reader = new BoundedLineReader(maxLineBytes, handlers);
    stream.on("data", (chunk: Buffer | string) => reader.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk));
    stream.on("end", () => reader.end());
    return reader;
  }

  push(chunk: Buffer) {
    let start = 0;
    while (start < chunk.length) {
      const newline = chunk.indexOf(0x0a, start);
      const stop = newline === -1 ? chunk.length : newline;
      this.append(chunk.subarray(start, stop));
      if (newline === -1) return;
      this.finishLine();
      start = newline + 1;
    }
  }

  end() { if (this.size || this.discarding) this.finishLine(); }

  private append(part: Buffer) {
    if (!part.length) return;
    if (this.discarding) { this.discarding.bytes += part.length; return; }
    if (this.size + part.length > this.maxLineBytes) {
      const head = Buffer.concat([...this.chunks, part.subarray(0, Math.max(0, OVERSIZED_HEAD_BYTES - this.size))]).subarray(0, OVERSIZED_HEAD_BYTES);
      this.discarding = { head: head.toString("utf8"), bytes: this.size + part.length };
      this.chunks = []; this.size = 0;
      return;
    }
    this.chunks.push(part); this.size += part.length;
  }

  private finishLine() {
    const oversized = this.discarding;
    const buffer = this.chunks.length === 1 ? this.chunks[0] : Buffer.concat(this.chunks, this.size);
    this.chunks = []; this.size = 0; this.discarding = null;
    if (oversized) { this.handlers.onOversized(oversized); return; }
    let line = buffer.toString("utf8");
    if (line.endsWith("\r")) line = line.slice(0, -1);
    if (line) this.handlers.onLine(line);
  }
}

/** Reads the top-level JSON-RPC id from the start of a truncated message, when it leads the object. */
export function leadingJsonRpcId(head: string): number | null {
  const match = /^\s*\{\s*(?:"jsonrpc"\s*:\s*"[^"]*"\s*,\s*)?"id"\s*:\s*(\d+)\s*[,}]/.exec(head);
  return match ? Number(match[1]) : null;
}
