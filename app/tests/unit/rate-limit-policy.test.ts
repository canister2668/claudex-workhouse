import { describe,expect,it } from "vitest";
import { bypassGlobalRateLimit,globalRateLimitKey } from "../../src/server/rate-limit-policy.js";

describe("global rate-limit policy",()=>{
  it("never rate-limits the app document, assets, or health probes",()=>{
    expect(bypassGlobalRateLimit({url:"/",ip:"127.0.0.1"})).toBe(true);
    expect(bypassGlobalRateLimit({url:"/assets/app.js",ip:"127.0.0.1"})).toBe(true);
    expect(bypassGlobalRateLimit({url:"/api/health/live",ip:"127.0.0.1"})).toBe(true);
    expect(bypassGlobalRateLimit({url:"/api/tasks",ip:"127.0.0.1"})).toBe(false);
  });
  it("uses the authenticated actor instead of a shared reverse-proxy IP",()=>{
    expect(globalRateLimitKey({url:"/api/tasks",ip:"127.0.0.1",actor:"user-a@example.com"})).toBe("user-a@example.com");
    expect(globalRateLimitKey({url:"/api/tasks",ip:"127.0.0.1"})).toBe("127.0.0.1");
  });
});
