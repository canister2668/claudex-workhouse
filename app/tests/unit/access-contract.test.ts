import {describe,expect,it} from "vitest";
import * as executionPolicy from "../../src/server/execution-policy.js";

describe("removed workspace approval contract",()=>{
  it("does not expose approval-contract or path-scope policy helpers",()=>{
    for(const name of [
      "accessContractFromMetadata",
      "clearWorkspaceBoundExecutionMetadata",
      "createAccessContract",
      "filesystemReferences",
      "pathAllowedByExecutionPolicy",
      "resolveRegisteredExternalPathScopes",
      "resolveWorkspaceAccess",
    ])expect(executionPolicy).not.toHaveProperty(name);
  });
});
