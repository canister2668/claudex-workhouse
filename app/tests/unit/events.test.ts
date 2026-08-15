import { describe, expect, it, vi } from "vitest";
import { codexTurnEvents, collaborationPublicEvents, MAX_EVENT_METADATA_BYTES, mergeActiveClaudeThreadEvents, mergeHistoricalFileChanges, normalizeAgentEvent, providerThreadEvents, sanitizeEventMetadata, withTaskRequestIdentity } from "../../src/server/events.js";
import { presentEvent } from "../../src/web/events.js";
import { StreamSpool, readStreamEvents, readStreamFileChanges, STREAM_REPLAY_LIMIT } from "../../src/server/stream-events.js";
import {persistProviderSystemEvent} from "../../src/server/provider-system-events.js";
import fs from "node:fs";
import { CLAUDEX_WORKHOUSE_NATIVE_COLLABORATION_INSTRUCTIONS, claudexWorkhouseCollaborationInstructions, turnLifecycleEvent } from "../../src/server/codex-collaboration.js";
import { DEFAULT_DELEGATION_SETTINGS, delegationDeveloperInstructions, normalizeDelegationSettings, validateDelegationSettings } from "../../src/server/delegation-settings.js";
import { CLAUDE_TRANSCRIPT_EVENT_CONTENT_BYTES, CLAUDE_TRANSCRIPT_TAIL_BYTES, claudeTranscriptEvents } from "../../src/server/claude-transcript.js";

