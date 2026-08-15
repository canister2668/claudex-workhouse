import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach,describe,expect,it} from "vitest";
import {compatibleProviderConfig,compatibleProviderEnvironment,compatibleProviderPublicSettings,deepseekModelsUrl,ollamaTagsUrl,saveCompatibleProviderSettings} from "../../src/server/compatible-provider-config.js";

const names=["CLAUDEX_WORKHOUSE_DEEPSEEK_BASE_URL","CLAUDEX_WORKHOUSE_DEEPSEEK_API_KEY","DEEPSEEK_API_KEY","CLAUDEX_WORKHOUSE_OLLAMA_BASE_URL","CLAUDEX_WORKHOUSE_OLLAMA_API_KEY","OLLAMA_API_KEY","CLAUDEX_WORKHOUSE_OLLAMA_AUTH_TOKEN","CLAUDEX_WORKHOUSE_OLLAMA_DEFAULT_MODEL"] as const;
const previous=Object.fromEntries(names.map(name=>[name,process.env[name]]));
const temporaryRoots:string[]=[];
afterEach(()=>{for(const name of names){const value=previous[name];if(value===undefined)delete process.env[name];else process.env[name]=value;}for(const root of temporaryRoots.splice(0))fs.rmSync(root,{recursive:true,force:true});});

describe("Anthropic-compatible provider configuration",()=>{
  it("keeps DeepSeek API and Ollama Cloud as separate backends",()=>{
    const dataRoot=fs.mkdtempSync(path.join(os.tmpdir(),"compatible-provider-settings-"));temporaryRoots.push(dataRoot);
    process.env.CLAUDEX_WORKHOUSE_DEEPSEEK_API_KEY="server-secret";
    process.env.CLAUDEX_WORKHOUSE_OLLAMA_API_KEY="ollama-cloud-secret";
    expect(compatibleProviderConfig("deepseek",dataRoot)).toMatchObject({provider:"deepseek",baseUrl:"https://api.deepseek.com/anthropic",apiKey:"server-secret"});
    expect(compatibleProviderConfig("ollama",dataRoot)).toMatchObject({provider:"ollama",baseUrl:"https://ollama.com",apiKey:"ollama-cloud-secret"});
    expect(ollamaTagsUrl(compatibleProviderConfig("ollama",dataRoot).baseUrl)).toBe("https://ollama.com/api/tags");
    expect(deepseekModelsUrl(compatibleProviderConfig("deepseek",dataRoot).baseUrl)).toBe("https://api.deepseek.com/models");
    expect(deepseekModelsUrl("https://proxy.example/deepseek/anthropic")).toBe("https://proxy.example/deepseek/models");
  });

  it("does not expose an Ollama key through ANTHROPIC_API_KEY",()=>{
    const dataRoot=fs.mkdtempSync(path.join(os.tmpdir(),"compatible-provider-settings-"));temporaryRoots.push(dataRoot);
    process.env.CLAUDEX_WORKHOUSE_OLLAMA_API_KEY="cloud-token";
    expect(compatibleProviderEnvironment("ollama",dataRoot)).toEqual({ANTHROPIC_BASE_URL:"https://ollama.com",ANTHROPIC_AUTH_TOKEN:"cloud-token",ANTHROPIC_API_KEY:""});
  });

  it("pins Claude Code subagents to each compatible provider's selected model",()=>{
    const dataRoot=fs.mkdtempSync(path.join(os.tmpdir(),"compatible-provider-settings-"));temporaryRoots.push(dataRoot);
    process.env.CLAUDEX_WORKHOUSE_DEEPSEEK_API_KEY="deepseek-secret";
    process.env.CLAUDEX_WORKHOUSE_OLLAMA_API_KEY="ollama-secret";
    expect(compatibleProviderEnvironment("deepseek",dataRoot,"deepseek-v4-flash")).toMatchObject({CLAUDE_CODE_SUBAGENT_MODEL:"deepseek-v4-flash"});
    expect(compatibleProviderEnvironment("ollama",dataRoot,"deepseek-v4-flash:0731")).toMatchObject({CLAUDE_CODE_SUBAGENT_MODEL:"deepseek-v4-flash:0731"});
  });

  it("rejects credentials embedded in backend URLs",()=>{
    const dataRoot=fs.mkdtempSync(path.join(os.tmpdir(),"compatible-provider-settings-"));temporaryRoots.push(dataRoot);
    process.env.CLAUDEX_WORKHOUSE_OLLAMA_BASE_URL="http://user:pass@localhost:11434";
    expect(()=>compatibleProviderConfig("ollama",dataRoot)).toThrow(/without embedded credentials/);
  });

  it("stores UI-entered secrets in a private server file without returning them",()=>{
    const dataRoot=fs.mkdtempSync(path.join(os.tmpdir(),"compatible-provider-settings-"));temporaryRoots.push(dataRoot);
    const visible=saveCompatibleProviderSettings(dataRoot,"deepseek",{baseUrl:"https://api.deepseek.com/anthropic",secret:"ui-secret"});
    expect(visible).toEqual({provider:"deepseek",baseUrl:"https://api.deepseek.com/anthropic",secretConfigured:true,secretSource:"workhouse"});
    expect(JSON.stringify(compatibleProviderPublicSettings("deepseek",dataRoot))).not.toContain("ui-secret");
    expect(compatibleProviderConfig("deepseek",dataRoot).apiKey).toBe("ui-secret");
    expect(fs.statSync(path.join(dataRoot,"config","compatible-providers.json")).mode&0o777).toBe(0o600);
  });
});
