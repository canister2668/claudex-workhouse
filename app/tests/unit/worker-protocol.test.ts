import { describe, expect, it } from "vitest";
import { WORKER_COMMANDS, workerHelloSchema, workerMessageSchema } from "../../src/server/worker-protocol.js";

describe("Desktop Worker protocol",()=>{
  it("exposes typed operations and no generic shell command",()=>{
    expect(WORKER_COMMANDS).toContain("provider.task.start");
    expect(WORKER_COMMANDS).toContain("provider.session.delete");
    expect(WORKER_COMMANDS).toContain("workspace.git.clone");
    expect(WORKER_COMMANDS).toContain("provider.approval.respond");
    expect(WORKER_COMMANDS).toContain("provider.userInput.respond");
    expect(WORKER_COMMANDS).toContain("workspace.files.read");
    expect(WORKER_COMMANDS).toContain("workspace.files.resolve");
    expect(WORKER_COMMANDS).toContain("workspace.files.edit.read");
    expect(WORKER_COMMANDS).toContain("workspace.files.write");
    expect(WORKER_COMMANDS).toContain("workspace.files.download.prepare");
    expect(WORKER_COMMANDS).toContain("workspace.files.download.chunk");
    expect(WORKER_COMMANDS).toContain("workspace.files.download.cancel");
    expect(WORKER_COMMANDS).toContain("task.image-output.prepare");
    expect(WORKER_COMMANDS).toContain("task.image-output.chunk");
    expect(WORKER_COMMANDS).toContain("task.image-output.cancel");
    expect(WORKER_COMMANDS).toContain("host.update.apply");
    expect(WORKER_COMMANDS.some(value=>/shell|exec|argv/i.test(value))).toBe(false);
  });
  it("binds update identity into the authenticated hello",()=>{
    const base={type:"auth.response",hostId:crypto.randomUUID(),challengeId:crypto.randomUUID(),response:"a".repeat(64),sequence:1,workerVersion:"1.2.3",packageSha256:"b".repeat(64),updaterProtocolVersion:1};
    expect(workerHelloSchema.safeParse(base).success).toBe(true);
    expect(workerHelloSchema.safeParse({...base,packageSha256:undefined}).success).toBe(false);
    expect(workerHelloSchema.safeParse({...base,updaterProtocolVersion:0}).success).toBe(false);
  });
  it("rejects unknown fields and stale-shaped messages",()=>{
    const base={type:"heartbeat",generation:crypto.randomUUID(),sequence:2,sentAt:new Date().toISOString()};
    expect(workerMessageSchema.safeParse(base).success).toBe(true);
    expect(workerMessageSchema.safeParse({...base,command:"shell.exec"}).success).toBe(false);
  });
});
