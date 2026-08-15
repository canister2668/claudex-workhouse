import crypto from "node:crypto";
import path from "node:path";
import type {DeckDatabase} from "./db/client.js";
import {EXTERNAL_MCP_BUNDLE_ENV,type ExternalMcpBundle,writeExternalMcpBundle} from "./external-mcp-bundle.js";
import {externalMcpServersForProvider,MCP_REGISTRY_SETTING_KEY,normalizeMcpRegistrySettings} from "./mcp-registry.js";
import type {ProviderId} from "./types.js";

export type PreparedExternalMcp={environment:Record<string,string>;metadata:Record<string,unknown>;promptSuffix:string};
const pendingCapabilities=new Map<string,{externalMcpCapabilityHash:string;externalMcpServers:Array<{id:string;name:string;url:string;roles:unknown}>}>();
export function pendingExternalMcpCapability(taskId:string){return pendingCapabilities.get(taskId)??null;}

export async function prepareExternalMcpEnvironment(input:{db:DeckDatabase;taskTempDir:string;taskId:string;provider:ProviderId;runtimeProfile:string;port:number}):Promise<PreparedExternalMcp>{
  if(input.runtimeProfile!=="default"||input.provider==="grok")return{environment:{},metadata:{},promptSuffix:""};
  const stored=await input.db.getSystemSetting(MCP_REGISTRY_SETTING_KEY).catch(()=>null),settings=normalizeMcpRegistrySettings(stored?.value);
  const selected=externalMcpServersForProvider(settings,input.provider);
  if(!selected.length)return{environment:{},metadata:{},promptSuffix:""};
  const capabilityToken=crypto.randomBytes(32).toString("base64url"),capabilityHash=crypto.createHash("sha256").update(capabilityToken).digest("hex");
  const bundle:ExternalMcpBundle={version:1,taskId:input.taskId,servers:selected.map(server=>{
    const url=`http://127.0.0.1:${input.port}/mcp/external/${encodeURIComponent(input.taskId)}/${server.id}`;
    return{id:server.id,url,headers:{Authorization:`Bearer ${capabilityToken}`},toolTimeoutSec:60};
  })};
  const file=writeExternalMcpBundle(path.join(input.taskTempDir,"external-mcp-bundle.json"),bundle);
  const roleLabels:Record<string,string>={"default-search":"ordinary current web search","semantic-search":"semantic source discovery","crawl":"read-only site crawling","url-read":"reading a supplied URL"};
  const promptSuffix=`External MCP routing for this task:\n${selected.map(server=>`- ${server.id} (${server.name}): ${server.roles.map(role=>roleLabels[role]??role).join(", ")}`).join("\n")}\nUse these servers only for the listed read/research purposes. Their read-only status is operator-declared, not technically verified by Workhouse.`;
  const metadata={externalMcpCapabilityHash:capabilityHash,externalMcpServers:selected.map(server=>({id:server.id,name:server.name,url:server.url,roles:server.roles}))};pendingCapabilities.set(input.taskId,metadata);const pendingTimer=setTimeout(()=>pendingCapabilities.delete(input.taskId),120_000);pendingTimer.unref?.();
  return{environment:{[EXTERNAL_MCP_BUNDLE_ENV]:file},metadata,promptSuffix};
}
