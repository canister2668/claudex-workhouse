import {describe,expect,it,vi} from "vitest";
import {RuntimeModelCatalog} from "../../src/server/runtime-model-catalog.js";

describe("runtime model catalog",()=>{
  it("persists a fresh dynamic catalog and returns the last success on failure",async()=>{
    let stored:any=null;const db={getCache:vi.fn(async()=>stored),putCache:vi.fn(async(_key,value,fetchedAt,expiresAt)=>{stored={value,fetchedAt,expiresAt};return true;})},load=vi.fn().mockResolvedValueOnce([{id:"new-model",displayName:"New Model",source:"runtime"}]).mockRejectedValueOnce(new Error("offline")),catalog=new RuntimeModelCatalog(db as any,"models","provider-api",load);
    await expect(catalog.get(true)).resolves.toMatchObject({stale:false,source:"provider-api",models:[{id:"new-model"}]});
    await expect(catalog.get(true)).resolves.toMatchObject({stale:true,source:"provider-api",models:[{id:"new-model"}],error:"offline"});
    expect(db.putCache).toHaveBeenCalledTimes(1);
  });
  it("does not persist an empty catalog",async()=>{const db={getCache:vi.fn(async()=>null),putCache:vi.fn()},catalog=new RuntimeModelCatalog(db as any,"models","provider-api",async()=>[]);await expect(catalog.get(true)).rejects.toThrow(/empty model catalog/);expect(db.putCache).not.toHaveBeenCalled();});
});
