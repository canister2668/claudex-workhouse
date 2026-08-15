import path from "node:path";
import { describe,expect,it } from "vitest";
import { taskTempDirectory,workspaceTempRoot } from "../../src/server/workspace-temp";

describe("workspace temporary paths",()=>{
  it("keeps provider tasks under a stable workspace namespace",()=>{
    const root="/srv/workhouse/runtime/tmp";
    const workspace=workspaceTempRoot(root,"workspace-risu");
    const codex=taskTempDirectory(root,"workspace-risu","codex","codex:task-1");
    const claude=taskTempDirectory(root,"workspace-risu","claude","claude:task-2");
    expect(path.dirname(codex)).toBe(workspace);
    expect(path.dirname(claude)).toBe(workspace);
    expect(path.basename(codex)).toMatch(/^codex-task-[a-f0-9]{24}$/);
    expect(path.basename(claude)).toMatch(/^claude-task-[a-f0-9]{24}$/);
    expect(workspace).not.toContain("workspace-risu");
  });

  it("uses a different namespace for every workspace",()=>{
    expect(workspaceTempRoot("/tmp/root","workspace-a")).not.toBe(workspaceTempRoot("/tmp/root","workspace-b"));
  });
});
