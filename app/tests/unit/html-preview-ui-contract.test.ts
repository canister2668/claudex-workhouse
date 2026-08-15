import fs from "node:fs";
import path from "node:path";
import {describe,expect,it} from "vitest";

const read=(relative:string)=>fs.readFileSync(path.resolve(relative),"utf8");

describe("HTML preview UI security contract",()=>{
  it("keeps the preview iframe isolated and clears its document on teardown",()=>{
    const component=read("src/web/HtmlPreview.svelte");
    expect(component).toContain('sandbox=""');
    expect(component).toContain('referrerpolicy="no-referrer"');
    expect(component).not.toContain("allow-scripts");
    expect(component).not.toContain("allow-same-origin");
    expect(component).toContain('if(frame)frame.srcdoc=""');
    expect(component).toContain('new Blob([result.srcdoc]');
    expect(component).toContain('window.open(url,"_blank","noopener,noreferrer")');
  });

  it("exposes preview only for bounded local HTML files",()=>{
    const viewer=read("src/web/WorkspaceViewer.svelte");
    expect(viewer).toContain('/\\.html?$/i.test(active.relativePath??active.name)');
    // the bound now comes from the shared constant the server enforces, so the two
    // cannot drift apart
    expect(viewer).toContain("(active.size??0)<=MAX_HTML_PREVIEW_BYTES");
    expect(viewer).toContain('import { MAX_HTML_PREVIEW_BYTES } from "../server/workspace-limits.js"');
    expect(viewer).toContain('(workspace.hostId??"local")==="local"');
    expect(viewer).toContain('const html=/\\.html?$/i.test(path);fileListCollapsed=html');
    expect(viewer).toContain('contentTab=html?"preview":"source";');
    expect(viewer).toContain("fileListCollapsed=html");
    expect(viewer).toContain("class:file-list-collapsed={fileListCollapsed}");
    expect(viewer).toContain("grid-template-columns:0 minmax(0,1fr)");
    expect(viewer).toContain("class:html-preview-open");
    expect(viewer).toContain("height:calc(100dvh - 2rem)");
    expect(viewer).toContain("@media(max-height:700px) and (min-width:701px)");
    expect(viewer).toContain('.viewer,.viewer.html-preview-open{height:var(--viewer-vh,100dvh)');
    expect(viewer).toContain('window.visualViewport?.addEventListener("resize",syncViewport)');
    expect(viewer).toContain("workspaceFileDownloadHref");
    expect(viewer).toContain("onclick={showEditor}");
  });

  it("keeps mobile HTML controls reachable without stacking them above the preview",()=>{
    const preview=read("src/web/HtmlPreview.svelte"),viewer=read("src/web/WorkspaceViewer.svelte");
    expect(preview).toContain('class="preview-more"');
    expect(preview).toContain('class="preview-secondary"');
    expect(preview).toContain('grid-template-columns:max-content max-content max-content minmax(0,1fr)');
    expect(preview).toContain('grid-template-columns:minmax(0,1.25fr) minmax(0,1fr) minmax(0,1fr)');
    expect(preview).toContain('.preview-secondary>.diagnostics{grid-column:1/-1}');
    expect(preview).toContain('.preview-more{display:block;grid-column:auto}');
    expect(preview).toContain('result?.diagnostics.length');
    expect(preview).toContain('width:min(360px,100%)');
    expect(viewer).toContain('class="file-more"');
    expect(viewer).toContain('class="file-more-sheet"');
    expect(viewer).toContain('.file-heading{position:static');
    expect(viewer).toContain('grid-template-columns:minmax(0,1fr);gap:.4rem');
    expect(viewer).toContain('.file-heading>.file-primary-actions{width:100%');
    expect(viewer).toContain('.editor-actions{position:sticky');
    expect(viewer).toContain('.editor-actions button.primary{width:auto;height:40px;min-height:40px;margin:0');
    expect(viewer).toContain('.editor-actions button,.editor-actions button.primary{min-width:0;height:44px;min-height:44px;margin:0');
    expect(viewer).toContain('@media(min-width:701px) and (max-width:1180px)');
    expect(viewer).toContain('window.matchMedia("(min-width:1181px)")');
  });

  it("reads snapshots through the JSON-only local-workspace endpoint",()=>{
    const server=read("src/server/index.ts");
    expect(server).toContain('app.post("/api/workspaces/:workspaceId/files/html-preview"');
    expect(server).toContain('code:"HTML_PREVIEW_LOCAL_ONLY"');
    expect(server).toContain("hostWorkspaces.readHtmlPreview");
    expect(server).not.toMatch(/files\/html-preview[\s\S]{0,900}\.type\(\s*["']text\/html/i);
  });

  it("allows the bounded chunk reader to continue beyond five MiB",()=>{
    const server=read("src/server/index.ts"),local=read("src/server/host-workspaces.ts"),worker=read("src/server/desktop-worker/workspaces.ts");
    expect(server).toContain("offset:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)");
    expect(local).not.toContain("File exceeds the 5 MiB viewer limit.");
    expect(worker).not.toContain("File exceeds viewer limit.");
  });
});
