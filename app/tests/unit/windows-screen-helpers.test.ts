import{execFileSync}from"node:child_process";
import fs from"node:fs";
import os from"node:os";
import path from"node:path";
import{afterEach,describe,expect,it}from"vitest";
import{VirtualScreen}from"../../src/server/pty-helpers/virtual-screen.js";
import{parseClaudeUsage,probeClaudeUsage}from"../../src/server/pty-helpers/claude-usage.js";
import{parsePicker,probeClaudeModels,readRegistry}from"../../src/server/pty-helpers/claude-models.js";
import{cleanTerminal,cloudFailureDetail,parseCloudCreated}from"../../src/server/pty-helpers/claude-cloud.js";
import{runClaudeAuth}from"../../src/server/pty-helpers/claude-auth.js";

const bin=path.resolve(import.meta.dirname,"../../../bin");
const python=(script:string,args:string[],input:string)=>JSON.parse(execFileSync("python3",[path.join(bin,script),...args],{input,encoding:"utf8"}));
const roots:string[]=[];
const temporary=()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),"workhouse-screen-"));roots.push(root);return root;};
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});

describe("virtual screen for ConPTY output",()=>{
  it("turns conhost's cursor-forward spacing and repaints back into text",()=>{
    // Captured shape of a pseudo console repaint: spaces arrive as CUF, the
    // cursor is hidden around every glyph, and the screen starts with a clear.
    const screen=new VirtualScreen(80,10);
    screen.write("\x1b[2J\x1b[m\x1b[H\x1b[?25lQ\x1b[?25hu\x1b[?25hick\x1b[K\x1b[1Csafety\x1b[1Ccheck\r\nEnter\x1b[1Cy/n\r\n");
    expect(screen.text()).toBe("Quick safety check\nEnter y/n");
    screen.write("\x1b[1;7Hstatus\x1b[K");
    expect(screen.text().split("\n")[0]).toBe("Quick status");
  });

  it("keeps a wrapped line as one line and scrolled rows as history",()=>{
    const screen=new VirtualScreen(10,3),url="https://claude.com/oauth/authorize?code=abcdefghijklmnop";
    screen.write(`${url}\r\n`);
    for(let index=0;index<5;index++)screen.write(`line ${index}\r\n`);
    const text=screen.text();
    expect(text.split("\n")).toContain(url);
    expect(text).toContain("line 0");
    expect(text).toContain("line 4");
  });

  it("completes an escape sequence split across chunks",()=>{
    const screen=new VirtualScreen(40,4);
    screen.write("ab\x1b[");screen.write("3Ccd\x1b]0;title");screen.write("\x07ef");
    expect(screen.text()).toBe("ab   cdef");
  });
});

