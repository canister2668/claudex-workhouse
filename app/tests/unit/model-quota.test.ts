import {describe,expect,it} from "vitest";
import {modelQuotaPool,quotaForProviderModel} from "../../src/web/quota-retry.js";

const quota={
  fiveHour:null,
  sevenDay:{pct:6,resetsAt:"2026-08-27T00:00:00.000Z",durationMins:10080},
  modelPools:[{limitId:"codex_bengalfox",label:"Spark",modelIds:["gpt-5.3-codex-spark"],fiveHour:{pct:82,resetsAt:"2026-08-20T08:00:00.000Z",durationMins:300},sevenDay:{pct:14,resetsAt:"2026-08-27T03:00:00.000Z",durationMins:10080}}]
};

describe("model-specific quota selection",()=>{
  it("does not surface the Spark five-hour bucket for another Codex model",()=>{
    expect(modelQuotaPool(quota,"codex","gpt-5.6-sol")).toBeNull();
    expect(quotaForProviderModel(quota,"codex","gpt-5.6-sol").quota).toMatchObject({fiveHour:null,sevenDay:{pct:6}});
  });

  it("selects and labels the Spark bucket for a Spark task",()=>{
    const selected=quotaForProviderModel(quota,"codex","gpt-5.3-codex-spark");
    expect(selected.pool).toMatchObject({label:"Spark",limitId:"codex_bengalfox"});
    expect(selected.quota).toMatchObject({fiveHour:{pct:82},sevenDay:{pct:14}});
  });

  it("leaves non-Codex providers on their existing provider-wide quota",()=>{
    expect(quotaForProviderModel(quota,"claude","gpt-5.3-codex-spark")).toEqual({quota,pool:null});
  });
});
