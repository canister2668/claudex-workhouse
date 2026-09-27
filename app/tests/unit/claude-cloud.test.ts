import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe,expect,it } from "vitest";
import { cloudCreditFromUsageCache,cloudCreditNeedsConfirmation,readCloudCredit } from "../../src/server/claude-cloud.js";

const helper=path.resolve(import.meta.dirname,"../../../bin/claude-cloud.py");
const cache=(bucket:unknown,fetchedAtMs=Date.parse("2026-09-24T11:40:08Z"))=>({fetchedAtMs,utilization:{five_hour:{utilization:33},iguana_necktie:bucket}});
const now=Date.parse("2026-09-25T00:00:00Z");

describe("Claude cloud-session credit",()=>{
  it("reads the remaining cloud credit from the cached usage response",()=>{
    const credit=cloudCreditFromUsageCache(cache({limit_dollars:250,used_dollars:0.409444,remaining_dollars:249.590556,resets_at:"2026-11-05T07:59:00+00:00",locked_reason:null}),now);
    expect(credit).toEqual({state:"available",limitUsd:250,usedUsd:0.409444,remainingUsd:249.590556,expiresAt:"2026-11-05T07:59:00.000Z",fetchedAt:"2026-09-24T11:40:08.000Z"});
    expect(cloudCreditNeedsConfirmation(credit)).toBe(false);
  });

  it("asks for confirmation when the credit is used up, expired, or absent",()=>{
    const exhausted=cloudCreditFromUsageCache(cache({limit_dollars:250,used_dollars:250,remaining_dollars:0,resets_at:"2026-11-05T07:59:00+00:00"}),now);
    const expired=cloudCreditFromUsageCache(cache({limit_dollars:250,used_dollars:10,remaining_dollars:240,resets_at:"2026-11-05T07:59:00+00:00"}),Date.parse("2026-11-06T00:00:00Z"));
    const absent=cloudCreditFromUsageCache(cache(null),now);
    expect([exhausted.state,expired.state,absent.state]).toEqual(["exhausted","expired","unknown"]);
    expect([exhausted,expired,absent].every(cloudCreditNeedsConfirmation)).toBe(true);
    expect(cloudCreditFromUsageCache(null,now).state).toBe("unknown");
  });

  it("keeps the newest cached reading across the home and config-dir state files",()=>{
    const home=fs.mkdtempSync(path.join(os.tmpdir(),"cloud-credit-"));
    const configDir=path.join(home,"config");fs.mkdirSync(configDir);
    fs.writeFileSync(path.join(home,".claude.json"),JSON.stringify({cachedUsageUtilization:cache({limit_dollars:250,used_dollars:5,remaining_dollars:245,resets_at:"2099-01-01T00:00:00Z"},2000)}));
    fs.writeFileSync(path.join(configDir,".claude.json"),JSON.stringify({cachedUsageUtilization:cache({limit_dollars:250,used_dollars:1,remaining_dollars:249,resets_at:"2099-01-01T00:00:00Z"},1000)}));
    expect(readCloudCredit(home,configDir).remainingUsd).toBe(245);
    expect(readCloudCredit(path.join(home,"missing"),path.join(home,"missing")).state).toBe("unknown");
  });
});

describe("claude --cloud output parser",()=>{
  it("extracts the session the CLI printed",()=>{
    const output=execFileSync("python3",[helper,"parse"],{input:"[Screen Reader Mode: on via flag]\n\u001b[1mCreated cloud session: README line count\u001b[0m\nView: https://claude.ai/code/session_01FZASVa7teunMzNmBw3bdGv?from=cli&m=0\nResume with: claude --teleport session_01FZASVa7teunMzNmBw3bdGv\n",encoding:"utf8"});
    expect(JSON.parse(output).created).toEqual({sessionId:"session_01FZASVa7teunMzNmBw3bdGv",url:"https://claude.ai/code/session_01FZASVa7teunMzNmBw3bdGv",title:"README line count"});
  });

  it("reports the CLI error when no session was created",()=>{
    const output=JSON.parse(execFileSync("python3",[helper,"parse"],{input:"Quick safety check\nError: Not uploading this working tree: this checkout's git root is your home\ndirectory.\n",encoding:"utf8"}));
    expect(output.created).toBeNull();
    expect(output.error).toContain("Error: Not uploading this working tree");
  });
});
