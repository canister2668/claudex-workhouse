import fs from"node:fs";
import path from"node:path";
import{describe,expect,it}from"vitest";

describe("Windows managed session settings",()=>{
  it("uses the Worker-backed task endpoint and exposes explicit save feedback",()=>{
    const source=fs.readFileSync(path.resolve("src/web/App.svelte"),"utf8");
    expect(source).toContain('!selected.id.startsWith("codex:worker:")');
    expect(source).toContain('/api/tasks/codex/${encodeURIComponent(selected.id)}/settings');
    expect(source).toContain('taskSettingsNotice=$t("settings.saved")');
    expect(source).toContain('finally{sending=false;}');
  });
});
