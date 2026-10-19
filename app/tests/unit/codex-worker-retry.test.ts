import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { codexTurnError } from "../../src/server/codex/provider-error.js";

// Exercise the worker's actual completion callback without starting a provider.
function waiter(mode = "resume") {
  const source = fs.readFileSync(new URL("../../src/server/codex-worker.ts", import.meta.url), "utf8");
  const start = source.indexOf("  const completion = new Promise<any>");
  const end = source.indexOf('\n  if(mode==="compact"){', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const client: any = {};
  const events: any[] = [];
  const context = { client, threadId: "root", turnId: "turn", mode, codexTurnError, appendNotification: (event: any) => events.push(event), write: () => {} };
  const code = ts.transpileModule(source.slice(start, end) + "\ncompletion;", { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const completion: Promise<any> = vm.runInNewContext(code, context);
  return { client, completion, events };
}

describe("Codex worker reconnect completion", () => {
  it("waits through retry notifications and accepts the completed turn", async () => {
    const { client, completion, events } = waiter();
    client.onNotification({ method: "error", params: { threadId: "root", willRetry: true, error: { message: "Reconnecting... 2/5" } } });
    client.onNotification({ method: "error", params: { threadId: "root", willRetry: true, error: { message: "Reconnecting... 3/5" } } });
    client.onNotification({ method: "turn/completed", params: { threadId: "root", turn: { id: "turn", status: "completed" } } });
    await expect(completion).resolves.toEqual({ id: "turn", status: "completed" });
    expect(events).toHaveLength(3);
  });
  it.each([false, undefined])("still rejects terminal errors (willRetry=%s)", async (willRetry) => {
    const { client, completion } = waiter();
    client.onNotification({ method: "error", params: { threadId: "root", willRetry, error: { message: "connection exhausted" } } });
    await expect(completion).rejects.toThrow("connection exhausted");
  });
  it("does not fail the root turn for a child thread error", async () => {
    const { client, completion } = waiter();
    client.onNotification({ method: "error", params: { threadId: "child", willRetry: false, error: { message: "child failed" } } });
    client.onNotification({ method: "turn/completed", params: { threadId: "root", turn: { id: "turn", status: "completed" } } });
    await expect(completion).resolves.toMatchObject({ status: "completed" });
  });
  it("still rejects when the app-server closes during retry", async () => {
    const { client, completion } = waiter();
    client.onNotification({ method: "error", params: { threadId: "root", willRetry: true } });
    client.onClose(new Error("app-server exited"));
    await expect(completion).rejects.toThrow("app-server exited");
  });
  it("preserves the upstream error code and HTTP status on terminal failure", async () => {
    const { client, completion } = waiter();
    client.onNotification({ method:"error", params:{threadId:"root", willRetry:false, error:{message:"upstream unavailable", codexErrorInfo:{httpConnectionFailed:{httpStatusCode:503}}}} });
    await expect(completion).rejects.toMatchObject({providerError:{codexErrorCode:"httpConnectionFailed",upstreamHttpStatus:503}});
  });
  it("fails compaction immediately when only a failed turn completion arrives", async () => {
    const { client, completion } = waiter("compact");
    client.onNotification({ method:"turn/completed", params:{threadId:"root",turn:{id:"turn",status:"failed",error:{message:"Selected model is at capacity.",codexErrorInfo:"serverOverloaded"}}} });
    await expect(completion).rejects.toMatchObject({message:"Selected model is at capacity.",providerError:{codexErrorCode:"serverOverloaded"}});
  });
  it("does not report an interrupted compaction as successful", async () => {
    const { client, completion } = waiter("compact");
    client.onNotification({ method:"turn/completed", params:{threadId:"root",turn:{id:"turn",status:"interrupted"}} });
    await expect(completion).rejects.toThrow("Codex context compaction did not complete.");
  });
  it("does not confuse a finished compaction item with a successful turn", async () => {
    const { client, completion } = waiter("compact");
    client.onNotification({method:"item/completed",params:{threadId:"root",item:{type:"contextCompaction"}}});
    client.onNotification({method:"turn/completed",params:{threadId:"root",turn:{id:"turn",status:"failed",error:{message:"compact failed",codexErrorInfo:"serverOverloaded"}}}});
    await expect(completion).rejects.toThrow("compact failed");
  });
  it.each(["thread/compacted","turn/completed"])("accepts successful compaction via %s", async method => {
    const { client, completion } = waiter("compact");
    client.onNotification({method,params:{threadId:"root",item:{type:"contextCompaction"},turn:{id:"turn",status:"completed"}}});
    await expect(completion).resolves.toMatchObject({status:"completed"});
  });
});
