import fs from"node:fs";
import path from"node:path";
import{describe,expect,it}from"vitest";

const workflow=fs.readFileSync(path.resolve("..",".github","workflows","release.yml"),"utf8");
const windowsTestWorkflow=fs.readFileSync(path.resolve("..",".github","workflows","windows-test-build.yml"),"utf8");
const windowsLaunchTest=fs.readFileSync(path.resolve("scripts","test-windows-server-package.ps1"),"utf8");
const windowsPackager=fs.readFileSync(path.resolve("scripts","package-windows-server.mjs"),"utf8");
const windowsLauncher=fs.readFileSync(path.resolve("..","launcher","windows","src","main.cpp"),"utf8");

describe("unsigned Windows server release workflow contract",()=>{
  it("builds, verifies, scans, attests, checksums, and supplies the EXE and portable ZIP",()=>{
    for(const value of[
      "windows-server:",
      "runs-on: windows-2022",
      "node-version: 24",
      "npm_config_node_linker: hoisted",
      "cmake --build out/windows-launcher --config Release",
      "Get-AuthenticodeSignature",
      "SignatureStatus]::NotSigned",
      "Compress-Archive",
      "claudex-workhouse-server-windows-x64-portable.zip",
      "claudex-workhouse-server-windows-x64-portable.zip.sha256",
      "claudex-workhouse-server-windows-x64.exe.sha256",
      "test-windows-server-package.ps1",
      "Get-FileHash -LiteralPath $file -Algorithm SHA256",
      "Start-MpScan",
      "Get-MpComputerStatus",
      "Get-MpThreatDetection",
      "Get-MpThreat",
      "AntivirusSignatureLastUpdated",
      "path: packages/claudex-workhouse-server-windows-x64-folder",
      "subject-path: packages/claudex-workhouse-server-windows-x64.exe",
      "CLAUDEX_WORKHOUSE_WINDOWS_SERVER_EXE:",
      "CLAUDEX_WORKHOUSE_WINDOWS_SERVER_PORTABLE:",
      "CLAUDEX_WORKHOUSE_RELEASE_VERSION=${{ needs.preflight.outputs.version }}",
      "Create unified release checksums",
      "SHA256SUMS",
    ])expect(workflow).toContain(value);
    expect(workflow).toMatch(/prepare-release:\n\s+needs: \[preflight, image, workers, windows-server\]/);
    expect(workflow).not.toContain("WINDOWS_SIGNING_CERTIFICATE_PFX_BASE64");
  });
});

