import { describe,expect,it } from "vitest";
import { activeTaskStatus,shouldPollAttention,shouldPollMessageQueue } from "../../src/web/client-polling.js";

describe("client polling gates",()=>{
  it("polls queues only while the task or a deliverable item is active",()=>{
    expect(shouldPollMessageQueue(true,[])).toBe(true);
    expect(shouldPollMessageQueue(false,[{status:"queued"}])).toBe(true);
    expect(shouldPollMessageQueue(false,[{status:"failed"}])).toBe(false);
    expect(shouldPollMessageQueue(false,[])).toBe(false);
  });
  it("stops attention polling after terminal state is empty",()=>{
    expect(activeTaskStatus("waiting")).toBe(true);
    expect(shouldPollAttention("completed",1)).toBe(true);
    expect(shouldPollAttention("completed",0)).toBe(false);
  });
});

describe("message queue watching", () => {
  // The dispatcher removes the queue item before the task it started is
  // reported, so an empty queue on a finished turn used to stop the watch and
  // strand the open session on that finished turn.
  it("keeps watching while the thread's newest task is still running", () => {
    expect(shouldPollMessageQueue(false, [], true)).toBe(true);
    expect(shouldPollMessageQueue(false, [], false)).toBe(false);
    expect(shouldPollMessageQueue(true, [], false)).toBe(true);
    expect(shouldPollMessageQueue(false, [{ status: "queued" }], false)).toBe(true);
  });
});
