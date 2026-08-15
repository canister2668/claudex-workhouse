import fs from "node:fs";
import path from "node:path";
import {describe,expect,it} from "vitest";

const web=(file:string)=>fs.readFileSync(path.join(process.cwd(),"src","web",file),"utf8");

describe("independent reading text sizes",()=>{
  it("stores and restores session and conversation sizes independently",()=>{
    const source=web("App.svelte");
    expect(source).toContain('localStorage.getItem("deck-session-text-size")');
    expect(source).toContain('localStorage.getItem("deck-conversation-text-size")');
    expect(source).toContain("sessionTextSize,conversationTextSize");
    expect(source).toContain("applySessionTextSize(normalizeTextSize(value.sessionTextSize))");
    expect(source).toContain("applyConversationTextSize(normalizeTextSize(value.conversationTextSize))");
    expect(source).toContain('$t("settings.sessionTextSize")');
    expect(source).toContain('$t("settings.conversationTextSize")');
  });

  it("uses 13, 14, 15, and 16px tokens on both reading surfaces",()=>{
    const styles=web("styles.css");
    const sessions=web("sessions.css");
    expect(styles).toContain("--session-text-size:14px;--session-code-size:13px");
    expect(styles).toContain('--session-text-size:13px;--session-code-size:12px');
    expect(styles).toContain('--session-text-size:15px;--session-code-size:14px');
    expect(styles).toContain('--session-text-size:16px;--session-code-size:15px');
    expect(styles).toContain("--conversation-text-size:14px;--conversation-code-size:13px");
    expect(styles).toContain('--conversation-text-size:13px;--conversation-code-size:12px');
    expect(styles).toContain('--conversation-text-size:15px;--conversation-code-size:14px');
    expect(styles).toContain('--conversation-text-size:16px;--conversation-code-size:15px');
    expect(styles).toContain(".conversation .markdown-body{font-size:var(--session-text-size)}");
    expect(styles).toContain(".composer textarea{");
    expect(styles).toContain("font-size:var(--session-text-size)");
    expect(sessions).toContain(".provider-output,.provider-error,.provider-waiting{");
    expect(sessions).toContain(".inline-emotion-scene .scene-markdown{font-size:var(--conversation-text-size)");
    expect(sessions).toContain(".collaboration-user p{margin:9px 0 0 43px;overflow-wrap:anywhere;color:var(--text);font-size:var(--conversation-text-size)");
    expect(sessions).toContain(".conversation-input textarea{");
    expect(sessions).toContain("font-size:var(--conversation-text-size)");
  });

  it("does not let compact skin shrink conversation copy",()=>{
    const styles=web("styles.css");
    expect(styles).toContain(':root[data-skin="compact"] .collaboration-user p{margin:3px 0 0;font-size:var(--conversation-text-size);line-height:1.7}');
  });
});
