import { describe,expect,it } from "vitest";
import { normalizeTempStorageOverview } from "../../src/web/temp-storage-view";

describe("temporary storage response normalization",()=>{
  it("wraps the legacy single-root response for rolling deployments",()=>{
    const value=normalizeTempStorageOverview({
      root:"/runtime/tmp",
      generatedAt:"2026-07-28T03:00:00.000Z",
      filesystem:{totalBytes:100,usedBytes:40,freeBytes:60},
      serviceOwnedBytes:20,
      deletableBytes:10,
      protectedBytes:10,
      entries:[{id:"entry"}],
      linkage:{scannedTaskCount:3,scannedEventBytes:4}
    });
    expect(value).toMatchObject({
      serviceOwnedBytes:20,
      roots:[{
        id:"legacy-workhouse",
        root:"/runtime/tmp",
        workspaces:[],
        overview:{entries:[{id:"entry"}],linkage:{bestEffort:true,scannedTaskCount:3}}
      }]
    });
  });

  it("fills missing arrays in partial multi-root responses",()=>{
    const value=normalizeTempStorageOverview({roots:[{id:"root",root:"/tmp/runtime",overview:{}}]});
    expect(value?.roots[0]).toMatchObject({workspaces:[],overview:{entries:[]}});
  });
});
