import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach,describe,expect,it } from "vitest";
import { appendClaudeCreditLedger,claudeApiKeyForLaunch,claudeBillingPublicSettings,claudeCreditCycleStart,claudeCreditLedgerFile,claudeCreditStatus,claudeUsesApiCredits,fetchOrganizationCostUsd,saveClaudeBillingSettings } from "../../src/server/claude-billing.js";

const roots:string[]=[];
function dataRoot(){const root=fs.mkdtempSync(path.join(os.tmpdir(),"claude-billing-"));roots.push(root);return root;}
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});

describe("Claude billing settings",()=>{
  it("defaults to the subscription and never launches with a key",async()=>{
    const root=dataRoot();
    expect(await claudeBillingPublicSettings(root)).toMatchObject({mode:"subscription",apiKeyConfigured:false,monthlyCreditUsd:100,cycleResetDay:1});
    expect(claudeApiKeyForLaunch(root)).toBeNull();
  });

  it("refuses API mode without a key",async()=>{
    await expect(saveClaudeBillingSettings(dataRoot(),{mode:"api"})).rejects.toThrow(/API key/);
  });

  it("switches to API mode, hides the key, and keeps it across toggles",async()=>{
    const root=dataRoot();
    const saved=await saveClaudeBillingSettings(root,{mode:"api",apiKey:"sk-ant-api03-secretABCD"});
    expect(saved).toMatchObject({mode:"api",apiKeyConfigured:true,apiKeyHint:"…ABCD"});
    expect(JSON.stringify(saved)).not.toContain("secret");
    expect(claudeApiKeyForLaunch(root)).toBe("sk-ant-api03-secretABCD");
    expect(fs.statSync(path.join(root,"config","claude-billing.json")).mode&0o777).toBe(0o600);
    await saveClaudeBillingSettings(root,{mode:"subscription"});
    expect(claudeUsesApiCredits(root)).toBe(false);
    await saveClaudeBillingSettings(root,{mode:"api"});
    expect(claudeApiKeyForLaunch(root)).toBe("sk-ant-api03-secretABCD");
    await saveClaudeBillingSettings(root,{mode:"subscription",clearApiKey:true});
    expect((await claudeBillingPublicSettings(root)).apiKeyConfigured).toBe(false);
  });

  it("sums only the current cycle's ledger entries",async()=>{
    const root=dataRoot(),file=claudeCreditLedgerFile(root);
    await saveClaudeBillingSettings(root,{mode:"api",apiKey:"sk-ant-x",monthlyCreditUsd:100,cycleResetDay:5});
    appendClaudeCreditLedger(file,{at:new Date(2026,9,4,23).toISOString(),taskId:"old",costUsd:40,billing:"api"});
    appendClaudeCreditLedger(file,{at:new Date(2026,9,6).toISOString(),taskId:"subscription",costUsd:9});
    appendClaudeCreditLedger(file,{at:new Date(2026,9,5,1).toISOString(),taskId:"a",costUsd:1.25,billing:"api"});
    appendClaudeCreditLedger(file,{at:new Date(2026,9,7).toISOString(),taskId:"b",costUsd:2.5,billing:"api"});
    fs.appendFileSync(file,"not json\n");
    const view=await claudeBillingPublicSettings(root,new Date(2026,9,8));
    expect(view.credit).toMatchObject({source:"local",spentUsd:3.75,remainingUsd:96.25,runs:2,averageRunUsd:1.88,error:null});
  });

  it("clamps the reset day to short months and rolls back before it",()=>{
    expect(claudeCreditCycleStart(new Date(2026,1,15),31)).toEqual(new Date(2026,0,31));
    expect(claudeCreditCycleStart(new Date(2026,1,28),31)).toEqual(new Date(2026,1,28));
    expect(claudeCreditCycleStart(new Date(2026,0,3),5)).toEqual(new Date(2025,11,5));
  });

  it("reads organization spend from the paginated cost report in cents",async()=>{
    const calls:string[]=[];
    const pages=[{data:[{results:[{amount:"1234.5",currency:"USD"}]},{results:[]}],has_more:true,next_page:"p2"},{data:[{results:[{amount:"65.5",currency:"USD"},{amount:"10",currency:"EUR"}]}],has_more:false,next_page:null}];
    const fetcher=async(url:string,init:{headers:Record<string,string>})=>{calls.push(url);expect(init.headers["x-api-key"]).toBe("sk-ant-admin01-k");return{ok:true,status:200,json:async()=>pages[calls.length-1]};};
    expect(await fetchOrganizationCostUsd("sk-ant-admin01-k",new Date("2026-09-30T15:00:00Z"),fetcher)).toBe(13);
    expect(calls[0]).toContain("starting_at=2026-09-30T00%3A00%3A00.000Z");
    expect(calls[1]).toContain("page=p2");
  });

  it("prefers organization spend and falls back to the ledger when the admin key fails",async()=>{
    const root=dataRoot();
    await saveClaudeBillingSettings(root,{mode:"api",apiKey:"sk-ant-x",adminKey:"sk-ant-admin01-good"});
    appendClaudeCreditLedger(claudeCreditLedgerFile(root),{at:new Date(2026,9,7).toISOString(),taskId:"a",costUsd:2,billing:"api"});
    const ok=async()=>({ok:true,status:200,json:async()=>({data:[{results:[{amount:"4000",currency:"USD"}]}],has_more:false})});
    expect(await claudeCreditStatus(root,new Date(2026,9,8),ok)).toMatchObject({source:"organization",spentUsd:40,remainingUsd:60,runs:null});
    await saveClaudeBillingSettings(root,{mode:"api",adminKey:"sk-ant-admin01-bad"});
    const rejected=async()=>({ok:false,status:401,json:async()=>({})});
    expect(await claudeCreditStatus(root,new Date(2026,9,8),rejected)).toMatchObject({source:"local",spentUsd:2,error:"admin_key_rejected"});
    const view=await claudeBillingPublicSettings(root,new Date(2026,9,8),rejected);
    expect(JSON.stringify(view)).not.toContain("admin01-bad");
    expect(view.adminKeyHint).toBe("…-bad");
  });
});
