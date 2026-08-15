import { describe, expect, it } from "vitest";
import { defaultSessionHeadingCollapsed, keyboardInset, PHONE_MAX_WIDTH } from "../../src/web/mobile-viewport";

describe("defaultSessionHeadingCollapsed",()=>{
  it("defaults only phone-sized viewports to a collapsed session heading",()=>{
    expect(defaultSessionHeadingCollapsed(PHONE_MAX_WIDTH)).toBe(true);
    expect(defaultSessionHeadingCollapsed(PHONE_MAX_WIDTH+1)).toBe(false);
    expect(defaultSessionHeadingCollapsed(800)).toBe(false);
  });
});

describe("keyboardInset",()=>{
  it("returns the visual viewport area hidden by a keyboard",()=>{
    expect(keyboardInset(844,510,0,true)).toBe(334);
  });

  it("accounts for a shifted visual viewport",()=>{
    expect(keyboardInset(844,500,44,true)).toBe(300);
  });

  it("does not treat viewport changes as a keyboard without editable focus",()=>{
    expect(keyboardInset(844,500,0,false)).toBe(0);
  });

  it("never returns a negative inset",()=>{
    expect(keyboardInset(700,720,0,true)).toBe(0);
  });
});
