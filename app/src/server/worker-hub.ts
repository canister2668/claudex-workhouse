import crypto from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type WebSocket from "ws";
import { z } from "zod";
import type { DeckDatabase } from "./db/client.js";
import { readStreamEvents, StreamSpool } from "./stream-events.js";
import { WORKER_COMMANDS, WORKER_MAX_MESSAGE_BYTES, WORKER_PROTOCOL_VERSION, type WorkerCommand, type WorkerRequestMessage, workerHelloSchema, workerMessageSchema } from "./worker-protocol.js";
import { sanitizeSensitiveObject, sanitizeSensitiveText } from "./sensitive-data.js";
import{isLoopbackAddress}from"./security/auth.js";

type Pairing = {id:string;codeHash:string;createdAt:number;expiresAt:number;usedAt:number|null;status:"waiting"|"paired"|"expired";hostId:string|null;displayName:string|null};
type Connection = {hostId:string;socket:WebSocket;generation:string;ready:boolean;sequenceIn:number;sequenceOut:number;lastSeen:number;rateWindow:number;rateCount:number;pending:Map<string,{command:WorkerCommand;resolve(value:unknown):void;reject(error:Error):void;timer:NodeJS.Timeout}>};
const PAIR_TTL_MS=10*60*1000;
const COMMAND_TIMEOUT_MS=30_000;
const base32="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function pairingCode(){const bytes=crypto.randomBytes(12);let out="";for(const byte of bytes)out+=base32[byte%base32.length];return `${out.slice(0,4)}-${out.slice(4,8)}-${out.slice(8,12)}`;}
function digest(value:string){return crypto.createHash("sha256").update(value).digest("hex");}
function responseFor(keyHex:string,challenge:string){return crypto.createHmac("sha256",Buffer.from(keyHex,"hex")).update(challenge).digest("hex");}
function now(){return new Date().toISOString();}
export function workerConnectionOriginAllowed(hostId:string,address:string){return hostId!=="local"||isLoopbackAddress(address);}

export class WorkerHub {
  private pairings=new Map<string,Pairing>();
  private connections=new Map<string,Connection>();
  private eventIds=new Map<string,Map<string,number>>();
  private pendingEvents=new Map<string,Array<{hostId:string;eventId:string;event:Record<string,unknown>}>>();
  private totalAttempts=new Map<string,{count:number;reset:number}>();
  private reaper:NodeJS.Timeout;
  private hostOfflineHandler:((hostId:string)=>void|Promise<void>)|null=null;
  constructor(private db:DeckDatabase,private root:string){this.reaper=setInterval(()=>{void this.reap().catch(()=>{});},10_000);this.reaper.unref?.();}

  createPairing(){
    const id=crypto.randomUUID(),code=pairingCode(),timestamp=Date.now();
    this.pairings.set(id,{id,codeHash:digest(code.replaceAll("-","").toUpperCase()),createdAt:timestamp,expiresAt:timestamp+PAIR_TTL_MS,usedAt:null,status:"waiting",hostId:null,displayName:null});
    return{id,code,expiresAt:new Date(timestamp+PAIR_TTL_MS).toISOString()};
  }
  onHostOffline(handler:(hostId:string)=>void|Promise<void>){this.hostOfflineHandler=handler;}
  pairingStatus(id:string){const attempt=this.pairings.get(id);if(!attempt)return null;if(attempt.expiresAt<Date.now()&&attempt.status==="waiting")attempt.status="expired";return{id:attempt.id,status:attempt.status,expiresAt:new Date(attempt.expiresAt).toISOString(),hostId:attempt.hostId,displayName:attempt.displayName};}

