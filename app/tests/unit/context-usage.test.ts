import { describe, expect, it } from "vitest";
import { latestContextUsage } from "../../src/web/context-usage";

describe("context usage event selection",()=>{
  it("uses the newest provider context event and preserves compaction state",()=>{
    const value=latestContextUsage([
      {type:"unknown",content:"usage",metadata:{contextUsage:{usedTokens:60000,windowTokens:120000,percent:50,updatedAt:"one"}}},
      {type:"context_compaction",content:"done",metadata:{contextUsage:{usedTokens:null,windowTokens:120000,percent:null,updatedAt:"two",lastCompactedAt:"two",compactionTrigger:"auto"}}}
    ] as any);
    expect(value).toMatchObject({usedTokens:null,windowTokens:120000,lastCompactedAt:"two",compactionTrigger:"auto"});
  });

  it("repairs Opus 5 context windows and ignores legacy cumulative result totals",()=>{
    const value=latestContextUsage([
      {type:"unknown",content:"message usage",metadata:{contextUsage:{usedTokens:716000,windowTokens:200000,percent:100,updatedAt:"one"}}},
      {type:"unknown",content:"result usage",metadata:{contextUsage:{usedTokens:7831000,windowTokens:200000,percent:100,updatedAt:"two"}}},
      {type:"task_completed",content:"done",metadata:{}},
    ] as any,{usedTokens:7831000,windowTokens:200000,percent:100,updatedAt:"two"},{provider:"claude",model:"claude-opus-5"});
    expect(value).toMatchObject({usedTokens:716000,windowTokens:1000000,percent:71.6,updatedAt:"one"});
  });

  it("keeps a compaction boundary newer than invalid cumulative usage",()=>{
    const value=latestContextUsage([
      {type:"context_compaction",content:"done",metadata:{contextUsage:{usedTokens:null,windowTokens:1000000,percent:null,updatedAt:"compact",lastCompactedAt:"compact",compactionTrigger:"auto"}}},
      {type:"unknown",content:"legacy result usage",metadata:{contextUsage:{usedTokens:2400000,windowTokens:200000,percent:100,updatedAt:"result"}}},
    ] as any,null,{provider:"claude",model:"claude-opus-5"});
    expect(value).toMatchObject({usedTokens:null,percent:null,lastCompactedAt:"compact"});
  });
});
