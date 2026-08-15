import {describe,expect,it} from "vitest";
import {latestThreadMember,latestThreadRows} from "../../src/web/provider-session-grouping.js";

const row=(id:string,status:string,createdAt:string,updatedAt=createdAt)=>({id,provider:"claude",threadId:"thread",status,createdAt,updatedAt});

describe("provider session grouping",()=>{
  it("classifies a thread by its newest turn instead of an older completed turn",()=>{
    const completed=row("old","completed","2026-07-25T10:00:00.000Z","2026-07-25T12:00:00.000Z");
    const running=row("new","running","2026-07-25T11:00:00.000Z","2026-07-25T11:01:00.000Z");
    expect(latestThreadRows([completed,running])).toEqual([running]);
  });

  it("moves an open Claude thread to a newly queued turn",()=>{
    const completed=row("old","completed","2026-07-25T10:00:00.000Z");
    const running=row("new","running","2026-07-25T11:00:00.000Z");
    expect(latestThreadMember([completed,running],completed)).toBe(running);
  });

  it("keeps a Workhouse-owned Claude row as the session representative",()=>{
    const owned={...row("owned","completed","2026-07-25T10:00:00.000Z"),owned:true,ownership:"claudex-workhouse",providerSessionId:"thread"};
    const external={...row("external","running","2026-07-25T12:00:00.000Z"),owned:false,ownership:"external"};
    expect(latestThreadRows([owned,external])).toEqual([owned]);
    expect(latestThreadMember([owned,external],external)).toBe(owned);
  });

  it("groups Claude rows by provider session id while the owned task thread id catches up",()=>{
    const owned={...row("owned","running","2026-07-25T10:00:00.000Z"),threadId:null,providerSessionId:"session-a",owned:true};
    const external={...row("external","running","2026-07-25T12:00:00.000Z"),threadId:"session-a",owned:false,ownership:"external"};
    expect(latestThreadRows([external,owned])).toEqual([owned]);
  });
});
