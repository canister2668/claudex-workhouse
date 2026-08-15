import type {VertexContent} from "./vertex-ai.js";

const LEGACY_PREFIX="You are the Vertex API mode of Gemini inside Claudex Workhouse.";
const USER_PROMPT_MARKER="\n\n# Current user prompt\n";
export type VertexGoogleSearchMode="off"|"auto"|"always";

export function normalizeVertexGoogleSearchMode(value:unknown):VertexGoogleSearchMode{
  return value==="auto"||value==="always"?value:"off";
}

export function vertexTurnToolSelection(input:{prompt:string;managedEnabled:boolean;googleSearchMode:unknown;extensionTask?:boolean}){
  const managedDelegation=!input.extensionTask&&input.managedEnabled&&requestsManagedProviderDelegation(input.prompt);
  return{managedDelegation,extensionToolsEnabled:false,googleSearchEnabled:!managedDelegation&&normalizeVertexGoogleSearchMode(input.googleSearchMode)!=="off"};
}

export function vertexSystemInstruction(input:{model:string;cwd:string;currentDate:string;managedEnabled:boolean;extensionToolsEnabled?:boolean;googleSearchMode:unknown;googleSearchEnabled:boolean;delegationInstructions:string}){
  const searchMode=normalizeVertexGoogleSearchMode(input.googleSearchMode),searchInstruction=!input.googleSearchEnabled
    ?searchMode==="off"?"Google Search grounding is disabled by this session's setting.":"Google Search grounding is unavailable in this turn because managed-provider function calling was selected."
    :searchMode==="always"?"Google Search grounding is required for this turn. Search before answering and rely on the returned grounding.":"Google Search grounding is available for current public-web facts. Use it when the question depends on current or uncertain information, and rely on the returned grounding instead of stale training knowledge.";
  let toolInstruction=input.managedEnabled?"You may use the supplied managed-provider functions only to create, inspect, wait for, or resume separate Claudex Workhouse provider tasks when the user explicitly requests named-provider delegation.":"If the user requests repository work, explain that Antigravity mode is required and provide useful guidance only.";
  return`${LEGACY_PREFIX} Reply directly and accurately.

Runtime identity (authoritative): the selected Vertex model identifier for this request is ${input.model}. If asked which model you are, state this identifier exactly. Do not deny that this model exists based on training knowledge or replace it with an older model lineup. Current date: ${input.currentDate}.

You do not have filesystem, shell, or coding-agent tools in this mode. ${searchInstruction} Never claim that you inspected, changed, tested, committed, or executed anything unless a supplied function result directly proves that action. ${toolInstruction} Current workspace label: ${input.cwd}

${input.delegationInstructions}`;
}

export function requestsManagedProviderDelegation(prompt:string){
  const provider=/(?:\bcodex\b|\bclaude(?:\s+code)?\b|\bdeepseek\b|\bollama\b|\bantigravity\b|\bgemini\b|\bgrok\b|코덱스|클로드|클코드|딥시크|올라마|안티그래비티|제미나이|그록)/i;
  const delegation=/(?:\bdelegate\b|\bask\b|\bassign\b|\breview\b|\bbackground\b|\bmanaged\s+(?:task|session)\b|에게|한테|보고|시켜|맡겨|넘겨|요청|검토|리뷰|별도\s*세션|백그라운드|작업\s*(?:생성|만들))/i;
  return provider.test(prompt)&&delegation.test(prompt);
}

export function normalizeVertexSessionContents(contents:VertexContent[]){
  return contents.map(content=>{
    if(content.role!=="user"||content.parts.length!==1)return content;
    const text=content.parts[0]?.text;if(typeof text!=="string"||!text.startsWith(LEGACY_PREFIX))return content;
    const marker=text.indexOf(USER_PROMPT_MARKER);if(marker<0)return content;
    return{...content,parts:[{text:text.slice(marker+USER_PROMPT_MARKER.length)}]};
  });
}
