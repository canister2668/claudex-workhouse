import{describe,expect,it}from"vitest";
import{acceptWindowsUpdateAfterFailure,beginWindowsUpdate,completeWindowsRollback,confirmWindowsUpdateHealth,createWindowsUpdateState,expireWindowsUpdateHealth,failWindowsUpdateHealth,parseWindowsUpdateState,rollbackConfirmedWindowsUpdate,windowsPendingCleanupPlan}from"../../src/server/windows/update-state.js";

const begin=(schemaReversible=true)=>beginWindowsUpdate(createWindowsUpdateState("1.0.0","2026-07-30T00:00:00.000Z"),{version:"1.1.0",databaseSnapshot:"snapshots/pre-1.1.0",fromSchema:4,toSchema:5,schemaReversible,activatedAt:"2026-07-30T00:01:00.000Z",healthDeadline:"2026-07-30T00:03:00.000Z"});

describe("Windows update and rollback state",()=>{
  it("requires a snapshot and keeps N-1 only after health confirmation",()=>{
    expect(()=>beginWindowsUpdate(createWindowsUpdateState("1.0.0"),{version:"1.1.0",databaseSnapshot:"",fromSchema:4,toSchema:5,schemaReversible:true,healthDeadline:"2099-01-01T00:00:00Z"})).toThrow(/snapshot/);
    const pending=begin();expect(pending).toMatchObject({phase:"pending-health",currentVersion:"1.1.0",previousVersion:"1.0.0"});
    expect(confirmWindowsUpdateHealth(pending,"2026-07-30T00:02:00.000Z")).toMatchObject({phase:"stable",currentVersion:"1.1.0",previousVersion:"1.0.0",pending:null});
  });
  it("rolls a reversible update back and defers failed-version cleanup",()=>{
    const failed=failWindowsUpdateHealth(begin(),"health timeout"),rolled=completeWindowsRollback(failed,{snapshotRestored:false,now:"2026-07-30T00:04:00.000Z"});
    expect(rolled).toMatchObject({phase:"stable",currentVersion:"1.0.0",previousVersion:null,pending:null,pendingCleanup:["1.1.0"]});
    expect(windowsPendingCleanupPlan(rolled,["0.9.0","1.0.0","1.1.0"])).toEqual(["0.9.0","1.1.0"]);
  });
  it("blocks binary-only rollback after an irreversible schema increase",()=>{
    const blocked=failWindowsUpdateHealth(begin(false),"server failed");
    expect(blocked.phase).toBe("blocked-schema");
    expect(()=>completeWindowsRollback(blocked,{snapshotRestored:false})).toThrow(/snapshot/);
    expect(completeWindowsRollback(blocked,{snapshotRestored:true})).toMatchObject({phase:"stable",currentVersion:"1.0.0",pendingCleanup:["1.1.0"]});
  });
  it("rejects duplicate decisions and protects active, previous, and pending versions from cleanup",()=>{
    const pending=begin();expect(()=>beginWindowsUpdate(pending,{version:"1.2.0",databaseSnapshot:"snap",fromSchema:5,toSchema:5,schemaReversible:true,healthDeadline:"2099-01-01T00:00:00Z"})).toThrow(/pending/);
    expect(windowsPendingCleanupPlan(pending,["0.8.0","1.0.0","1.1.0"])).toEqual(["0.8.0"]);
  });
  it("moves the superseded N-1 version to pending cleanup on the next activation",()=>{
    const stable={...createWindowsUpdateState("1.1.0"),previousVersion:"1.0.0"};
    const pending=beginWindowsUpdate(stable,{version:"1.2.0",databaseSnapshot:"snapshot",fromSchema:5,toSchema:5,schemaReversible:true,activatedAt:"2026-07-30T01:00:00Z",healthDeadline:"2026-07-30T01:02:00Z"});
    expect(pending.pendingCleanup).toEqual(["1.0.0"]);
    expect(windowsPendingCleanupPlan(pending,["1.0.0","1.1.0","1.2.0"])).toEqual(["1.0.0"]);
  });
  it("expires pending health and rejects a late success",()=>{
    const pending=begin();
    expect(()=>confirmWindowsUpdateHealth(pending,"2026-07-30T00:03:00.001Z")).toThrow(/expired/);
    expect(expireWindowsUpdateHealth(pending,"2026-07-30T00:02:59Z")).toBe(pending);
    expect(expireWindowsUpdateHealth(pending,"2026-07-30T00:03:00.001Z")).toMatchObject({phase:"rollback-required",lastFailure:"health deadline expired"});
  });
  it("allows explicit forward recovery without restoring an irreversible snapshot",()=>{
    const blocked=failWindowsUpdateHealth(begin(false),"transient probe");
    expect(()=>acceptWindowsUpdateAfterFailure(blocked,{operatorConfirmed:false})).toThrow(/confirmation/);
    expect(acceptWindowsUpdateAfterFailure(blocked,{operatorConfirmed:true,now:"2026-07-30T00:04:00Z"})).toMatchObject({phase:"stable",currentVersion:"1.1.0",previousVersion:"1.0.0",pending:null,lastFailure:null});
  });
  it("rejects inconsistent persisted states and schema downgrades",()=>{
    expect(()=>parseWindowsUpdateState({...createWindowsUpdateState("1.0.0"),phase:"blocked-schema"})).toThrow();
    expect(()=>parseWindowsUpdateState({...begin(false),phase:"rollback-required"})).toThrow(/inconsistent/);
    expect(()=>beginWindowsUpdate(createWindowsUpdateState("1.0.0"),{version:"1.1.0",databaseSnapshot:"snapshot",fromSchema:5,toSchema:4,schemaReversible:true,healthDeadline:"2099-01-01T00:00:00Z"})).toThrow(/lower/);
  });
  it("retains migration evidence and guards a post-health N-1 rollback",()=>{
    const stable=confirmWindowsUpdateHealth(begin(false),"2026-07-30T00:02:00Z");
    expect(stable.lastMigration).toMatchObject({fromSchema:4,toSchema:5,schemaReversible:false,databaseSnapshot:"snapshots/pre-1.1.0"});
    expect(()=>rollbackConfirmedWindowsUpdate(stable,{snapshotRestored:false})).toThrow(/snapshot/);
    expect(rollbackConfirmedWindowsUpdate(stable,{snapshotRestored:true,now:"2026-07-31T00:00:00Z"})).toMatchObject({currentVersion:"1.0.0",previousVersion:null,lastMigration:null,pendingCleanup:["1.1.0"]});
  });
  it("clears confirmed migration evidence when a newer update begins",()=>{
    const stable=confirmWindowsUpdateHealth(begin(),"2026-07-30T00:02:00Z");
    const pending=beginWindowsUpdate(stable,{version:"1.2.0",databaseSnapshot:"snapshots/pre-1.2.0",fromSchema:5,toSchema:5,schemaReversible:true,activatedAt:"2026-07-31T00:00:00Z",healthDeadline:"2026-07-31T00:02:00Z"});
    expect(pending.lastMigration).toBeNull();
    expect(()=>parseWindowsUpdateState({...pending,lastMigration:stable.lastMigration})).toThrow(/cannot retain/);
  });
});
