import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { sanitizeSensitiveText } from "./sensitive-data.js";
import {resolveWorkhouseRoots}from"./platform.js";

const{appRoot,dataRoot}=resolveWorkhouseRoots();
const runDir = path.join(dataRoot, "run");
const logDir = path.join(dataRoot, "logs");
const tempDir=path.join(dataRoot,"runtime","tmp");
const cacheDir=path.join(dataRoot,"runtime","cache");
const pidFile = path.join(runDir, "supervisor.pid");
const logFile=path.join(logDir,"claudex-workhouse.log");
const serverEntry = path.join(appRoot, "app", "dist-server", "index.js");
let child: ChildProcess | null = null;
let stopping = false;
for(const name of["CLAUDEX_WORKHOUSE_CURRENT_TASK_ID","CLAUDEX_WORKHOUSE_MANAGED_PROVIDER_MCP_URL","CLAUDEX_WORKHOUSE_MANAGED_PROVIDER_TOKEN"])delete process.env[name];

fs.mkdirSync(runDir, { recursive: true });
fs.mkdirSync(logDir, { recursive: true });
for(const directory of[tempDir,path.join(cacheDir,"npm"),path.join(cacheDir,"pnpm")]){
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const stat=fs.lstatSync(directory);
  if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error(`Managed runtime directory is not a regular directory: ${directory}`);
  fs.chmodSync(directory,0o700);
}
fs.writeFileSync(pidFile, `${process.pid}\n`, "utf8");

function rotate() {
  try {
    if (fs.statSync(logFile).size < 10 * 1024 * 1024) return;
  } catch { return; }
  for (let i = 4; i >= 1; i--) {
    const source = i === 1 ? logFile : `${logFile}.${i - 1}`;
    const target = `${logFile}.${i}`;
    if (fs.existsSync(source)) fs.renameSync(source, target);
  }
}
function log(chunk: Buffer | string) {
  rotate();
  fs.appendFileSync(logFile, sanitizeSensitiveText(Buffer.isBuffer(chunk)?chunk.toString("utf8"):chunk));
}
function startServer() {
  if (stopping) return;
  log(`[${new Date().toISOString()}] starting Claudex Workhouse server\n`);
  child = spawn(process.execPath, [serverEntry], {
    cwd: path.dirname(serverEntry),
    shell: false,
    env: {
      ...process.env,
      CLAUDEX_WORKHOUSE_ROOT: appRoot,
      CLAUDEX_WORKHOUSE_APP_ROOT:appRoot,
      CLAUDEX_WORKHOUSE_DATA_ROOT:dataRoot,
      TMPDIR:tempDir,
      TMP:tempDir,
      TEMP:tempDir,
      npm_config_cache:path.join(cacheDir,"npm"),
      pnpm_config_store_dir:path.join(cacheDir,"pnpm"),
      LOG_LEVEL: process.env.LOG_LEVEL ?? "info",
      // Claudex Workhouse verifies, backs up, and atomically replaces its managed runtime.
      // Prevent Claude's own updater from bypassing those safeguards.
      DISABLE_AUTOUPDATER: process.env.DISABLE_AUTOUPDATER ?? "1",
      ...(process.env.CLAUDEX_WORKHOUSE_CODEX_BIN?.trim()?{CLAUDEX_WORKHOUSE_CODEX_BIN:process.env.CLAUDEX_WORKHOUSE_CODEX_BIN}:{}),
    },
    windowsHide:true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", log);
  child.stderr?.on("data", log);
  child.once("exit", (code, signal) => {
    log(`[${new Date().toISOString()}] server exited code=${code} signal=${signal}\n`);
    child = null;
    if (!stopping) setTimeout(startServer, 2000);
  });
}
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  log(`[${new Date().toISOString()}] supervisor stopping on ${signal}\n`);
  if (child?.pid) {
    child.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 5000));
    if (child?.pid) child.kill("SIGKILL");
  }
  if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("exit", () => { if (fs.existsSync(pidFile) && fs.readFileSync(pidFile, "utf8").trim() === String(process.pid)) fs.unlinkSync(pidFile); });
startServer();
