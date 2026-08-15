import {describe,expect,it,vi} from "vitest";
import {DEFAULT_RUNTIME_AUTO_UPDATE,RuntimeUpdateCoordinator,normalizeRuntimeAutoUpdate} from "../../src/server/runtime-update-coordinator.js";

const available=[
  {provider:"codex" as const,name:"Codex CLI",current:"1.0.0",latest:"1.1.0",updateAvailable:true,managed:true,source:"openai-standalone",checkedAt:new Date().toISOString(),canUpdate:true,checksum:null},
  {provider:"claude" as const,name:"Claude Code",current:"2.0.0",latest:"2.0.0",updateAvailable:false,managed:true,source:"managed",checkedAt:new Date().toISOString(),canUpdate:true,checksum:null}
];

async function waitFor(check:()=>boolean){for(let index=0;index<50;index++){if(check())return;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error("condition not reached");}

describe("runtime update coordinator",()=>{
  it("normalizes provider toggles safely",()=>{
    expect(normalizeRuntimeAutoUpdate({providers:{codex:true,claude:"yes"}})).toEqual({version:1,providers:{codex:true,claude:false}});
    expect(normalizeRuntimeAutoUpdate(null)).toEqual(DEFAULT_RUNTIME_AUTO_UPDATE);
  });

  it("announces an available update and its automatic completion per provider",async()=>{
    let stored:any={version:1,providers:{codex:true,claude:false}};const events:any[]=[];
    const coordinator=new RuntimeUpdateCoordinator({
      root:"/tmp/runtime-test",load:async()=>stored,save:async value=>{stored=structuredClone(value);},
      check:vi.fn(async()=>available),
      apply:vi.fn(async()=>available.map(item=>item.provider==="codex"?{...item,current:"1.1.0",updateAvailable:false}:item)),
      startupDelayMs:60_000,intervalMs:60_000
    });
    await coordinator.initialize();coordinator.subscribe(0,event=>events.push(event));
    await coordinator.checkNow();await waitFor(()=>events.some(event=>event.type==="auto_update_completed"));
    expect(events.map(event=>[event.provider,event.type])).toEqual([["codex","update_available"],["codex","auto_update_completed"]]);
    expect(stored.notifications.available.codex).toBe("1.1.0");
    expect(stored.notifications.completed.codex).toBe("1.1.0");
    coordinator.close();
  });
});
