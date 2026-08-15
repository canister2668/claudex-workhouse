import{describe,expect,it}from"vitest";
import{pullRequestDraft}from"../../src/web/pull-request";

describe("pull request draft",()=>{
  it("uses the task outcome summary while leaving title and body editable",()=>{
    const value=pullRequestDraft({id:"task-1",title:"Fix sync",status:"completed",result:"Fixed preset sync."},[
      {type:"file_change_completed",metadata:{path:"src/sync.ts"}},
      {type:"command_completed",status:"completed",content:"pnpm test",metadata:{command:"pnpm test",exitCode:0}}
    ]);
    expect(value.title).toBe("Fix sync");
    expect(value.body).toContain("Fixed preset sync.");
    expect(value.body).toContain("`src/sync.ts`");
    expect(value.body).toContain("`pnpm test` (passed)");
  });
});
