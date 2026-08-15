#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const legacyRoot = process.env.CLAUDEX_WORKHOUSE_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appRoot=process.env.CLAUDEX_WORKHOUSE_APP_ROOT??legacyRoot,dataRoot=process.env.CLAUDEX_WORKHOUSE_DATA_ROOT??legacyRoot;
const localEnvironmentFile=process.env.CLAUDEX_WORKHOUSE_SERVICE_ENVIRONMENT_FILE??path.join(dataRoot,"config","service-environment.json");
function readLocalEnvironment(){
  if(!fs.existsSync(localEnvironmentFile))return{};
  const parsed=JSON.parse(fs.readFileSync(localEnvironmentFile,"utf8"));
  if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))throw new Error(`Invalid local service environment: ${localEnvironmentFile}`);
  return parsed;
}
const localEnvironment=readLocalEnvironment();
function configuredPath(value,label){
  if(value===undefined)return undefined;
  if(typeof value!=="string"||!value.trim()||!path.isAbsolute(value))throw new Error(`${label} must be an absolute path in ${localEnvironmentFile}`);
  return path.normalize(value);
}
const configuredServiceHome=configuredPath(process.env.CLAUDEX_WORKHOUSE_SERVICE_HOME??localEnvironment.serviceHome,"serviceHome");
const configuredServiceTemp=configuredPath(process.env.CLAUDEX_WORKHOUSE_SERVICE_TEMP??localEnvironment.tempDirectory,"tempDirectory");
const serviceHome=configuredServiceHome??process.env.HOME??os.homedir();
const serviceTemp=configuredServiceTemp??process.env.TMPDIR??process.env.TMP??process.env.TEMP;
const pidFile = path.join(dataRoot, "run", "supervisor.pid");
const supervisor = path.join(appRoot, "app", "dist-server", "supervisor.js");
const runtimeBootstrap = path.join(appRoot, "bin", "runtime-bootstrap.mjs");
const logFile=path.join(dataRoot,"logs","claudex-workhouse.log");
const command = process.argv[2] ?? "status";
function serviceEnvironment(extra={}){
  const launchedFromProvider=Boolean(process.env.CLAUDEX_WORKHOUSE_CURRENT_TASK_ID||process.env.CLAUDEX_WORKHOUSE_PROVIDER_ID||process.env.CLAUDEX_WORKHOUSE_CURRENT_SESSION_ID);
  const base={...process.env};
  const taskScopedKeys=[
    "CLAUDEX_WORKHOUSE_CURRENT_TASK_ID","CLAUDEX_WORKHOUSE_CURRENT_SESSION_ID",
    "CLAUDEX_WORKHOUSE_MANAGED_PROVIDER_MCP_URL","CLAUDEX_WORKHOUSE_MANAGED_PROVIDER_TOKEN",
    "CLAUDEX_WORKHOUSE_PROVIDER_ID","CLAUDEX_WORKHOUSE_PROVIDER_LABEL",
    "CLAUDEX_WORKHOUSE_RUNTIME_PROFILE","CLAUDEX_WORKHOUSE_DELEGATION_SETTINGS",
    "CLAUDEX_WORKHOUSE_EMOTION_MCP_URL","CLAUDEX_WORKHOUSE_TASK_STARTED_AT",
    "CLAUDEX_WORKHOUSE_CLAUDE_SESSION_ID"
  ];
  for(const key of taskScopedKeys)delete base[key];
  // Provider workers inherit the executable selected when their task started.
  // Never turn that task-scoped, installer-owned path into a service override:
  // managed runtime state selects the active version for the restarted server.
  for(const key of["CLAUDEX_WORKHOUSE_CODEX_BIN","CLAUDEX_WORKHOUSE_CLAUDE_BIN"]){
    const value=base[key];if(typeof value!=="string"||!path.isAbsolute(value))continue;
    const relative=path.relative(path.join(dataRoot,"runtime"),path.normalize(value));
    if(relative!==""&&!relative.startsWith(`..${path.sep}`)&&!path.isAbsolute(relative))delete base[key];
  }
  // A restart requested from a compatible-provider worker otherwise turns the
  // whole service into that provider. In particular, Ollama/DeepSeek inject
  // Anthropic-compatible routing variables for their own Claude CLI child.
  if(launchedFromProvider){
    for(const key of [
      "ANTHROPIC_API_KEY","ANTHROPIC_AUTH_TOKEN","ANTHROPIC_BASE_URL",
      "CLAUDECODE","CLAUDE_CODE_CHILD_SESSION","CLAUDE_CODE_ENTRYPOINT",
      "CLAUDE_CODE_EXECPATH","CLAUDE_CODE_SESSION_ID","CLAUDE_CODE_SUBAGENT_MODEL",
      "CLAUDE_EFFORT","CLAUDE_PID"
    ])delete base[key];
  }
  base.HOME=serviceHome;
  if(configuredServiceHome)Object.assign(base,{
    CODEX_HOME:path.join(serviceHome,".codex"),CLAUDE_CONFIG_DIR:path.join(serviceHome,".claude"),
    XDG_CACHE_HOME:path.join(serviceHome,".cache"),XDG_CONFIG_HOME:path.join(serviceHome,".config"),
    XDG_DATA_HOME:path.join(serviceHome,".local","share"),NPM_CONFIG_CACHE:path.join(serviceHome,".npm"),
    PNPM_HOME:path.join(serviceHome,".local","share","pnpm")
  });
  if(serviceTemp)Object.assign(base,{TMPDIR:serviceTemp,TMP:serviceTemp,TEMP:serviceTemp});
  return{...base,...extra};
}
if(process.platform!=="linux"&&["start","stop","restart"].includes(command)){
  throw new Error("This launcher currently supports Linux only. Use the native Windows launcher when it is available.");
}

