import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {StreamSpool} from "./stream-events.js";
import {sanitizeSensitiveText,sanitizeSensitiveValue} from "./sensitive-data.js";
import {beginWorkerEmotion,updateWorkerEmotion} from "./worker-emotion.js";
import {normalizeAntigravityExecutionSettings} from "./antigravity-execution-settings.js";
import {streamVertexContent,vertexFunctionCallPart,type VertexContent,type VertexFunctionCall,type VertexFunctionDeclaration,type VertexGrounding,type VertexUsage} from "./vertex-ai.js";
import {delegationDeveloperInstructions,normalizeDelegationSettings} from "./delegation-settings.js";
import {normalizeVertexGoogleSearchMode,normalizeVertexSessionContents,vertexSystemInstruction,vertexTurnToolSelection} from "./vertex-prompt.js";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StreamableHTTPClientTransport} from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const [,,statePath,taskId,mode,cwd,marker,model="gemini-2.5-flash",sessionId="",sourceSessionId="",settingsJson="",searchModeArg="off",...promptParts]=process.argv;
const prompt=promptParts.join(" "),googleSearchMode=normalizeVertexGoogleSearchMode(searchModeArg),root=String(process.env.CLAUDEX_WORKHOUSE_DATA_ROOT??""),startedAt=new Date().toISOString(),spool=new StreamSpool(root,taskId,"antigravity"),settings=normalizeAntigravityExecutionSettings(JSON.parse(settingsJson));
const procStart=(pid:number)=>{try{return fs.readFileSync(`/proc/${pid}/stat`,"utf8").split(" ")[21]??null;}catch{return null;}};
const state:any={marker,pid:process.pid,pgid:process.pid,processStart:procStart(process.pid),sessionId,status:"running",startedAt,updatedAt:startedAt,result:null,error:null,log:"",model,modelBackend:"vertex-api",googleSearchMode,activity:"thinking"};
const atomicWrite=()=>{const temp=`${statePath}.${process.pid}.tmp`;fs.writeFileSync(temp,`${JSON.stringify(sanitizeSensitiveValue(state,{preserveSourceIdentifiers:true}))}\n`,{encoding:"utf8",mode:0o600});fs.renameSync(temp,statePath);};
const sessionsDir=path.join(root,"data","antigravity-vertex-sessions"),safe=(value:string)=>crypto.createHash("sha256").update(value).digest("hex"),sessionFile=path.join(sessionsDir,`${safe(sessionId)}.json`),sourceFile=path.join(sessionsDir,`${safe(sourceSessionId||sessionId)}.json`);
const load=():VertexContent[]=>{try{const value=JSON.parse(fs.readFileSync(mode==="fork"?sourceFile:sessionFile,"utf8"));return normalizeVertexSessionContents(Array.isArray(value?.contents)?value.contents:[]);}catch{return[];}};
const persist=(contents:VertexContent[])=>{fs.mkdirSync(sessionsDir,{recursive:true,mode:0o700});const temp=`${sessionFile}.${process.pid}.tmp`;fs.writeFileSync(temp,`${JSON.stringify({version:1,sessionId,updatedAt:new Date().toISOString(),contents})}\n`,{mode:0o600});fs.renameSync(temp,sessionFile);};
let delegationSettings:unknown;try{delegationSettings=JSON.parse(String(process.env.CLAUDEX_WORKHOUSE_DELEGATION_SETTINGS??"null"));}catch{delegationSettings=null;}
const runtimeProfile=String(process.env.CLAUDEX_WORKHOUSE_RUNTIME_PROFILE??"default"),managedUrl=String(process.env.CLAUDEX_WORKHOUSE_MANAGED_PROVIDER_MCP_URL??"").trim(),managedToken=String(process.env.CLAUDEX_WORKHOUSE_MANAGED_PROVIDER_TOKEN??"").trim(),managedEnabled=runtimeProfile!=="conversation"&&/^http:\/\/(?:127\.0\.0\.1|localhost):\d+\/mcp\/claudex-workhouse$/.test(managedUrl)&&Boolean(managedToken&&taskId);
const toolSelection=vertexTurnToolSelection({prompt,managedEnabled,googleSearchMode,extensionTask:runtimeProfile==="browser"});
let managedDelegation=toolSelection.managedDelegation,googleSearchEnabled=toolSelection.googleSearchEnabled;
let extensionToolsEnabled=false;
const system=vertexSystemInstruction({model,cwd,currentDate:startedAt.slice(0,10),managedEnabled:managedDelegation,extensionToolsEnabled,googleSearchMode,googleSearchEnabled,delegationInstructions:delegationDeveloperInstructions(normalizeDelegationSettings(delegationSettings),"antigravity")});
const contents=load();contents.push({role:"user",parts:[{text:prompt}]});
let result="",usage:VertexUsage|null=null,settled=false,stopped=false,mcpClient:Client|null=null;const controller=new AbortController();atomicWrite();beginWorkerEmotion(root,"antigravity",prompt,sessionId);spool.append({type:"task_started",content:"Gemini Vertex worker started.",threadId:sessionId});spool.append({type:"turn_started",content:"Gemini Vertex turn started.",threadId:sessionId});updateWorkerEmotion(root,"antigravity","thinking",sessionId);
const fail=(error:unknown)=>{if(settled)return;settled=true;const message=stopped?"Gemini Vertex task stopped.":sanitizeSensitiveText(error instanceof Error?error.message:String(error));state.status=stopped?"stopped":"failed";state.error=message;state.activity=state.status;state.updatedAt=new Date().toISOString();atomicWrite();spool.append({type:stopped?"task_stopped":"task_failed",content:message,threadId:sessionId,terminal:true});updateWorkerEmotion(root,"antigravity",stopped?"neutral":"disappointed",sessionId);};
const stop=()=>{stopped=true;controller.abort();};process.once("SIGTERM",stop);process.once("SIGINT",stop);
try{
  let declarations:VertexFunctionDeclaration[]=[];
  if(managedDelegation){mcpClient=new Client({name:"claudex-workhouse-vertex-worker",version:"1.0.0"},{capabilities:{}});const transport=new StreamableHTTPClientTransport(new URL(managedUrl),{requestInit:{headers:{Authorization:`Bearer ${managedToken}`,"X-Claudex-Workhouse-Task-Id":taskId}}});await mcpClient.connect(transport);const listed=await mcpClient.listTools();declarations=listed.tools.filter(tool=>tool.name.startsWith("managed_provider_task_")).map(tool=>({name:tool.name,description:tool.description,parameters:(tool.inputSchema??{type:"object",properties:{}}) as Record<string,unknown>}));}
  let requestCount=0,totalUsage:VertexUsage={promptTokenCount:0,candidateTokenCount:0,totalTokenCount:0,cachedTokenCount:0,thoughtTokenCount:0};
  let grounding:VertexGrounding|null=null;
  for(let toolRound=0;toolRound<9;toolRound++){
    let turnText="";const calls:VertexFunctionCall[]=[];requestCount++;
    await streamVertexContent(settings,model,contents,chunk=>{if(chunk.text){turnText+=chunk.text;result+=chunk.text;state.log=result.slice(-262144);spool.append({type:"message_delta",content:chunk.text,threadId:sessionId});}for(const call of chunk.functionCalls)calls.push(call);if(chunk.usage){usage=chunk.usage;for(const key of Object.keys(totalUsage) as Array<keyof VertexUsage>)totalUsage[key]+=chunk.usage[key];}if(chunk.modelVersion)state.model=chunk.modelVersion;if(chunk.grounding)grounding=chunk.grounding;state.updatedAt=new Date().toISOString();atomicWrite();},controller.signal,declarations,system,googleSearchEnabled);
    const modelParts=[...(turnText?[{text:turnText}]:[]),...calls.map(vertexFunctionCallPart)];if(modelParts.length)contents.push({role:"model",parts:modelParts});
    if(!calls.length)break;if(!mcpClient)throw new Error("Vertex requested a managed provider function without an authenticated client.");if(toolRound===8)throw new Error("Vertex exceeded the managed provider tool-call limit.");
    const responses=[];for(const call of calls){if(!declarations.some(item=>item.name===call.name))throw new Error(`Vertex requested an unavailable function: ${call.name}`);spool.append({type:"tool_started",content:call.name,threadId:sessionId,toolName:call.name});const toolResult=await mcpClient.callTool({name:call.name,arguments:call.args},undefined,{timeout:135_000});const response=sanitizeSensitiveValue({content:toolResult.content,isError:toolResult.isError===true},{preserveSourceIdentifiers:true}) as Record<string,unknown>;responses.push({functionResponse:{name:call.name,response}});spool.append({type:"tool_completed",content:call.name,threadId:sessionId,toolName:call.name});}contents.push({role:"user",parts:responses});
  }
  if(!result.trim())throw new Error("Vertex AI completed without a text response.");
  persist(contents);const at=new Date().toISOString(),finalUsage=requestCount>1?totalUsage:usage as VertexUsage|null;if(finalUsage){state.outputUsage={totalTokens:finalUsage.totalTokenCount,inputTokens:finalUsage.promptTokenCount,cachedInputTokens:finalUsage.cachedTokenCount,cacheWriteInputTokens:null,outputTokens:finalUsage.candidateTokenCount+finalUsage.thoughtTokenCount,reasoningTokens:finalUsage.thoughtTokenCount,requestCount,updatedAt:at};state.contextUsage={usedTokens:finalUsage.promptTokenCount,windowTokens:1_000_000,percent:Math.round(finalUsage.promptTokenCount/1_000_000*1000)/10,updatedAt:at};}state.status="completed";state.result=result;state.activity="completed";state.grounding=grounding;state.updatedAt=at;settled=true;atomicWrite();spool.append({type:"message_completed",content:result,threadId:sessionId,metadata:{role:"agent",phase:"final_answer",...(grounding?{grounding}:{})}});spool.append({type:"task_completed",content:"Gemini Vertex task completed.",threadId:sessionId,terminal:true});updateWorkerEmotion(root,"antigravity","done",sessionId);
}catch(error){fail(error);}finally{await mcpClient?.close().catch(()=>{});}
