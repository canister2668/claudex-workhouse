import {describe,expect,it} from "vitest";
import {antigravityTurnPrompt} from "../../src/server/antigravity-prompt.js";

describe("Gemini task prompt isolation",()=>{
  it("anchors ambiguous requests to the selected Workhouse workspace",()=>{
    const prompt=antigravityTurnPrompt("여기 작업을 조사해 줘","/srv/claudex-workhouse","full");
    expect(prompt).toContain('Workspace root: "/srv/claudex-workhouse"');
    expect(prompt).toContain("Do not select a different target by scanning parent or sibling directories");
    expect(prompt).toContain("# Current user request\n여기 작업을 조사해 줘");
  });
  it("keeps conversation turns chat-only",()=>{
    const prompt=antigravityTurnPrompt("친구처럼 이야기해 줘","/srv/claudex-workhouse","read","conversation");
    expect(prompt).toContain("# Claudex Workhouse conversation turn");
    expect(prompt).toContain("Do not inspect, create, edit, or delete files");
    expect(prompt).toContain("# Current conversation prompt\n친구처럼 이야기해 줘");
    expect(prompt).not.toContain("Workspace root:");
  });
  it("allows only the scoped emotion tool when conversation MCP mode is enabled",()=>{
    const prompt=antigravityTurnPrompt("반갑게 인사해 줘","/workspace","read","conversation",true);
    expect(prompt).toContain("except the claudex_workhouse_emotion set_emotion tool");
    expect(prompt).toContain("call set_emotion exactly once");expect(prompt).toContain("뽀뽀쪽");expect(prompt).toContain("Do not call express_emotion");
  });
});
