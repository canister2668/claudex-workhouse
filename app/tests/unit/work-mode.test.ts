import { describe,expect,it } from "vitest";
import { permissionForWorkMode,workModeOf } from "../../src/web/work-mode.js";

describe("work mode UI mapping",()=>{
  it("restores explicit session mode before legacy inference",()=>{expect(workModeOf("claude",":read-only",{workMode:"default"})).toBe("default");expect(workModeOf("codex",":workspace",{workMode:"plan"})).toBe("plan");});
  it("infers legacy Claude read-only sessions as plan",()=>{expect(workModeOf("claude",":read-only",{})).toBe("plan");expect(workModeOf("codex",":read-only",{})).toBe("default");});
  it("moves Claude between plan and editable permissions without changing Codex",()=>{expect(permissionForWorkMode("claude","plan",":workspace-write")).toBe(":read-only");expect(permissionForWorkMode("claude","default",":read-only")).toBe(":workspace-write");expect(permissionForWorkMode("codex","plan",":workspace")).toBe(":workspace");});
});
