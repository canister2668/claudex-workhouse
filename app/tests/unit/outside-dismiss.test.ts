import fs from "node:fs";
import path from "node:path";
import {describe,expect,it}from"vitest";
import {shouldDismissOutside}from"../../src/web/outside-dismiss";

const app=fs.readFileSync(path.join(process.cwd(),"src","web","App.svelte"),"utf8");
const target=(matches:string[])=>({closest:(selector:string)=>matches.some(value=>selector.includes(value))?{}:null});
const inside=(value:unknown)=>value===INSIDE;
const INSIDE={closest:()=>null};

describe("outside dismiss",()=>{
  it("keeps the popup open for a pointer landing inside it",()=>{
    expect(shouldDismissOutside(INSIDE,inside)).toBe(false);
  });

  it("dismisses for a pointer anywhere else",()=>{
    expect(shouldDismissOutside(target([]),inside)).toBe(true);
    expect(shouldDismissOutside(null,inside)).toBe(true);
  });

  it("leaves the trigger alone so its own click can toggle the popup",()=>{
    // pointerdown fires before click. Dismissing here would close the popup and
    // let the trigger immediately re-open it, which reads as a dead button.
    expect(shouldDismissOutside(target(["[data-popup-trigger=\"quota\"]"]),inside,'[data-popup-trigger="quota"]')).toBe(false);
    expect(shouldDismissOutside(target(["[data-popup-trigger=\"other\"]"]),inside,'[data-popup-trigger="quota"]')).toBe(true);
  });
});

describe("small popups use it instead of a close button",()=>{
  it("dismisses the usage panel by tapping away",()=>{
    expect(app).toContain('<div class="quota-pop" role="status" use:dismissOnOutside=');
    expect(app).toContain('triggerSelector:\'[data-popup-trigger="quota"]\'');
    expect(app).toContain('data-popup-trigger="quota"');
  });

  it("drops the close button the surrounding screen replaces",()=>{
    const quota=app.slice(app.indexOf('<div class="quota-pop"'),app.indexOf('<div class="quota-pop"')+1_200);
    expect(quota).not.toContain('$t("common.close")');
  });

  it("shares one implementation with the topbar overflow sheet",()=>{
    expect(app.match(/use:dismissOnOutside=/g)?.length).toBeGreaterThanOrEqual(2);
    expect(app).toContain('triggerSelector:\'[data-popup-trigger="overflow"]\'');
    // The hand-rolled listeners this replaced must be gone.
    expect(app).not.toContain("overflowOutside");
    expect(app).not.toContain("overflowKey");
  });
});
