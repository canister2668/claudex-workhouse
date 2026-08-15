import fs from "node:fs";
import path from "node:path";
import type {AppConfig} from "./config.js";
import{usesVertexCredentials,type AntigravityBackend,type AntigravityExecutionSettings}from"./antigravity-execution-settings.js";
import {EXTERNAL_MCP_BUNDLE_ENV,externalMcpForAntigravity,readExternalMcpBundle}from"./external-mcp-bundle.js";
import{EMOTION_MCP_PROFILE_HEADER,EMOTION_MCP_SERVER_ID,EMOTION_MCP_TASK_HEADER,emotionMcpUrl,type EmotionRuntimeProfile}from"./emotion-mcp-policy.js";

function executable(file:string){try{fs.accessSync(file,fs.constants.X_OK);return true;}catch{return false;}}

export function antigravityBinary(config:Pick<AppConfig,"root"|"dataRoot">){
  const configured=String(process.env.CLAUDEX_WORKHOUSE_ANTIGRAVITY_BINARY??"").trim();
  if(configured){
    if(path.isAbsolute(configured))return configured;
    for(const directory of String(process.env.PATH??"").split(path.delimiter)){const candidate=path.join(directory,configured);if(executable(candidate))return candidate;}
    return configured;
  }
  const managed=path.join(config.dataRoot??config.root,"runtime","bin",process.platform==="win32"?"agy.exe":"agy");
  return executable(managed)?managed:"agy";
}

function homeDirectoryName(backend:AntigravityBackend){
  // The Gemini CLI reads `~/.gemini` just like the Antigravity CLI does, so it
  // gets its own home. Sharing one would let Antigravity's OAuth session and
  // runtime config leak into a run that must authenticate with Vertex only.
  if(backend==="vertex-agent")return"gemini-cli-home";
  return backend==="vertex"?"antigravity-vertex-home":"antigravity-home";
}

export function antigravityHome(config:Pick<AppConfig,"dataDir">,backend:AntigravityBackend="consumer"){
  const directory=path.join(config.dataDir,"provider-auth",homeDirectoryName(backend));
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  try{fs.chmodSync(directory,0o700);}catch{}
  return directory;
}

/**
 * The service-account key stays where the Vertex settings put it, under the
 * Vertex home. Only the CLI's own state directory differs per backend.
 */
export function geminiCliHome(config:Pick<AppConfig,"dataDir">){return antigravityHome(config,"vertex-agent");}

function executionEnvironment(settings?:AntigravityExecutionSettings){
  if(!settings||!usesVertexCredentials(settings.backend))return{};
  return{GOOGLE_CLOUD_PROJECT:settings.vertex.projectId,GOOGLE_CLOUD_LOCATION:settings.vertex.location,GOOGLE_GENAI_USE_VERTEXAI:"true",...(settings.vertex.credentialsPath?{GOOGLE_APPLICATION_CREDENTIALS:settings.vertex.credentialsPath}:{})};
}

function providerBaseEnvironment(){
  const{CLAUDEX_WORKHOUSE_CURRENT_TASK_ID:_inheritedTaskId,CLAUDEX_WORKHOUSE_MANAGED_PROVIDER_MCP_URL:_inheritedManagedUrl,CLAUDEX_WORKHOUSE_MANAGED_PROVIDER_TOKEN:_inheritedManagedToken,CLAUDEX_WORKHOUSE_EXTERNAL_MCP_BUNDLE_FILE:_inheritedExternalBundle,...base}=process.env;
  return base;
}

export function antigravityEnvironment(config:Pick<AppConfig,"dataDir">,settings?:AntigravityExecutionSettings):NodeJS.ProcessEnv{
  const home=antigravityHome(config,settings?.backend);
  return{...providerBaseEnvironment(),...executionEnvironment(settings),HOME:home,...(process.platform==="win32"?{USERPROFILE:home}:{}),AGY_CLI_DISABLE_AUTO_UPDATE:"true",NO_COLOR:"1"};
}

/**
 * The Gemini CLI keeps its resumable sessions under `$HOME/.gemini/tmp`, so the
 * home has to be the same stable directory on every turn — a per-task home
 * would make every resume start an empty conversation. Trust is granted here
 * rather than per run: Workhouse already decided the workspace is in scope.
 */
export function geminiCliEnvironment(config:Pick<AppConfig,"dataDir">,settings:AntigravityExecutionSettings):NodeJS.ProcessEnv{
  const home=geminiCliHome(config);
  return{
    ...providerBaseEnvironment(),
    ...executionEnvironment(settings),
    HOME:home,
    ...(process.platform==="win32"?{USERPROFILE:home}:{}),
    GEMINI_CLI_TRUST_WORKSPACE:"true",
    NO_COLOR:"1",
    TERM:"dumb"
  };
}

