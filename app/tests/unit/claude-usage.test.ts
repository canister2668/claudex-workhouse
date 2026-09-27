import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe,expect,it } from "vitest";

const helper=path.resolve(import.meta.dirname,"../../../bin/claude-usage.py");

describe("Claude CLI usage parser",()=>{
  it("parses screen-reader /usage output without account details",()=>{
    const fixture=`Claude Code v2.1.207
Fable 5 with medium effort · Claude Max · user@example.com's Organization
Current session
12% 12% used
Resets 11:30pm (Asia/Seoul)
Current week (all models)
30% 30% used
Resets Jul 16, 9:59pm (Asia/Seoul)
Current week (Fable)
34% 34% used`;
    const parsed=JSON.parse(execFileSync("python3",[helper,"parse"],{input:fixture,encoding:"utf8"}));
    expect(parsed.ok).toBe(true);
    expect(parsed.plan).toBe("Max");
    expect(parsed.five_hour.utilization).toBe(12);
    expect(parsed.five_hour.reset_label).toBe("11:30pm (Asia/Seoul)");
    expect(parsed.seven_day.utilization).toBe(30);
    expect(parsed.seven_day.reset_label).toBe("Jul 16, 9:59pm (Asia/Seoul)");
    expect(JSON.stringify(parsed)).not.toContain("user@example.com");
  });

  it("answers current trust prompts without loading external instructions",()=>{
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),"claude-usage-prompt-")),binary=path.join(directory,"fake-claude.py");
    fs.writeFileSync(binary,`#!/usr/bin/env python3
import sys
import os
if "CLAUDE_CONFIG_DIR" in os.environ: raise SystemExit(4)
print("Quick safety check: trusted folder?",flush=True)
print("Enter y/n:",flush=True)
if sys.stdin.readline().strip().lower() != "y": raise SystemExit(2)
print("Allow external CLAUDE.md file imports?",flush=True)
print("Enter y/n:",flush=True)
if sys.stdin.readline().strip().lower() != "n": raise SystemExit(3)
print("plan mode on",flush=True)
for line in sys.stdin:
    if line.strip() == "/usage":
        print("Claude Max",flush=True)
        print("Current session",flush=True)
        print("12% used",flush=True)
        print("Current week (all models)",flush=True)
        print("30% used",flush=True)
    elif line.strip() == "/exit":
        break
`);
    fs.chmodSync(binary,0o700);
    try{
      const parsed=JSON.parse(execFileSync("python3",[helper,binary,directory],{encoding:"utf8",timeout:10_000,env:{...process.env,CLAUDE_CONFIG_DIR:path.join(directory,".claude")}}));
      expect(parsed).toMatchObject({ok:true,plan:"Max",five_hour:{utilization:12},seven_day:{utilization:30}});
    }finally{fs.rmSync(directory,{recursive:true,force:true});}
  });

  it("reports a throttled usage screen as rate limited instead of unavailable",()=>{
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),"claude-usage-limited-")),binary=path.join(directory,"fake-claude.py");
    fs.writeFileSync(binary,`#!/usr/bin/env python3
import os
import sys
import tty
tty.setcbreak(0)  # the real TUI reads single keys, so the retry key needs no newline
print("plan mode on",flush=True)
while os.read(0,1) not in (b"\\r", b"\\n"): pass
while True:
    print("Error: Usage endpoint is rate limited. Please try again in a moment.",flush=True)
    print("r to retry",flush=True)
    if not os.read(0,1): break
`);
    fs.chmodSync(binary,0o700);
    try{
      const parsed=JSON.parse(execFileSync("python3",[helper,binary,directory],{encoding:"utf8",timeout:30_000,env:{...process.env,CLAUDE_USAGE_RETRY_SECONDS:"0.2"}}));
      expect(parsed).toMatchObject({ok:false,error:"rate_limited"});
    }finally{fs.rmSync(directory,{recursive:true,force:true});}
  });

  it("recovers when the in-screen retry clears the throttle",()=>{
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),"claude-usage-retry-")),binary=path.join(directory,"fake-claude.py");
    fs.writeFileSync(binary,`#!/usr/bin/env python3
import os
import sys
import tty
tty.setcbreak(0)  # the real TUI reads single keys, so the retry key needs no newline
print("plan mode on",flush=True)
while os.read(0,1) not in (b"\\r", b"\\n"): pass
print("Error: Usage endpoint is rate limited. Please try again in a moment.",flush=True)
print("r to retry",flush=True)
os.read(0,1)
print("Claude Max",flush=True)
print("Current session",flush=True)
print("7% used",flush=True)
print("Current week (all models)",flush=True)
print("21% used",flush=True)
while os.read(0,1): pass
`);
    fs.chmodSync(binary,0o700);
    try{
      const parsed=JSON.parse(execFileSync("python3",[helper,binary,directory],{encoding:"utf8",timeout:30_000,env:{...process.env,CLAUDE_USAGE_RETRY_SECONDS:"0.2"}}));
      expect(parsed).toMatchObject({ok:true,five_hour:{utilization:7},seven_day:{utilization:21}});
    }finally{fs.rmSync(directory,{recursive:true,force:true});}
  });
});
