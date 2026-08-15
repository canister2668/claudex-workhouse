import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../../src/web/events.js";
import { deriveTaskLiveness } from "../../src/web/liveness.js";
import { mergeLiveEvents, mergeTerminalSnapshot } from "../../src/web/live-events.js";
import {
  PROGRESS_QUIET_MS,
  activeTurnStartedAt,
  progressCountLabels,
  progressElapsedLabel,
  progressStage,
  taskProgressHeartbeat
} from "../../src/web/task-progress.js";
import { en } from "../../src/web/i18n/en.js";

const source=(name:string)=>fs.readFileSync(path.join(process.cwd(),"src","web",name),"utf8");

const NOW=Date.parse("2026-08-08T10:20:00.000Z");
const at=(offsetMs:number)=>new Date(NOW+offsetMs).toISOString();

const event=(partial:Partial<AgentEvent>&{type:AgentEvent["type"]}):AgentEvent=>({content:"",provider:"claude",...partial});

// A long turn that has produced no assistant sentence yet: the request, then
// only provider-common lifecycle rows. This is the shape that used to read as
// "the task is stuck".
const silentTurn=[
  event({type:"message",content:"긴 작업을 해줘",itemId:"user",timestamp:at(-151_000),metadata:{role:"user"}}),
  event({type:"turn_started",itemId:"turn-1",eventId:"e1",timestamp:at(-150_000)}),
  event({type:"tool_started",content:"Read",itemId:"tool-1",eventId:"e2",timestamp:at(-140_000)}),
  event({type:"tool_completed",content:"Read",itemId:"tool-1",eventId:"e3",timestamp:at(-138_000)}),
  event({type:"command_started",content:"pnpm test",itemId:"cmd-1",eventId:"e4",timestamp:at(-90_000)}),
  event({type:"command_completed",content:"ok",itemId:"cmd-1",eventId:"e5",timestamp:at(-4_000)})
];

const livenessFor=(events:AgentEvent[],provider:"claude"|"codex"|"deepseek"|"ollama"|"antigravity"="claude")=>
  deriveTaskLiveness(events,{provider,taskId:"task-1",status:"running",now:NOW});

const heartbeatFor=(events:AgentEvent[],overrides:Record<string,unknown>={})=>{
  const state=livenessFor(events as AgentEvent[]);
  return taskProgressHeartbeat({
    status:"running",
    phase:state.phase,
    activity:state.recentActivity?.type,
    startedAt:activeTurnStartedAt(events,undefined,NOW),
    now:NOW,
    lastEventAt:state.lastMeaningfulEventAt,
    eventCount:state.eventCount,
    commandCount:state.commandCount,
    fileCount:state.fileCount,
    toolCount:state.toolCount,
    ...overrides
  });
};

