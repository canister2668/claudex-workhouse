import{describe,expect,it}from"vitest";
import{activeBuilds,buildCommandIdentity,buildDurationLabel,buildHistory,buildProgressRows,buildTool,commandWithoutHeredocBody,isBuildCommand}from"../../src/web/build-progress";
import{mergeTerminalSnapshot}from"../../src/web/live-events";

describe("build progress",()=>{
  it("recognizes build commands without classifying ordinary commands",()=>{
    for(const command of["pnpm run build","npm build","yarn build","npx vite build","tsc -b","docker compose build","cargo build --release","go build ./...","./gradlew assemble","mvn package","cmake --build out","make release"])expect(isBuildCommand(command),command).toBe(true);
    for(const command of["pnpm test","npm run check","git status","echo build","echo npm run build","docker compose up","go test ./..."])expect(isBuildCommand(command),command).toBe(false);
    expect(isBuildCommand("cd app && pnpm build")).toBe(true);
    expect(buildTool("pnpm exec vite build")).toBe("Vite");
  });

  it("combines Codex command lifecycle events into one running build",()=>{
    const rows=buildProgressRows([
      {type:"command_started",content:"pnpm run build",itemId:"cmd-1",timestamp:"2026-07-26T01:00:00.000Z",metadata:{}},
      {type:"command_output",content:"transforming...",itemId:"cmd-1",metadata:{}},
      {type:"command_output",content:"3955 modules transformed.",itemId:"cmd-1",metadata:{}},
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({command:"pnpm run build",tool:"Build",status:"running",phase:"bundling",latestLine:"3955 modules transformed.",outputLines:2});
    expect(rows[0].events).toHaveLength(3);
  });

  it("reads Codex completion metadata and failure state",()=>{
    const [row]=buildProgressRows([{type:"command_completed",content:"Build failed",status:"failed",itemId:"cmd-2",metadata:{command:"pnpm build",exitCode:2,durationMs:1250}}]);
    expect(row).toMatchObject({status:"failed",exitCode:2,durationMs:1250,output:"Build failed"});
  });

  it("pairs a Claude Bash result with its build command by item id",()=>{
    const [row]=buildProgressRows([
      {type:"command_started",content:"npm run build",itemId:"tool-1",timestamp:"2026-07-26T01:00:00.000Z",metadata:{description:"Build app"}},
      {type:"tool_completed",content:"✓ built in 4.2s",itemId:"tool-1",timestamp:"2026-07-26T01:00:04.200Z",metadata:{isError:false}},
    ]);
    expect(row).toMatchObject({status:"completed",output:"✓ built in 4.2s",durationMs:4200});
    expect(row.events).toHaveLength(2);
  });

  it("keeps the build card through a live and history merge",()=>{
    const started={type:"command_started",content:"pnpm run build",turnId:"turn-build",itemId:"build-1",sequence:1,eventId:"build:1",metadata:{}} as any;
    const output={type:"command_output",content:"4001 modules transformed.",turnId:"turn-build",itemId:"build-1",sequence:2,eventId:"build:2",metadata:{}} as any;
    const merged=mergeTerminalSnapshot([{type:"message",content:"빌드해줘",metadata:{role:"user"}}] as any[],[started,output]);
    expect(buildProgressRows(merged)).toEqual([
      expect.objectContaining({command:"pnpm run build",status:"running",latestLine:"4001 modules transformed."})
    ]);
  });
});

// A finished build keeps its full card otherwise, so a session that builds
// repeatedly scrolls through a stack of identical completed ones.
describe("finished builds stop taking card space",()=>{
  const run=(id:string,command:string,status:"running"|"completed"|"failed",durationMs:number|null=1_000)=>({
    id,command,tool:"Build",status,phase:"finalizing" as const,output:"",latestLine:"",outputLines:0,
    exitCode:status==="failed"?1:status==="completed"?0:null,durationMs,startedAt:null,completedAt:null,events:[]
  });

  it("keeps only running builds as cards",()=>{
    const rows=[run("a","npm run build","completed"),run("b","npm run build","running")];
    expect(activeBuilds(rows).map(row=>row.id)).toEqual(["b"]);
  });

  it("collapses repeats of the same command into one row with a count",()=>{
    const history=buildHistory([
      run("a","npm run build","completed",1_000),
      run("b","npm run build","completed",2_000),
      run("c","npm run build","completed",3_000)
    ]);
    expect(history).toHaveLength(1);
    expect(history[0].count).toBe(3);
    // The newest run's numbers are the ones worth showing.
    expect(history[0].durationMs).toBe(3_000);
    expect(history[0].id).toBe("c");
  });

  it("keeps different commands and outcomes apart, newest first",()=>{
    const history=buildHistory([
      run("a","npm run build","completed"),
      run("b","cargo build","failed"),
      run("c","npm run build","failed")
    ]);
    expect(history.map(entry=>`${entry.command}:${entry.status}`)).toEqual([
      "npm run build:failed",
      "cargo build:failed",
      "npm run build:completed"
    ]);
  });

  it("leaves running builds out of the history",()=>{
    expect(buildHistory([run("a","npm run build","running")])).toEqual([]);
  });

  it("formats a duration the caller can translate",()=>{
    expect(buildDurationLabel(null)).toBeNull();
    expect(buildDurationLabel(400)?.key).toBe("build.lessThanSecond");
    expect(buildDurationLabel(18_200)).toEqual({key:"build.seconds",params:{count:18}});
    expect(buildDurationLabel(95_000)).toEqual({key:"build.minutes",params:{count:1,seconds:35}});
  });
});

// Every completion used to be resolved against the last build in the whole
// event list, so with several builds only the final row ever finished and the
// earlier cards sat at "building" for the rest of the session.
describe("each build gets its own completion",()=>{
  const CMD="npm run -s build";

  it("finishes every build when the events carry no item ids",()=>{
    const rows=buildProgressRows([
      {type:"command_started",content:CMD},
      {type:"tool_completed",content:"built"},
      {type:"command_started",content:CMD},
      {type:"tool_completed",content:"built"},
      {type:"command_started",content:CMD},
      {type:"tool_completed",content:"built"}
    ] as any);
    expect(rows).toHaveLength(3);
    expect(rows.map(row=>row.status)).toEqual(["completed","completed","completed"]);
  });

  it("does not hand a later build's result to an earlier card",()=>{
    const rows=buildProgressRows([
      {type:"command_started",content:CMD,itemId:"a"},
      {type:"command_started",content:CMD,itemId:"b"},
      {type:"tool_completed",content:"built",itemId:"b"}
    ] as any);
    expect(rows.map(row=>row.status)).toEqual(["running","completed"]);
  });

  it("keeps output flowing to the build that is still open",()=>{
    const [row]=buildProgressRows([
      {type:"command_started",content:CMD},
      {type:"command_output",content:"transforming"},
      {type:"command_completed",content:"done",metadata:{exitCode:0}}
    ] as any);
    expect(row.status).toBe("completed");
    expect(row.output).toContain("transforming");
  });
});

describe("writing a file is not building it",()=>{
  it("ignores a build command quoted inside a heredoc body",()=>{
    const command=`cat > run.sh <<'EOF'\nnpm run build\nEOF`;
    expect(commandWithoutHeredocBody(command).trim()).toBe("cat > run.sh");
    expect(isBuildCommand(command)).toBe(false);
  });

  it("still recognises a real build that follows a heredoc-free command",()=>{
    expect(isBuildCommand('export PATH="/usr/local/bin:$PATH" && npm run -s build')).toBe(true);
  });
});

describe("build history grouping", () => {
  const row = (command: string, status: "completed" | "failed" = "completed") => ({
    id: `id-${command}-${status}`, command, tool: "pnpm", status, phase: "finalizing" as const,
    output: "", latestLine: "", outputLines: 0, exitCode: status === "failed" ? 1 : 0,
    durationMs: 1000, startedAt: null, completedAt: null, events: []
  }) as any;

  it("treats the same build as one row regardless of shell noise around it", () => {
    expect(buildCommandIdentity("pnpm build 2>&1 | tail -2")).toBe("pnpm build");
    expect(buildCommandIdentity("cd app && pnpm build")).toBe("pnpm build");
    expect(buildCommandIdentity("cd app && ./node_modules/.bin/svelte-check && pnpm build 2>&1 | tail -1")).toBe("pnpm build");
    expect(buildCommandIdentity("pnpm build")).toBe("pnpm build");
  });

  it("collapses those runs into a single counted history row", () => {
    const history = buildHistory([
      row("pnpm build"),
      row("pnpm build 2>&1 | tail -2"),
      row("cd app && pnpm build > /tmp/out.log")
    ]);
    expect(history).toHaveLength(1);
    expect(history[0]!.command).toBe("pnpm build");
    expect(history[0]!.count).toBe(3);
    // The raw line of the most recent run stays available for the tooltip.
    expect(history[0]!.detail).toBe("cd app && pnpm build > /tmp/out.log");
  });

  it("keeps a failed run separate from a successful one", () => {
    const history = buildHistory([row("pnpm build"), row("pnpm build | tail -1", "failed")]);
    expect(history).toHaveLength(2);
    expect(history.map((entry) => entry.status).sort()).toEqual(["completed", "failed"]);
  });
});
