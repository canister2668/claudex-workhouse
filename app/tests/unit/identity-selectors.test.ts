import { describe,expect,it } from "vitest";
import { assertUniqueKeys,mergeWorkspaceRecords } from "../../src/web/identity-selectors.js";

const workspace=(id:string,path:string,updatedAt:string)=>({id,projectId:"claudex-workhouse",hostId:"local",displayName:id,canonicalPath:path,updatedAt});

describe("identity selectors",()=>{
  it("includes one latest workspace when current, registered, and recent sources repeat its ID",()=>{
    const current=workspace("workspace-0b3","/old","2026-07-17T08:00:00.000Z");
    const registered=workspace("workspace-0b3","/srv/claudex-workhouse","2026-07-17T09:00:00.000Z");
    const recent=workspace("workspace-0b3","/stale","2026-07-17T08:30:00.000Z");
    expect(mergeWorkspaceRecords([current],[registered],[recent])).toEqual([registered]);
  });

  it("does not merge different workspace IDs merely because their path or name matches",()=>{
    const first=workspace("workspace-a","/shared","2026-07-17T09:00:00.000Z");
    const second={...first,id:"workspace-b"};
    expect(mergeWorkspaceRecords([first,second]).map(item=>item.id)).toEqual(["workspace-a","workspace-b"]);
  });

  it("keeps one workspace after follow-up and resume snapshots repeat the current registration",()=>{
    const registered=workspace("workspace-0b3","/srv/claudex-workhouse","2026-07-17T09:00:00.000Z");
    const followUp={...registered,updatedAt:"2026-07-17T09:01:00.000Z"};
    const resumed={...registered,updatedAt:"2026-07-17T09:02:00.000Z"};
    const rows=mergeWorkspaceRecords([registered],[followUp],[resumed]);
    expect(rows).toEqual([resumed]);
    expect(()=>assertUniqueKeys("workspace selector",rows,item=>item.id)).not.toThrow();
  });

  it("reports the duplicated key and indexes at a selector boundary",()=>{
    expect(()=>assertUniqueKeys("production rows",[{id:"same"},{id:"same"}],item=>item.id)).toThrow("production rows: duplicate key same at indexes 0 and 1");
  });
});
