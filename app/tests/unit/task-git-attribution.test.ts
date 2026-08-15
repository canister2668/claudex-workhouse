import {describe,expect,it} from "vitest";
import {mergeLiveTaskGitAttribution,taskGitAttribution} from "../../src/server/task-git-attribution.js";

describe("task Git attribution",()=>{
  it("keeps observed task files after they leave the current dirty set",()=>{
    const capturedAt="2026-08-07T03:00:00.000Z";
    expect(taskGitAttribution([
      {type:"file_change_started",content:"",metadata:{path:"./app/a.ts",pathBase:"workspace"}},
      {type:"file_change_completed",content:"",metadata:{path:"app\\b.ts",pathBase:"task-cwd"}},
      {type:"file_change_completed",content:"",metadata:{path:"app/committed.ts",pathBase:"workspace"}},
      {type:"file_change_completed",content:"",metadata:{path:"/outside.ts",pathBase:"unresolved"}}
    ],{changedFiles:["app/a.ts","app/b.ts","other.ts"],commit:"abcdef123456"},capturedAt)).toEqual({
      version:2,
      capturedAt,
      observedFiles:["app/a.ts","app/b.ts","app/committed.ts"],
      dirtyFilesAtCapture:["app/a.ts","app/b.ts","other.ts"],
      commitAtCapture:"abcdef123456"
    });
  });

  it("does not invent attribution without a scoped file-change event",()=>{
    expect(taskGitAttribution([{type:"file_change_started",content:"",metadata:{path:"old.ts",pathBase:"unresolved"}}],{changedFiles:["new.ts"]},"now")).toBeNull();
    expect(taskGitAttribution([],undefined,"now")).toBeNull();
  });

  it("adds active-task events to stored attribution without waiting for task completion",()=>{
    expect(mergeLiveTaskGitAttribution([
      {type:"file_change_completed",content:"",metadata:{path:"live.ts",pathBase:"workspace"}}
    ],{version:1,capturedAt:"before",observedFiles:["stored.ts"]},"now")).toEqual({
      version:2,capturedAt:"now",observedFiles:["live.ts","stored.ts"],dirtyFilesAtCapture:[],commitAtCapture:null
    });
  });
});
