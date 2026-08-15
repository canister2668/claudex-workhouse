import { describe, expect, it } from "vitest";
import { assertWorkspaceManagementAllowed, isClaudexWorkhouseProjectId } from "../../src/server/workspace-protection.js";

describe("Claudex Workhouse workspace protection", () => {
  it("identifies the current and legacy built-in project IDs", () => {
    expect(isClaudexWorkhouseProjectId("claudex-workhouse")).toBe(true);
    expect(isClaudexWorkhouseProjectId("claudex-workhouse")).toBe(true);
    expect(isClaudexWorkhouseProjectId("risuai")).toBe(false);
  });

  it("blocks management mutations for the built-in workspace", () => {
    expect(() => assertWorkspaceManagementAllowed("claudex-workhouse")).toThrowError(
      expect.objectContaining({ code:"SYSTEM_WORKSPACE_LOCKED", statusCode:403 })
    );
    expect(() => assertWorkspaceManagementAllowed("claudex-workhouse")).toThrowError(
      expect.objectContaining({ code:"SYSTEM_WORKSPACE_LOCKED", statusCode:403 })
    );
    expect(() => assertWorkspaceManagementAllowed("risuai")).not.toThrow();
  });
});
