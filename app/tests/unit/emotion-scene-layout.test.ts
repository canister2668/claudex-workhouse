import fs from "node:fs";
import path from "node:path";
import {describe,expect,it}from"vitest";

const sessions=fs.readFileSync(path.join(process.cwd(),"src","web","sessions.css"),"utf8");
const phone=sessions.slice(sessions.lastIndexOf("@media(max-width:599px){"));

describe("phone emotion scenes stop wasting space",()=>{
  it("puts the asset in a narrow column beside the line instead of its own band",()=>{
    // A full-width row for a square asset left most of the block empty.
    expect(phone).toContain("grid-template-columns:104px minmax(0,1fr)");
    expect(phone).toMatch(/figcaption\{grid-column:2;grid-row:1/);
    expect(phone).toMatch(/img\{grid-column:1;grid-row:1/);
  });

  it("crops instead of letterboxing, keeping the face in view",()=>{
    expect(phone).toContain("object-fit:cover");
    expect(phone).toContain("object-position:center top");
  });

  it("caps the asset height so a long line cannot stretch it",()=>{
    expect(phone).toContain("max-height:184px");
  });

  it("still lets the desktop layout use the wide contained asset",()=>{
    expect(sessions).toContain(".inline-emotion-scene img{width:156px;height:156px;align-self:center;object-fit:contain");
  });
});
