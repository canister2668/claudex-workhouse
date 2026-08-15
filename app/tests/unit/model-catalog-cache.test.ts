import {describe,expect,it,vi} from "vitest";
import {ClaudeModelCatalog} from "../../src/server/claude-model-catalog.js";
import {CodexCatalog} from "../../src/server/codex/catalog.js";

const oldTimestamp=()=>new Date(Date.now()-600_000).toISOString();

describe("model catalog stale-while-revalidate",()=>{
  it("returns the persisted Claude catalog immediately and coalesces background refreshes",async()=>{
    const stored={models:[{id:"claude-sonnet-5",displayName:"Sonnet 5",description:"",source:"runtime"}],fetchedAt:oldTimestamp(),stale:false,source:"claude-cli-model-picker"};
    const db={getCache:vi.fn().mockResolvedValue({value:stored,fetchedAt:stored.fetchedAt})};
    const catalog=new ClaudeModelCatalog({} as any,db as any),refresh=vi.fn(()=>new Promise(()=>{}));
    (catalog as any).loadFresh=refresh;
    const first=await catalog.get(),second=await catalog.get();
    expect(first).toEqual(expect.objectContaining({models:expect.arrayContaining([expect.objectContaining({id:"claude-sonnet-5"})]),stale:true,source:"cache"}));
    expect(second).toBe(first);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps a failed Claude refresh on cooldown instead of probing on every request",async()=>{
    const cached={models:[{id:"claude-sonnet-5",displayName:"Sonnet 5",description:"",source:"runtime"}],fetchedAt:oldTimestamp(),stale:true,source:"cache"};
    const catalog=new ClaudeModelCatalog({} as any,{getCache:vi.fn()} as any),refresh=vi.fn().mockResolvedValue(cached);
    (catalog as any).memory=cached;
    (catalog as any).loadFresh=refresh;
    await catalog.get();
    await Promise.resolve();
    await catalog.get();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("returns the persisted Codex catalog without awaiting a cold app-server",async()=>{
    const stored={models:[{id:"gpt-current"}],permissions:[],fetchedAt:oldTimestamp(),stale:false};
    const db={getCache:vi.fn().mockResolvedValue({value:stored,fetchedAt:stored.fetchedAt})};
    const catalog=new CodexCatalog({} as any,db as any),refresh=vi.fn(()=>new Promise(()=>{}));
    (catalog as any).loadFresh=refresh;
    const result=await catalog.get();
    expect(result).toEqual(expect.objectContaining({models:[{id:"gpt-current"}],stale:true}));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("coalesces forced Codex refreshes",async()=>{
    let resolve!: (value:any)=>void;
    const pending=new Promise<any>(done=>{resolve=done;});
    const catalog=new CodexCatalog({} as any,{} as any),refresh=vi.fn(()=>pending);
    (catalog as any).loadFresh=refresh;
    const first=catalog.get(true),second=catalog.get(true);
    expect(refresh).toHaveBeenCalledTimes(1);
    resolve({models:[],permissions:[],fetchedAt:new Date().toISOString(),stale:false});
    await expect(Promise.all([first,second])).resolves.toHaveLength(2);
  });
});
