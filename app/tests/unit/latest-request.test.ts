import {describe,expect,it} from "vitest";
import {createLatestRequestGate} from "../../src/web/latest-request.js";

describe("latest request gate",()=>{
  it("rejects every response older than the newest request",()=>{
    const gate=createLatestRequestGate(),first=gate.begin(),second=gate.begin();
    expect(gate.isCurrent(first)).toBe(false);
    expect(gate.isCurrent(second)).toBe(true);
  });
});
