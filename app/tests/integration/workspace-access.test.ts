import {describe,expect,it} from "vitest";
import {resolveExecutionPolicy,type SandboxCapability} from "../../src/server/execution-policy.js";

describe("task creation workspace policy",()=>{
  it("does not derive execution permission from path breadth or repository trust",()=>{
    const sandbox:SandboxCapability={status:"native-supported",reason:null,checkedAt:"2026-01-01T00:00:00.000Z",cacheKey:"key",kernel:"linux",architecture:"x64",bwrapPath:"/usr/bin/bwrap",bwrapVersion:"1",codexVersion:"1",workerVersion:"1",uid:1,gid:1,bootId:"boot",detail:null};
    const policy=resolveExecutionPolicy({provider:"codex",requestedAutomation:"auto",hostId:"local",workspaceId:"broad",sandboxCapability:sandbox,hostFallbackPolicy:{trustedHost:false,isolatedWorker:false},providerCapabilities:{automatic:true,confirm:true,fullAccess:true,readOnly:true},runtimeVersion:"1"});
    expect(policy).toMatchObject({allowed:true,executionBackend:"native-sandbox"});
    expect(policy.reason).toBeNull();
  });
});
