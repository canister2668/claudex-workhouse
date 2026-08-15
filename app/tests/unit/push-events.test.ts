import fs from "node:fs";
import vm from "node:vm";
import {describe,expect,it} from "vitest";
import {pushKindForEvent} from "../../src/server/push";
import {PUSH_KINDS} from "../../src/server/push-kinds";

type Listener=(event:any)=>void;

function serviceWorkerFixture(visibilityState="hidden",focused=false){
  const listeners=new Map<string,Listener>(),notifications:any[]=[],navigations:string[]=[];
  const client={url:"https://workhouse.example/current",visibilityState,focused,navigate:async(value:string)=>{navigations.push(value);},focus:async()=>client};
  const context={
    URL,URLSearchParams,
    caches:{keys:async()=>[],delete:async()=>true},
    self:{
      location:{origin:"https://workhouse.example"},
      skipWaiting:()=>{},
      clients:{claim:async()=>{},matchAll:async()=>[client],openWindow:async(value:string)=>{navigations.push(value);}},
      registration:{showNotification:async(title:string,options:any)=>{notifications.push({title,options});}},
      addEventListener:(type:string,listener:Listener)=>listeners.set(type,listener)
    }
  };
  vm.runInNewContext(fs.readFileSync("public/sw.js","utf8"),context);
  return{listeners,notifications,navigations};
}

function serviceWorkerKinds(){
  const source=fs.readFileSync("public/sw.js","utf8"),match=source.match(/const allowed=new Set\(\[([^\]]+)\]\)/);
  if(!match)throw new Error("Service Worker Push allowlist was not found.");
  return[...match[1].matchAll(/"([^"]+)"/g)].map(item=>item[1]);
}

describe("push event contract",()=>{
  it("keeps completion preference independent from browser permission and persists user-input preference",()=>{
    const app=fs.readFileSync("src/web/App.svelte","utf8"),server=fs.readFileSync("src/server/index.ts","utf8");
    const push=fs.readFileSync("src/server/push.ts","utf8");
    expect(app).not.toContain('pushState="permission-needed";notifications=false');
    expect(app).toContain('pushState="permission-needed";return');
    expect(server).toContain("userInput:z.boolean()");
    expect(app).toContain("if(subscription)await registerPushSubscription(subscription)");
    expect(server).toContain("endpointHash:item.endpointHash");
    expect(push).not.toContain("this.foreground()");
  });

  it("requests notification permission directly from the completion toggle gesture",()=>{
    const app=fs.readFileSync("src/web/App.svelte","utf8");
    expect(app).toContain('onchange={handleCompletionNotificationsChange}');
    expect(app).toMatch(/handleCompletionNotificationsChange\(event:Event\).*await enablePush\(\)/);
  });

  it("suppresses Push only when a Workhouse window actually has browser focus",async()=>{
    const fixture=serviceWorkerFixture("visible",true),waits:Promise<unknown>[]=[];
    fixture.listeners.get("push")?.({
      data:{json:()=>({kind:"completed",title:"Done"})},
      waitUntil:(value:Promise<unknown>)=>waits.push(value)
    });
    await Promise.all(waits);
    expect(fixture.notifications).toHaveLength(0);
  });

  it("shows Push when Android leaves a stale visible Workhouse tab unfocused",async()=>{
    const fixture=serviceWorkerFixture("visible",false),waits:Promise<unknown>[]=[];
    fixture.listeners.get("push")?.({
      data:{json:()=>({kind:"completed",title:"Done"})},
      waitUntil:(value:Promise<unknown>)=>waits.push(value)
    });
    await Promise.all(waits);
    expect(fixture.notifications).toHaveLength(1);
  });

  it("keeps every server Push kind in the Service Worker allowlist",()=>{
    const actual=serviceWorkerKinds();
    expect(new Set(actual).size).toBe(actual.length);
    expect([...actual].sort()).toEqual([...PUSH_KINDS].sort());
  });

  it("delivers user questions and preserves their task/session deep link",async()=>{
    expect(pushKindForEvent("user_input_required")).toBe("user-input");
    expect(pushKindForEvent("approval_required")).toBe("approval");
    expect(pushKindForEvent("user_input_resolved")).toBeNull();

    const fixture=serviceWorkerFixture(),waits:Promise<unknown>[]=[];
    fixture.listeners.get("push")?.({
      data:{json:()=>({kind:"user-input",title:"Question",body:"Answer in session",tag:"question",deepLink:{taskId:"task:123",provider:"codex",eventId:"event-456",view:"session"}})},
      waitUntil:(value:Promise<unknown>)=>waits.push(value)
    });
    await Promise.all(waits);
    expect(fixture.notifications).toHaveLength(1);
    expect(fixture.notifications[0].options.data.deepLink).toEqual({taskId:"task:123",provider:"codex",eventId:"event-456",view:"session"});

    const clickWaits:Promise<unknown>[]=[];
    fixture.listeners.get("notificationclick")?.({
      notification:{data:fixture.notifications[0].options.data,close:()=>{}},
      waitUntil:(value:Promise<unknown>)=>clickWaits.push(value)
    });
    await Promise.all(clickWaits);
    expect(fixture.navigations).toEqual(["/?task=task%3A123&provider=codex&event=event-456&view=session"]);

  });

  it("preserves a quota reservation deep link and accepts reservation-specific kinds",async()=>{
    const fixture=serviceWorkerFixture(),waits:Promise<unknown>[]=[];
    fixture.listeners.get("push")?.({
      data:{json:()=>({kind:"quota-failed",title:"Failed",deepLink:{reservationId:"11111111-1111-4111-8111-111111111111",view:"reservation"}})},
      waitUntil:(value:Promise<unknown>)=>waits.push(value)
    });
    await Promise.all(waits);
    expect(fixture.notifications).toHaveLength(1);
    const clickWaits:Promise<unknown>[]=[];
    fixture.listeners.get("notificationclick")?.({
      notification:{data:fixture.notifications[0].options.data,close:()=>{}},
      waitUntil:(value:Promise<unknown>)=>clickWaits.push(value)
    });
    await Promise.all(clickWaits);
    expect(fixture.navigations).toEqual(["/?reservation=11111111-1111-4111-8111-111111111111&view=reservation"]);
  });
});
