import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {afterEach,describe,expect,it,vi} from "vitest";
import {ollamaShowUrl,ollamaTagsUrl} from "../../src/server/compatible-provider-config.js";

const source=fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)),"..","..","src","server","providers","compatible.ts"),"utf8");

afterEach(()=>{vi.unstubAllGlobals();});

/**
 * The catalog answers with a cloud model's pinned tags but omits its rolling
 * alias, so a model the account can run goes missing from the grid. The probe
 * asks /api/show about every base name the catalog itself mentions.
 */
describe("Ollama rolling alias recovery",()=>{
  it("derives the probe target from the catalog rather than from the source",()=>{
    // A model name written here would go stale the moment Ollama adds one, and
    // the grid would silently fall behind again. The names must come from the
    // response, so the probe carries no catalog of its own.
    const probe=source.slice(source.indexOf("ollamaRollingAliases"),source.indexOf("getModelCatalog"));
    expect(probe).toContain('name.split(":")[0]');
    expect(probe).not.toMatch(/["'`][a-z0-9.]+-?[a-z0-9.]*:(cloud|preview|latest)/i);
    expect(probe).not.toContain("https://");
  });

  it("builds the show URL from the configured base URL",()=>{
    expect(ollamaShowUrl("https://ollama.com")).toBe("https://ollama.com/api/show");
    expect(ollamaShowUrl("https://proxy.example/ollama/")).toBe("https://proxy.example/ollama/api/show");
    expect(new URL(ollamaShowUrl("https://ollama.com")).origin).toBe(new URL(ollamaTagsUrl("https://ollama.com")).origin);
  });

  it("keeps a base name the account may run and drops one it may not",async()=>{
    const listed=["pinned-model:0731","pinned-model:preview","other-model:31b","standalone-model"];
    const asked:string[]=[];
    vi.stubGlobal("fetch",vi.fn(async(url:string,init?:RequestInit)=>{
      if(String(url).endsWith("/api/show")){
        const model=JSON.parse(String(init?.body)).model as string;
        asked.push(model);
        return new Response(null,{status:model==="pinned-model"?200:404});
      }
      return new Response(JSON.stringify({models:listed.map(name=>({name}))}),{status:200});
    }));
    const {recovered,probed}=await runProbe(listed);
    expect(probed.sort()).toEqual(["other-model","pinned-model"]);
    expect(asked.sort()).toEqual(["other-model","pinned-model"]);
    // "standalone-model" already stands on its own, so it is never probed.
    expect(recovered).toEqual([...listed,"pinned-model"]);
  });

  it("drops a probe that fails instead of losing the whole catalog",async()=>{
    vi.stubGlobal("fetch",vi.fn(async(url:string)=>{
      if(String(url).endsWith("/api/show"))throw new Error("network is unreachable");
      return new Response(null,{status:200});
    }));
    const listed=["pinned-model:0731"];
    const {recovered}=await runProbe(listed);
    expect(recovered).toEqual(listed);
  });
});

/** Exercises the probe through the same shape the provider uses, without a database. */
async function runProbe(listed:string[]){
  const {AnthropicCompatibleProvider}=await import("../../src/server/providers/compatible.js");
  const instance=Object.create(AnthropicCompatibleProvider.prototype) as {ollamaRollingAliases(config:{baseUrl:string;apiKey:string},listed:string[]):Promise<string[]>};
  const probed=await instance.ollamaRollingAliases({baseUrl:"https://ollama.com",apiKey:"test-key"},listed);
  return{recovered:[...listed,...probed],probed:[...new Set(listed.map(name=>name.split(":")[0]).filter(name=>!listed.includes(name)))]};
}
