import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach,beforeEach,describe,expect,it} from "vitest";
import {providerStatus} from "../../src/server/desktop-worker/tasks.js";
import type {WorkerConfig} from "../../src/server/desktop-worker/config.js";

let home="";

const config=(overrides:Partial<WorkerConfig>={}):WorkerConfig=>({
  schemaVersion:1,serverUrl:null,hostId:"local",credential:null,credentialVersion:0,entryKey:"k",
  roots:[],workspaces:[],tasks:[],runtimeHome:home,
  claudeBinary:path.join(home,"missing-claude"),codexBinary:path.join(home,"missing-codex"),...overrides
});

function fakeClaude(name:string){
  const file=path.join(home,name);
  fs.writeFileSync(file,'#!/bin/sh\nif [ "$1" = "--version" ]; then echo "9.9.9 (Claude Code)"; else echo \'{"loggedIn":false}\'; fi\n',{mode:0o755});
  return file;
}

beforeEach(()=>{home=fs.mkdtempSync(path.join(os.tmpdir(),"provider-status-"));});
afterEach(()=>{fs.rmSync(home,{recursive:true,force:true});});

/** The managed-CLI card must name the executable the status was taken from,
 * which is the one a Worker launch resolves. */
describe("Worker provider status reports the probed binary",()=>{
  it("returns the resolved path alongside the version it probed",async()=>{
    const binary=fakeClaude("claude");
    const status=await providerStatus(config({claudeBinary:binary})) as any;
    expect(status.runtimes.claude).toMatchObject({installed:true,binaryPath:binary});
    expect(status.runtimes.claude.version).toContain("9.9.9");
    expect(status.accounts.claude.state).toBe("disconnected");
  });

  it("still reports the path it tried when the runtime is not installed",async()=>{
    const value=config();
    const status=await providerStatus(value) as any;
    expect(status.runtimes.claude).toMatchObject({installed:false,version:null,binaryPath:value.claudeBinary});
    expect(status.runtimes.codex).toMatchObject({installed:false,binaryPath:value.codexBinary});
    expect(status.accounts.claude.state).toBe("unavailable");
  });
});
