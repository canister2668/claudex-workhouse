import {describe,expect,it} from "vitest";
import {render} from "svelte/server";
import McpServerSettings from "../../src/web/McpServerSettings.svelte";
import {mcpServerDraftIsValid,mcpServerSavePayload,normalizeMcpServerSettings,type McpServerDraft} from "../../src/web/mcp-servers";

const configured:McpServerDraft={id:"tavily",name:"Tavily",url:"https://mcp.tavily.com/mcp",enabled:true,roles:["default-search"],readOnly:true,secretConfigured:true,secretSource:"workhouse",secret:"",clearSecret:false};

describe("external MCP settings UI",()=>{
  it("renders the remote-only and Grok support boundaries",()=>{
    const body=render(McpServerSettings,{props:{api:async()=>({settings:{version:1,servers:[]}})}}).body;
    expect(body).toContain("외부 MCP 서버");
    expect(body).toContain("HTTPS 주소 전용");
    expect(body).toContain("Grok은 지원하지 않음");
  });

  it("never hydrates a returned secret into a draft",()=>{
    const result=normalizeMcpServerSettings({settings:{version:1,servers:[{...configured,secret:"must-not-render"}]},updatedAt:"2026-08-11T00:00:00.000Z"});
    expect(result.settings.servers[0].secret).toBe("");
    expect(result.settings.servers[0].secretConfigured).toBe(true);
  });

  it("sends only newly entered replacement secrets and omits public secret metadata",()=>{
    const payload=mcpServerSavePayload([{...configured,secret:"  replacement-token  "},{...configured,id:"exa",name:"Exa",secret:"",secretConfigured:false}],"revision-1");
    expect(payload.settings.servers).toEqual([
      {id:"tavily",name:"Tavily",url:"https://mcp.tavily.com/mcp",enabled:true,roles:["default-search"],readOnly:true,secret:"replacement-token"},
      {id:"exa",name:"Exa",url:"https://mcp.tavily.com/mcp",enabled:true,roles:["default-search"],readOnly:true}
    ]);
    expect(JSON.stringify(payload)).not.toContain("secretConfigured");
    expect(payload.baseUpdatedAt).toBe("revision-1");
  });

  it("sends an explicit clear operation without returning or inventing a secret",()=>{
    const payload=mcpServerSavePayload([{...configured,clearSecret:true}],null);
    expect(payload.settings.servers[0]).toMatchObject({id:"tavily",clearSecret:true});
    expect(payload.settings.servers[0]).not.toHaveProperty("secret");
  });

  it("accepts HTTPS and loopback HTTP but rejects clear-text remote endpoints",()=>{
    expect(mcpServerDraftIsValid(configured)).toBe(true);
    expect(mcpServerDraftIsValid({...configured,url:"http://localhost:8787/mcp"})).toBe(true);
    expect(mcpServerDraftIsValid({...configured,url:"http://127.0.0.1:8787/mcp"})).toBe(true);
    expect(mcpServerDraftIsValid({...configured,url:"http://example.com/mcp"})).toBe(false);
    expect(mcpServerDraftIsValid({...configured,roles:[]})).toBe(false);
    expect(mcpServerDraftIsValid({...configured,readOnly:false})).toBe(false);
  });
});
