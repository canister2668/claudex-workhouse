import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawn} from "node:child_process";
import {fileURLToPath} from "node:url";
import WebSocket from "ws";
import{z}from"zod";
import { WORKER_MAX_MESSAGE_BYTES, WORKER_PROTOCOL_VERSION, WORKER_UPDATER_PROTOCOL_VERSION, type WorkerCommand } from "../worker-protocol.js";
import { diagnostics, providerSessions, providerStatus, RemoteTaskManager,selectProviderBinary } from "./tasks.js";
import { loadWorkerConfig, saveWorkerConfig, workerHome, type WorkerConfig } from "./config.js";
import { createWorkspacePatch, resolveWorkerWorkspaceDownload, workspaceCommand } from "./workspaces.js";
import { WORKER_VERSION } from "./version.js";
import { gitHostStatus, listGitHubRepositories, setGitIdentity } from "../git-core.js";
import { sanitizeSensitiveObject, sanitizeSensitiveText } from "../sensitive-data.js";

function key(secret:string){return crypto.createHash("sha256").update(secret).digest();}
function hmac(secret:string,challenge:string){return crypto.createHmac("sha256",key(secret)).update(challenge).digest("hex");}
function websocketUrl(serverUrl:string,hostId:string){const url=new URL("/worker/connect",serverUrl);url.protocol=url.protocol==="https:"?"wss:":"ws:";url.searchParams.set("hostId",hostId);return url.toString();}
function accessHeaders():Record<string,string>{const id=process.env.CF_ACCESS_CLIENT_ID,secret=process.env.CF_ACCESS_CLIENT_SECRET;return id&&secret?{"CF-Access-Client-Id":id,"CF-Access-Client-Secret":secret}:{};}
function workerPackageSha256(){const configured=process.env.CLAUDEX_WORKHOUSE_WORKER_PACKAGE_SHA256?.trim().toLowerCase();if(configured&&/^[a-f0-9]{64}$/.test(configured))return configured;try{const root=process.platform==="win32"?path.dirname(process.execPath):path.dirname(path.dirname(process.execPath)),value=fs.readFileSync(path.join(root,".claudex-package-sha256"),"utf8").trim().toLowerCase();return /^[a-f0-9]{64}$/.test(value)?value:null;}catch{return null;}}
function safeError(error:unknown){
  const raw=error instanceof Error?error.message:"Worker command failed.";
  const message=sanitizeSensitiveText(raw);
  const category=(error as {code?:unknown})?.code;if(category==="SANDBOX_BOOTSTRAP_FAILED"||category==="AUTOMATIC_EXECUTION_BLOCKED")return{code:category,message:message.slice(0,300)};
  if(typeof category==="string"&&["FILE_VERSION_CONFLICT","SOURCE_TASK_WORKSPACE_MISMATCH","FILE_PATH_UNRESOLVED","INVALID_WORKSPACE_FILE_PATH","WORKSPACE_FILE_PATH_ESCAPE","WORKSPACE_FILE_NOT_FOUND","WORKSPACE_FILE_EXPECTED","WORKSPACE_FILE_ID_MISMATCH","GIT_METADATA_EDIT_BLOCKED","SYMLINK_EDIT_BLOCKED","WORKSPACE_FILE_EDIT_TOO_LARGE","WORKSPACE_DOWNLOAD_TOO_LARGE","WORKSPACE_FILE_INVALID_UTF8","WORKSPACE_FILE_CONTROL_CHARACTERS","WORKSPACE_FILE_MIXED_LINE_ENDINGS","WORKSPACE_FILE_NOT_EDITABLE","APPROVAL_DECISION_UNSUPPORTED","APPROVAL_SCOPE_UNSUPPORTED","APPROVAL_NOT_PENDING","APPROVAL_EXPIRED","APPROVAL_ALREADY_ANSWERED"].includes(category))return{code:category,message:message.slice(0,300)};
  if(/workspace|root|path|directory|git/i.test(raw))return{code:"WORKSPACE_OPERATION_FAILED",message:message.slice(0,300)};
  if(/provider|claude|codex|runtime|task|session/i.test(raw))return{code:"PROVIDER_OPERATION_FAILED",message:message.slice(0,300)};
  return{code:"WORKER_COMMAND_FAILED",message:"Worker command failed."};
}