  async claimPairing(input:{code:string;displayName:string;platform:string;architecture:string;operatingSystemVersion?:string;workerVersion:string},ip:string){
    const rate=this.totalAttempts.get(ip)??{count:0,reset:Date.now()+10*60*1000};if(rate.reset<Date.now()){rate.count=0;rate.reset=Date.now()+10*60*1000;}rate.count++;this.totalAttempts.set(ip,rate);if(rate.count>20)throw Object.assign(new Error("Too many pairing attempts."),{statusCode:429});
    const codeHash=digest(input.code.replaceAll("-","").toUpperCase());
    const attempt=[...this.pairings.values()].find((item)=>item.status==="waiting"&&item.expiresAt>Date.now()&&crypto.timingSafeEqual(Buffer.from(item.codeHash,"hex"),Buffer.from(codeHash,"hex")));
    if(!attempt)throw Object.assign(new Error("Pairing code is invalid or expired."),{statusCode:401});
    attempt.status="paired";attempt.usedAt=Date.now();attempt.displayName=input.displayName;
    const hostId=crypto.randomUUID(),credential=crypto.randomBytes(32).toString("base64url"),credentialHash=digest(credential),timestamp=now();attempt.hostId=hostId;
    await this.db.upsertHost({id:hostId,type:"worker",name:`worker-${hostId.slice(0,8)}`,displayName:input.displayName,platform:input.platform,architecture:input.architecture,operatingSystemVersion:input.operatingSystemVersion??null,workerVersion:input.workerVersion,status:"connecting",capabilities:{},lastSeenAt:null,createdAt:timestamp,updatedAt:timestamp,disabledAt:null,revokedAt:null});
    await this.db.putWorkerCredential({hostId,credentialHash,credentialVersion:1,createdAt:timestamp});
    return{hostId,credential,credentialVersion:1,protocolVersion:WORKER_PROTOCOL_VERSION};
  }

  async register(app:FastifyInstance){
    app.post("/worker/pair",{config:{rateLimit:{max:20,timeWindow:"10 minutes"}}},async(request,reply)=>{
      reply.header("Cache-Control","no-store");const body=z.object({code:z.string().min(8).max(32),displayName:z.string().trim().min(1).max(80),platform:z.enum(["win32","linux","darwin"]),architecture:z.string().min(1).max(30),operatingSystemVersion:z.string().max(120).optional(),workerVersion:z.string().min(1).max(40)}).strict().parse(request.body);
      return this.claimPairing(body,request.ip);
    });
    app.get("/worker/connect",{websocket:true},(socket:WebSocket,request:FastifyRequest)=>{void this.accept(socket,request).catch(()=>socket.close(1011,"connection setup failed"));});
  }

  private async appendEvent(hostId:string,taskId:string,eventId:string,rawEvent:Record<string,unknown>){
    const task=await this.db.getTask(taskId);if(!task||task.executionHostId!==hostId)return false;
    let seen=this.eventIds.get(hostId);if(!seen){seen=new Map();this.eventIds.set(hostId,seen);}const loaded=`__loaded__:${task.id}`;if(!seen.has(loaded)){for(const event of readStreamEvents(this.root,task.id,0,2000).events){const source=event.metadata?.sourceWorkerEventId;if(typeof source==="string")seen.set(source,Date.now());}seen.set(loaded,Date.now());}if(seen.has(eventId))return true;seen.set(eventId,Date.now());if(seen.size>20_000)for(const[id,at]of seen)if(Date.now()-at>24*60*60_000||seen.size>15_000)seen.delete(id);
    const event=sanitizeSensitiveObject(rawEvent,{preserveSourceIdentifiers:true}) as any;new StreamSpool(this.root,task.id,task.provider).append({...event,metadata:{...(event.metadata??{}),sourceWorkerEventId:eventId,sourceHostId:hostId}});return true;
  }
  async taskRegistered(taskId:string){const pending=this.pendingEvents.get(taskId);if(!pending)return;this.pendingEvents.delete(taskId);for(const item of pending)await this.appendEvent(item.hostId,taskId,item.eventId,item.event);}

