import {executionPolicyTurnInstructions,type AutomationLevel} from "./automation-level.js";
import{CONVERSATION_EMOTION_INSTRUCTION,EMOTION_MCP_SERVER_ID,EMOTION_MCP_TOOL_NAME}from"./emotion-mcp-policy.js";

export function antigravityTurnPrompt(prompt:string,cwd:string,level:AutomationLevel,runtimeProfile:"default"|"conversation"="default",emotionMcp=false){
  if(runtimeProfile==="conversation")return`# Claudex Workhouse conversation turn
This is a chat-only model conversation. Reply directly to the supplied conversation prompt.
Do not inspect, create, edit, or delete files. Do not run commands or use tools${emotionMcp?` except the ${EMOTION_MCP_SERVER_ID} ${EMOTION_MCP_TOOL_NAME} tool`:""}. Do not turn a story, roleplay, reaction, or discussion request into implementation work.
${emotionMcp?`${CONVERSATION_EMOTION_INSTRUCTION}\n`:""}

# Current conversation prompt
${prompt}`;
  return`${executionPolicyTurnInstructions("antigravity",level,cwd)}\n\n# Current user request\n${prompt}`;
}
