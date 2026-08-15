import{describe,expect,it}from"vitest";
import{readRunningHistoryPreference,runningHistoryPreferenceKey,writeRunningHistoryPreference}from"../../src/web/running-history-preference";

function memoryStorage(){
  const values=new Map<string,string>();
  return{values,getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)};
}

describe("running history preference",()=>{
  it("isolates visibility by provider and session",()=>{
    const storage=memoryStorage();
    writeRunningHistoryPreference(storage,"claude","thread-a",true);
    writeRunningHistoryPreference(storage,"claude","thread-b",false);
    writeRunningHistoryPreference(storage,"codex","thread-a",false);
    expect(readRunningHistoryPreference(storage,"claude","thread-a")).toBe(true);
    expect(readRunningHistoryPreference(storage,"claude","thread-b")).toBe(false);
    expect(readRunningHistoryPreference(storage,"codex","thread-a")).toBe(false);
  });

  it("does not inherit the removed global preference",()=>{
    const storage=memoryStorage();
    storage.setItem("deck-show-running-history","1");
    expect(readRunningHistoryPreference(storage,"claude","thread-a")).toBe(false);
    expect(runningHistoryPreferenceKey("claude","thread/a")).toContain("thread%2Fa");
  });
});
