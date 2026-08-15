import { describe, expect, it } from "vitest";
import { fileEventCanOpen, fileEventEditTarget, filterWorkspaceEntries, forgetWorkspaceDraft, lineChangeCount, rememberWorkspaceDraft, taskImageOutputHref, workspaceDraft, workspaceFileDownloadHref, workspaceFilePreviewHref, workspaceLineDiff } from "../../src/web/workspace-viewer-state.js";

describe("workspace viewer state",()=>{
  const entries=[{name:"README.md",type:"file"},{name:"日本語.txt",type:"file"},{name:"src",type:"directory"},{name:"10-build",type:"directory"},{name:"2-build",type:"directory"}];

  it("sorts folders above files and names naturally within each group",()=>{
    expect(filterWorkspaceEntries(entries,"","en").map(entry=>entry.name)).toEqual(["2-build","10-build","src","README.md","日本語.txt"]);
  });

  it("filters file and folder names case-insensitively",()=>{
    expect(filterWorkspaceEntries(entries,"read")).toEqual([{name:"README.md",type:"file"}]);
    expect(filterWorkspaceEntries(entries,"日本")).toEqual([{name:"日本語.txt",type:"file"}]);
  });

  it("builds an authenticated workspace download link with encoded identifiers and paths",()=>{
    expect(workspaceFileDownloadHref("workspace/한글","releases/가이드 1.zip")).toBe("/api/workspaces/workspace%2F%ED%95%9C%EA%B8%80/files/download?path=releases%2F%EA%B0%80%EC%9D%B4%EB%93%9C+1.zip");
    expect(workspaceFileDownloadHref("workspace","")).toBeNull();
  });

  it("builds safe same-origin image preview links",()=>{
    expect(workspaceFilePreviewHref("workspace","art/final image.png","workspace")).toBe("/api/workspaces/workspace/files/preview?path=art%2Ffinal+image.png&pathBase=workspace");
    expect(workspaceFilePreviewHref("workspace","out/final.webp","task-cwd","task-1")).toBe("/api/workspaces/workspace/files/preview?path=out%2Ffinal.webp&pathBase=task-cwd&sourceTaskId=task-1");
    expect(workspaceFilePreviewHref("workspace","out/final.webp","task-cwd")).toBeNull();
    expect(taskImageOutputHref("codex:task/1","generated/final image.png")).toBe("/api/task-image-output?taskId=codex%3Atask%2F1&path=generated%2Ffinal+image.png");
  });

  it("opens only file events with an explicit safe path base",()=>{
    expect(fileEventCanOpen({path:"src/app.ts",pathBase:"task-cwd"})).toBe(true);
    expect(fileEventCanOpen({path:"app.ts",pathBase:"unresolved"})).toBe(false);
    expect(fileEventCanOpen({path:"app.ts"})).toBe(false);
  });

  it("builds an explicit edit-mode viewer target and requires task context for task-relative paths",()=>{
    expect(fileEventEditTarget({path:"src/app.ts",pathBase:"workspace"},null)).toEqual({path:"src/app.ts",pathBase:"workspace",initialEdit:true});
    expect(fileEventEditTarget({path:"src/app.ts",pathBase:"task-cwd"},"task-1")).toEqual({path:"src/app.ts",pathBase:"task-cwd",sourceTaskId:"task-1",initialEdit:true});
    expect(fileEventEditTarget({path:"src/app.ts",pathBase:"task-cwd"},null)).toBeNull();
    expect(fileEventEditTarget({path:"src/app.ts",pathBase:"unresolved"},"task-1")).toBeNull();
  });

  it("keeps editor drafts only in module memory",()=>{
    const base:any={fileId:"id",relativePath:"src/app.ts",content:"one",revision:"a".repeat(64),lineEnding:"lf",hasUtf8Bom:false,endsWithNewline:false,modifiedAt:"now",byteLength:3};
    rememberWorkspaceDraft("workspace",{base,content:"two"});expect(workspaceDraft("workspace","src/app.ts")?.content).toBe("two");
    forgetWorkspaceDraft("workspace","src/app.ts");expect(workspaceDraft("workspace","src/app.ts")).toBeNull();
    expect(lineChangeCount("a\nb","a\nc")).toBe(1);
  });

  it("builds an unsaved editor comparison without requiring Git status",()=>{
    expect(workspaceLineDiff("one\ntwo\n","one\nchanged\n")).toBe("  one\n- two\n+ changed\n  ");
    expect(workspaceLineDiff("same\n","same\n")).toBe("");
  });
});
