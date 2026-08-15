import {execFileSync} from "node:child_process";
import path from "node:path";
import {describe,expect,it} from "vitest";
import fs from "node:fs";

describe("Claude runtime model catalog",()=>{
  it("parses the official screen-reader /model picker",()=>{
    const fixture=`Claude Code v2.1.207
Select model
Switch between Claude models.
1. Default (recommended) — Opus 4.8 with 1M context · Best for everyday tasks
2. Opus — Opus 4.8 with 1M context · Best for complex tasks
3. (selected) Fable — Fable 5 · Most capable
4. Sonnet — Sonnet 5 · Efficient
5. Haiku — Haiku 4.5 · Fastest
Enter selection [1-5], or Escape to cancel:`;
    const helper=path.resolve(import.meta.dirname,"../../../bin/claude-models.py"),parsed=JSON.parse(execFileSync("python3",[helper,"parse"],{input:fixture,encoding:"utf8"}));
    expect(parsed.models.map((item:any)=>item.id)).toEqual(["default","claude-opus-4-8","claude-fable-5","claude-sonnet-5","claude-haiku-4-5"]);
    expect(parsed.models.find((item:any)=>item.id==="claude-opus-4-8").displayName).toContain("1M");
  });

  it("does not inject installation-wide fixed custom models into the runtime catalog",()=>{const source=fs.readFileSync(path.resolve(import.meta.dirname,"../../src/server/claude-model-catalog.ts"),"utf8");expect(source).not.toContain("CLAUDE_CUSTOM_MODELS");expect(source).not.toContain("claude-opus-4-6[1m]");});
});
