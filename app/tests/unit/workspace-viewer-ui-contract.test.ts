import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const viewer = fs.readFileSync(
  path.join(process.cwd(), "src", "web", "WorkspaceViewer.svelte"),
  "utf8"
);

describe("workspace viewer navigation controls", () => {
  it("hides the back button until directory history can use it", () => {
    expect(viewer).toContain(
      '{#if section==="files"&&stack.length&&mode==="view"}<button aria-label={$t("common.back")} onclick={back}>'
    );
    expect(viewer).not.toContain('disabled={section!=="files"||!stack.length||mode!=="view"}');
  });

  it("offers window, split, reverse, fullscreen, and docked file-tree controls", () => {
    expect(viewer).toContain('onclick={()=>chooseLayout("window")}');
    expect(viewer).toContain('onclick={()=>chooseLayout("columns")}');
    expect(viewer).toContain('onclick={()=>chooseLayout("rows")}');
    expect(viewer).toContain('onclick={()=>chooseLayout("fullscreen")}');
    expect(viewer).toContain('layoutState.layout==="columns"?"workspace.reverseColumns":"workspace.layoutColumns"');
    expect(viewer).toContain('layoutState.layout==="rows"?"workspace.reverseRows":"workspace.layoutRows"');
    expect(viewer).toContain('layoutState.layout!=="window"');
    expect(viewer).toContain("else if(previous.layout!==nextState.layout)fileListCollapsed=true");
  });

  it("uses one word-wrap toggle for the highlighted viewer and editor", () => {
    expect(viewer).toContain('aria-label={$t("workspace.lineWrap")}');
    expect(viewer).toContain('wrap={lineWrap?"soft":"off"}');
    expect(viewer).toContain('class="code" class:wrap-lines={lineWrap}');
    expect(viewer).toContain('class="editor-shell" class:wrap-lines={lineWrap}');
  });

  it("keeps viewer, editor, and comparison controls visible across edit modes",()=>{
    expect(viewer).toContain('$t("workspace.viewer")');
    expect(viewer).toContain('$t("workspace.editor")');
    expect(viewer).toContain('class:active={mode==="compare"}');
    expect(viewer).toContain('if(base&&dirty){diff=workspaceLineDiff(base.content,draft)');
    expect(viewer).toContain('if(mode==="compare")');
    expect(viewer).toContain('mode=compareReturnMode;diff=""');
    expect(viewer).toContain('const request=++diffRequest');
    expect(viewer).toContain('if(request!==diffRequest)return');
    expect(viewer).toContain('function showViewer(){diffRequest+=1;loading=false');
    expect(viewer).toContain('class="diff-shell"');
    expect(viewer).toContain('workspace.diffRemoved');
    expect(viewer).toContain('workspace.diffAdded');
    expect(viewer).not.toContain('workspace.lastGitStatus?.changedFiles?.includes');
  });

  it("vertically centers the overflow menu icon inside its action box",()=>{
    expect(viewer).toContain(".file-more summary,.file-more-sheet>button,.file-action{box-sizing:border-box;align-items:center;justify-content:center");
  });

  it("gives the tablet overflow button the same box height as its neighbours",()=>{
    expect(viewer).toContain(".file-more>summary{display:inline-flex;min-width:40px;min-height:40px;padding:0 .6rem;cursor:pointer}");
  });
});
