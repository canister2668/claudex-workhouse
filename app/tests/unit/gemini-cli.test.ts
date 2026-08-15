import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterAll,describe,expect,it} from "vitest";
import {classifyGeminiCliError,geminiApprovalMode,geminiCliArguments,geminiCliExitFailure,geminiShellAvailable,resolveGeminiCliEntry,resolveGeminiSessionFile,ripgrepAvailable} from "../../src/server/gemini-cli-runtime";
import {geminiContextUsage,geminiModelBreakdown,geminiOutputUsage,geminiToolEndEvent,geminiToolShape,geminiToolStartEvent,geminiToolSummary,geminiUsage} from "../../src/server/gemini-cli-events";

/**
 * Fixtures copied verbatim from live Gemini CLI 0.55.1 runs against Vertex on
 * this host, so a CLI upgrade that changes the envelope fails here instead of
 * silently degrading the Vertex Agent backend.
 */
const RESULT_STATS={total_tokens:14803,input_tokens:14006,output_tokens:63,cached:0,input:14006,duration_ms:9886,tool_calls:1,models:{
  "gemini-3.1-flash-lite":{total_tokens:1155,input_tokens:862,output_tokens:26,cached:0,input:862},
  "gemini-3.5-flash":{total_tokens:13648,input_tokens:13144,output_tokens:37,cached:0,input:13144}
}};

const scratch=fs.mkdtempSync(path.join(os.tmpdir(),"gemini-cli-test-"));
afterAll(()=>fs.rmSync(scratch,{recursive:true,force:true}));

describe("Gemini CLI permission mapping",()=>{
  it("maps Workhouse profiles onto the CLI's headless approval modes",()=>{
    expect(geminiApprovalMode("read","default")).toBe("default");
    expect(geminiApprovalMode("auto","default")).toBe("auto_edit");
    expect(geminiApprovalMode("full","default")).toBe("yolo");
    expect(geminiApprovalMode("confirm","default")).toBe("auto_edit");
  });
  it("keeps an explicit plan turn read-only regardless of the profile",()=>{
    expect(geminiApprovalMode("full","plan")).toBe("plan");
    expect(geminiApprovalMode("read","plan")).toBe("plan");
  });
  it("reports the shell as reachable only under full access",()=>{
    // Verified live: default and auto_edit headless runs have no shell tool.
    expect(geminiShellAvailable("yolo")).toBe(true);
    expect(geminiShellAvailable("auto_edit")).toBe(false);
    expect(geminiShellAvailable("default")).toBe(false);
    expect(geminiShellAvailable("plan")).toBe(false);
  });
});

describe("Gemini CLI arguments",()=>{
  const base={prompt:"do the thing",model:"gemini-3.5-flash",approvalMode:"auto_edit" as const};
  it("assigns the Workhouse session id on a new turn",()=>{
    const args=geminiCliArguments({...base,launch:{mode:"new",sessionId:"11111111-2222-3333-4444-555555555555",sessionFile:null}});
    expect(args).toContain("--session-id");
    expect(args).toContain("11111111-2222-3333-4444-555555555555");
    expect(args).not.toContain("--resume");
    expect(args.at(-2)).toBe("--prompt");
  });
  it("resumes by session id and never combines the mutually exclusive flags",()=>{
    const args=geminiCliArguments({...base,launch:{mode:"resume",sessionId:"abc",sessionFile:null}});
    expect(args).toContain("--resume");
    expect(args).not.toContain("--session-id");
    expect(args).not.toContain("--session-file");
  });
  it("branches from a transcript without asking for an id the CLI would reject",()=>{
    const args=geminiCliArguments({...base,launch:{mode:"fork",sessionId:null,sessionFile:"/tmp/session.jsonl"}});
    expect(args).toContain("--session-file");
    expect(args).not.toContain("--session-id");
    expect(args).not.toContain("--resume");
  });
  it("always trusts the workspace so a headless run cannot exit 55",()=>{
    expect(geminiCliArguments({...base,launch:{mode:"new",sessionId:null,sessionFile:null}})).toContain("--skip-trust");
  });
});

describe("Gemini CLI stream events",()=>{
  it("separates shell, write, and read tools",()=>{
    expect(geminiToolShape("run_shell_command")).toBe("shell");
    expect(geminiToolShape("write_file")).toBe("file-write");
    expect(geminiToolShape("read_file")).toBe("file-read");
    expect(geminiToolShape("update_topic")).toBe("tool");
  });
  it("maps tool shapes onto the shared event kinds",()=>{
    expect(geminiToolStartEvent("shell")).toBe("command_started");
    expect(geminiToolStartEvent("file-write")).toBe("file_change_started");
    expect(geminiToolStartEvent("file-read")).toBe("tool_started");
    expect(geminiToolEndEvent("shell",false)).toBe("command_completed");
    expect(geminiToolEndEvent("shell",true)).toBe("tool_completed");
  });
  it("summarizes a call without dumping the whole parameter object",()=>{
    expect(geminiToolSummary("run_shell_command",{command:"echo ok",description:"x"})).toBe("run_shell_command: echo ok");
    expect(geminiToolSummary("write_file",{file_path:"/tmp/a.txt",content:"secret"})).toBe("write_file: /tmp/a.txt");
    expect(geminiToolSummary("update_topic",{summary:"…"})).toBe("update_topic");
  });
});

