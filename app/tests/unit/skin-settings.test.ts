import fs from "node:fs";
import path from "node:path";
import { describe,expect,it } from "vitest";

const web=(file:string)=>fs.readFileSync(path.join(process.cwd(),"src","web",file),"utf8");

describe("conversation card skins",()=>{
  it("applies only known persisted skins before first paint",()=>{
    const source=web("main.ts");
    expect(source).toContain('localStorage.getItem("deck-skin")');
    expect(source).toContain("normalizeSkin");
    expect(source).toContain('if (savedSkin !== "soft")');
  });

  it("keeps soft as the dataset-free default and tracks it in display settings",()=>{
    const source=web("App.svelte");
    expect(source).toContain("normalizeSkin");
    expect(source).toContain('if(value==="soft")delete document.documentElement.dataset.skin');
    expect(source).toContain("JSON.stringify({theme,palette,skin,");
    expect(source).toContain("applySkin(normalizeSkin(value.skin))");
  });

  it("defines all alternate skins through card tokens",()=>{
    const source=web("styles.css");
    expect(source).toContain(':root[data-skin="elevated"]');
    expect(source).toContain(':root[data-skin="outline"]');
    expect(source).toContain(':root[data-skin="compact"]');
    expect(source).toContain(':root[data-skin="terminal"]');
    expect(source).toContain(':root[data-skin="flat"]');
    expect(source).toContain("padding:var(--card-padding)");
    expect(source).toContain("border-radius:var(--radius-card)");
    expect(source).toContain("box-shadow:var(--card-shadow)");
    expect(source).not.toContain("margin:-16px");
    expect(source).toContain(':root[data-skin="terminal"] .bubble>.bubble-card-head,:root[data-skin="terminal"] .diff-head,:root[data-skin="terminal"] .cmd-head{position:static');
    expect(source).toContain(':root[data-skin="flat"] .bubble>.bubble-card-head,:root[data-skin="flat"] .diff-head,:root[data-skin="flat"] .cmd-head{position:static');
    expect(source).toContain(':root[data-skin="terminal"] .diff-head code{color:inherit}');
    expect(source).toContain(':root[data-skin="flat"] .diff-head code{color:inherit}');
  });

  it("keeps a visible role marker in every conversation card skin",()=>{
    const source=web("styles.css");
    for(const skin of ["outline","compact"]){
      expect(source,skin).toMatch(new RegExp(`:root\\[data-skin="${skin}"\\]\\{[^}]*--card-rail-width:[1-9]`));
    }
    expect(source).toContain(':root[data-skin="elevated"] .bubble>.bubble-card-head::before');
    expect(source).toMatch(/:root\[data-skin="elevated"\]\{[^}]*--card-rail-width:0px/);
    expect(source).toMatch(/:root\[data-skin="elevated"\]\{[^}]*--card-shadow:[^;]*--card-role-color/);
    expect(source).toContain(':root[data-skin="terminal"] .bubble::before');
    expect(source).toContain('border-left:2px solid var(--card-role-color');
    expect(source).toContain(':root[data-skin="flat"] .bubble{display:block');
    expect(source).toContain(':root[data-skin="compact"] .bubble{display:block');
    expect(source).not.toContain('grid-template-columns:minmax(92px,auto)');
    expect(source).not.toContain('grid-template-columns:118px');
    expect(source).toContain(':root:not([data-skin]) .bubble.user::after');
    expect(source).toContain('clip-path:polygon(100% 0,0 100%,100% 100%)');
  });

  it("applies each composition to task and collaboration cards",()=>{
    const source=web("styles.css");
    for(const skin of ["elevated","outline","compact","terminal","flat"]){
      expect(source).toContain(`:root[data-skin="${skin}"] .collaboration-user`);
      expect(source).toContain(`:root[data-skin="${skin}"] .participant-block`);
      expect(source).toContain(`:root[data-skin="${skin}"] .process-panel`);
    }
  });

  it("positions output token badges per skin and reserves the floating scroll-control lane",()=>{
    const source=web("styles.css");
    expect(source).toContain("--floating-control-safe-right:52px");
    expect(source).toContain("margin:.25rem var(--floating-control-safe-right) .45rem 0");
    expect(source).toContain(".scroll-jumps button{width:38px;height:38px");
    expect(source).toContain(".shell.session-detail-open .scroll-jumps{position:absolute;right:14px");
    expect(source).toContain(':root:not([data-skin]) .output-token-chip');
    for(const skin of ["elevated","outline","compact","terminal","flat"])expect(source).toContain(`:root[data-skin="${skin}"] .output-token-chip`);
    expect(source).toContain(':root[data-skin="elevated"] .output-token-chip{margin-top:-10px');
    expect(source).toContain(':root[data-skin="compact"] .output-token-chip{align-self:flex-start');
    expect(source).toContain(':root[data-skin="terminal"] .output-token-chip{align-self:flex-start');
    expect(source).toContain(':root[data-skin="flat"] .output-token-chip{align-self:flex-start');
  });

  it("uses control radius tokens without changing pills or circles",()=>{
    const source=web("styles.css");
    expect(source.match(/border-radius:var\(--radius-control-lg\)/g)?.length??0).toBeGreaterThanOrEqual(23);
    expect(source.match(/border-radius:var\(--radius-control\)/g)?.length??0).toBeGreaterThanOrEqual(19);
    expect(source.match(/border-radius:var\(--radius-control-sm\)/g)?.length??0).toBeGreaterThanOrEqual(15);
    expect(source.match(/border-radius:var\(--radius-pill\)/g)?.length??0).toBeGreaterThanOrEqual(15);
    expect(source).toContain("--radius-pill:999px");
    expect(source).not.toContain("--radius-pill:0px");
    expect(source).toContain(':root[data-skin="terminal"] .bubble{--card-outline-color:var(--card-role-color,var(--line-strong));--radius-control-lg:0px;--radius-control:0px;--radius-control-sm:0px}');
    expect(source.match(/border-radius:50%/g)?.length??0).toBeGreaterThanOrEqual(12);
  });
});
