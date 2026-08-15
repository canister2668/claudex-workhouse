import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

// Drive the built Claude worker with a fake `claude` binary that records the
// exact argv it was invoked with, and assert the official `--effort` flag is
// forwarded only when a concrete level (not "default") is requested.
const roots: string[] = [];
afterEach(() => { for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

function runWorker(effort: string, model = "default", legacy = false,emotionMcpUrl="",workMode:"default"|"plan"|null="default",switchModelsOnFlag:boolean|null=null,managedMcp=false,runtimeProfile:"default"|"conversation"|"browser"="default",mode:"new"|"resume"|"fork"="new",sourceSessionId="",requestedSessionId="") {
  // Use a cwd-relative temp dir: this NAS mounts /tmp noexec, so a fake binary
  // spawned from there fails with EACCES (mirrors provider-auth.test.ts).
  const root = fs.mkdtempSync(path.join(process.cwd(), ".deck-worker-effort-"));
  roots.push(root);
  const argvLog = path.join(root, "argv.txt");
  const fakeClaude = path.join(root, "claude-fake.sh");
  fs.writeFileSync(fakeClaude, `#!/bin/sh\nprintf '%s\\n' "$@" > "${argvLog}"\nprintf '{"type":"result","subtype":"success","is_error":false,"result":"ok","session_id":"11111111-1111-4111-8111-111111111111"}\\n'\nexit 0\n`);
  fs.chmodSync(fakeClaude, 0o700);
  const stateDir = path.join(root, "data", "claude-jobs");
  fs.mkdirSync(stateDir, { recursive: true });
  const statePath = path.join(stateDir, "claude_test.json");
  const workerPath = path.resolve("dist-server/claude-worker.js");
  const childEnvironment={...process.env};
  for(const name of["CLAUDEX_WORKHOUSE_MANAGED_PROVIDER_MCP_URL","CLAUDEX_WORKHOUSE_CURRENT_TASK_ID","CLAUDEX_WORKHOUSE_MANAGED_PROVIDER_TOKEN","CLAUDEX_WORKHOUSE_CLAUDE_SESSION_ID","CLAUDEX_WORKHOUSE_EMOTION_MCP_URL","CLAUDEX_WORKHOUSE_CLAUDE_SWITCH_MODELS_ON_FLAG"])delete childEnvironment[name];
  return new Promise<{ argv: string[] }>((resolve, reject) => {
    const trailing=legacy?["11111111-1111-4111-8111-111111111111","legacy prompt"]:workMode===null?[effort,sourceSessionId,"hello world"]:[effort,workMode,sourceSessionId,"hello world"];
    const child = spawn(process.execPath, [workerPath, statePath, "claude:test", fakeClaude, legacy?"resume":mode, root, "claudex-workhouse:test", ":read-only", model, ...trailing], { cwd: root, stdio: "ignore",env:{...childEnvironment,CLAUDEX_WORKHOUSE_RUNTIME_PROFILE:runtimeProfile,...(emotionMcpUrl?{CLAUDEX_WORKHOUSE_EMOTION_MCP_URL:emotionMcpUrl}:{}),...(managedMcp?{CLAUDEX_WORKHOUSE_MANAGED_PROVIDER_MCP_URL:"http://127.0.0.1:3410/mcp/claudex-workhouse",CLAUDEX_WORKHOUSE_CURRENT_TASK_ID:"claude:test",CLAUDEX_WORKHOUSE_MANAGED_PROVIDER_TOKEN:"test-secret"}:{}),...(switchModelsOnFlag===null?{}:{CLAUDEX_WORKHOUSE_CLAUDE_SWITCH_MODELS_ON_FLAG:String(switchModelsOnFlag)}),...(requestedSessionId?{CLAUDEX_WORKHOUSE_CLAUDE_SESSION_ID:requestedSessionId}:{})} });
    child.once("error", reject);
    child.once("close", () => {
      try { resolve({ argv: fs.readFileSync(argvLog, "utf8").split("\n").filter(Boolean) }); }
      catch (error) { reject(error as Error); }
    });
  });
}


describe("Claude worker reasoning effort flag", () => {
  it("forwards --effort when a concrete level is requested", async () => {
    const { argv } = await runWorker("xhigh");
    const i = argv.indexOf("--effort");
    expect(i).toBeGreaterThanOrEqual(0);
    expect(argv[i + 1]).toBe("xhigh");
  }, 15000);

  it("omits --effort for the CLI default and still passes the prompt", async () => {
    const { argv } = await runWorker("default");
    expect(argv).not.toContain("--effort");
    expect(argv).toContain("hello world");
  }, 15000);

  it("pins new and forked Claude conversations to their preassigned session IDs",async()=>{
    const target="22222222-2222-4222-8222-222222222222",source="11111111-1111-4111-8111-111111111111";
    const created=(await runWorker("default","default",false,"","default",null,false,"default","new","",target)).argv;
    expect(created.slice(created.indexOf("--session-id"),created.indexOf("--session-id")+2)).toEqual(["--session-id",target]);
    expect(created).not.toContain("--resume");
    const forked=(await runWorker("default","default",false,"","default",null,false,"default","fork",source,target)).argv;
    expect(forked.slice(forked.indexOf("--resume"),forked.indexOf("--resume")+2)).toEqual(["--resume",source]);
    expect(forked).toContain("--fork-session");
    expect(forked.slice(forked.indexOf("--session-id"),forked.indexOf("--session-id")+2)).toEqual(["--session-id",target]);
  },15000);

  it("accepts the pre-effort argv layout during a rolling server restart", async () => {
    const { argv } = await runWorker("default","default",true);
    expect(argv).not.toContain("--effort");
    expect(argv).toContain("--resume");
    expect(argv).toContain("11111111-1111-4111-8111-111111111111");
    expect(argv).toContain("legacy prompt");
  }, 15000);

  it("keeps read-only conversation turns out of plan mode",async()=>{
    const{argv}=await runWorker("default");
    const modeIndex=argv.indexOf("--permission-mode"),allowedIndex=argv.indexOf("--allowedTools");
    expect(argv[modeIndex+1]).toBe("dontAsk");
    expect(argv.slice(allowedIndex+1)).toContain("Read");
    expect(argv).not.toContain("Write");
  },15000);

  it("preserves explicit and legacy read-only plan mode",async()=>{
    const explicit=(await runWorker("default","default",false,"","plan")).argv;
    const rolling=(await runWorker("default","default",false,"",null)).argv;
    expect(explicit[explicit.indexOf("--permission-mode")+1]).toBe("plan");
    expect(rolling[rolling.indexOf("--permission-mode")+1]).toBe("plan");
  },15000);

  it("connects and allows only the local display emotion tool when configured",async()=>{
    const{argv}=await runWorker("default","default",false,"http://127.0.0.1:3410/mcp"),configIndex=argv.indexOf("--mcp-config"),allowedIndex=argv.indexOf("--allowedTools");
    expect(configIndex).toBeGreaterThanOrEqual(0);
    expect(JSON.parse(argv[configIndex+1])).toEqual({mcpServers:{claudex_workhouse_emotion:{type:"http",url:"http://127.0.0.1:3410/mcp",headers:{"X-Claudex-Workhouse-Task-Id":"${CLAUDEX_WORKHOUSE_CURRENT_TASK_ID}","X-Claudex-Workhouse-Session-Id":"${CLAUDEX_WORKHOUSE_CURRENT_SESSION_ID}","X-Claudex-Workhouse-Runtime-Profile":"${CLAUDEX_WORKHOUSE_RUNTIME_PROFILE}"}}}});
    expect(allowedIndex).toBeGreaterThanOrEqual(0);
    expect(argv.slice(allowedIndex+1)).toContain("mcp__claudex_workhouse_emotion__set_emotion");
    expect(argv.slice(allowedIndex+1)).toContain("Read");
  },15000);

  it("uses a stable conversation-only runtime while preserving the display emotion MCP",async()=>{
    const{argv}=await runWorker("default","default",false,"http://127.0.0.1:3410/mcp","default",null,true,"conversation"),configIndex=argv.indexOf("--mcp-config"),toolsIndex=argv.indexOf("--tools"),allowedIndex=argv.indexOf("--allowedTools"),systemIndex=argv.indexOf("--append-system-prompt");
    expect(argv).toContain("--safe-mode");
    expect(argv).toContain("--no-chrome");
    expect(argv).toContain("--strict-mcp-config");
    expect(argv).not.toContain("--setting-sources");
    expect(argv.slice(toolsIndex+1)).toContain("mcp__claudex_workhouse_emotion__set_emotion");
    expect(argv.slice(toolsIndex+1,allowedIndex)).not.toContain("Read");
    expect(JSON.parse(argv[configIndex+1])).toEqual({mcpServers:{claudex_workhouse_emotion:{type:"http",url:"http://127.0.0.1:3410/mcp",headers:{"X-Claudex-Workhouse-Task-Id":"${CLAUDEX_WORKHOUSE_CURRENT_TASK_ID}","X-Claudex-Workhouse-Session-Id":"${CLAUDEX_WORKHOUSE_CURRENT_SESSION_ID}","X-Claudex-Workhouse-Runtime-Profile":"${CLAUDEX_WORKHOUSE_RUNTIME_PROFILE}"}}}});
    expect(argv[systemIndex+1]).toContain("conversation-only runtime");
    expect(argv.join("\n")).toContain("call set_emotion exactly once");
    expect(argv.join("\n")).toContain("Do not call express_emotion");
    expect(argv.join(" ")).not.toContain("managed_provider_task_create");
  },15000);

  it("injects task-scoped managed delegation for Claude without exposing its token in argv",async()=>{
    const{argv}=await runWorker("default","default",false,"","default",null,true),configIndex=argv.indexOf("--mcp-config"),allowedIndex=argv.indexOf("--allowedTools");
    expect(configIndex).toBeGreaterThanOrEqual(0);
    const config=JSON.parse(argv[configIndex+1]);
    expect(config.mcpServers["claudex-workhouse"]).toEqual({type:"http",url:"http://127.0.0.1:3410/mcp/claudex-workhouse",headers:{Authorization:"Bearer ${CLAUDEX_WORKHOUSE_MANAGED_PROVIDER_TOKEN}","X-Claudex-Workhouse-Task-Id":"${CLAUDEX_WORKHOUSE_CURRENT_TASK_ID}"}});
    expect(argv.join(" ")).not.toContain("test-secret");
    expect(argv.slice(allowedIndex+1)).toContain("mcp__claudex-workhouse__managed_provider_task_create");
  },15000);

  it("overrides the Claude safety-switch preference even for read-only turns",async()=>{
    for(const enabled of [true,false]){
      const{argv}=await runWorker("default","default",false,"","default",enabled),settingsIndex=argv.indexOf("--settings");
      expect(argv[argv.indexOf("--permission-mode")+1]).toBe("dontAsk");
      expect(argv).not.toContain("Write");
      expect(settingsIndex).toBeGreaterThanOrEqual(0);
      expect(JSON.parse(argv[settingsIndex+1])).toEqual({switchModelsOnFlag:enabled});
    }
  },15000);

  it("does not inject lifecycle hooks through Claude user settings",async()=>{
    const{argv}=await runWorker("default");
    expect(argv).not.toContain("--settings");
  },15000);

});
