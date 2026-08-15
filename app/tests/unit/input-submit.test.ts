import { describe, expect, it } from "vitest";
import { shouldSubmitOnEnter } from "../../src/web/input-submit.js";

const key=(patch:Partial<Parameters<typeof shouldSubmitOnEnter>[0]>={})=>({key:"Enter",shiftKey:false,altKey:false,ctrlKey:false,metaKey:false,isComposing:false,...patch});

describe("Enter submit preference",()=>{
  it("submits plain Enter only when enabled",()=>{
    expect(shouldSubmitOnEnter(key(),true)).toBe(true);
    expect(shouldSubmitOnEnter(key(),false)).toBe(false);
  });
  it("preserves newline and IME composition",()=>{
    expect(shouldSubmitOnEnter(key({shiftKey:true}),true)).toBe(false);
    expect(shouldSubmitOnEnter(key({isComposing:true}),true)).toBe(false);
    expect(shouldSubmitOnEnter(key({key:"a"}),true)).toBe(false);
  });
});
