import Fastify from "fastify";
import {describe,expect,it,vi} from "vitest";
import {emotionExpressionHoldUntil,emotionScopeFromHeaders,registerEmotionMcp} from "../../src/server/mcp-emotion.js";

describe("emotion MCP request scope",()=>{
  it("accepts only the target provider task and a safe session id",()=>{
    expect(emotionScopeFromHeaders("deepseek",{"x-claudex-workhouse-task-id":"deepseek:task-1","x-claudex-workhouse-session-id":"session-1"})).toEqual({taskId:"deepseek:task-1",sessionId:"session-1"});
    expect(emotionScopeFromHeaders("ollama",{"x-claudex-workhouse-task-id":"deepseek:task-1"})).toEqual({});
    expect(emotionScopeFromHeaders("antigravity",{"x-claudex-workhouse-task-id":"antigravity:task-2"})).toEqual({taskId:"antigravity:task-2",sessionId:""});
    expect(emotionScopeFromHeaders("grok",{"x-claudex-workhouse-task-id":"grok:task-3","x-claudex-workhouse-session-id":"grok-session"})).toEqual({taskId:"grok:task-3",sessionId:"grok-session"});
    expect(emotionScopeFromHeaders("grok",{"x-claudex-workhouse-task-id":"claude:task-3"})).toEqual({});
    expect(emotionScopeFromHeaders("antigravity",{"x-claudex-workhouse-task-id":"antigravity:task-2\nspoof"})).toEqual({});
  });

  it("holds explicit MCP expressions long enough for every provider turn to finish",()=>{
    expect(emotionExpressionHoldUntil(1_000)).toBe(121_000);
  });

  it("routes a task-scoped Grok MCP emotion call only to the Grok watcher",async()=>{
    const app=Fastify(),claudeSet=vi.fn(),grokSet=vi.fn(),watcher=(setState:ReturnType<typeof vi.fn>,outfit:string)=>({get:()=>({emotion:"neutral",line:"",statusLine:"",outfit}),setState,setOutfit:vi.fn(),outfits:()=>[outfit]});
    registerEmotionMcp(app,{watcher:watcher(claudeSet,"normal") as any,grokWatcher:watcher(grokSet,"Grok") as any,stateFile:"unused",assetsDir:new URL("../../public/emoticons",import.meta.url).pathname,baseUrl:"http://127.0.0.1:3410"});
    try{
      const response=await app.inject({method:"POST",url:"/mcp/grok",headers:{accept:"application/json, text/event-stream","content-type":"application/json","x-claudex-workhouse-task-id":"grok:task-3","x-claudex-workhouse-session-id":"grok-session"},payload:{jsonrpc:"2.0",id:1,method:"tools/call",params:{name:"set_emotion",arguments:{emotion:"chu",line:"쪽"}}}});
      expect(response.statusCode).toBe(200);expect(response.json()).toMatchObject({jsonrpc:"2.0",id:1,result:{content:[{type:"text",text:"(chu) 쪽"}]}});
      expect(grokSet).toHaveBeenCalledWith(expect.objectContaining({emotion:"chu",line:"쪽",source:"mcp-grok",taskId:"grok:task-3",sessionId:"grok-session",holdUntil:expect.any(Number)}));expect(claudeSet).not.toHaveBeenCalled();
    }finally{await app.close();}
  });

  it("files an unscoped Claude MCP emotion under no task at all",async()=>{
    const app=Fastify(),claudeSet=vi.fn(),watcher=(setState:ReturnType<typeof vi.fn>,outfit:string)=>({get:()=>({emotion:"neutral",line:"",statusLine:"",outfit}),setState,setOutfit:vi.fn(),outfits:()=>[outfit]});
    registerEmotionMcp(app,{watcher:watcher(claudeSet,"normal") as any,stateFile:"unused",assetsDir:new URL("../../public/emoticons",import.meta.url).pathname,baseUrl:"http://127.0.0.1:3410"});
    try{
      const response=await app.inject({method:"POST",url:"/mcp",headers:{accept:"application/json, text/event-stream","content-type":"application/json"},payload:{jsonrpc:"2.0",id:1,method:"tools/call",params:{name:"set_emotion",arguments:{emotion:"happy"}}}});
      expect(response.statusCode).toBe(200);
      // Empty ids, not absent keys: the watcher merges the patch over the shared
      // state, so anything omitted here would inherit another task's ids and
      // stamp that task's avatar with this "완료".
      expect(claudeSet).toHaveBeenCalledWith(expect.objectContaining({emotion:"happy",source:"mcp",taskId:"",sessionId:""}));
    }finally{await app.close();}
  });

  it("exposes only set_emotion to conversation runtimes",async()=>{
    const app=Fastify(),watcher={get:()=>({emotion:"neutral",line:"",statusLine:"",outfit:"Grok"}),setState:vi.fn(),setOutfit:vi.fn(),outfits:()=>["Grok"]};
    registerEmotionMcp(app,{watcher:watcher as any,grokWatcher:watcher as any,stateFile:"unused",assetsDir:new URL("../../public/emoticons",import.meta.url).pathname,baseUrl:"http://127.0.0.1:3410"});
    try{
      const response=await app.inject({method:"POST",url:"/mcp/grok",headers:{accept:"application/json, text/event-stream","content-type":"application/json","x-claudex-workhouse-task-id":"grok:task","x-claudex-workhouse-runtime-profile":"conversation"},payload:{jsonrpc:"2.0",id:1,method:"tools/list",params:{}}});
      expect(response.statusCode).toBe(200);expect(response.json().result.tools.map((tool:any)=>tool.name)).toEqual(["set_emotion"]);
    }finally{await app.close();}
  });

  it("keeps anonymous Codex compatibility isolated from task snapshots",async()=>{
    const app=Fastify(),codexSet=vi.fn(),watcher={get:()=>({emotion:"neutral",line:"",statusLine:"",outfit:"Gpt-Codex"}),setState:codexSet,setOutfit:vi.fn(),outfits:()=>["Gpt-Codex"]};
    registerEmotionMcp(app,{watcher:watcher as any,codexWatcher:watcher as any,stateFile:"unused",assetsDir:new URL("../../public/emoticons",import.meta.url).pathname,baseUrl:"http://127.0.0.1:3410"});
    try{const response=await app.inject({method:"POST",url:"/mcp/codex",headers:{accept:"application/json, text/event-stream","content-type":"application/json"},payload:{jsonrpc:"2.0",id:1,method:"tools/call",params:{name:"set_emotion",arguments:{emotion:"neutral"}}}});expect(response.statusCode).toBe(200);expect(codexSet).toHaveBeenCalledWith(expect.objectContaining({source:"mcp-codex",taskId:"",sessionId:""}));}finally{await app.close();}
  });
});
