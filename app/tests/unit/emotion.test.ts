import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmotionWatcher, PROVIDER_EMOTION_OUTFITS } from "../../src/server/emotion.js";
import { BABY_TALK_BURNOUT_EMOTION_PRIORITY } from "../../src/server/character-settings.js";
import {emotionStateFile} from "../../src/server/emotion-state-file.js";

const created:string[]=[];
afterEach(()=>{for(const item of created.splice(0))fs.rmSync(item,{recursive:true,force:true});});

function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"claudex-workhouse-emotion-"));created.push(root);
  const assets=path.join(root,"app","public","emoticons"),data=path.join(root,"data","emotion");
  for(const outfit of ["normal","Gpt-Codex","DeepSeek","Ollama","Antigravity","Grok"])fs.mkdirSync(path.join(assets,outfit),{recursive:true});
  for(const name of ["neutral","happy","thinking","thinking_2","chu","dead"])fs.writeFileSync(path.join(assets,"normal",`${name}.webp`),"asset");
  for(const name of ["neutral","happy","thinking","thinking_2","chu","dead"])fs.writeFileSync(path.join(assets,"Gpt-Codex",`${name}.webp`),"asset");
  for(const outfit of ["DeepSeek","Ollama","Antigravity","Grok"])for(const name of ["neutral","happy","thinking","thinking_2","chu","dead"])fs.writeFileSync(path.join(assets,outfit,`${name}.webp`),"asset");
  fs.mkdirSync(data,{recursive:true});fs.writeFileSync(path.join(data,"emotion-mode"),"catch\n");
  return{root,assets,data,state:path.join(data,"state.json")};
}