  private async accept(socket:WebSocket,request:FastifyRequest){
    const query=z.object({hostId:z.union([z.string().uuid(),z.literal("local")])}).safeParse(request.query);if(!query.success){socket.close(1008,"invalid host");return;}
    if(!workerConnectionOriginAllowed(query.data.hostId,request.ip||(request.raw.socket.remoteAddress??""))){socket.close(1008,"managed local worker requires loopback");return;}
    const hostId=query.data.hostId,[registeredHost,credential]=await Promise.all([this.db.getHost(hostId),this.db.getWorkerCredential(hostId)]);if(!credential||credential.revokedAt){socket.close(1008,"revoked");return;}if(!registeredHost||registeredHost.status==="disabled"||registeredHost.disabledAt){socket.close(1008,"disabled");return;}
    const challengeId=crypto.randomUUID(),challenge=crypto.randomBytes(32).toString("base64url");socket.send(JSON.stringify({type:"auth.challenge",challengeId,challenge,protocolVersion:WORKER_PROTOCOL_VERSION}));
    const timer=setTimeout(()=>socket.close(1008,"auth timeout"),10_000);let authenticated=false;
    const authenticate=async(raw:WebSocket.RawData)=>{
      if(authenticated)return;let parsed:unknown;try{if(Buffer.byteLength(raw as any)>WORKER_MAX_MESSAGE_BYTES)throw new Error();parsed=JSON.parse(raw.toString());}catch{socket.close(1009,"invalid message");return;}
      const hello=workerHelloSchema.safeParse(parsed);const expected=responseFor(credential.credentialHash,challenge);
      if(!hello.success||hello.data.hostId!==hostId||hello.data.challengeId!==challengeId||!crypto.timingSafeEqual(Buffer.from(hello.data.response,"hex"),Buffer.from(expected,"hex"))){socket.close(1008,"auth failed");return;}
      authenticated=true;clearTimeout(timer);socket.off("message",onFirst);
      const generation=crypto.randomUUID();const previous=this.connections.get(hostId);if(previous){previous.socket.close(4001,"replaced");this.rejectPending(previous,new Error("Worker connection replaced."));}
      const connection:Connection={hostId,socket,generation,ready:false,sequenceIn:1,sequenceOut:0,lastSeen:Date.now(),rateWindow:Date.now(),rateCount:0,pending:new Map()};this.connections.set(hostId,connection);
      socket.on("message",raw=>{void this.message(connection,raw).catch(()=>{if(this.connections.get(hostId)===connection)socket.close(1011,"message handling failed");});});
      socket.once("close",()=>{void this.disconnected(connection).catch(()=>{});});socket.once("error",()=>{void this.disconnected(connection).catch(()=>{});});
      const timestamp=now();const host=await this.db.getHost(hostId);if(host)await this.db.upsertHost({...host,workerVersion:hello.data.workerVersion,status:"online",lastSeenAt:timestamp,updatedAt:timestamp,capabilities:{...host.capabilities,protocolVersion:WORKER_PROTOCOL_VERSION,updaterProtocolVersion:hello.data.updaterProtocolVersion,packageSha256:hello.data.packageSha256}});
      if(this.connections.get(hostId)===connection&&socket.readyState===socket.OPEN){connection.ready=true;socket.send(JSON.stringify({type:"auth.accepted",generation,heartbeatIntervalMs:10_000,maxMessageBytes:WORKER_MAX_MESSAGE_BYTES}));}
    };
    const onFirst=(raw:WebSocket.RawData)=>{void authenticate(raw).catch(()=>socket.close(1011,"authentication failed"));};
    socket.on("message",onFirst);
  }

