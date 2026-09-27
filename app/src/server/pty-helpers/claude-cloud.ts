import fs from"node:fs";
import os from"node:os";
import path from"node:path";
import{spawnSync}from"node:child_process";
import{startTerminal,type TerminalFactory}from"./terminal.js";
import{probeEnvironment}from"./claude-usage.js";

/** Node port of bin/claude-cloud.py for hosts without a POSIX pty (Windows).
 * `claude --cloud` only creates a session from an interactive terminal. */

const ANSI=/\x1B(?:\][^\x07]*(?:\x07|\x1B\\)|\[[0-?]*[ -/]*[@-~]|[()][A-Z0-9]|[@-_])/g;
const VIEW=/View:\s*(https:\/\/\S+)/;
const SESSION=/\b((?:session|cse)_[A-Za-z0-9]+)\b/;
const TITLE=/Created cloud session:\s*(.+)/;
const TIMEOUT_MS=300_000;

export function cleanTerminal(value:string){
  return value.replaceAll("\r","\n").replace(ANSI,"").replaceAll("\x0f","").replace(/\n{3,}/g,"\n\n");
}
export function parseCloudCreated(text:string){
  const view=VIEW.exec(text),session=view?SESSION.exec(view[1]):null;
  if(!view||!session)return null;
  const title=TITLE.exec(text);
  return{sessionId:session[1],url:view[1].split("?")[0],title:title?title[1].trim():null};
}
export function cloudFailureDetail(text:string){
  const lines=text.split(/\r\n|\r|\n/).map(line=>line.trim()).filter(Boolean);
  const start=lines.findIndex(line=>line.startsWith("Error"));
  return(start>=0?lines.slice(start):lines.slice(-6)).join(" ").slice(0,1200);
}
function git(cwd:string,...args:string[]){
  const result=spawnSync("git",["-C",cwd,...args],{encoding:"utf8",windowsHide:true,stdio:["ignore","pipe","ignore"]});
  return result.status===0?result.stdout.trim():null;
}
function ensurePrivateSeedDirectory(configHome:string){
  // A share ACL can create the CLI's upload scratch directory as 0777, and the
  // CLI then refuses to stage a bundle there. POSIX modes only.
  if(process.platform==="win32")return;
  const directory=path.join(configHome,"seed-admin");
  try{const info=fs.lstatSync(directory);if(info.isDirectory()&&info.uid===process.getuid?.()&&(info.mode&0o077))fs.chmodSync(directory,0o700);}catch{}
}
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

async function create(binary:string,cwd:string,task:string,bundle:boolean,terminalFactory:TerminalFactory,timeoutMs:number){
  const env=probeEnvironment(200,50);if(bundle)env.CCR_FORCE_BUNDLE="1";
  const terminal=terminalFactory({binary,args:["--ax-screen-reader","--no-chrome","--cloud",task],cwd,env,cols:200,rows:50});
  let trusted=false,previous="";const started=Date.now();
  try{
    while(Date.now()-started<timeoutMs){
      await terminal.settle(250);
      const text=terminal.text(),stable=text===previous;previous=text;
      if(!trusted&&text.includes("Quick safety check")&&(text.includes("Enter y/n")||text.includes("Enter to confirm"))){terminal.write("y\r");trusted=true;}
      // A pseudo console may paint the View URL over several frames; wait
      // until the screen holds still so the URL is read whole.
      if(VIEW.test(text)&&stable){await sleep(500);break;}
      if(terminal.closed)break;
    }
    return terminal.text();
  }finally{terminal.kill();await Promise.race([terminal.exit,sleep(3000)]);}
}

export async function createClaudeCloudSession(binary:string,directory:string,task:string,upload:"bundle"|"auto",options:{terminal?:TerminalFactory;timeoutMs?:number}={}){
  const top=git(directory,"rev-parse","--show-toplevel");
  if(!top)return{ok:false,code:"NOT_A_REPOSITORY",error:`${directory} is not a git repository.`};
  const home=fs.realpathSync(os.homedir()),fold=(value:string)=>process.platform==="win32"?value.toLowerCase():value;
  if(fold(home+path.sep).startsWith(fold(path.resolve(fs.realpathSync(top))+path.sep)))return{ok:false,code:"REPOSITORY_CONTAINS_HOME",error:`${top} contains the Claude home ${home}; the CLI refuses to upload it. Use a separate clone.`};
  ensurePrivateSeedDirectory(path.join(home,".claude"));
  const text=await create(path.resolve(binary),top,task,upload==="bundle",options.terminal??startTerminal,options.timeoutMs??TIMEOUT_MS);
  const created=parseCloudCreated(text);
  if(!created)return{ok:false,code:"CLOUD_SESSION_NOT_CREATED",error:cloudFailureDetail(text)||"The CLI did not report a cloud session."};
  return{ok:true,...created,repository:top,remote:git(top,"remote","get-url","origin"),branch:git(top,"rev-parse","--abbrev-ref","HEAD"),head:git(top,"rev-parse","HEAD")};
}