describe("bundled emotion runtime",()=>{
  it("initializes private runtime state while cataloguing bundled outfits",async()=>{
    const x=fixture(),watcher=new EmotionWatcher(x.state,x.assets);
    expect(watcher.get()).toMatchObject({emotion:"neutral",outfit:"normal"});
    expect(watcher.outfits()).toEqual(["Antigravity","DeepSeek","Gpt-Codex","Grok","Ollama","normal"]);
    expect(watcher.assetCatalog().normal.map(item=>item.emotion)).toContain("happy");
    expect(watcher.assetCatalog().normal).toContainEqual({emotion:"dead",file:"dead.webp"});
    expect(watcher.assetCatalog()["Gpt-Codex"]).toContainEqual({emotion:"dead",file:"dead.webp"});
    expect(watcher.assetCatalog().normal.map(item=>item.emotion)).not.toContain("Dead");
    await watcher.setState({emotion:"happy",line:"완료"});
    expect(JSON.parse(fs.readFileSync(x.state,"utf8"))).toMatchObject({emotion:"happy",line:"완료"});
    expect(watcher.setMode("mcp")).toBe("mcp");
  });

  it("keeps provider avatar catalogs and stale persisted outfits isolated",async()=>{
    const x=fixture();
    for(const outfit of ["capy","DeepSeek","Ollama","Antigravity"])fs.mkdirSync(path.join(x.assets,outfit),{recursive:true});
    fs.writeFileSync(x.state,JSON.stringify({emotion:"neutral",line:"",statusLine:"",outfit:"normal"}));
    const deepseek=new EmotionWatcher(x.state,x.assets,process.platform,"DeepSeek",["DeepSeek"]);
    expect(deepseek.outfits()).toEqual(["DeepSeek"]);
    expect(deepseek.get().outfit).toBe("DeepSeek");
    await deepseek.setState({outfit:"normal"});
    expect(deepseek.get().outfit).toBe("DeepSeek");
    const claude=new EmotionWatcher(path.join(x.data,"claude.json"),x.assets,process.platform,"normal",["normal","capy"]);
    expect(claude.outfits()).toEqual(["capy","normal"]);
  });

  it("allows only the requested cross-provider outfits for DeepSeek and Ollama",async()=>{
    const x=fixture();for(const outfit of ["Gemma-e4b","WhaleGirl"])fs.mkdirSync(path.join(x.assets,outfit),{recursive:true});
    const deepseek=new EmotionWatcher(x.state,x.assets,process.platform,"DeepSeek",PROVIDER_EMOTION_OUTFITS.deepseek,"deepseek");
    expect(deepseek.outfits()).toEqual(["DeepSeek","Ollama","WhaleGirl"]);
    await deepseek.setOutfit("Ollama");expect(deepseek.get().outfit).toBe("Ollama");
    await deepseek.setOutfit("WhaleGirl");expect(deepseek.get().outfit).toBe("WhaleGirl");
    await deepseek.setOutfit("Antigravity");expect(deepseek.get().outfit).toBe("DeepSeek");
    const ollama=new EmotionWatcher(path.join(x.data,"ollama.json"),x.assets,process.platform,"Ollama",PROVIDER_EMOTION_OUTFITS.ollama,"ollama");
    expect(ollama.outfits()).toEqual(["Antigravity","DeepSeek","Gemma-e4b","Ollama","WhaleGirl"]);
    for(const outfit of ["DeepSeek","Antigravity","Gemma-e4b","WhaleGirl"]){await ollama.setOutfit(outfit);expect(ollama.get().outfit).toBe(outfit);}
    const claude=new EmotionWatcher(path.join(x.data,"claude-whale.json"),x.assets,process.platform,"normal",PROVIDER_EMOTION_OUTFITS.claude,"claude");
    expect(claude.outfits()).not.toContain("WhaleGirl");
  });

  it("persists the selected Codex outfit through the shared provider watcher",async()=>{
    const x=fixture();fs.mkdirSync(path.join(x.assets,"Gpt-Sol"),{recursive:true});
    const codex=new EmotionWatcher(path.join(x.data,"codex-state.json"),x.assets,process.platform,"Gpt-Codex",PROVIDER_EMOTION_OUTFITS.codex,"codex");
    await codex.setOutfit("Gpt-Sol");
    expect(codex.get().outfit).toBe("Gpt-Sol");
    expect(JSON.parse(fs.readFileSync(path.join(x.data,"codex-state.json"),"utf8"))).toMatchObject({outfit:"Gpt-Sol"});
  });

  it("does not rewrite a task emotion snapshot when the provider outfit changes",async()=>{
    const x=fixture();fs.mkdirSync(path.join(x.assets,"Gpt-Sol"),{recursive:true});
    const codex=new EmotionWatcher(path.join(x.data,"codex-state.json"),x.assets,process.platform,"Gpt-Codex",PROVIDER_EMOTION_OUTFITS.codex,"codex");
    await codex.setState({emotion:"happy",outfit:"Gpt-Codex",taskId:"codex:task-1",sessionId:"session-1"});
    await codex.setOutfit("Gpt-Sol");
    expect(codex.get().outfit).toBe("Gpt-Sol");
    expect(codex.taskStates()["codex:task-1"]).toMatchObject({emotion:"happy",outfit:"Gpt-Codex"});
  });

  it("serializes Windows writes and atomically preserves concurrent patches without flock",async()=>{
    const x=fixture(),watcher=new EmotionWatcher(x.state,x.assets,"win32");
    await Promise.all([watcher.setState({emotion:"thinking"}),watcher.setState({line:"queued update"})]);
    expect(JSON.parse(fs.readFileSync(x.state,"utf8"))).toMatchObject({emotion:"thinking",line:"queued update"});
    expect(fs.readdirSync(path.dirname(x.state)).filter(name=>name.endsWith(".tmp"))).toEqual([]);
    expect(fs.existsSync(`${x.state}.flock`)).toBe(false);
  });

  it("clears stale canned translation keys when custom copy replaces the line",async()=>{
    const x=fixture();
    fs.writeFileSync(x.state,JSON.stringify({emotion:"coding_3",line:"수정 사항을 다시 확인 중이에요",statusLine:"코딩 중...",lineKey:"avatar.line.coding_3",statusKey:"avatar.status.coding_3",outfit:"normal"}));
    const watcher=new EmotionWatcher(x.state,x.assets);
    await watcher.setState({emotion:"happy",line:"사용자 지정 완료 대사",statusLine:"",source:"mcp"});
    const stored=JSON.parse(fs.readFileSync(x.state,"utf8"));
    expect(stored).toMatchObject({emotion:"happy",line:"사용자 지정 완료 대사",statusLine:"",source:"mcp"});
    expect(stored).not.toHaveProperty("lineKey");
    expect(stored).not.toHaveProperty("statusKey");
    expect(watcher.get()).toMatchObject({lineKey:undefined,statusKey:undefined});
  });

  it("persists model-authored state independently for each task",async()=>{
    const x=fixture(),watcher=new EmotionWatcher(x.state,x.assets,process.platform,"DeepSeek",["DeepSeek"],"deepseek");
    await watcher.setState({emotion:"happy",line:"task one",statusLine:"",outfit:"DeepSeek",taskId:"deepseek:task-1",sessionId:"session-1"});
    await watcher.setState({emotion:"sad",line:"task two",statusLine:"",outfit:"DeepSeek",taskId:"deepseek:task-2",sessionId:"session-2"});
    expect(watcher.taskStates()).toMatchObject({"deepseek:task-1":{line:"task one"},"deepseek:task-2":{line:"task two"}});
  });

  it("cleans the Windows temporary file when atomic replacement fails",async()=>{
    const x=fixture(),watcher=new EmotionWatcher(x.state,x.assets,"win32"),rename=vi.spyOn(fs.promises,"rename").mockRejectedValueOnce(new Error("rename denied"));
    await expect(watcher.setState({emotion:"thinking"})).rejects.toThrow("rename denied");
    expect(fs.readdirSync(path.dirname(x.state)).filter(name=>name.endsWith(".tmp"))).toEqual([]);
    rename.mockRestore();
  });

  it("finds every burnout palette id in every currently bundled character outfit",()=>{
    const x=fixture(),watcher=new EmotionWatcher(x.state,path.resolve("public","emoticons")),catalog=watcher.assetCatalog();
    expect(Object.keys(catalog)).toEqual(["Antigravity","DeepSeek","Gemma-e4b","Gpt-Codex","Gpt-Sol","Grok","Ollama","WhaleGirl","capy","normal"]);
    for(const[outfit,assets]of Object.entries(catalog)){
      const ids=assets.map(asset=>asset.emotion);
      expect(ids,`${outfit} uses the lowercase renderer id dead`).toContain("dead");
      expect(ids,`${outfit} must not expose display-case Dead as an internal id`).not.toContain("Dead");
      for(const emotion of BABY_TALK_BURNOUT_EMOTION_PRIORITY)expect(ids,`${outfit} is missing ${emotion}`).toContain(emotion);
    }
  });

  it("runs catch/activity hooks for every provider without an external checkout",()=>{
    const x=fixture(),script=path.resolve("..","hooks","emotion","set-emotion.mjs"),env={...process.env,CLAUDEX_WORKHOUSE_ROOT:x.root,CLAUDEX_WORKHOUSE_APP_ROOT:x.root,CLAUDEX_WORKHOUSE_DATA_ROOT:x.root};
    const cases=[
      ["claude","state.json","normal"],["codex","codex-state.json","Gpt-Codex"],["deepseek","deepseek-state.json","DeepSeek"],
      ["ollama","ollama-state.json","Ollama"],["antigravity","antigravity-state.json","Antigravity"],["grok","grok-state.json","Grok"]
    ] as const;
    for(const[provider,file,outfit]of cases){
      const result=spawnSync(process.execPath,[script,provider,"auto"],{env,input:JSON.stringify({prompt:"뽀뽀해줘",session_id:`${provider}-session`}),encoding:"utf8"});
      expect(result.status).toBe(0);
      const source=provider==="claude"?"mcp":provider==="codex"?"codex-catch":`${provider}-catch`;
      expect(JSON.parse(fs.readFileSync(path.join(x.data,file),"utf8"))).toMatchObject({emotion:"chu",outfit,source,sessionId:`${provider}-session`});
    }
  });

  it("routes worker state to the Grok file instead of Claude state",()=>{
    const x=fixture();
    expect(emotionStateFile(x.data,"grok")).toBe(path.join(x.data,"grok-state.json"));
    expect(emotionStateFile(x.data,"unknown")).toBe(path.join(x.data,"state.json"));
  });

  it("keeps the selected Codex outfit when a catch hook writes a new emotion",()=>{
    const x=fixture(),script=path.resolve("..","hooks","emotion","set-emotion.mjs"),state=path.join(x.data,"codex-state.json");
    fs.writeFileSync(state,JSON.stringify({emotion:"neutral",line:"",statusLine:"",outfit:"Gpt-Sol"}));
    const result=spawnSync(process.execPath,[script,"codex","auto"],{env:{...process.env,CLAUDEX_WORKHOUSE_ROOT:x.root,CLAUDEX_WORKHOUSE_APP_ROOT:x.root,CLAUDEX_WORKHOUSE_DATA_ROOT:x.root},input:JSON.stringify({prompt:"살펴봐",session_id:"codex-sol"}),encoding:"utf8"});
    expect(result.status).toBe(0);
    expect(JSON.parse(fs.readFileSync(state,"utf8"))).toMatchObject({outfit:"Gpt-Sol",sessionId:"codex-sol"});
  });

  it("keeps runtime emotion state in the configured data root",()=>{
    const x=fixture(),dataRoot=path.join(x.root,"separate-data"),data=path.join(dataRoot,"data","emotion"),script=path.resolve("..","hooks","emotion","set-emotion.mjs");
    fs.mkdirSync(data,{recursive:true});fs.writeFileSync(path.join(data,"emotion-mode"),"catch\n");
    const result=spawnSync(process.execPath,[script,"ollama","auto"],{env:{...process.env,CLAUDEX_WORKHOUSE_ROOT:x.root,CLAUDEX_WORKHOUSE_APP_ROOT:x.root,CLAUDEX_WORKHOUSE_DATA_ROOT:dataRoot},input:JSON.stringify({prompt:"뽀뽀해줘",session_id:"ollama-data-root"}),encoding:"utf8"});
    expect(result.status).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(data,"ollama-state.json"),"utf8"))).toMatchObject({emotion:"chu",outfit:"Ollama",sessionId:"ollama-data-root"});
    expect(fs.existsSync(path.join(x.data,"ollama-state.json"))).toBe(false);
  });
});

