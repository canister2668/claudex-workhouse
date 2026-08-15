import{describe,expect,it}from"vitest";
import{buildWindowsBootstrapStatus}from"../../src/server/windows/bootstrap-status.js";

describe("Windows launcher bootstrap status",()=>{
  it("reports ordered setup stages and provider deep links without inventing readiness",()=>{
    const starting=buildWindowsBootstrapStatus({payloadReady:true,dataReady:true,databaseReady:true,serverReady:true,workerStatus:"connecting",providers:{},workspaceCount:1,internalUrl:"http://127.0.0.1:3410",externalUrl:null});
    expect(starting.overall).toBe("starting");expect(starting.stages.map(item=>item.id)).toEqual(["payload","data","database","server","worker","provider","workspace"]);
    expect(starting.links.providers.codex).toBe("/?new=1&provider=codex&host=local");
    const action=buildWindowsBootstrapStatus({payloadReady:true,dataReady:true,databaseReady:true,serverReady:true,workerStatus:"online",providers:{codex:"login-required",claude:"diagnostic-required"},workspaceCount:0,internalUrl:"http://127.0.0.1:3410",externalUrl:"https://workhouse.example"});
    expect(action.overall).toBe("attention");expect(action.stages.find(item=>item.id==="provider")).toMatchObject({state:"attention",remediation:"open-provider-guide"});expect(action.stages.find(item=>item.id==="workspace")).toMatchObject({state:"attention",remediation:"open-workspace-settings"});
  });

  it("requires every infrastructure stage and at least one ready Provider",()=>{
    const input={payloadReady:true,dataReady:true,databaseReady:true,serverReady:true,workerStatus:"online" as const,providers:{codex:"ready" as const,claude:"login-required" as const},workspaceCount:1,internalUrl:"http://127.0.0.1:3410",externalUrl:null};
    const ready=buildWindowsBootstrapStatus(input);
    expect(ready.overall).toBe("ready");
    const failed=buildWindowsBootstrapStatus({...input,workerStatus:"offline"});
    expect(failed.overall).toBe("failed");expect(failed.stages.find(item=>item.id==="worker")?.remediation).toBe("retry");
  });
});
