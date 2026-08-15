import { afterEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ProviderAuthManager, antigravityAuthHosts, claudeAuthHosts,grokAuthHosts, maskEmail, parseClaudeAuthStatus, parseCodexAccount, providerAuthLimits, validateAntigravityAuthUrl, validateClaudeAuthUrl, validateCodexAuthUrl,validateGrokAuthUrl,windowsClaudeLoginCommand } from "../../src/server/provider-auth.js";
import { resetCodexAppServerPool } from "../../src/server/codex/app-server.js";

const roots:string[]=[];
const temp=()=>{const dir=fs.mkdtempSync(path.join(process.cwd(),".claudex-workhouse-auth-test-"));roots.push(dir);return dir;};
const waitFor=async(check:()=>boolean,timeout=6000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(check())return;await new Promise(resolve=>setTimeout(resolve,25));}throw new Error("condition timed out");};
const sourceRoot=path.resolve(process.cwd(),"..");
const config=(dataRoot:string,claudeBinary:string,grokBinary="/bin/false")=>({root:sourceRoot,dataDir:path.join(dataRoot,"data"),claudeBinary,grokBinary,commandTimeoutMs:15000,commandOutputLimit:65536} as any);

afterEach(()=>{resetCodexAppServerPool();delete process.env.CLAUDEX_WORKHOUSE_CODEX_BIN;delete process.env.CLAUDEX_WORKHOUSE_ROOT;delete process.env.CLAUDEX_WORKHOUSE_ANTIGRAVITY_BINARY;delete process.env.FAKE_AUTH_STATE;delete process.env.FAKE_DEVICE_UNSUPPORTED;delete process.env.FAKE_CLAUDE_STATE;delete process.env.FAKE_CLAUDE_MODE;delete process.env.FAKE_ANTIGRAVITY_STATE;for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});

describe("provider auth parsing and URL boundaries",()=>{
  test("builds a fixed Windows Claude login command and quotes apostrophes",()=>{
    expect(windowsClaudeLoginCommand("C:\\Program Files\\Claude\\claude.exe","subscription")).toBe("& 'C:\\Program Files\\Claude\\claude.exe' auth login --claudeai");
    expect(windowsClaudeLoginCommand("C:\\Odd'Name\\claude.exe","sso")).toBe("& 'C:\\Odd''Name\\claude.exe' auth login --sso");
  });
  test("accepts only the observed exact Claude authentication hosts",()=>{
    expect(claudeAuthHosts).toEqual(["claude.com","platform.claude.com"]);
    expect(validateClaudeAuthUrl("https://claude.com/oauth/authorize?x=1")).toContain("claude.com");
    expect(validateClaudeAuthUrl("https://platform.claude.com/oauth/authorize")).toContain("platform.claude.com");
    for(const value of ["http://claude.com/x","https://evil.claude.com/x","https://claude.com.evil.test/x","https://user@claude.com/x","javascript:alert(1)","data:text/plain,x","https://127.0.0.1/x"])expect(validateClaudeAuthUrl(value)).toBeNull();
  });
  test("accepts official Codex auth hosts and rejects lookalikes",()=>{
    expect(validateCodexAuthUrl("https://auth.openai.com/codex/device")).toContain("auth.openai.com");
    expect(validateCodexAuthUrl("https://auth.openai.com.evil.test/x")).toBeNull();
  });
  test("accepts only the observed Google OAuth host for Antigravity",()=>{
    expect(antigravityAuthHosts).toEqual(["accounts.google.com"]);
    expect(validateAntigravityAuthUrl("https://accounts.google.com/o/oauth2/auth?x=1")).toContain("accounts.google.com");
    for(const value of ["http://accounts.google.com/x","https://evil.accounts.google.com/x","https://accounts.google.com.evil.test/x","https://user@accounts.google.com/x","https://google.com/x"])expect(validateAntigravityAuthUrl(value)).toBeNull();
  });
  test("accepts only official Grok device authorization hosts",()=>{
    expect(grokAuthHosts).toEqual(["grok.com","auth.x.ai","accounts.x.ai"]);
    expect(validateGrokAuthUrl("https://grok.com/device")).toBe("https://grok.com/device");
    expect(validateGrokAuthUrl("https://auth.x.ai/device?code=1")).toContain("auth.x.ai");
    for(const value of["http://grok.com/device","https://evil.grok.com/device","https://grok.com.evil.test/device","https://user@grok.com/device"])expect(validateGrokAuthUrl(value)).toBeNull();
  });
  test("preserves unknown status instead of guessing disconnected",()=>{
    expect(providerAuthLimits.timeoutMs).toBe(300000);
    expect(parseClaudeAuthStatus("not-json").state).toBe("unknown");
    expect(parseClaudeAuthStatus(JSON.stringify({loggedIn:false})).state).toBe("disconnected");
    expect(parseClaudeAuthStatus(JSON.stringify({loggedIn:true,authMethod:"claude.ai",subscriptionType:"max",email:"person@example.com"}))).toMatchObject({state:"connected",accountType:"claude.ai",planType:"max",emailMasked:"p***@example.com"});
    expect(parseCodexAccount({requiresOpenaiAuth:false,account:null}).state).toBe("unknown");
    expect(parseCodexAccount({requiresOpenaiAuth:true,account:null}).state).toBe("disconnected");
    expect(parseCodexAccount({requiresOpenaiAuth:true,account:{type:"chatgpt",planType:"unknown",email:"person@example.com"}})).toMatchObject({state:"connected",planType:null,emailMasked:"p***@example.com"});
    expect(maskEmail("not-an-email")).toBeNull();
  });
});

