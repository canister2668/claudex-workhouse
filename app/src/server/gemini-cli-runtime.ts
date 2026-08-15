import fs from "node:fs";
import path from "node:path";
import type {AutomationLevel} from "./automation-level.js";

/**
 * Resolution, argument construction, and failure classification for the official
 * Gemini CLI (`@google/gemini-cli`), which Workhouse runs as the `vertex-agent`
 * execution backend of the Gemini provider.
 *
 * Everything here is derived from the behaviour of Gemini CLI 0.55.1 as
 * observed on this host, not from documentation: the flag set, the exit codes,
 * and the stream-json envelope were all read back from a live runtime.
 */

export const GEMINI_CLI_PACKAGE="@google/gemini-cli";
const BUNDLE_RELATIVE=path.join("node_modules","@google","gemini-cli","bundle","gemini.js");

export type GeminiCliEntry=
  /** A JS bundle executed with the Workhouse node binary. */
  {kind:"bundle";entry:string}|
  /** A launcher on PATH or an absolute executable. */
  {kind:"binary";entry:string};

function readable(file:string){try{fs.accessSync(file,fs.constants.R_OK);return fs.statSync(file).isFile();}catch{return false;}}
function executable(file:string){try{fs.accessSync(file,fs.constants.X_OK);return fs.statSync(file).isFile();}catch{return false;}}

/** `<dataRoot>/runtime/gemini-cli` mirrors the managed `runtime/bin` layout the
 * other CLI providers use, so an operator update replaces one directory. */
export function geminiCliRuntimeDirectory(dataRoot:string){return path.join(dataRoot,"runtime","gemini-cli");}

/**
 * Explicit override first, then the Workhouse-managed install, then PATH. A
 * PATH-only install is accepted but is never the thing we depend on: the
 * managed copy is what the readiness report calls "managed".
 */
export function resolveGeminiCliEntry(dataRoot:string,pathValue=String(process.env.PATH??"")):GeminiCliEntry|null{
  const configured=String(process.env.CLAUDEX_WORKHOUSE_GEMINI_CLI??"").trim();
  if(configured){
    if(configured.endsWith(".js")&&readable(configured))return{kind:"bundle",entry:configured};
    if(executable(configured))return{kind:"binary",entry:configured};
    const managedBundle=path.join(configured,BUNDLE_RELATIVE);
    if(readable(managedBundle))return{kind:"bundle",entry:managedBundle};
    return null;
  }
  const managed=path.join(geminiCliRuntimeDirectory(dataRoot),BUNDLE_RELATIVE);
  if(readable(managed))return{kind:"bundle",entry:managed};
  for(const directory of pathValue.split(path.delimiter)){
    if(!directory)continue;
    const candidate=path.join(directory,process.platform==="win32"?"gemini.cmd":"gemini");
    if(executable(candidate))return{kind:"binary",entry:candidate};
  }
  return null;
}

/** Installed version, read from the package manifest rather than by spawning the
 * CLI: readiness must stay cheap enough to run on a settings page load. */
export function geminiCliInstalledVersion(dataRoot:string,entry:GeminiCliEntry|null=resolveGeminiCliEntry(dataRoot)){
  if(!entry)return null;
  const candidates=entry.kind==="bundle"
    ?[path.join(path.dirname(path.dirname(entry.entry)),"package.json")]
    :[path.join(path.dirname(path.dirname(entry.entry)),"lib","node_modules",GEMINI_CLI_PACKAGE,"package.json")];
  for(const candidate of candidates)try{
    const value=JSON.parse(fs.readFileSync(candidate,"utf8"));
    if(typeof value?.version==="string"&&value.name===GEMINI_CLI_PACKAGE)return value.version;
  }catch{/* fall through to the next manifest location */}
  return null;
}

/** Ripgrep only changes search speed: the CLI falls back to its own grep tool.
 * It is reported as a performance note, never as a readiness failure. */
export function ripgrepAvailable(pathValue=String(process.env.PATH??"")){
  return pathValue.split(path.delimiter).some(directory=>directory&&executable(path.join(directory,process.platform==="win32"?"rg.exe":"rg")));
}

