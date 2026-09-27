import {describe,it,expect,vi} from "vitest";
import {resolveManagedModel} from "../../src/server/managed-provider-models.js";
import {ManagedProviderBridge} from "../../src/server/managed-provider-mcp.js";
import type {GlobalModelSettings} from "../../src/server/global-model-settings.js";
import Fastify from "fastify";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StreamableHTTPClientTransport} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {registerManagedProviderMcp} from "../../src/server/managed-provider-mcp.js";

function catalog(ids=["claude-opus-5[1m]","claude-sonnet-4-6"]):GlobalModelSettings{
  const entry=(id:string)=>({id,displayName:id==="claude-opus-5[1m]"?"Opus 5 · 1M":id,source:"runtime" as const,validatedAt:null});
  return{version:1,claude:{models:ids.map(entry)},codex:{models:[entry("gpt-test")]},deepseek:{models:[]},ollama:{models:[]},antigravity:{models:[]},grok:{models:[]}};
}
describe("managed model resolution",()=>{
  it("exposes catalog discovery as a task-authenticated read-only MCP tool",async()=>{
    const db:any={getSystemSetting:vi.fn(async()=>null)},bridge=new ManagedProviderBridge(db,{} as any,async t=>t,async t=>t,async()=>{},async()=>({settings:catalog(),updatedAt:"now"}));
    const authenticate=vi.spyOn(bridge,"authenticate").mockResolvedValue({metadata:{}} as any);
    const app=Fastify(),client=new Client({name:"model-discovery-test",version:"1"});
    registerManagedProviderMcp(app,bridge);
    try{
      const address=await app.listen({host:"127.0.0.1",port:0});
      await client.connect(new StreamableHTTPClientTransport(new URL(`${address}/mcp/claudex-workhouse`),{requestInit:{headers:{Authorization:"Bearer test-capability","X-Claudex-Workhouse-Task-Id":"test-source"}}}));
      const listing=await client.listTools(),tool=listing.tools.find(item=>item.name==="managed_provider_models");
      expect(tool?.annotations?.readOnlyHint).toBe(true);
      const result=await client.callTool({name:"managed_provider_models",arguments:{provider:"claude",model:"Opus 5"}});
      expect(result.isError).not.toBe(true);expect(JSON.stringify(result.content)).toContain("claude-opus-5[1m]");
      expect(authenticate).toHaveBeenCalledWith("test-source","test-capability");
    }finally{await client.close();await app.close();}
  });
  it.each(["claude-opus-5[1m]","claude-opus-5","opus-5","Opus 5","Opus 5 · 1M"])("resolves %s using only the enabled catalog",name=>expect(resolveManagedModel(catalog(),"claude",name)).toBe("claude-opus-5[1m]"));
  it("preserves exact choices even with two context variants",()=>expect(resolveManagedModel(catalog(["claude-opus-5","claude-opus-5[1m]"]),"claude","claude-opus-5")).toBe("claude-opus-5"));
  it("rejects ambiguous family names",()=>expect(()=>resolveManagedModel(catalog(["claude-opus-5","claude-opus-5[1m]"]),"claude","Opus 5")).toThrow(/ambiguous/));
  it.each(["opus-4-5","opus-50","opus","claude-opus-5[2m]"])("never substitutes %s",name=>expect(()=>resolveManagedModel(catalog(),"claude",name)).toThrow(/not enabled/));
  it("does not change provider",()=>expect(()=>resolveManagedModel(catalog(),"codex","Opus 5")).toThrow(/not enabled/));
  it("reports available exact IDs on failure",()=>expect(()=>resolveManagedModel(catalog(),"claude","unknown")).toThrow(/claude-opus-5\[1m\]/));
  it("re-reads the catalog and gates the canonical ID before creation",async()=>{
    let settings=catalog();
    const gate=vi.fn(async()=>{throw new Error("test execution gate");}),db:any={getSystemSetting:vi.fn(async()=>null)},collaboration:any={createAssist:vi.fn()};
    const bridge=new ManagedProviderBridge(db,collaboration,async t=>t,async t=>t,gate,async()=>({settings,updatedAt:"now"}));
    expect(await bridge.models({provider:"claude",model:"Opus 5"})).toMatchObject({resolvedModel:"claude-opus-5[1m]",source:"global-enabled-catalog"});
    await expect(bridge.create({} as any,{provider:"claude",model:"Opus 5",prompt:"review",idempotencyKey:"11111111-1111-4111-8111-111111111111"})).rejects.toThrow("test execution gate");
    expect(gate).toHaveBeenCalledWith("claude","claude-opus-5[1m]");expect(collaboration.createAssist).not.toHaveBeenCalled();
    settings=catalog(["claude-sonnet-4-6"]);
    await expect(bridge.models({provider:"claude",model:"Opus 5"})).rejects.toThrow(/not enabled/);
  });
});