describe("unsigned Windows test build workflow contract",()=>{
  it("creates a manually downloadable EXE and portable ZIP without certificate secrets",()=>{
    for(const value of["workflow_dispatch:","runs-on: windows-2022","SignatureStatus]::NotSigned","Start-MpScan","claudex-workhouse-server-windows-x64-portable.zip","test-windows-server-package.ps1","StatusGuideScreenshot","installed-status-guide.ko.png","Upload unsigned files to a private draft test release"])expect(windowsTestWorkflow).toContain(value);
    expect(windowsTestWorkflow).not.toContain("WINDOWS_SIGNING_CERTIFICATE");
    expect(windowsTestWorkflow).not.toContain("signtool");
  });

  it("launches both Windows packages and verifies health, commit identity, extraction, and shutdown",()=>{
    for(const value of["Test-InstallerWizard","Test-InstalledIntegration","Save-WindowScreenshot","CopyFromScreen","installed shortcut target","installed-guide waiting","listenerPid=","Get-NetTCPConnection","Claudex Workhouse 서버","MainWindowHandle","MainWindowTitle","before the user selected Install","launcherArguments = @('--install')","--install-root=","--uninstall', '--quiet","longInstallRoot","LegacyAclFixture","legacy inaccessible-ACL fixture reproduced","/inheritance:r","Claudex Workhouse.lnk","UninstallString","single-exe","Test-PortableDirectStart","portable direct-start test passed","opened the installation wizard","copied its payload into the AppData install root","registered itself in Windows Installed apps","/api/health/live","/api/health/ready","/api/about","commitSha","current.json","Wait-ServerStopped","Stop-TestInstalledServer","ServerPid","TcpClient","AddMinutes(5)","installedPayload=","windows-launcher-error.log"])expect(windowsLaunchTest).toContain(value);
    expect(windowsLaunchTest.match(/-NoProxy/g)).toHaveLength(8);
  });

  it("shows a responsive native install wizard before payload extraction",()=>{
    for(const value of["WizardState::Welcome","Claudex Workhouse 설치","설치 위치: ","ButtonBrowse","SHBrowseForFolderW","persistInstallRoot","atomicBytes(install/L\"payload-manifest.json\",manifest)","registerInstalledApplication","createShortcut","kUninstallRegistry","scheduleInstallRemoval","PROGRESS_CLASSW","PBS_MARQUEE","CreateThread","kInstallFinished","설치 완료","Workhouse 열기"])expect(windowsLauncher).toContain(value);
    expect(windowsLauncher.indexOf("CreateWindowW(kWindowClass")).toBeLessThan(windowsLauncher.indexOf("MSG message{}"));
  });

  it("runs the installed shortcut as a server status and connection guide",()=>{
    for(const value of["g_installedStatusMode","installedStatusLauncher()","StatusWindowTitle","StatusStartingBody","StatusReadyBody","connectionText()","This PC: ","Other devices: ","windows-server-startup.log","serverLogTail()","server exited with code ","beginOperation(window)"])expect(windowsLauncher).toContain(value);
  });

  it("localizes every launcher string and resolves the locale from flag, environment, preference, and Windows",()=>{
    for(const value of["--lang=","CLAUDEX_WORKHOUSE_LOCALE","GetUserPreferredUILanguages","launcher-locale","persistLocale()","Claudex Workhouse Setup","Claudex Workhouse セットアップ"])expect(windowsLauncher).toContain(value);
    const phrases=windowsLauncher.slice(windowsLauncher.indexOf("const Phrase kPhrases"),windowsLauncher.indexOf("struct Palette"));
    for(const row of phrases.split("\n").filter(line=>line.trim().startsWith("{{"))){
      expect(row.match(/(?<!\\)",L"/g)?.length,`incomplete translation row: ${row.slice(0,60)}`).toBe(2);
    }
  });

  it("draws a DPI-aware themed wizard instead of default system chrome",()=>{
    for(const value of["GetDpiForWindow","WM_DPICHANGED","AdjustWindowRectExForDpi","BS_OWNERDRAW","WM_DRAWITEM","WM_CTLCOLORSTATIC","systemDarkMode","kImmersiveDarkMode","IsDialogMessageW"])expect(windowsLauncher).toContain(value);
    expect(windowsLauncher).not.toContain("DEFAULT_GUI_FONT");
  });

  it("bootstraps a fresh Windows data root without overwriting existing configuration",()=>{
    for(const value of["path.dirname(appDirectory)","claudex-workhouse.json","projects.json",'flag:"wx"',"repairLegacyAcl","protectedConfigs","fs.readFileSync(file)",'repair(file,"F")',"CLAUDEX_WORKHOUSE_APP_ROOT=appRoot"])expect(windowsPackager).toContain(value);
    expect(windowsPackager).not.toContain("fs.accessSync(config,fs.constants.R_OK)");
  });

  it("hashes embedded files while writing without a redundant full readback",()=>{
    expect(windowsLauncher).toContain('L"\\\\\\\\?\\\\"');
    expect(windowsLauncher).toContain("win32File=extendedPath(file)");
    expect(windowsLauncher).toContain("extractHashed(stream,output,size,position)");
    expect(windowsLauncher).toContain("try{verifyPayloadManifest(manifest,target,version);targetReady=true;}catch(...){}");
    expect(windowsLauncher).toContain('throw std::runtime_error("container replace")');
    expect(windowsLauncher).toContain("if(!replaced.empty())MoveFileExW");
    expect(windowsLauncher).toContain("recursive_directory_iterator(extendedPath(payload))");
    expect(windowsLauncher).toContain("MoveFileExW(extendedPath(staging).c_str(),targetPath.c_str(),MOVEFILE_WRITE_THROUGH)");
    expect(windowsLauncher).not.toContain("FlushFileBuffers(output)");
  });
});
