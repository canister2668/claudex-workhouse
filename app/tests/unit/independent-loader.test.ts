import { describe,expect,it,vi } from "vitest";
import { applyIndependentRegion, summarizeLoaderFailures, type LoaderFailure } from "../../src/web/independent-loader";

describe("independent initial loaders",()=>{
  it("applies a fast region while another region remains delayed",async()=>{
    vi.useFakeTimers();
    const applied:string[]=[],failures:LoaderFailure[]=[];
    const slow=new Promise<string>(resolve=>setTimeout(()=>resolve("tasks"),20_000));
    const settled=Promise.allSettled([
      applyIndependentRegion("tasks",slow,value=>applied.push(value),failures),
      applyIndependentRegion("threads",Promise.resolve("threads"),value=>applied.push(value),failures)
    ]);
    await vi.advanceTimersByTimeAsync(0);
    expect(applied).toEqual(["threads"]);
    await vi.advanceTimersByTimeAsync(20_000);
    await settled;
    expect(applied).toEqual(["threads","tasks"]);
    vi.useRealTimers();
  });

  it("keeps successful task/thread regions when the other one fails",async()=>{
    const taskFailures:LoaderFailure[]=[],taskApplied:string[]=[];
    await Promise.allSettled([
      applyIndependentRegion("tasks",Promise.reject(new Error("tasks unavailable")),value=>taskApplied.push(value),taskFailures),
      applyIndependentRegion("threads",Promise.resolve("thread row"),value=>taskApplied.push(value),taskFailures)
    ]);
    expect(taskApplied).toEqual(["thread row"]);
    expect(taskFailures).toEqual([{region:"tasks",message:"tasks unavailable"}]);

    const threadFailures:LoaderFailure[]=[],threadApplied:string[]=[];
    await Promise.allSettled([
      applyIndependentRegion("tasks",Promise.resolve("task row"),value=>threadApplied.push(value),threadFailures),
      applyIndependentRegion("threads",Promise.reject(new Error("threads unavailable")),value=>threadApplied.push(value),threadFailures)
    ]);
    expect(threadApplied).toEqual(["task row"]);
    expect(threadFailures).toEqual([{region:"threads",message:"threads unavailable"}]);
  });

  it("collapses a shared outage while retaining distinct region failures",()=>{
    expect(summarizeLoaderFailures([{region:"tasks",message:"connection lost"},{region:"workspaces",message:"connection lost"}])).toBe("connection lost");
    expect(summarizeLoaderFailures([{region:"tasks",message:"task failure"},{region:"workspaces",message:"workspace failure"}])).toBe("tasks: task failure\nworkspaces: workspace failure");
  });
});
