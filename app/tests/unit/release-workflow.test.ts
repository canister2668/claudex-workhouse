import fs from"node:fs";
import path from"node:path";
import{describe,expect,it}from"vitest";

const workflow=fs.readFileSync(path.resolve("..",".github","workflows","release.yml"),"utf8");
const windowsTestWorkflow=fs.readFileSync(path.resolve("..",".github","workflows","windows-test-build.yml"),"utf8");
const windowsLaunchTest=fs.readFileSync(path.resolve("scripts","test-windows-server-package.ps1"),"utf8");
const windowsPackager=fs.readFileSync(path.resolve("scripts","package-windows-server.mjs"),"utf8");
const windowsLauncher=fs.readFileSync(path.resolve("..","launcher","windows","src","main.cpp"),"utf8");

describe("release workflow Windows exclusion",()=>{
  it("builds no Windows target, because those targets are in development",()=>{
    // A release ships no Windows asset. The Windows contract that still holds
    // is the manual test build below; restoring a Windows release job means
    // restoring its contract test here too.
    for(const value of[
      "windows-server:",
      "windows-2022",
      "claudex-workhouse-windows-x64.exe",
      "claudex-workhouse-windows-portable.zip",
      "claudex-workhouse-worker-windows-x64.zip",
      "CLAUDEX_WORKHOUSE_WINDOWS_SERVER_EXE_URL"
    ])expect(workflow).not.toContain(value);
    expect(workflow.toLowerCase()).not.toContain("windows");
  });
});

describe("npm distribution contract",()=>{
  it("publishes the release's own tarball, after promotion, only against the signed digest",()=>{
    for(const value of[
      "node app/scripts/pack-node-package.mjs --output",
      "CLAUDEX_WORKHOUSE_NODE_PACKAGE:",
      "publish-npm:",
      "needs: [preflight, prepare-release, finalize-stable]",
      "registry-url: https://registry.npmjs.org",
      "--provenance --access public"
    ])expect(workflow).toContain(value);
    // The registry is a convenience channel, so a missing token skips the job
    // rather than failing a release that is already published.
    expect(workflow).toContain("No NPM_TOKEN is configured, so the npm publish is skipped.");
    expect(workflow).toContain("steps.token.outputs.configured == 'true'");
    // Publishing whatever the build produced would defeat the signature: the
    // job downloads the published asset and checks it against the manifest.
    expect(workflow).toContain("The published tarball does not match the signed manifest.");
    expect(workflow).toContain("The signed manifest binds no Node package.");
    expect(workflow).not.toMatch(/npm publish[^\n]*release-assets/);
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
