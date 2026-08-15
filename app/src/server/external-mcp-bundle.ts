import fs from "node:fs";
import path from "node:path";
import {isExternalMcpServerId} from "./mcp-tool-policy.js";

export const EXTERNAL_MCP_BUNDLE_ENV="CLAUDEX_WORKHOUSE_EXTERNAL_MCP_BUNDLE_FILE";
const MAX_BUNDLE_BYTES=256*1024;

export type ExternalMcpServer={id:string;url:string;headers:Record<string,string>;toolTimeoutSec:number};
export type ExternalMcpBundle={version:1;taskId:string;servers:ExternalMcpServer[]};

export function writeExternalMcpBundle(file:string,bundle:ExternalMcpBundle){
  if(!path.isAbsolute(file))throw new Error("External MCP bundle path must be absolute.");
  const directory=path.dirname(file),temporary=path.join(directory,`.external-mcp.${process.pid}.${Date.now()}.tmp`);
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  let descriptor:number|null=null;
  try{
    descriptor=fs.openSync(temporary,"wx",0o600);
    fs.writeFileSync(descriptor,`${JSON.stringify(bundle,null,2)}\n`,"utf8");
    fs.fsyncSync(descriptor);fs.closeSync(descriptor);descriptor=null;
    fs.chmodSync(temporary,0o600);fs.renameSync(temporary,file);fs.chmodSync(file,0o600);
  }catch(error){if(descriptor!==null)try{fs.closeSync(descriptor);}catch{}try{fs.unlinkSync(temporary);}catch{}throw error;}
  readExternalMcpBundle(file,bundle.taskId);
  return file;
}

function validUrl(value:string){
  const url=new URL(value);
  if(url.username||url.password||url.hash)throw new Error("External MCP URLs must not contain credentials or fragments.");
  if(url.protocol==="https:")return value;
  if(url.protocol==="http:"&&["127.0.0.1","localhost","::1"].includes(url.hostname))return value;
  throw new Error("External MCP URLs must use HTTPS (or loopback HTTP). ");
}

function headerRecord(value:unknown){
  if(value===undefined)return{};
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("External MCP headers must be an object.");
  const result:Record<string,string>={};
  for(const[name,header]of Object.entries(value)){
    if(!/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,80}$/.test(name)||typeof header!=="string"||header.length>8192||/[\r\n]/.test(header))throw new Error("External MCP header is invalid.");
    result[name]=header;
  }
  return result;
}

/** Read the server-produced, task-scoped capability bundle. Workers re-check it
 * before translating it so an inherited or replaced file fails closed. */
export function readExternalMcpBundle(file:string|undefined,taskId:string):ExternalMcpBundle|null{
  if(!file)return null;
  if(!path.isAbsolute(file))throw new Error("External MCP bundle path must be absolute.");
  const stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink())throw new Error("External MCP bundle must be a regular file.");
  if(stat.size>MAX_BUNDLE_BYTES)throw new Error("External MCP bundle is too large.");
  if(process.platform!=="win32"&&((stat.mode&0o777)!==0o600||stat.uid!==process.getuid?.()))throw new Error("External MCP bundle must be owned by the worker user with mode 0600.");
  const parsed=JSON.parse(fs.readFileSync(file,"utf8"));
  if(parsed?.version!==1||parsed.taskId!==taskId||!Array.isArray(parsed.servers))throw new Error("External MCP bundle scope is invalid.");
  const seen=new Set<string>();
  const servers=parsed.servers.map((entry:unknown)=>{
    if(!entry||typeof entry!=="object")throw new Error("External MCP server entry is invalid.");
    const raw=entry as Record<string,unknown>,id=String(raw.id??"");
    if(!isExternalMcpServerId(id)||seen.has(id))throw new Error("External MCP server id is invalid or reserved.");
    seen.add(id);
    const timeout=raw.toolTimeoutSec===undefined?60:Number(raw.toolTimeoutSec);
    if(!Number.isInteger(timeout)||timeout<1||timeout>600)throw new Error("External MCP tool timeout is invalid.");
    return{id,url:validUrl(String(raw.url??"")),headers:headerRecord(raw.headers),toolTimeoutSec:timeout};
  });
  return{version:1,taskId,servers};
}

function envName(serverIndex:number,headerIndex:number){return`CLAUDEX_WORKHOUSE_EXTERNAL_MCP_${serverIndex}_HEADER_${headerIndex}`;}

export function externalMcpEnvironment(bundle:ExternalMcpBundle){
  const environment:Record<string,string>={};
  bundle.servers.forEach((server,serverIndex)=>Object.values(server.headers).forEach((value,headerIndex)=>{environment[envName(serverIndex,headerIndex)]=value;}));
  return environment;
}

export function externalMcpForClaude(bundle:ExternalMcpBundle){
  const mcpServers:Record<string,unknown>={},allowedTools:string[]=[];
  bundle.servers.forEach((server,serverIndex)=>{
    const headers:Record<string,string>={};
    Object.keys(server.headers).forEach((name,headerIndex)=>{headers[name]=`\${${envName(serverIndex,headerIndex)}}`;});
    mcpServers[server.id]={type:"http",url:server.url,...(Object.keys(headers).length?{headers}:{} )};
    allowedTools.push(`mcp__${server.id}__*`);
  });
  return{mcpServers,allowedTools,environment:externalMcpEnvironment(bundle)};
}

function tomlString(value:string){return JSON.stringify(value);}
export function externalMcpForCodex(bundle:ExternalMcpBundle){
  const args:string[]=[],environment=externalMcpEnvironment(bundle);
  bundle.servers.forEach((server,serverIndex)=>{
    const prefix=`mcp_servers.${server.id}`;
    args.push("-c",`${prefix}.url=${tomlString(server.url)}`,"-c",`${prefix}.tool_timeout_sec=${server.toolTimeoutSec}`);
    const pairs=Object.keys(server.headers).map((name,headerIndex)=>`${tomlString(name)}=${tomlString(envName(serverIndex,headerIndex))}`);
    if(pairs.length)args.push("-c",`${prefix}.env_http_headers={${pairs.join(",")}}`);
  });
  return{args,environment};
}

export function externalMcpForAntigravity(bundle:ExternalMcpBundle){
  const mcpServers:Record<string,unknown>={};
  bundle.servers.forEach((server,serverIndex)=>{
    const headers:Record<string,string>={};
    Object.keys(server.headers).forEach((name,headerIndex)=>{headers[name]=`\${${envName(serverIndex,headerIndex)}}`;});
    mcpServers[server.id]={url:server.url,...(Object.keys(headers).length?{headers}:{} )};
  });
  return{mcpServers,environment:externalMcpEnvironment(bundle)};
}
