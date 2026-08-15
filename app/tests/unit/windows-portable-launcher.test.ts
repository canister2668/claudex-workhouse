import fs from "node:fs";
import path from "node:path";
import{describe,expect,it}from "vitest";

const source=fs.readFileSync(path.resolve("..","launcher","windows","src","main.cpp"),"utf8");
const launchTest=fs.readFileSync(path.resolve("scripts","test-windows-server-package.ps1"),"utf8");

/** Extracts one `namespace`-level function body by brace matching, skipping
 * forward declarations. */
function functionBody(signature:string){
  let at=-1;
  for(let search=source.indexOf(signature);search>-1;search=source.indexOf(signature,search+1)){
    if(source.slice(search+signature.length).trimStart().startsWith("{")){at=search;break;}
  }
  expect(at,`${signature} is missing from the Windows launcher`).toBeGreaterThan(-1);
  let index=source.indexOf("{",at),depth=0;
  const start=index;
  for(;index<source.length;index++){
    const character=source[index];
    if(character==="{")depth++;
    else if(character==="}"&&--depth===0)return source.slice(start,index+1);
  }
  throw new Error(`${signature} has an unbalanced body`);
}

/** The line that resolves which of the three launcher forms is running. */
function modeResolution(){
  const body=functionBody("int WINAPI wWinMain(HINSTANCE instance,HINSTANCE,LPWSTR commandLine,int)");
  return body.split("\n").filter(line=>/g_portableMode=|g_installedStatusMode=|const bool embedded=/.test(line)).join("\n");
}

