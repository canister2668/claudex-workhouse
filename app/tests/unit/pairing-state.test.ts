import { describe,expect,it } from "vitest";
import { mergePairingStatus } from "../../src/web/pairing-state.js";

describe("worker pairing state",()=>{
  it("preserves the one-time code across status polling",()=>{
    const current={id:"attempt",status:"waiting" as const,code:"ABCD-EFGH-IJKL",expiresAt:"later"};
    expect(mergePairingStatus(current,{id:"attempt",status:"waiting",expiresAt:"later"})).toMatchObject({code:"ABCD-EFGH-IJKL",status:"waiting"});
  });

  it("drops the code after pairing completes",()=>{
    const current={id:"attempt",status:"waiting" as const,code:"ABCD-EFGH-IJKL"};
    expect(mergePairingStatus(current,{id:"attempt",status:"paired"})).not.toHaveProperty("code");
  });
});
