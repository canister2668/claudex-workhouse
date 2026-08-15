import { describe,expect,it,vi } from "vitest";
import { DEFAULT_CHARACTER_SETTINGS } from "../../src/server/character-settings.js";
import { ProviderAvatarSettings, type AvatarSettingsStore, type AvatarWatchers } from "../../src/server/provider-avatar-settings.js";
import type { ProviderId } from "../../src/server/types.js";

const choices:Record<ProviderId,string[]>={codex:["Gpt-Codex","Gpt-Sol"],claude:["normal","capy"],grok:["Grok"],deepseek:["DeepSeek","Ollama"],ollama:["Ollama","DeepSeek","Antigravity","Gemma-e4b"],antigravity:["Antigravity","Gemma-e4b"]};
function fixture(saved:any=DEFAULT_CHARACTER_SETTINGS,states:Partial<Record<ProviderId,string>>={},migrated=true){
  const values=new Map<string,{value:any;updatedAt:string}>();
  if(saved)values.set("characters.providers",{value:structuredClone(saved),updatedAt:"old"});
  if(migrated)values.set("characters.avatar-source",{value:{version:1},updatedAt:"old"});
  const store:AvatarSettingsStore={getSystemSetting:async key=>values.get(key)??null,putSystemSetting:vi.fn(async(key,value,updatedAt)=>{values.set(key,{value:structuredClone(value),updatedAt});})};
  const watchers={} as AvatarWatchers;
  for(const provider of Object.keys(choices) as ProviderId[]){
    let outfit=states[provider]??DEFAULT_CHARACTER_SETTINGS.providers[provider].avatarOutfit;
    watchers[provider]={get:()=>({emotion:"neutral",line:"",statusLine:"",outfit}),outfits:()=>choices[provider],setOutfit:vi.fn(async next=>{outfit=next;return{emotion:"neutral",line:"",statusLine:"",outfit};})};
  }
  return{values,store,watchers,settings:new ProviderAvatarSettings(store,watchers)};
}

describe("provider avatar settings",()=>{
  it("stores a dock selection in the character settings source and watcher together",async()=>{
    const x=fixture();
    const result=await x.settings.select("ollama","DeepSeek","now");
    expect(result.settings.providers.ollama.avatarOutfit).toBe("DeepSeek");
    expect(x.values.get("characters.providers")?.value.providers.ollama.avatarOutfit).toBe("DeepSeek");
    expect(x.watchers.ollama.get().outfit).toBe("DeepSeek");
  });

  it("applies character-settings avatar changes to every provider watcher",async()=>{
    const x=fixture(),next=structuredClone(DEFAULT_CHARACTER_SETTINGS);
    next.avatarDisplay="name-mark";next.providers.codex.avatarOutfit="Gpt-Sol";next.providers.ollama.avatarOutfit="Gemma-e4b";
    await x.settings.save(next,"now");
    expect(x.watchers.codex.get().outfit).toBe("Gpt-Sol");
    expect(x.watchers.ollama.get().outfit).toBe("Gemma-e4b");
    expect(x.values.get("characters.providers")?.value.avatarDisplay).toBe("name-mark");
  });

  it("migrates the last visible watcher choices once, then restores from the DB",async()=>{
    const first=fixture(DEFAULT_CHARACTER_SETTINGS,{codex:"Gpt-Sol",ollama:"DeepSeek"},false);
    const migrated=await first.settings.reconcile();
    expect(migrated.migrated).toBe(true);
    expect(first.values.get("characters.providers")?.value.providers).toMatchObject({codex:{avatarOutfit:"Gpt-Sol"},ollama:{avatarOutfit:"DeepSeek"}});
    expect(first.values.get("characters.avatar-source")?.value).toEqual({version:1,source:"characters.providers"});

    const persisted=first.values.get("characters.providers")!.value;
    const restart=fixture(persisted,{codex:"Gpt-Codex",ollama:"Ollama"},true);
    await restart.settings.reconcile();
    expect(restart.watchers.codex.get().outfit).toBe("Gpt-Sol");
    expect(restart.watchers.ollama.get().outfit).toBe("DeepSeek");
  });

  it("rejects an outfit outside that provider catalog without changing storage",async()=>{
    const x=fixture(),before=structuredClone(x.values.get("characters.providers")?.value);
    await expect(x.settings.select("deepseek","Gemma-e4b")).rejects.toMatchObject({code:"AVATAR_OUTFIT_UNAVAILABLE"});
    expect(x.values.get("characters.providers")?.value).toEqual(before);
    expect(x.watchers.deepseek.get().outfit).toBe("DeepSeek");
  });
});
