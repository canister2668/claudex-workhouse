import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFile } from "node:child_process";
import { sanitizeSensitiveText } from "./sensitive-data.js";

// Grok updates itself, but it picks the update path from `[cli] installer` in
// config.toml, and that field drifts: a native `~/.grok/bin` install was found
// marked `installer = "npm"`, so `grok update` tried `npm i -g` instead of
// replacing the binary Workhouse actually launches. The install layout on disk
// is the truth, so Workhouse derives the installer from it and passes it as
// `GROK_INSTALLER`, which the CLI ranks above config.toml.
export type GrokInstaller="internal"|"npm";
export type GrokInstallLayout={installer:GrokInstaller;home:string|null};
export type GrokUpdateCheck={current:string|null;latest:string|null;updateAvailable:boolean|null;installer:GrokInstaller|null;error:string|null};

/** Matches the API rejection a too-old CLI gets: `status 426 Upgrade Required … Your Grok CLI version (1.0.0) is outdated`. */
export const GROK_OUTDATED_CLI_PATTERN=/Grok CLI version \([^)]*\) is outdated|status 426 Upgrade Required/i;

const realpath=(file:string)=>{try{return fs.realpathSync(file);}catch{return null;}};

export function grokInstallLayout(binary:string):GrokInstallLayout|null{
  const resolved=realpath(binary);if(!resolved)return null;
  if(resolved.split(/[\\/]/).includes("node_modules"))return{installer:"npm",home:null};
  const directory=path.dirname(binary),home=path.dirname(directory);
  if(path.basename(directory)!=="bin"||!/^grok(?:-[0-9][a-z0-9._-]*)?(?:\.exe)?$/i.test(path.basename(binary)))return null;
  // The native installer keeps `bin/grok` pointing into `downloads/` and
  // writes `version.json`; a bare `bin` directory elsewhere is a manual copy
  // the CLI cannot replace.
  return ["downloads","version.json","config.toml"].some(name=>fs.existsSync(path.join(home,name)))?{installer:"internal",home}:null;
}

export function grokUpdateEnvironment(layout:GrokInstallLayout,base:NodeJS.ProcessEnv=process.env):NodeJS.ProcessEnv{
  const env:NodeJS.ProcessEnv={};
  // An inherited npm lifecycle environment makes the CLI believe npm manages it.
  for(const[key,value]of Object.entries(base))if(!/^npm_/i.test(key))env[key]=value;
  env.GROK_INSTALLER=layout.installer;env.GROK_AUTO_UPDATE="0";
  if(layout.home)env.GROK_HOME=layout.home;else delete env.GROK_HOME;
  return env;
}

function run(file:string,args:string[],env:NodeJS.ProcessEnv,timeout:number){
  return new Promise<string>((resolve,reject)=>{
    const child=execFile(file,args,{cwd:path.dirname(file),env,timeout,maxBuffer:2*1024*1024,windowsHide:true},(error,stdout,stderr)=>{
      if(error)return reject(new Error(sanitizeSensitiveText(String(stderr||stdout||error.message)).trim().slice(-2000)||"Grok update failed."));
      resolve(sanitizeSensitiveText(String(stdout)));
    });
    child.stdin?.end();
  });
}

const text=(value:unknown)=>typeof value==="string"&&value.trim()?value.trim():null;

export function parseGrokUpdateCheck(output:string):GrokUpdateCheck{
  const line=output.split(/\r?\n/).map(value=>value.trim()).reverse().find(value=>value.startsWith("{"));
  if(!line)throw new Error("Grok update check returned no JSON.");
  const value=JSON.parse(line);
  const installer=value?.installer==="internal"||value?.installer==="npm"?value.installer:null;
  return{current:text(value?.currentVersion),latest:text(value?.latestVersion),updateAvailable:typeof value?.updateAvailable==="boolean"?value.updateAvailable:null,installer,error:text(value?.error)};
}

export async function checkGrokCliUpdate(binary:string):Promise<GrokUpdateCheck>{
  const layout=grokInstallLayout(binary);if(!layout)throw Object.assign(new Error("Grok CLI is not installed in an updatable location."),{statusCode:409});
  return parseGrokUpdateCheck(await run(binary,["update","--check","--json"],grokUpdateEnvironment(layout),60_000));
}

let updating:Promise<void>|null=null;

/** Runs the CLI's own updater against the detected install; concurrent callers share one run. */
export function applyGrokCliUpdate(binary:string):Promise<void>{
  if(updating)return updating;
  const layout=grokInstallLayout(binary);if(!layout)return Promise.reject(Object.assign(new Error("Grok CLI is not installed in an updatable location."),{statusCode:409}));
  updating=run(binary,["update"],grokUpdateEnvironment(layout),10*60_000).then(()=>undefined).finally(()=>{updating=null;});
  return updating;
}
