import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CodexAppServerClient } from "../codex/app-server.js";
import { runCommand } from "../process.js";
import { readStreamEvents, STREAM_REPLAY_LIMIT, streamFile } from "../stream-events.js";
import { resolveTranscriptFile } from "../claude-transcript.js";
import type { WorkerConfig, WorkerTask } from "./config.js";
import { saveWorkerConfig, workerHome } from "./config.js";
import { requireWorkerExecutionWorkspace } from "./workspaces.js";
import { listPendingApprovals, submitApprovalDecision, type ApprovalDecision } from "../approval-bridge.js";
import { listPendingUserInputs, submitUserInput } from "../user-input-bridge.js";
import { WORKER_VERSION } from "./version.js";
import {executionPolicyErrorCode,probeNativeSandbox,resolveExecutionPolicy,type SandboxCapability} from "../execution-policy.js";
import { WORKER_PROTOCOL_VERSION } from "../worker-protocol.js";
import{discoverWindowsProvider,windowsProviderReadyState,type WindowsProviderId}from"../windows/provider-discovery.js";
import{capabilityError,providerCapabilities,resolveLaunchPlan,workerRuntimePaths,WORKER_PROVIDERS,type LaunchPlan,type WorkerProviderId}from"./provider-adapters.js";
import {resolveTaskImageOutput} from "../task-image-output.js";
import{managedCodexBinary}from"../codex-runtime.js";

type SendEvent=(taskId:string,eventId:string,event:Record<string,unknown>)=>boolean;
type WorkerRunnerName="claude-worker.js"|"codex-worker.js"|"grok-worker.js"|"antigravity-worker.js"|"vertex-worker.js"|"gemini-cli-worker.js";
/** Every worker script a Worker task may be running, for process identity. */
const WORKER_RUNNER_NAMES:WorkerRunnerName[]=["claude-worker.js","codex-worker.js","grok-worker.js","antigravity-worker.js","vertex-worker.js","gemini-cli-worker.js"];
const runsWorkerScript=(commandLine:string)=>WORKER_RUNNER_NAMES.some(name=>commandLine.includes(name.replace(/\.js$/,"")));
/** Bounds one tick so a huge backlog cannot starve status polling. */
const MAX_FORWARD_BATCHES=8;
function now(){return new Date().toISOString();}
function stateFile(home:string,taskId:string,provider:string){const dir=path.join(home,"data",`${provider}-jobs`);fs.mkdirSync(dir,{recursive:true,mode:0o700});return path.join(dir,`${crypto.createHash("sha256").update(taskId).digest("hex")}.json`);}
function readState(file:string){try{return JSON.parse(fs.readFileSync(file,"utf8"));}catch{return null;}}
function useCodexBinary(binary:string){
  const before=process.env.CLAUDEX_WORKHOUSE_CODEX_BIN;
  process.env.CLAUDEX_WORKHOUSE_CODEX_BIN=binary;
  return()=>{
    if(before===undefined)delete process.env.CLAUDEX_WORKHOUSE_CODEX_BIN;else process.env.CLAUDEX_WORKHOUSE_CODEX_BIN=before;
  };
}
/** One resolver for the executable a Worker task actually launches, so the
 * reported managed-CLI status can never describe a different binary than the
 * one that runs. Windows discovery reassigns `claudeBinary`/`codexBinary` on
 * every successful probe; when a probe fails it keeps the last verified path,
 * and a launch would still use it. Reporting `unavailable` while silently
 * launching that retained path is the mismatch this removes: status probes the
 * same value a launch resolves. */
export function workerProviderBinary(config:WorkerConfig,provider:WindowsProviderId,platform:NodeJS.Platform=process.platform){
  const configured=config[provider==="claude"?"claudeBinary":"codexBinary"];
  if(platform!=="win32")return configured;
  return config.providerBinaries?.[provider]?.verifiedPath?.trim()||configured;
}