describe("Windows portable launcher contract",()=>{
  /** The field failure: a portable folder answered a failed structural probe
   * with the installation wizard, so a runtime fault looked like a product
   * decision. Only a launcher that can install something may offer to. */
  it("never falls back to the installation wizard when there is nothing to install",()=>{
    const resolution=modeResolution();
    expect(resolution).toContain("const bool embedded=embeddedPayloadPresent();");
    expect(resolution).toContain("g_portableMode=!g_autoInstall&&!g_installedStatusMode&&!embedded;");
    // Nothing about the adjacent payload may gate the mode: reading it can fail
    // for reasons that have no bearing on whether an install is even possible.
    expect(resolution).not.toMatch(/current\.json|payload-manifest|node\.exe|start\.mjs|readBytes|jsonString|safeRelative/);
    expect(source).not.toContain("portableFolderLauncher");
  });

  /** The wizard entry point is reachable from exactly one branch, and that
   * branch runs only for a launcher outside direct start mode. */
  it("keeps the installation wizard behind the embedded payload only",()=>{
    expect(source).toContain("bool directStartMode(){return g_installedStatusMode||g_portableMode;}");
    expect(source).toContain("if(directStartMode())beginOperation(window);");
    expect(source).toContain("else{showWelcome();if(g_autoInstall)PostMessageW(window,WM_COMMAND,kInstall,0);}");
    expect((source.match(/showWelcome\(\)/g)??[]).length,"showWelcome has one definition and one call site").toBe(2);
    expect(source).toContain("g_wizardState=directStartMode()?WizardState::Starting:WizardState::Installing;");
  });

  /** The one answer that picks wizard versus direct start must not depend on
   * streams, std::filesystem or an exception path, and must fail closed. */
  it("decides the embedded payload question with Win32 calls that cannot throw",()=>{
    const body=functionBody("bool embeddedPayloadPresent()");
    expect(body).toContain("CreateFileW");
    expect(body).toContain("GetFileSizeEx");
    expect(body).toContain("CloseHandle(handle);return present;");
    expect(body).not.toMatch(/ifstream|std::filesystem|throw|catch/);
    for(const failClosed of["if(!length||length>=image.size())return false;","if(handle==INVALID_HANDLE_VALUE)return false;"]){
      expect(body,"an unreadable launcher answers \"no embedded payload\"").toContain(failClosed);
    }
  });

  /** MinGW's std::filesystem::absolute keeps a forward slash that arrived in a
   * `payload/1.0.0` component, and an extended-length path turns off the Win32
   * separator rewrite, so `\\?\...payload/1.0.0\node.exe` does not resolve.
   * That is what made every adjacent-payload probe fail on Windows. */
  it("normalises separators before applying the extended-length prefix",()=>{
    const body=functionBody("std::filesystem::path extendedPath(const std::filesystem::path& value)");
    expect(body).toContain("for(auto& character:absolute)if(character==L'/')character=L'\\\\';");
    expect(body.indexOf("character==L'/'")).toBeLessThan(body.indexOf('L"\\\\\\\\?\\\\"+absolute'));
    const start=functionBody("bool startServer()");
    expect(start).toContain("std::filesystem::path(relative).make_preferred()");
    expect(start).not.toContain("weakly_canonical");
    expect(start).toContain("win32Directory(extendedPath(payload).wstring())");
    expect(start).toContain("win32RegularFile(extendedPath(node).wstring())");
    // The full manifest hash verification stays where it belongs: startup.
    expect(start).toContain("if(embeddedManifest.empty())verifyPayload(base,payload,version);");
  });

  /** A portable start that fails has to be identifiable as one. */
  it("records how the launcher decided and why a portable start failed",()=>{
    expect(source).toContain("std::string g_startError,g_launcherDiagnosis;");
    const resolution=modeResolution();
    expect(source).toContain('g_launcherDiagnosis=std::string("mode=")+(g_installedStatusMode?"installed-status":(g_portableMode?"portable":"installer"))+" "+describeLauncherLayout(embedded);');
    expect(resolution).toBeTruthy();
    const describe_=functionBody("std::string describeLauncherLayout(bool embedded)");
    for(const evidence of["base=","embeddedPayload=","current.json","payload-manifest.json","payloadDirectory=","safeRelative=","payloadDir=","node.exe=","app/start.mjs="]){
      expect(describe_,`the diagnosis must report ${evidence}`).toContain(evidence);
    }
    expect(describe_).toContain("/ext=");
    const writer=functionBody("void writeLauncherError()");
    expect(writer).toContain("windows-launcher-error.log");
    expect(writer).toContain('g_startError+"\\n"+g_launcherDiagnosis');
    expect(source).toContain("writeLauncherError();showFailure();");
    expect(source).toContain('windows-launcher-diagnostics.log');
    expect(source).toContain('else if(argument==L"--diagnose")g_diagnose=true;');
    // The failure screen names the mode, so a support screenshot is conclusive.
    expect(source).toContain("body+=L\"\\n\"+utf8(g_launcherDiagnosis.substr(0,g_launcherDiagnosis.find(' ')))");
  });

  it("keeps installation, registration and shortcut work out of portable mode",()=>{
    const body=functionBody("bool startServer()");
    expect(body).toContain("g_portableMode?executablePath().parent_path():prepareEmbeddedPayload(embeddedManifest,embeddedTarget)");
    for(const installerOnly of["registerInstalledApplication","persistInstallRoot","createShortcut","copyInstalledLauncher","storeServerPid"]){
      for(const line of body.split("\n")){
        if(!line.includes(`${installerOnly}(`))continue;
        expect(line.includes("!g_portableMode"),`${installerOnly} must stay behind the portable-mode guard`).toBe(true);
      }
    }
    expect(body).toContain("CLAUDEX_WORKHOUSE_DATA_ROOT");
  });

  it("preserves the single EXE installer wizard and the installed status launcher",()=>{
    expect(source).toContain("case WizardState::Welcome:");
    expect(source).toContain("setButton(g_installButton,text(Text::ButtonInstall),true)");
    expect(source).toContain("if(command==kBrowse&&g_wizardState==WizardState::Welcome){browseInstallRoot(window);return 0;}");
    expect(functionBody("bool installedStatusLauncher()")).toContain("registeredInstallRoot(root)&&verifiedInstalledRoot(root)");
    expect(functionBody("std::filesystem::path prepareEmbeddedPayload(std::string& embeddedManifest,std::filesystem::path& embeddedTarget)")).toContain("registerInstalledApplication(install,version);");
    expect(source).toContain("int uninstallApplication()");
    expect(functionBody("bool beginPendingUpdate(HWND window)")).toContain("portable-updater.js");
  });

  /** The Windows launch test has to prove the three outcomes on a real machine,
   * not just in this source contract. */
  it("binds the Windows launch test to the three launcher outcomes",()=>{
    for(const value of[
      "Test-PortableDirectStart",
      "Test-PortableBrokenLayout",
      "--diagnose",
      "windows-launcher-diagnostics.log",
      "mode=$ExpectedMode *",
      "-ExpectedMode 'portable'",
      "-ExpectedMode 'installer'",
      "embeddedPayload=$ExpectedEmbedded",
      "*mode=portable*",
      "opened the installation wizard",
      "windows-launcher-error.log"
    ])expect(launchTest,`the Windows launch test must exercise ${value}`).toContain(value);
    expect(launchTest).toContain("Test-InstallerWizard -Launcher $singleExePath -Locale 'en'");
  });

  it("keeps every locale column aligned with the Text enum",()=>{
    const names=source.match(/enum class Text\{([^}]+)\}/)?.[1].split(",").map(value=>value.trim())??[];
    expect(names.length).toBeGreaterThan(10);
    expect(names.at(-1)).toBe("Count");
    expect(names).toContain("PortableStartingBody");
    expect(names).toContain("PortableFailedBody");
    const table=source.match(/const Phrase kPhrases\[static_cast<size_t>\(Text::Count\)\]=\{([\s\S]*?)\n\};/)?.[1]??"";
    const rows=table.match(/^ {2}\{\{/gm)??[];
    expect(rows.length,"kPhrases needs one row per Text entry excluding Count").toBe(names.length-1);
    for(const row of table.split("\n").filter(line=>line.startsWith("  {{"))){
      expect((row.match(/L"/g)??[]).length,`every locale column must be translated: ${row.slice(0,60)}`).toBeGreaterThanOrEqual(3);
    }
  });
});
