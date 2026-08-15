import fs from"node:fs";
import os from"node:os";
import path from"node:path";
import{afterEach,describe,expect,it}from"vitest";
import{externalMcpForAntigravity,externalMcpForClaude,externalMcpForCodex,readExternalMcpBundle}from"../../src/server/external-mcp-bundle.js";
import{prepareExternalMcpEnvironment}from"../../src/server/external-mcp-runtime.js";
import{McpSecretStore}from"../../src/server/mcp-secrets.js";

const roots:string[]=[];
function bundle(taskId="claude:test"){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"external-mcp-"));roots.push(root);const file=path.join(root,"bundle.json");
  fs.writeFileSync(file,JSON.stringify({version:1,taskId,servers:[{id:"tavily",url:"https://mcp.tavily.com/mcp",headers:{Authorization:"Bearer private"},toolTimeoutSec:90}]}),{mode:0o600});
  fs.chmodSync(file,0o600);return file;
}
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});

describe("task-scoped external MCP bundle",()=>{
  it("translates one secret without putting it in provider configuration",()=>{
    const parsed=readExternalMcpBundle(bundle(),"claude:test")!;
    const claude=externalMcpForClaude(parsed),codex=externalMcpForCodex(parsed),antigravity=externalMcpForAntigravity(parsed);
    expect(claude.mcpServers.tavily).toMatchObject({type:"http",url:"https://mcp.tavily.com/mcp",headers:{Authorization:"${CLAUDEX_WORKHOUSE_EXTERNAL_MCP_0_HEADER_0}"}});
    expect(claude.allowedTools).toEqual(["mcp__tavily__*"]);
    expect(codex.args.join(" ")).toContain("mcp_servers.tavily.env_http_headers");
    expect(codex.args.join(" ")).not.toContain("private");
    expect(antigravity.mcpServers.tavily).toMatchObject({headers:{Authorization:"${CLAUDEX_WORKHOUSE_EXTERNAL_MCP_0_HEADER_0}"}});
    expect(claude.environment.CLAUDEX_WORKHOUSE_EXTERNAL_MCP_0_HEADER_0).toBe("Bearer private");
  });
  it("rejects a different task, broad permissions, reserved ids, and non-TLS remote URLs",()=>{
    const file=bundle();expect(()=>readExternalMcpBundle(file,"claude:other")).toThrow(/scope/);
    if(process.platform!=="win32"){fs.chmodSync(file,0o644);expect(()=>readExternalMcpBundle(file,"claude:test")).toThrow(/0600/);fs.chmodSync(file,0o600);}
    fs.writeFileSync(file,JSON.stringify({version:1,taskId:"claude:test",servers:[{id:"claudex-workhouse",url:"https://example.com/mcp"}]}));expect(()=>readExternalMcpBundle(file,"claude:test")).toThrow(/reserved/);
    fs.writeFileSync(file,JSON.stringify({version:1,taskId:"claude:test",servers:[{id:"search",url:"http://example.com/mcp"}]}));expect(()=>readExternalMcpBundle(file,"claude:test")).toThrow(/HTTPS/);
  });
  it("writes a task-scoped bundle with one selected server per role and no ambient conversation capability",async()=>{
    const dataRoot=fs.mkdtempSync(path.join(os.tmpdir(),"external-mcp-data-")),taskTempDir=fs.mkdtempSync(path.join(os.tmpdir(),"external-mcp-task-"));roots.push(dataRoot,taskTempDir);
    new McpSecretStore(dataRoot).set("tavily","private-token");
    const settings={version:1,servers:[
      {id:"tavily",name:"Tavily",url:"https://mcp.tavily.com/mcp",enabled:true,roles:["default-search"],readOnly:true},
      {id:"brave",name:"Brave",url:"https://mcp.brave.example/mcp",enabled:true,roles:["default-search"],readOnly:true},
      {id:"exa",name:"Exa",url:"https://mcp.exa.example/mcp",enabled:true,roles:["semantic-search"],readOnly:true}
    ]};
    const db={getSystemSetting:async()=>({value:settings,updatedAt:new Date().toISOString()})} as any;
    const prepared=await prepareExternalMcpEnvironment({db,taskTempDir,taskId:"claude:scoped",provider:"claude",runtimeProfile:"default",port:3410}),file=prepared.environment.CLAUDEX_WORKHOUSE_EXTERNAL_MCP_BUNDLE_FILE;
    const parsed=readExternalMcpBundle(file,"claude:scoped")!;
    expect(parsed.servers.map(server=>server.id)).toEqual(["tavily","exa"]);
    expect(parsed.servers[0].url).toBe("http://127.0.0.1:3410/mcp/external/claude%3Ascoped/tavily");
    expect(parsed.servers[0].headers.Authorization).toMatch(/^Bearer [A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(parsed)).not.toContain("private-token");
    expect(prepared.metadata).toMatchObject({externalMcpCapabilityHash:expect.stringMatching(/^[a-f0-9]{64}$/)});expect(prepared.promptSuffix).toContain("tavily (Tavily): ordinary current web search");
    const empty={environment:{},metadata:{},promptSuffix:""};
    expect(await prepareExternalMcpEnvironment({db,taskTempDir,taskId:"claude:chat",provider:"claude",runtimeProfile:"conversation",port:3410})).toEqual(empty);
    expect(await prepareExternalMcpEnvironment({db,taskTempDir,taskId:"grok:none",provider:"grok",runtimeProfile:"default",port:3410})).toEqual(empty);
    expect(await prepareExternalMcpEnvironment({db,taskTempDir,taskId:"claude:browser",provider:"claude",runtimeProfile:"browser",port:3410})).toEqual(empty);
  });
});