describe("AgentEvent safety and presentation", () => {
  it("falls back safely for unknown event kinds", () => {
    const event = normalizeAgentEvent({ type: "future_event", content: "future payload" }, "codex");
    expect(event.type).toBe("unknown");
    expect(presentEvent(event)).toEqual({ label: "기타 내부 이벤트", className: "log" });
  });

  it.each(["mcp_tool_call", "mcp_tool_result"] as const)("renders %s as plain generic content", (type) => {
    const event = normalizeAgentEvent({ type, content: '<img src=x onerror="globalThis.executed=true">', serverName: "emotion", toolName: "set_emotion" }, "claude");
    expect(event.content).toContain("<img");
    expect(presentEvent(event).className).toBe("log");
  });

  it("truncates oversized metadata", () => {
    expect(sanitizeEventMetadata({ payload: "x".repeat(MAX_EVENT_METADATA_BYTES + 1) })).toEqual({ truncated: true });
  });

  it("always masks secrets while preserving local paths for the display policy", () => {
    const event = normalizeAgentEvent({ type: "mcp_tool_result", content: "TOKEN=abc /srv/private/file", metadata: { authorization: "Bearer secret", output: "eyJhbGciOiJIUzI1NiJ9.e30.signature /home/user/key" } }, "codex");
    expect(event.content).toBe("TOKEN=[REDACTED] /srv/private/file");
    expect(JSON.stringify(event.metadata)).not.toContain("secret");
    expect(JSON.stringify(event.metadata)).toContain("/home/user/key");
  });

  it("persists ordered replayable stream events without secrets", () => {
    const root=fs.mkdtempSync("/tmp/claudex-workhouse-stream-test-");
    const spool=new StreamSpool(root,"codex:deck:test","codex");
    const first=spool.append({type:"turn_started",content:"started",threadId:"thread",turnId:"turn"}) as any;
    const second=spool.append({type:"command_output",content:"TOKEN=secret /srv/private/file",threadId:"thread",turnId:"turn",itemId:"item"}) as any;
    spool.append({type:"task_completed",content:"done",threadId:"thread",turnId:"turn",terminal:true});
    expect(first.sequence).toBe(1);expect(second.sequence).toBe(2);
    const replay=readStreamEvents(root,"codex:deck:test",1);
    expect(replay.events).toHaveLength(2);expect(replay.events[0].content).toBe("TOKEN=[REDACTED] /srv/private/file");expect(replay.events[0].eventId).toMatch(/:2$/);
    expect(readStreamEvents(root,"codex:deck:test",1,1).replayMissed).toBe(true);
    fs.rmSync(root,{recursive:true,force:true});
  });

  it("reuses parsed stream files and reads only appended bytes",()=>{
    const root=fs.mkdtempSync("/tmp/claudex-workhouse-stream-cache-test-"),spool=new StreamSpool(root,"codex:deck:cache","codex");
    spool.append({type:"turn_started",content:"one"});
    const reads=vi.spyOn(fs,"readSync");
    expect(readStreamEvents(root,"codex:deck:cache").events).toHaveLength(1);
    const initialReads=reads.mock.calls.length;
    expect(readStreamEvents(root,"codex:deck:cache").events).toHaveLength(1);
    expect(reads.mock.calls.length).toBe(initialReads);
    spool.append({type:"message_delta",content:"two"});
    expect(readStreamEvents(root,"codex:deck:cache",1).events.map(event=>event.content)).toEqual(["two"]);
    expect(reads.mock.calls.length).toBe(initialReads+1);
    reads.mockRestore();fs.rmSync(root,{recursive:true,force:true});
  });

  it("retains file changes after noisy progress leaves the replay window",()=>{
    const root=fs.mkdtempSync("/tmp/claudex-workhouse-stream-files-test-"),spool=new StreamSpool(root,"deepseek:files","deepseek");
    spool.append({type:"file_change_started",content:"diff",metadata:{path:"src/app.ts",pathBase:"workspace"}});
    for(let index=0;index<STREAM_REPLAY_LIMIT+10;index++)spool.append({type:"tool_progress",content:`thinking ${index}`});
    expect(readStreamEvents(root,"deepseek:files").events.some(event=>event.type==="file_change_started")).toBe(false);
    expect(readStreamFileChanges(root,"deepseek:files")).toMatchObject([{type:"file_change_started",metadata:{path:"src/app.ts"}}]);
    fs.rmSync(root,{recursive:true,force:true});
  });

  it("suppresses compatible-provider per-token thinking system events",()=>{
    expect(persistProviderSystemEvent("deepseek","thinking_tokens")).toBe(false);
    expect(persistProviderSystemEvent("ollama","thinking_tokens")).toBe(false);
    expect(persistProviderSystemEvent("claude","thinking_tokens")).toBe(true);
    expect(persistProviderSystemEvent("deepseek","hook_started")).toBe(true);
  });

  it("uses actual Codex turn messages instead of worker summary text",()=>{
    const events=codexTurnEvents([{id:"turn-new",status:"completed",items:[{type:"agentMessage",id:"agent",text:"Actual final answer",phase:"final_answer"}]},{id:"turn-old",status:"completed",items:[{type:"userMessage",id:"user",content:[{type:"text",text:"Original request"}]}]}]);
    expect(events.map((event)=>event.content)).toEqual(["Original request","Actual final answer"]);
    expect(events[1].type).toBe("message_completed");
  });

  it.each(["antigravity","deepseek","ollama","grok"] as const)("keeps every %s session turn when the newest task is reopened",provider=>{
    const task=(id:string,prompt:string,createdAt:string)=>({id,provider,nativeId:id,threadId:"shared-session",projectId:"project",title:"session",prompt,status:"completed",createdAt,updatedAt:createdAt,result:null,error:null,log:"",owned:true,pid:null,pgid:null,processStart:null,commandMarker:null,parentThreadId:null,metadata:{}} as any);
    const first=task(`${provider}:one`,"첫 입력","2026-08-04T01:00:00.000Z"),second=task(`${provider}:two`,"두 번째 입력","2026-08-04T02:00:00.000Z");
    const events=providerThreadEvents([
      {task:second,events:[{type:"message_completed",content:"두 번째 출력",taskId:second.id,eventId:"two:1"} as any]},
      {task:first,events:[{type:"message_completed",content:"첫 출력",taskId:first.id,eventId:"one:1"} as any]},
    ]);
    expect(events.map(event=>event.content)).toEqual(["첫 입력","첫 출력","두 번째 입력","두 번째 출력"]);
  });

  it("keeps Grok input and output cards when a noisy latest turn exceeds the thread limit",()=>{
    const task=(id:string,prompt:string,createdAt:string)=>({id,provider:"grok",nativeId:id,threadId:"shared-session",projectId:"project",title:"session",prompt,status:"completed",createdAt,updatedAt:createdAt,result:null,error:null,log:"",owned:true,pid:null,pgid:null,processStart:null,commandMarker:null,parentThreadId:null,metadata:{}} as any);
    const first=task("grok:one","첫 입력","2026-08-04T01:00:00.000Z"),second=task("grok:two","두 번째 입력","2026-08-04T02:00:00.000Z");
    const noise=Array.from({length:1_600},(_,index)=>({type:"tool_progress",content:`progress ${index}`,taskId:second.id,eventId:`two:${index}`} as any));
    const events=providerThreadEvents([
      {task:first,events:[{type:"message_completed",content:"첫 출력",taskId:first.id,itemId:"first-output"} as any]},
      {task:second,events:[...noise,{type:"message_completed",content:"두 번째 출력",taskId:second.id,itemId:"second-output"} as any]},
    ]);
    expect(events).toHaveLength(1_500);
    expect(events.filter(event=>event.type==="message"||event.type==="message_completed").map(event=>event.content)).toEqual(["첫 입력","첫 출력","두 번째 입력","두 번째 출력"]);
  });

  it("does not duplicate a provider prompt already present in a task stream",()=>{
    const task={id:"deepseek:one",provider:"deepseek",nativeId:"one",threadId:"session",projectId:"project",title:"session",prompt:"입력",status:"completed",createdAt:"2026-08-04T01:00:00.000Z",updatedAt:"2026-08-04T01:01:00.000Z",result:null,error:null,log:"",owned:true,pid:null,pgid:null,processStart:null,commandMarker:null,parentThreadId:null,metadata:{}} as any;
    const events=providerThreadEvents([{task,events:[{type:"message",content:"입력",metadata:{role:"user"}},{type:"message_completed",content:"출력"}] as any[]}]);
    expect(events.map(event=>event.content)).toEqual(["입력","출력"]);
  });

  it("synthesizes compatible-provider prompts in the optimistic client shape",()=>{
    const task={id:"ollama:one",provider:"ollama",nativeId:"one",threadId:"session",projectId:"project",title:"session",prompt:"후속 입력",status:"running",createdAt:"2026-08-04T01:00:00.000Z",updatedAt:"2026-08-04T01:01:00.000Z",result:null,error:null,log:"",owned:true,pid:null,pgid:null,processStart:null,commandMarker:null,parentThreadId:null,metadata:{}} as any;
    const [prompt]=providerThreadEvents([{task,events:[{type:"task_started",content:"started"}] as any[]}]);
    expect(prompt).toMatchObject({type:"message",content:"후속 입력",taskId:task.id,metadata:{role:"user",sourceTaskId:task.id}});
    expect(prompt).not.toHaveProperty("threadId");
    expect(prompt.metadata).not.toHaveProperty("section");
  });

  it("normalizes Codex image items into bounded task-relative preview metadata",()=>{
    const events=codexTurnEvents([{id:"turn",status:"completed",items:[
      {type:"imageView",id:"view",path:"/workspace/docs/preview.png"},
      {type:"imageGeneration",id:"generated",savedPath:"/workspace/out/generated.jpg",status:"completed"},
      {type:"imageView",id:"outside",path:"/private/secret.png"}
    ]}],"/workspace");
    expect(events.slice(0,2)).toMatchObject([
      {type:"tool_completed",metadata:{itemType:"imageView",mediaKind:"image",mediaPath:"docs/preview.png",mediaPathBase:"task-cwd"}},
      {type:"tool_completed",metadata:{itemType:"imageGeneration",mediaKind:"image",mediaPath:"out/generated.jpg",mediaPathBase:"task-cwd"}}
    ]);
    expect(events[2].metadata).not.toHaveProperty("mediaPath");
  });

  it("restores replay-only file changes when a completed transcript omits them",()=>{
    const history=[
      normalizeAgentEvent({type:"message",content:"request",metadata:{role:"user"}},"codex"),
      normalizeAgentEvent({type:"file_change_started",content:"+a",metadata:{path:"src/a.ts",pathBase:"task-cwd",additions:1,deletions:0}},"codex"),
      normalizeAgentEvent({type:"message_completed",content:"done",metadata:{role:"agent",phase:"final_answer"}},"codex")
    ];
    const replay=[
      normalizeAgentEvent({type:"file_change_started",content:"+a",metadata:{path:"src/a.ts",pathBase:"task-cwd",additions:1,deletions:0}},"codex"),
      normalizeAgentEvent({type:"command_completed",content:"ignored"},"codex"),
      normalizeAgentEvent({type:"file_change_started",content:"+b",metadata:{path:"src/b.ts",pathBase:"task-cwd",additions:2,deletions:0}},"codex")
    ];
    const merged=mergeHistoricalFileChanges(history,replay);
    expect(merged.map(event=>event.metadata?.path??event.content)).toEqual(["request","src/a.ts","src/b.ts","done"]);
    expect(merged.filter(event=>event.metadata?.path==="src/a.ts")).toHaveLength(1);
  });

  it("restores image output metadata when completed Codex history drops the preview path",()=>{
    const history=[
      normalizeAgentEvent({type:"message",content:"request",metadata:{role:"user",turnId:"turn",itemId:"user"}},"codex"),
      normalizeAgentEvent({type:"tool_completed",content:"imageView",metadata:{itemType:"imageView",turnId:"turn",itemId:"image"}},"codex"),
      normalizeAgentEvent({type:"message_completed",content:"done",metadata:{role:"agent",phase:"final_answer",turnId:"turn",itemId:"answer"}},"codex")
    ];
    const replay=[{type:"tool_completed",content:"imageView",taskId:"codex:one",threadId:"thread",turnId:"turn",itemId:"image",metadata:{itemType:"imageView",mediaKind:"image",mediaPath:"docs/preview.png",mediaPathBase:"task-cwd"}}] as AgentEvent[];

    const merged=mergeHistoricalFileChanges(history,replay);

    expect(merged).toHaveLength(3);
    expect(merged[1]).toMatchObject({type:"tool_completed",metadata:{itemId:"image",mediaKind:"image",mediaPath:"docs/preview.png",mediaPathBase:"task-cwd"}});
  });

  it("inserts a replay-only image before the final answer from its turn",()=>{
    const history=[
      normalizeAgentEvent({type:"message",content:"request",metadata:{role:"user",turnId:"turn",itemId:"user"}},"codex"),
      normalizeAgentEvent({type:"message_completed",content:"done",metadata:{role:"agent",phase:"final_answer",turnId:"turn",itemId:"answer"}},"codex")
    ];
    const image={type:"tool_completed",content:"imageView",threadId:"thread",turnId:"turn",itemId:"image",metadata:{itemType:"imageView",mediaKind:"image",mediaPath:"docs/preview.png",mediaPathBase:"task-cwd"}} as AgentEvent;

    expect(mergeHistoricalFileChanges(history,[image]).map(event=>event.metadata?.itemId??event.itemId)).toEqual(["user","image","answer"]);
  });

  it("keeps an interrupted turn image inside that turn instead of moving it to a later answer",()=>{
    const history=[
      normalizeAgentEvent({type:"message",content:"first",metadata:{role:"user",turnId:"turn-1",itemId:"user-1"}},"codex"),
      normalizeAgentEvent({type:"tool_completed",content:"command",metadata:{turnId:"turn-1",itemId:"command"}},"codex"),
      normalizeAgentEvent({type:"message",content:"second",metadata:{role:"user",turnId:"turn-2",itemId:"user-2"}},"codex"),
      normalizeAgentEvent({type:"message_completed",content:"done",metadata:{role:"agent",phase:"final_answer",turnId:"turn-2",itemId:"answer-2"}},"codex")
    ];
    const image={type:"tool_completed",content:"imageView",taskId:"codex:one",threadId:"thread",turnId:"turn-1",itemId:"image-1",metadata:{itemType:"imageView",mediaKind:"image",mediaPath:"docs/preview.png",mediaPathBase:"task-cwd"}} as AgentEvent;
    expect(mergeHistoricalFileChanges(history,[image]).map(event=>event.metadata?.itemId??event.itemId)).toEqual(["user-1","command","image-1","user-2","answer-2"]);
  });

  it("keeps an image in its turn when the turn's agent message has no phase",()=>{
    const history=[
      normalizeAgentEvent({type:"message",content:"first",metadata:{role:"user",turnId:"turn-1",itemId:"user-1"}},"codex"),
      normalizeAgentEvent({type:"message_completed",content:"partial",metadata:{role:"agent",turnId:"turn-1",itemId:"answer-1"}},"codex"),
      normalizeAgentEvent({type:"message",content:"second",metadata:{role:"user",turnId:"turn-2",itemId:"user-2"}},"codex")
    ];
    const image={type:"tool_completed",content:"imageView",taskId:"codex:one",threadId:"thread",turnId:"turn-1",itemId:"image-1",metadata:{itemType:"imageView",mediaKind:"image",mediaPath:"docs/preview.png",mediaPathBase:"task-cwd"}} as AgentEvent;
    expect(mergeHistoricalFileChanges(history,[image]).map(event=>event.metadata?.itemId??event.itemId)).toEqual(["user-1","answer-1","image-1","user-2"]);
  });

  it("does not magnet an old durable image onto the newest answer when its turn is outside the bounded history page",()=>{
    const history=[
      {...normalizeAgentEvent({type:"message",content:"latest request",metadata:{role:"user",turnId:"turn-latest",itemId:"user-latest"}},"codex"),taskId:"codex:latest"},
      normalizeAgentEvent({type:"message_completed",content:"latest answer",metadata:{role:"agent",phase:"final_answer",turnId:"turn-latest",itemId:"answer-latest"}},"codex")
    ];
    const oldImage={type:"tool_completed",content:"imageView",timestamp:"2026-08-01T00:00:00.000Z",metadata:{itemType:"imageView",turnId:"turn-old",itemId:"image-old",mediaKind:"image",mediaPath:"out/old.png",mediaPathBase:"task-cwd",sourceTaskId:"codex:old",durableImageOutput:true}} as AgentEvent;
    expect(mergeHistoricalFileChanges(history,[oldImage]).map(event=>event.metadata?.itemId)).toEqual(["user-latest","answer-latest"]);
  });

  it("places an identity-less legacy image by timestamp instead of attaching it to the newest answer",()=>{
    const history=[
      normalizeAgentEvent({type:"message",content:"first",timestamp:"2026-08-01T00:00:02.000Z",metadata:{role:"user"}},"codex"),
      normalizeAgentEvent({type:"message_completed",content:"latest",timestamp:"2026-08-01T00:00:04.000Z",metadata:{role:"agent",phase:"final_answer"}},"codex")
    ];
    const image={type:"tool_completed",content:"imageView",timestamp:"2026-08-01T00:00:01.000Z",metadata:{itemType:"imageView",mediaKind:"image",mediaPath:"out/legacy.png",mediaPathBase:"workspace"}} as AgentEvent;
    expect(mergeHistoricalFileChanges(history,[image]).map(event=>event.metadata?.mediaPath??event.content)).toEqual(["out/legacy.png","first","latest"]);
  });

  it("keeps a current task image before that task's answer when native turn identity is unavailable",()=>{
    const history=[
      {...normalizeAgentEvent({type:"message",content:"current request",metadata:{role:"user"}},"codex"),taskId:"codex:current"},
      normalizeAgentEvent({type:"message_completed",content:"current answer",metadata:{role:"agent",phase:"final_answer"}},"codex")
    ];
    const image={type:"tool_completed",content:"imageView",metadata:{itemType:"imageView",itemId:"current-image",mediaKind:"image",mediaPath:"out/current.png",mediaPathBase:"task-cwd",sourceTaskId:"codex:current",durableImageOutput:true}} as AgentEvent;
    expect(mergeHistoricalFileChanges(history,[image]).map(event=>event.metadata?.mediaPath??event.content)).toEqual(["current request","out/current.png","current answer"]);
  });

  it("deduplicates id-less replay images and does not overwrite unrelated history metadata",()=>{
    const history=[
      normalizeAgentEvent({type:"tool_completed",content:"imageView",metadata:{itemType:"imageView",nativeStatus:"completed",turnId:"turn",mediaKind:"image",mediaPath:"docs/preview.png",mediaPathBase:"task-cwd",sourceTaskId:"codex:one"}},"codex"),
      normalizeAgentEvent({type:"message_completed",content:"done",metadata:{role:"agent",phase:"final_answer",turnId:"turn"}},"codex")
    ];
    const image={type:"tool_completed",content:"imageView",taskId:"codex:one",turnId:"turn",itemId:null,metadata:{itemType:"imageGeneration",nativeStatus:"other",prompt:"do not copy",mediaKind:"image",mediaPath:"docs/preview.png",mediaPathBase:"task-cwd"}} as AgentEvent;
    const merged=mergeHistoricalFileChanges(history,[image,image]);
    expect(merged).toHaveLength(2);
    expect(merged[0]?.metadata).toMatchObject({itemType:"imageView",nativeStatus:"completed"});
    expect(merged[0]?.metadata).not.toHaveProperty("prompt");
  });

  it("renders one image when a turn views the same path under different item ids",()=>{
    const history=[
      normalizeAgentEvent({type:"message",content:"request",metadata:{role:"user",turnId:"turn",itemId:"user"}},"codex"),
      normalizeAgentEvent({type:"tool_completed",content:"imageView",metadata:{itemType:"imageView",turnId:"turn",itemId:"view-1",mediaKind:"image",mediaPath:"docs/preview.png",mediaPathBase:"task-cwd"}},"codex"),
      normalizeAgentEvent({type:"tool_completed",content:"imageView",metadata:{itemType:"imageView",turnId:"turn",itemId:"view-2",mediaKind:"image",mediaPath:"docs/preview.png",mediaPathBase:"task-cwd"}},"codex"),
      normalizeAgentEvent({type:"message_completed",content:"done",metadata:{role:"agent",phase:"final_answer",turnId:"turn",itemId:"answer"}},"codex")
    ];
    const merged=mergeHistoricalFileChanges(history,[]);
    expect(merged.filter(event=>event.metadata?.mediaKind==="image")).toHaveLength(1);
  });

  it("returns unchanged Claude history by reference when replay has no supplements",()=>{
    const history=[
      normalizeAgentEvent({type:"message",content:"request",metadata:{role:"user"}},"claude"),
      normalizeAgentEvent({type:"message_completed",content:"done",metadata:{role:"agent"}},"claude")
    ];
    const replay=[normalizeAgentEvent({type:"command_completed",content:"ignored"},"claude")];
    expect(mergeHistoricalFileChanges(history,replay)).toBe(history);
  });

  it("restores a replay-only compaction at its timestamp instead of the history tail",()=>{
    const history=[
      normalizeAgentEvent({type:"message",content:"before",timestamp:"2026-07-28T00:00:01.000Z",metadata:{role:"user"}},"claude"),
      normalizeAgentEvent({type:"message_completed",content:"after",timestamp:"2026-07-28T00:00:03.000Z",metadata:{role:"agent"}},"claude")
    ];
    const replay=[{type:"context_compaction",content:"Context compacted.",timestamp:"2026-07-28T00:00:02.000Z",threadId:"thread",itemId:"boundary",metadata:{trigger:"auto"}}] as any[];
    expect(mergeHistoricalFileChanges(history,replay).map(event=>event.type)).toEqual(["message","context_compaction","message_completed"]);
  });

  it("preserves replay usage metadata for a completed transcript without duplicating its messages",()=>{
    const history=[
      normalizeAgentEvent({type:"message",content:"request",metadata:{role:"user"}},"claude"),
      normalizeAgentEvent({type:"message_completed",content:"final answer",metadata:{role:"agent"}},"claude")
    ];
    const replay=[
      {type:"message_completed",content:"final answer",threadId:"claude-session",metadata:{outputUsage:{outputTokens:1,updatedAt:"2026-07-31T01:00:00.000Z"}}},
      {type:"unknown",content:"Claude context usage updated.",threadId:"claude-session",metadata:{nativeMethod:"claude/contextUsage/updated",outputUsage:{outputTokens:1,reasoningTokens:null,updatedAt:"2026-07-31T01:00:00.000Z"}}},
      {type:"unknown",content:"Claude output usage updated.",threadId:"claude-session",metadata:{nativeMethod:"claude/outputUsage/updated",outputUsage:{outputTokens:984,reasoningTokens:null,updatedAt:"2026-07-31T01:00:00.100Z"}}}
    ] as AgentEvent[];
    const merged=mergeHistoricalFileChanges(history,replay);

    expect(merged.filter(event=>event.type==="message_completed")).toHaveLength(1);
    expect(merged.slice(2).map(event=>event.metadata?.outputUsage)).toEqual([
      {outputTokens:1,reasoningTokens:null,updatedAt:"2026-07-31T01:00:00.000Z"},
      {outputTokens:984,reasoningTokens:null,updatedAt:"2026-07-31T01:00:00.100Z"}
    ]);
  });

  it("does not duplicate completed transcript usage when replay supplements are merged again",()=>{
    const history=[normalizeAgentEvent({type:"message_completed",content:"done"},"codex")];
    const usage={type:"unknown",content:"Codex usage updated.",threadId:"thread",metadata:{nativeMethod:"thread/tokenUsage/updated",outputUsage:{outputTokens:42,reasoningTokens:3,updatedAt:"now"}}} as AgentEvent;
    const once=mergeHistoricalFileChanges(history,[usage]);

    expect(mergeHistoricalFileChanges(once,[usage])).toEqual(once);
  });

  it("preserves Codex parallel-agent identities in historical turns",()=>{
    const events=codexTurnEvents([{id:"turn",status:"completed",items:[
      {type:"collabAgentToolCall",id:"collab",tool:"spawn",status:"completed",receiverThreadIds:["agent-a"],prompt:"inspect tests",agentsStates:{"agent-a":{status:"completed"}}},
      {type:"subAgentActivity",id:"activity",kind:"message",agentThreadId:"agent-a",agentPath:"workers/tests"}
    ]}]);
    expect(events.map(event=>event.type)).toEqual(["agent_completed","agent_progress"]);
    expect(events[0].metadata?.receiverThreadIds).toEqual(["agent-a"]);
    expect(events[1].metadata?.agentThreadId).toBe("agent-a");
  });

  it("keeps subagent completion non-terminal and reserves terminal for the parent",()=>{
    expect(turnLifecycleEvent("parent","child","completed")).toEqual({type:"agent_completed",terminal:false,isRoot:false});
    expect(turnLifecycleEvent("parent","child","failed")).toEqual({type:"agent_failed",terminal:false,isRoot:false});
    expect(turnLifecycleEvent("parent","parent","completed")).toEqual({type:"task_completed",terminal:true,isRoot:true});
  });

  it("routes ordinary parallel requests to native collaboration",()=>{
    expect(CLAUDEX_WORKHOUSE_NATIVE_COLLABORATION_INSTRUCTIONS).toContain("native Codex multi-agent");
    expect(CLAUDEX_WORKHOUSE_NATIVE_COLLABORATION_INSTRUCTIONS).toContain("Do not run /usr/local/bin/cx");
    expect(CLAUDEX_WORKHOUSE_NATIVE_COLLABORATION_INSTRUCTIONS).toContain("synthesize one parent-thread result");
    expect(CLAUDEX_WORKHOUSE_NATIVE_COLLABORATION_INSTRUCTIONS).toContain("Before the first blocking wait");
    expect(CLAUDEX_WORKHOUSE_NATIVE_COLLABORATION_INSTRUCTIONS).toContain("Never relay raw subagent output");
  });

  it("requires Claude-compatible parents to reconcile native subagents before finishing",()=>{
    const instructions=delegationDeveloperInstructions(DEFAULT_DELEGATION_SETTINGS,"claude");
    expect(instructions).toContain("wait for every requested agent to reach a terminal state");
    expect(instructions).toContain("Do not describe a failed or completed agent as still running");
    expect(instructions).toContain("do not claim findings from an agent whose result was unavailable");
  });

  it("preserves an explicitly requested Claude Code reviewer instead of substituting Codex",()=>{
    expect(CLAUDEX_WORKHOUSE_NATIVE_COLLABORATION_INSTRUCTIONS).toContain("Provider identity has priority");
    expect(CLAUDEX_WORKHOUSE_NATIVE_COLLABORATION_INSTRUCTIONS).toContain("클코드에게 검토");
    expect(CLAUDEX_WORKHOUSE_NATIVE_COLLABORATION_INSTRUCTIONS).toContain("do not substitute Codex subagents");
  });

  it("applies provider-specific managed or direct delegation defaults without overriding explicit requests",()=>{
    const managed=claudexWorkhouseCollaborationInstructions(DEFAULT_DELEGATION_SETTINGS);
    expect(managed).toContain("tracked, persistent Claudex Workhouse/background session");
    const directSettings={...DEFAULT_DELEGATION_SETTINGS,version:3 as const,claude:{launchMode:"direct" as const,model:"claude-opus-4-8",reasoningEffort:"max" as const},codex:{launchMode:"direct" as const,model:"gpt-5.4",reasoningEffort:"high",serviceTier:"priority" as const}};
    const direct=delegationDeveloperInstructions(directSettings,"claude");
    expect(direct).toContain("direct one-shot CLI process");
    expect(direct).toContain("explicit request for a managed/tracked/background session or a direct/one-shot/temporary CLI always overrides");
    expect(direct).toContain('["claude","-p","--no-session-persistence","--model","claude-opus-4-8","--effort","max","--","<prompt>"]');
    expect(direct).toContain('["codex","exec","--ephemeral","--model","gpt-5.4","-c","model_reasoning_effort=\\"high\\"","-c","service_tier=\\"priority\\"","--","<prompt>"]');
    expect(direct).toContain("execute the array directly");
    expect(normalizeDelegationSettings({codex:"direct",claude:"managed"})).toEqual({...DEFAULT_DELEGATION_SETTINGS,codex:{...DEFAULT_DELEGATION_SETTINGS.codex,launchMode:"direct"}});
  });

  it("falls back retired delegation selections and rejects unsupported Codex combinations",()=>{
    const models=[{id:"gpt-current",isDefault:true,defaultReasoningEffort:"medium",supportedReasoningEfforts:[{reasoningEffort:"low"},{reasoningEffort:"medium"}],serviceTiers:[{id:"priority"}]}];
    expect(normalizeDelegationSettings({version:2,claude:{launchMode:"managed",model:"retired",reasoningEffort:"extreme"},codex:{launchMode:"managed",model:null,reasoningEffort:null,serviceTier:null}}).claude).toEqual(DEFAULT_DELEGATION_SETTINGS.claude);
    expect(normalizeDelegationSettings({version:2,claude:DEFAULT_DELEGATION_SETTINGS.claude,codex:{launchMode:"managed",model:null,reasoningEffort:"high'; rm -rf",serviceTier:null}}).codex.reasoningEffort).toBeNull();
    const invalid={...DEFAULT_DELEGATION_SETTINGS,codex:{launchMode:"managed" as const,model:"gpt-current",reasoningEffort:"high",serviceTier:null}};
    expect(()=>validateDelegationSettings(invalid,models)).toThrow(/Reasoning effort/);
    expect(validateDelegationSettings(invalid,models,true).codex.reasoningEffort).toBeNull();
  });

  it("reads only a bounded tail of a large Claude transcript and caches unchanged results",()=>{
    const root=fs.mkdtempSync("/tmp/claudex-workhouse-claude-tail-"),file=`${root}/session.jsonl`,old=JSON.stringify({type:"assistant",message:{content:[{type:"text",text:"old"}]}}),latest=JSON.stringify({type:"assistant",message:{content:[{type:"text",text:"latest"}]}});
    fs.writeFileSync(file,`${old}\n${"x".repeat(CLAUDE_TRANSCRIPT_TAIL_BYTES+1024)}\n${latest}\n`);
    const reads=vi.spyOn(fs,"readSync"),result=claudeTranscriptEvents(file,root),firstReads=reads.mock.calls.length;
    expect(result.events.at(-1)?.content).toBe("latest");expect(reads.mock.calls.some(call=>Number(call[3])>CLAUDE_TRANSCRIPT_TAIL_BYTES)).toBe(false);
    expect(claudeTranscriptEvents(file,root)).toEqual(result);expect(reads.mock.calls.length).toBe(firstReads);
    reads.mockRestore();fs.rmSync(root,{recursive:true,force:true});
  });

  it("keeps the latest twelve complete user turns when a transcript contains a one-megabyte line",()=>{
    const root=fs.mkdtempSync("/tmp/claudex-workhouse-claude-turns-"),file=`${root}/session.jsonl`,rows:string[]=[];
    for(let turn=1;turn<=14;turn++){
      rows.push(JSON.stringify({type:"user",message:{content:`request ${turn}`}}));
      rows.push(JSON.stringify({type:"assistant",message:{content:[{type:"tool_use",id:`tool-${turn}`,name:"Read",input:{file_path:turn===7?"x".repeat(1024*1024):`file-${turn}`}}]}}));
      rows.push(JSON.stringify({type:"assistant",message:{id:`answer-${turn}`,content:[{type:"text",text:`answer ${turn}`}]}}));
    }
    fs.writeFileSync(file,rows.join("\n"));
    const result=claudeTranscriptEvents(file,root),requests=result.events.filter(event=>event.type==="message"&&event.metadata?.role==="user");
    expect(requests).toHaveLength(12);expect(requests[0]?.content).toBe("request 3");expect(requests.at(-1)?.content).toBe("request 14");expect(result.truncated).toMatchObject({before:true,droppedTurns:2});
    const expanded=claudeTranscriptEvents(file,root,{turns:24}),expandedRequests=expanded.events.filter(event=>event.type==="message"&&event.metadata?.role==="user");
    expect(expandedRequests).toHaveLength(14);expect(expandedRequests[0]?.content).toBe("request 1");expect(expanded.truncated).toBeUndefined();
    fs.rmSync(root,{recursive:true,force:true});
  });

  it("reports the exact number of turns removed by the maximum-turn bound",()=>{
    const root=fs.mkdtempSync("/tmp/claudex-workhouse-claude-max-turns-"),file=`${root}/session.jsonl`,rows:string[]=[];
    for(let turn=1;turn<=26;turn++){rows.push(JSON.stringify({type:"user",message:{content:`request ${turn}`}}));rows.push(JSON.stringify({type:"assistant",message:{id:`answer-${turn}`,content:[{type:"text",text:`answer ${turn}`}]}}));}
    fs.writeFileSync(file,rows.join("\n"));const result=claudeTranscriptEvents(file,root,{turns:24}),requests=result.events.filter(event=>event.type==="message"&&event.metadata?.role==="user");
    expect(requests).toHaveLength(24);expect(requests[0]?.content).toBe("request 3");expect(result.truncated).toMatchObject({before:true,droppedTurns:2});
    fs.rmSync(root,{recursive:true,force:true});
  });

  it("applies the event cap at a user-turn boundary when one JSONL row emits many events",()=>{
    const root=fs.mkdtempSync("/tmp/claudex-workhouse-claude-event-cap-"),file=`${root}/session.jsonl`,rows:string[]=[];
    for(let turn=1;turn<=12;turn++){
      rows.push(JSON.stringify({type:"user",message:{content:`request ${turn}`}}));
      rows.push(JSON.stringify({type:"assistant",message:{content:turn===1
        ?Array.from({length:1_501},(_,index)=>({type:"tool_use",id:`tool-${index}`,name:"Read",input:{file_path:`file-${index}`}}))
        :[{type:"text",text:`answer ${turn}`}]}}));
    }
    fs.writeFileSync(file,rows.join("\n"));const result=claudeTranscriptEvents(file,root),requests=result.events.filter(event=>event.type==="message"&&event.metadata?.role==="user");
    expect(requests).toHaveLength(11);expect(requests[0]?.content).toBe("request 2");expect(result.events[0]?.content).toBe("request 2");expect(result.truncated).toMatchObject({before:true,droppedTurns:1});
    fs.rmSync(root,{recursive:true,force:true});
  });

  it("does not count or render Claude internal meta injections as user turns",()=>{
    const root=fs.mkdtempSync("/tmp/claudex-workhouse-claude-meta-"),file=`${root}/session.jsonl`,rows:string[]=[];
    rows.push(JSON.stringify({type:"user",isMeta:true,message:{content:"Continue from where you left off."}}));
    for(let turn=1;turn<=12;turn++){rows.push(JSON.stringify({type:"user",message:{content:`request ${turn}`}}));rows.push(JSON.stringify({type:"assistant",message:{content:[{type:"text",text:`answer ${turn}`}]}}));}
    fs.writeFileSync(file,rows.join("\n"));const result=claudeTranscriptEvents(file,root),requests=result.events.filter(event=>event.type==="message"&&event.metadata?.role==="user");
    expect(requests.map(event=>event.content)).toEqual(Array.from({length:12},(_,index)=>`request ${index+1}`));expect(result.turns).toBe(12);expect(result.truncated).toBeUndefined();
    fs.rmSync(root,{recursive:true,force:true});
  });

  it("preserves small transcript ordering without reporting truncation",()=>{
    const root=fs.mkdtempSync("/tmp/claudex-workhouse-claude-small-"),file=`${root}/session.jsonl`;
    fs.writeFileSync(file,[
      JSON.stringify({type:"user",message:{content:"request"}}),
      JSON.stringify({type:"assistant",message:{content:[{type:"tool_use",id:"read",name:"Read",input:{file_path:"a.ts"}}]}}),
      JSON.stringify({type:"assistant",message:{id:"answer",content:[{type:"text",text:"answer"}]}})
    ].join("\n"));
    const result=claudeTranscriptEvents(file,root);
    expect(result.truncated).toBeUndefined();expect(result.events.map(event=>event.type)).toEqual(["message","tool_started","message_completed"]);
    fs.rmSync(root,{recursive:true,force:true});
  });

  it("truncates oversized tool results with byte metadata but preserves assistant text",()=>{
    const root=fs.mkdtempSync("/tmp/claudex-workhouse-claude-content-"),file=`${root}/session.jsonl`,largeTool="도구".repeat(40_000),largeAnswer="답변".repeat(40_000);
    fs.writeFileSync(file,[
      JSON.stringify({type:"user",message:{content:"request"}}),
      JSON.stringify({type:"assistant",message:{content:[{type:"tool_use",id:"bash",name:"Bash",input:{command:"run"}}]}}),
      JSON.stringify({type:"user",message:{content:[{type:"tool_result",tool_use_id:"bash",content:largeTool}]}}),
      JSON.stringify({type:"assistant",message:{id:"answer",content:[{type:"text",text:largeAnswer}]}})
    ].join("\n"));
    const result=claudeTranscriptEvents(file,root),tool=result.events.find(event=>event.type==="command_completed"),answer=result.events.find(event=>event.type==="message_completed");
    expect(Buffer.byteLength(tool.content,"utf8")).toBeLessThanOrEqual(CLAUDE_TRANSCRIPT_EVENT_CONTENT_BYTES);expect(tool.metadata.truncatedBytes).toBe(Buffer.byteLength(largeTool,"utf8")-Buffer.byteLength(tool.content,"utf8"));
    expect(answer.content).toBe(largeAnswer);expect(answer.metadata.truncatedBytes).toBeUndefined();
    fs.rmSync(root,{recursive:true,force:true});
  });

  it("keeps Claude transcript timestamps and merges a long active thread without duplicating the current turn",()=>{
    const root=fs.mkdtempSync("/tmp/claudex-workhouse-claude-active-"),file=`${root}/session.jsonl`;
    fs.writeFileSync(file,[
      JSON.stringify({type:"user",timestamp:"2026-07-26T05:00:00.000Z",message:{content:"previous request"}}),
      JSON.stringify({type:"assistant",timestamp:"2026-07-26T05:01:00.000Z",message:{content:[{type:"text",text:"previous answer"}]}}),
      JSON.stringify({type:"user",timestamp:"2026-07-26T06:00:01.000Z",message:{content:"current request"}}),
      JSON.stringify({type:"assistant",timestamp:"2026-07-26T06:00:02.000Z",message:{content:[{type:"text",text:"transcript copy of live output"}]}})
    ].join("\n"));
    const transcript=claudeTranscriptEvents(file,root).events.map(event=>normalizeAgentEvent(event,"claude"));
    expect(transcript.map(event=>event.timestamp)).toEqual(["2026-07-26T05:00:00.000Z","2026-07-26T05:01:00.000Z","2026-07-26T06:00:01.000Z","2026-07-26T06:00:02.000Z"]);
    const replay=[normalizeAgentEvent({type:"message_completed",content:"live output",timestamp:"2026-07-26T06:00:02.000Z"},"claude")];
    const merged=mergeActiveClaudeThreadEvents(transcript,replay,{id:"claude:current",prompt:"current request",createdAt:"2026-07-26T06:00:00.000Z",status:"running"});
    expect(merged.map(event=>event.content)).toEqual(["previous request","previous answer","current request","live output"]);
    // The request row names its task so the browser's optimistic copy of the
    // same prompt is recognised as the same row instead of a second card.
    expect(merged.find(event=>event.content==="current request")?.taskId).toBe("claude:current");
    const completed=withTaskRequestIdentity(transcript,replay,{id:"claude:current",prompt:"current request",createdAt:"2026-07-26T06:00:00.000Z"});
    expect(completed.find(event=>event.content==="current request")).toMatchObject({timestamp:"2026-07-26T06:00:01.000Z",taskId:"claude:current"});
    fs.rmSync(root,{recursive:true,force:true});
  });

  it("identifies the current repeated Codex request from its replay turn",()=>{
    const history=[
      normalizeAgentEvent({type:"message",content:"계속",metadata:{role:"user",turnId:"turn-1"}},"codex"),
      normalizeAgentEvent({type:"message",content:"계속",metadata:{role:"user",turnId:"turn-2"}},"codex")
    ];
    const replay=[normalizeAgentEvent({type:"turn_started",content:"started",metadata:{turnId:"turn-2"}},"codex")];
    const identified=withTaskRequestIdentity(history,replay,{id:"codex:current",prompt:"계속",createdAt:"2026-07-26T06:00:00.000Z"});
    expect((identified[0] as any).taskId).toBeUndefined();
    expect((identified[1] as any).taskId).toBe("codex:current");
  });

  it("assigns matching per-message ordinals to Claude transcript text blocks",()=>{
    const root=fs.mkdtempSync("/tmp/claudex-workhouse-claude-blocks-"),file=`${root}/session-blocks.jsonl`;
    fs.writeFileSync(file,[
      JSON.stringify({type:"assistant",message:{id:"msg_blocks",content:[{type:"text",text:"first"}]}}),
      JSON.stringify({type:"assistant",message:{id:"msg_blocks",content:[{type:"tool_use",id:"tool",name:"Read",input:{file_path:"a"}}]}}),
      JSON.stringify({type:"assistant",message:{id:"msg_blocks",content:[{type:"text",text:"second"}]}})
    ].join("\n"));
    const messages=claudeTranscriptEvents(file,root).events.filter(event=>event.type==="message_completed");
    expect(messages).toMatchObject([
      {content:"first",itemId:"msg_blocks:0",metadata:{itemId:"msg_blocks:0",threadId:"session-blocks"}},
      {content:"second",itemId:"msg_blocks:1",metadata:{itemId:"msg_blocks:1",threadId:"session-blocks"}}
    ]);
    fs.rmSync(root,{recursive:true,force:true});
  });

  it("maps Claude Bash tool results to provider-backed command completion events",()=>{
    const root=fs.mkdtempSync("/tmp/claudex-workhouse-claude-command-"),file=`${root}/session-command.jsonl`;
    fs.writeFileSync(file,[
      JSON.stringify({type:"assistant",timestamp:"2026-07-26T07:00:00.000Z",message:{content:[{type:"tool_use",id:"bash-ok",name:"Bash",input:{command:"pnpm test"}}]}}),
      JSON.stringify({type:"user",timestamp:"2026-07-26T07:00:01.000Z",message:{content:[{type:"tool_result",tool_use_id:"bash-ok",content:"12 passed",is_error:false}]}}),
      JSON.stringify({type:"assistant",timestamp:"2026-07-26T07:00:02.000Z",message:{content:[{type:"tool_use",id:"bash-fail",name:"Bash",input:{command:"pnpm lint"}}]}}),
      JSON.stringify({type:"user",timestamp:"2026-07-26T07:00:03.000Z",message:{content:[{type:"tool_result",tool_use_id:"bash-fail",content:"failed",is_error:true}]}})
    ].join("\n"));
    expect(claudeTranscriptEvents(file,root).events.filter(event=>event.type==="command_completed")).toMatchObject([
      {content:"12 passed",status:"completed",itemId:"bash-ok",metadata:{command:"pnpm test",ok:true,source:"provider"}},
      {content:"failed",status:"failed",itemId:"bash-fail",metadata:{command:"pnpm lint",ok:false,source:"provider"}}
    ]);
    fs.rmSync(root,{recursive:true,force:true});
  });


  it("keeps Codex token usage in collaboration run events even though it rides an unknown notification",()=>{
    const usage={totalTokens:2048,inputTokens:1968,cachedInputTokens:900,cacheWriteInputTokens:40,outputTokens:80,reasoningTokens:32,updatedAt:"2026-07-31T00:00:00.000Z"};
    const events=[
      {type:"message_completed",content:"answer",metadata:{}},
      {type:"unknown",content:"Codex context usage updated.",metadata:{nativeMethod:"thread/tokenUsage/updated",outputUsage:usage,contextUsage:{usedTokens:1000,windowTokens:2000,percent:50}}},
      {type:"unknown",content:"Codex notification: session/configured",metadata:{nativeMethod:"session/configured",payload:{apiKey:"private"}}},
      {type:"tool_progress",content:"thinking",metadata:{deltaType:"thinking_delta"}},
      {type:"message_delta",content:"reasoning trace",metadata:{phase:"reasoning"}}
    ];
    const kept=collaborationPublicEvents(events);
    expect(kept.map(event=>event.type)).toEqual(["message_completed","unknown"]);
    expect(kept[1].metadata.outputUsage).toEqual(usage);
  });

  it("preserves Claude compact boundaries between surrounding transcript events",()=>{
    const root=fs.mkdtempSync("/tmp/claudex-workhouse-claude-compact-"),file=`${root}/session-id.jsonl`;
    fs.writeFileSync(file,[
      JSON.stringify({type:"user",timestamp:"2026-07-28T00:00:01.000Z",message:{content:"before"}}),
      JSON.stringify({type:"system",subtype:"compact_boundary",uuid:"compact-1",timestamp:"2026-07-28T00:00:02.000Z",compactMetadata:{trigger:"auto",preTokens:9876}}),
      JSON.stringify({type:"assistant",timestamp:"2026-07-28T00:00:03.000Z",message:{content:[{type:"text",text:"after"}]}})
    ].join("\n"));
    const events=claudeTranscriptEvents(file,root).events;
    expect(events.map(event=>event.type)).toEqual(["message","context_compaction","message_completed"]);
    expect(events[1]).toMatchObject({
      timestamp:"2026-07-28T00:00:02.000Z",
      itemId:"compact-1",
      metadata:{threadId:"session-id",itemId:"compact-1",trigger:"auto",preTokens:9876}
    });
    fs.rmSync(root,{recursive:true,force:true});
  });
});
