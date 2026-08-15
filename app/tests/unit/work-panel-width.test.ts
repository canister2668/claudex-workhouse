import fs from "node:fs";
import path from "node:path";
import {describe,expect,it}from"vitest";

const styles=fs.readFileSync(path.join(process.cwd(),"src","web","styles.css"),"utf8");
const panel=styles.slice(styles.indexOf(".work-status-panel{"),styles.indexOf("}",styles.indexOf(".work-status-panel{")));
const drawer=styles.slice(styles.indexOf(".work-status-drawer{"),styles.indexOf("}",styles.indexOf(".work-status-drawer{")));

describe("the work panel stays inside the screen",()=>{
  it("uses a column that can shrink below its content",()=>{
    // An implicit grid column is sized by its widest item, so one long command
    // line pushed the panel past the viewport.
    expect(panel).toContain("display:grid");
    expect(panel).toContain("grid-template-columns:minmax(0,1fr)");
  });

  it("holds every row to the panel width",()=>{
    expect(styles).toContain(".work-status-panel>*{min-width:0;max-width:100%}");
    expect(styles).toMatch(/\.work-status-panel code,\.work-status-panel pre\{max-width:100%;overflow-wrap:anywhere\}/);
  });

  it("clips rather than offering a horizontal scrollbar",()=>{
    expect(drawer).toContain("overflow:hidden");
    expect(panel).toContain("overflow-y:auto");
    expect(panel).not.toContain("overflow-x:auto");
    expect(panel).not.toContain("overflow:auto");
  });

  it("uses the agreed phone, tablet and wide work-panel breakpoints",()=>{
    expect(styles).toContain("@media(max-width:760px)");
    expect(styles).toContain("@media(min-width:901px)");
    expect(styles).toContain(".work-status-panel{grid-template-columns:minmax(0,1.15fr) minmax(250px,.85fr)");
  });
});
