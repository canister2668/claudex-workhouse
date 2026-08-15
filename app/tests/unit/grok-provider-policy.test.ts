import fs from"node:fs";
import os from"node:os";
import path from"node:path";
import{afterEach,describe,expect,it,vi}from"vitest";
import{GrokProvider,grokExecutionMetadata}from"../../src/server/providers/grok.js";

const roots:string[]=[];
afterEach(()=>{vi.restoreAllMocks();for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});

describe("Grok provider execution policy",()=>{
  it("records the absence of an OS sandbox for read and automatic modes",()=>{expect(grokExecutionMetadata("read")).toMatchObject({effectiveSandbox:"none",executionBackend:"provider-tool-restricted",effectiveApprovalPolicy:"never"});expect(grokExecutionMetadata("auto")).toMatchObject({requestedAutomation:"automatic",effectiveSandbox:"none",executionBackend:"provider-native-no-sandbox"});expect(grokExecutionMetadata("full")).toMatchObject({effectiveSandbox:"danger-full-access",executionBackend:"full-access"});});

  it("preserves conversation runtime and clamps stale full metadata on fork",async()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),"grok-provider-policy-"));roots.push(root);
    const provider=new GrokProvider({dataDir:path.join(root,"data"),projects:[{id:"p",name:"p",path:root,realPath:root,enabled:true,error:null}]}as any,{}as any),launch=vi.spyOn(provider as any,"launch").mockResolvedValue({id:"next"});
    await provider.forkThread({threadId:"11111111-1111-4111-8111-111111111111",projectId:"p",cwd:root,title:"task",requestedModel:null,requestedReasoningEffort:null,permissionProfile:":workspace-write",workspaceId:"w",metadata:{runtimeProfile:"conversation",automationLevel:"full",workMode:"default"}}as any);
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({runtimeProfile:"conversation",automationLevel:"auto",permissionProfile:":workspace-write"}),"fork","11111111-1111-4111-8111-111111111111","11111111-1111-4111-8111-111111111111");
  });
});