describe("Grok official CLI device authorization",()=>{
  test("publishes only the verification URL and user code, then verifies the shared CLI account",async()=>{
    const root=temp(),binary=path.join(root,"grok-fake"),state=path.join(root,"grok-login-state");
    fs.writeFileSync(binary,`#!/bin/sh
if [ "$1" = "models" ]; then
  if [ -f "${state}" ]; then printf 'Default model: grok-4.5\\n'; exit 0; fi
  printf 'Default model: grok-4.5\\n'; printf 'You are not authenticated.\\n' >&2; exit 0
fi
if [ "$1" = "login" ]; then
  printf 'Open https://grok.com/device\\nCode: GROK-1234\\n'
  sleep 0.1
  : > "${state}"
  exit 0
fi
if [ "$1" = "logout" ]; then rm -f "${state}"; exit 0; fi
exit 2
`);fs.chmodSync(binary,0o700);
    const manager=new ProviderAuthManager(config(root,"/bin/false",binary)),started=await manager.start("grok","device","owner@example.com");
    expect(started).toMatchObject({provider:"grok",state:"waiting",url:"https://grok.com/device",userCode:"GROK-1234",codeRequired:false});const events:any[]=[];manager.subscribe("grok",started.attemptId,event=>events.push(event));await waitFor(()=>events.some(event=>event.type==="auth/completed"));expect(manager.getCached().find(item=>item.provider==="grok")).toMatchObject({state:"connected",accountType:"grok-oauth"});expect(JSON.stringify(events)).not.toContain("token");await manager.logout("grok");expect(fs.existsSync(state)).toBe(false);manager.shutdown();
  });
});

function fakeAntigravity(root:string){
  const binary=path.join(root,"agy-fake"),state=path.join(root,"antigravity-login-state");
  fs.copyFileSync(path.resolve("tests/fixtures/fake-antigravity-auth.sh"),binary);fs.chmodSync(binary,0o700);process.env.CLAUDEX_WORKHOUSE_ANTIGRAVITY_BINARY=binary;process.env.FAKE_ANTIGRAVITY_STATE=state;return{binary,state};
}

describe("Antigravity official CLI PTY bridge",()=>{
  test("keeps the authorization code out of events and verifies a new CLI process",async()=>{
    const root=temp(),fake=fakeAntigravity(root),audit:any[]=[],manager=new ProviderAuthManager(config(root,"/bin/false"),entry=>{audit.push(entry);});
    const started=await manager.start("antigravity","google-oauth","owner@example.com");expect(validateAntigravityAuthUrl(started.url)).toBeTruthy();expect(started).toMatchObject({state:"code_required",codeRequired:true});const events:any[]=[];manager.subscribe("antigravity",started.attemptId,event=>events.push(event));
    await manager.submitCode("antigravity",started.attemptId,started.inputNonce!,"GOOGLE-ONE-TIME-CODE");await waitFor(()=>events.some(event=>event.type==="auth/completed"));
    expect(fs.existsSync(fake.state)).toBe(true);expect(manager.getCached().find(item=>item.provider==="antigravity")).toMatchObject({state:"connected",accountType:"google-oauth"});expect(JSON.stringify(events)).not.toContain("GOOGLE-ONE-TIME-CODE");expect(JSON.stringify(audit)).not.toContain("GOOGLE-ONE-TIME-CODE");
    await manager.logout("antigravity");expect(fs.existsSync(fake.state)).toBe(false);manager.shutdown();
  },30000);
  test("does not start an Antigravity OAuth flow for direct Vertex mode",async()=>{
    const root=temp(),execution={version:1 as const,backend:"vertex" as const,vertex:{projectId:"sample-project-123",location:"global",credentialsPath:"/secure/service-account.json",creditsUrl:""}},manager=new ProviderAuthManager(config(root,"/bin/false"),()=>{},{antigravityExecution:async()=>execution});
    await expect(manager.start("antigravity","google-cloud","owner@example.com")).rejects.toMatchObject({code:"VERTEX_SERVICE_ACCOUNT_LOGIN",statusCode:409});manager.shutdown();
  });
});

