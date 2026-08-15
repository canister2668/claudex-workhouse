import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {spawn} from "node:child_process";
import {afterEach,describe,expect,it} from "vitest";

const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});

describe("compatible provider worker stream",()=>{
  it("collapses token-level thinking and text bursts before they reach the UI",async()=>{
    const root=fs.mkdtempSync(path.join(process.cwd(),".compatible-worker-stream-"));roots.push(root);
    const fake=path.join(root,"compatible-fake.sh"),stateDir=path.join(root,"data","deepseek-jobs"),statePath=path.join(stateDir,"deepseek_test.json"),taskId="deepseek:test";
    fs.mkdirSync(stateDir,{recursive:true});
    fs.writeFileSync(fake,`#!/bin/sh
i=0
while [ $i -lt 500 ]; do printf '%s\\n' '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"x"}}}'; i=$((i+1)); done
i=0
while [ $i -lt 100 ]; do printf '%s\\n' '{"type":"stream_event","event":{"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"a"}}}'; i=$((i+1)); done
printf '%s\\n' '{"type":"assistant","message":{"id":"message-1","content":[{"type":"text","text":"done"}]}}'
printf '%s\\n' '{"type":"result","subtype":"success","is_error":false,"result":"done","session_id":"11111111-1111-4111-8111-111111111111"}'
`,{mode:0o700});
    const worker=path.resolve("dist-server/claude-worker.js"),child=spawn(process.execPath,[worker,statePath,taskId,fake,"new",root,"claudex-workhouse:test",":read-only","deepseek-v4-flash","default","default","","hello"],{cwd:root,stdio:"ignore",env:{...process.env,CLAUDEX_WORKHOUSE_PROVIDER_ID:"deepseek",CLAUDEX_WORKHOUSE_PROVIDER_LABEL:"DeepSeek",CLAUDEX_WORKHOUSE_RUNTIME_PROFILE:"conversation"}});
    await new Promise<void>((resolve,reject)=>{child.once("error",reject);child.once("close",code=>code===0?resolve():reject(new Error(`worker exited ${code}`)));});
    const hash=crypto.createHash("sha256").update(taskId).digest("hex"),events=fs.readFileSync(path.join(root,"data","stream-events",`${hash}.ndjson`),"utf8").trim().split("\n").map(line=>JSON.parse(line));
    expect(events.filter(event=>event.type==="tool_progress")).toHaveLength(1);
    expect(events.filter(event=>event.type==="message_delta")).toHaveLength(1);
    expect(events.find(event=>event.type==="message_delta")?.content).toBe("a".repeat(100));
    expect(events.length).toBeLessThan(12);
  },15_000);
});
