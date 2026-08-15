#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Claudex Workhouse.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(appRoot, "..");
const packagesRoot = path.resolve(
  process.env.CLAUDEX_WORKHOUSE_PACKAGE_OUTPUT_DIR || path.join(repositoryRoot, "packages")
);
const semanticVersion = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || appRoot,
    env: process.env,
    shell: false,
    stdio: "inherit"
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status ?? "unknown"}.`);
  }
}

function write(file, value, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, value, { mode });
}

function copyRegularFile(sourceFile, destinationFile, mode = 0o600) {
  const source = path.resolve(sourceFile);
  const status = fs.lstatSync(source);
  if (!status.isFile() || status.size <= 0) {
    throw new Error(`${sourceFile} must be a non-empty regular file.`);
  }
  fs.mkdirSync(path.dirname(destinationFile), { recursive: true, mode: 0o700 });
  fs.copyFileSync(source, destinationFile);
  fs.chmodSync(destinationFile, mode);
}

function hashFile(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function filesBelow(root) {
  const result = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Worker package output must not contain symbolic links: ${absolute}`);
      }
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) result.push(absolute);
      else throw new Error(`Worker package output contains an unsupported file: ${absolute}`);
    }
  };
  visit(root);
  return result.sort();
}

function normalizeTimestamps(root) {
  const epochSeconds = Number.parseInt(process.env.SOURCE_DATE_EPOCH || "946684800", 10);
  if (!Number.isSafeInteger(epochSeconds) || epochSeconds < 315532800) {
    throw new Error("SOURCE_DATE_EPOCH must be a safe Unix timestamp no earlier than 1980.");
  }
  const date = new Date(epochSeconds * 1000);
  const entries = [root, ...filesBelow(root)];
  const directories = [];
  const collectDirectories = (directory) => {
    directories.push(directory);
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) collectDirectories(path.join(directory, entry.name));
    }
  };
  collectDirectories(root);
  for (const entry of [...entries, ...directories]) fs.utimesSync(entry, date, date);
}