describe("bundled outfit naming convention",()=>{
  // The runtime used to carry three translation rules — a Gpt- filename prefix,
  // chu~ beside chu, and execute standing in for gift artwork that was simply
  // misnamed. Every alias is gone, so the invariant they hid has to be checked
  // directly: one bare lowercase name per emotion, identical across outfits.
  const root=path.resolve("public","emoticons");
  const outfits=fs.readdirSync(root,{withFileTypes:true}).filter(entry=>entry.isDirectory()).map(entry=>entry.name).sort();
  const names=(outfit:string)=>fs.readdirSync(path.join(root,outfit)).map(file=>file.replace(/\.(?:webp|png|gif)$/i,"")).sort();

  it("names every asset the same way in every outfit",()=>{
    expect(outfits.length).toBeGreaterThan(1);
    for(const outfit of outfits){
      for(const name of names(outfit)){
        expect(name,`${outfit}/${name} must be a bare lowercase name`).toMatch(/^[a-z][a-z0-9]*(?:_[0-9]+)?$/);
      }
    }
  });

  it("gives every outfit the same emotion groups, variants aside",()=>{
    const groups=(outfit:string)=>new Set(names(outfit).map(name=>name.replace(/_[0-9]+$/,"")));
    const reference=groups(outfits[0]!);
    for(const outfit of outfits.slice(1)){
      expect([...groups(outfit)].sort(),`${outfit} differs from ${outfits[0]}`).toEqual([...reference].sort());
    }
    // Renaming cannot invent artwork, so a gap here is a missing drawing.
    expect(reference.has("gift")).toBe(true);
    expect(reference.has("execute")).toBe(false);
  });

  // The catalog reads `dist`, not `public`, and the build keeps `emptyOutDir`
  // off so clients mid-deploy still find the previous shell. A rename therefore
  // left the old filename serving from `dist` under both names until
  // prune-dist mirrored the tree. Check the served copy, not just the source.
  it("serves exactly the source assets once the tree is built",()=>{
    const built=path.resolve("dist","emoticons");
    if(!fs.existsSync(built))return;
    for(const outfit of outfits){
      expect(fs.readdirSync(path.join(built,outfit)).sort(),`${outfit} differs between public and dist`)
        .toEqual(fs.readdirSync(path.join(root,outfit)).sort());
    }
  });
});
