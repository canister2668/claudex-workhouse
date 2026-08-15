import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * Installs the official Gemini CLI into the Workhouse-managed runtime directory
 * used by the Gemini provider's `vertex-agent` execution backend.
 *
 * The CLI is an npm package rather than a single binary, so it is installed
 * into `runtime/gemini-cli` as a self-contained prefix instead of being
 * committed to the repository. Nothing is installed globally and no OS package
 * manager is involved.
 *
 *   node scripts/install-gemini-cli.mjs [version]
 *   node scripts/install-gemini-cli.mjs --check
 */

const PACKAGE = "@google/gemini-cli";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataRoot = (process.env.CLAUDEX_WORKHOUSE_DATA_ROOT ?? root).trim() || root;
const runtimeDir = path.join(dataRoot, "runtime", "gemini-cli");
const bundle = path.join(runtimeDir, "node_modules", "@google", "gemini-cli", "bundle", "gemini.js");
const manifest = path.join(runtimeDir, "node_modules", "@google", "gemini-cli", "package.json");

function installedVersion() {
  try {
    const value = JSON.parse(fs.readFileSync(manifest, "utf8"));
    return value?.name === PACKAGE && typeof value.version === "string" ? value.version : null;
  } catch {
    return null;
  }
}

function ripgrepOnPath() {
  return String(process.env.PATH ?? "").split(path.delimiter).some((directory) => {
    if (!directory) return false;
    try {
      fs.accessSync(path.join(directory, process.platform === "win32" ? "rg.exe" : "rg"), fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

function report() {
  const version = installedVersion();
  const entryPresent = fs.existsSync(bundle);
  console.log(`runtime directory : ${runtimeDir}`);
  console.log(`entry             : ${entryPresent ? bundle : "not installed"}`);
  console.log(`version           : ${version ?? "unknown"}`);
  // Missing ripgrep only slows the CLI's search tool down; it is never fatal.
  console.log(`ripgrep           : ${ripgrepOnPath() ? "available" : "absent (GrepTool fallback, slower search)"}`);
  return entryPresent && Boolean(version);
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: runtimeDir, stdio: "inherit", shell: false });
    child.once("error", reject);
    child.once("close", (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`))));
  });
}

async function install(version) {
  fs.mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
  const packageFile = path.join(runtimeDir, "package.json");
  // A private manifest keeps npm from walking up into the Workhouse workspace.
  if (!fs.existsSync(packageFile)) {
    fs.writeFileSync(packageFile, `${JSON.stringify({ name: "claudex-workhouse-gemini-cli-runtime", private: true, version: "1.0.0" }, null, 2)}\n`, { mode: 0o600 });
  }
  const specifier = version ? `${PACKAGE}@${version}` : PACKAGE;
  console.log(`Installing ${specifier} into ${runtimeDir}`);
  await run(process.platform === "win32" ? "npm.cmd" : "npm", ["install", specifier, "--no-audit", "--no-fund", "--omit=dev"]);
  if (!report()) throw new Error("The Gemini CLI install completed but the expected bundle entry is missing.");
}

const argument = (process.argv[2] ?? "").trim();
if (argument === "--check") {
  process.exit(report() ? 0 : 1);
} else {
  await install(argument || process.env.CLAUDEX_WORKHOUSE_GEMINI_CLI_VERSION?.trim() || "");
}