function copyDirectoryContents(source:string,target:string,exclude=new Set<string>()){
  if(!fs.existsSync(source))return;
  fs.mkdirSync(target,{recursive:true,mode:0o700});
  for(const entry of fs.readdirSync(source,{withFileTypes:true})){
    if(exclude.has(entry.name))continue;
    fs.cpSync(path.join(source,entry.name),path.join(target,entry.name),{recursive:true,force:true});
  }
}

/** Keep persistent OAuth data while giving every worker an immutable task-scoped MCP header. */
export function antigravityTaskEnvironment(config:Pick<AppConfig,"dataDir">,taskDirectory:string,port:number,taskId:string,settings?:AntigravityExecutionSettings,managedProviderToken?:string,externalMcpBundleFile?:string,runtimeProfile:EmotionRuntimeProfile="default"):NodeJS.ProcessEnv{
  const backend=settings?.backend??"consumer",sharedHome=antigravityHome(config,backend),taskHome=path.join(taskDirectory,homeDirectoryName(backend)),sharedGemini=path.join(sharedHome,".gemini"),taskGemini=path.join(taskHome,".gemini");
  fs.mkdirSync(taskGemini,{recursive:true,mode:0o700});
  const sharedRuntime=path.join(sharedGemini,"antigravity-cli"),taskRuntime=path.join(taskGemini,"antigravity-cli");
  if(fs.existsSync(sharedRuntime)&&!fs.existsSync(taskRuntime))fs.symlinkSync(sharedRuntime,taskRuntime,process.platform==="win32"?"junction":"dir");
  const sharedConfig=path.join(sharedGemini,"config"),taskConfig=path.join(taskGemini,"config");
  copyDirectoryContents(sharedConfig,taskConfig,new Set(["mcp_config.json"]));
  let mcp:any={};try{mcp=JSON.parse(fs.readFileSync(path.join(sharedConfig,"mcp_config.json"),"utf8"));}catch{}
  const mcpServers=mcp?.mcpServers&&typeof mcp.mcpServers==="object"?mcp.mcpServers:{};
  const externalBundle=readExternalMcpBundle(externalMcpBundleFile,taskId),external=externalBundle?externalMcpForAntigravity(externalBundle):{mcpServers:{},environment:{}};
  const emotionServer={[EMOTION_MCP_SERVER_ID]:{url:emotionMcpUrl("antigravity",port),headers:{[EMOTION_MCP_TASK_HEADER]:taskId,[EMOTION_MCP_PROFILE_HEADER]:runtimeProfile}}};
  const profileServers=runtimeProfile==="browser"?{}:runtimeProfile==="conversation"?emotionServer:{...mcpServers,...external.mcpServers,...emotionServer,...(managedProviderToken?{"claudex-workhouse":{url:`http://127.0.0.1:${port}/mcp/claudex-workhouse`,headers:{Authorization:"Bearer ${CLAUDEX_WORKHOUSE_MANAGED_PROVIDER_TOKEN}",[EMOTION_MCP_TASK_HEADER]:"${CLAUDEX_WORKHOUSE_CURRENT_TASK_ID}"}}}:{})};
  const scoped={...mcp,mcpServers:profileServers};
  fs.mkdirSync(taskConfig,{recursive:true,mode:0o700});
  fs.writeFileSync(path.join(taskConfig,"mcp_config.json"),`${JSON.stringify(scoped,null,2)}\n`,{encoding:"utf8",mode:0o600});
  return{...providerBaseEnvironment(),...executionEnvironment(settings),...(runtimeProfile==="default"?external.environment:{}),HOME:taskHome,...(process.platform==="win32"?{USERPROFILE:taskHome}:{}),AGY_CLI_DISABLE_AUTO_UPDATE:"true",NO_COLOR:"1",...(runtimeProfile==="default"&&managedProviderToken?{CLAUDEX_WORKHOUSE_MANAGED_PROVIDER_MCP_URL:`http://127.0.0.1:${port}/mcp/claudex-workhouse`,CLAUDEX_WORKHOUSE_MANAGED_PROVIDER_TOKEN:managedProviderToken}:{}),...(runtimeProfile==="default"&&externalMcpBundleFile?{[EXTERNAL_MCP_BUNDLE_ENV]:externalMcpBundleFile}:{})};
}
