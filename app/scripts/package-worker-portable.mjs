import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const appRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),".."),packagesRoot=path.resolve(appRoot,"..","packages"),target=path.join(packagesRoot,"claudex-workhouse-worker-windows-portable"),bundleRoot=path.join(target,"app"),desktopRoot=path.join(bundleRoot,"desktop-worker");
const nodeExe=process.env.CLAUDEX_WORKHOUSE_WINDOWS_NODE_EXE;if(!nodeExe)throw new Error("CLAUDEX_WORKHOUSE_WINDOWS_NODE_EXE is required so the official portable package never depends on a user-installed Node.js.");const source=path.resolve(nodeExe);if(!fs.existsSync(source)||!fs.statSync(source).isFile())throw new Error("CLAUDEX_WORKHOUSE_WINDOWS_NODE_EXE is not a file.");
fs.rmSync(target,{recursive:true,force:true});fs.mkdirSync(desktopRoot,{recursive:true});
function bundle(entry,outfile){const requireBridge='import { createRequire as __claudexCreateRequire } from "node:module"; const require = __claudexCreateRequire(import.meta.url);';const result=spawnSync("pnpm",["exec","esbuild",entry,"--bundle","--platform=node","--format=esm","--target=node20","--log-level=warning",`--banner:js=${requireBridge}`,`--outfile=${outfile}`],{cwd:appRoot,stdio:"inherit",shell:false});if(result.status!==0)throw new Error(`Worker bundle failed: ${entry}`);}
bundle("src/server/desktop-worker/ui.ts",path.join(desktopRoot,"ui.js"));
bundle("src/server/desktop-worker/cli.ts",path.join(desktopRoot,"cli.js"));
bundle("src/server/desktop-worker/updater.ts",path.join(desktopRoot,"updater.js"));
bundle("src/server/claude-worker.ts",path.join(bundleRoot,"claude-worker.js"));
bundle("src/server/codex-worker.ts",path.join(bundleRoot,"codex-worker.js"));
fs.writeFileSync(path.join(bundleRoot,"start.mjs"),'const {startWorkerUi}=await import("./desktop-worker/ui.js");await startWorkerUi(true);\n');
fs.writeFileSync(path.join(target,"Start Claudex Workhouse Worker.vbs"),`Option Explicit\nDim fso, shell, base, node, command\nSet fso = CreateObject("Scripting.FileSystemObject")\nSet shell = CreateObject("WScript.Shell")\nbase = fso.GetParentFolderName(WScript.ScriptFullName)\nnode = base & "\\node.exe"\nIf Not fso.FileExists(node) Then MsgBox "검증된 Worker 런타임이 없습니다. 공식 패키지를 다시 설치하세요.", 16, "Claudex Workhouse Worker": WScript.Quit 1\ncommand = Chr(34) & node & Chr(34) & " " & Chr(34) & base & "\\app\\start.mjs" & Chr(34)\nOn Error Resume Next\nshell.Run command, 0, False\nIf Err.Number <> 0 Then MsgBox "Worker를 시작할 수 없습니다. 패키지를 다시 설치하거나 진단을 실행하세요.", 16, "Claudex Workhouse Worker"\nOn Error GoTo 0\n`);
fs.writeFileSync(path.join(target,"Start Claudex Workhouse Worker.cmd"),'@echo off\r\nstart "" wscript.exe "%~dp0Start Claudex Workhouse Worker.vbs"\r\n');
fs.writeFileSync(path.join(target,"Worker CLI.cmd"),'@echo off\r\nif not exist "%~dp0node.exe" (\r\n  echo Verified Worker runtime is missing. Reinstall the official package. 1>&2\r\n  exit /b 1\r\n)\r\n"%~dp0node.exe" "%~dp0app\\desktop-worker\\cli.js" %*\r\n');
fs.writeFileSync(path.join(target,"README.txt"),`Claudex Workhouse Desktop Worker (Windows portable)\n\n이 공식 패키지는 검증된 Node 런타임을 포함하므로 Node.js나 npm을 별도로 설치할 필요가 없습니다.\n\n1. 'Start Claudex Workhouse Worker.vbs'를 더블클릭합니다.\n2. 열린 설정 화면에서 Claudex Workhouse 주소와 페어링 코드를 입력합니다.\n3. 폴더 선택 버튼으로 작업공간 Root를 추가합니다.\n4. 필요하면 '로그인할 때 자동 실행'을 켭니다.\n\n외부 포트는 열지 않으며 관리 화면은 127.0.0.1에만 바인딩됩니다.\nCLI는 고급 진단용 'Worker CLI.cmd'로 유지됩니다.\n`);
fs.copyFileSync(source,path.join(target,"node.exe"));
fs.mkdirSync(packagesRoot,{recursive:true});const zipFile=path.join(packagesRoot,"claudex-workhouse-worker-windows-portable.zip");fs.rmSync(zipFile,{force:true});const zip=spawnSync("zip",["-qr",zipFile,path.basename(target)],{cwd:packagesRoot,stdio:"inherit",shell:false});if(zip.status!==0)process.stderr.write(`zip command unavailable; portable folder remains at ${target}\n`);process.stdout.write(`${target}\n${zip.status===0?zipFile:""}\n`);
