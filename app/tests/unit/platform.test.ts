import path from"node:path";
import{describe,expect,it}from"vitest";
import{hostPathInside,hostPathKey,isAbsoluteHostPath,resolveWorkhouseRoots,sameHostPath}from"../../src/server/platform.js";

describe("host platform paths",()=>{
  it("accepts Windows drive and UNC paths while rejecting ambiguous device and relative paths",()=>{
    expect(isAbsoluteHostPath("C:\\Users\\Alice\\Work","win32")).toBe(true);
    expect(isAbsoluteHostPath("\\\\server\\share\\Work","win32")).toBe(true);
    for(const value of["relative\\work","\\Work","/Work","\\\\?\\C:\\Work","\\\\.\\PhysicalDrive0","C:\\Work\\CON","C:\\Work\\CONIN$","C:\\Work\\name.","C:\\Work\\name ","C:\\Work\\..\\escape","C:\\Work\\file:stream"]){
      expect(isAbsoluteHostPath(value,"win32")).toBe(false);
    }
  });
  it("uses Windows case-insensitive containment without accepting sibling prefixes",()=>{
    expect(sameHostPath("C:\\Users\\Alice","c:\\users\\ALICE","win32")).toBe(true);
    expect(hostPathInside("C:\\Users\\Alice","c:\\users\\alice\\Work","win32")).toBe(true);
    expect(hostPathInside("C:\\Users\\Alice","C:\\Users\\Alice-old","win32")).toBe(false);
    expect(hostPathInside("\\\\server\\share","\\\\SERVER\\SHARE\\folder","win32")).toBe(true);
    expect(hostPathKey("C:\\Users\\Alice\\Work","win32")).toBe(hostPathKey("c:\\users\\ALICE\\work","win32"));
  });
  it("preserves the legacy common root and allows explicit app/data separation",()=>{
    expect(resolveWorkhouseRoots({CLAUDEX_WORKHOUSE_ROOT:"/srv/workhouse"},"linux")).toEqual({appRoot:"/srv/workhouse",dataRoot:"/srv/workhouse",legacyRoot:"/srv/workhouse"});
    const roots=resolveWorkhouseRoots({LOCALAPPDATA:"C:\\Users\\Alice\\AppData\\Local",CLAUDEX_WORKHOUSE_APP_ROOT:"D:\\Workhouse Runtime",CLAUDEX_WORKHOUSE_DATA_ROOT:"C:\\Users\\Alice\\AppData\\Local\\Claudex Workhouse"},"win32");
    expect(roots.appRoot).toBe(path.win32.normalize("D:\\Workhouse Runtime"));
    expect(roots.dataRoot).toBe(path.win32.normalize("C:\\Users\\Alice\\AppData\\Local\\Claudex Workhouse"));
  });
  it("uses the current-user Windows application-data directory by default",()=>{
    expect(resolveWorkhouseRoots({LOCALAPPDATA:"C:\\Users\\Alice\\AppData\\Local"},"win32")).toEqual({
      appRoot:"C:\\Users\\Alice\\AppData\\Local\\Claudex Workhouse",
      dataRoot:"C:\\Users\\Alice\\AppData\\Local\\Claudex Workhouse",
      legacyRoot:"C:\\Users\\Alice\\AppData\\Local\\Claudex Workhouse",
    });
  });
  it("rejects relative and Windows device roots before startup",()=>{
    expect(()=>resolveWorkhouseRoots({CLAUDEX_WORKHOUSE_APP_ROOT:"relative/runtime",CLAUDEX_WORKHOUSE_DATA_ROOT:"/srv/data"},"linux")).toThrow(/APP_ROOT.*absolute/);
    expect(()=>resolveWorkhouseRoots({CLAUDEX_WORKHOUSE_APP_ROOT:"C:\\Runtime",CLAUDEX_WORKHOUSE_DATA_ROOT:"\\\\?\\C:\\Data"},"win32")).toThrow(/DATA_ROOT.*absolute/);
  });
});