export class DesktopWorkerClient {
  private config:WorkerConfig;
  private socket:WebSocket|null=null;
  private generation:string|null=null;
  private sequenceOut=1;
  private sequenceIn=0;
  private heartbeat:NodeJS.Timeout|null=null;
  private stopped=false;
  private reconnectMs=1000;
  private receipts=new Map<string,{at:number;result:unknown}>();
  private patchTransfers=new Map<string,{createdAt:number;value:Buffer}>();
  private incomingHandoffs=new Map<string,{createdAt:number;files:Record<string,{size:number;checksum:string;chunks:Buffer[];received:number}>}>();
  private downloads=new Map<string,{createdAt:number;descriptor:number;size:number;offset:number;name:string;relativePath:string;modifiedAt:string}>();
  private tasks:RemoteTaskManager;
  private home:string;
  constructor(config=loadWorkerConfig(),private onState:(state:"connecting"|"online"|"offline"|"stopped",message?:string)=>void=()=>{}){this.config=config;this.home=config.runtimeHome??workerHome();this.tasks=new RemoteTaskManager(config,(taskId,eventId,event)=>this.sendEvent(taskId,eventId,event),()=>this.sendSnapshot());}
  private persist(){saveWorkerConfig(this.config,this.home);}
  async run(){if(!this.config.serverUrl||!this.config.hostId||!this.config.credential)throw new Error("Worker is not paired.");this.stopped=false;this.onState("connecting");while(!this.stopped){try{await this.connect();this.reconnectMs=1000;this.onState("online");await new Promise<void>(resolve=>this.socket!.once("close",()=>resolve()));if(!this.stopped)this.onState("offline","The server connection dropped; reconnecting.");}catch(error){if(this.stopped)break;const message=sanitizeSensitiveText(error instanceof Error?error.message:String(error));this.onState("offline",message);process.stderr.write(`${message}\n`);}if(!this.stopped){await new Promise(resolve=>setTimeout(resolve,this.reconnectMs+Math.floor(Math.random()*500)));this.reconnectMs=Math.min(30_000,this.reconnectMs*2);this.onState("connecting");}}this.onState("stopped");}
  private async connect(){return new Promise<void>((resolve,reject)=>{const socket=new WebSocket(websocketUrl(this.config.serverUrl!,this.config.hostId!),{maxPayload:WORKER_MAX_MESSAGE_BYTES,perMessageDeflate:false,headers:accessHeaders()});this.socket=socket;let authenticated=false;const timer=setTimeout(()=>{socket.terminate();reject(new Error("Worker authentication timed out."));},15_000);
    socket.once("error",reject);socket.on("message",raw=>{void(async()=>{let message:any;try{message=JSON.parse(raw.toString());}catch{socket.close(1008,"invalid JSON");return;}
      if(message.type==="auth.challenge"&&!authenticated){if(message.protocolVersion!==WORKER_PROTOCOL_VERSION){socket.close(1008,"protocol mismatch");return;}socket.send(JSON.stringify({type:"auth.response",hostId:this.config.hostId,challengeId:message.challengeId,response:hmac(this.config.credential!,message.challenge),sequence:1,workerVersion:WORKER_VERSION,packageSha256:workerPackageSha256(),updaterProtocolVersion:WORKER_UPDATER_PROTOCOL_VERSION}));return;}
      if(message.type==="auth.accepted"&&!authenticated){authenticated=true;clearTimeout(timer);this.generation=message.generation;this.sequenceIn=0;this.sequenceOut=1;if(this.config.previousCredential){this.config.previousCredential=null;this.config.previousCredentialExpiresAt=null;this.persist();}this.confirmApplicationUpdate();this.startHeartbeat();this.sendSnapshot();resolve();return;}
      if(!authenticated||message.generation!==this.generation||!Number.isSafeInteger(message.sequence)||message.sequence<=this.sequenceIn){socket.close(1008,"invalid sequence");return;}this.sequenceIn=message.sequence;if(message.type==="request")await this.handleRequest(message);
    })().catch(()=>socket.close(1011,"handler failure"));});socket.once("close",(code,reason)=>{clearTimeout(timer);this.stopHeartbeat();this.generation=null;if(!authenticated){if(code===1008&&reason.toString().includes("auth failed")&&this.config.previousCredential&&new Date(this.config.previousCredentialExpiresAt??0).getTime()>Date.now()){this.config.credential=this.config.previousCredential;this.config.previousCredential=null;this.config.previousCredentialExpiresAt=null;this.config.credentialVersion=Math.max(1,this.config.credentialVersion-1);this.persist();}reject(new Error("Worker connection closed before authentication."));}});});}
  private send(value:Record<string,unknown>){if(!this.socket||this.socket.readyState!==WebSocket.OPEN||!this.generation)return false;this.socket.send(JSON.stringify({...value,generation:this.generation,sequence:++this.sequenceOut}));return true;}
  private sendEvent(taskId:string,eventId:string,event:Record<string,unknown>){return this.send({type:"event",eventId,taskId,event:sanitizeSensitiveObject(event,{preserveSourceIdentifiers:true})});}
  private startHeartbeat(){this.stopHeartbeat();const tick=()=>this.send({type:"heartbeat",sentAt:new Date().toISOString(),snapshot:this.capabilities()});tick();this.heartbeat=setInterval(tick,10_000);this.heartbeat.unref?.();}
  private stopHeartbeat(){if(this.heartbeat)clearInterval(this.heartbeat);this.heartbeat=null;}
  private sendSnapshot(){this.send({type:"snapshot",tasks:this.tasks.list(),capabilities:this.capabilities()});}
  private updateResult(){try{const directory=path.join(this.home,"updates"),files=fs.readdirSync(directory).filter(name=>/^[0-9a-f-]{36}\.result\.json$/i.test(name)).map(name=>path.join(directory,name)).sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs),value=JSON.parse(fs.readFileSync(files[0],"utf8"));return value?.schemaVersion===1&&/^[0-9a-f-]{36}$/i.test(value.attemptId)?{attemptId:value.attemptId,state:String(value.state??"unknown"),version:String(value.version??""),rollbackPerformed:value.rollbackPerformed===true,error:typeof value.error==="string"?value.error.slice(0,500):null,completedAt:typeof value.completedAt==="string"?value.completedAt:null}:null;}catch{return null;}}
  private confirmApplicationUpdate(){try{const value=this.updateResult(),packageSha256=workerPackageSha256();if(value?.state!=="restarting"||value.version!==WORKER_VERSION||!packageSha256)return;const directory=path.join(this.home,"updates"),file=path.join(directory,`${value.attemptId}.confirmed.json`),temporary=`${file}.${process.pid}.tmp`;if(fs.existsSync(file))return;fs.writeFileSync(temporary,`${JSON.stringify({schemaVersion:1,attemptId:value.attemptId,version:WORKER_VERSION,packageSha256,confirmedAt:new Date().toISOString()},null,2)}\n`,{mode:0o600,flag:"wx"});fs.renameSync(temporary,file);}catch{}}
    private capabilities(){return{protocolVersion:WORKER_PROTOCOL_VERSION,updaterProtocolVersion:WORKER_UPDATER_PROTOCOL_VERSION,packageSha256:workerPackageSha256(),applicationUpdateResult:this.updateResult(),platform:process.platform,architecture:process.arch,operatingSystemVersion:os.release(),workerVersion:WORKER_VERSION,managedLocal:this.config.managedLocal===true,automationLevelsByProvider:{claude:["full","auto","read"],codex:["full","auto","confirm","read"],deepseek:["full","auto","read"],ollama:["full","auto","read"],antigravity:["full","auto","read"],grok:["full","auto","read"]},providerCapabilities:this.tasks.capabilities(),commands:["host.capabilities.read","host.diagnostics.read","host.credential.rotate","host.update.apply","provider.status.read","provider.binary.select","provider.capabilities.read","provider.thread.command","provider.task.start","provider.task.stop","provider.task.status","provider.session.resume","provider.session.fork","provider.session.compact","provider.session.delete","provider.approvals.list","provider.approval.respond","provider.userInput.list","provider.userInput.respond","provider.session.control","task.image-output.prepare","task.image-output.chunk","task.image-output.cancel","git.host.status","git.host.identity","git.github.repositories","workspace.list","workspace.browse","workspace.create","workspace.register","workspace.update","workspace.git.clone","workspace.git.worktree","workspace.git.status","workspace.git.diff","workspace.git.diff-path","workspace.git.operation","workspace.git.log","workspace.git.branches","workspace.github.pr.preview","workspace.github.pr.create","workspace.files.browse","workspace.files.resolve","workspace.files.edit.read","workspace.files.write","workspace.files.read","workspace.files.download.prepare","workspace.files.download.chunk","workspace.files.download.cancel","workspace.unregister","workspace.delete","handoff.receive.begin","handoff.receive.chunk","handoff.receive.complete","handoff.patch.prepare","handoff.patch.chunk"],roots:this.config.roots.map(item=>({id:item.id,displayName:item.displayName,allowCreate:item.allowCreate,allowRegister:item.allowRegister,allowClone:item.allowClone,allowDelete:item.allowDelete}))};}
  private async handleRequest(message:{requestId:string;command:WorkerCommand;payload:any;idempotencyKey:string}){const existing=this.receipts.get(message.idempotencyKey);if(existing&&Date.now()-existing.at<24*60*60_000){this.send({type:"response",requestId:message.requestId,ok:true,result:existing.result});return;}try{const result=await this.execute(message.command,message.payload);this.receipts.set(message.idempotencyKey,{at:Date.now(),result});if(this.receipts.size>1000)for(const[key,value]of this.receipts)if(Date.now()-value.at>24*60*60_000)this.receipts.delete(key);this.send({type:"response",requestId:message.requestId,ok:true,result});}catch(error){this.send({type:"response",requestId:message.requestId,ok:false,error:safeError(error)});}}
  private async execute(command:WorkerCommand,payload:any){
    if(command==="host.capabilities.read")return this.capabilities();
    if(command==="host.diagnostics.read")return diagnostics(this.config,this.tasks);
    if(command==="host.credential.rotate"){const credential=crypto.randomBytes(32).toString("base64url");this.config.previousCredential=this.config.credential;this.config.previousCredentialExpiresAt=new Date(Date.now()+10*60_000).toISOString();this.config.credential=credential;this.config.credentialVersion++;this.persist();return{credentialHash:crypto.createHash("sha256").update(credential).digest("hex"),credentialVersion:this.config.credentialVersion};}
    if(command==="host.update.apply")return this.applyUpdate(payload);
    if(command==="provider.status.read")return providerStatus(this.config);
    if(command==="provider.binary.select"){const body=z.object({provider:z.enum(["codex","claude"]),path:z.string().trim().min(1).max(4096)}).parse(payload);return selectProviderBinary(this.config,body.provider,body.path);}
    if(command==="provider.sessions.list")return providerSessions(this.config,this.tasks);
    if(command.startsWith("provider."))return this.tasks.command(command,payload);
    if(command==="git.host.status")return gitHostStatus();
    if(command==="git.host.identity")return setGitIdentity(process.cwd(),payload);
    if(command==="git.github.repositories")return listGitHubRepositories(process.cwd(),payload);
    if(command==="workspace.files.download.prepare")return this.prepareDownload(payload);
    if(command==="workspace.files.download.chunk")return this.downloadChunk(payload);
    if(command==="workspace.files.download.cancel")return this.cancelDownload(payload);
    if(command==="task.image-output.prepare")return this.prepareTaskImageOutput(payload);
    if(command==="task.image-output.chunk")return this.downloadChunk(payload);
    if(command==="task.image-output.cancel")return this.cancelDownload(payload);
    if(command.startsWith("workspace.")){const result=await workspaceCommand(this.config,command,payload,this.config.hostId!);this.persist();return result;}
    if(command==="handoff.receive")return this.receiveHandoff(payload);
    if(command==="handoff.patch.prepare")return this.preparePatch(payload);
    if(command==="handoff.patch.chunk")return this.patchChunk(payload);
    if(command==="handoff.receive.begin")return this.beginHandoff(payload);
    if(command==="handoff.receive.chunk")return this.handoffChunk(payload);
    if(command==="handoff.receive.complete")return this.completeHandoff(payload);
    throw new Error("Unsupported worker command.");
  }
  private applyUpdate(payload:any){
    const metadata=payload?.metadata,attemptId=String(payload?.attemptId??"");
    if(!/^[0-9a-f-]{36}$/i.test(attemptId)||metadata?.schemaVersion!==1||metadata?.version!==payload?.targetVersion||!["windows","linux"].includes(metadata?.platform))throw Object.assign(new Error("Worker update request is invalid."),{code:"WORKER_UPDATE_INVALID"});
    const hostPlatform=process.platform==="win32"?"windows":process.platform;if(metadata.platform!==hostPlatform||metadata.architecture!==process.arch)throw Object.assign(new Error("Worker update target does not match this host."),{code:"WORKER_UPDATE_TARGET_MISMATCH"});
    const active=this.tasks.list().filter(task=>["pending","queued","running","waiting","unknown"].includes(String(task.status)));if(active.length)throw Object.assign(new Error("Worker update is blocked by active jobs."),{code:"WORKER_UPDATE_ACTIVE_TASKS"});
    const installRoot=process.platform==="win32"?path.dirname(process.execPath):path.dirname(path.dirname(process.execPath)),updates=path.join(this.home,"updates"),runtime=path.join(updates,`.runtime-${attemptId}`),requestFile=path.join(updates,`${attemptId}.request.json`),updaterSource=path.join(path.dirname(fileURLToPath(import.meta.url)),"updater.js"),runtimeBinary=path.join(runtime,process.platform==="win32"?"node.exe":"node"),updater=path.join(runtime,"updater.js");
    if(!fs.existsSync(updaterSource)||fs.existsSync(requestFile)||fs.existsSync(runtime))throw Object.assign(new Error("Worker update runtime is unavailable."),{code:"WORKER_UPDATE_RUNTIME_UNAVAILABLE"});
    fs.mkdirSync(runtime,{recursive:true,mode:0o700});fs.copyFileSync(process.execPath,runtimeBinary);fs.copyFileSync(updaterSource,updater);try{fs.chmodSync(runtimeBinary,0o700);fs.chmodSync(updater,0o600);}catch{}
    const request={schemaVersion:1,attemptId,parentPid:process.pid,installRoot,workerHome:this.home,metadata};const temporary=`${requestFile}.${process.pid}.tmp`;fs.writeFileSync(temporary,`${JSON.stringify(request,null,2)}\n`,{mode:0o600,flag:"wx"});fs.renameSync(temporary,requestFile);
    const child=spawn(runtimeBinary,[updater,requestFile],{detached:true,stdio:"ignore",windowsHide:true});child.unref();setTimeout(()=>{this.stop();process.exit(0);},750).unref?.();return{accepted:true,attemptId,restarting:true};
  }
  private receiveHandoff(payload:any){if(!/^[0-9a-f-]{36}$/i.test(payload.artifactId??""))throw new Error("Invalid artifact ID.");const markdown=Buffer.from(String(payload.markdownBase64??""),"base64");const manifest=Buffer.from(String(payload.manifestBase64??""),"base64");const patch=payload.patchBase64?Buffer.from(String(payload.patchBase64),"base64"):null;if(markdown.length>1024*1024||manifest.length>256*1024||(patch&&patch.length>8*1024*1024))throw new Error("Handoff artifact is too large.");const dir=path.join(this.home,"artifacts",payload.artifactId);fs.mkdirSync(dir,{recursive:true,mode:0o700});fs.writeFileSync(path.join(dir,"handoff.md"),markdown,{mode:0o600,flag:"wx"});fs.writeFileSync(path.join(dir,"manifest.json"),manifest,{mode:0o600,flag:"wx"});if(patch)fs.writeFileSync(path.join(dir,"changes.patch"),patch,{mode:0o600,flag:"wx"});return{received:true,artifactId:payload.artifactId};}
  private cleanupTransfers(){const cutoff=Date.now()-5*60_000;for(const[id,value]of this.patchTransfers)if(value.createdAt<cutoff)this.patchTransfers.delete(id);for(const[id,value]of this.incomingHandoffs)if(value.createdAt<cutoff)this.incomingHandoffs.delete(id);for(const[id,value]of this.downloads)if(value.createdAt<cutoff){try{fs.closeSync(value.descriptor);}catch{}this.downloads.delete(id);}}
  private prepareDownload(payload:any){
    this.cleanupTransfers();
    const target=resolveWorkerWorkspaceDownload(this.config,String(payload.workspaceId??""),String(payload.path??"")),descriptor=fs.openSync(target.real,"r"),opened=fs.fstatSync(descriptor);
    if(opened.dev!==target.device||opened.ino!==target.inode||opened.size!==target.size){fs.closeSync(descriptor);throw new Error("Download file changed during verification.");}
    const transferId=crypto.randomUUID();this.downloads.set(transferId,{createdAt:Date.now(),descriptor,size:target.size,offset:0,name:target.name,relativePath:target.relativePath,modifiedAt:target.modifiedAt});
    return{transferId,name:target.name,relativePath:target.relativePath,size:target.size,modifiedAt:target.modifiedAt};
  }
  private prepareTaskImageOutput(payload:any){
    this.cleanupTransfers();
    const target=this.tasks.resolveImageOutput(String(payload.taskId??""),String(payload.path??"")),descriptor=fs.openSync(target.real,"r"),opened=fs.fstatSync(descriptor);
    if(opened.size!==target.size){fs.closeSync(descriptor);throw new Error("Task image output changed during verification.");}
    const transferId=crypto.randomUUID();this.downloads.set(transferId,{createdAt:Date.now(),descriptor,size:target.size,offset:0,name:target.name,relativePath:String(payload.path),modifiedAt:target.modifiedAt});
    return{transferId,name:target.name,relativePath:String(payload.path),size:target.size,modifiedAt:target.modifiedAt};
  }
  private downloadChunk(payload:any){
    this.cleanupTransfers();
    const transferId=String(payload.transferId??""),transfer=this.downloads.get(transferId),offset=Number(payload.offset??-1);
    if(!transfer||!Number.isSafeInteger(offset)||offset!==transfer.offset)throw new Error("Download transfer is unavailable.");
    const length=Math.min(256*1024,transfer.size-offset),buffer=Buffer.alloc(length),read=length?fs.readSync(transfer.descriptor,buffer,0,length,offset):0;
    if(read!==length){try{fs.closeSync(transfer.descriptor);}catch{}this.downloads.delete(transferId);throw new Error("Download file changed while it was being read.");}
    transfer.offset+=read;transfer.createdAt=Date.now();const done=transfer.offset>=transfer.size;
    if(done){try{fs.closeSync(transfer.descriptor);}catch{}this.downloads.delete(transferId);}
    return{offset,dataBase64:buffer.subarray(0,read).toString("base64"),done};
  }
  private cancelDownload(payload:any){const transferId=String(payload.transferId??""),transfer=this.downloads.get(transferId);if(transfer){try{fs.closeSync(transfer.descriptor);}catch{}this.downloads.delete(transferId);}return{cancelled:Boolean(transfer)};}
  private async preparePatch(payload:any){this.cleanupTransfers();if(typeof payload.workspaceId!=="string")throw new Error("Invalid workspace.");const value=await createWorkspacePatch(this.config,payload.workspaceId),transferId=crypto.randomUUID();this.patchTransfers.set(transferId,{createdAt:Date.now(),value});return{transferId,size:value.length,checksum:crypto.createHash("sha256").update(value).digest("hex")};}
  private patchChunk(payload:any){this.cleanupTransfers();const transfer=this.patchTransfers.get(String(payload.transferId??"")),offset=Number(payload.offset??-1);if(!transfer||!Number.isSafeInteger(offset)||offset<0||offset>transfer.value.length)throw new Error("Patch transfer is unavailable.");const chunk=transfer.value.subarray(offset,Math.min(transfer.value.length,offset+512*1024)),done=offset+chunk.length>=transfer.value.length;if(done)this.patchTransfers.delete(payload.transferId);return{offset,dataBase64:chunk.toString("base64"),done};}
  private beginHandoff(payload:any){this.cleanupTransfers();const artifactId=String(payload.artifactId??"");if(!/^[0-9a-f-]{36}$/i.test(artifactId)||this.incomingHandoffs.has(artifactId))throw new Error("Invalid handoff transfer.");const limits:Record<string,number>={markdown:1024*1024,manifest:256*1024,patch:8*1024*1024},files:Record<string,{size:number;checksum:string;chunks:Buffer[];received:number}>={};for(const[name,raw]of Object.entries(payload.files??{}) as Array<[string,any]>){if(!(name in limits)||!Number.isSafeInteger(raw.size)||raw.size<0||raw.size>limits[name]||!/^[a-f0-9]{64}$/.test(raw.checksum))throw new Error("Invalid handoff file metadata.");files[name]={size:raw.size,checksum:raw.checksum,chunks:[],received:0};}if(!files.markdown||!files.manifest)throw new Error("Handoff metadata is incomplete.");this.incomingHandoffs.set(artifactId,{createdAt:Date.now(),files});return{ready:true};}
  private handoffChunk(payload:any){const transfer=this.incomingHandoffs.get(String(payload.artifactId??"")),file=transfer?.files[String(payload.file??"")],offset=Number(payload.offset??-1),chunk=Buffer.from(String(payload.dataBase64??""),"base64");if(!transfer||!file||offset!==file.received||chunk.length>512*1024||file.received+chunk.length>file.size)throw new Error("Invalid handoff chunk.");file.chunks.push(chunk);file.received+=chunk.length;return{received:file.received};}
  private completeHandoff(payload:any){const artifactId=String(payload.artifactId??""),transfer=this.incomingHandoffs.get(artifactId);if(!transfer)throw new Error("Handoff transfer is unavailable.");const values:Record<string,Buffer>={};for(const[name,file]of Object.entries(transfer.files)){const value=Buffer.concat(file.chunks);if(value.length!==file.size||crypto.createHash("sha256").update(value).digest("hex")!==file.checksum)throw new Error("Handoff checksum validation failed.");values[name]=value;}const base=path.join(this.home,"artifacts"),temporary=path.join(base,`.${artifactId}.tmp`),final=path.join(base,artifactId);fs.mkdirSync(base,{recursive:true,mode:0o700});if(fs.existsSync(final))throw new Error("Handoff artifact already exists.");fs.mkdirSync(temporary,{mode:0o700});try{fs.writeFileSync(path.join(temporary,"handoff.md"),values.markdown,{mode:0o600,flag:"wx"});fs.writeFileSync(path.join(temporary,"manifest.json"),values.manifest,{mode:0o600,flag:"wx"});if(values.patch)fs.writeFileSync(path.join(temporary,"changes.patch"),values.patch,{mode:0o600,flag:"wx"});fs.renameSync(temporary,final);this.incomingHandoffs.delete(artifactId);return{received:true,artifactId};}catch(error){fs.rmSync(temporary,{recursive:true,force:true});throw error;}}
  stop(){this.stopped=true;this.stopHeartbeat();this.socket?.close(1000,"worker stopped");this.tasks.close();for(const transfer of this.downloads.values())try{fs.closeSync(transfer.descriptor);}catch{}this.downloads.clear();this.onState("stopped");}
}

