import fs from "node:fs";
import path from "node:path";
import {describe,expect,it} from "vitest";

const read=(relative:string)=>fs.readFileSync(path.resolve(relative),"utf8");

function sourceFiles(root:string){
  const files:string[]=[];
  const walk=(directory:string)=>{
    for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
      const file=path.join(directory,entry.name);
      if(entry.isDirectory())walk(file);else if(entry.name.endsWith(".ts")&&!entry.name.endsWith(".test.ts"))files.push(file);
    }
  };
  walk(path.resolve(root));
  return files.sort();
}

/** Every child process launch reachable on Windows. `spawn`/`spawnSync`/
 * `execFile` without `windowsHide` pops a console window for a console
 * subsystem child — node.exe, powershell.exe, git.exe, the provider CLIs and
 * the SQLite helper all qualify — which is what made a Windows session flash
 * black windows on ordinary input. */
function launchesWithoutWindowsHide(source:string){
  const pattern=/\b(spawnSync|spawn|execFileSync|execFile)\s*\(/g;
  const found:string[]=[];
  let match:RegExpExecArray|null;
  while((match=pattern.exec(source))){
    let index=match.index+match[0].length,depth=1;
    while(index<source.length&&depth>0){const character=source[index];if(character==="(")depth++;else if(character===")")depth--;index++;}
    const call=source.slice(match.index,index);
    if(!/windowsHide/.test(call))found.push(`${source.slice(0,match.index).split("\n").length}: ${call.replace(/\s+/g," ").slice(0,90)}`);
  }
  return found;
}

/** Launches that can only ever run on a POSIX host. Each one sits behind a
 * `process.platform` branch that Windows never takes, so `windowsHide` would
 * be dead configuration. Anything not listed here must hide its window. */
const POSIX_ONLY:Record<string,number>={
  "desktop-worker/service.ts":6,   // systemctl (4) + launchctl (2)
  "desktop-worker/ui.ts":4,        // osascript, zenity, open, xdg-open
  "desktop-worker/updater.ts":5,   // systemctl (2) + tar (2) + the POSIX worker-ui relaunch
  "emotion.ts":1                   // /bin/flock, behind the non-win32 branch
};

describe("Windows hidden process contract",()=>{
  it("hides every Windows-reachable child process launch in the server tree",()=>{
    const offenders:Record<string,string[]>={};
    for(const file of sourceFiles("src/server")){
      const relative=path.relative(path.resolve("src/server"),file).split(path.sep).join("/");
      const found=launchesWithoutWindowsHide(fs.readFileSync(file,"utf8"));
      const allowed=POSIX_ONLY[relative]??0;
      if(found.length>allowed)offenders[relative]=found;
      expect(found.length,`${relative} allows ${allowed} POSIX-only launches`).toBeLessThanOrEqual(allowed);
    }
    expect(offenders).toEqual({});
  });

  it("keeps the POSIX-only allowlist honest",()=>{
    for(const [relative,allowed] of Object.entries(POSIX_ONLY)){
      const found=launchesWithoutWindowsHide(read(path.join("src/server",relative)));
      expect(found.length,`${relative} no longer has ${allowed} POSIX-only launches`).toBe(allowed);
    }
  });

  it("hides the managed local Worker task launch, identity probes and termination",()=>{
    const tasks=read("src/server/desktop-worker/tasks.ts"),processHelper=read("src/server/process.ts"),policy=read("src/server/execution-policy.ts"),service=read("src/server/desktop-worker/service.ts");
    expect(tasks).toContain("detached:true,shell:false,windowsHide:true");
    expect(tasks).toContain('spawnSync("taskkill",["/PID",String(pid),"/T"],{shell:false,windowsHide:true');
    expect(processHelper).toContain("shell: false, windowsHide:true");
    expect(policy).toContain("shell:false,windowsHide:true,timeout");
    expect(service.match(/windowsHide:true/g)?.length).toBe(5);
  });

  it("hides the launches a Windows session hits on every turn",()=>{
    // The provider workers, the emotion hook and the SQLite worker are spawned
    // per task/turn, so an unhidden launch here is a visible window flash.
    expect(read("src/server/worker-emotion.ts")).toContain("shell:false,windowsHide:true");
    expect(read("src/server/db/client.ts")).toContain("shell:false,windowsHide:true");
    for(const provider of ["claude","codex","compatible","grok","antigravity"])
      expect(read(`src/server/providers/${provider}.ts`),provider).toMatch(/windowsHide:\s*true/);
  });
});
