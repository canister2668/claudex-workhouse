export const MCP_SERVER_ROLES = ["default-search", "semantic-search", "crawl", "url-read"] as const;
export type McpServerRole = (typeof MCP_SERVER_ROLES)[number];

export type McpServerPublic = { id:string;name:string;url:string;enabled:boolean;roles:McpServerRole[];readOnly:boolean;secretConfigured:boolean;secretSource:string|null };
export type McpServerDraft = McpServerPublic & { secret:string;clearSecret:boolean };
export type McpServerSettingsResponse = {settings:{version:1;servers:McpServerDraft[]};updatedAt:string|null};

const text=(value:unknown)=>typeof value==="string"?value.trim():"";
const isRole=(value:unknown):value is McpServerRole=>MCP_SERVER_ROLES.includes(value as McpServerRole);

export function normalizeMcpServerSettings(value:unknown):McpServerSettingsResponse{
  const root=value&&typeof value==="object"?value as Record<string,unknown>:{};
  const nested=root.settings&&typeof root.settings==="object"?root.settings as Record<string,unknown>:root;
  const rawServers=Array.isArray(nested.servers)?nested.servers:[],seen=new Set<string>(),servers:McpServerDraft[]=[];
  for(const raw of rawServers){
    if(!raw||typeof raw!=="object")continue;
    const item=raw as Record<string,unknown>,id=text(item.id);
    if(!id||seen.has(id))continue;
    seen.add(id);
    servers.push({id,name:text(item.name),url:text(item.url),enabled:item.enabled!==false,roles:Array.isArray(item.roles)?[...new Set(item.roles.filter(isRole))]:[],readOnly:item.readOnly===true,secretConfigured:item.secretConfigured===true,secretSource:text(item.secretSource)||null,secret:"",clearSecret:false});
  }
  return{settings:{version:1,servers},updatedAt:text(root.updatedAt)||null};
}

export function newMcpServer(id:string):McpServerDraft{return{id,name:"",url:"",enabled:true,roles:["default-search"],readOnly:false,secretConfigured:false,secretSource:null,secret:"",clearSecret:false};}

export function mcpServerSavePayload(servers:McpServerDraft[],baseUpdatedAt:string|null){
  const savedServers=servers.map(({secret,clearSecret,secretConfigured:_configured,secretSource:_source,...server})=>{const replacement=secret.trim();return replacement?{...server,secret:replacement}:clearSecret?{...server,clearSecret:true}:server;});
  return{settings:{version:1 as const,servers:savedServers},...(baseUpdatedAt?{baseUpdatedAt}:{})};
}

export function mcpServerDraftIsValid(server:McpServerDraft){
  if(!server.id.trim()||!server.name.trim()||!server.roles.length||server.readOnly!==true)return false;
  try{const url=new URL(server.url),loopback=url.hostname==="localhost"||url.hostname==="127.0.0.1"||url.hostname==="[::1]";return url.protocol==="https:"||(url.protocol==="http:"&&loopback);}catch{return false;}
}