export class RemoteTaskManager {
  private timer:NodeJS.Timeout;
  private nativeCapability:SandboxCapability|null=null;
  private home:string;
  constructor(private config:WorkerConfig,private sendEvent:SendEvent,private sendSnapshot:()=>void=()=>{}){this.home=config.runtimeHome??workerHome();this.timer=setInterval(()=>this.poll(),300);this.timer.unref?.();void this.recover();}
  private persist(){saveWorkerConfig(this.config,this.home);}
  private runner(name:WorkerRunnerName){const adjacent=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..",name);return fs.existsSync(adjacent)?adjacent:path.resolve(process.cwd(),"dist-server",name);}
  private paths(){return workerRuntimePaths(this.config,this.home);}
  /** The one capability table shared by launch admission and status reporting. */
  capabilities(){
    return providerCapabilities({
      config:this.config,
      paths:this.paths(),
      claudeBinary:workerProviderBinary(this.config,"claude"),
      codexBinary:workerProviderBinary(this.config,"codex")
    });
  }
  private async recover(){for(const task of this.config.tasks){const state=readState(task.stateFile);if(state){task.status=state.status??task.status;task.threadId=state.sessionId??task.threadId??task.threadId;task.updatedAt=state.updatedAt??task.updatedAt;}if(["pending","running","waiting","unknown"].includes(task.status)&&!(await this.processMatches(task,state))){task.status="stopped";task.interruptionCause="worker-host-restarted";task.interruptionDetectedAt=now();task.updatedAt=task.interruptionDetectedAt;}}this.persist();}
  list(){return this.config.tasks.map(task=>{const state=readState(task.stateFile);return{id:task.id,provider:task.provider,workspaceId:task.workspaceId,status:task.interruptionCause?task.status:state?.status??task.status,threadId:state?.sessionId??state?.threadId??task.threadId,result:state?.result??null,error:state?.error??null,updatedAt:task.interruptionCause?task.updatedAt:state?.updatedAt??task.updatedAt,interruptionCause:task.interruptionCause??null,interruptionDetectedAt:task.interruptionDetectedAt??null};});}
  resolveImageOutput(taskId:string,mediaPath:string){
    if(!this.config.tasks.some(task=>task.id===taskId&&task.provider==="codex"))throw new Error("Remote task not found.");
    return resolveTaskImageOutput(this.home,taskId,mediaPath);
  }
  async command(command:string,payload:any){
    if(command==="provider.task.start")return this.start(payload,"new");
    if(command==="provider.session.control")return this.start(payload,"resume");
    if(command==="provider.capabilities.read")return{capabilities:this.capabilities()};
    if(command==="provider.thread.command")return this.threadCommand(payload);
    const task=this.config.tasks.find(item=>item.id===payload.taskId);if(!task)throw new Error("Remote task not found.");
    if(command==="provider.task.status")return this.status(task);
    if(command==="provider.approvals.list")return{approvals:task.provider==="codex"?listPendingApprovals(task.stateFile):[]};
    if(command==="provider.approval.respond")return{accepted:true,approval:submitApprovalDecision(task.stateFile,String(payload.approvalId??""),String(payload.decision??"") as ApprovalDecision)};
    if(command==="provider.userInput.list")return{requests:task.provider==="codex"?listPendingUserInputs(task.stateFile):[]};
    if(command==="provider.userInput.respond")return{accepted:true,request:submitUserInput(task.stateFile,String(payload.requestId??""),payload.answers??{})};
    if(command==="provider.task.stop")return this.stop(task);
    if(command==="provider.session.delete")return this.deleteSession(task,payload);
    if(command==="provider.session.resume"){
      const expected=typeof payload.expectedThreadId==="string"?payload.expectedThreadId:task.threadId;
      if(!expected||task.threadId!==expected)throw Object.assign(new Error("Remote resume thread does not match the confirmed source thread."),{code:"TASK_RECOVERY_THREAD_MISMATCH"});
      return this.start({...payload,provider:task.provider,workspaceId:payload.workspaceId??task.workspaceId,threadId:expected},"resume",task);
    }
    if(command==="provider.session.fork")return this.start({...payload,provider:task.provider,workspaceId:payload.workspaceId??task.workspaceId,threadId:task.threadId,prompt:payload.prompt??"Continue this branch from the inherited context."},"fork",task);
    if(command==="provider.session.compact")return this.start({...payload,provider:task.provider,workspaceId:payload.workspaceId??task.workspaceId,threadId:task.threadId,prompt:"/compact"},task.provider==="codex"?"compact":"resume",task);
    throw new Error("Unsupported provider task command.");
  }
  /**
   * Session browsing and lifecycle for a provider that keeps its own store.
   *
   * The operation names are an explicit allowlist rather than a passthrough:
   * the Worker holds the only credential-bearing connection to the provider
   * runtime, and forwarding arbitrary method names from the server would make
   * that connection a general-purpose remote control.
   *
   * A provider whose runtime has no such store gets a specific refusal naming
   * itself, so the UI can disable the control rather than surface a failure
   * after the user clicks it.
   */
  private async threadCommand(payload:any){
    const provider=String(payload?.provider??"") as WorkerProviderId;
    const capability=this.capabilities().find(item=>item.provider===provider);
    if(!capability)throw Object.assign(new Error("Unsupported provider."),{code:"PROVIDER_UNSUPPORTED",statusCode:400});
    if(!capability.externalSessionDiscovery)throw Object.assign(new Error(
      capability.runtimeKind==="claude-code-engine"
        ?`${provider} runs through the Claude Code engine and keeps no session store of its own.`
        :`The ${provider} runtime does not expose a session store this host can read.`
    ),{code:"PROVIDER_SESSION_DISCOVERY_UNSUPPORTED",statusCode:409,provider});
    if(!capability.runnable)throw capabilityError(capability);
    if(provider!=="codex")throw Object.assign(new Error(`${provider} session control is served from its transcript store, not a runtime command.`),{code:"PROVIDER_SESSION_DISCOVERY_UNSUPPORTED",statusCode:409,provider});
    const operation=String(payload?.operation??"");
    const method={list:"thread/list",search:"thread/search",read:"thread/read",fork:"thread/fork",archive:"thread/archive",unarchive:"thread/unarchive",delete:"thread/delete"}[operation];
    if(!method)throw Object.assign(new Error("Unsupported provider session operation."),{code:"PROVIDER_SESSION_OPERATION_UNSUPPORTED",statusCode:400,operation});
    // Codex scopes `thread/list` and `thread/search` by working directory, so
    // substituting a different workspace for an unknown id would answer a
    // question that was not asked — a plausible session list from somewhere
    // else, with no error. An id that does not resolve is refused; only the
    // caller that named no workspace at all gets the host-wide default.
    let cwd=this.home;
    if(payload?.workspaceId!==undefined&&payload?.workspaceId!==null&&payload?.workspaceId!==""){
      const workspace=this.config.workspaces.find(item=>item.id===payload.workspaceId);
      if(!workspace)throw Object.assign(new Error("The requested Workspace is not registered on this host."),{code:"WORKSPACE_NOT_FOUND",statusCode:404});
      cwd=workspace.canonicalPath;
    }else cwd=this.config.workspaces[0]?.canonicalPath??this.home;
    const client=await this.codexClient(cwd);
    try{return{operation,result:await client.request(method,payload?.params??{},30000)};}
    finally{await client.close();}
  }
  private async start(payload:any,mode:"new"|"resume"|"fork"|"compact",existing?:WorkerTask){
    if(!(WORKER_PROVIDERS as readonly string[]).includes(payload.provider))throw Object.assign(new Error("Unsupported provider."),{code:"PROVIDER_UNSUPPORTED",statusCode:400});
    // The capability table decides, so a launch can never succeed for a
    // provider the same table told the UI was unavailable — nor be refused for
    // one it advertised.
    const capability=this.capabilities().find(item=>item.provider===payload.provider)!;
    if(!capability.runnable||!capability.operations.start)throw capabilityError(capability);
    const found=requireWorkerExecutionWorkspace(this.config,payload.workspaceId);if(!payload.prompt||typeof payload.prompt!=="string"||payload.prompt.length>100000)throw new Error("Invalid prompt.");
    if((mode==="resume"||mode==="compact")&&!payload.threadId)throw Object.assign(new Error("A confirmed thread ID is required for remote resume."),{code:"TASK_RECOVERY_THREAD_MISMATCH"});
    if(existing){const status=this.status(existing);if(["pending","running","waiting"].includes(status.status))throw new Error("Task is still running.");}
    const id=existing?.id??payload.taskId;if(typeof id!=="string"||id.length>200)throw new Error("Invalid task ID.");const marker=`claudex-workhouse-worker:${crypto.randomUUID()}`,file=existing?.stateFile??stateFile(this.home,id,payload.provider);let args:string[],selectedPolicy:any=null,providerPlan:LaunchPlan|null=null;
    if(payload.provider==="claude"){
      const profile=payload.workMode==="plan"?":read-only":payload.permissionProfile??":read-only",model=payload.model??"default",effort=payload.reasoningEffort??"default",workMode=payload.workMode==="plan"?"plan":payload.workMode==="default"?"default":profile===":read-only"?"plan":"default";
      const requestedAutomation=payload.automationLevel??(profile===":danger-full-access"?"full":profile===":read-only"?"read":"auto");selectedPolicy=resolveExecutionPolicy({provider:"claude",requestedAutomation,hostId:this.config.hostId??"unpaired",workspaceId:payload.workspaceId,sandboxCapability:null,hostFallbackPolicy:{trustedHost:false,isolatedWorker:false},providerCapabilities:{automatic:true,confirm:false,fullAccess:true,readOnly:true},runtimeVersion:null});if(!selectedPolicy.allowed)throw Object.assign(new Error(`Remote Claude execution blocked: ${selectedPolicy.reason}.`),{code:"AUTOMATIC_EXECUTION_BLOCKED",policy:selectedPolicy});
      args=[this.runner("claude-worker.js"),file,id,workerProviderBinary(this.config,"claude"),mode==="compact"?"resume":mode,found.real,marker,profile,model,effort,workMode,payload.threadId??"",payload.prompt];
    }else if(payload.provider!=="codex"){
      // DeepSeek, Ollama, Gemini and Grok. Each keeps its own runtime and its
      // own settings; the shared piece is only the state file, marker and
      // process identity handling below.
      const profile=payload.workMode==="plan"?":read-only":payload.permissionProfile??":read-only",model=payload.model??"default",effort=payload.reasoningEffort??"default";
      const workMode=payload.workMode==="plan"?"plan":payload.workMode==="default"?"default":profile===":read-only"?"plan":"default";
      const requestedAutomation=payload.automationLevel??(profile===":danger-full-access"?"full":profile===":read-only"?"read":"auto");
      selectedPolicy=resolveExecutionPolicy({provider:"claude",requestedAutomation,hostId:this.config.hostId??"unpaired",workspaceId:payload.workspaceId,sandboxCapability:null,hostFallbackPolicy:{trustedHost:false,isolatedWorker:false},providerCapabilities:{automatic:true,confirm:false,fullAccess:true,readOnly:true},runtimeVersion:null});
      if(!selectedPolicy.allowed)throw Object.assign(new Error(`Remote ${payload.provider} execution blocked: ${selectedPolicy.reason}.`),{code:"AUTOMATIC_EXECUTION_BLOCKED",policy:selectedPolicy});
      providerPlan=resolveLaunchPlan({
        provider:payload.provider,paths:this.paths(),runner:name=>this.runner(name as any),stateFile:file,taskId:id,
        mode,cwd:found.real,marker,prompt:payload.prompt,profile,model,effort,workMode,
        automationLevel:requestedAutomation,
        runtimeProfile:payload.runtimeProfile==="conversation"||payload.runtimeProfile==="browser"?payload.runtimeProfile:"default",
        threadId:payload.threadId??"",sessionId:payload.sessionId??payload.threadId??"",
        claudeBinary:workerProviderBinary(this.config,"claude"),
        antigravityExecution:payload.antigravityExecution,googleSearchMode:payload.googleSearchMode
      });
      args=providerPlan.args;
    }else{
      if(mode==="fork"&&payload.threadId){const client=await this.codexClient(found.real);try{const response=await client.request("thread/fork",{threadId:payload.threadId},30000);payload.threadId=response.thread?.id??payload.threadId;}finally{await client.close();}}
      const automationLevel=payload.automationLevel??(payload.permissionProfile===":danger-full-access"?"full":payload.permissionProfile&&payload.permissionProfile!==":read-only"?"auto":"read"),sandboxCapability:SandboxCapability|null=automationLevel!=="full"?(this.nativeCapability??=probeNativeSandbox(found.real,workerProviderBinary(this.config,"codex"),WORKER_VERSION,10000,this.config.hostId??"unpaired")):null;
      const executionPolicy=resolveExecutionPolicy({provider:"codex",requestedAutomation:automationLevel,hostId:this.config.hostId??"unpaired",workspaceId:payload.workspaceId,sandboxCapability,hostFallbackPolicy:{trustedHost:false,isolatedWorker:false},providerCapabilities:{automatic:true,confirm:true,fullAccess:true,readOnly:true},runtimeVersion:sandboxCapability?.codexVersion??null});selectedPolicy=executionPolicy;
      if(!executionPolicy.allowed)throw Object.assign(new Error(`Remote execution blocked before first command: ${executionPolicy.reason} (${sandboxCapability?.status??"not-probed"}: ${sandboxCapability?.reason??"none"}).`),{code:executionPolicyErrorCode(executionPolicy,sandboxCapability),policy:executionPolicy,capability:sandboxCapability});
      const runtimeProfile=payload.runtimeProfile==="conversation"||payload.runtimeProfile==="browser"?payload.runtimeProfile:"default",settings={model:payload.model??null,reasoningEffort:payload.reasoningEffort??null,serviceTier:payload.serviceTier??null,permissionProfile:payload.permissionProfile??":read-only",workMode:payload.workMode==="plan"?"plan":"default",runtimeProfile,automationLevel,executionPolicy,sandboxCapability,executionHostId:this.config.hostId,workspaceId:payload.workspaceId,taskTempDir:path.dirname(file)};
      args=[this.runner("codex-worker.js"),file,id,mode==="compact"?"compact":payload.threadId?"resume":"new",found.real,marker,payload.threadId??"",payload.prompt,JSON.stringify(settings)];
    }
    const workhouseRoot=this.home,codexBinary=workerProviderBinary(this.config,"codex"),claudeSwitchModels=String(payload.claudeSwitchModelsOnFlag!==false),runtimeProfile=payload.runtimeProfile==="conversation"||payload.runtimeProfile==="browser"?payload.runtimeProfile:"default";
    const child=spawn(process.execPath,args,{cwd:found.real,detached:true,shell:false,windowsHide:true,stdio:"ignore",env:{...process.env,CLAUDEX_WORKHOUSE_ROOT:workhouseRoot,CLAUDEX_WORKHOUSE_CODEX_BIN:codexBinary,...(payload.provider==="claude"?{CLAUDEX_WORKHOUSE_RUNTIME_PROFILE:runtimeProfile,CLAUDEX_WORKHOUSE_CLAUDE_SWITCH_MODELS_ON_FLAG:claudeSwitchModels}:{}),
      // The provider's endpoint, credentials and CLI settings. These reach the
      // child process only; nothing here is returned to the server, recorded in
      // task metadata, or written to the state file.
      ...(providerPlan?.environment??{})}});child.unref();const identity=await this.captureIdentity(child.pid??null),timestamp=now();const task:WorkerTask=existing??{id,provider:payload.provider,workspaceId:payload.workspaceId,stateFile:file,pid:child.pid??null,marker,processStart:identity.processStart,executablePath:identity.executablePath,createdAt:timestamp,updatedAt:timestamp,status:"pending",threadId:payload.threadId??null,lastForwardedSequence:0};Object.assign(task,{workspaceId:payload.workspaceId,pid:child.pid??null,marker,processStart:identity.processStart,executablePath:identity.executablePath,updatedAt:timestamp,status:"pending",threadId:payload.threadId??task.threadId,interruptionCause:null,interruptionDetectedAt:null});if(!existing)this.config.tasks.push(task);this.persist();
    // `backend` names what actually answered the request. For DeepSeek and
    // Ollama that is a third-party endpoint reached through the Claude Code
    // engine, and the UI has to be able to say so rather than implying a
    // native DeepSeek or Ollama CLI ran.
    return{hostTaskId:id,status:"pending",threadId:task.threadId,updatedAt:timestamp,executionPolicy:selectedPolicy,runtimeKind:capability.runtimeKind,backend:providerPlan?.backend??capability.backend??null};
  }
  private status(task:WorkerTask){const state=readState(task.stateFile);if(state&&!task.interruptionCause){task.status=state.status??task.status;task.threadId=state.sessionId??state.threadId??task.threadId;task.updatedAt=state.updatedAt??task.updatedAt;}return{hostTaskId:task.id,status:task.status,threadId:task.threadId,result:state?.result??null,error:state?.error??null,errorCategory:state?.errorCategory??null,updatedAt:task.updatedAt,contextUsage:state?.contextUsage??null,contextCapabilities:state?.contextCapabilities??null,interruptionCause:task.interruptionCause??null,interruptionDetectedAt:task.interruptionDetectedAt??null};}
  private async stop(task:WorkerTask){const state=readState(task.stateFile);if(!(await this.processMatches(task,state)))throw new Error("Worker process identity could not be verified.");const pid=Number(state?.pid??task.pid),pgid=Number(state?.pgid??pid);
    if(process.platform==="win32")spawnSync("taskkill",["/PID",String(pid),"/T"],{shell:false,windowsHide:true,stdio:"ignore"});else{try{process.kill(-pgid,"SIGTERM");}catch{process.kill(pid,"SIGTERM");}}
    for(let attempt=0;attempt<60;attempt++){const current=readState(task.stateFile);if(current&&["stopped","completed","failed"].includes(current.status)){task.status=current.status;task.updatedAt=current.updatedAt??now();this.persist();return this.status(task);}await new Promise(resolve=>setTimeout(resolve,50));}
    task.status="stopped";task.updatedAt=now();this.persist();return{hostTaskId:task.id,status:"stopped",threadId:task.threadId,result:null,error:null,updatedAt:task.updatedAt};
  }
  private async deleteSession(task:WorkerTask,payload:any){
    const threadId=String(payload.threadId??"");
    if(!threadId||threadId!==task.threadId||payload.provider!==task.provider)throw new Error("Provider session identity does not match the worker task.");
    const members=this.config.tasks.filter(item=>item.provider===task.provider&&item.threadId===threadId);
    if(members.some(item=>["pending","queued","running","waiting","unknown"].includes(this.status(item).status)))throw new Error("Stop the provider session before deleting it.");
    const workspace=this.config.workspaces.find(item=>item.id===task.workspaceId);
    if(!workspace)throw new Error("Provider session workspace is unavailable.");
    if(task.provider==="codex"){
      const client=await this.codexClient(workspace.canonicalPath);try{await client.request("thread/delete",{threadId},30000);}finally{await client.close();}
    }else if(task.provider==="claude"||task.provider==="deepseek"||task.provider==="ollama"){
      // DeepSeek and Ollama drive the Claude Code engine, so their transcript
      // lives in the same store and is removed the same way.
      if(!/^[0-9a-f-]{36}$/i.test(threadId))throw new Error("Provider session ID is invalid.");
      fs.rmSync(resolveTranscriptFile(workspace.canonicalPath,threadId),{force:true});
    }
    // Gemini and Grok keep no transcript this Worker can address. Their
    // Workhouse-owned task records below are still removed, which is the whole
    // of what deletion can honestly mean for them.
    for(const member of members){
      fs.rmSync(member.stateFile,{force:true});fs.rmSync(`${member.stateFile}.approvals`,{recursive:true,force:true});fs.rmSync(`${member.stateFile}.user-input`,{recursive:true,force:true});
      const spool=streamFile(this.home,member.id);fs.rmSync(spool,{force:true});fs.rmSync(`${spool}.1`,{force:true});
    }
    this.config.tasks=this.config.tasks.filter(item=>!members.includes(item));this.persist();
    return{threadId,deleted:true,deletedTasks:members.length};
  }
  private async captureIdentity(pid:number|null){
    if(!pid)return{processStart:null,executablePath:null};
    if(process.platform==="linux")try{return{processStart:fs.readFileSync(`/proc/${pid}/stat`,"utf8").split(" ")[21]??null,executablePath:fs.realpathSync(`/proc/${pid}/exe`)};}catch{return{processStart:null,executablePath:process.execPath};}
    if(process.platform==="darwin"){const result=await runCommand("ps",["-p",String(pid),"-o","lstart="],{cwd:this.home,timeoutMs:5000,outputLimit:65536});return{processStart:result.exitCode===0?result.stdout.trim():null,executablePath:process.execPath};}
    if(process.platform==="win32"){const script=`$p=Get-CimInstance Win32_Process -Filter \"ProcessId=${pid}\"; if($p){$p | Select-Object CreationDate,ExecutablePath | ConvertTo-Json -Compress}`;const result=await runCommand("powershell.exe",["-NoProfile","-NonInteractive","-Command",script],{cwd:this.home,timeoutMs:5000,outputLimit:65536});try{const value=JSON.parse(result.stdout);return{processStart:String(value.CreationDate??"")||null,executablePath:String(value.ExecutablePath??"")||null};}catch{return{processStart:null,executablePath:null};}}
    return{processStart:null,executablePath:null};
  }
  private async processMatches(task:WorkerTask,state:any){
    const pid=Number(state?.pid??task.pid);if(!pid||!task.marker)return false;
    if(process.platform==="linux")try{const stat=fs.readFileSync(`/proc/${pid}/stat`,"utf8").split(" "),cmd=fs.readFileSync(`/proc/${pid}/cmdline`,"utf8").replaceAll("\0"," "),start=state?.processStart??task.processStart;return (!start||stat[21]===start)&&cmd.includes(task.marker)&&runsWorkerScript(cmd);}catch{return false;}
    if(process.platform==="darwin"){const [command,start]=await Promise.all([runCommand("ps",["-p",String(pid),"-o","command="],{cwd:this.home,timeoutMs:5000,outputLimit:65536}),runCommand("ps",["-p",String(pid),"-o","lstart="],{cwd:this.home,timeoutMs:5000,outputLimit:65536})]);return command.exitCode===0&&Boolean(task.processStart)&&start.stdout.trim()===task.processStart&&command.stdout.includes(task.marker)&&runsWorkerScript(command.stdout);}
    if(process.platform==="win32"){const script=`$p=Get-CimInstance Win32_Process -Filter \"ProcessId=${pid}\"; if($p){$p | Select-Object ProcessId,CreationDate,ExecutablePath,CommandLine | ConvertTo-Json -Compress}`;const result=await runCommand("powershell.exe",["-NoProfile","-NonInteractive","-Command",script],{cwd:this.home,timeoutMs:5000,outputLimit:65536});try{const value=JSON.parse(result.stdout),executable=String(value.ExecutablePath??"");return result.exitCode===0&&Boolean(task.processStart)&&String(value.CreationDate??"")===task.processStart&&Boolean(task.executablePath)&&path.resolve(executable).toLowerCase()===path.resolve(task.executablePath!).toLowerCase()&&String(value.CommandLine??"").includes(task.marker)&&runsWorkerScript(String(value.CommandLine??""));}catch{return false;}}
    return false;
  }
  private async poll(){let changed=false;for(const task of this.config.tasks){const state=readState(task.stateFile);if(state&&!task.interruptionCause&&(state.status!==task.status||state.updatedAt!==task.updatedAt||state.sessionId!==task.threadId)){task.status=state.status??task.status;task.updatedAt=state.updatedAt??task.updatedAt;task.threadId=state.sessionId??state.threadId??task.threadId;changed=true;}changed=this.forward(task)||changed;}if(changed){this.persist();this.sendSnapshot();}}
  /** Drain the whole spool backlog. A single bounded read used to ask for 500
   * events per 300ms tick, and `readStreamEvents` reports `replayMissed` as
   * soon as the pending count exceeds the requested limit. A fast local host
   * emits far more than that during one burst of output, so the Worker
   * declared its own healthy backlog lost and skipped to the newest sequence:
   * the browser then saw a truncated stream and half-built output cards for a
   * Worker-hosted task while a server-hosted task showed everything. The
   * server's own SSE reader drains the same spool with the full replay limit,
   * so this keeps both paths on one rule. */
  private forward(task:WorkerTask){
    let changed=false;
    for(let batch=0;batch<MAX_FORWARD_BATCHES;batch++){
      const replay=readStreamEvents(this.home,task.id,task.lastForwardedSequence,STREAM_REPLAY_LIMIT);
      if(replay.replayMissed){
        // A genuine gap: the spool rotated past the last forwarded sequence.
        if(this.sendEvent(task.id,`replay-missed:${replay.latestSequence}`,{type:"unknown",content:"Worker event replay window was exceeded.",metadata:{latestSequence:replay.latestSequence}})){task.lastForwardedSequence=replay.latestSequence;changed=true;}
        return changed;
      }
      if(!replay.events.length)return changed;
      for(const event of replay.events){
        if(!this.sendEvent(task.id,event.eventId,event as unknown as Record<string,unknown>))return changed;
        task.lastForwardedSequence=event.sequence;changed=true;
      }
      if(task.lastForwardedSequence>=replay.latestSequence)return changed;
    }
    return changed;
  }
  private codexClient(cwd:string){const restore=useCodexBinary(workerProviderBinary(this.config,"codex"));return CodexAppServerClient.connect(cwd,30000).finally(restore);}
  close(){clearInterval(this.timer);this.persist();}
}

export async function providerStatus(config:WorkerConfig){
  const home=config.runtimeHome??workerHome();
  const managedPath=(provider:WindowsProviderId)=>provider==="codex"?managedCodexBinary(path.dirname(path.dirname(home)),"win32"):path.join(path.dirname(home),"claude-bin","claude.exe");
  const runtime=async(binary:string)=>{const result=await runCommand(binary,["--version"],{cwd:home,timeoutMs:10000,outputLimit:65536}).catch(()=>null);return result&&result.exitCode===0?{installed:true,version:(result.stdout||result.stderr).trim().slice(0,100)}:{installed:false,version:null};};
  let discoveries:Record<string,unknown>={};
  if(process.platform==="win32"){
    const entries=await Promise.all((["claude","codex"] as const).map(provider=>{
      const configured=config[provider==="claude"?"claudeBinary":"codexBinary"];
      return discoverWindowsProvider({provider,record:config.providerBinaries?.[provider],...(path.win32.isAbsolute(configured)&&fs.existsSync(configured)?{selectedPath:configured}:{}),...(config.managedLocal&&fs.existsSync(managedPath(provider))?{selectedPath:managedPath(provider)}:{})});
    }));
    config.providerBinaries={...(config.providerBinaries??{})};
    for(const{discovery,record}of entries){
      config.providerBinaries[discovery.provider]=record;discoveries[discovery.provider]=discovery;
      if(discovery.binaryPath)config[discovery.provider==="claude"?"claudeBinary":"codexBinary"]=discovery.binaryPath;
    }
    saveWorkerConfig(config,home);
  }
  const claudeBinary=workerProviderBinary(config,"claude"),codexBinary=workerProviderBinary(config,"codex");
  // Claude and Codex probe chains are independent, and each is a version check
  // followed by an authentication check. Running the two providers in sequence
  // made the worst case the sum of both chains, which on a cold Windows host
  // with antivirus scanning exceeded the Hub's own 30s request limit and left
  // every caller waiting on a request that could no longer succeed. Each
  // provider still probes its own steps in order, because the account check
  // needs the version check's verdict; the two providers no longer wait on
  // each other.
  const[claudeState,codexState]=await Promise.all([
    (async()=>{
      // Windows discovery above already ran `--version` for this same binary.
      // Reusing its recorded version removes the second, identical spawn.
      const discovered=(discoveries.claude as any)?.version;
      const runtimeInfo=claudeBinary?(discovered?{installed:true,version:String(discovered).slice(0,100)}:await runtime(claudeBinary)):{installed:false,version:null};
      if(!runtimeInfo.installed)return{runtimeInfo,account:{state:"unavailable"}as any};
      const result=await runCommand(claudeBinary!,["auth","status"],{cwd:home,timeoutMs:15000,outputLimit:65536}).catch(()=>null);
      if(!result)return{runtimeInfo,account:{state:"unknown",errorCategory:"provider_unavailable"}as any};
      try{const value=JSON.parse(result.stdout);return{runtimeInfo,account:{state:value.loggedIn===true?"connected":value.loggedIn===false?"disconnected":"unknown",accountType:value.authMethod??value.apiProvider??null,planType:value.subscriptionType??null}as any};}
      catch{return{runtimeInfo,account:{state:"unknown",errorCategory:"unsupported_output"}as any};}
    })(),
    (async()=>{
      const discovered=(discoveries.codex as any)?.version;
      const runtimeInfo=codexBinary?(discovered?{installed:true,version:String(discovered).slice(0,100)}:await runtime(codexBinary)):{installed:false,version:null};
      if(!runtimeInfo.installed)return{runtimeInfo,account:{state:"unavailable"}as any};
      const restore=useCodexBinary(codexBinary!);
      try{const client=await CodexAppServerClient.connect(home,20000);try{const value=await client.request("account/read",{refreshToken:false},15000);return{runtimeInfo,account:{state:value.account?"connected":value.requiresOpenaiAuth===true?"disconnected":"unknown",accountType:value.account?.type??null,planType:value.account?.planType??null}as any};}finally{await client.close();}}
      catch{return{runtimeInfo,account:{state:"unknown",errorCategory:"provider_unavailable"}as any};}
      finally{restore();}
    })()
  ]);
  const claudeRuntime=claudeState.runtimeInfo,codexRuntime=codexState.runtimeInfo;
  const claude:any=claudeState.account,codex:any=codexState.account;
  const workspaceAccessible=config.workspaces.some(item=>{try{return fs.statSync(item.canonicalPath).isDirectory();}catch{return false;}});
  const readiness=process.platform==="win32"?Object.fromEntries((["claude","codex"] as const).map(provider=>{
    const discovery=discoveries[provider] as any,account=provider==="claude"?claude:codex,params=new URLSearchParams({new:"1",provider,host:"local"});
    const executionPolicy=resolveExecutionPolicy({provider,requestedAutomation:provider==="codex"?"confirm":"auto",hostId:config.hostId??"local",workspaceId:config.workspaces[0]?.id??"unavailable",sandboxCapability:null,hostFallbackPolicy:{trustedHost:false,isolatedWorker:false},providerCapabilities:{automatic:true,confirm:provider==="codex",fullAccess:true,readOnly:true},runtimeVersion:discovery?.version??null});
    if(config.workspaces[0]?.id)params.set("workspace",config.workspaces[0].id);
    return[provider,{state:windowsProviderReadyState({discovery,accountState:account.state,workspaceAccessible,executionPolicyReady:executionPolicy.allowed}),workspaceAccessible,executionPolicyReady:executionPolicy.allowed,executionPolicy,newRequestPath:`/?${params.toString()}`}];
  })):{};
  // `binaryPath` is the executable this status actually probed, which is the
  // same value `workerProviderBinary` hands a launch. Reporting only the
  // discovery path left the UI showing a version with no path, or a path from
  // a discovery pass that no longer matches what the Worker would run.
  // The capability matrix travels with every status read, so the runtime
  // screen renders the six providers from the same table the Worker enforces
  // at launch instead of from an assumption about what Windows supports.
  const capabilities=providerCapabilities({config,paths:workerRuntimePaths(config,home),claudeBinary,codexBinary});
  return{runtimes:{claude:{...claudeRuntime,binaryPath:claudeBinary||null,...(process.platform==="win32"?{discovery:discoveries.claude}:{})},codex:{...codexRuntime,binaryPath:codexBinary||null,...(process.platform==="win32"?{discovery:discoveries.codex}:{})}},accounts:{claude,codex},readiness,capabilities};
}

export async function selectProviderBinary(config:WorkerConfig,provider:WindowsProviderId,selectedPath:string){
  if(process.platform!=="win32")throw Object.assign(new Error("Provider binary selection is only available on Windows."),{code:"PLATFORM_UNSUPPORTED",statusCode:409});
  const result=await discoverWindowsProvider({provider,record:config.providerBinaries?.[provider],selectedPath});
  if(!result.discovery.appInterfaceAvailable||!result.discovery.binaryPath)throw Object.assign(new Error("The selected Provider executable could not be verified."),{code:"PROVIDER_BINARY_INVALID",statusCode:400,detail:result.discovery.errorCategory});
  config.providerBinaries={...(config.providerBinaries??{}),[provider]:result.record};
  config[provider==="claude"?"claudeBinary":"codexBinary"]=result.discovery.binaryPath;
  saveWorkerConfig(config,config.runtimeHome??workerHome());
  return providerStatus(config);
}

export async function diagnostics(config:WorkerConfig,tasks:RemoteTaskManager){
  const status=await providerStatus(config);
  const home=config.runtimeHome??workerHome();
  const[git,githubCli]=await Promise.all([
    runCommand("git",["--version"],{cwd:home,timeoutMs:10000,outputLimit:65536}).catch(()=>null),
    runCommand("gh",["--version"],{cwd:home,timeoutMs:10000,outputLimit:65536}).catch(()=>null)
  ]);
  const free=fs.statfsSync(home);
  return{
    workerConnection:"normal",
    protocolVersion:WORKER_PROTOCOL_VERSION,
    workerVersion:WORKER_VERSION,
    operatingSystem:`${os.platform()} ${os.release()}`,
    architecture:os.arch(),
    workspaceRoots:config.roots.map(item=>({name:item.displayName,path:item.canonicalPath})),
    ...status,
    git:git?.exitCode===0?git.stdout.trim():"unavailable",
    githubCli:githubCli?.exitCode===0?(githubCli.stdout||githubCli.stderr).trim().split("\n")[0]:"unavailable",
    eventSpool:"normal",
    diskFreeBytes:Number(free.bavail)*Number(free.bsize),
    tasks:tasks.list().map(item=>({provider:item.provider,status:item.status,updatedAt:item.updatedAt}))
  };
}

export async function providerSessions(config:WorkerConfig,tasks:RemoteTaskManager){
  const home=config.runtimeHome??workerHome();
  const capabilities=tasks.capabilities();
  // Reported alongside the sessions so the UI can disable external-session
  // discovery per provider instead of offering it everywhere and failing with
  // an error popup. DeepSeek and Ollama run the Claude Code engine and their
  // transcripts land in Claude's store; surfacing those as DeepSeek or Ollama
  // sessions would attribute them to a runtime that never ran.
  const discovery=Object.fromEntries(capabilities.map(item=>[item.provider,{
    externalSessionDiscovery:item.externalSessionDiscovery,
    reason:item.externalSessionDiscovery?null:item.runtimeKind==="claude-code-engine"
      ?`${item.provider} runs through the Claude Code engine and keeps no session store of its own.`
      :`The ${item.provider} CLI does not expose a session store this host can read.`
  }]));
  const owned=tasks.list().map(item=>({...item,ownership:"claudex-workhouse",source:"claudex-workhouse"}));const sessions:any[]=[...owned];
  // Only probe a provider whose runtime is actually present. Connecting to an
  // app-server that is not installed costs the full connect timeout on every
  // session listing.
  if(capabilities.find(item=>item.provider==="codex")?.externalSessionDiscovery&&capabilities.find(item=>item.provider==="codex")?.runnable){const restore=useCodexBinary(workerProviderBinary(config,"codex"));try{const client=await CodexAppServerClient.connect(home,20000);try{const result=await client.request("thread/list",{limit:200,sortKey:"updated_at",archived:false},30000);for(const item of result.data??[])if(!owned.some(task=>task.provider==="codex"&&task.threadId===item.id))sessions.push({id:`codex:external:${item.id}`,provider:"codex",threadId:item.id,workspaceId:config.workspaces.find(workspace=>workspace.canonicalPath===item.cwd)?.id??null,title:item.name||item.preview||"Codex session",status:item.status?.type==="active"?"running":"completed",updatedAt:new Date((item.updatedAt??0)*1000).toISOString(),ownership:"external",source:item.source??"unknown",canStop:false});}finally{await client.close();}}catch{}finally{restore();}}
  try{const store=path.join(os.homedir(),".claude","projects");for(const directory of fs.readdirSync(store)){const dir=path.join(store,directory);if(!fs.statSync(dir).isDirectory())continue;for(const name of fs.readdirSync(dir).filter(value=>value.endsWith(".jsonl"))){const file=path.join(dir,name);let cwd:string|null=null,title="Claude session";try{const content=fs.readFileSync(file,"utf8").slice(0,16384);for(const line of content.split("\n")){const entry=JSON.parse(line);if(!cwd&&typeof entry.cwd==="string")cwd=entry.cwd;if(entry.type==="summary"&&entry.summary){title=String(entry.summary).slice(0,80);break;}}}catch{}const workspace=config.workspaces.find(item=>cwd&&path.resolve(item.canonicalPath)===path.resolve(cwd));if(!workspace)continue;const threadId=name.slice(0,-6);if(owned.some(task=>task.provider==="claude"&&task.threadId===threadId))continue;const stat=fs.statSync(file);sessions.push({id:`claude:external:${threadId}`,provider:"claude",threadId,workspaceId:workspace.id,title,status:"completed",updatedAt:stat.mtime.toISOString(),ownership:"external",source:"cli",canStop:false});}}}catch{}
  return{sessions,discovery};
}
