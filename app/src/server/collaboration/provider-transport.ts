import crypto from "node:crypto";
import type { DeckDatabase } from "../db/client.js";
import { LOCAL_HOST_ID } from "../host-workspaces.js";
import type { AgentProvider, CollaborationParticipant, DeckTask, ProviderId, Workspace } from "../types.js";
import type { WorkerHub } from "../worker-hub.js";
import {permissionForAutomation,type AutomationLevel} from "../automation-level.js";
import {normalizeClaudeExecutionSettings} from "../claude-execution-settings.js";
import{createWorkspaceInstructionSnapshot,MAX_WORKSPACE_INSTRUCTION_FILE_BYTES,normalizeWorkspaceInstructionProfile,promptWithWorkspaceInstructions,workspaceInstructionFollowUpMetadata,workspaceInstructionSettingKey,workspaceInstructionSnapshotFromMetadata}from"../workspace-instructions.js";

export type StartRunInput={participant:CollaborationParticipant;workspace:Workspace;projectName:string;prompt:string;title:string;runtimeProfile?:"default"|"conversation";providerTaskId?:string;workChainId?:string|null;collaborationMode?:string|null};
export interface ProviderTransport { start(input:StartRunInput):Promise<DeckTask>; status(task:DeckTask):Promise<DeckTask>; followUp(task:DeckTask,prompt:string):Promise<DeckTask>; stop(task:DeckTask):Promise<DeckTask>; deleteSession(task:DeckTask):Promise<{threadId:string;deleted:boolean;deletedTasks:number}>; }

function participantAutomation(participant:CollaborationParticipant):AutomationLevel{const value=participant.capabilitySnapshot?.automationLevel;if(value==="full"||value==="auto"||value==="confirm"||value==="read")return value;return participant.permissionMode==="write"?"auto":"read";}
function permissionProfile(participant:CollaborationParticipant){return permissionForAutomation(participant.provider,participantAutomation(participant));}
function workMode(participant:CollaborationParticipant){return participantAutomation(participant)==="read"||participant.permissionMode==="plan"?"plan":"default";}
function participantSettings(participant:CollaborationParticipant){const value=participant.capabilitySnapshot??{};return{model:typeof value.model==="string"?value.model:null,reasoningEffort:typeof value.reasoningEffort==="string"?value.reasoningEffort:null,serviceTier:typeof value.serviceTier==="string"?value.serviceTier:null};}
async function instructionProfile(db:DeckDatabase,workspaceId:string){try{return normalizeWorkspaceInstructionProfile((await db.getSystemSetting(workspaceInstructionSettingKey(workspaceId)))?.value);}catch{return normalizeWorkspaceInstructionProfile(undefined);}}
function followUpPrompt(task:DeckTask,prompt:string){return promptWithWorkspaceInstructions(prompt,workspaceInstructionSnapshotFromMetadata(task.metadata),{referenceOnly:task.metadata?.workspaceInstructionPendingInjection!==true});}

export class LocalTransport implements ProviderTransport {
  constructor(private db:DeckDatabase,private providers:Map<ProviderId,AgentProvider>){}
  async start(input:StartRunInput){
    const provider=this.providers.get(input.participant.provider)!;
    const project={id:input.workspace.projectId,name:input.projectName,path:input.workspace.canonicalPath,realPath:input.workspace.canonicalPath,enabled:true,error:null};
    const profile=await instructionProfile(this.db,input.workspace.id),snapshot=createWorkspaceInstructionSnapshot({workspaceId:input.workspace.id,workspaceName:input.workspace.displayName,canonicalPath:input.workspace.canonicalPath,profile});
    const level=participantAutomation(input.participant),created=await provider.createTask({project,prompt:promptWithWorkspaceInstructions(input.prompt,snapshot),title:input.title,...participantSettings(input.participant),permissionProfile:permissionProfile(input.participant),workMode:workMode(input.participant),runtimeProfile:input.runtimeProfile??"default",automationLevel:level,executionHostId:LOCAL_HOST_ID,workspaceId:input.workspace.id});
    return this.db.upsertTask({...created,prompt:input.prompt,executionHostId:LOCAL_HOST_ID,workspaceId:input.workspace.id,providerSessionId:created.providerSessionId??created.threadId,permissionProfile:permissionProfile(input.participant),workChainId:input.workChainId??null,metadata:{...created.metadata,automationLevel:level,collaborationParticipantId:input.participant.id,collaborationSessionId:input.participant.collaborationSessionId,...(input.collaborationMode?{collaborationMode:input.collaborationMode}:{}),workspaceInstructionSnapshot:snapshot}});
  }
  async status(task:DeckTask){const persisted=typeof (this.db as any).getTask==="function"?await this.db.getTask(task.id):null,current=persisted?{...task,...persisted,metadata:{...task.metadata,...persisted.metadata}}:task,next=await this.providers.get(current.provider)!.getTask(current);return next===current?current:this.db.upsertTask(next);}
  async followUp(task:DeckTask,prompt:string){const next=await this.providers.get(task.provider)!.sendMessage(task,followUpPrompt(task,prompt));return this.db.upsertTask({...next,...(next.id!==task.id?{prompt}:{}),metadata:workspaceInstructionFollowUpMetadata(task.metadata,next.metadata)});}
  async stop(task:DeckTask){const next=await this.providers.get(task.provider)!.stopTask(task);return this.db.upsertTask(next);}
  async deleteSession(task:DeckTask){const result=await this.providers.get(task.provider)!.deleteSession(task),removed=task.threadId?await this.db.deleteTaskSession(task.provider,task.threadId):0;return{...result,deletedTasks:result.deletedTasks+removed};}
}