function pid() {
  try { return Number(fs.readFileSync(pidFile, "utf8").trim()); } catch { return null; }
}
function matches(value) {
  if (!value) return false;
  try {
    process.kill(value, 0);
    if(process.platform!=="linux")return false;
    return fs.readFileSync(`/proc/${value}/cmdline`, "utf8").replaceAll("\0", " ").includes(supervisor);
  } catch { return false; }
}
async function waitFor(test, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (test()) return true; await new Promise((resolve) => setTimeout(resolve, 100)); }
  return false;
}
// A Docker image runs `container-init.mjs` and the Windows payload runs its own
// `start.mjs`, so both arrive with a complete configuration. A Node install has
// neither: before this, `claudex-workhouse start` on a fresh host wrote no
// config and the server exited on a raw schema dump listing the fields the
// operator was supposed to have guessed. Write the same defaults here, and bind
// loopback rather than the container's `0.0.0.0` — this process is on somebody's
// own machine, not behind a published port.
export function bootstrapConfiguration(){
  const configDirectory=path.join(dataRoot,"config");
  fs.mkdirSync(configDirectory,{recursive:true,mode:0o700});
  for(const directory of ["data","logs","run","runtime/bin","runtime/claude-bin","runtime/codex-bin","snapshots","workspaces"]){
    fs.mkdirSync(path.join(dataRoot,directory),{recursive:true,mode:0o700});
  }
  const configFile=path.join(configDirectory,"claudex-workhouse.json");
  if(!fs.existsSync(configFile)){
    const port=Number(process.env.CLAUDEX_WORKHOUSE_PORT||3410);
    const config={
      host:"127.0.0.1",
      port,
      externalOrigin:process.env.CLAUDEX_WORKHOUSE_EXTERNAL_ORIGIN||`http://127.0.0.1:${port}`,
      allowedEmail:process.env.CLAUDEX_WORKHOUSE_ALLOWED_EMAIL||"owner@example.invalid",
      teamDomain:"",
      audience:"",
      authMode:"local",
      promptMaxLength:20000,
      commandTimeoutMs:30000,
      commandOutputLimit:2097152,
      claudeBinary:"runtime/claude-bin/claude",
      workspaceRoots:[{path:path.join(dataRoot,"workspaces"),displayName:"Claudex Workhouse Workspaces",allowCreate:true,allowRegister:true,allowClone:true,allowDelete:false}],
      installationId:randomUUID()
    };
    fs.writeFileSync(configFile,`${JSON.stringify(config,null,2)}\n`,{mode:0o600,flag:"wx"});
    console.log(`Wrote a first-run configuration to ${configFile}.`);
  }
  const projectsFile=path.join(configDirectory,"projects.json");
  if(!fs.existsSync(projectsFile))fs.writeFileSync(projectsFile,'{"projects":[]}\n',{mode:0o600,flag:"wx"});
}