export type GeminiApprovalMode="default"|"auto_edit"|"yolo"|"plan";

/**
 * Verified against Gemini CLI 0.55.1 in headless mode:
 *
 * - `default`   the agent is given read-only tools only. It cannot write and it
 *               has no shell tool at all, because nothing can answer an
 *               approval prompt when there is no terminal.
 * - `auto_edit` file edits run unattended; the shell tool stays unavailable.
 * - `yolo`      every tool runs unattended, including the shell.
 * - `plan`      read-only planning mode.
 *
 * Workhouse `workspace-write` therefore lands on `auto_edit`, which is stricter
 * than the same profile on Codex or Claude: those run workspace shell commands,
 * this one cannot. The gap is deliberate and documented — the alternative
 * (`yolo`) would silently grant unattended shell access to a profile the user
 * chose precisely to avoid it.
 */
export function geminiApprovalMode(level:AutomationLevel,workMode:string):GeminiApprovalMode{
  if(workMode==="plan")return"plan";
  if(level==="full")return"yolo";
  if(level==="read")return"default";
  return"auto_edit";
}

/** True when the profile cannot reach the shell tool, so the worker can say so
 * up front instead of letting the model report a confusing tool gap. */
export function geminiShellAvailable(mode:GeminiApprovalMode){return mode==="yolo";}

export type GeminiCliLaunch={mode:"new"|"resume"|"fork";sessionId:string|null;sessionFile:string|null};

export function geminiCliArguments(input:{
  prompt:string;
  model:string|null;
  approvalMode:GeminiApprovalMode;
  launch:GeminiCliLaunch;
  includeDirectories?:string[];
}){
  const args=["--output-format","stream-json","--approval-mode",input.approvalMode,"--skip-trust"];
  if(input.model)args.push("--model",input.model);
  // --resume, --session-id and --session-file are mutually exclusive in the CLI.
  if(input.launch.mode==="resume"&&input.launch.sessionId)args.push("--resume",input.launch.sessionId);
  else if(input.launch.mode==="fork"&&input.launch.sessionFile)args.push("--session-file",input.launch.sessionFile);
  else if(input.launch.sessionId)args.push("--session-id",input.launch.sessionId);
  for(const directory of input.includeDirectories??[])args.push("--include-directories",directory);
  args.push("--prompt",input.prompt);
  return args;
}

/**
 * Session transcripts live at
 * `$HOME/.gemini/tmp/<project label>/chats/session-*.jsonl`, where the label
 * comes from `$HOME/.gemini/projects.json`. The file name only carries the
 * first eight characters of the session id, so candidates are confirmed by
 * reading the id out of the header line instead of trusting the name.
 */
export function resolveGeminiSessionFile(home:string,sessionId:string,cwd?:string){
  const geminiDir=path.join(home,".gemini"),chatRoots:string[]=[];
  let labels:string[]=[];
  try{
    const projects=JSON.parse(fs.readFileSync(path.join(geminiDir,"projects.json"),"utf8"))?.projects;
    if(projects&&typeof projects==="object"){
      const preferred=cwd&&typeof projects[cwd]==="string"?String(projects[cwd]):null;
      labels=preferred?[preferred,...Object.values(projects).filter((value):value is string=>typeof value==="string"&&value!==preferred)]:Object.values(projects).filter((value):value is string=>typeof value==="string");
    }
  }catch{/* no project registry yet; fall back to a directory scan */}
  if(!labels.length)try{labels=fs.readdirSync(path.join(geminiDir,"tmp"),{withFileTypes:true}).filter(entry=>entry.isDirectory()).map(entry=>entry.name);}catch{return null;}
  for(const label of labels)chatRoots.push(path.join(geminiDir,"tmp",label,"chats"));
  for(const root of chatRoots){
    let entries:string[];
    try{entries=fs.readdirSync(root).filter(name=>name.endsWith(".jsonl"));}catch{continue;}
    // Prefer the name hint, but verify every candidate before returning it.
    const ordered=[...entries.filter(name=>name.includes(sessionId.slice(0,8))),...entries];
    for(const name of ordered){
      const file=path.join(root,name);
      try{
        const header=fs.readFileSync(file,"utf8").split("\n",1)[0]??"";
        if(JSON.parse(header)?.sessionId===sessionId)return file;
      }catch{/* partially written or rotated transcript */}
    }
  }
  return null;
}