export class RemoteWorkerTransport implements ProviderTransport {
  constructor(private db:DeckDatabase,private workerHub:WorkerHub){}
  private async claudeExecutionSettings(provider:ProviderId){if(provider!=="claude")return{};const stored=await this.db.getSystemSetting("claude.execution").catch(()=>null);return{claudeSwitchModelsOnFlag:normalizeClaudeExecutionSettings(stored?.value).switchModelsOnFlag};}
  private async repositorySources(hostId:string,workspaceId:string){const root=await this.workerHub.request(hostId,"workspace.files.browse",{workspaceId}) as any,candidates:Array<{name:string;id:string}>=(root?.entries??[]).filter((item:any)=>item.type==="file"&&["AGENTS.md","CLAUDE.md"].includes(item.name)).map((item:any)=>({name:item.name,id:item.id})),docs=(root?.entries??[]).find((item:any)=>item.type==="directory"&&item.name==="docs");if(docs){const listing=await this.workerHub.request(hostId,"workspace.files.browse",{workspaceId,entryId:docs.id}) as any,runbook=(listing?.entries??[]).find((item:any)=>item.type==="file"&&item.name==="WORKSPACE_RUNBOOK.md");if(runbook)candidates.push({name:"docs/WORKSPACE_RUNBOOK.md",id:runbook.id});}const sources:Array<{name:string;text:string}>=[];for(const candidate of candidates){const file=await this.workerHub.request(hostId,"workspace.files.read",{workspaceId,fileId:candidate.id,offset:0,limit:MAX_WORKSPACE_INSTRUCTION_FILE_BYTES+1}) as any;if(!file?.binary&&typeof file?.content==="string"&&file.nextOffset==null&&Buffer.byteLength(file.content,"utf8")<=MAX_WORKSPACE_INSTRUCTION_FILE_BYTES&&file.content.trim())sources.push({name:candidate.name,text:file.content.trim()});}return sources;}
  private async command(task:DeckTask,command:"provider.task.status"|"provider.task.stop"|"provider.session.resume",payload:Record<string,unknown>={}){
    if(!task.executionHostId)throw new Error("Remote host missing.");
    const executionPayload=command==="provider.session.resume"&&typeof payload.prompt==="string"?{...payload,prompt:followUpPrompt(task,payload.prompt)}:payload,result=await this.workerHub.request(task.executionHostId,command,{taskId:task.hostTaskId??task.id,provider:task.provider,workspaceId:task.workspaceId,...executionPayload,...(command==="provider.session.resume"?await this.claudeExecutionSettings(task.provider):{})}) as any;
    const status=result?.status??task.status,threadId=result?.threadId??task.threadId,providerSessionId=result?.threadId??task.providerSessionId,taskResult=result?.result??task.result,error=result?.error??task.error;
    if(status===task.status&&threadId===task.threadId&&providerSessionId===task.providerSessionId&&taskResult===task.result&&error===task.error&&command!=="provider.session.resume")return task;
    return this.db.upsertTask({...task,status,threadId,providerSessionId,result:taskResult,error,updatedAt:result?.updatedAt??new Date().toISOString(),metadata:command==="provider.session.resume"?workspaceInstructionFollowUpMetadata(task.metadata,undefined):task.metadata});
  }
  async start(input:StartRunInput){
    const timestamp=new Date().toISOString(),id=input.providerTaskId??`${input.participant.provider}:remote:${crypto.randomUUID()}`;
    const profile=await instructionProfile(this.db,input.workspace.id);let repositorySources:Array<{name:string;text:string}>|undefined;if(profile.enabled&&profile.sourceMode!=="managed")try{repositorySources=await this.repositorySources(input.participant.executionHostId,input.workspace.id);}catch{repositorySources=[];}const snapshot=createWorkspaceInstructionSnapshot({workspaceId:input.workspace.id,workspaceName:input.workspace.displayName,repositorySources,profile});
    const settings=participantSettings(input.participant),level=participantAutomation(input.participant),runtimeProfile=input.runtimeProfile??"default",result=await this.workerHub.request(input.participant.executionHostId,"provider.task.start",{taskId:id,provider:input.participant.provider,workspaceId:input.workspace.id,prompt:promptWithWorkspaceInstructions(input.prompt,snapshot),title:input.title,...settings,permissionProfile:permissionProfile(input.participant),workMode:workMode(input.participant),runtimeProfile,automationLevel:level,...await this.claudeExecutionSettings(input.participant.provider)}) as any;
    return this.db.upsertTask({id,provider:input.participant.provider,nativeId:String(result?.hostTaskId??id),threadId:result?.threadId??null,projectId:input.workspace.projectId,title:input.title,prompt:input.prompt,status:result?.status??"running",createdAt:timestamp,updatedAt:timestamp,result:result?.result??null,error:result?.error??null,log:"Remote collaboration task started.",owned:true,pid:null,pgid:null,processStart:null,commandMarker:null,parentThreadId:null,ownership:"claudex-workhouse",source:"claudex-workhouse",executionHostId:input.participant.executionHostId,workspaceId:input.workspace.id,remoteWorkerId:input.participant.executionHostId,hostTaskId:String(result?.hostTaskId??id),providerSessionId:result?.threadId??null,requestedModel:settings.model,requestedReasoningEffort:settings.reasoningEffort,requestedServiceTier:settings.serviceTier,permissionProfile:permissionProfile(input.participant),workChainId:input.workChainId??null,metadata:{collaborationParticipantId:input.participant.id,collaborationSessionId:input.participant.collaborationSessionId,...(input.collaborationMode?{collaborationMode:input.collaborationMode}:{}),workMode:workMode(input.participant),runtimeProfile,automationLevel:level,workspaceInstructionSnapshot:snapshot,...(result?.executionPolicy?{requestedAutomation:result.executionPolicy.requestedAutomation,effectiveSandbox:result.executionPolicy.effectiveSandbox,effectiveApprovalPolicy:result.executionPolicy.effectiveApprovalPolicy,executionBackend:result.executionPolicy.executionBackend,executionUiLabel:result.executionPolicy.uiLabel}:{})}});
  }
  status(task:DeckTask){return this.command(task,"provider.task.status");}
  followUp(task:DeckTask,prompt:string){return this.command(task,"provider.session.resume",{prompt,model:task.requestedModel,reasoningEffort:task.requestedReasoningEffort,serviceTier:task.requestedServiceTier,permissionProfile:task.permissionProfile,workMode:task.metadata?.workMode??"default",runtimeProfile:task.metadata?.runtimeProfile??"default",automationLevel:task.metadata?.automationLevel??"read"});}
  stop(task:DeckTask){return this.command(task,"provider.task.stop");}
  async deleteSession(task:DeckTask){
    if(!task.executionHostId||!task.threadId)throw Object.assign(new Error("Remote provider session identity is unavailable."),{statusCode:409});
    await this.workerHub.request(task.executionHostId,"provider.session.delete",{taskId:task.hostTaskId??task.id,provider:task.provider,threadId:task.threadId,workspaceId:task.workspaceId});
    const deletedTasks=await this.db.deleteTaskSession(task.provider,task.threadId);
    return{threadId:task.threadId,deleted:true as const,deletedTasks};
  }
}

export class CollaborationTransport {
  readonly local:LocalTransport;readonly remote:RemoteWorkerTransport;
  constructor(db:DeckDatabase,providers:Map<ProviderId,AgentProvider>,workerHub:WorkerHub){this.local=new LocalTransport(db,providers);this.remote=new RemoteWorkerTransport(db,workerHub);}
  forHost(hostId:string){return hostId===LOCAL_HOST_ID?this.local:this.remote;}
}
