import { describe,expect,it } from "vitest";
import { render } from "svelte/server";
import SessionGitBadges from "../../src/web/SessionGitBadges.svelte";
import WorkspaceGitOverview from "../../src/web/WorkspaceGitOverview.svelte";
import { collaborationGitSummary,combinedSessionGitAttribution,sessionGitAttribution,sessionGitSummary,summarizeGitWorkspaces,workspaceGitOverview } from "../../src/web/session-git-state";
import { setLocale } from "../../src/web/i18n";

const workspace=(overrides:Record<string,unknown>={})=>({
  id:"workspace-1",
  hostId:"local",
  canonicalPath:"/workspace/repo",
  lastVerifiedAt:"2026-07-28T02:00:00.000Z",
  lastGitStatus:{repository:true,dirty:true,changedFiles:["a.ts","b.ts"],ahead:2,behind:0,branch:"main",commit:"abcdef123456"},
  ...overrides
});

describe("session Git state",()=>{
  it("reports workspace-wide dirty and unpushed state without claiming session ownership",()=>{
    expect(sessionGitSummary({workspaceId:"workspace-1"},[workspace()])).toEqual({
      repository:true,
      dirty:true,
      changedCount:2,
      ahead:2,
      behind:0,
      branch:"main",
      commit:"abcdef123456",
      workspaceCount:1,
      verifiedAt:"2026-07-28T02:00:00.000Z",
      scope:"workspace"
    });
  });

  it("matches native sessions by exact cwd when a workspace id is absent",()=>{
    expect(sessionGitSummary({cwd:"/workspace/repo/",executionHostId:"local"},[workspace()])?.changedCount).toBe(2);
  });

  it("deduplicates a collaboration's participant workspace",()=>{
    const tasks=[
      {workspaceId:"workspace-1",metadata:{collaborationSessionId:"conversation-1"}},
      {workspaceId:"workspace-1",metadata:{collaborationSessionId:"conversation-1"}},
      {workspaceId:"workspace-1",metadata:{collaborationSessionId:"other"}}
    ];
    expect(collaborationGitSummary("conversation-1",tasks,[workspace()])?.workspaceCount).toBe(1);
    expect(collaborationGitSummary("conversation-1",tasks,[workspace()])?.changedCount).toBe(2);
  });

  it("fails soft for non-repositories and dirty states without a file count",()=>{
    expect(summarizeGitWorkspaces([workspace({lastGitStatus:{repository:false}})])).toBeNull();
    expect(summarizeGitWorkspaces([workspace({lastGitStatus:{repository:true,dirty:true,ahead:0}})])?.changedCount).toBeNull();
  });

  it("renders localized list badges with an explicit workspace scope warning",()=>{
    setLocale("ko");
    const summary=sessionGitSummary({workspaceId:"workspace-1"},[workspace()])!;
    const body=render(SessionGitBadges,{props:{summary}}).body;
    expect(body).toContain("작업공간 미커밋 2개");
    expect(body).toContain("미푸시 커밋 2개");
    expect(body).toContain("다른 세션의 변경이 포함될 수 있습니다");
  });

  it("deduplicates shared workspaces into a list-level overview",()=>{
    const items=workspaceGitOverview([{workspaceId:"workspace-1"},{workspaceId:"workspace-1"}],[workspace({displayName:"Workhouse"})]);
    expect(items).toHaveLength(1);
    const body=render(WorkspaceGitOverview,{props:{items}}).body;
    expect(body).toContain("작업공간 Git 상태");
    expect(body).toContain("Workhouse");
    expect(body).toContain("전체 미커밋 2");
    expect(body).toContain("출처 미확인 2개");
  });

  it("excludes only untracked artifacts from the session commit banner",()=>{
    const lastGitStatus={
      repository:true,dirty:true,ahead:0,behind:0,branch:"main",commit:"abcdef123456",
      changedFiles:["src/app.ts","artifacts/mock.png","artifacts/release/bundle.tar"],
      changes:[
        {path:"src/app.ts",untracked:false},
        {path:"artifacts/mock.png",untracked:true},
        {path:"artifacts/release/bundle.tar",untracked:true}
      ]
    };
    const item=workspace({lastGitStatus});
    expect(sessionGitSummary({workspaceId:"workspace-1"},[item])?.changedCount).toBe(1);
    const overview=workspaceGitOverview([{workspaceId:"workspace-1"}],[item]);
    expect(overview[0].unattributedFiles).toEqual(["src/app.ts"]);
    expect(render(WorkspaceGitOverview,{props:{items:overview}}).body).not.toContain("artifacts/");
  });

  it("keeps tracked artifact changes and hides an artifact-only commit banner",()=>{
    const tracked=workspace({lastGitStatus:{repository:true,dirty:true,ahead:0,behind:0,changedFiles:["artifacts/checked-in.html"],changes:[{path:"artifacts/checked-in.html",untracked:false}]}});
    expect(sessionGitSummary({workspaceId:"workspace-1"},[tracked])?.changedCount).toBe(1);
    const generated=workspace({lastGitStatus:{repository:true,dirty:true,ahead:0,behind:0,changedFiles:["artifacts/mock.png"],changes:[{path:"artifacts/mock.png",untracked:true}]}});
    expect(sessionGitSummary({workspaceId:"workspace-1"},[generated])?.dirty).toBe(false);
    expect(workspaceGitOverview([{workspaceId:"workspace-1"}],[generated])).toEqual([]);
  });

  it("keeps task history after commit and separates currently dirty files",()=>{
    const session={workspaceId:"workspace-1",metadata:{gitAttribution:{version:1,capturedAt:"2026-07-28T01:00:00.000Z",observedFiles:["./a.ts","committed.ts"]}}};
    expect(sessionGitAttribution(session,[workspace()])).toEqual({files:["a.ts","committed.ts"],count:2,uncommittedFiles:["a.ts"],uncommittedCount:1,capturedAt:"2026-07-28T01:00:00.000Z",commitAtCapture:null,confidence:"observed"});
    const combined=combinedSessionGitAttribution([session,{workspaceId:"workspace-1",metadata:{gitAttribution:{observedFiles:["b.ts"]}}}],[workspace()]);
    expect(combined?.files).toEqual(["a.ts","b.ts","committed.ts"]);
    expect(combined?.uncommittedFiles).toEqual(["a.ts","b.ts"]);
  });

  it("subtracts task-linked files from the workspace unattributed count",()=>{
    const items=workspaceGitOverview([{provider:"claude",workspaceId:"workspace-1",metadata:{gitAttribution:{observedFiles:["a.ts"]}}}],[workspace()]);
    expect(items[0].unattributedFiles).toEqual(["b.ts"]);
    expect(items[0].unattributedCount).toBe(1);
    expect(items[0].providerAttributions).toEqual([{provider:"claude",files:["a.ts"],count:1}]);
  });

  it("renders one consolidated badge per provider with changes and hides zero-count providers",()=>{
    setLocale("ko");
    const sessions=["codex","claude","antigravity","deepseek","ollama","grok"].map((provider,index)=>({provider,workspaceId:"workspace-1",metadata:{gitAttribution:{observedFiles:[index?"b.ts":"a.ts"]}}}));
    const body=render(WorkspaceGitOverview,{props:{items:workspaceGitOverview(sessions,[workspace()])}}).body;
    expect(body).toContain("전체 미커밋 2");
    for(const provider of ["Codex","Claude","Gemini","DeepSeek","Ollama"])expect(body).toContain(`${provider} 미커밋 1`);
    expect(body).not.toContain("미커밋 0");
  });
});