export type GeminiCliFailure={code:string;message:string};

/**
 * Gemini CLI exit codes, read from its fatal error classes. The stream's own
 * `result` event carries the better message, so this is the fallback for a
 * process that died without emitting one.
 */
const EXIT_CODES:Record<number,GeminiCliFailure>={
  41:{code:"GEMINI_CLI_AUTH_FAILED",message:"Gemini CLI could not authenticate with the Vertex service account."},
  42:{code:"GEMINI_CLI_INPUT_INVALID",message:"Gemini CLI rejected the request input."},
  44:{code:"GEMINI_CLI_SANDBOX_FAILED",message:"Gemini CLI could not start its sandbox."},
  52:{code:"GEMINI_CLI_CONFIG_INVALID",message:"Gemini CLI configuration is invalid."},
  53:{code:"GEMINI_CLI_TURN_LIMIT",message:"Gemini CLI stopped at its turn limit before finishing."},
  54:{code:"GEMINI_CLI_TOOL_FAILED",message:"A Gemini CLI tool execution failed."},
  55:{code:"GEMINI_CLI_WORKSPACE_UNTRUSTED",message:"Gemini CLI refused the workspace as untrusted."},
  130:{code:"GEMINI_CLI_CANCELLED",message:"Gemini CLI cancelled the turn."}
};

export function geminiCliExitFailure(code:number|null,signal:string|null):GeminiCliFailure{
  if(signal)return{code:"GEMINI_CLI_SIGNALLED",message:`Gemini CLI stopped on ${signal}.`};
  if(code!==null&&EXIT_CODES[code])return EXIT_CODES[code];
  return{code:"GEMINI_CLI_EXITED",message:`Gemini CLI exited with code ${code ?? "unknown"}.`};
}

/**
 * The `result` event reports API failures as one long formatted string with the
 * raw Google error nested inside. Classify it so the task shows a short cause
 * and keeps the full text in the log rather than in the headline.
 */
export function classifyGeminiCliError(message:string):GeminiCliFailure{
  const value=message.toLowerCase();
  if(value.includes("could not load the default credentials")||value.includes("invalid_grant")||value.includes("unauthenticated"))
    return{code:"GEMINI_CLI_AUTH_FAILED",message:"The Vertex service-account credentials could not be loaded. Re-upload the key in Gemini execution settings."};
  if(value.includes("has not been used in project")||value.includes("service_disabled")||value.includes("api is not enabled"))
    return{code:"VERTEX_API_DISABLED",message:"The Vertex AI API is not enabled for this Google Cloud project."};
  if(value.includes("billing")&&(value.includes("disabled")||value.includes("account")))
    return{code:"VERTEX_BILLING_REQUIRED",message:"Vertex AI rejected the request for a billing reason. Check the project's billing account."};
  if(value.includes("permission denied on resource project")||value.includes("consumer_invalid")||value.includes("permission_denied"))
    return{code:"VERTEX_PROJECT_DENIED",message:"The service account cannot use this Google Cloud project or region."};
  if(value.includes("resource_exhausted")||value.includes("429")||value.includes("quota"))
    return{code:"VERTEX_QUOTA_EXHAUSTED",message:"Vertex AI is rate limiting or has exhausted quota for this project."};
  if(value.includes("was not found")||value.includes("404")||value.includes("is not supported"))
    return{code:"VERTEX_MODEL_UNAVAILABLE",message:"The selected Gemini model is unavailable in this Vertex project or region."};
  if(value.includes("not running in a trusted directory"))
    return{code:"GEMINI_CLI_WORKSPACE_UNTRUSTED",message:"Gemini CLI refused the workspace as untrusted."};
  return{code:"GEMINI_CLI_FAILED",message:message.replace(/\s+/g," ").slice(0,400)};
}