async function start() {
  const current = pid();
  if (matches(current)) { console.log(`Claudex Workhouse already running (supervisor ${current}).`); return; }
  if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);
  bootstrapConfiguration();
  if(configuredServiceHome)fs.mkdirSync(serviceHome,{recursive:true,mode:0o700});
  if(configuredServiceTemp)fs.mkdirSync(serviceTemp,{recursive:true,mode:0o700});
  if (process.env.CLAUDEX_WORKHOUSE_SKIP_RUNTIME_BOOTSTRAP !== "1") {
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [runtimeBootstrap], { cwd:appRoot, shell:false, windowsHide:true, env:serviceEnvironment({CLAUDEX_WORKHOUSE_ROOT:appRoot,CLAUDEX_WORKHOUSE_APP_ROOT:appRoot,CLAUDEX_WORKHOUSE_DATA_ROOT:dataRoot}), stdio:["ignore","pipe","pipe"] });
      let stdout="",stderr="";
      child.stdout.on("data",(chunk)=>{stdout=`${stdout}${chunk}`.slice(-4000);});
      child.stderr.on("data",(chunk)=>{stderr=`${stderr}${chunk}`.slice(-4000);});
      child.once("error",reject);
      child.once("exit",(code)=>code===0?resolve():reject(new Error(`Runtime bootstrap failed (${code}): ${stderr||stdout}`)));
    });
  }
  const child = spawn(process.execPath, [supervisor], { cwd: path.dirname(supervisor), detached: true, shell: false, windowsHide:true, env:serviceEnvironment({CLAUDEX_WORKHOUSE_ROOT:appRoot,CLAUDEX_WORKHOUSE_APP_ROOT:appRoot,CLAUDEX_WORKHOUSE_DATA_ROOT:dataRoot}), stdio: "ignore" });
  child.unref();
  if (!await waitFor(() => matches(pid()))) throw new Error("Claudex Workhouse supervisor did not start.");
  console.log(`Claudex Workhouse started (supervisor ${pid()}).`);
}
async function stop() {
  const current = pid();
  if (!matches(current)) { if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile); console.log("Claudex Workhouse is not running."); return; }
  process.kill(current, "SIGTERM");
  if (!await waitFor(() => !matches(current), 12000)) throw new Error(`Supervisor ${current} did not stop.`);
  console.log("Claudex Workhouse stopped. Agent workers were left untouched.");
}

if (command === "start") await start();
else if (command === "stop") await stop();
else if (command === "restart") { await stop(); await start(); }
else if (command === "status") {
  const current = pid();
  console.log(matches(current) ? `running supervisor=${current} bind=127.0.0.1:3410` : "stopped");
  process.exitCode = matches(current) ? 0 : 3;
} else if (command === "logs") {
  if (!fs.existsSync(logFile)) console.log("No Claudex Workhouse log yet.");
  else console.log(fs.readFileSync(logFile, "utf8").split("\n").slice(-100).join("\n"));
} else throw new Error("Usage: node claudex-workhouse.mjs start|stop|restart|status|logs");
