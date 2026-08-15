import{describe,expect,it}from"vitest";
import{mergePromptPresets,normalizePromptPresets,previewPromptPresetMerge,promptPresetSyncDecision,recommendTaskIntake}from"../../src/web/task-intake";
describe("task intake",()=>{
  it("recommends without mutating the requested execution choice",()=>{
    expect(recommendTaskIntake("이 변경을 다른 모델과 독립 검토")).toMatchObject({kind:"review",reason:"review"});
    expect(recommendTaskIntake("이 버그를 수정하고 테스트")).toMatchObject({kind:"single",provider:"codex"});
    expect(recommendTaskIntake("설계 문서를 요약해줘")).toMatchObject({provider:"claude"});
  });
  it("bounds and validates custom presets",()=>{
    expect(normalizePromptPresets([{id:"x",label:" Test ",prompt:" Run "},{id:"x",label:"duplicate",prompt:"no"}])).toEqual([{id:"x",label:"Test",prompt:"Run"}]);
    expect(normalizePromptPresets([{id:"fix",label:"Custom",prompt:"Custom fix"}])[0].id).toBe("custom-fix");
    const emoji=normalizePromptPresets([{id:"emoji",label:"😀".repeat(41),prompt:"🧪".repeat(4001)}])[0];
    expect(Array.from(emoji.label)).toHaveLength(40);
    expect(Array.from(emoji.prompt)).toHaveLength(4000);
    expect(normalizePromptPresets([{id:"unicode",label:`a${String.fromCharCode(0xd83d)}b`,prompt:"safe"}])[0].label).toBe("ab");
  });
  it("migrates an unchanged local value and previews a two-sided conflict without overwriting equal ids",()=>{
    const local=[{id:"local",label:"Local",prompt:"local"}],server=[{id:"server",label:"Server",prompt:"server"},{id:"same",label:"Server copy",prompt:"server"}];
    expect(promptPresetSyncDecision([],local,null).action).toBe("upload-local");
    expect(promptPresetSyncDecision(server,local,[{id:"base",label:"Base",prompt:"base"}]).action).toBe("conflict");
    expect(mergePromptPresets(server,[...local,{id:"same",label:"Local copy",prompt:"local"}])).toEqual([...server,...local]);
  });
  it("does not resurrect a server-side deletion when merging against the last snapshot",()=>{
    const deleted={id:"deleted",label:"Deleted",prompt:"deleted"},kept={id:"kept",label:"Kept",prompt:"kept"},local={id:"local",label:"Local",prompt:"local"};
    const preview=previewPromptPresetMerge([kept],[deleted,kept,local],[deleted,kept]);
    expect(preview.merged).toEqual([kept,local]);
    expect(preview.deletedOnServer).toEqual(["deleted"]);
  });
  it("does not resurrect a local deletion when merging against the last snapshot",()=>{
    const deleted={id:"deleted",label:"Deleted",prompt:"deleted"},kept={id:"kept",label:"Kept",prompt:"kept"},remote={id:"remote",label:"Remote",prompt:"remote"};
    const preview=previewPromptPresetMerge([deleted,kept,remote],[kept],[deleted,kept]);
    expect(preview.merged).toEqual([kept,remote]);
    expect(preview.deletedOnLocal).toEqual(["deleted"]);
  });
  it("keeps a final local deletion instead of treating an empty cache as a new device",()=>{
    const deleted={id:"deleted",label:"Deleted",prompt:"deleted"},remote={id:"remote",label:"Remote",prompt:"remote"};
    const decision=promptPresetSyncDecision([deleted,remote],[],[deleted]);
    expect(decision.action).toBe("conflict");
    expect(decision.merged).toEqual([remote]);
  });
  it("reports every preset excluded by the 20-item merge limit",()=>{
    const server=Array.from({length:20},(_,index)=>({id:`server-${index}`,label:`Server ${index}`,prompt:"server"}));
    const local=Array.from({length:3},(_,index)=>({id:`local-${index}`,label:`Local ${index}`,prompt:"local"}));
    const preview=previewPromptPresetMerge(server,local,[]);
    expect(preview.merged).toHaveLength(20);
    expect(preview.dropped.map(item=>item.id)).toEqual(["local-0","local-1","local-2"]);
  });
});
