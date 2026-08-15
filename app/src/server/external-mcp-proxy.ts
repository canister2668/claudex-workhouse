import crypto from "node:crypto";
import {Readable} from "node:stream";
import type {FastifyInstance,FastifyRequest} from "fastify";
import type {DeckDatabase} from "./db/client.js";
import {isExternalMcpServerId} from "./mcp-tool-policy.js";
import type {McpSecretStore} from "./mcp-secrets.js";
import {pendingExternalMcpCapability} from "./external-mcp-runtime.js";
import {isLoopbackAddress} from "./security/auth.js";

type ExternalMcpSnapshot={id:string;url:string};
const ACTIVE_TASK_STATES=new Set(["pending","queued","running","waiting"]);
const FORWARDED_REQUEST_HEADERS=["accept","content-type","mcp-protocol-version","mcp-session-id","last-event-id"] as const;
const FORWARDED_RESPONSE_HEADERS=["content-type","cache-control","mcp-protocol-version","mcp-session-id","retry-after"] as const;

function bearerToken(request:FastifyRequest){
  const value=request.headers.authorization;
  return typeof value==="string"&&value.startsWith("Bearer ")?value.slice(7):"";
}

function matchesHash(value:string,expected:string){
  if(!/^[A-Za-z0-9_-]{43}$/.test(value)||!/^[a-f0-9]{64}$/.test(expected))return false;
  const actual=crypto.createHash("sha256").update(value).digest(),target=Buffer.from(expected,"hex");
  return actual.length===target.length&&crypto.timingSafeEqual(actual,target);
}

export function registerExternalMcpProxy(app:FastifyInstance,input:{db:DeckDatabase;secrets:McpSecretStore;fetch?:typeof fetch}){
  const requestFetch=input.fetch??fetch;
  app.route({method:["GET","POST","DELETE"],url:"/mcp/external/:taskId/:serverId",handler:async(request,reply)=>{
    if(!isLoopbackAddress(request.ip||(request.raw.socket.remoteAddress??"")))throw Object.assign(new Error("External MCP proxy requires loopback."),{statusCode:403,code:"MCP_PROXY_LOOPBACK_REQUIRED"});
    const params=request.params as {taskId:string;serverId:string},serverId=params.serverId;
    if(!isExternalMcpServerId(serverId))throw Object.assign(new Error("External MCP server id is invalid."),{statusCode:404,code:"MCP_PROXY_SERVER_NOT_FOUND"});
    const task=await input.db.getTask(params.taskId),metadata=task?.metadata??pendingExternalMcpCapability(params.taskId)??{},expected=typeof metadata.externalMcpCapabilityHash==="string"?metadata.externalMcpCapabilityHash:"";
    if((task&&!ACTIVE_TASK_STATES.has(task.status))||!matchesHash(bearerToken(request),expected))throw Object.assign(new Error("External MCP task capability is invalid."),{statusCode:403,code:"MCP_PROXY_CAPABILITY_INVALID"});
    const snapshots=Array.isArray(metadata.externalMcpServers)?metadata.externalMcpServers:[],snapshot=snapshots.find((item:unknown):item is ExternalMcpSnapshot=>Boolean(item&&typeof item==="object"&&(item as any).id===serverId&&typeof (item as any).url==="string"));
    if(!snapshot)throw Object.assign(new Error("External MCP server is outside this task capability."),{statusCode:403,code:"MCP_PROXY_SERVER_OUT_OF_SCOPE"});
    const headers=new Headers();
    for(const name of FORWARDED_REQUEST_HEADERS){const value=request.headers[name];if(typeof value==="string")headers.set(name,value);}
    const secret=input.secrets.get(serverId);if(secret)headers.set("authorization",`Bearer ${secret}`);
    const body=request.method==="GET"||request.method==="DELETE"?undefined:Buffer.from(typeof request.body==="string"?request.body:JSON.stringify(request.body??{}));
    const response=await requestFetch(snapshot.url,{method:request.method,headers,body,redirect:"error"});
    reply.code(response.status);for(const name of FORWARDED_RESPONSE_HEADERS){const value=response.headers.get(name);if(value)reply.header(name,value);}
    if(!response.body)return reply.send();
    return reply.send(Readable.fromWeb(response.body as any));
  }});
}
