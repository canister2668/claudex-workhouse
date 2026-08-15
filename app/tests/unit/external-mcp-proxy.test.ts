import crypto from"node:crypto";
import fs from"node:fs";
import os from"node:os";
import path from"node:path";
import Fastify from"fastify";
import{afterEach,describe,expect,it,vi}from"vitest";
import{registerExternalMcpProxy}from"../../src/server/external-mcp-proxy.js";
import{McpSecretStore}from"../../src/server/mcp-secrets.js";

const roots:string[]=[],apps:Array<ReturnType<typeof Fastify>>=[];
afterEach(async()=>{await Promise.all(apps.splice(0).map(app=>app.close()));for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});

describe("external MCP credential proxy",()=>{
  it("exchanges a task capability for the remote bearer token without returning it",async()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),"mcp-proxy-"));roots.push(root);const secrets=new McpSecretStore(root);secrets.set("tavily","remote-long-lived-secret");
    const token=crypto.randomBytes(32).toString("base64url"),hash=crypto.createHash("sha256").update(token).digest("hex"),fetchMock=vi.fn(async(_url:unknown,init:any)=>{
      expect(init.headers.get("authorization")).toBe("Bearer remote-long-lived-secret");
      expect(String(init.body)).toContain("tools/list");
      return new Response(JSON.stringify({jsonrpc:"2.0",id:1,result:{tools:[]}}),{status:200,headers:{"content-type":"application/json","mcp-session-id":"session-1"}});
    }),db={getTask:async()=>({status:"running",metadata:{externalMcpCapabilityHash:hash,externalMcpServers:[{id:"tavily",url:"https://mcp.tavily.example/mcp"}]}})} as any,app=Fastify({logger:false});apps.push(app);
    registerExternalMcpProxy(app,{db,secrets,fetch:fetchMock as any});
    const response=await app.inject({method:"POST",url:"/mcp/external/claude%3Atest/tavily",headers:{authorization:`Bearer ${token}`,accept:"application/json","content-type":"application/json"},payload:{jsonrpc:"2.0",id:1,method:"tools/list"}});
    expect(response.statusCode).toBe(200);expect(response.headers["mcp-session-id"]).toBe("session-1");expect(response.body).not.toContain("remote-long-lived-secret");expect(fetchMock).toHaveBeenCalledWith("https://mcp.tavily.example/mcp",expect.any(Object));
  });
  it("rejects invalid, completed, and out-of-scope task capabilities",async()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),"mcp-proxy-"));roots.push(root);const secrets=new McpSecretStore(root),token=crypto.randomBytes(32).toString("base64url"),hash=crypto.createHash("sha256").update(token).digest("hex"),task:any={status:"completed",metadata:{externalMcpCapabilityHash:hash,externalMcpServers:[{id:"exa",url:"https://mcp.exa.example/mcp"}]}},db={getTask:async()=>task} as any,fetchMock=vi.fn(),app=Fastify({logger:false});apps.push(app);registerExternalMcpProxy(app,{db,secrets,fetch:fetchMock as any});
    expect((await app.inject({method:"POST",url:"/mcp/external/codex%3Atest/exa",headers:{authorization:`Bearer ${token}`},payload:{}})).statusCode).toBe(403);
    task.status="running";expect((await app.inject({method:"POST",url:"/mcp/external/codex%3Atest/exa",headers:{authorization:"Bearer invalid"},payload:{}})).statusCode).toBe(403);
    expect((await app.inject({method:"POST",url:"/mcp/external/codex%3Atest/tavily",headers:{authorization:`Bearer ${token}`},payload:{}})).statusCode).toBe(403);expect(fetchMock).not.toHaveBeenCalled();
  });
});
