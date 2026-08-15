import fs from "node:fs";
import path from "node:path";
import {describe,expect,it}from"vitest";

describe("mobile session control transitions",()=>{
  const source=fs.readFileSync(path.join(process.cwd(),"src","web","sessions.css"),"utf8");
  const shared=fs.readFileSync(path.join(process.cwd(),"src","web","styles.css"),"utf8");

  // The controls used to fold away on an upward scroll, which took the model and
  // permission chips with them. Reading space is the drawer slide's job now, and
  // it does not hide what the session is configured as.
  it("keeps the phone controls out of a second collapse mechanism",()=>{
    expect(source).not.toContain("mobile-controls-collapsed");
  });

  it("clips the model summary text without clipping any control box",()=>{
    // Its own horizontal scroll left the badge parked past the model name, so the
    // row showed only the tail. Now it is the one item allowed to shrink: the text
    // is cut from the right, the pill itself always renders whole, and the chips
    // beside it never give up width.
    const summary=source.slice(source.indexOf(".setting-summary.tap{"));
    const declarations=summary.slice(0,summary.indexOf("}"));
    expect(declarations).toContain("overflow:hidden");
    expect(declarations).not.toContain("overflow-x:auto");
    expect(declarations).toContain("flex:0 1 auto");
    expect(declarations).toContain("min-width:0");
  });

  it("pins the overflow trigger outside the scrolling chips",()=>{
    expect(source).toContain(".chat-settings-bar .mobile-controls-toggle{margin-left:auto}");
    expect(source).toContain(".chat-settings-scroll{display:contents}");
    expect(source).toContain(".chat-settings-scroll{display:flex;min-width:0;flex:1 1 auto;");
  });

  // Bottom-aligned boxes of three different heights stepped their tops down
  // across the row, which reads as three unrelated controls rather than one line.
  it("gives the composer row a single control height",()=>{
    expect(shared).toContain(".composer.with-attach{grid-template-columns:44px 44px minmax(0,1fr) 44px}");
    expect(shared).toContain(".composer .icon-button.attach{width:44px;min-width:44px;height:44px;min-height:44px;");
    expect(shared).toContain(".composer .send{height:44px;min-height:44px}");
  });

  it("disables the movement when reduced motion is requested",()=>{
    expect(source).toContain("@media(max-width:600px) and (prefers-reduced-motion:reduce)");
    expect(source).toContain("transition:none");
  });
});