describe("task progress heartbeat",()=>{
  it("reports elapsed work and a named stage before any assistant message exists",()=>{
    const progress=heartbeatFor(silentTurn);
    expect(silentTurn.some(row=>row.type==="message_completed")).toBe(false);
    expect(progress.visible).toBe(true);
    expect(progress.elapsedKnown).toBe(true);
    expect(progress.elapsedMs).toBe(151_000);
    expect(progress.elapsedLabel).toEqual({key:"liveness.durationMinutes",params:{minutes:2,seconds:31}});
    expect(progress.stage).toBe("command");
    expect(progress.stageKey).toBe("progress.stage.command");
    expect(progress.quiet).toBe(false);
    expect(progress.showCounts).toBe(true);
    expect(progress.counts).toEqual({commands:1,files:0,tools:1});
  });

  it("never invents a completion ratio and never leaks native event names",()=>{
    const internal=[...silentTurn,event({type:"unknown",content:"hook:PreToolUse",eventId:"e6",timestamp:at(-1_000),metadata:{nativeMethod:"hook/preToolUse"}})];
    const progress=heartbeatFor(internal);
    // An unnamed provider hook is telemetry: it keeps the previous concrete
    // activity instead of replacing it with generic internal work.
    expect(progress.stage).toBe("command");
    expect(JSON.stringify(progress)).not.toMatch(/hook|preToolUse|percent/i);
    expect(Object.keys(progress)).not.toContain("percent");
  });

  it("keeps counting while the provider stream is momentarily silent",()=>{
    const state=livenessFor(silentTurn);
    const quiet=taskProgressHeartbeat({
      status:"running",
      phase:state.phase,
      activity:state.recentActivity?.type,
      startedAt:activeTurnStartedAt(silentTurn,undefined,NOW),
      now:NOW+PROGRESS_QUIET_MS,
      lastEventAt:state.lastMeaningfulEventAt,
      eventCount:state.eventCount,
      commandCount:state.commandCount
    });
    expect(quiet.elapsedMs).toBe(151_000+PROGRESS_QUIET_MS);
    expect(quiet.quiet).toBe(true);
    expect(quiet.visible).toBe(true);
  });

  it("treats a freshly launched task as active rather than quiet",()=>{
    const progress=taskProgressHeartbeat({status:"running",phase:"idle",startedAt:at(0),now:NOW,eventCount:0});
    expect(progress.stage).toBe("starting");
    expect(progress.quiet).toBe(false);
    expect(progress.elapsedMs).toBe(0);
  });

  it("hides itself for every terminal status and stays visible for every active one",()=>{
    for(const status of ["pending","queued","running","waiting"])
      expect(taskProgressHeartbeat({status,phase:"acting",eventCount:1}).visible).toBe(true);
    for(const status of ["completed","failed","stopped","unknown"])
      expect(taskProgressHeartbeat({status,phase:"completed",eventCount:9}).visible).toBe(false);
  });

  it("prefers a waiting stage over the current activity",()=>{
    expect(progressStage({status:"waiting",phase:"waiting-approval",activity:"command",eventCount:4})).toBe("approval");
    expect(progressStage({status:"waiting",phase:"waiting-user",activity:"tool",eventCount:4})).toBe("decision");
    expect(progressStage({status:"queued",phase:"queued",eventCount:0})).toBe("queued");
    expect(progressStage({status:"running",phase:"acting",activity:"internal",eventCount:4})).toBe("working");
    expect(progressStage({status:"running",phase:"reasoning",activity:"response",eventCount:4})).toBe("response");
  });

  it("formats seconds, minutes and hours without a fake precision",()=>{
    expect(progressElapsedLabel(0)).toEqual({key:"liveness.durationSeconds",params:{seconds:0}});
    expect(progressElapsedLabel(59_900)).toEqual({key:"liveness.durationSeconds",params:{seconds:59}});
    expect(progressElapsedLabel(1_193_000)).toEqual({key:"liveness.durationMinutes",params:{minutes:19,seconds:53}});
    expect(progressElapsedLabel(7_530_000)).toEqual({key:"liveness.durationHours",params:{hours:2,minutes:5}});
  });

  it("drops empty count categories",()=>{
    expect(progressCountLabels({commands:0,files:0,tools:0})).toEqual([]);
    expect(progressCountLabels({commands:3,files:0,tools:7})).toEqual([
      {key:"conversation.commandCount",params:{count:3}},
      {key:"conversation.toolCount",params:{count:7}}
    ]);
  });

  it("measures the active turn, not the whole session",()=>{
    const followUp=[
      event({type:"message",content:"첫 요청",itemId:"user-1",timestamp:at(-3_600_000),metadata:{role:"user"}}),
      event({type:"message_completed",content:"첫 응답",itemId:"answer-1",timestamp:at(-3_500_000),metadata:{role:"agent"}}),
      event({type:"message",content:"후속 요청",itemId:"user-2",timestamp:at(-30_000),metadata:{role:"user"}}),
      event({type:"tool_started",content:"Grep",itemId:"tool-9",timestamp:at(-20_000)})
    ];
    expect(activeTurnStartedAt(followUp,at(-3_600_000),NOW)).toBe(NOW-30_000);
    expect(activeTurnStartedAt([],at(-30_000),NOW)).toBe(NOW-30_000);
    expect(activeTurnStartedAt([],undefined,NOW)).toBeUndefined();
  });

  it("derives the same heartbeat from a persisted snapshot, a live stream and their terminal merge",()=>{
    const snapshot=silentTurn.slice(0,4),live=mergeLiveEvents([],silentTurn.slice(4));
    const merged=mergeTerminalSnapshot(snapshot,mergeLiveEvents([],silentTurn));
    // Terminal reconciliation folds one native item's lifecycle rows together,
    // so the merged row count is lower than the raw stream. The heartbeat must
    // still read identically instead of double counting the overlap.
    expect(merged.length).toBeLessThan(silentTurn.length);
    const fromMerge=heartbeatFor(merged);
    const fromWhole=heartbeatFor(silentTurn);
    expect(fromMerge).toEqual(fromWhole);
    // The snapshot-only and live-only halves stay consistent with the part of
    // the turn they actually carry instead of double counting the overlap.
    expect(heartbeatFor(snapshot).counts).toEqual({commands:0,files:0,tools:1});
    expect(heartbeatFor(live).counts).toEqual({commands:1,files:0,tools:0});
  });

  it("produces the same shape for every provider lifecycle stream",()=>{
    const providers=["codex","claude","deepseek","ollama","antigravity","grok"] as const;
    const stages=providers.map(provider=>{
      const state=deriveTaskLiveness(silentTurn.map(row=>({...row,provider})),{provider,taskId:"t",status:"running",now:NOW});
      return progressStage({status:"running",phase:state.phase,activity:state.recentActivity?.type,eventCount:state.eventCount});
    });
    expect(new Set(stages)).toEqual(new Set(["command"]));
  });
});

