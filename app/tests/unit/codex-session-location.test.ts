import {describe,expect,it} from "vitest";
import {recoverCodexSessionLocation} from "../../src/web/codex-session-location.js";

describe("Codex session location recovery",()=>{
  it("restores a local session from its linked task",()=>{
    const session={threadId:"thread",taskId:"task",ownership:"claudex-workhouse",cwd:null,workspaceId:null,canMutate:false};
    expect(recoverCodexSessionLocation(session,{id:"task",threadId:"thread",projectId:"project",cwd:"/workspace",workspaceId:"workspace"})).toMatchObject({projectId:"project",cwd:"/workspace",workspaceId:"workspace",canMutate:true});
  });

  it("restores a remote session from its Workspace identity without a local cwd",()=>{
    const session={threadId:"thread",taskId:"task",ownership:"claudex-workhouse",cwd:null,workspaceId:null,canMutate:false};
    expect(recoverCodexSessionLocation(session,{id:"task",threadId:"thread",executionHostId:"worker",cwd:null,workspaceId:"remote-workspace"})).toMatchObject({executionHostId:"worker",workspaceId:"remote-workspace",canMutate:true});
  });

  it("does not borrow a location from an unrelated task",()=>{
    const session={threadId:"thread",taskId:"task",ownership:"claudex-workhouse",cwd:null,workspaceId:null,canMutate:false};
    expect(recoverCodexSessionLocation(session,{id:"other",threadId:"other-thread",cwd:"/other",workspaceId:"other"})).toBe(session);
  });
});
