import fs from "node:fs";
import path from "node:path";
import {describe,expect,it}from"vitest";
import {summarizeDisplayedOutputUsage,summarizeTurnOutputUsage}from"../../src/web/conversation";

const THREAD="thread-1";
const usage=(outputTokens:number,extra:Record<string,unknown>={})=>({outputTokens,totalTokens:null,inputTokens:null,cachedInputTokens:null,cacheWriteInputTokens:null,reasoningTokens:null,updatedAt:null,...extra});
const assistantMessage=(content:string,outputUsage:unknown,threadId:string|null=THREAD)=>({
  type:"message_completed" as const,content,threadId,metadata:{outputUsage}
});
const usageNotice=(outputUsage:unknown,threadId:string|null=THREAD)=>({
  type:"unknown" as const,content:"usage updated",threadId,metadata:{nativeMethod:"thread/tokenUsage/updated",outputUsage}
});
const identifiedUsage=(outputTokens:number,callId:string,extra:Record<string,unknown>={})=>({
  type:"unknown" as const,content:"usage updated",threadId:THREAD,metadata:{nativeMethod:"claude/outputUsage/updated",outputCallId:callId,outputUsage:usage(outputTokens,extra)}
});

describe("a card counts the work between its input and its output",()=>{
  it("shows the complete provider-reported work instead of calling output the total",()=>{
    const result=summarizeTurnOutputUsage([
      assistantMessage("done",usage(120,{totalTokens:98_000}))
    ] as any,THREAD);
    expect(result).toMatchObject({tokens:98_000,inputTokens:97_880,outputTokens:120,exact:true});
  });

  it("adds up the messages of a turn that looped through tools",()=>{
    const result=summarizeTurnOutputUsage([
      assistantMessage("thinking",usage(40)),
      assistantMessage("running a command",usage(35)),
      assistantMessage("final answer",usage(25))
    ] as any,THREAD);
    expect(result).toMatchObject({tokens:100,inputTokens:null,outputTokens:100});
  });

  it("uses Claude message ids when a later call starts above the previous output peak",()=>{
    const result=summarizeTurnOutputUsage([
      identifiedUsage(500,"msg-a",{totalTokens:1500,inputTokens:1000}),
      identifiedUsage(800,"msg-b",{totalTokens:2800,inputTokens:2000})
    ] as any,THREAD);
    expect(result).toMatchObject({tokens:4300,inputTokens:3000,outputTokens:1300});
  });

  it("ignores the placeholder Claude reports before the real figure arrives",()=>{
    // The assistant event carries output_tokens: 1 and the true count follows
    // on the streaming deltas, which is why the card used to read "1".
    const result=summarizeTurnOutputUsage([
      usageNotice(usage(1,{totalTokens:101,inputTokens:100})),
      assistantMessage("answer",usage(1,{totalTokens:101,inputTokens:100})),
      usageNotice(usage(278))
    ] as any,THREAD);
    expect(result).toMatchObject({tokens:378,inputTokens:100,outputTokens:278});
  });

  it("keeps the last reading when a worker reports task-cumulative deltas",()=>{
    const result=summarizeTurnOutputUsage([
      usageNotice(usage(40)),
      usageNotice(usage(90)),
      usageNotice(usage(140))
    ] as any,THREAD);
    expect(result?.tokens).toBe(140);
  });

  it("keeps the final Codex task delta across multiple tool-loop requests sharing one task id",()=>{
    const event=(outputTokens:number,inputTokens:number)=>({
      type:"unknown" as const,content:"usage updated",threadId:THREAD,
      metadata:{nativeMethod:"thread/tokenUsage/updated",outputCallId:"task-1",usageScope:"task-cumulative-delta",outputUsage:usage(outputTokens,{inputTokens,totalTokens:inputTokens+outputTokens})}
    });
    expect(summarizeTurnOutputUsage([event(300,1500),event(700,3900)] as any,THREAD)).toMatchObject({tokens:4600,inputTokens:3900,outputTokens:700});
  });

  it("commits a legacy no-id segment before the first identified usage segment",()=>{
    expect(summarizeTurnOutputUsage([
      usageNotice(usage(500)),
      identifiedUsage(800,"new-call")
    ] as any,THREAD)).toMatchObject({tokens:1300,outputTokens:1300});
  });

  it("sums reasoning tokens alongside the output they belong to",()=>{
    const result=summarizeTurnOutputUsage([
      assistantMessage("a",usage(30,{reasoningTokens:12})),
      assistantMessage("b",usage(20,{reasoningTokens:8}))
    ] as any,THREAD);
    expect(result).toMatchObject({tokens:50,outputTokens:50,reasoningTokens:20});
  });

  it("leaves another thread's work out of this card",()=>{
    const result=summarizeTurnOutputUsage([
      assistantMessage("mine",usage(30)),
      assistantMessage("a subagent's",usage(500),"other-thread")
    ] as any,THREAD);
    expect(result?.tokens).toBe(30);
  });

  it("falls back to an estimate only when the provider reported nothing",()=>{
    const result=summarizeTurnOutputUsage([
      {type:"message_completed" as const,content:"hello there",threadId:THREAD,metadata:{}}
    ] as any,THREAD);
    expect(result?.exact).toBe(false);
    expect(result?.tokens).toBeGreaterThan(0);
  });
});