  private async message(connection:Connection,raw:WebSocket.RawData){
    if(this.connections.get(connection.hostId)!==connection)return;
    const timestamp=Date.now();if(timestamp-connection.rateWindow>=60_000){connection.rateWindow=timestamp;connection.rateCount=0;}if(++connection.rateCount>1200){connection.socket.close(1008,"worker rate limit");return;}
    let value:unknown;try{if(Buffer.byteLength(raw as any)>WORKER_MAX_MESSAGE_BYTES)throw new Error();value=JSON.parse(raw.toString());}catch{connection.socket.close(1009,"invalid message");return;}
    const parsed=workerMessageSchema.safeParse(value);if(!parsed.success||parsed.data.generation!==connection.generation||parsed.data.sequence<=connection.sequenceIn){connection.socket.close(1008,"invalid sequence");return;}
    connection.sequenceIn=parsed.data.sequence;connection.lastSeen=Date.now();const message=parsed.data;
    if(message.type==="heartbeat"){
      const host=await this.db.getHost(connection.hostId);if(host)await this.db.upsertHost({...host,status:"online",lastSeenAt:now(),updatedAt:now(),capabilities:message.snapshot??host.capabilities});return;
    }
    if(message.type==="response"){
      const pending=connection.pending.get(message.requestId);if(!pending)return;connection.pending.delete(message.requestId);clearTimeout(pending.timer);if(message.ok)pending.resolve(message.result);else{const code=message.error?.code,statusCode=code==="FILE_VERSION_CONFLICT"||code==="SOURCE_TASK_WORKSPACE_MISMATCH"||code==="FILE_PATH_UNRESOLVED"||code==="WORKSPACE_FILE_ID_MISMATCH"||code==="APPROVAL_NOT_PENDING"||code==="APPROVAL_EXPIRED"||code==="APPROVAL_ALREADY_ANSWERED"?409:code==="WORKSPACE_FILE_NOT_FOUND"?404:code==="WORKSPACE_FILE_EDIT_TOO_LARGE"||code==="WORKSPACE_DOWNLOAD_TOO_LARGE"?413:code==="WORKSPACE_FILE_INVALID_UTF8"||code==="WORKSPACE_FILE_CONTROL_CHARACTERS"||code==="WORKSPACE_FILE_MIXED_LINE_ENDINGS"?415:code==="INVALID_WORKSPACE_FILE_PATH"||code==="WORKSPACE_FILE_EXPECTED"||code==="APPROVAL_DECISION_UNSUPPORTED"||code==="APPROVAL_SCOPE_UNSUPPORTED"?400:code==="WORKSPACE_FILE_PATH_ESCAPE"||code==="GIT_METADATA_EDIT_BLOCKED"||code==="SYMLINK_EDIT_BLOCKED"||code==="WORKSPACE_FILE_NOT_EDITABLE"?403:500;pending.reject(Object.assign(new Error(sanitizeSensitiveText(message.error?.message??"Worker command failed.")),{code,statusCode}));}return;
    }
    if(message.type==="event"){
      if(await this.appendEvent(connection.hostId,message.taskId,message.eventId,message.event))return;
      const queued=this.pendingEvents.get(message.taskId)??[];queued.push({hostId:connection.hostId,eventId:message.eventId,event:message.event});this.pendingEvents.set(message.taskId,queued.slice(-200));if(this.pendingEvents.size>500)this.pendingEvents.delete(this.pendingEvents.keys().next().value!);return;
    }
    if(message.type==="snapshot"){
      const host=await this.db.getHost(connection.hostId);if(host)await this.db.upsertHost({...host,status:"online",lastSeenAt:now(),updatedAt:now(),capabilities:message.capabilities});
      for(const rawTask of message.tasks){const id=typeof rawTask.id==="string"?rawTask.id:null;if(!id)continue;const task=await this.db.getTask(id);if(task&&task.executionHostId===connection.hostId){const interruptionCause=typeof rawTask.interruptionCause==="string"?rawTask.interruptionCause:null,interruptionDetectedAt=typeof rawTask.interruptionDetectedAt==="string"?rawTask.interruptionDetectedAt:null;await this.db.upsertTask({...task,status:(rawTask.status as any)??task.status,updatedAt:typeof rawTask.updatedAt==="string"?rawTask.updatedAt:now(),threadId:typeof rawTask.threadId==="string"?rawTask.threadId:task.threadId,result:typeof rawTask.result==="string"?rawTask.result:task.result,error:typeof rawTask.error==="string"?rawTask.error:null,metadata:{...task.metadata,...(interruptionCause?{interruptionCause,interruptionDetectedAt,recoveryState:"eligible"}:{})}});}}
    }
  }

