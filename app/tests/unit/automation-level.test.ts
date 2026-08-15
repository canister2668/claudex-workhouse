import {describe,expect,it} from "vitest";
import {automationLevelOf,permissionForAutomation,platformAutomationDefault as webPlatformAutomationDefault,shouldApplyPlatformAutomationDefault} from "../../src/web/automation-level.js";
import {assertAutomationSupported,automationLevel,automationLevelForNewTask,executionPolicyTurnInstructions,fullAccessAcknowledgementValid,grokAutomationLevel,isPermissionProfile,newestExecutionSettings,permissionForAutomation as serverPermissionForAutomation,platformAutomationDefault} from "../../src/server/automation-level.js";
import {dangerFullAccessAcknowledged,requestDangerFullAccessAcknowledgement} from "../../src/web/danger-confirmation.js";

describe("automation level",()=>{
  it("infers legacy permission profiles",()=>{expect(automationLevelOf(":danger-full-access",{})).toBe("full");expect(automationLevelOf(":read-only",{})).toBe("read");expect(automationLevelOf(":workspace",{})).toBe("auto");});
  it("keeps explicit confirmation distinct from workspace auto",()=>{expect(automationLevelOf(":workspace",{automationLevel:"confirm"})).toBe("confirm");});
  it("treats the executable permission as authoritative over stale metadata",()=>{
    expect(automationLevelOf(":danger-full-access",{automationLevel:"auto"})).toBe("full");
    expect(automationLevel( "auto",":danger-full-access")).toBe("full");
    expect(automationLevelOf(":read-only",{automationLevel:"full"})).toBe("read");
  });
  it("maps provider-safe logical profiles",()=>{expect(permissionForAutomation("codex","confirm")).toBe(":workspace");expect(permissionForAutomation("claude","auto")).toBe(":workspace-write");});
  it("uses the same logical mapping on the server",()=>{expect(automationLevel(undefined,":danger-full-access")).toBe("full");expect(serverPermissionForAutomation("codex","full")).toBe(":danger-full-access");expect(serverPermissionForAutomation("codex","read")).toBe(":read-only");expect(serverPermissionForAutomation("codex","auto")).toBe(":workspace");expect(serverPermissionForAutomation("codex","confirm")).toBe(":workspace");});
  it("clamps Grok automation to its executable permission profile",()=>{expect(grokAutomationLevel("full",":workspace-write")).toBe("auto");expect(grokAutomationLevel("confirm",":workspace-write")).toBe("auto");expect(grokAutomationLevel("full",":read-only")).toBe("read");expect(grokAutomationLevel("auto",":danger-full-access")).toBe("full");});
  it("defaults only new Windows Codex settings to confirmation",()=>{
    expect(platformAutomationDefault("codex","win32")).toBe("confirm");
    expect(webPlatformAutomationDefault("codex","win32")).toBe(platformAutomationDefault("codex","win32"));
    expect(automationLevelForNewTask("codex",undefined,undefined,"win32")).toBe("confirm");
    expect(automationLevelForNewTask("codex","auto",undefined,"win32")).toBe("auto");
    expect(automationLevelForNewTask("codex",undefined,":workspace","win32")).toBe("confirm");
    expect(automationLevelForNewTask("codex",undefined,":read-only","win32")).toBe("read");
    expect(automationLevelForNewTask("codex",undefined,":danger-full-access","win32")).toBe("full");
    expect(automationLevelForNewTask("codex",undefined,undefined,"linux")).toBe("auto");
    expect(automationLevelForNewTask("claude",undefined,undefined,"win32")).toBe("auto");
    expect(shouldApplyPlatformAutomationDefault("win32","confirm",[undefined,null])).toBe(true);
    expect(shouldApplyPlatformAutomationDefault("win32","confirm",["auto"])).toBe(false);
    expect(shouldApplyPlatformAutomationDefault("linux","confirm",[])).toBe(false);
  });
  it("rejects permission values outside the fixed provider allowlists",()=>{expect(isPermissionProfile("codex",":danger-full-access")).toBe(true);expect(isPermissionProfile("claude",":workspace-write")).toBe(true);expect(isPermissionProfile("codex",":forged-full-access")).toBe(false);expect(isPermissionProfile("claude",":workspace")).toBe(false);});
  it("rejects Claude confirmation until its approval response bridge exists",()=>{expect(()=>assertAutomationSupported("claude","confirm")).toThrow(expect.objectContaining({code:"AUTOMATION_LEVEL_UNSUPPORTED"}));expect(()=>assertAutomationSupported("codex","confirm")).not.toThrow();});
  it("requires the risk confirmation and versioned full-access acknowledgement in the same request",()=>{expect(fullAccessAcknowledgementValid({dangerConfirmation:true,fullAccessAcknowledged:true,acknowledgementVersion:1})).toBe(true);expect(fullAccessAcknowledgementValid({fullAccessAcknowledged:true,acknowledgementVersion:1})).toBe(false);expect(fullAccessAcknowledgementValid({dangerConfirmation:true,fullAccessAcknowledged:true,acknowledgementVersion:2})).toBe(false);});
  it("treats the current turn policy as authoritative over stale sandbox failures",()=>{const full=executionPolicyTurnInstructions("codex","full"),read=executionPolicyTurnInstructions("claude","read"),compatibleRead=executionPolicyTurnInstructions("codex","read");expect(full).toContain("no filesystem sandbox");expect(full).toContain("supersedes permission assumptions and sandbox failures remembered from earlier turns");expect(full).toContain("run a minimal current-turn probe");expect(full).toContain("Do not repeat an earlier bwrap failure");expect(read).toContain("This turn is read-only");expect(compatibleRead).toContain("Do not write files or claim write capability");});
  it("limits local file links and applies the shared viewer/download policy",()=>{const policy=executionPolicyTurnInstructions("codex","full","/srv/current-workspace");expect(policy).toContain('Workspace root: "/srv/current-workspace"');expect(policy).toContain("Do not select a different target by scanning parent or sibling directories");expect(policy).toContain("Full filesystem access changes capability, not task scope");expect(policy).toContain("below the current session workspace root");expect(policy).toContain("move artifacts from outside paths such as `/tmp` into that workspace");expect(policy).toContain("do not emit file links for remote execution hosts");expect(policy).toContain("normal absolute-path link for documents");expect(policy).toContain("viewer already provides Download");expect(policy).toContain("`?download=1` for archives, installers, executable or package artifacts");});
  it("keeps newer full-access thread settings when an older workspace task refreshes",()=>{
    const oldTask={permissionProfile:":workspace",settingsUpdatedAt:"2026-07-14T01:00:00.000Z",metadata:{automationLevel:"auto"}};
    const currentThread={permissionProfile:":danger-full-access",settingsUpdatedAt:"2026-07-14T02:00:00.000Z",metadata:{automationLevel:"full"}};
    expect(newestExecutionSettings(currentThread,oldTask)).toBe(currentThread);
    expect(newestExecutionSettings(oldTask,currentThread)).toBe(currentThread);
  });
  it("does not let a legacy workspace task with an equal or missing timestamp erase full access",()=>{
    const legacyTask={permissionProfile:":workspace",settingsUpdatedAt:null,metadata:{automationLevel:"auto"}};
    const currentThread={permissionProfile:":danger-full-access",settingsUpdatedAt:null,metadata:{automationLevel:"full"}};
    expect(newestExecutionSettings(currentThread,legacyTask)).toBe(currentThread);
    expect(newestExecutionSettings(legacyTask,currentThread)).toBe(currentThread);
  });
  it("remembers the full-access warning after the first confirmation",()=>{
    const values=new Map<string,string>(),storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);}} as Storage;
    let prompts=0;
    expect(requestDangerFullAccessAcknowledgement(()=>{prompts++;return true;},storage)).toBe(true);
    expect(requestDangerFullAccessAcknowledgement(()=>{prompts++;return false;},storage)).toBe(true);
    expect(dangerFullAccessAcknowledged(storage)).toBe(true);
    expect(prompts).toBe(1);
  });
});
