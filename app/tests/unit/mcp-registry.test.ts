import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach,describe,expect,it} from "vitest";
import {DEFAULT_MCP_REGISTRY_SETTINGS,MCP_REGISTRY_SETTING_KEY,externalMcpServersForProvider,mcpRegistryPutSchema,mcpRegistrySettingsSchema,normalizeMcpRegistrySettings,publicMcpRegistrySettings,serializeMcpRegistrySettings} from "../../src/server/mcp-registry.js";
import {McpSecretStore} from "../../src/server/mcp-secrets.js";
import {EXTERNAL_MCP_PROVIDERS,EXTERNAL_MCP_ROLES,requireReadOnlyExternalMcp,supportsExternalMcp} from "../../src/server/mcp-tool-policy.js";

const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
const root=()=>{const value=fs.mkdtempSync(path.join(os.tmpdir(),"mcp-registry-"));roots.push(value);return value;};
const server=(extra:Record<string,unknown>={})=>({id:"tavily",name:"Tavily",url:"https://mcp.tavily.com/mcp",enabled:true,roles:["default-search"],readOnly:true,...extra});

describe("external MCP registry",()=>{
  it("accepts HTTPS and loopback HTTP but rejects credentials, fragments, cleartext remote URLs and built-in ids",()=>{
    expect(mcpRegistrySettingsSchema.parse({version:1,servers:[server()]}).servers[0].url).toBe("https://mcp.tavily.com/mcp");
    expect(mcpRegistrySettingsSchema.parse({version:1,servers:[server({url:"http://127.0.0.1:8787/mcp"})]}).servers[0].url).toBe("http://127.0.0.1:8787/mcp");
    for(const url of["http://example.com/mcp","https://user:pass@example.com/mcp","https://example.com/mcp#token"])expect(()=>mcpRegistrySettingsSchema.parse({version:1,servers:[server({url})]})).toThrow();
    for(const id of["claudex-workhouse","claudex-workhouse-emotion","mcp-emoticon","managed-provider"])expect(()=>mcpRegistrySettingsSchema.parse({version:1,servers:[server({id})]})).toThrow(/reserved/i);
  });

  it("permits only the four role presets, supported providers, unique ids, and read-only servers",()=>{
    expect(EXTERNAL_MCP_ROLES).toEqual(["default-search","semantic-search","crawl","url-read"]);
    expect(EXTERNAL_MCP_PROVIDERS).toEqual(["claude","codex","deepseek","ollama","antigravity"]);
    expect(supportsExternalMcp("grok")).toBe(false);expect(supportsExternalMcp("claude")).toBe(true);
    expect(()=>requireReadOnlyExternalMcp(false)).toThrow(/read-only/i);
    expect(()=>mcpRegistrySettingsSchema.parse({version:1,servers:[server(),server()]})).toThrow(/unique/i);
    expect(()=>mcpRegistrySettingsSchema.parse({version:1,servers:[server({readOnly:false})]})).toThrow();
  });

  it("separates PUT secrets from serializable settings and publishes only configured state",()=>{
    const parsed=mcpRegistryPutSchema.parse({settings:{version:1,servers:[server({secret:"top-secret"})]},baseUpdatedAt:null});
    expect(parsed.secretUpdates).toEqual([{serverId:"tavily",secret:"top-secret",clear:false}]);
    expect(JSON.stringify(parsed.settings)).not.toContain("top-secret");
    const publicValue=publicMcpRegistrySettings(parsed.settings,{has:id=>id==="tavily"} as any);
    expect(publicValue.servers[0]).toMatchObject({id:"tavily",secretConfigured:true,secretSource:"workhouse"});
    expect(JSON.stringify(publicValue)).not.toContain("top-secret");
    expect(serializeMcpRegistrySettings(parsed.settings)).toEqual(parsed.settings);
    expect(normalizeMcpRegistrySettings({bad:true})).toEqual(DEFAULT_MCP_REGISTRY_SETTINGS);
    expect(MCP_REGISTRY_SETTING_KEY).toBe("external-mcp.registry.v1");
  });

  it("filters disabled and role-mismatched servers and reports Grok as unsupported",()=>{
    const settings=mcpRegistrySettingsSchema.parse({version:1,servers:[server(),server({id:"brave",name:"Brave",roles:["default-search"]}),server({id:"exa",name:"Exa",roles:["semantic-search"]}),server({id:"off",enabled:false})]});
    expect(externalMcpServersForProvider(settings,"claude",["semantic-search"]).map(item=>item.id)).toEqual(["exa"]);
    expect(externalMcpServersForProvider(settings,"claude").map(item=>item.id)).toEqual(["tavily","exa"]);
    expect(externalMcpServersForProvider(settings,"grok")).toEqual([]);
  });
});

describe("external MCP secret store",()=>{
  it("atomically stores 0600 files under 0700 directories without exposing values",()=>{
    const store=new McpSecretStore(root());store.set("tavily","secret-value");
    expect(store.has("tavily")).toBe(true);expect(store.get("tavily")).toBe("secret-value");
    expect(fs.statSync(store.directory).mode&0o777).toBe(0o700);expect(fs.statSync(store.file).mode&0o777).toBe(0o600);
    expect(store.delete("tavily")).toBe(true);expect(store.get("tavily")).toBeNull();expect(store.delete("tavily")).toBe(false);
  });

  it("rejects symlinked directories and files",()=>{
    const data=root(),outside=root();fs.mkdirSync(path.join(data,"secrets"));fs.symlinkSync(outside,path.join(data,"secrets","mcp"),"dir");expect(()=>new McpSecretStore(data)).toThrow(/unsafe/i);
    const safe=root(),store=new McpSecretStore(safe),outsideFile=path.join(outside,"secrets.json");fs.writeFileSync(outsideFile,'{"version":1,"secrets":{}}');fs.symlinkSync(outsideFile,store.file);expect(()=>store.has("tavily")).toThrow(/unsafe/i);
  });

  it("applies one settings snapshot and can restore it after a failed database compare-and-swap",()=>{
    const store=new McpSecretStore(root());store.set("tavily","old-token");store.set("exa","remove-me");const before=store.snapshot();
    store.applyForSettings([{serverId:"tavily",secret:"new-token",clear:false}],new Set(["tavily"]));expect(store.get("tavily")).toBe("new-token");expect(store.get("exa")).toBeNull();
    store.restore(before);expect(store.get("tavily")).toBe("old-token");expect(store.get("exa")).toBe("remove-me");
  });
});