  async request(hostId:string,command:WorkerCommand,payload:unknown,idempotencyKey=crypto.randomUUID(),timeoutMs=COMMAND_TIMEOUT_MS){
    if(!WORKER_COMMANDS.includes(command))throw new Error("Unsupported worker command.");const connection=this.connections.get(hostId);if(!connection||!connection.ready||connection.socket.readyState!==connection.socket.OPEN)throw Object.assign(new Error("Worker is offline."),{statusCode:503,code:"HOST_OFFLINE"});
    const requestId=crypto.randomUUID();const message:WorkerRequestMessage={type:"request",generation:connection.generation,sequence:++connection.sequenceOut,requestId,command,payload,idempotencyKey};
    return new Promise<unknown>((resolve,reject)=>{const timer=setTimeout(()=>{connection.pending.delete(requestId);reject(Object.assign(new Error("Worker command timed out."),{statusCode:504,code:"WORKER_TIMEOUT"}));},timeoutMs);timer.unref?.();connection.pending.set(requestId,{command,resolve,reject,timer});connection.socket.send(JSON.stringify(message));});
  }
  isOnline(hostId:string){const connection=this.connections.get(hostId);return connection?.ready===true&&connection.socket.readyState===1;}
  private async disconnected(connection:Connection){
    if(this.connections.get(connection.hostId)!==connection)return;
    this.connections.delete(connection.hostId);this.rejectPending(connection,new Error("Worker went offline."));
    const host=await this.db.getHost(connection.hostId);
    if(host&&!this.connections.has(connection.hostId))await this.db.upsertHost({...host,status:"offline",updatedAt:now()});
    // A replacement connection may authenticate while the asynchronous DB
    // update above is in flight. Make the currently authenticated generation
    // authoritative so a stale close cannot leave an online Worker marked off.
    if(this.connections.has(connection.hostId)){const current=await this.db.getHost(connection.hostId);if(current)await this.db.upsertHost({...current,status:"online",lastSeenAt:now(),updatedAt:now()});}
    else void this.hostOfflineHandler?.(connection.hostId);
  }
  private rejectPending(connection:Connection,error:Error){for(const pending of connection.pending.values()){clearTimeout(pending.timer);pending.reject(Object.assign(new Error(`${error.message} (${pending.command})`),{code:(error as any).code??"HOST_OFFLINE"}));}connection.pending.clear();}
  private async reap(){const timestamp=Date.now();for(const pairing of this.pairings.values())if(pairing.status==="waiting"&&pairing.expiresAt<timestamp)pairing.status="expired";for(const connection of this.connections.values())if(timestamp-connection.lastSeen>45_000){connection.socket.close(4000,"heartbeat timeout");await this.disconnected(connection);}}
  async revoke(hostId:string){const timestamp=now();await this.db.revokeWorkerCredential(hostId,timestamp);const connection=this.connections.get(hostId);connection?.socket.close(4003,"revoked");const host=await this.db.getHost(hostId);if(host)await this.db.upsertHost({...host,status:"disabled",revokedAt:timestamp,updatedAt:timestamp});}
  disconnectDisabled(hostId:string){const connection=this.connections.get(hostId);if(connection){connection.ready=false;connection.socket.close(4004,"host disabled");}}
  reconnectAfterCredentialRotation(hostId:string){this.connections.get(hostId)?.socket.close(4002,"credential rotated");}
  shutdown(){clearInterval(this.reaper);for(const connection of this.connections.values())connection.socket.close(1001,"server shutdown");this.connections.clear();this.pairings.clear();this.eventIds.clear();this.pendingEvents.clear();}
}
