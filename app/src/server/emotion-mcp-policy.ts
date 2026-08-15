export const EMOTION_MCP_TASK_HEADER="X-Claudex-Workhouse-Task-Id";
export const EMOTION_MCP_SESSION_HEADER="X-Claudex-Workhouse-Session-Id";
export const EMOTION_MCP_PROFILE_HEADER="X-Claudex-Workhouse-Runtime-Profile";
export const EMOTION_MCP_SERVER_ID="claudex_workhouse_emotion";
export const EMOTION_MCP_TOOL_NAME="set_emotion";

export type EmotionMcpProvider="claude"|"codex"|"deepseek"|"ollama"|"antigravity"|"grok";
export type EmotionRuntimeProfile="default"|"conversation"|"browser";

export type EmotionMcpPolicy={
  provider:EmotionMcpProvider;
  path:string;
  source:string;
  allowAnonymous:boolean;
  profiles:Record<EmotionRuntimeProfile,boolean>;
};

const POLICIES:Record<EmotionMcpProvider,EmotionMcpPolicy>={
  claude:{provider:"claude",path:"/mcp",source:"mcp",allowAnonymous:true,profiles:{default:true,conversation:true,browser:false}},
  codex:{provider:"codex",path:"/mcp/codex",source:"mcp-codex",allowAnonymous:true,profiles:{default:true,conversation:true,browser:false}},
  deepseek:{provider:"deepseek",path:"/mcp/deepseek",source:"mcp-deepseek",allowAnonymous:false,profiles:{default:true,conversation:true,browser:false}},
  ollama:{provider:"ollama",path:"/mcp/ollama",source:"mcp-ollama",allowAnonymous:false,profiles:{default:true,conversation:true,browser:false}},
  antigravity:{provider:"antigravity",path:"/mcp/antigravity",source:"mcp-antigravity",allowAnonymous:false,profiles:{default:true,conversation:true,browser:false}},
  grok:{provider:"grok",path:"/mcp/grok",source:"mcp-grok",allowAnonymous:false,profiles:{default:true,conversation:true,browser:false}}
};

export const EMOTION_MCP_POLICIES=Object.freeze(Object.values(POLICIES));
export function emotionMcpPolicy(provider:EmotionMcpProvider){return POLICIES[provider];}
export function emotionMcpEnabled(provider:EmotionMcpProvider,profile:EmotionRuntimeProfile){return POLICIES[provider].profiles[profile];}
export function emotionMcpUrl(provider:EmotionMcpProvider,port:number){return`http://127.0.0.1:${port}${POLICIES[provider].path}`;}
export function validEmotionTaskId(provider:EmotionMcpProvider,value:unknown){const taskId=typeof value==="string"?value.trim():"";return/^[a-z]+:[a-zA-Z0-9:._-]{1,150}$/.test(taskId)&&taskId.startsWith(`${provider}:`)?taskId:"";}
export function validatedEmotionMcpUrl(provider:EmotionMcpProvider,value:unknown){
  const raw=typeof value==="string"?value.trim():"";
  try{const url=new URL(raw);return url.protocol==="http:"&&(url.hostname==="127.0.0.1"||url.hostname==="localhost")&&/^\d+$/.test(url.port)&&url.pathname===POLICIES[provider].path&&!url.search&&!url.hash?url.toString():"";}catch{return"";}
}
export function emotionMcpHeaders(provider:EmotionMcpProvider,taskId:unknown,sessionId?:unknown,profile?:EmotionRuntimeProfile){
  const task=validEmotionTaskId(provider,taskId),session=typeof sessionId==="string"&&/^[a-zA-Z0-9:._-]{1,100}$/.test(sessionId.trim())?sessionId.trim():"";
  return{...(task?{[EMOTION_MCP_TASK_HEADER]:task}:{}),...(session?{[EMOTION_MCP_SESSION_HEADER]:session}:{}),...(profile?{[EMOTION_MCP_PROFILE_HEADER]:profile}:{})};
}
export function emotionMcpEnvironment(provider:EmotionMcpProvider,port:number,taskId:string,sessionId:string|undefined,profile:EmotionRuntimeProfile){
  if(!emotionMcpEnabled(provider,profile))return{};
  const validTask=validEmotionTaskId(provider,taskId);
  if(!validTask)return{};
  return{CLAUDEX_WORKHOUSE_EMOTION_MCP_URL:emotionMcpUrl(provider,port),CLAUDEX_WORKHOUSE_CURRENT_TASK_ID:validTask,...(sessionId?{CLAUDEX_WORKHOUSE_CURRENT_SESSION_ID:sessionId}:{})};
}

export const CONVERSATION_EMOTION_INSTRUCTION=[
  "[MCP avatar emotion mode]",
  "Finish composing the answer, then immediately before emitting the final answer call set_emotion exactly once.",
  "Choose the dominant emotion expressed by your own answer, never the user's emotion or an emotion found only in quoted text. Use neutral when no emotion is clearly expressed. Use chu for an explicitly performed kiss such as 뽀뽀쪽.",
  "Update only the floating avatar. Do not call express_emotion, do not insert image markdown, and do not mention the tool call, its result, or tool usage in the answer body.",
  "[End MCP avatar emotion mode]"
].join("\n");