function packageRootForInput(input) {
  let current = path.dirname(path.resolve(appRoot, input));
  while (current.startsWith(`${appRoot}${path.sep}`)) {
    const manifest = path.join(current, "package.json");
    if (fs.existsSync(manifest)) {
      const parsed = JSON.parse(fs.readFileSync(manifest, "utf8"));
      if (typeof parsed.name === "string" && typeof parsed.version === "string") {
        return { root: current, name: parsed.name, version: parsed.version };
      }
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(`Could not resolve bundled package metadata for ${input}.`);
}

function bundle(entry, output, version, bundledPackages) {
  const requireBridge =
    'import { createRequire as __claudexCreateRequire } from "node:module"; const require = __claudexCreateRequire(import.meta.url);';
  const metafile = `${output}.metadata.json`;
  run("pnpm", [
    "exec",
    "esbuild",
    entry,
    "--bundle",
    "--platform=node",
    "--format=esm",
    "--target=node20",
    "--log-level=warning",
    `--metafile=${metafile}`,
    `--define:process.env.CLAUDEX_WORKHOUSE_WORKER_VERSION=${JSON.stringify(version)}`,
    `--banner:js=${requireBridge}`,
    `--outfile=${output}`
  ]);
  try {
    const metadata = JSON.parse(fs.readFileSync(metafile, "utf8"));
    for (const input of Object.keys(metadata.inputs)) {
      if (!input.split(/[\\/]/).includes("node_modules")) continue;
      const dependency = packageRootForInput(input);
      bundledPackages.set(`${dependency.name}@${dependency.version}`, dependency);
    }
  } finally {
    fs.rmSync(metafile, { force: true });
  }
}

function copyBundledPackageNotices(packages, legalDirectory) {
  const targetRoot = path.join(legalDirectory, "third-party");
  for (const [identity, dependency] of [...packages].sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    const noticeFiles = fs.readdirSync(dependency.root).filter((name) =>
      /^(?:licen[cs]e|copying|notice)(?:[._-].*)?$/i.test(name)
    );
    if (noticeFiles.length === 0) {
      throw new Error(`Bundled dependency ${identity} does not provide a root license or notice file.`);
    }
    const safeIdentity = identity.replaceAll("/", "__").replaceAll("\\", "__");
    const target = path.join(targetRoot, safeIdentity);
    copyRegularFile(path.join(dependency.root, "package.json"), path.join(target, "package.json"));
    for (const name of noticeFiles) {
      copyRegularFile(path.join(dependency.root, name), path.join(target, name));
    }
  }
}

function findNodeLicense(runtimeFile) {
  const configured = process.env.CLAUDEX_WORKHOUSE_WORKER_NODE_LICENSE_FILE?.trim();
  const runtimeDirectory = path.dirname(path.resolve(runtimeFile));
  const candidates = [
    configured,
    path.join(runtimeDirectory, "LICENSE"),
    path.join(runtimeDirectory, "..", "LICENSE"),
    runtimeFile === process.execPath ? "/usr/share/doc/nodejs/copyright" : undefined
  ].filter(Boolean);
  const found = candidates.find((candidate) => {
    try {
      const status = fs.statSync(path.resolve(candidate));
      return status.isFile() && status.size > 0;
    } catch {
      return false;
    }
  });
  if (!found) {
    throw new Error(
      "The redistributed Node.js runtime license was not found. Set CLAUDEX_WORKHOUSE_WORKER_NODE_LICENSE_FILE."
    );
  }
  return path.resolve(found);
}

function windowsFiles(root) {
  write(
    path.join(root, "Start Claudex Workhouse Worker.vbs"),
    `Option Explicit\r
Dim fso, shell, base, node, command\r
Set fso = CreateObject("Scripting.FileSystemObject")\r
Set shell = CreateObject("WScript.Shell")\r
base = fso.GetParentFolderName(WScript.ScriptFullName)\r
node = base & "\\node.exe"\r
If Not fso.FileExists(node) Then MsgBox "Verified Worker runtime is missing. Reinstall the official package.", 16, "Claudex Workhouse Worker": WScript.Quit 1\r
command = Chr(34) & node & Chr(34) & " " & Chr(34) & base & "\\app\\start.mjs" & Chr(34)\r
On Error Resume Next\r
shell.Run command, 0, False\r
If Err.Number <> 0 Then MsgBox "The Worker could not be started. Reinstall the package or run diagnostics.", 16, "Claudex Workhouse Worker"\r
On Error GoTo 0\r
`,
    0o600
  );
  write(
    path.join(root, "Start Claudex Workhouse Worker.cmd"),
    '@echo off\r\nstart "" wscript.exe "%~dp0Start Claudex Workhouse Worker.vbs"\r\n',
    0o600
  );
  write(
    path.join(root, "Worker CLI.cmd"),
    '@echo off\r\nif not exist "%~dp0node.exe" (\r\n  echo Verified Worker runtime is missing. Reinstall the official package. 1>&2\r\n  exit /b 1\r\n)\r\n"%~dp0node.exe" "%~dp0app\\desktop-worker\\cli.js" %*\r\n',
    0o600
  );
  write(
    path.join(root, "install-current-user.ps1"),
    `$ErrorActionPreference = 'Stop'\r
Set-StrictMode -Version Latest\r
& (Join-Path $PSScriptRoot 'Worker CLI.cmd') install-service\r
if ($LASTEXITCODE -ne 0) { throw 'Worker current-user auto-start setup failed.' }\r
`,
    0o600
  );
  write(
    path.join(root, "uninstall-current-user.ps1"),
    `$ErrorActionPreference = 'Stop'\r
Set-StrictMode -Version Latest\r
& (Join-Path $PSScriptRoot 'Worker CLI.cmd') uninstall-service\r
if ($LASTEXITCODE -ne 0) { throw 'Worker current-user auto-start removal failed.' }\r
Write-Host 'Program files and device credentials were retained. Remove them separately only when intended.'\r
`,
    0o600
  );
}

function linuxFiles(root) {
  const wrapper = (script) => `#!/bin/sh
set -eu
WORKHOUSE_WRAPPER_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
WORKHOUSE_PACKAGE_DIR="$(dirname -- "$WORKHOUSE_WRAPPER_DIR")"
exec "$WORKHOUSE_PACKAGE_DIR/runtime/node" "$WORKHOUSE_PACKAGE_DIR/${script}" "$@"
`;
  write(
    path.join(root, "bin", "claudex-workhouse-worker"),
    wrapper("app/desktop-worker/cli.js"),
    0o755
  );
  write(
    path.join(root, "bin", "claudex-workhouse-worker-ui"),
    wrapper("app/start.mjs"),
    0o755
  );
  write(
    path.join(root, "install-user.sh"),
    `#!/bin/sh
set -eu
WORKHOUSE_INSTALLER_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
exec "$WORKHOUSE_INSTALLER_DIR/bin/claudex-workhouse-worker" install-service
`,
    0o755
  );
  write(
    path.join(root,"install-worker.sh"),
    `#!/bin/sh
set -eu
WORKHOUSE_INSTALLER_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
printf '%s\n' 'Worker 설정 화면을 엽니다. 서버 주소와 pairing code를 입력하고 자동 시작을 켜세요.'
exec "$WORKHOUSE_INSTALLER_DIR/bin/claudex-workhouse-worker-ui"
`,
    0o755
  );
  write(
    path.join(root, "uninstall-user.sh"),
    `#!/bin/sh
set -eu
WORKHOUSE_INSTALLER_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
"$WORKHOUSE_INSTALLER_DIR/bin/claudex-workhouse-worker" uninstall-service
printf '%s\n' 'Program files and device credentials were retained. Remove them separately only when intended.'
`,
    0o755
  );
}

function createArchive(platform, packageRoot, archiveFile) {
  fs.rmSync(archiveFile, { force: true });
  if (platform === "windows") {
    const archiveScript = path.join(packagesRoot, `.archive-worker-${process.pid}.ps1`);
    write(
      archiveScript,
      `$ErrorActionPreference = 'Stop'\r
Set-StrictMode -Version Latest\r
Compress-Archive -LiteralPath ${JSON.stringify(packageRoot)} -DestinationPath ${JSON.stringify(archiveFile)} -CompressionLevel Optimal\r
`,
      0o600
    );
    try {
      run("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", archiveScript], {
        cwd: packagesRoot
      });
    } finally {
      fs.rmSync(archiveScript, { force: true });
    }
  } else {
    run("tar", ["-czf", archiveFile, path.basename(packageRoot)], { cwd: packagesRoot });
  }
}

export function packageWorkerRelease() {
  const version = required("CLAUDEX_WORKHOUSE_RELEASE_VERSION");
  if (!semanticVersion.test(version)) {
    throw new Error("CLAUDEX_WORKHOUSE_RELEASE_VERSION must be semantic version text without a v prefix.");
  }
  const requestedPlatform = required("CLAUDEX_WORKHOUSE_WORKER_PLATFORM");
  const platform = requestedPlatform === "win32" ? "windows" : requestedPlatform;
  if (!["windows", "linux"].includes(platform)) {
    throw new Error("CLAUDEX_WORKHOUSE_WORKER_PLATFORM must be windows or linux.");
  }
  const architecture = required("CLAUDEX_WORKHOUSE_WORKER_ARCHITECTURE");
  if (!["x64", "arm64"].includes(architecture)) {
    throw new Error("CLAUDEX_WORKHOUSE_WORKER_ARCHITECTURE must be x64 or arm64.");
  }
  if (platform === "windows" && architecture !== "x64") {
    throw new Error("The public Windows Worker currently supports x64 only.");
  }

  const hostPlatform = process.platform === "win32" ? "windows" : process.platform;
  if (hostPlatform !== platform || process.arch !== architecture) {
    throw new Error(
      `Worker packages must be built on their native target; requested ${platform}/${architecture}, running ${hostPlatform}/${process.arch}.`
    );
  }

  const runtimeFile = process.env.CLAUDEX_WORKHOUSE_WORKER_NODE_BINARY?.trim() || process.execPath;
  const licenseFile = process.env.CLAUDEX_WORKHOUSE_LICENSE_FILE?.trim() ||
    path.join(repositoryRoot, "LICENSE");
  if (!fs.existsSync(licenseFile)) {
    throw new Error(
      "A project LICENSE file is required before public Worker packages can be built. Set CLAUDEX_WORKHOUSE_LICENSE_FILE after the license is chosen."
    );
  }

  const packageName = `claudex-workhouse-worker-${platform}-${architecture}`;
  const packageRoot = path.join(packagesRoot, packageName);
  const archiveFile = path.join(
    packagesRoot,
    `${packageName}.${platform === "windows" ? "zip" : "tar.gz"}`
  );
  fs.mkdirSync(packagesRoot, { recursive: true, mode: 0o700 });
  fs.rmSync(packageRoot, { recursive: true, force: true });
  fs.mkdirSync(path.join(packageRoot, "app", "desktop-worker"), {
    recursive: true,
    mode: 0o700
  });

  const bundledPackages = new Map();
  bundle(
    "src/server/desktop-worker/ui.ts",
    path.join(packageRoot, "app", "desktop-worker", "ui.js"),
    version,
    bundledPackages
  );
  bundle(
    "src/server/desktop-worker/cli.ts",
    path.join(packageRoot, "app", "desktop-worker", "cli.js"),
    version,
    bundledPackages
  );
  bundle(
    "src/server/desktop-worker/updater.ts",
    path.join(packageRoot, "app", "desktop-worker", "updater.js"),
    version,
    bundledPackages
  );
  bundle(
    "src/server/claude-worker.ts",
    path.join(packageRoot, "app", "claude-worker.js"),
    version,
    bundledPackages
  );
  bundle(
    "src/server/codex-worker.ts",
    path.join(packageRoot, "app", "codex-worker.js"),
    version,
    bundledPackages
  );
  write(
    path.join(packageRoot, "app", "start.mjs"),
    'const { startWorkerUi } = await import("./desktop-worker/ui.js");\nawait startWorkerUi(true);\n',
    0o600
  );

  if (platform === "windows") {
    copyRegularFile(runtimeFile, path.join(packageRoot, "node.exe"), 0o700);
    windowsFiles(packageRoot);
  } else {
    copyRegularFile(runtimeFile, path.join(packageRoot, "runtime", "node"), 0o755);
    linuxFiles(packageRoot);
  }
  copyRegularFile(licenseFile, path.join(packageRoot, "LICENSE.txt"), 0o600);
  const legalDirectory=path.join(packageRoot,"licenses");
  fs.mkdirSync(legalDirectory,{recursive:true,mode:0o700});
  copyRegularFile(licenseFile,path.join(legalDirectory,"LICENSE"),0o600);
  for(const name of["LICENSE.ko.md","LICENSE.ja.md","NOTICE.md","NOTICE.ko.md","NOTICE.ja.md","THIRD_PARTY_NOTICES.md","THIRD_PARTY_NOTICES.ko.md","THIRD_PARTY_NOTICES.ja.md"]){
    copyRegularFile(path.join(repositoryRoot,name),path.join(legalDirectory,name),0o600);
  }
  copyBundledPackageNotices(bundledPackages, legalDirectory);
  copyRegularFile(
    findNodeLicense(runtimeFile),
    path.join(legalDirectory, "third-party", "nodejs", "LICENSE"),
    0o600
  );
  write(path.join(packageRoot, "VERSION"), `${version}\n`, 0o600);
  write(path.join(packageRoot,"package.json"),`${JSON.stringify({name:packageName,version,private:true,type:"module",license:"AGPL-3.0-only"},null,2)}\n`,0o600);
  write(
    path.join(packageRoot, "README-FIRST.txt"),
    `Claudex Workhouse Worker ${version} (${platform}/${architecture})

This is a current-user Worker package. It includes its own Node.js runtime.
Do not run it as root or SYSTEM. Provider credentials stay on this host.

1. Verify this archive against the signed Claudex Workhouse release manifest.
2. Extract the entire top-level folder.
3. Use the server's Infrastructure screen to create a 10-minute pairing code.
4. Windows: open "Start Claudex Workhouse Worker.cmd".
   Linux: run "./install-worker.sh".
5. Enter the server address and pairing code, choose Workspace roots, and enable current-user auto-start.

Uninstalling auto-start retains program files, Workspace files, and device credentials.
`,
    0o600
  );

  const packageFiles = filesBelow(packageRoot)
    .filter((file) => path.basename(file) !== "package-manifest.json")
    .map((file) => {
      const stat = fs.statSync(file);
      return {
        path: path.relative(packageRoot, file).split(path.sep).join("/"),
        size: stat.size,
        sha256: hashFile(file)
      };
    });
  write(
    path.join(packageRoot, "package-manifest.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      product: "claudex-workhouse-worker",
      license:"AGPL-3.0-only",
      version,
      platform,
      architecture,
      nodeVersion: process.version,
      files: packageFiles
    }, null, 2)}\n`,
    0o600
  );

  normalizeTimestamps(packageRoot);
  createArchive(platform, packageRoot, archiveFile);
  const result = {
    packageRoot,
    archiveFile,
    archiveSize: fs.statSync(archiveFile).size,
    archiveSha256: hashFile(archiveFile)
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  packageWorkerRelease();
}