export async function pairWorker(serverUrl:string,code:string,displayName:string){
  const config=loadWorkerConfig(),response=await fetch(new URL("/worker/pair",serverUrl),{method:"POST",redirect:"manual",headers:{"content-type":"application/json",...accessHeaders()},body:JSON.stringify({code,displayName,platform:process.platform,architecture:process.arch,operatingSystemVersion:os.release(),workerVersion:WORKER_VERSION}),signal:AbortSignal.timeout(30_000)});
  const location=response.headers.get("location")??"",contentType=response.headers.get("content-type")??"",cloudflareBlocked=/cloudflareaccess\.com|\/cdn-cgi\/access\//i.test(`${location} ${response.url}`);
  if(cloudflareBlocked)throw new Error("Cloudflare Access blocked the worker connection. Add a bypass policy for /worker/* or configure a worker service token.");
  if(!response.ok){let detail="";if(/application\/json/i.test(contentType)){const value=await response.json().catch(()=>null) as any;detail=typeof value?.error==="string"?value.error:"";}throw new Error(detail||`Pairing failed (${response.status}).`);}
  if(!/application\/json/i.test(contentType))throw new Error("Pairing server returned a non-JSON response.");
  const value=await response.json() as any;if(!value.hostId||!value.credential)throw new Error("Pairing response was incomplete.");config.serverUrl=new URL(serverUrl).origin;config.hostId=value.hostId;config.credential=value.credential;config.credentialVersion=value.credentialVersion??1;config.previousCredential=null;config.previousCredentialExpiresAt=null;saveWorkerConfig(config);return{hostId:config.hostId,serverUrl:config.serverUrl};
}
