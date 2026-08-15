import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PersistentEventStream } from "../../src/web/collaboration-stream";
import { sseResumeSequence } from "../../src/server/stream-events";

class FakeEventSource{
  static instances:FakeEventSource[]=[];
  listeners=new Map<string,Array<(event:any)=>void>>();closed=false;onerror:((event:any)=>void)|null=null;
  constructor(public url:string){FakeEventSource.instances.push(this);}
  addEventListener(type:string,listener:(event:any)=>void){this.listeners.set(type,[...(this.listeners.get(type)??[]),listener]);}
  emit(type:string,data:any={}){for(const listener of this.listeners.get(type)??[])listener(type==="open"?{}:{data:JSON.stringify(data)});}
  fail(){this.onerror?.({});}
  close(){this.closed=true;}
}

beforeEach(()=>{vi.useFakeTimers();FakeEventSource.instances=[];vi.stubGlobal("EventSource",FakeEventSource);vi.stubGlobal("navigator",{onLine:true});vi.spyOn(Math,"random").mockReturnValue(0);});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});

describe("PersistentEventStream",()=>{
  it("resumes from the newest server or client cursor",()=>{expect(sseResumeSequence("stream:9",12)).toBe(12);expect(sseResumeSequence("stream:15",12)).toBe(15);expect(sseResumeSequence("invalid","bad")).toBe(0);});
  it("keeps reconnecting beyond four failures with a 30 second cap",async()=>{const statuses:string[]=[];const stream=new PersistentEventStream({url:()=>"/events",eventName:"event",onEvent:()=>{},onResync:()=>{},onStatus:value=>statuses.push(value)});stream.start();for(const delay of [1_000,2_000,4_000,8_000,16_000,30_000,30_000]){FakeEventSource.instances.at(-1)!.fail();await vi.advanceTimersByTimeAsync(delay);}expect(FakeEventSource.instances).toHaveLength(8);expect(statuses.filter(value=>value==="delayed").length).toBeGreaterThan(4);stream.stop();});
  it("resets backoff after open and runs the watchdog only while disconnected",async()=>{const watchdog=vi.fn(),stream=new PersistentEventStream({url:()=>"/events",eventName:"event",onEvent:()=>{},onResync:()=>{},onStatus:()=>{},onWatchdog:watchdog});stream.start();FakeEventSource.instances[0].fail();await vi.advanceTimersByTimeAsync(20_000);expect(watchdog).toHaveBeenCalledTimes(1);const connected=FakeEventSource.instances.at(-1)!;connected.emit("open");await vi.advanceTimersByTimeAsync(40_000);expect(watchdog).toHaveBeenCalledTimes(1);connected.fail();await vi.advanceTimersByTimeAsync(1_000);expect(FakeEventSource.instances.length).toBeGreaterThanOrEqual(3);stream.stop();});
  it("keeps exactly one live source across explicit online reconnections",()=>{const stream=new PersistentEventStream({url:()=>"/events",eventName:"event",onEvent:()=>{},onResync:()=>{},onStatus:()=>{}});stream.start();stream.reconnectNow();stream.reconnectNow();expect(FakeEventSource.instances.filter(source=>!source.closed)).toHaveLength(1);stream.stop();expect(FakeEventSource.instances.filter(source=>!source.closed)).toHaveLength(0);});
});
