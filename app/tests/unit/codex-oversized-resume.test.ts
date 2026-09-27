import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { BoundedLineReader, leadingJsonRpcId, maxAppServerLineBytes } from "../../src/server/codex/bounded-line-reader";
import { CodexAppServerClient } from "../../src/server/codex/app-server";
import { workerLostMessage } from "../../src/server/providers/codex";

function collect(max: number) {
  const lines: string[] = [], oversized: { head: string; bytes: number }[] = [];
  return { lines, oversized, reader: new BoundedLineReader(max, { onLine: line => lines.push(line), onOversized: line => oversized.push(line) }) };
}

describe("bounded app-server line reader", () => {
  it("splits lines across arbitrary chunk boundaries and keeps multibyte text intact", () => {
    const { lines, reader } = collect(1024), payload = Buffer.from('{"a":"가나다"}\n{"b":2}\r\n{"c"');
    for (const byte of payload) reader.push(Buffer.from([byte]));
    reader.push(Buffer.from(":3}\n"));
    expect(lines).toEqual(['{"a":"가나다"}', '{"b":2}', '{"c":3}']);
  });

  it("drops an oversized line without buffering it and resumes at the next line", () => {
    const { lines, oversized, reader } = collect(64);
    reader.push(Buffer.from('{"id":7,"result":{"thread":"'));
    for (let i = 0; i < 100; i++) reader.push(Buffer.from("x".repeat(1000)));
    reader.push(Buffer.from('"}}\n{"method":"ok"}\n'));
    expect(lines).toEqual(['{"method":"ok"}']);
    expect(oversized).toHaveLength(1);
    expect(oversized[0].head.startsWith('{"id":7,')).toBe(true);
    expect(oversized[0].bytes).toBeGreaterThan(100_000);
    expect((reader as any).size).toBe(0);
  });

  it("flushes a final unterminated line on end", () => {
    const { lines, reader } = collect(64);
    reader.push(Buffer.from('{"x":1}'));
    reader.end();
    expect(lines).toEqual(['{"x":1}']);
  });

  it("reads only a leading top-level id", () => {
    expect(leadingJsonRpcId('{"id":12,"result":{')).toBe(12);
    expect(leadingJsonRpcId('{"jsonrpc":"2.0","id":3,"result"')).toBe(3);
    expect(leadingJsonRpcId('{"method":"item/completed","params":{"id":5')).toBeNull();
  });

  it("accepts a positive integer override for the line cap", () => {
    expect(maxAppServerLineBytes({ CLAUDEX_WORKHOUSE_CODEX_MAX_LINE_BYTES: "1024" })).toBe(1024);
    expect(maxAppServerLineBytes({ CLAUDEX_WORKHOUSE_CODEX_MAX_LINE_BYTES: "-1" })).toBe(64 * 1024 * 1024);
  });
});

describe("Codex app-server oversized responses", () => {
  it("fails only the request the oversized response answered", async () => {
    const client: any = Object.create(CodexAppServerClient.prototype);
    client.pending = new Map(); client.stderr = "";
    const target = new Promise((resolve, reject) => client.pending.set(4, { resolve, reject, timer: setTimeout(() => {}, 0) }));
    const other = vi.fn();
    client.pending.set(5, { resolve: other, reject: other, timer: setTimeout(() => {}, 0) });
    client.handleOversizedLine({ head: '{"id":4,"result":', bytes: 600 * 1024 * 1024 });
    await expect(target).rejects.toMatchObject({ code: "APP_SERVER_RESPONSE_TOO_LARGE" });
    expect(client.pending.has(5)).toBe(true);
    expect(other).not.toHaveBeenCalled();
    expect(client.stderr).toContain("600 MiB");
  });
});

describe("lost Codex worker diagnostics", () => {
  it("keeps the plain message when the worker left no stderr", () => {
    expect(workerLostMessage(path.join(os.tmpdir(), "missing-codex-worker.stderr.log"))).toBe("Worker process is no longer running.");
  });

  it("surfaces the error line of a crashed worker", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-stderr-")), file = path.join(root, "job.stderr.log");
    try {
      fs.writeFileSync(file, "node:internal/readline/interface:618\n        this[kLine_buffer] += string;\n\nRangeError: Invalid string length\n    at [_normalWrite] (node:internal/readline/interface:618:31)\n\nNode.js v22.22.3\n");
      expect(workerLostMessage(file)).toBe("Worker process is no longer running. Last worker error: RangeError: Invalid string length");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
