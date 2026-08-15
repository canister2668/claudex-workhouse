// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class FakeEventSource{
  static instances:FakeEventSource[]=[];
  listeners=new Map<string,Array<(event:any)=>void>>();closed=false;onerror:((event:any)=>void)|null=null;
  constructor(public url:string){FakeEventSource.instances.push(this);}
  addEventListener(type:string,listener:(event:any)=>void){this.listeners.set(type,[...(this.listeners.get(type)??[]),listener]);}
  emit(type:string,data:any={}){for(const listener of this.listeners.get(type)??[])listener(type==="open"?{}:{data:JSON.stringify(data)});}
  fail(){this.onerror?.({});}
  close(){this.closed=true;}
}

const snapshot=(emotion:string)=>({
  state:{emotion,line:"",statusLine:"",outfit:"normal"},
  codexState:{emotion:"neutral",line:"",statusLine:"",outfit:"Gpt-Codex"},
  grokState:{emotion:"neutral",line:"",statusLine:"",outfit:"Grok"},
  deepseekState:{emotion:"neutral",line:"",statusLine:"",outfit:"DeepSeek"},
  ollamaState:{emotion:"neutral",line:"",statusLine:"",outfit:"Ollama"},
  antigravityState:{emotion:"neutral",line:"",statusLine:"",outfit:"Antigravity"},
  taskStates:{},outfits:["normal"],assets:{},assetBaseUrl:"http://localhost",mode:"mcp"
});

let bootstraps=0;
let bootstrapEmotion="neutral";

beforeEach(()=>{
  vi.useFakeTimers();
  FakeEventSource.instances=[];bootstraps=0;bootstrapEmotion="neutral";
  vi.stubGlobal("EventSource",FakeEventSource);
  vi.stubGlobal("fetch",vi.fn(async()=>{bootstraps++;return{ok:true,json:async()=>snapshot(bootstrapEmotion)} as any;}));
  vi.spyOn(Math,"random").mockReturnValue(0);
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();vi.resetModules();});

describe("emotion stream",()=>{
  // A server restart behind the proxy answers the reconnect with an HTTP error,
  // which permanently closes a bare EventSource. Every avatar then stayed on the
  // previous task's completion hook while the next task was already running.
  it("reconnects and resynchronizes after the connection fails",async()=>{
    const { subscribeEmotionStream }=await import("../../src/web/emotion-stream");
    const seen:string[]=[];
    const unsubscribe=subscribeEmotionStream(value=>seen.push(value.state.emotion));
    await vi.advanceTimersByTimeAsync(0);

    FakeEventSource.instances[0].emit("emotion",{emotion:"proud",line:"해냈어요!",statusLine:"완료!",outfit:"normal"});
    expect(seen.at(-1)).toBe("proud");

    FakeEventSource.instances[0].fail();
    expect(FakeEventSource.instances[0].closed).toBe(true);

    bootstrapEmotion="execute";
    await vi.advanceTimersByTimeAsync(1_000);
    expect(FakeEventSource.instances).toHaveLength(2);

    // The reopened stream replays nothing, so the snapshot refetch is what
    // clears the stale completion hook.
    FakeEventSource.instances[1].emit("open");
    await vi.advanceTimersByTimeAsync(0);
    expect(bootstraps).toBeGreaterThan(1);
    expect(seen.at(-1)).toBe("execute");
    unsubscribe();
  });

  it("keeps retrying while the server stays down",async()=>{
    const { subscribeEmotionStream }=await import("../../src/web/emotion-stream");
    const unsubscribe=subscribeEmotionStream(()=>{});
    await vi.advanceTimersByTimeAsync(0);
    for(const delay of [1_000,2_000,4_000,8_000]){FakeEventSource.instances.at(-1)!.fail();await vi.advanceTimersByTimeAsync(delay);}
    expect(FakeEventSource.instances).toHaveLength(5);
    unsubscribe();
  });

  it("routes every provider event from the one connection",async()=>{
    const { subscribeEmotionStream }=await import("../../src/web/emotion-stream");
    let latest:any=null;
    const unsubscribe=subscribeEmotionStream(value=>{latest=value;});
    await vi.advanceTimersByTimeAsync(0);
    const stream=FakeEventSource.instances[0];
    stream.emit("codex-emotion",{emotion:"thinking",outfit:"Gpt-Codex",taskId:"codex:1"});
    stream.emit("grok-emotion",{emotion:"curious",outfit:"Grok",taskId:"grok:1"});
    stream.emit("antigravity-emotion",{emotion:"searching",outfit:"Antigravity",taskId:"antigravity:1"});
    stream.emit("ollama-emotion",{emotion:"coding",outfit:"Ollama"});
    stream.emit("deepseek-emotion",{emotion:"done",outfit:"DeepSeek"});
    expect(latest.codexState.emotion).toBe("thinking");
    expect(latest.grokState.emotion).toBe("curious");
    expect(latest.antigravityState.emotion).toBe("searching");
    expect(latest.ollamaState.emotion).toBe("coding");
    expect(latest.deepseekState.emotion).toBe("done");
    expect(latest.taskStates.codex["codex:1"].emotion).toBe("thinking");
    expect(latest.taskStates.grok["grok:1"].emotion).toBe("curious");
    unsubscribe();
  });

  it("publishes explicit bootstrap readiness and reports a failed bootstrap",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>({ok:false,status:503})));
    const {subscribeEmotionStream}=await import("../../src/web/emotion-stream");
    const statuses:string[]=[];
    const unsubscribe=subscribeEmotionStream(value=>statuses.push(value.bootstrapStatus));
    await vi.advanceTimersByTimeAsync(0);
    expect(statuses).toContain("pending");
    expect(statuses.at(-1)).toBe("error");
    unsubscribe();
  });
});
