import { describe,expect,it } from "vitest";
import { ProviderTaskSnapshotCache,reconcileTaskSnapshot,removeProviderSessionRows,replaceProviderTaskRows,shouldSettleTaskLease,upsertTaskRows } from "../../src/server/provider-task-snapshot.js";

const task=(id:string,provider:"codex"|"claude",updatedAt:string)=>({id,provider,status:"running",updatedAt} as any);

describe("provider task snapshot publication",()=>{
  it("replaces only the requested provider without erasing the other provider",()=>{
    const current=[task("codex-old","codex","2026-01-01T00:00:00.000Z"),task("claude-old","claude","2026-01-02T00:00:00.000Z")];
    expect(replaceProviderTaskRows(current,"claude",[task("claude-new","claude","2026-01-03T00:00:00.000Z")]).map(item=>item.id)).toEqual(["claude-new","codex-old"]);
  });

  it("publishes a newly created task into the existing in-memory snapshot",()=>{
    const current=[task("claude-old","claude","2026-01-01T00:00:00.000Z")];
    const rows=upsertTaskRows(current,[task("codex-running","codex","2026-01-02T00:00:00.000Z")]);
    expect(rows.map(item=>item.id)).toEqual(["codex-running","claude-old"]);
  });

  it("removes every task row belonging to a deleted provider session",()=>{
    const rows=[{...task("codex-one","codex","2026-01-03T00:00:00.000Z"),threadId:"thread-a"},{...task("codex-two","codex","2026-01-02T00:00:00.000Z"),threadId:"thread-a"},{...task("claude-one","claude","2026-01-01T00:00:00.000Z"),threadId:"thread-a"}] as any;
    expect(removeProviderSessionRows(rows,"codex","thread-a").map(item=>item.id)).toEqual(["claude-one"]);
  });

  it("settles leases only for an observed active to terminal transition",()=>{
    const running=task("codex-task","codex","2026-01-01T00:00:00.000Z"),stopped={...running,status:"stopped"} as any;
    expect(shouldSettleTaskLease(running,stopped)).toBe(true);
    expect(shouldSettleTaskLease(stopped,stopped)).toBe(false);
    expect(shouldSettleTaskLease(undefined,stopped)).toBe(false);
  });

  it("replays create and stop mutations that land during synchronization",()=>{
    const old=task("codex-old","codex","2026-01-01T00:00:00.000Z"),created=task("codex-created","codex","2026-01-03T00:00:00.000Z"),stopped={...old,status:"stopped",updatedAt:"2026-01-04T00:00:00.000Z"} as any;
    const rows=reconcileTaskSnapshot([old],[old],undefined,[{kind:"upsert",task:created},{kind:"upsert",task:stopped}]);
    expect(rows.map(item=>[item.id,item.status])).toEqual([["codex-old","stopped"],["codex-created","running"]]);
  });

  it("replays a session deletion that lands during synchronization",()=>{
    const deleted={...task("codex-deleted","codex","2026-01-03T00:00:00.000Z"),threadId:"thread-delete"} as any,kept={...task("claude-kept","claude","2026-01-02T00:00:00.000Z"),threadId:"thread-delete"} as any;
    const rows=reconcileTaskSnapshot([deleted,kept],[deleted,kept],undefined,[{kind:"delete-session",provider:"codex",threadId:"thread-delete"}]);
    expect(rows.map(item=>item.id)).toEqual(["claude-kept"]);
  });

  it("replays a single task deletion without removing its session siblings",()=>{
    const removed={...task("codex-removed","codex","2026-01-03T00:00:00.000Z"),threadId:"thread-a"} as any,kept={...task("codex-kept","codex","2026-01-02T00:00:00.000Z"),threadId:"thread-a"} as any;
    const rows=reconcileTaskSnapshot([removed,kept],[removed,kept],undefined,[{kind:"delete-task",provider:"codex",taskId:"codex-removed"}]);
    expect(rows.map(item=>item.id)).toEqual(["codex-kept"]);
  });
});

describe("provider task snapshot cache",()=>{
  it("uses id-only reconciliation instead of periodically reloading task bodies",async()=>{
    let fullReads=0,idReads=0,now=0;
    const originalNow=Date.now;Date.now=()=>now;
    try{
      const old=task("old","claude","2026-01-01T00:00:00.000Z"),created=task("created","claude","2026-01-02T00:00:00.000Z");
      const store={listProviderTasks:async()=>{fullReads++;return[old];},listProviderTasksSince:async()=>[created],listProviderTaskIds:async()=>{idReads++;return[created.id];}};
      const cache=new ProviderTaskSnapshotCache(store,"claude",100);cache.prime([old]);now=101;
      expect((await cache.load()).map(item=>item.id)).toEqual(["created"]);
      expect({fullReads,idReads}).toEqual({fullReads:0,idReads:1});
    }finally{Date.now=originalNow;}
  });

  it("keeps an empty primed cache on delta reads",async()=>{
    let fullReads=0;
    const created=task("created","claude","2026-01-02T00:00:00.000Z"),store={listProviderTasks:async()=>{fullReads++;return[];},listProviderTasksSince:async(_provider:string,since:string)=>{expect(since).toBe("");return[created];},listProviderTaskIds:async()=>[created.id]};
    const cache=new ProviderTaskSnapshotCache(store,"claude");cache.prime([]);
    expect((await cache.load()).map(item=>item.id)).toEqual(["created"]);expect(fullReads).toBe(0);
  });
});
