import crypto from "node:crypto";
import {conversationAttachmentPaths} from "../conversation-attachments.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawn} from "node:child_process";
import type {AppConfig} from "../config.js";
import {DeckDatabase} from "../db/client.js";
import {runCommand,stripAnsi} from "../process.js";
import type {AgentProvider,CreateTaskInput,DeckTask,ProjectConfig,UnifiedStatus} from "../types.js";
import {automationLevel} from "../automation-level.js";
import {resolveExecutionPolicy} from "../execution-policy.js";
import {resolveTranscriptFile} from "../claude-transcript.js";
import {streamFile} from "../stream-events.js";
import {ProviderTaskSnapshotCache} from "../provider-task-snapshot.js";
import {ensureTaskTempDirectory} from "../workspace-temp.js";
import {compatibleProviderConfig,compatibleProviderEnvironment,deepseekModelsUrl,ollamaTagsUrl,type CompatibleProviderId} from "../compatible-provider-config.js";
import {RuntimeModelCatalog,type RuntimeModelCatalogSnapshot} from "../runtime-model-catalog.js";
import {ClaudeProvider} from "./claude.js";
import{workspaceInstructionFollowUpMetadata}from"../workspace-instructions.js";
import {seedTaskEmotion} from "../task-emotion-seed.js";
import {prepareExternalMcpEnvironment} from "../external-mcp-runtime.js";
import{emotionMcpEnvironment}from"../emotion-mcp-policy.js";

const now=()=>new Date().toISOString();
const active=(status:string)=>["pending","queued","running","waiting","unknown"].includes(status);

export type CompatibleModel={id:string;displayName:string;source:"runtime"};

