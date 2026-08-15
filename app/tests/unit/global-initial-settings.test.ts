import fs from "node:fs";
import path from "node:path";
import {describe,expect,it} from "vitest";
import {DEFAULT_CHARACTER_SETTINGS} from "../../src/server/character-settings.js";
import {DEFAULT_CHARACTERS} from "../../src/web/character-settings.js";

const read=(relative:string)=>fs.readFileSync(path.resolve(relative),"utf8");

describe("global initial settings",()=>{
  it("starts every provider with the intended global tone preset",()=>{
    const expected={codex:"default",claude:"flirty-friend",deepseek:"playful-school-friend",ollama:"playful-school-friend",antigravity:"mesugaki-brat",grok:"aristocratic-ojosama"};
    expect(Object.fromEntries(Object.entries(DEFAULT_CHARACTER_SETTINGS.providers).map(([provider,settings])=>[provider,settings.tonePreset]))).toEqual(expected);
    expect(Object.fromEntries(Object.entries(DEFAULT_CHARACTERS.providers).map(([provider,settings])=>[provider,settings.tonePreset]))).toEqual(expected);
  });

  it("starts Codex with the Sol avatar across server and web defaults",()=>{
    expect(DEFAULT_CHARACTER_SETTINGS.providers.codex.avatarOutfit).toBe("Gpt-Sol");
    expect(DEFAULT_CHARACTERS.providers.codex.avatarOutfit).toBe("Gpt-Sol");
    expect(read("src/server/index.ts")).toContain('process.platform,"Gpt-Sol",PROVIDER_EMOTION_OUTFITS.codex');
    expect(read("src/server/worker-emotion.ts")).toContain('codex:"Gpt-Sol"');
    expect(read("src/server/task-emotion-seed.ts")).toContain('codex:"Gpt-Sol"');
    expect(read("src/web/emotion-stream.ts")).toContain('codexState:neutral("Gpt-Sol")');
  });

  it("sends with Enter by default while preserving explicit saved opt-outs",()=>{
    const app=read("src/web/App.svelte");
    expect(app).toContain("enterToSend=globalPrefs.enterToSend!==false");
    expect(app).toContain('codexAvatar:"Gpt-Codex"|"Gpt-Sol"=globalPrefs.codexAvatar==="Gpt-Codex"?"Gpt-Codex":"Gpt-Sol"');
  });
});
