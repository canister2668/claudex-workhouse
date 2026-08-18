import fs from"node:fs";
import crypto from"node:crypto";
import os from"node:os";
import path from"node:path";
import{EMOTION_MCP_PROFILE_HEADER,EMOTION_MCP_SERVER_ID,EMOTION_MCP_TASK_HEADER,emotionMcpUrl,validEmotionTaskId,type EmotionRuntimeProfile}from"./emotion-mcp-policy.js";

const PRESERVED_DIRECTORIES=["agents","hooks","personas","plugins","roles","skills"];
const PRIVATE_FILES=["auth.json","mcp_credentials.json","agent_id"];
const TASK_HOME_MARKER=".claudex-workhouse-grok-task-home";

// A service restarted from inside a Grok task inherits that task's GROK_HOME.
// Treating a per-task home as the shared one links nothing back to the real
// sessions directory, so every later resume falls through to a remote restore
// that 404s. Never accept a task home as the shared home.
function isTaskHome(candidate:string){
  return fs.existsSync(path.join(candidate,TASK_HOME_MARKER))||path.basename(candidate)==="grok-home";
}

function sharedGrokHome(binary:string){
  const configured=String(process.env.CLAUDEX_WORKHOUSE_GROK_HOME??process.env.GROK_HOME??"").trim();
  if(configured&&path.isAbsolute(configured)&&!isTaskHome(configured))return configured;
  const parent=path.dirname(binary),bundled=path.basename(parent)==="bin"?path.dirname(parent):"";
  if(bundled&&fs.existsSync(bundled))return bundled;
  return path.join(os.homedir(),".grok");
}

function removeProviderSections(source:string,isolated:boolean){
  const lines=source.split(/\r?\n/),kept:string[]=[];let omit=false;
  for(const line of lines){
    const section=line.match(/^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(?:#.*)?$/)?.[1]?.trim()??"";
    if(section){
      const mcp=section==="mcp_servers"||section.startsWith("mcp_servers."),managed=section===`mcp_servers.${EMOTION_MCP_SERVER_ID}`||section.startsWith(`mcp_servers.${EMOTION_MCP_SERVER_ID}.`),plugin=section==="plugins"||section.startsWith("plugins.")||section==="marketplace"||section.startsWith("marketplace.");
      omit=mcp?isolated||managed:isolated&&plugin;
    }
    if(!omit)kept.push(line);
  }
  return kept.join("\n").trimEnd();
}

function safeLinkDirectory(sharedHome:string,taskHome:string,name:string){
  const source=path.join(sharedHome,name);if(!fs.existsSync(source)||!fs.statSync(source).isDirectory())return;
  const sharedReal=fs.realpathSync(sharedHome),sourceReal=fs.realpathSync(source);
  if(sourceReal!==sharedReal&&!sourceReal.startsWith(`${sharedReal}${path.sep}`))return;
  const target=path.join(taskHome,name);if(fs.existsSync(target)){if(fs.realpathSync(target)===sourceReal)return;throw new Error(`Grok task home entry already exists: ${name}`);}
  fs.symlinkSync(source,target,process.platform==="win32"?"junction":"dir");
}

function copyPrivateFile(sharedHome:string,taskHome:string,name:string){
  const source=path.join(sharedHome,name);if(!fs.existsSync(source)||!fs.statSync(source).isFile())return;
  const target=path.join(taskHome,name);fs.copyFileSync(source,target);fs.chmodSync(target,0o600);
}

export function grokTaskEnvironment(binary:string,taskDirectory:string,port:number,taskId:string,runtimeProfile:EmotionRuntimeProfile):NodeJS.ProcessEnv{
  const validTask=validEmotionTaskId("grok",taskId);if(!validTask)throw new Error("A valid Grok task ID is required for the task environment.");
  const sharedHome=sharedGrokHome(binary),taskHome=path.join(taskDirectory,"grok-home");
  fs.mkdirSync(taskHome,{recursive:true,mode:0o700});fs.chmodSync(taskHome,0o700);
  fs.writeFileSync(path.join(taskHome,TASK_HOME_MARKER),"",{encoding:"utf8",mode:0o600});
  for(const name of PRIVATE_FILES)copyPrivateFile(sharedHome,taskHome,name);
  for(const name of [...PRESERVED_DIRECTORIES,"sessions"])safeLinkDirectory(sharedHome,taskHome,name);
  let source="";try{source=fs.readFileSync(path.join(sharedHome,"config.toml"),"utf8");}catch{}
  const stripped=removeProviderSections(source,runtimeProfile!=="default"),emotion=runtimeProfile==="browser"?"":`[mcp_servers.${EMOTION_MCP_SERVER_ID}]\nurl = ${JSON.stringify(emotionMcpUrl("grok",port))}\nheaders = { ${JSON.stringify(EMOTION_MCP_TASK_HEADER)} = ${JSON.stringify(validTask)}, ${JSON.stringify(EMOTION_MCP_PROFILE_HEADER)} = ${JSON.stringify(runtimeProfile)} }\nenabled = true`;
  fs.writeFileSync(path.join(taskHome,"config.toml"),`${[stripped,emotion].filter(Boolean).join("\n\n")}\n`,{encoding:"utf8",mode:0o600});
  let isolatedCwd="";if(runtimeProfile!=="default"){const isolationRoot=process.platform==="win32"?taskHome:"/tmp";isolatedCwd=path.join(isolationRoot,`claudex-workhouse-grok-${crypto.createHash("sha256").update(taskHome).digest("hex").slice(0,16)}`);fs.mkdirSync(isolatedCwd,{recursive:true,mode:0o700});try{fs.chmodSync(isolatedCwd,0o700);}catch{}}
  return{GROK_HOME:taskHome,GROK_AUTO_UPDATE:"0",...(isolatedCwd?{CLAUDEX_WORKHOUSE_GROK_ISOLATED_CWD:isolatedCwd,GROK_CLAUDE_MCPS_ENABLED:"0",GROK_CURSOR_MCPS_ENABLED:"0"}:{})};
}