describe("Gemini CLI usage",()=>{
  it("derives the thinking tokens the CLI only reports as a total remainder",()=>{
    const usage=geminiUsage(RESULT_STATS)!;
    expect(usage.totals).toEqual({totalTokens:14803,inputTokens:14006,outputTokens:797,cachedInputTokens:0,reasoningTokens:734});
    expect(usage.toolCalls).toBe(1);
  });
  it("ranks the working model above the utility router",()=>{
    const breakdown=geminiModelBreakdown(geminiUsage(RESULT_STATS))!;
    expect(breakdown.primary.model).toBe("gemini-3.5-flash");
    expect(breakdown.utility.map(entry=>entry.model)).toEqual(["gemini-3.1-flash-lite"]);
  });
  it("does not invent a request count the CLI never publishes",()=>{
    expect(geminiOutputUsage(geminiUsage(RESULT_STATS))?.requestCount).toBeNull();
  });
  it("reads context from the working model's prompt, not the router's",()=>{
    const context=geminiContextUsage(geminiUsage(RESULT_STATS))!;
    expect(context.usedTokens).toBe(13144);
    expect(context.windowTokens).toBe(1_000_000);
  });
  it("returns nothing for an empty envelope instead of a zeroed reading",()=>{
    expect(geminiUsage(null)).toBeNull();
    expect(geminiUsage({})).toBeNull();
  });
});

describe("Gemini CLI failures",()=>{
  it("names the fatal exit codes instead of reporting a bare status",()=>{
    expect(geminiCliExitFailure(55,null).code).toBe("GEMINI_CLI_WORKSPACE_UNTRUSTED");
    expect(geminiCliExitFailure(41,null).code).toBe("GEMINI_CLI_AUTH_FAILED");
    expect(geminiCliExitFailure(53,null).code).toBe("GEMINI_CLI_TURN_LIMIT");
    expect(geminiCliExitFailure(7,null).code).toBe("GEMINI_CLI_EXITED");
    expect(geminiCliExitFailure(null,"SIGKILL").code).toBe("GEMINI_CLI_SIGNALLED");
  });
  it("classifies the Vertex API failures an operator has to act on differently",()=>{
    expect(classifyGeminiCliError("Permission denied on resource project foo. CONSUMER_INVALID").code).toBe("VERTEX_PROJECT_DENIED");
    expect(classifyGeminiCliError("Could not load the default credentials.").code).toBe("GEMINI_CLI_AUTH_FAILED");
    expect(classifyGeminiCliError("Vertex AI API has not been used in project 12 before").code).toBe("VERTEX_API_DISABLED");
    expect(classifyGeminiCliError("RESOURCE_EXHAUSTED: quota exceeded").code).toBe("VERTEX_QUOTA_EXHAUSTED");
    expect(classifyGeminiCliError("something odd happened").code).toBe("GEMINI_CLI_FAILED");
  });
});

describe("Gemini CLI runtime discovery",()=>{
  it("prefers the Workhouse-managed install over anything on PATH",()=>{
    const bundle=path.join(scratch,"runtime","gemini-cli","node_modules","@google","gemini-cli","bundle");
    fs.mkdirSync(bundle,{recursive:true});
    fs.writeFileSync(path.join(bundle,"gemini.js"),"//");
    expect(resolveGeminiCliEntry(scratch,"")).toEqual({kind:"bundle",entry:path.join(bundle,"gemini.js")});
  });
  it("reports absence rather than guessing a path",()=>{
    expect(resolveGeminiCliEntry(path.join(scratch,"empty"),"")).toBeNull();
  });
  it("treats ripgrep as an optional accelerator",()=>{
    expect(ripgrepAvailable("")).toBe(false);
  });
});

describe("Gemini CLI session transcripts",()=>{
  it("confirms a session by its header id rather than trusting the file name",()=>{
    const home=path.join(scratch,"home"),chats=path.join(home,".gemini","tmp","ws","chats");
    fs.mkdirSync(chats,{recursive:true});
    fs.writeFileSync(path.join(home,".gemini","projects.json"),JSON.stringify({projects:{"/work/ws":"ws"}}));
    fs.writeFileSync(path.join(chats,"session-2026-01-01T00-00-aaaaaaaa.jsonl"),`${JSON.stringify({sessionId:"aaaaaaaa-0000-0000-0000-000000000000"})}\n{}`);
    fs.writeFileSync(path.join(chats,"session-2026-01-01T00-01-bbbbbbbb.jsonl"),`${JSON.stringify({sessionId:"bbbbbbbb-0000-0000-0000-000000000000"})}\n{}`);
    expect(resolveGeminiSessionFile(home,"bbbbbbbb-0000-0000-0000-000000000000","/work/ws")).toBe(path.join(chats,"session-2026-01-01T00-01-bbbbbbbb.jsonl"));
    expect(resolveGeminiSessionFile(home,"cccccccc-0000-0000-0000-000000000000","/work/ws")).toBeNull();
  });
});
