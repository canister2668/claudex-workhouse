import { afterEach, describe, expect, it } from "vitest";
import { setLocale } from "../../src/web/i18n";
import { classifyTaskEvent, mapActivityEvent } from "../../src/web/task-activity-map";

describe("task activity mapping",()=>{
  afterEach(()=>setLocale("en"));
  it("uses human-facing labels while retaining raw provider hooks",()=>{
    const activity=mapActivityEvent("codex",{
      type:"file_change_completed",
      content:"src/web/App.svelte",
      metadata:{nativeMethod:"turn/diff/updated"}
    });
    expect(activity.labelKey).toBe("liveness.activity.file");
    expect(activity.raw).toBe("turn/diff/updated");
  });

  it("maps user decisions and approvals separately",()=>{
    expect(mapActivityEvent("claude",{type:"user_input_required",content:"choose"}).type).toBe("decision");
    expect(mapActivityEvent("codex",{type:"approval_required",content:"approve"}).type).toBe("approval");
  });

  it("keeps diagnostic progress out of user-facing activity",()=>{
    expect(classifyTaskEvent("claude",{type:"tool_progress",content:"Claude status event."})).toBe("telemetry");
    expect(classifyTaskEvent("codex",{type:"unknown",content:"hook"})).toBe("telemetry");
    expect(classifyTaskEvent("deepseek",{type:"tool_started",content:"Search"})).toBe("activity");
  });

  it("presents Claude session initialization in the selected locale",()=>{
    setLocale("ko");
    const activity=mapActivityEvent("claude",{type:"turn_started",content:"Claude session initialized.",metadata:{nativeType:"system",subtype:"init"}});
    expect(activity.type).toBe("reasoning");
    expect(activity.detail).toBe("작업 준비 중");
    expect(activity.detail).not.toContain("Claude");
  });
});
