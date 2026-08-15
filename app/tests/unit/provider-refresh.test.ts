import fs from "node:fs";
import { describe,expect,it } from "vitest";
import { createProviderRefreshCoordinator, shouldApplyProviderSnapshot } from "../../src/web/provider-refresh.js";

describe("latest successful provider refresh",()=>{
  it("allows an older successful response when a newer request failed",()=>{
    const coordinator=createProviderRefreshCoordinator(),older=coordinator.reserve(["codex"]),newer=coordinator.reserve(["codex"]);let value="";
    expect(coordinator.apply("codex",older.codex,()=>value="older-success")).toBe(true);
    expect(value).toBe("older-success");
    expect(coordinator.state().requested.codex).toBe(newer.codex);
  });
  it("prevents an older response from overwriting a newer successful one",()=>{
    const coordinator=createProviderRefreshCoordinator(),older=coordinator.reserve(["claude"]),newer=coordinator.reserve(["claude"]);let value="";
    coordinator.apply("claude",newer.claude,()=>value="newer");
    expect(coordinator.apply("claude",older.claude,()=>value="older")).toBe(false);
    expect(value).toBe("newer");
  });
  it("keeps the last provider rows when a partial response is unexpectedly empty",()=>{
    expect(shouldApplyProviderSnapshot(true,0,12)).toBe(false);
    expect(shouldApplyProviderSnapshot(true,3,12)).toBe(true);
    expect(shouldApplyProviderSnapshot(false,0,12)).toBe(true);
  });
  it("tracks every provider through the same refresh coordinator",()=>{
    const coordinator=createProviderRefreshCoordinator(),ticket=coordinator.reserve(["antigravity","deepseek","ollama"]),applied:string[]=[];
    for(const provider of ["antigravity","deepseek","ollama"] as const)expect(coordinator.apply(provider,ticket[provider],()=>applied.push(provider))).toBe(true);
    expect(applied).toEqual(["antigravity","deepseek","ollama"]);
  });
  it("polls only the open avatar provider instead of the whole task snapshot",()=>{
    const app=fs.readFileSync("src/web/App.svelte","utf8");
    expect(app).toContain("function refreshVisibleTaskLists(){if(avatarOpenProvider)void refreshAvatarSessions(avatarOpenProvider);else void refresh(true)");
    expect(app).not.toContain('void refresh(true).then(()=>void openInitialDeepLink());if(avatarOpenProvider)void refreshAvatarSessions(avatarOpenProvider)');
  });
  it("reuses task snapshot revisions so unchanged polls stay small",()=>{
    const app=fs.readFileSync("src/web/App.svelte","utf8"),server=fs.readFileSync("src/server/index.ts","utf8");
    expect(app).toContain('params.set("revision",String(taskSnapshotRevisions.all))');
    expect(app).toContain('if(data.unchanged)return');
    expect(server).toContain('if(query.revision===taskListSnapshotRevision)return{tasks:[]');
    expect(server).toContain('unchanged:true,revision:taskListSnapshotRevision');
  });
});
