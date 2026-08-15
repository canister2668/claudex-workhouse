import {z} from "zod";
import {EXTERNAL_MCP_ROLES,EXTERNAL_MCP_SERVER_ID,RESERVED_EXTERNAL_MCP_SERVER_IDS,requireReadOnlyExternalMcp,supportsExternalMcp,type ExternalMcpProvider,type ExternalMcpRole} from "./mcp-tool-policy.js";
import type {McpSecretReader} from "./mcp-secrets.js";

export const MCP_REGISTRY_SETTING_KEY="external-mcp.registry.v1";

function externalMcpUrl(value:string){
  let url:URL;try{url=new URL(value.trim());}catch{throw new Error("External MCP URL is invalid.");}
  if(url.username||url.password||url.hash)throw new Error("External MCP URL cannot contain credentials or a fragment.");
  const loopback=url.hostname==="localhost"||url.hostname==="127.0.0.1"||url.hostname==="[::1]";
  if(url.protocol!=="https:"&&!(url.protocol==="http:"&&loopback))throw new Error("External MCP URL must use HTTPS, except for loopback HTTP.");
  return url.toString();
}

const serverIdSchema=z.string().trim().regex(EXTERNAL_MCP_SERVER_ID).refine(value=>!RESERVED_EXTERNAL_MCP_SERVER_IDS.has(value),"This id is reserved for a built-in Workhouse MCP server.");
const roleSchema=z.enum(EXTERNAL_MCP_ROLES);
const remoteMcpServerSchema=z.object({
  id:serverIdSchema,
  name:z.string().trim().min(1).max(80),
  url:z.string().trim().max(2048).transform(externalMcpUrl),
  enabled:z.boolean(),
  roles:z.array(roleSchema).max(EXTERNAL_MCP_ROLES.length).transform(values=>[...new Set(values)]),
  readOnly:z.boolean().transform(requireReadOnlyExternalMcp)
}).strict();

export const mcpRegistrySettingsSchema=z.object({version:z.literal(1),servers:z.array(remoteMcpServerSchema).max(32)}).strict().superRefine((value,ctx)=>{
  const ids=new Set<string>();for(const server of value.servers){if(ids.has(server.id))ctx.addIssue({code:"custom",path:["servers",value.servers.indexOf(server),"id"],message:"External MCP server ids must be unique."});ids.add(server.id);}
});

export type RemoteMcpServer=z.infer<typeof remoteMcpServerSchema>;
export type McpRegistrySettings=z.infer<typeof mcpRegistrySettingsSchema>;
export const DEFAULT_MCP_REGISTRY_SETTINGS:McpRegistrySettings={version:1,servers:[]};

const putServerSchema=remoteMcpServerSchema.extend({secret:z.string().trim().min(1).max(8192).refine(value=>!/[\u0000-\u001f\u007f]/.test(value),"External MCP secret is invalid.").optional(),clearSecret:z.boolean().optional()}).superRefine((value,ctx)=>{if(value.secret&&value.clearSecret)ctx.addIssue({code:"custom",path:["secret"],message:"Set or clear an MCP secret, not both."});});
const putInputSchema=z.object({settings:z.object({version:z.literal(1),servers:z.array(putServerSchema).max(32)}).strict(),baseUpdatedAt:z.string().datetime().nullable().optional()}).strict();
export const mcpRegistryPutSchema=putInputSchema.transform(input=>{
  const settings=mcpRegistrySettingsSchema.parse({version:1,servers:input.settings.servers.map(({secret:_secret,clearSecret:_clearSecret,...server})=>server)});
  const secretUpdates:Array<{serverId:string;secret:string;clear:false}|{serverId:string;secret:null;clear:true}>=[];
  for(const server of input.settings.servers){if(server.secret)secretUpdates.push({serverId:server.id,secret:server.secret,clear:false});else if(server.clearSecret)secretUpdates.push({serverId:server.id,secret:null,clear:true});}
  return{settings,secretUpdates,baseUpdatedAt:input.baseUpdatedAt??null};
});

export function normalizeMcpRegistrySettings(value:unknown):McpRegistrySettings{const parsed=mcpRegistrySettingsSchema.safeParse(value);return parsed.success?parsed.data:structuredClone(DEFAULT_MCP_REGISTRY_SETTINGS);}
export function serializeMcpRegistrySettings(value:unknown):McpRegistrySettings{return structuredClone(mcpRegistrySettingsSchema.parse(value));}

export function publicMcpRegistrySettings(settings:McpRegistrySettings,secretStore:McpSecretReader){
  const normalized=mcpRegistrySettingsSchema.parse(settings);
  return{...normalized,servers:normalized.servers.map(server=>{const secretConfigured=secretStore.has(server.id);return{...server,secretConfigured,secretSource:secretConfigured?"workhouse":null};})};
}

export function externalMcpServersForProvider(settings:McpRegistrySettings,provider:string,roles?:readonly ExternalMcpRole[]){
  if(!supportsExternalMcp(provider))return[];
  const enabled=mcpRegistrySettingsSchema.parse(settings).servers.filter(server=>server.enabled),selected:RemoteMcpServer[]=[];
  for(const role of roles??EXTERNAL_MCP_ROLES){const server=enabled.find(candidate=>candidate.roles.includes(role));if(server&&!selected.some(item=>item.id===server.id))selected.push(server);}
  return selected;
}

export function externalMcpProviderSupport():Record<ExternalMcpProvider,true>{return{claude:true,codex:true,deepseek:true,ollama:true,antigravity:true};}
