import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe,expect,it } from "vitest";

const helper=path.resolve(import.meta.dirname,"../../../bin/grok-usage.py");
const fixture=path.resolve(import.meta.dirname,"../fixtures/grok-usage.txt");

describe("Grok CLI usage probe",()=>{
  it("parses weekly credits, reset, balance, and plan without account identity",()=>{
    const parsed=JSON.parse(execFileSync("python3",[helper,"parse"],{input:fs.readFileSync(fixture,"utf8"),encoding:"utf8"}));
    expect(parsed).toMatchObject({
      ok:true,
      source:"grok-cli-usage",
      plan:"SuperGrok",
      seven_day:{utilization:38,resets_at:null,reset_label:"Aug 17, 2026 at 8:00 PM (Asia/Seoul)"},
      prepaid_balance:12.4
    });
    expect(JSON.stringify(parsed)).not.toContain("private.user@example.com");
  });

  it("parses billing field names and epoch resets without exposing unrelated fields",()=>{
    const input=JSON.stringify({creditUsagePercent:72.5,billingPeriodEnd:1786381200,prepaidBalance:4.25,subscription_tier:"SuperGrok Heavy",email:"secret@example.com"});
    const parsed=JSON.parse(execFileSync("python3",[helper,"parse"],{input,encoding:"utf8"}));
    expect(parsed.seven_day).toEqual({utilization:72.5,resets_at:"2026-08-10T17:00:00Z",reset_label:null});
    expect(parsed).toMatchObject({plan:"SuperGrok Heavy",prepaid_balance:4.25});
    expect(JSON.stringify(parsed)).not.toContain("secret@example.com");
  });

  it("resumes one isolated session and drives the cursor-addressed /usage screen",()=>{
    const home=fs.mkdtempSync(path.join(os.tmpdir(),"grok-usage-home-")),directory=fs.mkdtempSync(path.join(os.tmpdir(),"grok-usage-prompt-")),binary=path.join(directory,"fake-grok.py"),argsFile=path.join(directory,"args.json"),commandsFile=path.join(directory,"commands.txt"),sessionId="019fee50-1592-73f0-8dc4-16f731eb5c7e";
    fs.mkdirSync(path.join(home,".grok","sessions",encodeURIComponent(directory),sessionId),{recursive:true});
    fs.writeFileSync(binary,`#!/usr/bin/env python3
import json, os, sys, time, tty
with open(${JSON.stringify(argsFile)}, "w") as handle:
    json.dump({"args":sys.argv[1:],"updater":os.environ.get("GROK_DISABLE_AUTOUPDATER")},handle)
tty.setraw(sys.stdin.fileno())
os.write(sys.stdout.fileno(),b"\\x1b[6n")
os.read(sys.stdin.fileno(),6)
os.write(sys.stdout.fileno(),b"\\x1b[2J\\x1b[20;5H\\xe2\\x9d\\xaf\\x1b[4;6HLoading session...")
time.sleep(.05)
os.write(sys.stdout.fileno(),b"\\x1b[4;6H                  \\x1b[20;5H\\xe2\\x9d\\xaf")
received=b""
while True:
    received += os.read(sys.stdin.fileno(),1024)
    if b"\\r" not in received: continue
    command, received = received.split(b"\\r",1)
    command = command.lstrip(b"\\x1b")
    with open(${JSON.stringify(commandsFile)},"a") as handle: handle.write(command.decode()+"\\n")
    if command == b"/usage":
        os.write(sys.stdout.fileno(),b"\\x1b[6;6HWeekly limit: 41%\\x1b[7;6HNext reset: Aug 18, 2026 9:00 PM\\x1b[8;6HTier: SuperGrok\\x1b[9;6HCredits left: $3.50")
    elif command == b"/exit": break
`);
    fs.chmodSync(binary,0o700);
    try{
      const parsed=JSON.parse(execFileSync("python3",[helper,binary,directory],{encoding:"utf8",timeout:10_000,env:{...process.env,HOME:home}}));
      expect(parsed).toMatchObject({ok:true,plan:"SuperGrok",seven_day:{utilization:41},prepaid_balance:3.5});
      const invocation=JSON.parse(fs.readFileSync(argsFile,"utf8"));
      expect(invocation.updater).toBe("1");
      expect(invocation.args).toEqual(expect.arrayContaining(["--resume",sessionId,"--no-alt-screen","--no-auto-update","--no-memory","--no-subagents","--disable-web-search","--permission-mode","plan","--cwd",directory]));
      expect(fs.readFileSync(commandsFile,"utf8").trim().split("\n")).toEqual(["/usage","/exit"]);
    }finally{fs.rmSync(directory,{recursive:true,force:true});fs.rmSync(home,{recursive:true,force:true});}
  });

  it("returns a specific error when OAuth login is absent",()=>{
    const parsed=JSON.parse(execFileSync("python3",[helper,"parse"],{input:"Billing data requires auth with grok.com. Run `grok login` to authenticate.",encoding:"utf8"}));
    expect(parsed).toMatchObject({ok:false,error:"authentication_required",seven_day:null,prepaid_balance:null});
  });

  it("recognizes the exact unauthenticated status emitted by Grok CLI 1.0.0",()=>{
    const parsed=JSON.parse(execFileSync("python3",[helper,"parse"],{input:"You are not authenticated.",encoding:"utf8"}));
    expect(parsed).toMatchObject({ok:false,error:"authentication_required",seven_day:null,prepaid_balance:null});
  });

  it("recognizes the device-authorization screen shown by an unauthenticated CLI",()=>{
    const parsed=JSON.parse(execFileSync("python3",[helper,"parse"],{input:"Approve in your browser to finish signing in.\nWaiting for approval...",encoding:"utf8"}));
    expect(parsed).toMatchObject({ok:false,error:"authentication_required",seven_day:null,prepaid_balance:null});
  });
});
