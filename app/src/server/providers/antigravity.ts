import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {spawn} from "node:child_process";
import type {AppConfig} from "../config.js";
import {DeckDatabase} from "../db/client.js";
import {automationLevel} from "../automation-level.js";
import {runCommand,stripAnsi} from "../process.js";
import {ProviderTaskSnapshotCache} from "../provider-task-snapshot.js";
import {ensureTaskTempDirectory} from "../workspace-temp.js";
import type {AgentProvider,CreateTaskInput,DeckTask,ProjectConfig,UnifiedStatus} from "../types.js";
import {antigravityFinalResponse,parseAntigravityModels} from "../antigravity-runtime.js";
import {antigravityBinary,antigravityEnvironment,antigravityTaskEnvironment,geminiCliEnvironment} from "../antigravity-environment.js";
import {geminiCliInstalledVersion,resolveGeminiCliEntry,ripgrepAvailable} from "../gemini-cli-runtime.js";
import{antigravityExecutionKey,normalizeAntigravityExecutionSettings,usesVertexCredentials,type AntigravityExecutionSettings}from"../antigravity-execution-settings.js";
import{listVertexModels,VERTEX_FALLBACK_MODELS}from"../vertex-ai.js";
import{normalizeVertexGoogleSearchMode}from"../vertex-prompt.js";
import{seedTaskEmotion}from"../task-emotion-seed.js";
import{workspaceInstructionFollowUpMetadata}from"../workspace-instructions.js";
import{prepareExternalMcpEnvironment}from"../external-mcp-runtime.js";
import{EXTERNAL_MCP_BUNDLE_ENV}from"../external-mcp-bundle.js";
import{RuntimeModelCatalog,type RuntimeModelCatalogSnapshot}from"../runtime-model-catalog.js";

const now=()=>new Date().toISOString();
const active=(status:string)=>["pending","queued","running","waiting","unknown"].includes(status);
export type AntigravityModel={id:string;displayName:string;source:"runtime"};

