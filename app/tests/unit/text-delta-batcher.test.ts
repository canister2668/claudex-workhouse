import {afterEach,describe,expect,it,vi} from "vitest";
import {createTextDeltaBatcher} from "../../src/server/text-delta-batcher.js";

afterEach(()=>vi.useRealTimers());

describe("text delta batcher",()=>{
  it("coalesces rapid provider token fragments into one timed event",()=>{
    vi.useFakeTimers();const emitted:Array<{content:string;index:number|undefined}>=[],batcher=createTextDeltaBatcher<{index:number}>((content,metadata)=>emitted.push({content,index:metadata?.index}),{intervalMs:80,maxChars:20});
    batcher.push("딥",{index:0});batcher.push("식",{index:1});batcher.push(" 응답",{index:2});
    expect(emitted).toEqual([]);vi.advanceTimersByTime(80);
    expect(emitted).toEqual([{content:"딥식 응답",index:2}]);
  });

  it("flushes immediately at the size boundary and at completion",()=>{
    vi.useFakeTimers();const emitted:string[]=[],batcher=createTextDeltaBatcher(content=>emitted.push(content),{intervalMs:80,maxChars:4});
    batcher.push("ab");batcher.push("cd");batcher.push("tail");batcher.flush();
    expect(emitted).toEqual(["abcd","tail"]);vi.runAllTimers();expect(emitted).toHaveLength(2);
  });
});
