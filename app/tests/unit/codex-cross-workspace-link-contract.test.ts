import fs from "node:fs";
import path from "node:path";
import {describe,expect,it} from "vitest";

describe("Codex cross-workspace file links",()=>{
  it("preserves a workspace selected by the Markdown link",()=>{
    const component=fs.readFileSync(path.resolve("src/web/CodexSessions.svelte"),"utf8");
    expect(component).toContain("workspaceTargets={workspaces}");
    expect(component).toContain("workspaceId:file.workspaceId??selected?.workspaceId");
    expect(component).not.toContain("onOpenFile?.({...file,workspaceId:selected?.workspaceId})");
  });
});
