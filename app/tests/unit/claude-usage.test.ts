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
});
