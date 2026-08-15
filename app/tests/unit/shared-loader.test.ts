import {describe,expect,it,vi} from "vitest";
import {createSharedLoader} from "../../src/server/shared-loader.js";

describe("shared loader",()=>{
  it("shares overlapping ordinary loads and starts a new load after settlement",async()=>{
    let release:(value:number)=>void=()=>{};
    const load=vi.fn(()=>new Promise<number>(resolve=>{release=resolve;})),shared=createSharedLoader(load);
    const first=shared(),second=shared();
    expect(second).toBe(first);expect(load).toHaveBeenCalledTimes(1);
    release(7);await expect(first).resolves.toBe(7);await Promise.resolve();
    void shared();expect(load).toHaveBeenCalledTimes(2);
  });

  it("does not let an explicit refresh join a stale ordinary load",async()=>{
    const load=vi.fn(async(force:boolean)=>force?2:1),shared=createSharedLoader(load);
    await expect(Promise.all([shared(),shared(true)])).resolves.toEqual([1,2]);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
