import {describe,expect,it} from "vitest";
import {applyPathDisplayPolicy,maskLocalPaths} from "../../src/server/path-display.js";

describe("local path display policy",()=>{
  it("masks POSIX and Windows paths when enabled",()=>{expect(maskLocalPaths("cwd=/srv/projects/claudex-workhouse file D:\\Projects\\claudex-workhouse")).toBe("cwd=…/claudex-workhouse file …/claudex-workhouse");});
  it("returns exact paths when disabled",()=>{const value={cwd:"/srv/projects/claudex-workhouse"};expect(applyPathDisplayPolicy(value,false)).toEqual(value);expect(applyPathDisplayPolicy(value,true)).toEqual({cwd:"…/claudex-workhouse"});});
  it("does not change unrelated identifiers",()=>{expect(maskLocalPaths("task codex:deck:123 and https://example.com/a")).toContain("https://example.com/a");});
});
