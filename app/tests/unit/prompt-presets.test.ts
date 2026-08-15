import{describe,expect,it}from"vitest";
import{nextPromptPresetUpdatedAt,normalizeStoredPromptPresetSettings,promptPresetPutSchema,promptPresetSettingsSchema}from"../../src/server/prompt-presets.js";

describe("prompt preset settings schema",()=>{
  it("accepts bounded custom values and rejects duplicates, built-in ids, and oversized content",()=>{
    expect(promptPresetPutSchema.parse({settings:{version:1,presets:[{id:"mine",label:"Mine",prompt:"Do it"}]},baseUpdatedAt:null}).settings.presets).toHaveLength(1);
    expect(()=>promptPresetSettingsSchema.parse({version:1,presets:[{id:"x",label:"A",prompt:"A"},{id:"x",label:"B",prompt:"B"}]})).toThrow();
    expect(()=>promptPresetSettingsSchema.parse({version:1,presets:[{id:"fix",label:"A",prompt:"A"}]})).toThrow();
    expect(()=>promptPresetSettingsSchema.parse({version:1,presets:[{id:"x",label:"A",prompt:"x".repeat(4001)}]})).toThrow();
    expect(()=>promptPresetSettingsSchema.parse({version:1,presets:[{id:"x",label:`a${String.fromCharCode(0xd83d)}b`,prompt:"A"}]})).toThrow();
    expect(promptPresetSettingsSchema.parse({version:1,presets:[{id:"emoji",label:"😀".repeat(40),prompt:"🧪".repeat(4000)}]}).presets[0].label).toBe("😀".repeat(40));
    expect(()=>promptPresetSettingsSchema.parse({version:1,presets:Array.from({length:21},(_,index)=>({id:`x-${index}`,label:"A",prompt:"A"}))})).toThrow();
  });
  it("always advances the compare-and-swap revision even inside one millisecond",()=>{
    expect(nextPromptPresetUpdatedAt("2026-07-29T10:00:00.000Z",Date.parse("2026-07-29T10:00:00.000Z"))).toBe("2026-07-29T10:00:00.001Z");
    expect(nextPromptPresetUpdatedAt("damaged",Date.parse("2026-07-29T10:00:00.000Z"))).toBe("2026-07-29T10:00:00.000Z");
  });
  it("salvages only valid unique entries from damaged stored settings",()=>{
    expect(normalizeStoredPromptPresetSettings({version:99,presets:[
      {id:"kept",label:"Kept",prompt:"Do it"},
      {id:"kept",label:"Duplicate",prompt:"No"},
      {id:"fix",label:"Reserved",prompt:"No"},
      {id:"bad space",label:"Invalid",prompt:"No"}
    ]})).toEqual({version:1,presets:[{id:"kept",label:"Kept",prompt:"Do it"}]});
  });
});