describe("progress heartbeat presentation",()=>{
  it("translates every stage in every dictionary",()=>{
    for(const stage of ["starting","queued","thinking","working","command","file","tool","response","approval","decision"])
      expect(Object.hasOwn(en,`progress.stage.${stage}`),stage).toBe(true);
    for(const key of ["progress.elapsed","progress.quiet","progress.heartbeatLabel","liveness.durationHours"])
      expect(Object.hasOwn(en,key),key).toBe(true);
  });

  it("keeps the conversation heartbeat inside the always-visible badge",()=>{
    const conversation=source("Conversation.svelte");
    const badge=conversation.indexOf('class="work-status-badge"');
    const heartbeat=conversation.indexOf('class="work-progress-heartbeat"');
    const panel=conversation.indexOf('class="work-status-panel"');
    expect(badge).toBeGreaterThan(-1);
    expect(heartbeat).toBeGreaterThan(badge);
    // Folding the work detail must not fold the heartbeat away with it.
    expect(heartbeat).toBeLessThan(panel);
    expect(conversation).toContain("{#if progress.visible}");
    expect(conversation).toContain("aria-label={progressHeartbeatLabel}");
  });

  it("ticks the elapsed clock only while the task is busy",()=>{
    const conversation=source("Conversation.svelte");
    expect(conversation).toContain("$: if(busy&&!progressTimer)");
    expect(conversation).toContain("$: if(!busy)stopProgressTimer();");
    expect(conversation).toContain("onDestroy(stopProgressTimer)");
    expect(conversation).toContain("progressNow=Date.now();progressTimer=setInterval(()=>progressNow=Date.now(),1_000)");
    const strip=source("SessionActivityStrip.svelte");
    expect(strip).toContain("$: if(active&&streamEnabled&&!ticker)");
    expect(strip).toContain("$: if(!(active&&streamEnabled))stopTicker();");
    expect(strip).toContain("stopTicker();stop?.();");
  });

  it("keeps the folded running badge quiet and reserves counts for detail or completion evidence",()=>{
    const conversation=source("Conversation.svelte");
    expect(conversation).not.toContain("progressCountsText");
    expect(conversation).toContain('liveMode==="Delayed"?$t("conversation.connectionDelayed")');
    expect(conversation).toContain('$t("conversation.workFinished")');
    expect(conversation).toContain("panelOutcome.files.length?$t(\"conversation.completedFileCount\"");
    expect(conversation).toContain('<div class="work-event-summary">');
  });

  it("carries a task start time into every provider task card",()=>{
    expect(source("App.svelte")).toMatch(/<SessionActivityStrip[^>]*startedAt=\{task\.createdAt\?\?null\}/);
    expect(source("CodexSessions.svelte")).toMatch(/<SessionActivityStrip[^>]*startedAt=\{item\.createdAt\?\?null\}/);
  });

  it("respects reduced motion and keeps the mobile badge narrow",()=>{
    const styles=source("styles.css");
    expect(styles).toContain("@media(prefers-reduced-motion:reduce){.work-progress-heartbeat>i{animation:none;opacity:1;transform:none}}");
    expect(styles).toContain(".work-status-badge .work-progress-heartbeat{padding:3px 0;gap:5px}");
    expect(styles).toContain(".session-activity-strip>.session-progress-heartbeat{grid-column:1/-1");
  });

  it("reveals only root final output that arrives after mount",()=>{
    const conversation=source("Conversation.svelte"),styles=source("styles.css");
    expect(conversation).toContain("isFinalAssistantOutput(event as DisplayEvent,rootThreadId,events as DisplayEvent[],!busy)");
    expect(conversation).toContain("if(finalRevealReady&&finalRevealTaskWasBusy)");
    expect(conversation).toContain("knownFinalEventKeys=rootFinalEventKeys(events);\n    finalRevealReady=true;");
    expect(conversation).toContain("class:final-output-reveal={revealingFinalEventKeys.has(eventAnchorIdentity(event))}");
    expect(styles).toContain(".bubble.agent.final-output-reveal{animation:final-output-reveal .17s ease-out both}");
    expect(styles).toContain(".bubble.agent.final-output-reveal{animation:none}");
  });

  it("styles the live writing wave and explicit final-answer surface",()=>{
    const conversation=source("Conversation.svelte"),styles=source("styles.css");
    expect(conversation).toContain("$: liveWritingEventKey=latestLiveWritingKey(events);");
    expect(conversation).toContain('class:final-output-card={finalOutput}');
    expect(conversation).toContain('class="live-writing-wave"');
    expect(conversation).toContain('$t("conversation.finalAnswer")');
    expect(styles).toContain(".bubble.agent.final-output-card{");
    expect(styles).toContain(".bubble-card-head>span.final-output-badge{");
    expect(styles).toContain("@keyframes live-writing-wave{");
    expect(styles).toContain(".live-writing-wave>i{animation:none");
  });
});
