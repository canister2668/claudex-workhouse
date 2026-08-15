import { afterEach, describe, expect, it, vi } from "vitest";
import { API_REQUEST_TIMEOUTS, apiRequestCategory, requestJson } from "../../src/web/api-client";

afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});

describe("requestJson",()=>{
  it("preserves structured API error metadata and sends the branded mutation guard",async()=>{const fetch=vi.fn(async()=>new Response(JSON.stringify({error:"Sandbox unavailable.",code:"AUTOMATIC_EXECUTION_BLOCKED"}),{status:409,headers:{"Content-Type":"application/json"}}));vi.stubGlobal("fetch",fetch);await expect(requestJson("/api/tasks",{method:"POST",body:"{}"})).rejects.toMatchObject({message:"Sandbox unavailable.",code:"AUTOMATIC_EXECUTION_BLOCKED",status:409,details:{code:"AUTOMATIC_EXECUTION_BLOCKED"}});expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get("X-Claudex-Workhouse-Request")).toBe("1");});
  it("classifies quick, database, provider refresh, and execution requests",()=>{expect(apiRequestCategory("/api/health/live")).toBe("quick");expect(apiRequestCategory("/api/tasks")).toBe("database");expect(apiRequestCategory("/api/codex/threads?limit=20&archived=false")).toBe("database");expect(apiRequestCategory("/api/providers/codex/models?refresh=true")).toBe("provider");expect(apiRequestCategory("/api/tasks","POST")).toBe("execution");});
  it("aborts an unresponsive read and reports diagnostic timeout metadata",async()=>{vi.useFakeTimers();vi.stubGlobal("fetch",vi.fn((_path,_init:any)=>new Promise((_resolve,reject)=>_init.signal.addEventListener("abort",()=>reject(_init.signal.reason),{once:true}))));const pending=requestJson("/api/tasks",{}, {timeoutMs:25,caller:"App.refresh.tasks",requestId:"request-test"});const rejection=expect(pending).rejects.toMatchObject({code:"REQUEST_TIMEOUT",method:"GET",url:"/api/tasks",requestId:"request-test",caller:"App.refresh.tasks",elapsedMs:25,message:expect.stringContaining("GET /api/tasks")});await vi.advanceTimersByTimeAsync(25);await rejection;});
  it("does not cancel database reads after the former 15 second limit",async()=>{vi.useFakeTimers();vi.stubGlobal("fetch",vi.fn(()=>new Promise<Response>(resolve=>setTimeout(()=>resolve(new Response(JSON.stringify({tasks:[]}),{status:200,headers:{"Content-Type":"application/json"}})),20_000))));const pending=requestJson("/api/tasks",{}, {caller:"regression.longTaskList"});let settled=false;void pending.finally(()=>{settled=true;});await vi.advanceTimersByTimeAsync(15_000);expect(settled).toBe(false);await vi.advanceTimersByTimeAsync(5_000);await expect(pending).resolves.toEqual({tasks:[]});expect(API_REQUEST_TIMEOUTS.database).toBe(60_000);expect(API_REQUEST_TIMEOUTS.provider).toBe(120_000);});
  it.each([502,520])("retries transient GET status %s without exposing the raw gateway code",async(status)=>{
    vi.useFakeTimers();
    const fetch=vi.fn()
      .mockResolvedValueOnce(new Response("<html>gateway</html>",{status,headers:{"Content-Type":"text/html"}}))
      .mockResolvedValueOnce(new Response(JSON.stringify({ok:true}),{status:200,headers:{"Content-Type":"application/json"}}));
    vi.stubGlobal("fetch",fetch);
    const pending=requestJson("/api/bootstrap/owner-claim/status");
    await vi.advanceTimersByTimeAsync(250);
    await expect(pending).resolves.toEqual({ok:true});
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(new Headers(fetch.mock.calls[1]?.[1]?.headers).get("X-Claudex-Request-Attempt")).toBe("2");
  });
  it("returns a friendly typed error after bounded transient retries",async()=>{
    vi.useFakeTimers();
    const fetch=vi.fn(async()=>new Response("<html>gateway</html>",{status:520,headers:{"Content-Type":"text/html"}}));
    vi.stubGlobal("fetch",fetch);
    const pending=requestJson("/api/tasks");
    const rejection=expect(pending).rejects.toMatchObject({code:"TRANSIENT_GATEWAY_ERROR",status:520,message:expect.not.stringContaining("520")});
    await vi.advanceTimersByTimeAsync(42_500);
    await rejection;
    expect(fetch).toHaveBeenCalledTimes(9);
  });
  it("keeps reads pending across an ordinary supervised restart",async()=>{
    vi.useFakeTimers();
    const fetch=vi.fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValue(new Response(JSON.stringify({ok:true}),{status:200,headers:{"Content-Type":"application/json"}}));
    vi.stubGlobal("fetch",fetch);
    const pending=requestJson("/api/tasks");
    await vi.advanceTimersByTimeAsync(10_500);
    await expect(pending).resolves.toEqual({ok:true});
    expect(fetch).toHaveBeenCalledTimes(6);
  });
  it("never retries mutations or ordinary client errors",async()=>{
    const fetch=vi.fn(async()=>new Response(JSON.stringify({error:"No access",code:"NO_ACCESS"}),{status:403,headers:{"Content-Type":"application/json"}}));
    vi.stubGlobal("fetch",fetch);
    await expect(requestJson("/api/tasks",{method:"POST",body:"{}"})).rejects.toMatchObject({code:"NO_ACCESS",status:403});
    await expect(requestJson("/api/tasks")).rejects.toMatchObject({code:"NO_ACCESS",status:403});
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("rejects a successful non-JSON API response",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response("<html>not json</html>",{status:200,headers:{"Content-Type":"text/html"}})));
    await expect(requestJson("/api/tasks")).rejects.toMatchObject({code:"INVALID_API_RESPONSE",status:200});
  });
});
