import { describe, expect, it } from "vitest";
import { isUiLockedProject, isUiLockedWorkspace, workspacesForHost } from "../../src/web/workspace-management.js";

describe("workspace management UI locks",()=>{
  it("locks only the built-in Claudex Workhouse project and its workspace",()=>{
    expect(isUiLockedProject({id:"claudex-workhouse"})).toBe(true);
    expect(isUiLockedWorkspace({projectId:"claudex-workhouse"})).toBe(true);
    expect(isUiLockedProject({id:"claudex-workhouse"})).toBe(true);
    expect(isUiLockedWorkspace({projectId:"claudex-workhouse"})).toBe(true);
    expect(isUiLockedProject({id:"risuai"})).toBe(false);
    expect(isUiLockedWorkspace({projectId:"risuai"})).toBe(false);
  });

  it("derives the visible workspace list from the selected host",()=>{
    const workspaces=[
      {id:"local-a",hostId:"local",projectId:"project-a"},
      {id:"worker-a",hostId:"worker-1",projectId:"project-a"},
      {id:"local-b",hostId:"local",projectId:"project-b"}
    ];
    expect(workspacesForHost(workspaces,"local").map(item=>item.id)).toEqual(["local-a","local-b"]);
    expect(workspacesForHost(workspaces,"worker-1").map(item=>item.id)).toEqual(["worker-a"]);
  });
});