export class AntigravityProvider implements AgentProvider{
  readonly id="antigravity" as const;
  readonly capabilities={supportsMcpEvents:false,supportsEmotionRendering:true} as const;
  private readonly stateDir:string;
  private readonly snapshot:ProviderTaskSnapshotCache;
  private readonly signatures=new Map<string,string>();
  private modelCatalog=new Map<string,RuntimeModelCatalog<AntigravityModel>>();
  constructor(private config:AppConfig,private db:DeckDatabase){this.stateDir=path.join(config.dataDir,"antigravity-jobs");fs.mkdirSync(this.stateDir,{recursive:true,mode:0o700});this.snapshot=new ProviderTaskSnapshotCache(db,this.id);}
  private stateFile(id:string){return path.join(this.stateDir,`${id.replaceAll(":","_")}.json`);}
  warmTaskSnapshot(tasks:DeckTask[]){this.snapshot.prime(tasks.filter(task=>task.provider===this.id));}
  private async refresh(task:DeckTask){
    let stat:fs.Stats;try{stat=fs.statSync(this.stateFile(task.id));}catch{return task;}const signature=`${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}`;if(this.signatures.get(task.id)===signature&&!active(task.status))return task;this.signatures.set(task.id,signature);
    let state:any;try{state=JSON.parse(fs.readFileSync(this.stateFile(task.id),"utf8"));}catch{return task;}
    const rawResult=state.result??task.result,normalizedResult=antigravityFinalResponse(state.result??"")||rawResult;
    const merged:DeckTask={...task,threadId:state.sessionId??task.threadId,providerSessionId:state.sessionId??task.providerSessionId,status:(state.status??task.status) as UnifiedStatus,updatedAt:state.updatedAt??task.updatedAt,result:normalizedResult,error:state.error??null,log:stripAnsi(state.log??task.log),pid:state.pid??task.pid,pgid:state.pgid??task.pgid,processStart:state.processStart??task.processStart,effectiveModel:state.model??task.effectiveModel,metadata:{...task.metadata,activity:state.activity??task.metadata?.activity,outputUsage:state.outputUsage??task.metadata?.outputUsage,conversationUsage:state.conversationUsage??task.metadata?.conversationUsage,contextUsage:state.contextUsage??task.metadata?.contextUsage,grounding:state.grounding??task.metadata?.grounding,modelUsage:state.modelUsage??task.metadata?.modelUsage,approvalMode:state.approvalMode??task.metadata?.approvalMode,googleSearchMode:normalizeVertexGoogleSearchMode(state.googleSearchMode??task.metadata?.googleSearchMode)}};
    if(active(merged.status)&&!this.processMatches(merged)){merged.status="stopped";merged.metadata={...merged.metadata,interruptionCause:"worker-process-lost",interruptionDetectedAt:now()};}
    if(JSON.stringify(merged)===JSON.stringify(task))return task;const saved=await this.db.upsertTask(merged);this.snapshot.applyAll([saved]);return saved;
  }
  async listTasks(){const stored=await this.snapshot.load().catch(()=>this.snapshot.current()),rows=await Promise.all(stored.map(task=>this.refresh(task)));this.snapshot.applyAll(rows);return rows;}
  getTask(task:DeckTask){return this.refresh(task);}
  private sessionProject(task:DeckTask):ProjectConfig{const project=this.config.projects.find(item=>item.id===task.projectId);if(project)return project;if(task.cwd)try{if(fs.statSync(task.cwd).isDirectory())return{id:task.projectId,name:task.cwd,path:task.cwd,realPath:task.cwd,enabled:true,error:null};}catch{}throw Object.assign(new Error("Session working directory is unavailable."),{statusCode:404});}
  private model(value:string|null|undefined){const model=String(value??process.env.CLAUDEX_WORKHOUSE_ANTIGRAVITY_DEFAULT_MODEL??"").trim();if(!model)throw Object.assign(new Error("Select a Gemini model from the runtime catalog."),{statusCode:400});if(model.length>120||/[\r\n\0]/.test(model))throw Object.assign(new Error("Invalid Gemini model."),{statusCode:400});return model;}
  private effort(value:string|null|undefined){const effort=String(value??"default").trim()||"default";if(!["default","low","medium","high"].includes(effort))throw Object.assign(new Error("Gemini effort must be default, low, medium, or high."),{statusCode:400,code:"ANTIGRAVITY_EFFORT_UNSUPPORTED"});return effort;}
  private async executionSettings(){return normalizeAntigravityExecutionSettings((await this.db.getSystemSetting("antigravity.execution").catch(()=>null))?.value);}
  private taskExecution(task:DeckTask){return normalizeAntigravityExecutionSettings(task.metadata?.antigravityExecution);}
  private async launch(input:CreateTaskInput,mode:"new"|"resume"|"fork",sourceSessionId:string|null,parentThreadId:string|null,pinnedExecution?:AntigravityExecutionSettings){
    if(input.executionHostId&&input.executionHostId!=="local")throw Object.assign(new Error("Gemini currently runs on the local Workhouse host only."),{statusCode:409,code:"REMOTE_PROVIDER_UNAVAILABLE"});
    const execution=pinnedExecution??await this.executionSettings(),model=this.model(input.model),effort=this.effort(input.reasoningEffort),profile=input.permissionProfile===":danger-full-access"?":danger-full-access":input.permissionProfile===":workspace-write"?":workspace-write":":read-only",level=automationLevel(input.automationLevel,profile),runtimeProfile=input.runtimeProfile??"default",googleSearchMode=normalizeVertexGoogleSearchMode(input.googleSearchMode),nativeId=input.requestedNativeId??crypto.randomUUID(),id=`antigravity:${nativeId}`,createdAt=now(),workspaceId=input.workspaceId??input.project.id,taskTempDir=ensureTaskTempDirectory(this.config.tempDir,workspaceId,this.id,id),marker=`claudex-workhouse-antigravity:${nativeId}`,backend=execution.backend,vertex=backend==="vertex",vertexAgent=backend==="vertex-agent";
    // Gemini CLI accepts the session UUID up front, so a vertex-agent thread is
    // identified by the same native id Workhouse already issued. A fork is the
    // one case where the CLI assigns the id: it refuses --session-file together
    // with --session-id, so the worker reads it back from the init event.
    const assignedSessionId=vertexAgent
      ?(mode==="new"?nativeId:mode==="resume"?sourceSessionId:null)
      :vertex?(mode==="resume"?sourceSessionId:`vertex:${crypto.randomUUID()}`)
      :(mode==="new"?null:sourceSessionId);
    const workerLabel=vertexAgent?"Gemini CLI (Vertex Agent)":vertex?"Gemini Vertex":"Gemini Antigravity",modelBackend=vertexAgent?"gemini-cli-vertex":vertex?"vertex-api":"antigravity-cli";
    const managedProviderToken=runtimeProfile==="conversation"||vertexAgent?undefined:crypto.randomBytes(32).toString("base64url"),managedProviderCapabilityHash=managedProviderToken?crypto.createHash("sha256").update(managedProviderToken).digest("hex"):null,delegationSettings=(await this.db.getSystemSetting("delegation.launch-modes").catch(()=>null))?.value??null;
    if(vertexAgent&&runtimeProfile!=="default")throw Object.assign(new Error("The Gemini CLI backend runs coding tasks only. Switch to Antigravity or Vertex API for conversation and browser profiles."),{statusCode:409,code:"GEMINI_CLI_PROFILE_UNSUPPORTED"});
    let task:DeckTask={id,provider:this.id,nativeId,threadId:assignedSessionId,providerSessionId:assignedSessionId,projectId:input.project.id,cwd:input.project.realPath,title:input.title??input.prompt.replace(/\s+/g," ").slice(0,80),prompt:input.prompt,status:"pending",createdAt,updatedAt:createdAt,result:null,error:null,log:`${workerLabel} worker starting.`,owned:true,pid:null,pgid:null,processStart:null,commandMarker:marker,parentThreadId,permissionProfile:profile,requestedModel:model,requestedReasoningEffort:effort==="default"?null:effort,settingsUpdatedAt:createdAt,executionHostId:"local",workspaceId:input.workspaceId??null,workChainId:input.workChainId??null,metadata:{...(input.boardRole?{boardRole:input.boardRole}:{}),workMode:input.workMode??"default",runtimeProfile,automationLevel:level,modelBackend,googleSearchMode,antigravityExecution:execution,...(managedProviderCapabilityHash?{managedProviderCapabilityHash}:{}),tempDirectory:taskTempDir}};
    task=await this.db.upsertTask(task);this.snapshot.applyAll([task]);const appRoot=this.config.appRoot??this.config.root,dataRoot=this.config.dataRoot??this.config.root;
    const externalMcp=await prepareExternalMcpEnvironment({db:this.db,taskTempDir,taskId:id,provider:"antigravity",runtimeProfile,port:this.config.port});
    const providerPrompt=[input.prompt,externalMcp.promptSuffix].filter(Boolean).join("\n\n");
    const worker=(runner:string)=>path.join(appRoot,"app","dist-server",runner);
    const stateFile=this.stateFile(id),workspacePath=input.project.realPath;

    let workerArgs:string[];
    let workerEnvironment:NodeJS.ProcessEnv;
    if(vertexAgent){
      const entry=resolveGeminiCliEntry(dataRoot);
      if(!entry)throw Object.assign(new Error("The Gemini CLI is not installed for this Workhouse runtime. Install it with scripts/install-gemini-cli.mjs."),{statusCode:409,code:"GEMINI_CLI_UNAVAILABLE"});
      workerArgs=[worker("gemini-cli-worker.js"),stateFile,id,entry.kind,entry.entry,mode,workspacePath,marker,profile,model,input.workMode??"default",assignedSessionId??"",sourceSessionId??"",providerPrompt];
      workerEnvironment=geminiCliEnvironment(this.config,execution);
    }else if(vertex){
      workerArgs=[worker("vertex-worker.js"),stateFile,id,mode,workspacePath,marker,model,assignedSessionId??"",sourceSessionId??"",JSON.stringify(execution),googleSearchMode,providerPrompt];
      workerEnvironment=antigravityTaskEnvironment(this.config,taskTempDir,this.config.port,id,execution,managedProviderToken,externalMcp.environment[EXTERNAL_MCP_BUNDLE_ENV],runtimeProfile);
    }else{
      workerArgs=[worker("antigravity-worker.js"),stateFile,id,antigravityBinary(this.config),mode,workspacePath,marker,profile,model,effort,execution.backend,runtimeProfile,sourceSessionId??"",providerPrompt];
      workerEnvironment=antigravityTaskEnvironment(this.config,taskTempDir,this.config.port,id,execution,managedProviderToken,externalMcp.environment[EXTERNAL_MCP_BUNDLE_ENV],runtimeProfile);
    }

    seedTaskEmotion(dataRoot,"antigravity",id,assignedSessionId);
    if(Object.keys(externalMcp.metadata).length){task=await this.db.upsertTask({...task,metadata:{...task.metadata,...externalMcp.metadata}});this.snapshot.applyAll([task]);}
    const child=spawn(process.execPath,workerArgs,{cwd:workspacePath,detached:true,shell:false,windowsHide:true,stdio:"ignore",env:{...workerEnvironment,CLAUDEX_WORKHOUSE_DATA_ROOT:dataRoot,CLAUDEX_WORKHOUSE_CURRENT_TASK_ID:id,CLAUDEX_WORKHOUSE_RUNTIME_PROFILE:runtimeProfile,CLAUDEX_WORKHOUSE_DELEGATION_SETTINGS:JSON.stringify(delegationSettings),TMPDIR:taskTempDir,TMP:taskTempDir,TEMP:taskTempDir}});child.unref();
    task=await this.db.upsertTask({...task,log:`${workerLabel} worker started.`,pid:child.pid??null,pgid:child.pid??null});this.snapshot.applyAll([task]);return task;
  }
  createTask(input:CreateTaskInput){return this.launch(input,"new",null,null);}
  async sendMessage(task:DeckTask,prompt:string){if(!task.threadId)throw new Error("A confirmed Gemini conversation ID is required.");const runtimeProfile=task.metadata?.runtimeProfile==="conversation"||task.metadata?.runtimeProfile==="browser"?task.metadata.runtimeProfile:"default",next=await this.launch({project:this.sessionProject(task),prompt,title:task.title,model:task.requestedModel,reasoningEffort:task.requestedReasoningEffort,permissionProfile:task.permissionProfile,workMode:task.metadata?.workMode==="plan"?"plan":"default",runtimeProfile,automationLevel:automationLevel(task.metadata?.automationLevel,task.permissionProfile),executionHostId:"local",workspaceId:task.workspaceId??null,googleSearchMode:normalizeVertexGoogleSearchMode(task.metadata?.googleSearchMode)},"resume",task.threadId,task.threadId,this.taskExecution(task));return this.db.upsertTask({...next,metadata:workspaceInstructionFollowUpMetadata(task.metadata,next.metadata)});}
  async compactThread(task:DeckTask){return this.sendMessage(task,"/compact");}
  async forkThread(task:DeckTask){if(!task.threadId)throw new Error("A confirmed Gemini conversation ID is required.");return this.launch({project:this.sessionProject(task),prompt:"Continue this branch from the inherited context.",title:task.title,model:task.requestedModel,reasoningEffort:task.requestedReasoningEffort,permissionProfile:task.permissionProfile,workMode:task.metadata?.workMode==="plan"?"plan":"default",automationLevel:automationLevel(task.metadata?.automationLevel,task.permissionProfile),executionHostId:"local",workspaceId:task.workspaceId??null,googleSearchMode:normalizeVertexGoogleSearchMode(task.metadata?.googleSearchMode)},"fork",task.threadId,task.threadId,this.taskExecution(task));}
  private processMatches(task:DeckTask){if(!task.pid||!task.pgid||!task.commandMarker||!task.processStart)return false;try{const stat=fs.readFileSync(`/proc/${task.pid}/stat`,"utf8").split(" "),cmd=fs.readFileSync(`/proc/${task.pid}/cmdline`,"utf8").replaceAll("\0"," ");return stat[21]===task.processStart&&Number(stat[4])===task.pgid&&(cmd.includes("antigravity-worker.js")||cmd.includes("vertex-worker.js")||cmd.includes("gemini-cli-worker.js"))&&cmd.includes(task.commandMarker);}catch{return false;}}
  async stopTask(task:DeckTask){task=await this.refresh(task);if(!this.processMatches(task))throw Object.assign(new Error("Worker process identity no longer matches the recorded task."),{statusCode:409});process.kill(-task.pgid!,"SIGTERM");for(let i=0;i<20;i++){await new Promise(resolve=>setTimeout(resolve,250));if(!this.processMatches(task))return this.db.upsertTask({...task,status:"stopped",updatedAt:now()});}if(this.processMatches(task))process.kill(-task.pgid!,"SIGKILL");return this.db.upsertTask({...task,status:"stopped",updatedAt:now()});}
  async deleteSession(_task:DeckTask):Promise<{threadId:string;deleted:boolean;deletedTasks:number}>{throw Object.assign(new Error("The Gemini Antigravity runtime does not provide a safe non-interactive conversation deletion command. Delete it from the agy conversation picker."),{statusCode:409,code:"PROVIDER_DELETE_UNSUPPORTED"});}
  private catalogFor(execution:AntigravityExecutionSettings){const key=antigravityExecutionKey(execution),existing=this.modelCatalog.get(key);if(existing)return existing;const cacheKey=crypto.createHash("sha256").update(key).digest("hex").slice(0,16),catalog=new RuntimeModelCatalog<AntigravityModel>(this.db,`antigravity-model-catalog:${cacheKey}`,usesVertexCredentials(execution.backend)?"vertex-api":"antigravity-cli",async()=>{if(usesVertexCredentials(execution.backend))return listVertexModels(execution);const result=await runCommand(antigravityBinary(this.config),["models"],{cwd:this.config.root,timeoutMs:15_000,outputLimit:131072,env:antigravityEnvironment(this.config,execution)});if(result.exitCode!==0)throw new Error(result.stderr||"Gemini Antigravity model catalog is unavailable.");return parseAntigravityModels(stripAnsi(result.stdout));});this.modelCatalog.set(key,catalog);return catalog;}
  async getModelCatalog(force=false):Promise<RuntimeModelCatalogSnapshot<AntigravityModel>>{const execution=await this.executionSettings();try{return await this.catalogFor(execution).get(force);}catch(error){if(force)throw error;return{models:VERTEX_FALLBACK_MODELS,fetchedAt:new Date().toISOString(),stale:true,source:"fallback:vertex",error:error instanceof Error?error.message:String(error)};}}
  async getModels(force=false):Promise<AntigravityModel[]>{return(await this.getModelCatalog(force)).models;}
  /** Readiness for the Gemini CLI backend: the managed runtime, its version, the
   * Vertex catalog reachable with the stored service account, and the ripgrep
   * note. The credentials path is reported as configured/absent, never inline. */
  geminiCliReadiness(execution:AntigravityExecutionSettings){
    const dataRoot=this.config.dataRoot??this.config.root,entry=resolveGeminiCliEntry(dataRoot);
    return{
      installed:Boolean(entry),
      source:entry?(entry.kind==="bundle"?"managed":"path"):null,
      version:geminiCliInstalledVersion(dataRoot,entry),
      ripgrep:ripgrepAvailable(),
      projectId:execution.vertex.projectId,
      location:execution.vertex.location,
      credentials:execution.vertex.credentialsPath?"configured":"missing"
    };
  }
  async healthCheck(){const execution=await this.executionSettings();
    if(execution.backend==="vertex-agent"){
      const readiness=this.geminiCliReadiness(execution);
      if(!readiness.installed)return{ok:false,detail:{runtime:false,backend:"vertex-agent",...readiness,error:"The Gemini CLI is not installed for this Workhouse runtime."}};
      try{const models=await this.getModels(true);return{ok:models.length>0,detail:{runtime:true,backend:"vertex-agent",models:models.length,...readiness}};}
      catch(error){return{ok:false,detail:{runtime:true,backend:"vertex-agent",...readiness,error:error instanceof Error?error.message:String(error)}};}
    }
    if(execution.backend==="vertex"){try{const models=await this.getModels(true);return{ok:true,detail:{runtime:true,backend:"vertex",models:models.length,projectId:execution.vertex.projectId,location:execution.vertex.location}};}catch(error){return{ok:false,detail:{runtime:false,backend:"vertex",error:error instanceof Error?error.message:String(error)}};}}const file=antigravityBinary(this.config),result=await runCommand(file,["--version"],{cwd:this.config.root,timeoutMs:10_000,outputLimit:65536,env:antigravityEnvironment(this.config,execution)}).catch(()=>null);if(!result||result.exitCode!==0)return{ok:false,detail:{runtime:false,binary:file,backend:execution.backend}};let modelCount=0;try{modelCount=(await this.getModels(true)).length;}catch{}return{ok:modelCount>0,detail:{runtime:true,binary:file,version:result.stdout.trim(),models:modelCount,backend:execution.backend}};}
}