describe("Node screen helpers match the Python helpers",()=>{
  const usageFixtures=[
    `Claude Code v2.1.207\nFable 5 with medium effort · Claude Max · user@example.com's Organization\nCurrent session\n12% 12% used\nResets 11:30pm (Asia/Seoul)\nCurrent week (all models)\n30% 30% used\nResets Jul 16, 9:59pm (Asia/Seoul)\nCurrent week (Fable)\n34% 34% used`,
    `Claude Pro\nCurrent session\n0% used\nCurrent week (all models)\n101% used\nWhat's contributing to your limits`,
    `Error: Usage endpoint is rate limited. Please try again in a moment.`,
    ``
  ];
  it.each(usageFixtures.map((fixture,index)=>[index,fixture]))("parses /usage fixture %i identically",(_index,fixture)=>{
    expect(parseClaudeUsage(fixture as string)).toEqual(python("claude-usage.py",["parse"],fixture as string));
  });

  const pickerFixtures=[
    `Claude Code v2.1.207\nSelect model\nSwitch between Claude models.\n1. Default (recommended) — Opus 4.8 with 1M context · Best for everyday tasks\n2. Opus — Opus 4.8 with 1M context · Best for complex tasks\n3. (selected) Fable — Fable 5 · Most capable\n4. Sonnet — Sonnet 5 · Efficient\n5. Haiku — Haiku 4.5 · Fastest\nEnter selection [1-5], or Escape to cancel:`,
    `Select model\n1. Default (recommended) — Opus 5 with 1M context · Best for everyday, complex tasks\n2. Opus (1M context) — Opus 5 with 1M context · Best\n3. (selected) Fable — Fable 5.1 · Most capable\n4. Sonnet — Sonnet 5 · Efficient\n5. Haiku — Haiku 4.5 · Fastest for quick answers\nSelect with numbers [1-5]. Then Enter to submit or Escape to cancel:\n◐ Medium effort ←/→ to adjust\nplan mode on (shift+tab to cycle)`,
    `Select model\n1. Default (recommended) — Opus 5.5 · Best\n2. Opus 5.5 — Most capable\n3. (selected) Fable 5.1 — Toughest\n4. Sonnet 5 — Efficient\n5. Haiku 4.5 — Fastest\n6. Opus 5 — Everyday\nSelect with numbers [1-6]. Then Enter to submit or Escape to cancel:\n… +6 models`,
    `Select model\n1. Default (recommended) — Opus 5 with 1M context · Best\n2. (selected) Fable — Fable 5 · Most capable\n3. Sonnet — Sonnet 5 · Efficient\nSelect with numbers [1-3]. Then Enter to submit or Escape to cancel:\n1. Default (recommended) — Opus 5 with 1M context · Best\n2. (selected) Fable — Fable 5.1 · Most capable\n3. Sonnet — Sonnet 5 · Efficient\nSelect with numbers [1-3]. Then Enter to submit or Escape to cancel:\n1. Default (recommended) — Opus 5 with 1M context`,
    `Select model\n1. Default (recommended) — Opus 5 with 1M context · Best\n2. (selected) Fable — Fable 5 · Most capable\n3. Fable 5.1 (disabled) — Update to 2.1.255+ to use Fable 5.1\nSelect with numbers [1-3]. Then Enter to submit or Escape to cancel:`,
    `Select model\n1. Default (recommended) — Opus 5.5 · Best\n2. Opus 5.5 — Most capable\n3. Something New — A row this parser cannot map\nSelect with numbers [1-3]. Then Enter to submit or Escape to cancel:`,
    `no picker here`
  ];
  it.each(pickerFixtures.map((fixture,index)=>[index,fixture]))("parses /model fixture %i identically",(_index,fixture)=>{
    const parsed=parsePicker(fixture as string);
    expect({ok:parsed.complete,...parsed}).toEqual(python("claude-models.py",["parse"],fixture as string));
  });

  it("reads the embedded model registry identically",()=>{
    const directory=temporary(),bundle=path.join(directory,"claude");
    // Pad past one read chunk so a registry entry straddles the boundary.
    fs.writeFileSync(bundle,Buffer.concat([Buffer.from(`x{id:"claude-opus-5",family:"opus",display_name:"Opus 5",k:"x"}`),Buffer.alloc(8*1024*1024-20,0x20),Buffer.from(`{id:"claude-opus-5-5",family:"opus",display_name:"Opus 5.5",x:1}{id:"claude-nova-1",family:"nova",display_name:"Nova 1"}`)]));
    const fixture=`Select model\n1. Default (recommended) — Opus 5.5 · Best\n2. Opus 5.5 — Most capable\n3. Opus 5 — Previous\n4. Nova 1 — Experimental\nSelect with numbers [1-4]. Then Enter to submit or Escape to cancel:`;
    expect(readRegistry(bundle).map(item=>item.id)).toEqual(["claude-opus-5","claude-opus-5-5","claude-nova-1"]);
    const parsed=parsePicker(fixture,readRegistry(bundle));
    expect({ok:parsed.complete,...parsed}).toEqual(python("claude-models.py",["parse",bundle],fixture));
  });

  it.each([
    ["[Screen Reader Mode: on via flag]\n\u001b[1mCreated cloud session: README line count\u001b[0m\nView: https://claude.ai/code/session_01FZASVa7teunMzNmBw3bdGv?from=cli&m=0\n"],
    ["Quick safety check\nError: Not uploading this working tree: this checkout's git root is your home\ndirectory.\n"]
  ])("parses cloud output identically",fixture=>{
    const text=cleanTerminal(fixture);
    expect({created:parseCloudCreated(text),error:cloudFailureDetail(text)}).toEqual(python("claude-cloud.py",["parse"],fixture));
  });
});