function fakeClaude(root:string){
  const binary=path.join(root,"claude-fake"),state=path.join(root,"logged-in"),modeFile=path.join(root,"mode");
  fs.copyFileSync(path.resolve("tests/fixtures/fake-claude-auth.sh"),binary);fs.chmodSync(binary,0o700);process.env.FAKE_CLAUDE_STATE=state;process.env.FAKE_CLAUDE_MODE=modeFile;
  return{binary,state,modeFile};
}

describe("Claude official CLI PTY bridge",()=>{
  test("handles subscription, Console and SSO code input without auditing the code",async()=>{
    const root=temp(),fake=fakeClaude(root),audit:any[]=[];const manager=new ProviderAuthManager(config(root,fake.binary),entry=>{audit.push(entry);});
    for(const [method,expected] of [["subscription","subscription"],["console","console"],["sso","sso"]] as const){
      fs.rmSync(fake.state,{force:true});const started=await manager.start("claude",method,"owner@example.com");expect(validateClaudeAuthUrl(started.url)).toBeTruthy();expect(started).toMatchObject({state:"code_required",codeRequired:true});const events:any[]=[];manager.subscribe("claude",started.attemptId,event=>events.push(event));
      await waitFor(()=>events.some(event=>event.type==="auth/code-required")||events.some(event=>["failed","cancelled","timeout"].includes(event.state)));
      expect(events.map(event=>({type:event.type,state:event.state,error:event.errorCategory}))).toContainEqual(expect.objectContaining({type:"auth/code-required"}));
      await manager.submitCode("claude",started.attemptId,started.inputNonce!,"ONE-TIME-CODE-123");
      await waitFor(()=>events.some(event=>event.type==="auth/completed"));expect(fs.readFileSync(fake.modeFile,"utf8")).toBe(expected);expect(manager.getCached().find(item=>item.provider==="claude")?.state).toBe("connected");
      expect(JSON.stringify(events)).not.toContain("ONE-TIME-CODE-123");expect(JSON.stringify(audit)).not.toContain("ONE-TIME-CODE-123");await manager.logout("claude");
    }
    manager.shutdown();
  },30000);
  test("cancels the PTY attempt and ignores later output",async()=>{
    const root=temp(),fake=fakeClaude(root),manager=new ProviderAuthManager(config(root,fake.binary));const started=await manager.start("claude","subscription","owner@example.com");const events:any[]=[];manager.subscribe("claude",started.attemptId,event=>events.push(event));await waitFor(()=>events.some(event=>event.type==="auth/code-required")||events.some(event=>["failed","cancelled","timeout"].includes(event.state)));expect(events.map(event=>({type:event.type,state:event.state,error:event.errorCategory}))).toContainEqual(expect.objectContaining({type:"auth/code-required"}));await manager.cancel("claude",started.attemptId);await waitFor(()=>events.some(event=>event.type==="auth/cancelled"));expect(events.at(-1).state).toBe("cancelled");manager.shutdown();
  });
  test("restores an active attempt for the initiating web user without sharing its input capability",async()=>{
    const root=temp(),fake=fakeClaude(root),manager=new ProviderAuthManager(config(root,fake.binary));const started=await manager.start("claude","subscription","owner@example.com");
    await waitFor(()=>manager.listActive("owner@example.com")[0]?.state==="code_required");
    expect(manager.listActive("owner@example.com")[0]).toMatchObject({attemptId:started.attemptId,inputNonce:started.inputNonce,state:"code_required"});
    expect(manager.listActive("another@example.com")[0]).not.toHaveProperty("inputNonce");
    await manager.cancel("claude",started.attemptId);expect(manager.listActive("owner@example.com")).toEqual([]);expect(manager.listRecent("owner@example.com")[0]).toMatchObject({attemptId:started.attemptId,state:"cancelled"});expect(manager.listRecent("owner@example.com")[0]).not.toHaveProperty("inputNonce");manager.shutdown();
  });
  test("times out, blocks duplicates, and cancels active attempts on shutdown",async()=>{
    const root=temp(),fake=fakeClaude(root),manager=new ProviderAuthManager(config(root,fake.binary),()=>{}, {timeoutMs:1_000});const started=await manager.start("claude","subscription","owner@example.com");const events:any[]=[];manager.subscribe("claude",started.attemptId,event=>events.push(event));await expect(manager.start("claude","console","owner@example.com")).rejects.toMatchObject({code:"AUTH_ALREADY_RUNNING"});await waitFor(()=>events.some(event=>event.type==="auth/timeout"),4000);expect(events.at(-1)).toMatchObject({state:"timeout",errorCategory:"auth_timeout"});const next=await manager.start("claude","sso","owner@example.com");const shutdownEvents:any[]=[];manager.subscribe("claude",next.attemptId,event=>shutdownEvents.push(event));manager.shutdown();expect(shutdownEvents.at(-1)).toMatchObject({state:"cancelled",errorCategory:"server_shutdown"});
  });
});