export class AnthropicCompatibleProvider implements AgentProvider{
  readonly capabilities={supportsMcpEvents:false,supportsEmotionRendering:true} as const;
  private stateDir:string;
  private snapshot:ProviderTaskSnapshotCache;
  private signatures=new Map<string,{dev:number;ino:number;size:number;mtimeMs:number}>();
  private modelCatalog:RuntimeModelCatalog<CompatibleModel>;
  constructor(readonly id:CompatibleProviderId,private config:AppConfig,private db:DeckDatabase){
    this.stateDir=path.join(config.dataDir,`${id}-jobs`);fs.mkdirSync(this.stateDir,{recursive:true,mode:0o700});
    this.snapshot=new ProviderTaskSnapshotCache(db,id);
    this.modelCatalog=new RuntimeModelCatalog(db,`${id}-model-catalog`,id==="deepseek"?"deepseek-api":"ollama-api",()=>this.loadModels());
  }
  private stateFile(id:string){return path.join(this.stateDir,`${id.replaceAll(":","_")}.json`);}
  warmTaskSnapshot(tasks:DeckTask[]){this.snapshot.prime(tasks.filter(task=>task.provider===this.id));}
  private profile(value:string|null|undefined){return value&&ClaudeProvider.validProfiles.has(value)?value:":read-only";}
  private effort(value:string|null|undefined){return value&&ClaudeProvider.validEfforts.has(value)?value:"default";}
  private model(value:string|null|undefined){
    const configured=compatibleProviderConfig(this.id,this.config.dataRoot),candidate=String(value??"").trim()||configured.defaultModel;
    if(!candidate||!/^[a-z0-9][a-z0-9._:/-]{0,98}$/i.test(candidate))throw Object.assign(new Error(`${configured.label} model is required.`),{statusCode:400});
    return candidate;
  }
  private async refresh(task:DeckTask){
    let stat:fs.Stats;try{stat=fs.statSync(this.stateFile(task.id));}catch{return task;}
    const signature={dev:stat.dev,ino:stat.ino,size:stat.size,mtimeMs:stat.mtimeMs},previous=this.signatures.get(task.id);
    if(previous&&previous.dev===signature.dev&&previous.ino===signature.ino&&previous.size===signature.size&&previous.mtimeMs===signature.mtimeMs&&!active(task.status))return task;
    this.signatures.set(task.id,signature);
    let state:any;try{state=JSON.parse(fs.readFileSync(this.stateFile(task.id),"utf8"));}catch{return task;}
    const merged:DeckTask={...task,threadId:state.sessionId??task.threadId,providerSessionId:state.sessionId??task.providerSessionId,status:(state.status??task.status) as UnifiedStatus,updatedAt:state.updatedAt??task.updatedAt,result:state.result??task.result,error:state.error??null,log:stripAnsi(state.log??task.log),pid:state.pid??task.pid,pgid:state.pgid??task.pgid,processStart:state.processStart??task.processStart,effectiveModel:state.model??task.effectiveModel,metadata:{...task.metadata,activity:state.activity??task.metadata?.activity,contextUsage:state.contextUsage??task.metadata?.contextUsage,outputUsage:state.outputUsage??task.metadata?.outputUsage,contextCapabilities:state.contextCapabilities??task.metadata?.contextCapabilities}};
    if(active(merged.status)&&!this.processMatches(merged)){merged.status="stopped";merged.metadata={...merged.metadata,interruptionCause:"worker-process-lost",interruptionDetectedAt:now()};}
    if(JSON.stringify(merged)===JSON.stringify(task))return task;
    const saved=await this.db.upsertTask(merged);this.snapshot.applyAll([saved]);return saved;
  }
  async listTasks(){const stored=await this.snapshot.load().catch(()=>this.snapshot.current()),rows=await Promise.all(stored.map(task=>this.refresh(task)));this.snapshot.applyAll(rows);return rows;}
  getTask(task:DeckTask){return this.refresh(task);}
  private sessionProject(task:DeckTask):ProjectConfig{
    const project=this.config.projects.find(item=>item.id===task.projectId);if(project)return project;
    if(task.cwd)try{if(fs.statSync(task.cwd).isDirectory())return{id:task.projectId,name:task.cwd,path:task.cwd,realPath:task.cwd,enabled:true,error:null};}catch{}
    throw Object.assign(new Error("Session working directory is unavailable."),{statusCode:404});
  }
  private async launch(input:CreateTaskInput,mode:"new"|"resume"|"fork",sourceSessionId:string|null,parentThreadId:string|null){
    if(input.executionHostId&&input.executionHostId!=="local")throw Object.assign(new Error(`${this.id} currently runs on the local Workhouse host only.`),{statusCode:409,code:"REMOTE_PROVIDER_UNAVAILABLE"});
    const profile=input.workMode==="plan"?":read-only":this.profile(input.permissionProfile),workMode=input.workMode==="plan"?"plan":input.workMode==="default"?"default":profile===":read-only"?"plan":"default",runtimeProfile=input.runtimeProfile??"default",level=automationLevel(input.automationLevel,profile),workspaceId=input.workspaceId??input.project.id;
    const policy=resolveExecutionPolicy({provider:"claude",requestedAutomation:level,hostId:"local",workspaceId,sandboxCapability:null,hostFallbackPolicy:{trustedHost:false,isolatedWorker:false},providerCapabilities:{automatic:true,confirm:false,fullAccess:true,readOnly:true},runtimeVersion:null});
    if(!policy.allowed)throw Object.assign(new Error(`${this.id} execution blocked before launch: ${policy.reason}.`),{statusCode:409,code:"AUTOMATIC_EXECUTION_BLOCKED",policy});
    const backend=compatibleProviderConfig(this.id,this.config.dataRoot);if(!backend.apiKey)throw Object.assign(new Error(`A ${backend.label} API key is required.`),{statusCode:409,code:"PROVIDER_AUTH_REQUIRED"});
    const model=this.model(input.model),nativeId=input.requestedNativeId??crypto.randomUUID(),id=`${this.id}:${nativeId}`,assignedSessionId=mode==="resume"?sourceSessionId:crypto.randomUUID();if(!assignedSessionId)throw new Error("Compatible provider session ID is unavailable.");
    const managedProviderToken=crypto.randomBytes(32).toString("base64url"),managedProviderCapabilityHash=crypto.createHash("sha256").update(managedProviderToken).digest("hex"),delegationSettings=(await this.db.getSystemSetting("delegation.launch-modes").catch(()=>null))?.value??null;
    const marker=`claudex-workhouse-${this.id}:${nativeId}`,appRoot=this.config.appRoot??this.config.root,dataRoot=this.config.dataRoot??this.config.root,workerPath=path.join(appRoot,"app","dist-server","claude-worker.js"),taskTempDir=ensureTaskTempDirectory(this.config.tempDir,workspaceId,this.id,id),createdAt=now();
    let task:DeckTask={id,provider:this.id,nativeId,threadId:assignedSessionId,providerSessionId:assignedSessionId,projectId:input.project.id,cwd:input.project.realPath,title:input.title??input.prompt.replace(/\s+/g," ").slice(0,80),prompt:input.prompt,status:"pending",createdAt,updatedAt:createdAt,result:null,error:null,log:`${backend.label} worker starting.`,owned:true,pid:null,pgid:null,processStart:null,commandMarker:marker,parentThreadId,permissionProfile:profile,requestedModel:model,requestedReasoningEffort:this.effort(input.reasoningEffort)==="default"?null:this.effort(input.reasoningEffort),settingsUpdatedAt:createdAt,executionHostId:"local",workspaceId:input.workspaceId??null,workChainId:input.workChainId??null,metadata:{...(input.boardRole?{boardRole:input.boardRole}:{}),workMode,runtimeProfile,automationLevel:level,modelBackend:this.id,baseUrl:new URL(backend.baseUrl).origin,managedProviderCapabilityHash,tempDirectory:taskTempDir,requestedAutomation:policy.requestedAutomation,effectiveSandbox:policy.effectiveSandbox,effectiveApprovalPolicy:policy.effectiveApprovalPolicy,executionBackend:policy.executionBackend,executionUiLabel:policy.uiLabel}};
    task=await this.db.upsertTask(task);this.snapshot.applyAll([task]);
    seedTaskEmotion(dataRoot,this.id,id,assignedSessionId);
    const providerEnvironment=compatibleProviderEnvironment(this.id,this.config.dataRoot,model),effort=this.effort(input.reasoningEffort),externalMcp=await prepareExternalMcpEnvironment({db:this.db,taskTempDir,taskId:id,provider:this.id,runtimeProfile,port:this.config.port});
    const providerPrompt=[input.prompt,externalMcp.promptSuffix].filter(Boolean).join("\n\n");
    if(Object.keys(externalMcp.metadata).length){task=await this.db.upsertTask({...task,metadata:{...task.metadata,...externalMcp.metadata}});this.snapshot.applyAll([task]);}
    const childEnvironment={...process.env,
      ...providerEnvironment,CLAUDEX_WORKHOUSE_ROOT:appRoot,CLAUDEX_WORKHOUSE_APP_ROOT:appRoot,CLAUDEX_WORKHOUSE_DATA_ROOT:dataRoot,CLAUDEX_WORKHOUSE_RUNTIME_PROFILE:runtimeProfile,CLAUDEX_WORKHOUSE_CONVERSATION_ATTACHMENTS:JSON.stringify(runtimeProfile==="conversation"?conversationAttachmentPaths(input.prompt,path.join(this.config.dataDir,"uploads")):[]),CLAUDEX_WORKHOUSE_PROVIDER_ID:this.id,CLAUDEX_WORKHOUSE_PROVIDER_LABEL:backend.label,...emotionMcpEnvironment(this.id,this.config.port,id,assignedSessionId,runtimeProfile),CLAUDEX_WORKHOUSE_MANAGED_PROVIDER_MCP_URL:`http://127.0.0.1:${this.config.port}/mcp/claudex-workhouse`,CLAUDEX_WORKHOUSE_CURRENT_TASK_ID:id,CLAUDEX_WORKHOUSE_CURRENT_SESSION_ID:assignedSessionId,CLAUDEX_WORKHOUSE_MANAGED_PROVIDER_TOKEN:managedProviderToken,CLAUDEX_WORKHOUSE_DELEGATION_SETTINGS:JSON.stringify(delegationSettings),TMPDIR:taskTempDir,TMP:taskTempDir,TEMP:taskTempDir,...(mode!=="resume"?{CLAUDEX_WORKHOUSE_CLAUDE_SESSION_ID:assignedSessionId}:{}),...externalMcp.environment};
    const child=spawn(process.execPath,[workerPath,this.stateFile(id),id,this.config.claudeBinary,mode,input.project.realPath,marker,profile,model,effort,workMode,sourceSessionId??"",providerPrompt],{cwd:input.project.realPath,detached:true,shell:false,windowsHide:true,stdio:"ignore",env:childEnvironment});
    child.unref();task=await this.db.upsertTask({...task,log:`${backend.label} worker started.`,pid:child.pid??null,pgid:child.pid??null});this.snapshot.applyAll([task]);return task;
  }
  createTask(input:CreateTaskInput){return this.launch(input,"new",null,null);}
  async sendMessage(task:DeckTask,prompt:string){if(!task.threadId)throw new Error("A confirmed session ID is required.");const runtimeProfile=task.metadata?.runtimeProfile==="conversation"||task.metadata?.runtimeProfile==="browser"?task.metadata.runtimeProfile:"default",next=await this.launch({project:this.sessionProject(task),prompt,title:task.title,model:task.requestedModel,reasoningEffort:task.requestedReasoningEffort,permissionProfile:task.permissionProfile,workMode:task.metadata?.workMode==="plan"?"plan":"default",runtimeProfile,automationLevel:automationLevel(task.metadata?.automationLevel,task.permissionProfile),executionHostId:"local",workspaceId:task.workspaceId??null},"resume",task.threadId,task.threadId);return this.db.upsertTask({...next,metadata:workspaceInstructionFollowUpMetadata(task.metadata,next.metadata)});}
  async compactThread(task:DeckTask){if(!task.threadId)throw new Error("A confirmed session ID is required.");return this.launch({project:this.sessionProject(task),prompt:"/compact",title:task.title,model:task.requestedModel,reasoningEffort:task.requestedReasoningEffort,permissionProfile:task.permissionProfile,workMode:task.metadata?.workMode==="plan"?"plan":"default",runtimeProfile:task.metadata?.runtimeProfile==="conversation"||task.metadata?.runtimeProfile==="browser"?task.metadata.runtimeProfile:"default",automationLevel:automationLevel(task.metadata?.automationLevel,task.permissionProfile),executionHostId:"local",workspaceId:task.workspaceId??null},"resume",task.threadId,task.threadId);}
  async forkThread(task:DeckTask){if(!task.threadId)throw new Error("A confirmed session ID is required.");return this.launch({project:this.sessionProject(task),prompt:"Continue this branch from the inherited context.",title:task.title,model:task.requestedModel,reasoningEffort:task.requestedReasoningEffort,permissionProfile:task.permissionProfile,workMode:task.metadata?.workMode==="plan"?"plan":"default",runtimeProfile:task.metadata?.runtimeProfile==="conversation"||task.metadata?.runtimeProfile==="browser"?task.metadata.runtimeProfile:"default",automationLevel:automationLevel(task.metadata?.automationLevel,task.permissionProfile),executionHostId:"local",workspaceId:task.workspaceId??null},"fork",task.threadId,task.threadId);}
  async deleteSession(task:DeckTask){
    if(!task.threadId||!/^[0-9a-f-]{36}$/i.test(task.threadId))throw Object.assign(new Error("Session ID is unavailable."),{statusCode:409});
    const members=(await this.db.listProviderTasks(this.id)).filter(item=>item.threadId===task.threadId);for(const member of members)if(active((await this.refresh(member)).status))throw Object.assign(new Error("Stop the session before deleting it."),{statusCode:409});
    const cwd=task.cwd??members.find(item=>item.cwd)?.cwd;if(cwd&&path.isAbsolute(cwd)){const transcript=resolveTranscriptFile(cwd,task.threadId),root=path.resolve(process.env.HOME||os.homedir(),".claude","projects"),parent=path.dirname(transcript);if(parent===root||parent.startsWith(`${root}${path.sep}`))fs.rmSync(transcript,{force:true});}
    for(const member of members){const state=this.stateFile(member.id),spool=streamFile(this.config.dataRoot??this.config.root,member.id);fs.rmSync(state,{force:true});fs.rmSync(spool,{force:true});fs.rmSync(`${spool}.1`,{force:true});this.signatures.delete(member.id);}
    const deletedTasks=await this.db.deleteTaskSession(this.id,task.threadId);this.snapshot.invalidate();return{threadId:task.threadId,deleted:true,deletedTasks};
  }
  private processMatches(task:DeckTask){if(!task.pid||!task.pgid||!task.commandMarker||!task.processStart)return false;try{const stat=fs.readFileSync(`/proc/${task.pid}/stat`,"utf8").split(" "),cmd=fs.readFileSync(`/proc/${task.pid}/cmdline`,"utf8").replaceAll("\0"," ");return stat[21]===task.processStart&&Number(stat[4])===task.pgid&&cmd.includes("claude-worker.js")&&cmd.includes(task.commandMarker);}catch{return false;}}
  async stopTask(task:DeckTask){task=await this.refresh(task);if(!this.processMatches(task))throw Object.assign(new Error("Worker process identity no longer matches the recorded task."),{statusCode:409});process.kill(-task.pgid!,"SIGTERM");for(let i=0;i<20;i++){await new Promise(resolve=>setTimeout(resolve,250));if(!this.processMatches(task))return this.db.upsertTask({...task,status:"stopped",updatedAt:now()});}if(this.processMatches(task))process.kill(-task.pgid!,"SIGKILL");return this.db.upsertTask({...task,status:"stopped",updatedAt:now()});}
  private async loadModels():Promise<CompatibleModel[]>{const config=compatibleProviderConfig(this.id,this.config.dataRoot);if(!config.apiKey)throw new Error(`${config.label} API key is required.`);const url=this.id==="deepseek"?deepseekModelsUrl(config.baseUrl):ollamaTagsUrl(config.baseUrl),response=await fetch(url,{headers:{Authorization:`Bearer ${config.apiKey}`},signal:AbortSignal.timeout(5000)});if(!response.ok)throw new Error(`${config.label} model catalog returned HTTP ${response.status}.`);const value=await response.json() as any,rows=this.id==="deepseek"?value?.data:value?.models;return(Array.isArray(rows)?rows:[]).map((item:any)=>String(item?.id??item?.name??item?.model??"").trim()).filter(Boolean).map((id:string)=>({id,displayName:id.replaceAll("-"," ").replace(/\b\w/g,value=>value.toUpperCase()),source:"runtime" as const}));}
  getModelCatalog(force=false):Promise<RuntimeModelCatalogSnapshot<CompatibleModel>>{return this.modelCatalog.get(force);}
  async getModels(force=false):Promise<CompatibleModel[]>{return(await this.getModelCatalog(force)).models;}
  async healthCheck(){
    const backend=compatibleProviderConfig(this.id,this.config.dataRoot),runtime=await runCommand(this.config.claudeBinary,["--version"],{cwd:this.config.root,timeoutMs:10_000,outputLimit:65_536}).catch(()=>null);
    if(!runtime||runtime.exitCode!==0)return{ok:false,detail:{runtime:false,backend:this.id}};
    if(!backend.apiKey)return{ok:false,detail:{runtime:true,backend:this.id==="deepseek"?"deepseek-api":"ollama-cloud",configured:false,baseUrl:new URL(backend.baseUrl).origin}};
    try{const catalog=await this.getModelCatalog(true);return{ok:!catalog.stale&&catalog.models.length>0,detail:{runtime:true,backend:this.id==="deepseek"?"deepseek-api":"ollama-cloud",configured:true,models:catalog.models.length,stale:catalog.stale,baseUrl:new URL(backend.baseUrl).origin}};}catch(error){return{ok:false,detail:{runtime:true,backend:this.id==="deepseek"?"deepseek-api":"ollama-cloud",configured:true,error:error instanceof Error?error.message:String(error)}};}
  }
}
