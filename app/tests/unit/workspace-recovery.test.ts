import {describe,expect,it,vi} from "vitest";
import {resolveViewerWorkspace} from "../../src/web/workspace-recovery.js";

describe("workspace viewer recovery",()=>{
  it("uses an already loaded workspace without another request",async()=>{
    const reload=vi.fn();
    const result=await resolveViewerWorkspace("workspace-1",[{id:"workspace-1",displayName:"Current"}],reload);
    expect(result).toMatchObject({workspace:{id:"workspace-1"},reloaded:false});
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads a missing catalog entry before rejecting viewer navigation",async()=>{
    const reload=vi.fn().mockResolvedValue([{id:"workspace-1",displayName:"Recovered"}]);
    const result=await resolveViewerWorkspace("workspace-1",[],reload);
    expect(result).toMatchObject({workspace:{id:"workspace-1",displayName:"Recovered"},reloaded:true});
    expect(result.catalog).toHaveLength(1);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("returns a real not-found result only after the recovery lookup completes",async()=>{
    const result=await resolveViewerWorkspace("missing",[],async()=>[{id:"workspace-1"}]);
    expect(result.workspace).toBeNull();
    expect(result.reloaded).toBe(true);
  });
});
