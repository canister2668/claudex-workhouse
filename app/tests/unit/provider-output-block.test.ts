import {describe,expect,it} from "vitest";
import {ProviderOutputBlockTracker,providerOutputBlockId} from "../../src/server/provider-output-block.js";

describe("provider output block identity",()=>{
  it("keeps growing stream and completed snapshots in the same response block",()=>{
    expect(providerOutputBlockId("msg_123",0)).toBe("msg_123:0");
    expect(providerOutputBlockId("msg_123","0")).toBe("msg_123:0");
    expect(providerOutputBlockId("msg_123",1)).toBe("msg_123:1");
  });

  it("does not invent an identity before the provider publishes one",()=>{
    expect(providerOutputBlockId(null,0)).toBeNull();
    expect(providerOutputBlockId("",0)).toBeNull();
  });

  it("maps sparse native block indexes to the same completion ordinals",()=>{
    const tracker=new ProviderOutputBlockTracker();
    expect(tracker.streamed("msg_123",1)).toBe("msg_123:0");
    expect(tracker.streamed("msg_123",1)).toBe("msg_123:0");
    expect(tracker.completed("msg_123")).toBe("msg_123:0");
    expect(tracker.streamed("msg_123",3)).toBe("msg_123:1");
    expect(tracker.completed("msg_123")).toBe("msg_123:1");
  });
});
