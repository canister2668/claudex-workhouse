import type {ProviderId} from "./types.js";

export const EXTERNAL_MCP_ROLES=["default-search","semantic-search","crawl","url-read"] as const;
export type ExternalMcpRole=typeof EXTERNAL_MCP_ROLES[number];

export const EXTERNAL_MCP_PROVIDERS=["claude","codex","deepseek","ollama","antigravity"] as const;
export type ExternalMcpProvider=typeof EXTERNAL_MCP_PROVIDERS[number];

export const EXTERNAL_MCP_SERVER_ID=/^[a-z][a-z0-9-]{0,62}$/;
export const RESERVED_EXTERNAL_MCP_SERVER_IDS=new Set(["claudex-workhouse","claudex-workhouse-emotion","mcp-emoticon","emotion","managed-provider"]);

const providers=new Set<string>(EXTERNAL_MCP_PROVIDERS);
const roles=new Set<string>(EXTERNAL_MCP_ROLES);

export function supportsExternalMcp(provider:ProviderId|string):provider is ExternalMcpProvider{return providers.has(provider);}
export function isExternalMcpRole(value:unknown):value is ExternalMcpRole{return typeof value==="string"&&roles.has(value);}
export function isExternalMcpServerId(value:string){return EXTERNAL_MCP_SERVER_ID.test(value)&&!RESERVED_EXTERNAL_MCP_SERVER_IDS.has(value);}

/** External MCP is deliberately read-only until Workhouse can enforce tool annotations at call time. */
export function requireReadOnlyExternalMcp(value:unknown){
  if(value!==true)throw Object.assign(new Error("External MCP servers must be explicitly read-only."),{statusCode:400,code:"MCP_WRITE_SERVER_UNSUPPORTED"});
  return true as const;
}

export function externalMcpRoleInstructions(roles:readonly ExternalMcpRole[]){
  const selected=new Set(roles);
  return [
    selected.has("default-search")?"Use for ordinary current web search.":null,
    selected.has("semantic-search")?"Use for semantic discovery of related sources.":null,
    selected.has("crawl")?"Use for read-only crawling of multiple public pages.":null,
    selected.has("url-read")?"Use for read-only extraction of a specifically supplied URL.":null
  ].filter((value):value is string=>Boolean(value));
}
