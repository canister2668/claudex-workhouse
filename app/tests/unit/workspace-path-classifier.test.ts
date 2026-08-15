import {describe,expect,it} from "vitest";
import * as executionPolicy from "../../src/server/execution-policy.js";

describe("removed prompt path classifier",()=>{
  it("does not classify prompts or turn paths into Claudex Workhouse workspace permissions",()=>{
    expect(executionPolicy).not.toHaveProperty("classifyPromptPathCandidates");
    expect(executionPolicy).not.toHaveProperty("resolveWorkspaceAccess");
    expect(executionPolicy).not.toHaveProperty("pathAllowedByExecutionPolicy");
  });
});
