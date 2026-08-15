import{describe,expect,it}from"vitest";
import{CONVERSATION_EMOTION_INSTRUCTION,EMOTION_MCP_POLICIES,emotionMcpEnvironment,emotionMcpHeaders,emotionMcpUrl,validatedEmotionMcpUrl}from"../../src/server/emotion-mcp-policy.js";

describe("shared provider emotion MCP policy",()=>{
  it("keeps every provider endpoint, source, anonymous rule, and profile exposure in one table",()=>{
    expect(EMOTION_MCP_POLICIES.map(({provider,path,source,allowAnonymous,profiles})=>({provider,path,source,allowAnonymous,profiles}))).toEqual([
      {provider:"claude",path:"/mcp",source:"mcp",allowAnonymous:true,profiles:{default:true,conversation:true,browser:false}},
      {provider:"codex",path:"/mcp/codex",source:"mcp-codex",allowAnonymous:true,profiles:{default:true,conversation:true,browser:false}},
      {provider:"deepseek",path:"/mcp/deepseek",source:"mcp-deepseek",allowAnonymous:false,profiles:{default:true,conversation:true,browser:false}},
      {provider:"ollama",path:"/mcp/ollama",source:"mcp-ollama",allowAnonymous:false,profiles:{default:true,conversation:true,browser:false}},
      {provider:"antigravity",path:"/mcp/antigravity",source:"mcp-antigravity",allowAnonymous:false,profiles:{default:true,conversation:true,browser:false}},
      {provider:"grok",path:"/mcp/grok",source:"mcp-grok",allowAnonymous:false,profiles:{default:true,conversation:true,browser:false}}
    ]);
  });
  it("builds only provider-matched scoped environments and loopback URLs",()=>{
    expect(emotionMcpUrl("codex",3410)).toBe("http://127.0.0.1:3410/mcp/codex");
    expect(validatedEmotionMcpUrl("codex","http://localhost:3410/mcp/codex")).toBe("http://localhost:3410/mcp/codex");
    expect(validatedEmotionMcpUrl("codex","https://127.0.0.1:3410/mcp/codex")).toBe("");
    expect(validatedEmotionMcpUrl("codex","http://127.0.0.1:3410/mcp/grok")).toBe("");
    expect(emotionMcpEnvironment("grok",3410,"claude:wrong","session","conversation")).toEqual({});
    expect(emotionMcpEnvironment("grok",3410,"grok:task","session","browser")).toEqual({});
    expect(emotionMcpHeaders("grok","grok:task","session","conversation")).toEqual({"X-Claudex-Workhouse-Task-Id":"grok:task","X-Claudex-Workhouse-Session-Id":"session","X-Claudex-Workhouse-Runtime-Profile":"conversation"});
  });
  it("defines one exact conversation contract",()=>{
    expect(CONVERSATION_EMOTION_INSTRUCTION.match(/exactly once/g)).toHaveLength(1);
    expect(CONVERSATION_EMOTION_INSTRUCTION).toContain("Use neutral");
    expect(CONVERSATION_EMOTION_INSTRUCTION).toContain("뽀뽀쪽");
    expect(CONVERSATION_EMOTION_INSTRUCTION).toContain("Use chu");
    expect(CONVERSATION_EMOTION_INSTRUCTION).toContain("Do not call express_emotion");
    expect(CONVERSATION_EMOTION_INSTRUCTION).toContain("do not insert image markdown");
  });
});
