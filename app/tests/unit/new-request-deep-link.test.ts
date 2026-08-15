import{describe,expect,it}from"vitest";
import{newRequestDeepLink,parseNewRequestTarget}from"../../src/web/new-request-deep-link.js";

describe("Provider new-request deep links",()=>{
  it("round-trips Provider, host, and Workspace without accepting arbitrary Provider values",()=>{
    const link=newRequestDeepLink({provider:"claude",hostId:"local",workspaceId:"workspace-한글"});
    expect(parseNewRequestTarget(new URL(link,"http://127.0.0.1").search)).toEqual({provider:"claude",hostId:"local",workspaceId:"workspace-한글"});
    expect(parseNewRequestTarget("?new=1&provider=other&host=local")).toEqual({provider:null,hostId:"local",workspaceId:null});
    expect(parseNewRequestTarget("?provider=codex")).toBeNull();
  });
});
