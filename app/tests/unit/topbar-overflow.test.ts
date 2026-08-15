import fs from "node:fs";
import path from "node:path";
import {describe,expect,it}from"vitest";

const app=fs.readFileSync(path.join(process.cwd(),"src","web","App.svelte"),"utf8");
const styles=fs.readFileSync(path.join(process.cwd(),"src","web","styles.css"),"utf8");
const topActions=app.slice(app.indexOf('<div class="top-actions">'),app.indexOf('class="topbar-overflow"'));
const snippet=app.slice(app.indexOf("{#snippet topbarUtilities"),app.indexOf("{/snippet}"));
const brand=app.slice(app.indexOf('<div class="brand"'),app.indexOf('class="primary-nav'));

describe("phone topbar overflow",()=>{
  it("renders the utility actions from one definition instead of duplicating them",()=>{
    // Two copies would drift apart the moment an action changes.
    expect(app).toContain("{#snippet topbarUtilities(labelled:boolean)}");
    expect(app.match(/\{@render topbarUtilities\(/g)).toHaveLength(2);
    // The inline row and the sheet both come from the snippet, so the topbar
    // itself must not spell any utility button out a second time.
    for(const key of ["quota.title","a11y.openSettings","a11y.openSearch","common.refresh"]){
      expect(snippet).toContain(`aria-label={$t("${key}")}`);
      expect(topActions).not.toContain(`aria-label={$t("${key}")}`);
    }
  });

  it("keeps new task in its own slot at the far right",()=>{
    const overflow=topActions.indexOf("toggleOverflow");
    const inline=topActions.indexOf("{@render topbarUtilities(false)}");
    const create=topActions.indexOf('class="new-button"');
    expect(overflow).toBeGreaterThan(-1);
    expect(inline).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(overflow);
    expect(create).toBeGreaterThan(inline);
  });

  it("collapses the utilities only on a narrow topbar",()=>{
    expect(app).toContain("const TOPBAR_OVERFLOW_WIDTH=760");
    expect(app).toContain("$: compactTopbar=viewportWidth<=TOPBAR_OVERFLOW_WIDTH");
    expect(app).toContain("$: if(!compactTopbar&&overflowOpen)closeOverflow();");
  });

  it("uses one app mark everywhere and hides only the brand copy on phones",()=>{
    expect(app).toContain('class="brand-app-icon" src="/icons/favicon.svg"');
    // The mark is the favicon, not a lucide glyph. Scoped to the brand slot:
    // SquareTerminal is the sessions tab icon and is expected further down.
    expect(brand).not.toContain("SquareTerminal");
    expect(styles).toContain(".brand-app-icon{display:block");
    expect(styles).toMatch(/@media\(max-width:599px\)\{[\s\S]*?\.brand-copy\{display:none\}/);
    expect(styles).not.toContain("@media(max-width:600px){\n  .brand-copy");
  });

  it("places the sheet inside the visible band rather than the layout viewport",()=>{
    expect(app).toContain("const band=currentViewportBand(),rect=overflowTrigger.getBoundingClientRect();");
    expect(app).toContain("popoverPlacement({top:rect.top,bottom:rect.bottom,left:rect.right-width}");
    expect(app).not.toMatch(/placeOverflow[\s\S]{0,400}window\.innerHeight/);
  });

  it("dismisses by tapping away and repositions with the viewport",()=>{
    expect(app).toContain("use:dismissOnOutside={{onDismiss:closeOverflow");
    expect(app).toContain('window.visualViewport?.addEventListener("resize",overflowReposition)');
    expect(app).toContain('window.visualViewport?.removeEventListener("resize",overflowReposition)');
  });

  it("closes the sheet before running an action",()=>{
    const clicks=snippet.match(/onclick=\{\(\)=>\{/g)??[];
    expect(clicks.length).toBeGreaterThanOrEqual(4);
    expect(snippet.match(/closeOverflow\(\)/g)).toHaveLength(clicks.length);
  });

  it("stays closed until it is opened",()=>{
    // [popover] is hidden by the UA display:none rule, so declaring display in
    // the base rule pins the sheet open on screen from first paint.
    const base=styles.slice(styles.indexOf(".topbar-overflow{"),styles.indexOf("}",styles.indexOf(".topbar-overflow{")));
    expect(base).not.toMatch(/display:/);
    expect(styles).toContain(".topbar-overflow:popover-open{display:grid}");
    expect(app).toContain('popover="manual"');
  });

  it("keeps the sheet scrollable so it cannot overflow the screen",()=>{
    expect(styles).toContain(".topbar-overflow{position:fixed");
    expect(styles).toMatch(/\.topbar-overflow\{[^}]*overflow-y:auto/);
  });
});