function fakeCodex(root:string){
  const binary=path.join(root,"codex-fake.mjs"),state=path.join(root,"codex-login-state");
  fs.copyFileSync(path.resolve("tests/fixtures/fake-codex-auth.mjs"),binary);fs.chmodSync(binary,0o700);process.env.CLAUDEX_WORKHOUSE_ROOT=root;process.env.CLAUDEX_WORKHOUSE_CODEX_BIN=binary;return{binary,state};
}

describe("Codex app-server account protocol",()=>{
  test("completes device login only after account/read verification",async()=>{
    const root=temp(),fake=fakeCodex(root);process.env.CLAUDEX_WORKHOUSE_CODEX_BIN=fake.binary;process.env.FAKE_AUTH_STATE=fake.state;const manager=new ProviderAuthManager(config(root,"/bin/false"));const started=await manager.start("codex","device","owner@example.com");expect(started.url).toContain("auth.openai.com");expect(started.userCode).toBe("ABCD-EFGH");const events:any[]=[];manager.subscribe("codex",started.attemptId,event=>events.push(event));await waitFor(()=>events.some(event=>event.type==="auth/completed"));expect(manager.getCached().find(item=>item.provider==="codex")).toMatchObject({state:"connected",planType:"pro"});manager.shutdown();
  });
  test("cancels by loginId and ignores a late completion",async()=>{
    const root=temp(),fake=fakeCodex(root);process.env.CLAUDEX_WORKHOUSE_CODEX_BIN=fake.binary;process.env.FAKE_AUTH_STATE=fake.state;const manager=new ProviderAuthManager(config(root,"/bin/false"));const started=await manager.start("codex","device","owner@example.com");const events:any[]=[];manager.subscribe("codex",started.attemptId,event=>events.push(event));await manager.cancel("codex",started.attemptId);await new Promise(resolve=>setTimeout(resolve,250));expect(events.at(-1).state).toBe("cancelled");expect(fs.existsSync(fake.state)).toBe(false);manager.shutdown();
  });
  test("reports device policy rejection and supports browser fallback",async()=>{
    const root=temp(),fake=fakeCodex(root);process.env.CLAUDEX_WORKHOUSE_CODEX_BIN=fake.binary;process.env.FAKE_AUTH_STATE=fake.state;process.env.FAKE_DEVICE_UNSUPPORTED="1";const manager=new ProviderAuthManager(config(root,"/bin/false"));const rejected=await manager.start("codex","device","owner@example.com");expect(rejected).toMatchObject({state:"failed",errorCategory:"device_code_unsupported"});delete process.env.FAKE_DEVICE_UNSUPPORTED;const browser=await manager.start("codex","browser","owner@example.com");expect(browser.url).toContain("auth.openai.com");const events:any[]=[];manager.subscribe("codex",browser.attemptId,event=>events.push(event));await waitFor(()=>events.some(event=>event.type==="auth/completed"));manager.shutdown();
  });
});
