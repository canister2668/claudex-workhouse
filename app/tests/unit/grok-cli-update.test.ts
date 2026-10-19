import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach,describe,expect,it } from "vitest";
import { GROK_OUTDATED_CLI_PATTERN,grokInstallLayout,grokUpdateEnvironment,parseGrokUpdateCheck } from "../../src/server/grok-cli-update.js";
import { grokLauncherFirst } from "../../src/server/grok-runtime.js";

const roots:string[]=[];
const tempRoot=()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),"grok-cli-update-"));roots.push(root);return root;};
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});

describe("grok cli update",()=>{
  it("derives the installer from the native layout, not from config.toml",()=>{
    const home=path.join(tempRoot(),".grok");fs.mkdirSync(path.join(home,"bin"),{recursive:true});fs.mkdirSync(path.join(home,"downloads"));
    fs.writeFileSync(path.join(home,"config.toml"),'[cli]\ninstaller = "npm"\n');
    const download=path.join(home,"downloads","grok-1.0.50-linux-x86_64");fs.writeFileSync(download,"",{mode:0o755});
    fs.symlinkSync("../downloads/grok-1.0.50-linux-x86_64",path.join(home,"bin","grok"));
    expect(grokInstallLayout(path.join(home,"bin","grok"))).toEqual({installer:"internal",home});
  });

  it("recognizes npm installs and refuses copies the CLI cannot replace",()=>{
    const root=tempRoot(),npm=path.join(root,"lib","node_modules","@xai-official","grok","bin","grok");
    fs.mkdirSync(path.dirname(npm),{recursive:true});fs.writeFileSync(npm,"");
    expect(grokInstallLayout(npm)).toEqual({installer:"npm",home:null});
    const loose=path.join(root,"tools","grok");fs.mkdirSync(path.dirname(loose));fs.writeFileSync(loose,"");
    expect(grokInstallLayout(loose)).toBeNull();
    expect(grokInstallLayout(path.join(root,"missing","bin","grok"))).toBeNull();
  });

  it("pins the installer and home and drops npm lifecycle variables",()=>{
    const env=grokUpdateEnvironment({installer:"internal",home:"/home/u/.grok"},{PATH:"/bin",npm_config_user_agent:"pnpm/9",GROK_HOME:"/tmp/task/grok-home"});
    expect(env).toEqual({PATH:"/bin",GROK_INSTALLER:"internal",GROK_AUTO_UPDATE:"0",GROK_HOME:"/home/u/.grok"});
  });

  it("parses the JSON update check",()=>{
    expect(parseGrokUpdateCheck('{"currentVersion":"1.0.0","latestVersion":"1.0.50","updateAvailable":true,"installer":"internal","channel":"stable","autoUpdate":null,"error":null}\n'))
      .toEqual({current:"1.0.0",latest:"1.0.50",updateAvailable:true,installer:"internal",error:null});
    expect(()=>parseGrokUpdateCheck("Checking for updates...")).toThrow();
  });

  it("recognizes the xAI rejection of an outdated CLI",()=>{
    expect(GROK_OUTDATED_CLI_PATTERN.test('"message": "API error (status 426 Upgrade Required): Your Grok CLI version (1.0.0) is outdated. Please update to version 1.0.13 or later via `grok update`'))
      .toBe(true);
    expect(GROK_OUTDATED_CLI_PATTERN.test("API error (status 429 Too Many Requests)")).toBe(false);
  });

  it("prefers the launcher that `grok update` repoints over stale versioned files",()=>{
    expect(["grok-1.0.0","agent","grok"].filter(name=>name.startsWith("grok")).sort(grokLauncherFirst)).toEqual(["grok","grok-1.0.0"]);
    expect(["grok-1.0.9","grok-1.0.10"].sort(grokLauncherFirst)).toEqual(["grok-1.0.10","grok-1.0.9"]);
  });
});
