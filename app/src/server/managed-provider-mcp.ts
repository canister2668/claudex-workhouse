import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { DeckDatabase } from "./db/client.js";
import { assertAutomationSupported, assertAutomationWithinSource, automationLevel, permissionForAutomation, type AutomationLevel } from "./automation-level.js";
import { normalizeDelegationSettings } from "./delegation-settings.js";
import type { CollaborationOrchestrator } from "./collaboration/orchestrator.js";
import type { ActiveSourceSnapshot } from "./collaboration/orchestrator.js";
import { ProviderResultAdapter } from "./collaboration/provider-result.js";
import { isLoopbackAddress } from "./security/auth.js";
import type { CollaborationParticipant, CollaborationRun, CollaborationSession, DeckTask, ProviderId } from "./types.js";
import {normalizeWorkspaceInstructionProfile,workspaceInstructionProfileSchema,workspaceInstructionSettingKey} from "./workspace-instructions.js";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TERMINAL=new Set(["completed","failed","stopped"]);
const LIVE_TURN=new Set(["pending","queued","running","waiting"]);
const providerSchema=z.enum(["codex","claude","deepseek","ollama","antigravity","grok"]);

function sha(value:string){return crypto.createHash("sha256").update(value).digest("hex");}
function stable(value:unknown):string{
  if(Array.isArray(value))return`[${value.map(stable).join(",")}]`;
  if(value&&typeof value==="object")return`{${Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
function secureEqual(left:string,right:string){const a=Buffer.from(left),b=Buffer.from(right);return a.length===b.length&&crypto.timingSafeEqual(a,b);}
function delay(ms:number){return new Promise(resolve=>setTimeout(resolve,ms));}

export type ManagedProviderSnapshot={
  provider:ProviderId;ownership:"claudex-workhouse";source:"claudex-workhouse";workspace:string;workspaceId:string;
  collaborationId:string|null;taskId:string;threadId:string|null;status:string;result:string|null;error:string|null;
};

type RefreshTask=(task:DeckTask)=>Promise<DeckTask>;
type ResumeTask=(task:DeckTask,prompt:string)=>Promise<DeckTask>;
type ProviderExecutionGate=(provider:ProviderId,model?:string|null)=>Promise<void>;

export class ManagedProviderBridge{
  private owner=crypto.randomUUID();
  private results=new ProviderResultAdapter();
  constructor(private db:DeckDatabase,private collaboration:CollaborationOrchestrator,private refreshTask:RefreshTask,private resumeTask:ResumeTask,private beforeProviderExecution:ProviderExecutionGate=async()=>{}){}

  private async restoreLegacyIdentity(task:DeckTask){
    if(task.workspaceId){const stored=await this.db.getWorkspace(task.workspaceId);if(stored&&!stored.archivedAt)return task;task={...task,workspaceId:null};}
    if(task.executionHostId&&task.executionHostId!=="local"||!task.cwd||!path.isAbsolute(task.cwd))return task;
    const canonical=task.cwd,stat=fs.statSync(canonical);if(!stat.isDirectory())throw Object.assign(new Error("Workspace is not a directory."),{code:"ENOTDIR"});fs.accessSync(canonical,fs.constants.R_OK|fs.constants.X_OK);
    let workspace=(await this.db.listWorkspaces({hostId:"local",includeArchived:false})).find(item=>path.resolve(item.canonicalPath)===canonical);
    // The store keys roots by canonical path too, so it may return a root that
    // was already registered under a different id -- link to the one it returns.
    if(!workspace){const timestamp=new Date().toISOString(),suffix=sha(canonical).slice(0,24),rootId=`session-root:${suffix}`;const storedRoot=await this.db.upsertWorkspaceRoot({id:rootId,hostId:"local",displayName:path.basename(canonical)||canonical,canonicalPath:canonical,allowCreate:false,allowRegister:false,allowClone:false,allowDelete:false,createdAt:timestamp,verifiedAt:timestamp,disabledAt:null});workspace=await this.db.upsertWorkspace({id:`session-workspace:${suffix}`,projectId:task.projectId,hostId:"local",rootId:storedRoot?.id??rootId,relativePath:".",canonicalPath:canonical,displayName:path.basename(canonical)||canonical,workspaceType:"existing",gitRemote:null,defaultBranch:null,lastKnownCommit:null,lastGitStatus:null,lastVerifiedAt:timestamp,createdAt:timestamp,updatedAt:timestamp,archivedAt:null});}
    const recovered=await this.db.upsertTask({...task,executionHostId:"local",workspaceId:workspace.id,metadata:{...task.metadata,managedWorkspaceRecoveredAt:new Date().toISOString()}});
    await this.db.appendAudit({createdAt:new Date().toISOString(),actor:`agent-task:${task.id}`,action:"managed-workspace-recovery",provider:task.provider,taskId:task.id,projectId:task.projectId,hostId:"local",workspaceId:workspace.id,outcome:"success",detail:"stored-session-cwd"});
    return recovered;
  }

  async authenticate(taskId:string|undefined,token:string|undefined){
    if(!taskId||!token)throw Object.assign(new Error("Managed provider task identity is required."),{statusCode:401});
    let task=await this.db.getTask(taskId),expected=typeof task?.metadata?.managedProviderCapabilityHash==="string"?task.metadata.managedProviderCapabilityHash:"";
    if(!task||task.ownership!=="claudex-workhouse"||!task.owned||!expected||!secureEqual(sha(token),expected))throw Object.assign(new Error("Managed provider task identity is invalid."),{statusCode:403});
    task=await this.restoreLegacyIdentity(task);
    if(!task.workspaceId||!task.executionHostId)throw Object.assign(new Error("The current task has no workspace value."),{statusCode:409});
    return task;
  }

  private async idempotent<T>(source:DeckTask,operation:string,key:string,body:unknown,run:()=>Promise<T>):Promise<T>{
    if(!UUID.test(key))throw Object.assign(new Error("A UUID idempotency key is required."),{statusCode:400});
    const sourceScope=source.providerSessionId??source.threadId??source.id;
    const action=`managed-provider:${source.provider}:${source.executionHostId??"unknown"}:${source.workspaceId??"unknown"}:${sourceScope}:${operation}`,requestHash=sha(stable(body)),timestamp=new Date();
    const claim=await this.db.claimIdempotency({key,action,requestHash,ownerToken:this.owner,now:timestamp.toISOString(),staleBefore:new Date(timestamp.getTime()-2*60_000).toISOString(),pruneBefore:new Date(timestamp.getTime()-7*24*60*60_000).toISOString()});
    if(!claim.claimed){
      if(claim.requestHash!==requestHash)throw Object.assign(new Error("Idempotency key was used for a different managed provider request."),{statusCode:409});
      if(claim.state==="completed")return claim.response as T;
      if(claim.state==="failed"){
        const recorded=claim.response as any;
        if(recorded?.code==="PROVIDER_START_PENDING"&&typeof recorded?.collaborationId==="string"){
          const recovered=await this.collaborationSnapshot(source,recorded.collaborationId);
          if(recovered)return recovered as T;
        }
        throw Object.assign(new Error(typeof recorded?.error==="string"?recorded.error:"The original managed provider request failed."),{statusCode:Number(recorded?.statusCode)||500,code:recorded?.code??"REQUEST_FAILED",collaborationId:recorded?.collaborationId});
      }
      throw Object.assign(new Error("The original managed provider request is still pending; it was not repeated."),{statusCode:409,code:"REQUEST_PENDING"});
    }
    try{
      const response=await run();
      await this.db.finishIdempotency({key,action,ownerToken:this.owner,state:"completed",response,now:new Date().toISOString()});
      return response;
    }catch(error){
      await this.db.finishIdempotency({key,action,ownerToken:this.owner,state:"failed",response:{error:error instanceof Error?error.message:String(error),statusCode:Number((error as any)?.statusCode)||500,code:(error as any)?.code??null,collaborationId:(error as any)?.collaborationId??null},now:new Date().toISOString()}).catch(()=>{});
      throw error;
    }
  }

  private async collaborationSnapshot(source:DeckTask,collaborationId:string,refresh=true):Promise<ManagedProviderSnapshot|null>{
    const detail=await this.collaboration.detail(collaborationId),session=detail.session as CollaborationSession;
    if(session.mode!=="assist"||!session.sourceTaskId||!await this.sameSourceThread(source,session.sourceTaskId))throw Object.assign(new Error("Managed provider task is outside the current source provider thread scope."),{statusCode:403});
    const participants=detail.participants as CollaborationParticipant[],assistant=participants.find(item=>item.id!==session.primaryParticipantId);
    const runs=(detail.runs as CollaborationRun[]).filter(item=>item.participantId===assistant?.id&&item.providerTaskId).sort((a,b)=>b.sequence-a.sequence),run=runs[0];
    if(!assistant||!run?.providerTaskId)return null;
    let task=await this.db.getTask(run.providerTaskId);if(!task)return null;
    if(refresh&&!TERMINAL.has(task.status))task=await this.refreshTask(task).catch(()=>task!);
    task=await this.db.upsertTask({...task,ownership:"claudex-workhouse",source:"claudex-workhouse",owned:true,metadata:{...task.metadata,managedProviderSourceTaskId:session.sourceTaskId,managedProviderCollaborationId:session.id}});
    return this.snapshot(task,session.id);
  }

  private async sameSourceThread(source:DeckTask,sourceTaskId:string){
    if(sourceTaskId===source.id)return true;
    const original=await this.db.getTask(sourceTaskId);
    const sourceThread=source.providerSessionId??source.threadId,originalThread=original?.providerSessionId??original?.threadId;
    return Boolean(original&&source.owned&&original.owned&&source.ownership==="claudex-workhouse"&&original.ownership==="claudex-workhouse"&&source.source==="claudex-workhouse"&&original.source==="claudex-workhouse"&&source.provider===original.provider&&sourceThread&&sourceThread===originalThread&&source.executionHostId===original.executionHostId&&source.workspaceId===original.workspaceId);
  }

  private async linkedTask(source:DeckTask,taskId:string,refresh=true){
    let task=await this.db.getTask(taskId);
    let linkedSourceId=typeof task?.metadata?.managedProviderSourceTaskId==="string"?task.metadata.managedProviderSourceTaskId:null;
    if(task&&task.ownership==="claudex-workhouse"&&task.source==="claudex-workhouse"&&(!linkedSourceId||!await this.sameSourceThread(source,linkedSourceId))&&typeof task.metadata?.collaborationSessionId==="string"){
      const session=await this.db.getCollaborationSession(task.metadata.collaborationSessionId) as CollaborationSession|null;
      const runLinked=session?Boolean((await this.db.listCollaborationRuns(session.id)).some((run:CollaborationRun)=>run.providerTaskId===task!.id)):false;
      if(session?.mode==="assist"&&runLinked&&session.sourceTaskId&&await this.sameSourceThread(source,session.sourceTaskId)){linkedSourceId=session.sourceTaskId;task=await this.db.upsertTask({...task,metadata:{...task.metadata,managedProviderSourceTaskId:linkedSourceId,managedProviderCollaborationId:session.id,managedProviderLinkRecoveredAt:new Date().toISOString()}});}
    }
    if(!task||task.ownership!=="claudex-workhouse"||task.source!=="claudex-workhouse"||!linkedSourceId||!await this.sameSourceThread(source,linkedSourceId))throw Object.assign(new Error("Managed provider task not found in the current source provider thread scope."),{statusCode:404});
    if(refresh&&!TERMINAL.has(task.status))task=await this.refreshTask(task).catch(()=>task!);
    return task;
  }

  private async snapshot(task:DeckTask,collaborationId:string|null):Promise<ManagedProviderSnapshot>{
    const workspace=task.workspaceId?await this.db.getWorkspace(task.workspaceId):null;
    return{provider:task.provider,ownership:"claudex-workhouse",source:"claudex-workhouse",workspace:workspace?.displayName??task.projectId,workspaceId:task.workspaceId??"",collaborationId,taskId:task.id,threadId:task.providerSessionId??task.threadId,status:task.status,result:task.result,error:task.error};
  }

  private resolveSourceSnapshot(source:DeckTask,input:{prompt:string;sourceContent?:string}):ActiveSourceSnapshot{
    const capturedAt=new Date().toISOString(),explicit=input.sourceContent?.trim();
    if(explicit)return{sourceTaskId:source.id,provider:source.provider,content:explicit,capturedAt,source:"explicit"};
    if(source.status==="completed")return{sourceTaskId:source.id,provider:source.provider,content:this.results.extract(source).content,capturedAt,source:"completed-result"};
    return{sourceTaskId:source.id,provider:source.provider,content:input.prompt.trim(),capturedAt,source:"current-request"};
  }

  async create(source:DeckTask,input:{provider:ProviderId;prompt:string;title?:string;sourceContent?:string;automationLevel?:AutomationLevel;model?:string|null;reasoningEffort?:string|null;serviceTier?:"priority"|null;idempotencyKey:string}){
    await this.beforeProviderExecution(input.provider,input.model);
    return this.idempotent(source,"create",input.idempotencyKey,input,async()=>{
      const settings=normalizeDelegationSettings((await this.db.getSystemSetting("delegation.launch-modes").catch(()=>null))?.value);
      if(settings[input.provider].launchMode!=="managed")throw Object.assign(new Error(`${input.provider} delegation is configured for direct execution, not Claudex Workhouse managed execution.`),{statusCode:409,code:"MANAGED_DELEGATION_DISABLED"});
      // Omitting automationLevel keeps the historical contract: the target
      // inherits the source's effective mode. An explicit value selects any
      // level at or below it, so analysis can ask for read and implementation
      // can ask for full/write -- neither is a workspace-exclusivity workaround.
      const sourceAutomation=automationLevel(source.metadata?.automationLevel,source.permissionProfile);
      const targetAutomationLevel=input.automationLevel?assertAutomationWithinSource(input.automationLevel,sourceAutomation):sourceAutomation;
      assertAutomationSupported(input.provider,targetAutomationLevel);
      const sourceSnapshot=this.resolveSourceSnapshot(source,input),detail=await this.collaboration.createAssist({sourceTask:source,targetProvider:input.provider,executionHostId:source.executionHostId!,workspaceId:source.workspaceId!,title:input.title?.trim()||`${source.title} · ${input.provider} managed task`,prompt:input.prompt,sourceSnapshot,targetAutomationLevel,preserveRequestPaths:true,model:input.model,reasoningEffort:input.reasoningEffort,serviceTier:input.serviceTier});
      const collaborationId=(detail.session as CollaborationSession).id,deadline=Date.now()+20_000;
      let snapshot:ManagedProviderSnapshot|null=null;
      do{snapshot=await this.collaborationSnapshot(source,collaborationId);if(snapshot&&(snapshot.threadId||TERMINAL.has(snapshot.status)))break;await delay(250);}while(Date.now()<deadline);
      if(!snapshot)throw Object.assign(new Error("Claudex Workhouse created the managed Assist but the provider task has not been assigned yet."),{statusCode:503,code:"PROVIDER_START_PENDING",collaborationId});
      await this.db.appendAudit({createdAt:new Date().toISOString(),actor:`agent-task:${source.id}`,action:"managed-provider-create",provider:snapshot.provider,taskId:snapshot.taskId,projectId:source.projectId,hostId:source.executionHostId,workspaceId:source.workspaceId,outcome:"success",detail:`source=${source.id};collaboration=${collaborationId};automation=${targetAutomationLevel};permission=${permissionForAutomation(snapshot.provider,targetAutomationLevel)}`});
      return snapshot;
    });
  }

  async get(source:DeckTask,input:{taskId:string}){const task=await this.linkedTask(source,input.taskId);return this.snapshot(task,typeof task.metadata?.managedProviderCollaborationId==="string"?task.metadata.managedProviderCollaborationId:null);}

  async wait(source:DeckTask,input:{taskId:string;timeoutMs?:number}){
    const deadline=Date.now()+Math.min(Math.max(input.timeoutMs??60_000,1000),120_000);let snapshot=await this.get(source,input);
    while(!TERMINAL.has(snapshot.status)&&Date.now()<deadline){await delay(500);snapshot=await this.get(source,input);}
    return snapshot;
  }

  async resume(source:DeckTask,input:{taskId:string;prompt:string;idempotencyKey:string}){
    const gatedTask=await this.linkedTask(source,input.taskId,false);
    await this.beforeProviderExecution(gatedTask.provider,gatedTask.requestedModel);
    return this.idempotent(source,`resume:${input.taskId}`,input.idempotencyKey,input,async()=>{
      const linkedPrevious=await this.linkedTask(source,input.taskId),level=automationLevel(source.metadata?.automationLevel,source.permissionProfile);
      assertAutomationSupported(linkedPrevious.provider,level);
      if(!linkedPrevious.providerSessionId&&!linkedPrevious.threadId)throw Object.assign(new Error("A confirmed managed provider thread ID is required for resume."),{statusCode:409});
      // A resume starts a second provider process on the same session id. The
      // wait timeout is observation-only, so a still-running task must not be
      // replaced by another turn: the two processes share one transcript and
      // interrupt each other.
      if(LIVE_TURN.has(linkedPrevious.status))throw Object.assign(new Error(`This managed provider task is still ${linkedPrevious.status}. Use managed_provider_task_wait or managed_provider_task_get until it reaches a terminal status instead of resuming it.`),{statusCode:409,code:"MANAGED_PROVIDER_TASK_ACTIVE",taskId:linkedPrevious.id,status:linkedPrevious.status});
      const timestamp=new Date().toISOString(),permissionProfile=permissionForAutomation(linkedPrevious.provider,level),previous=await this.db.upsertTask({...linkedPrevious,permissionProfile,settingsUpdatedAt:timestamp,metadata:{...linkedPrevious.metadata,automationLevel:level,workMode:level==="read"?"plan":"default",managedProviderExecutionInheritedAt:timestamp}});
      const resumed=await this.resumeTask(previous,input.prompt),collaborationId=typeof previous.metadata?.managedProviderCollaborationId==="string"?previous.metadata.managedProviderCollaborationId:null;
      const managedProviderSourceTaskId=typeof previous.metadata?.managedProviderSourceTaskId==="string"?previous.metadata.managedProviderSourceTaskId:source.id,linked=await this.db.upsertTask({...resumed,owned:true,ownership:"claudex-workhouse",source:"claudex-workhouse",workspaceId:previous.workspaceId,executionHostId:previous.executionHostId,sourceSessionId:previous.threadId??previous.id,metadata:{...resumed.metadata,managedProviderSourceTaskId,managedProviderCollaborationId:collaborationId,managedProviderResumedFromTaskId:previous.id}});
      await this.db.appendAudit({createdAt:new Date().toISOString(),actor:`agent-task:${source.id}`,action:"managed-provider-resume",provider:linked.provider,taskId:linked.id,projectId:linked.projectId,hostId:linked.executionHostId,workspaceId:linked.workspaceId,outcome:"success",detail:`source=${source.id};previous=${previous.id};automation=${level};permission=${permissionProfile}`});
      return this.snapshot(linked,collaborationId);
    });
  }

  async readInstructions(source:DeckTask){
    const workspaceId=source.workspaceId!,stored=await this.db.getSystemSetting(workspaceInstructionSettingKey(workspaceId)),profile=normalizeWorkspaceInstructionProfile(stored?.value);
    return{workspaceId,revision:profile.revision,enabled:profile.enabled,sourceMode:profile.sourceMode,agentEditable:profile.agentEditable,markdown:profile.markdown,lastEditedBy:profile.lastEditedBy,lastEditedTaskId:profile.lastEditedTaskId,updatedAt:profile.updatedAt};
  }

  async updateInstructions(source:DeckTask,input:{markdown:string;expectedRevision:number;idempotencyKey:string}){
    return this.idempotent(source,"workspace-instructions-update",input.idempotencyKey,input,async()=>{
      const workspaceId=source.workspaceId!,key=workspaceInstructionSettingKey(workspaceId),stored=await this.db.getSystemSetting(key),profile=normalizeWorkspaceInstructionProfile(stored?.value);
      if(profile.agentEditable!==true)throw Object.assign(new Error("The workspace owner must enable agent editing in Workspace settings before managed Markdown can be updated."),{statusCode:403,code:"WORKSPACE_INSTRUCTIONS_AGENT_WRITE_DISABLED"});
      if(profile.revision!==input.expectedRevision)throw Object.assign(new Error("Workspace instructions changed in another session. Read the current revision before updating."),{statusCode:409,code:"WORKSPACE_INSTRUCTIONS_REVISION_CONFLICT"});
      const parsed=workspaceInstructionProfileSchema.parse({...profile,markdown:input.markdown}),updatedAt=new Date().toISOString(),next={...parsed,revision:profile.revision+1,updatedAt,lastEditedBy:"agent" as const,lastEditedTaskId:source.id};
      const saved=await this.db.putSystemSettingIfUpdated(key,next,updatedAt,stored?.updatedAt??null);
      if(!saved.updated)throw Object.assign(new Error("Workspace instructions changed in another session. Read the current revision before updating."),{statusCode:409,code:"WORKSPACE_INSTRUCTIONS_REVISION_CONFLICT"});
      await this.db.appendAudit({createdAt:updatedAt,actor:`agent-task:${source.id}`,action:"workspace-instructions-agent-update",provider:source.provider,taskId:source.id,workspaceId,projectId:source.projectId,hostId:source.executionHostId,outcome:"success",detail:`revision=${next.revision}`});
      return{workspaceId,revision:next.revision,updatedAt,appliesTo:"next-task" as const};
    });
  }
}

function textResult(value:unknown){return{content:[{type:"text" as const,text:JSON.stringify(value,null,2)}]};}

export const workspaceInstructionsUpdateToolSchema={markdown:z.string().max(32_768),expectedRevision:z.number().int().min(0),idempotencyKey:z.string().uuid()};

export function registerManagedProviderMcp(app:FastifyInstance,bridge:ManagedProviderBridge,extension?:unknown){
  const createSchema={provider:providerSchema.describe("Managed target provider. A new task is created even when it matches the source provider."),prompt:z.string().trim().min(1).max(20_000),title:z.string().trim().min(1).max(100).optional(),sourceContent:z.string().trim().min(1).max(20_000).optional(),automationLevel:z.enum(["full","auto","confirm","read"]).optional().describe("Access mode for the managed target. Omit to inherit this source task's effective mode. Any level at or below the source's authority may be selected; a higher one is refused."),model:z.string().trim().min(1).max(120).nullable().optional(),reasoningEffort:z.string().trim().min(1).max(30).nullable().optional(),serviceTier:z.enum(["priority"]).nullable().optional(),idempotencyKey:z.string().uuid()};
  const assertLocal=(ip:string|undefined,headers:Record<string,unknown>)=>{if(headers["cf-ray"]||!isLoopbackAddress(ip))throw Object.assign(new Error("The managed provider MCP endpoint is local-only."),{statusCode:403});};
  const handleManagedProvider=async(request:any,reply:any)=>{
    assertLocal(request.ip,request.headers as Record<string,unknown>);
    const authorization=typeof request.headers.authorization==="string"?request.headers.authorization:"",token=authorization.startsWith("Bearer ")?authorization.slice(7):undefined;
    const taskHeader=request.headers["x-claudex-workhouse-task-id"];
    const source=await bridge.authenticate(typeof taskHeader==="string"?taskHeader:undefined,token);
    const server=new McpServer({name:"claudex-workhouse-managed-provider",version:"1.0.0"});
    let extensionOnly=false;
    if(!extensionOnly){
    server.tool("managed_provider_task_create","Create a separately visible, persistent Claudex Workhouse-managed session for the explicitly named target provider and model. Set automationLevel to choose the target's access mode: read for analysis or review, full/auto for implementation. Omit it and the target inherits this source task's effective mode, including full-auto when active here; a level above this source task's own authority is refused. Several managed sessions may run against the same workspace at once, including several writers, so an existing writer never blocks creation. Its execution deadline is managed independently by Claudex Workhouse; use get/wait to observe it without shortening that deadline.",createSchema,{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false},async input=>textResult(await bridge.create(source,input)));
    server.tool("managed_provider_task_get","Get a managed provider task created by this Claudex Workhouse source provider thread.",{taskId:z.string().min(3).max(200)},{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},async input=>textResult(await bridge.get(source,input)));
    server.tool("managed_provider_task_wait","Observe a managed provider task from this source provider thread for up to two minutes. A running result only means this observation ended; it does not stop, fail, or shorten the persistent task.",{taskId:z.string().min(3).max(200),timeoutMs:z.number().int().min(1000).max(120_000).optional()},{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},async input=>textResult(await bridge.wait(source,input)));
    server.tool("managed_provider_task_resume","Send a follow-up in the confirmed managed provider thread and keep the new turn under Claudex Workhouse ownership.",{taskId:z.string().min(3).max(200),prompt:z.string().trim().min(1).max(20_000),idempotencyKey:z.string().uuid()},{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false},async input=>textResult(await bridge.resume(source,input)));
    server.tool("workspace_instructions_read","Read the managed Markdown settings for the workspace assigned to the current task; the target workspace is fixed and cannot be selected. Activation, sources, and completion policy remain owner-only. Updates apply to the next task, while the current session snapshot remains unchanged.",{}, {readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},async()=>textResult(await bridge.readInstructions(source)));
    server.tool("workspace_instructions_update","Update only the managed Markdown for the workspace assigned to the current task; the target workspace is fixed and cannot be selected. Activation, sources, completion policy, and agent edit permission remain owner-only. The change applies to the next task, while the current session snapshot remains unchanged.",workspaceInstructionsUpdateToolSchema,{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false},async input=>textResult(await bridge.updateInstructions(source,input)));
    }
    const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});await server.connect(transport);reply.hijack();await transport.handleRequest(request.raw,reply.raw,request.body);reply.raw.on("close",()=>{void transport.close();void server.close();});
  };
  const routeOptions={config:{rateLimit:{max:30,timeWindow:"1 minute"}}};
  app.post("/mcp/claudex-workhouse",routeOptions,handleManagedProvider);
  app.get("/mcp/claudex-workhouse",async(request,reply)=>{assertLocal(request.ip,request.headers as Record<string,unknown>);return reply.code(405).send({error:"Method Not Allowed. Use POST."});});
}
