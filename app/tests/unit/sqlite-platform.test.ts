import{describe,expect,it}from"vitest";
import{sqliteMaintenanceInvocation}from"../../src/server/db/sqlite-platform.js";

describe("SQLite platform maintenance",()=>{
  it("uses the bundled Node helper on Windows without Python",()=>{
    expect(sqliteMaintenanceInvocation({operation:"backup",source:"C:\\Data\\live.sqlite",destination:"C:\\Data\\copy.sqlite",platform:"win32",appRoot:"C:\\Runtime",nodeBinary:"C:\\Runtime\\node.exe"})).toEqual({
      command:"C:\\Runtime\\node.exe",
      args:["C:\\Runtime\\app\\dist-server\\db\\sqlite-maintenance.mjs","backup","C:\\Data\\live.sqlite","C:\\Data\\copy.sqlite"],
      kind:"node",
    });
  });
  it("keeps the existing Python online-backup path on Linux",()=>{
    const launch=sqliteMaintenanceInvocation({operation:"backup",source:"/data/live.sqlite",destination:"/data/copy.sqlite",platform:"linux",pythonBinary:"/usr/bin/python3"});
    expect(launch).toMatchObject({command:"/usr/bin/python3",kind:"python"});
    expect(launch.args.slice(-2)).toEqual(["/data/live.sqlite","/data/copy.sqlite"]);
  });
  it("uses the bundled Node helper for Windows restores",()=>{
    expect(sqliteMaintenanceInvocation({operation:"restore",source:"C:\\Snapshots\\verified.sqlite",destination:"C:\\Data\\restore.tmp",platform:"win32",appRoot:"C:\\Runtime",nodeBinary:"C:\\Runtime\\node.exe"})).toEqual({
      command:"C:\\Runtime\\node.exe",
      args:["C:\\Runtime\\app\\dist-server\\db\\sqlite-maintenance.mjs","restore","C:\\Snapshots\\verified.sqlite","C:\\Data\\restore.tmp"],
      kind:"node",
    });
  });
  it("requires an explicit application root for Windows helpers",()=>{
    expect(()=>sqliteMaintenanceInvocation({operation:"quick-check",source:"C:\\Data\\live.sqlite",platform:"win32"})).toThrow(/appRoot/);
  });
});