describe("a conversation-mode card includes its linked session",()=>{
  it("counts the linked provider session's messages in the card total",()=>{
    // runEventRows merges the collaboration run with its linked task stream,
    // and both carry the session thread id the card is scoped to.
    const result=summarizeDisplayedOutputUsage([
      assistantMessage("collaboration reply",usage(1)),
      assistantMessage("collaboration reply",usage(60)),
      assistantMessage("linked session work",usage(1)),
      assistantMessage("linked session work",usage(140))
    ] as any,THREAD,"collaboration reply");
    expect(result).toMatchObject({tokens:200,exact:true});
  });

  it("prefers the reported total over an estimate of the visible text",()=>{
    const result=summarizeDisplayedOutputUsage([
      assistantMessage("short",usage(900))
    ] as any,THREAD,"short");
    expect(result).toMatchObject({tokens:900,exact:true});
  });
});

// The dock is fixed over the conversation, so it used to cover what was being
// read and stay there through every scroll.
describe("the conversation dock joins the reading mode",()=>{
  const timeline=fs.readFileSync(path.join(process.cwd(),"src","web","CollaborationTimeline.svelte"),"utf8");
  const sessions=fs.readFileSync(path.join(process.cwd(),"src","web","sessions.css"),"utf8");

  it("drives the shared reading mode from the page scroll and from taps",()=>{
    expect(timeline).toContain('applyChromePhase("scrolling",top,');
    expect(timeline).toContain('applyChromePhase("tap")');
    expect(timeline).toContain("shouldRevealOnTap(event.target as Element|null)");
  });

  it("removes its listeners with the view",()=>{
    expect(timeline).toContain('window.removeEventListener("scroll",dockScroll)');
    expect(timeline).toContain('document.removeEventListener("pointerup",dockTap)');
  });

  it("slides by transform so the fixed dock never changes layout",()=>{
    expect(sessions).toContain("transform:translate(-50%,calc((1 - var(--chrome-progress,1))");
    expect(sessions).toMatch(/@media\(max-width:599px\) and \(pointer:coarse\)\{[\s\S]*?\.conversation-control-dock\{[\s\S]*?max-height:min\(30vh,220px\)/);
  });

  it("shows every available conversation input directly",()=>{
    expect(timeline).toContain("class:input-open={conversationInputVisible}");
    expect(timeline).toContain("{#if conversationInputVisible}");
    expect(timeline).toContain("{@render conversationInputForm(true)}");
    expect(timeline).not.toContain("conversationInputOpen");
    expect(sessions).toContain(".conversation-control-dock.input-open{max-height:min(56vh,420px)}");
  });
});
