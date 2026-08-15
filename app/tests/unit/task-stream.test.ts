import { afterEach,describe,expect,it,vi } from "vitest";
import { resetTaskStreamsForTests,subscribeTaskStream,taskStreamCountForTests,taskStreamRetryDelay } from "../../src/web/task-stream.js";

class FakeEventSource{
  static instances:FakeEventSource[]=[];
  listeners=new Map<string,Array<(event:any)=>void>>();
  closed=false;
  onerror:((event:any)=>void)|null=null;
  constructor(readonly url:string){FakeEventSource.instances.push(this);}
  addEventListener(type:string,listener:(event:any)=>void){this.listeners.set(type,[...(this.listeners.get(type)??[]),listener]);}
  emit(type:string,data?:unknown){const event=data===undefined?{}:{data:JSON.stringify(data)};for(const listener of this.listeners.get(type)??[])listener(event);if(type==="error")this.onerror?.(event);}
  close(){this.closed=true;}
}

describe("shared task stream broker",()=>{
  afterEach(()=>{resetTaskStreamsForTests();FakeEventSource.instances=[];vi.useRealTimers();vi.unstubAllGlobals();});

  it("uses one EventSource for multiple subscribers and closes at refcount zero",()=>{
    vi.stubGlobal("EventSource",FakeEventSource);
    const first:any[]=[],second:any[]=[];
    const stopFirst=subscribeTaskStream({provider:"codex",taskId:"task-1",onEvent:event=>first.push(event)});
    const stopSecond=subscribeTaskStream({provider:"codex",taskId:"task-1",onEvent:event=>second.push(event)});
    expect(FakeEventSource.instances).toHaveLength(1);
    FakeEventSource.instances[0].emit("agent-event",{type:"message_completed",content:"한 번",sequence:1,eventId:"event:1"});
    expect(first).toHaveLength(1);expect(second).toHaveLength(1);
    stopFirst();expect(FakeEventSource.instances[0].closed).toBe(false);
    stopSecond();expect(FakeEventSource.instances[0].closed).toBe(true);expect(taskStreamCountForTests()).toBe(0);
  });

  it("reconnects with exponential backoff and the broker-owned cursor",()=>{
    vi.useFakeTimers();vi.stubGlobal("EventSource",FakeEventSource);
    const stop=subscribeTaskStream({provider:"claude",taskId:"task-2",after:3,onEvent:()=>{}});
    FakeEventSource.instances[0].emit("agent-event",{type:"tool_completed",content:"done",sequence:4,eventId:"event:4"});
    FakeEventSource.instances[0].emit("error");
    expect(FakeEventSource.instances).toHaveLength(1);
    vi.advanceTimersByTime(taskStreamRetryDelay(0));
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.instances[1].url).toContain("after=4");
    stop();
  });

  it("starts status-only subscribers at the live tail without replaying history",()=>{
    vi.stubGlobal("EventSource",FakeEventSource);
    const stop=subscribeTaskStream({provider:"codex",taskId:"task-tail",replay:false,onEvent:()=>{}});
    expect(FakeEventSource.instances[0].url).toContain("tail=1");
    stop();
  });

  it("does not rewind a shared source for a late tail-only subscriber",()=>{
    vi.stubGlobal("EventSource",FakeEventSource);
    const first=subscribeTaskStream({provider:"codex",taskId:"task-live",after:5,onEvent:()=>{}});
    FakeEventSource.instances[0].emit("agent-event",{type:"message_delta",content:"live",sequence:6,eventId:"event:6"});
    const tail=subscribeTaskStream({provider:"codex",taskId:"task-live",replay:false,onEvent:()=>{}});
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].closed).toBe(false);
    first();tail();
  });

  it("switches a tail-only source to replay when a detail subscriber joins",()=>{
    vi.stubGlobal("EventSource",FakeEventSource);
    const tail=subscribeTaskStream({provider:"codex",taskId:"task-switch",replay:false,onEvent:()=>{}});
    const detail=subscribeTaskStream({provider:"codex",taskId:"task-switch",after:0,onEvent:()=>{}});
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.instances[0].closed).toBe(true);
    expect(FakeEventSource.instances[1].url).toContain("after=0");
    tail();detail();
  });

  it("rewinds the shared source when a late detail subscriber cannot replay an avatar cursor",()=>{
    vi.stubGlobal("EventSource",FakeEventSource);
    const stopInitial=subscribeTaskStream({provider:"codex",taskId:"task-shared",onEvent:()=>{}});
    FakeEventSource.instances[0].emit("agent-event",{type:"message_delta",content:"먼저 소비됨",sequence:7,eventId:"event:7"});
    stopInitial();

    const avatarEvents:any[]=[];
    const stopAvatar=subscribeTaskStream({provider:"codex",taskId:"task-shared",after:7,onEvent:event=>avatarEvents.push(event)});
    FakeEventSource.instances[1].emit("agent-event",{type:"message_delta",content:"서버 재전송",sequence:7,eventId:"event:7"});
    expect(avatarEvents).toHaveLength(0);

    const detailEvents:any[]=[];
    const stopDetail=subscribeTaskStream({provider:"codex",taskId:"task-shared",after:0,onEvent:event=>detailEvents.push(event)});
    expect(FakeEventSource.instances).toHaveLength(3);
    expect(FakeEventSource.instances[1].closed).toBe(true);
    expect(FakeEventSource.instances[2].url).toContain("after=0");

    FakeEventSource.instances[2].emit("agent-event",{type:"message_delta",content:"상세 화면 복구",sequence:7,eventId:"event:7"});
    expect(avatarEvents).toHaveLength(0);
    expect(detailEvents).toEqual([expect.objectContaining({content:"상세 화면 복구",sequence:7})]);
    stopAvatar();stopDetail();
  });
});