/** A Claude Code stand-in written in Node so these tests exercise the Node
 * helpers end to end through a real pty (util-linux `script`). */
function fakeClaude(directory:string,body:string){
  const file=path.join(directory,"fake-claude.mjs");
  fs.writeFileSync(file,`#!${process.execPath}\nimport readline from"node:readline";\nconst say=text=>process.stdout.write(text+"\\n");\nconst lines=readline.createInterface({input:process.stdin});const queue=[];let wake=null;lines.on("line",line=>{queue.push(line.trim());wake?.();});\nconst next=async()=>{while(!queue.length)await new Promise(resolve=>wake=resolve);return queue.shift();};\n${body}\n`);
  fs.chmodSync(file,0o700);return file;
}
const hasScript=(()=>{try{execFileSync("script",["--version"],{stdio:"ignore"});return true;}catch{return false;}})();

describe.skipIf(!hasScript||process.platform==="win32")("Node screen helpers through a terminal",()=>{
  it("answers the trust prompts and reads /usage",async()=>{
    const directory=temporary(),binary=fakeClaude(directory,`
if(process.env.CLAUDE_CONFIG_DIR)process.exit(4);
say("Quick safety check: trusted folder?");say("Enter y/n:");if((await next()).toLowerCase()!=="y")process.exit(2);
say("Allow external CLAUDE.md file imports?");say("Enter y/n:");if((await next()).toLowerCase()!=="n")process.exit(3);
say("plan mode on");
for(;;){const line=await next();if(line==="/usage"){say("Claude Max");say("Current session");say("12% used");say("Current week (all models)");say("30% used");}else if(line.endsWith("/exit"))process.exit(0);}`);
    process.env.CLAUDE_CONFIG_DIR=path.join(directory,".claude");
    try{
      const result=await probeClaudeUsage(binary,path.join(directory,"probe"),{timeoutMs:20_000});
      expect(result).toMatchObject({ok:true,plan:"Max",five_hour:{utilization:12},seven_day:{utilization:30}});
    }finally{delete process.env.CLAUDE_CONFIG_DIR;}
  },30_000);

  it("reads the /model picker",async()=>{
    const directory=temporary(),binary=fakeClaude(directory,`
say("plan mode on");
for(;;){const line=await next();if(line==="/model"){say("Select model");say("1. Default (recommended) — Opus 5.5 · Best");say("2. Opus 5.5 — Most capable");say("3. Sonnet 5 — Efficient");say("Select with numbers [1-3]. Then Enter to submit or Escape to cancel:");}else if(line.endsWith("/exit"))process.exit(0);}`);
    const result=await probeClaudeModels(binary,path.join(directory,"probe"),{timeoutMs:20_000});
    expect(result).toMatchObject({ok:true,source:"claude-cli-model-picker"});
    expect(result.models.map((item:any)=>item.id)).toEqual(["default","claude-opus-5-5","claude-sonnet-5"]);
  },30_000);

  it("runs the login protocol without echoing the submitted code",async()=>{
    const directory=temporary(),binary=fakeClaude(directory,`
say("Open https://claude.com/oauth/authorize?client_id=abc&state=xyz to sign in.");say("Paste code here if prompted >");
const code=await next();say(code==="CODE-123"?"Login successful":"bad");process.exit(code==="CODE-123"?0:1);`);
    const events:any[]=[];let deliver:(message:any)=>void=()=>{};
    const done=runClaudeAuth({binary,cwd:directory,mode:"subscription",attemptId:"a1",marker:"m1",emit:(event,values={})=>{events.push({event,...values});if(event==="helper/code-required")deliver({type:"code",value:"CODE-123"});},messages:{onMessage:listener=>{deliver=listener;},onClose:()=>{}},timeoutMs:20_000});
    await done;
    // The URL is reported once, whole, on a settled screen and before the
    // code prompt.
    expect(events.map(item=>item.event)).toEqual(["helper/start","helper/url","helper/code-required","helper/verifying","helper/exit"]);
    expect(events.find(item=>item.event==="helper/url").url).toBe("https://claude.com/oauth/authorize?client_id=abc&state=xyz");
    expect(events.at(-1).exitCode).toBe(0);
    expect(JSON.stringify(events)).not.toContain("CODE-123");
  },30_000);
});
