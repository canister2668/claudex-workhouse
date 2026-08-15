import {describe,expect,it,vi} from "vitest";
import {renameSessionTitle} from "../../src/server/session-title.js";

const task=(id:string,threadId:string)=>({id,provider:"codex",threadId,title:`old-${id}`,metadata:{turn:id}} as any);

describe("session title persistence",()=>{
  it("renames every task turn and the Codex thread cache",async()=>{
    const writtenTasks:any[]=[],thread={threadId:"thread",title:"old",metadata:{workspaceId:"workspace"}},db={
      listProviderTasks:vi.fn().mockResolvedValue([task("one","thread"),task("two","thread"),task("other","other")]),
      getCodexThread:vi.fn().mockResolvedValue(thread),
      upsertTask:vi.fn(async(value:any)=>{writtenTasks.push(value);return value;}),
      upsertCodexThread:vi.fn(async(value:any)=>value)
    };
    const result=await renameSessionTitle(db as any,"codex","thread","My session");
    expect(result.tasks.map(item=>item.id)).toEqual(["one","two"]);
    expect(writtenTasks).toEqual([
      expect.objectContaining({id:"one",title:"My session",metadata:{turn:"one",customTitle:"My session"}}),
      expect.objectContaining({id:"two",title:"My session",metadata:{turn:"two",customTitle:"My session"}})
    ]);
    expect(db.upsertCodexThread).toHaveBeenCalledWith(expect.objectContaining({title:"My session",metadata:{workspaceId:"workspace",customTitle:"My session"}}));
  });

  it("renames a task without a confirmed thread ID",async()=>{
    const source=task("task-only",""),db={
      listProviderTasks:vi.fn().mockResolvedValue([source]),
      getCodexThread:vi.fn().mockResolvedValue(null),
      upsertTask:vi.fn(async(value:any)=>value),
      upsertCodexThread:vi.fn()
    };
    const result=await renameSessionTitle(db as any,"claude","task-only","Standalone");
    expect(result.tasks[0]).toMatchObject({id:"task-only",title:"Standalone",metadata:{customTitle:"Standalone"}});
    expect(db.getCodexThread).not.toHaveBeenCalled();
  });
});
