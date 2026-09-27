import {execFileSync} from "node:child_process";
import path from "node:path";
import {describe,expect,it,vi} from "vitest";
import {ClaudeModelCatalog} from "../../src/server/claude-model-catalog.js";
import fs from "node:fs";
import os from "node:os";

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
    expect(parsed.models.map((item:any)=>item.id)).toEqual(["default","claude-opus-4-8[1m]","claude-fable-5","claude-sonnet-5","claude-haiku-4-5"]);
    expect(parsed.models.find((item:any)=>item.id==="claude-opus-4-8[1m]").displayName).toContain("1M");
  });

  it("parses the 2.1.278 picker whose footer no longer says 'Enter selection'",()=>{
    const fixture=`Claude Code v2.1.278
Select model
Switch between Claude models. Your pick becomes the default for new sessions.
1. Default (recommended) — Opus 5 with 1M context · Best for everyday, complex tasks
2. Opus (1M context) — Opus 5 with 1M context · Best for everyday, complex tasks
3. (selected) Fable — Fable 5.1 · Most capable for your hardest and longest-running tasks
4. Sonnet — Sonnet 5 · Efficient for routine tasks
5. Haiku — Haiku 4.5 · Fastest for quick answers
Select with numbers [1-5]. Then Enter to submit or Escape to cancel:
◐ Medium effort ←/→ to adjust
plan mode on (shift+tab to cycle)`;
    const helper=path.resolve(import.meta.dirname,"../../../bin/claude-models.py"),parsed=JSON.parse(execFileSync("python3",[helper,"parse"],{input:fixture,encoding:"utf8"}));
    expect(parsed.models.map((item:any)=>item.id)).toEqual(["default","claude-opus-5[1m]","claude-fable-5-1","claude-sonnet-5","claude-haiku-4-5"]);
    // The footer must terminate the picker, or the last row swallows the
    // status lines that follow it.
    expect(parsed.models.at(-1).description).toBe("Haiku 4.5 · Fastest for quick answers");
  });

  it("parses the 2.1.282 picker whose rows name the model in the label",()=>{
    const fixture=`Select model
Switch between Claude models. Your pick becomes the default for new sessions.
1. Default (recommended) — Opus 5.5 · Best for everyday, complex tasks
2. Opus 5.5 — Most capable for ambitious work
3. (selected) Fable 5.1 — For your toughest challenges
4. Sonnet 5 — Most efficient for everyday tasks
5. Haiku 4.5 — Fastest for quick answers
6. Opus 5 — Best for everyday, complex tasks
Select with numbers [1-6]. Then Enter to submit or Escape to cancel:
… +6 models`;
    const helper=path.resolve(import.meta.dirname,"../../../bin/claude-models.py"),parsed=JSON.parse(execFileSync("python3",[helper,"parse"],{input:fixture,encoding:"utf8"}));
    expect(parsed.models.map((item:any)=>item.id)).toEqual(["default","claude-opus-5-5","claude-fable-5-1","claude-sonnet-5","claude-haiku-4-5","claude-opus-5"]);
    expect(parsed.models.find((item:any)=>item.id==="claude-opus-5-5").displayName).toBe("Opus 5.5");
  });

  it("reads the newest complete render when the picker repaints",()=>{
    // The CLI paints its cached rows first and repaints after fetching the live
    // list, so a stale render can sit above the current one in the same buffer.
    const fixture=`Select model
1. Default (recommended) — Opus 5 with 1M context · Best for everyday tasks
2. (selected) Fable — Fable 5 · Most capable
3. Sonnet — Sonnet 5 · Efficient
Select with numbers [1-3]. Then Enter to submit or Escape to cancel:
1. Default (recommended) — Opus 5 with 1M context · Best for everyday tasks
2. (selected) Fable — Fable 5.1 · Most capable
3. Sonnet — Sonnet 5 · Efficient
Select with numbers [1-3]. Then Enter to submit or Escape to cancel:
1. Default (recommended) — Opus 5 with 1M context`;
    const helper=path.resolve(import.meta.dirname,"../../../bin/claude-models.py"),parsed=JSON.parse(execFileSync("python3",[helper,"parse"],{input:fixture,encoding:"utf8"}));
    expect(parsed.models.map((item:any)=>item.id)).toEqual(["default","claude-fable-5-1","claude-sonnet-5"]);
  });

  it("drops rows the running CLI is too old to launch",()=>{
    const fixture=`Select model
1. Default (recommended) — Opus 5 with 1M context · Best for everyday tasks
2. (selected) Fable — Fable 5 · Most capable
3. Fable 5.1 (disabled) — Update to 2.1.255+ to use Fable 5.1
Select with numbers [1-3]. Then Enter to submit or Escape to cancel:`;
    const helper=path.resolve(import.meta.dirname,"../../../bin/claude-models.py"),parsed=JSON.parse(execFileSync("python3",[helper,"parse"],{input:fixture,encoding:"utf8"}));
    expect(parsed.models.map((item:any)=>item.id)).toEqual(["default","claude-fable-5"]);
  });

  it("maps picker rows through the model registry embedded in the CLI bundle",()=>{
    // A family the regex fallback has never seen and wording that names no
    // "<Family> <version>" pair must still map when the bundle registry knows it.
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),"claude-model-registry-")),bundle=path.join(directory,"claude");
    fs.writeFileSync(bundle,`x{id:"claude-opus-5",family:"opus",display_name:"Opus 5",knowledge_cutoff:"x"}y{id:"claude-opus-5-5",family:"opus",display_name:"Opus 5.5",x:1}{id:"claude-nova-1",family:"nova",display_name:"Nova 1"}`);
    const fixture=`Select model
1. Default (recommended) — Opus 5.5 · Best for everyday tasks
2. Opus 5.5 — Most capable
3. Opus 5 — Previous generation
4. Nova 1 — Experimental
Select with numbers [1-4]. Then Enter to submit or Escape to cancel:`;
    const helper=path.resolve(import.meta.dirname,"../../../bin/claude-models.py");
    try{
      const parsed=JSON.parse(execFileSync("python3",[helper,"parse",bundle],{input:fixture,encoding:"utf8"}));
      expect(parsed.ok).toBe(true);
      expect(parsed.models.map((item:any)=>item.id)).toEqual(["default","claude-opus-5-5","claude-opus-5","claude-nova-1"]);
    }finally{fs.rmSync(directory,{recursive:true,force:true});}
  });

  it("reports an unreadable row instead of silently shortening the catalog",()=>{
    const fixture=`Select model
1. Default (recommended) — Opus 5.5 · Best for everyday tasks
2. Opus 5.5 — Most capable
3. Something New — A row this parser cannot map
Select with numbers [1-3]. Then Enter to submit or Escape to cancel:`;
    const helper=path.resolve(import.meta.dirname,"../../../bin/claude-models.py"),parsed=JSON.parse(execFileSync("python3",[helper,"parse"],{input:fixture,encoding:"utf8"}));
    expect(parsed.ok).toBe(false);
    expect(parsed.unmapped).toEqual(["Something New — A row this parser cannot map"]);
  });

  it.each([
    ["an incomplete picker parse",`{"ok":false,"error":"picker-parse-incomplete","unmapped":["x"],"models":[{"id":"default","displayName":"d"}]}`],
    ["a picker that yields only the default row",`{"ok":true,"models":[{"id":"default","displayName":"d"}]}`]
  ])("keeps the last good catalog after %s",async(_label,output)=>{
    const appRoot=fs.mkdtempSync(path.join(os.tmpdir(),"claude-model-catalog-"));
    fs.mkdirSync(path.join(appRoot,"bin"));
    fs.writeFileSync(path.join(appRoot,"bin","claude-models.py"),`print(${JSON.stringify(output)})\n`);
    const previous={models:[{id:"default",displayName:"기본값",description:"",source:"runtime"},{id:"claude-opus-5-5",displayName:"Opus 5.5",description:"",source:"runtime"}],fetchedAt:new Date(Date.now()-600_000).toISOString(),stale:false,source:"claude-cli-model-picker"};
    const db={getCache:async()=>({value:previous}),putCache:vi.fn(async()=>true)};
    try{
      const snapshot=await new ClaudeModelCatalog({appRoot,claudeBinary:"claude",dataDir:appRoot} as any,db as any).get(true);
      expect(snapshot.models.map(item=>item.id)).toEqual(["default","claude-opus-5-5"]);
      expect(snapshot.stale).toBe(true);
      expect(db.putCache).not.toHaveBeenCalled();
    }finally{fs.rmSync(appRoot,{recursive:true,force:true});}
  });

  it("keeps the hardcoded fallback aligned with the current picker rows",()=>{
    const source=fs.readFileSync(path.resolve(import.meta.dirname,"../../src/server/claude-model-catalog.ts"),"utf8");
    for(const id of ["claude-opus-5[1m]","claude-fable-5-1","claude-sonnet-5","claude-haiku-4-5"])expect(source).toContain(id);
  });

  it("keeps the picker out of first-run onboarding and answers current trust prompts",()=>{
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),"claude-model-probe-")),binary=path.join(directory,"fake-claude.py");
    // Claude Code reads onboarding state from CLAUDE_CONFIG_DIR when it is set,
    // which sends this probe into first-run setup instead of the picker.
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
    if line.strip() == "/model":
        print("Select model",flush=True)
        print("1. Default (recommended) — Opus 5 with 1M context · Best for everyday tasks",flush=True)
        print("2. (selected) Fable — Fable 5.1 · Most capable",flush=True)
        print("Select with numbers [1-2]. Then Enter to submit or Escape to cancel:",flush=True)
    elif line.strip() == "/exit":
        break
`);
    fs.chmodSync(binary,0o700);
    const helper=path.resolve(import.meta.dirname,"../../../bin/claude-models.py");
    try{
      const parsed=JSON.parse(execFileSync("python3",[helper,binary,directory],{encoding:"utf8",timeout:40_000,env:{...process.env,CLAUDE_CONFIG_DIR:path.join(directory,".claude")}}));
      expect(parsed.ok).toBe(true);
      expect(parsed.models.map((item:any)=>item.id)).toEqual(["default","claude-fable-5-1"]);
    }finally{fs.rmSync(directory,{recursive:true,force:true});}
  });

  it("does not inject installation-wide fixed custom models into the runtime catalog",()=>{const source=fs.readFileSync(path.resolve(import.meta.dirname,"../../src/server/claude-model-catalog.ts"),"utf8");expect(source).not.toContain("CLAUDE_CUSTOM_MODELS");expect(source).not.toContain("claude-opus-4-6[1m]");});
});
