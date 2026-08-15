import fs from "node:fs";
import path from "node:path";
import type {ProviderId} from "./types.js";
import {resolveWorkhouseRoots} from "./platform.js";

export type CompatibleProviderId=Extract<ProviderId,"deepseek"|"ollama">;

type StoredCompatibleProviderSettings={version:1;deepseek:{baseUrl:string|null;apiKey:string|null};ollama:{baseUrl:string|null;apiKey:string|null}};
const EMPTY_SETTINGS:StoredCompatibleProviderSettings={version:1,deepseek:{baseUrl:null,apiKey:null},ollama:{baseUrl:null,apiKey:null}};

function safeUrl(rawValue:string,name:string){
  const raw=String(rawValue).trim();
  const parsed=new URL(raw);
  if(!["http:","https:"].includes(parsed.protocol)||parsed.username||parsed.password)throw new Error(`${name} must be an HTTP(S) URL without embedded credentials.`);
  parsed.hash="";parsed.search="";
  return parsed.toString().replace(/\/$/,"");
}
function configuredUrl(name:string,fallback:string,stored:string|null){return safeUrl(stored||String(process.env[name]??fallback),name);}
function ollamaCloudBaseUrl(stored:string|null){const value=configuredUrl("CLAUDEX_WORKHOUSE_OLLAMA_BASE_URL","https://ollama.com",stored);return value.endsWith("/api")?value.slice(0,-4):value;}
function settingsFile(dataRoot:string){return path.join(dataRoot,"config","compatible-providers.json");}
function readSettings(dataRoot:string):StoredCompatibleProviderSettings{
  try{
    const file=settingsFile(dataRoot),stat=fs.lstatSync(file);
    if(!stat.isFile()||stat.isSymbolicLink())throw new Error("Compatible provider settings path is unsafe.");
    const value=JSON.parse(fs.readFileSync(file,"utf8"));
    return{version:1,deepseek:{baseUrl:typeof value?.deepseek?.baseUrl==="string"?value.deepseek.baseUrl:null,apiKey:typeof value?.deepseek?.apiKey==="string"?value.deepseek.apiKey:null},ollama:{baseUrl:typeof value?.ollama?.baseUrl==="string"?value.ollama.baseUrl:null,apiKey:typeof value?.ollama?.apiKey==="string"?value.ollama.apiKey:typeof value?.ollama?.authToken==="string"?value.ollama.authToken:null}};
  }catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;return structuredClone(EMPTY_SETTINGS);}
}
function root(value?:string){return value??resolveWorkhouseRoots().dataRoot;}

export function compatibleProviderConfig(provider:CompatibleProviderId,dataRoot?:string){
  const stored=readSettings(root(dataRoot));
  if(provider==="deepseek"){
    return{
      provider,
      label:"DeepSeek",
      baseUrl:configuredUrl("CLAUDEX_WORKHOUSE_DEEPSEEK_BASE_URL","https://api.deepseek.com/anthropic",stored.deepseek.baseUrl),
      apiKey:String(stored.deepseek.apiKey??process.env.CLAUDEX_WORKHOUSE_DEEPSEEK_API_KEY??process.env.DEEPSEEK_API_KEY??"").trim(),
      defaultModel:String(process.env.CLAUDEX_WORKHOUSE_DEEPSEEK_DEFAULT_MODEL??"deepseek-v4-pro").trim()||"deepseek-v4-pro"
    } as const;
  }
  return{
    provider,
    label:"Ollama",
    baseUrl:ollamaCloudBaseUrl(stored.ollama.baseUrl),
    apiKey:String(stored.ollama.apiKey??process.env.CLAUDEX_WORKHOUSE_OLLAMA_API_KEY??process.env.OLLAMA_API_KEY??process.env.CLAUDEX_WORKHOUSE_OLLAMA_AUTH_TOKEN??"").trim(),
    defaultModel:String(process.env.CLAUDEX_WORKHOUSE_OLLAMA_DEFAULT_MODEL??"").trim()
  } as const;
}

export function compatibleProviderEnvironment(provider:CompatibleProviderId,dataRoot?:string,model?:string){
  const config=compatibleProviderConfig(provider,dataRoot);
  return{
    ANTHROPIC_BASE_URL:config.baseUrl,
    ANTHROPIC_AUTH_TOKEN:config.apiKey,
    ANTHROPIC_API_KEY:provider==="ollama"?"":config.apiKey,
    ...(model?{CLAUDE_CODE_SUBAGENT_MODEL:model}:{})
  };
}

export function compatibleProviderPublicSettings(provider:CompatibleProviderId,dataRoot:string){
  const config=compatibleProviderConfig(provider,dataRoot),stored=readSettings(dataRoot);
  const secretConfigured=Boolean(config.apiKey);
  return{provider,baseUrl:config.baseUrl,secretConfigured,secretSource:provider==="deepseek"?(stored.deepseek.apiKey?"workhouse":process.env.CLAUDEX_WORKHOUSE_DEEPSEEK_API_KEY||process.env.DEEPSEEK_API_KEY?"environment":null):(stored.ollama.apiKey?"workhouse":process.env.CLAUDEX_WORKHOUSE_OLLAMA_API_KEY||process.env.OLLAMA_API_KEY||process.env.CLAUDEX_WORKHOUSE_OLLAMA_AUTH_TOKEN?"environment":null)};
}

export function saveCompatibleProviderSettings(dataRoot:string,provider:CompatibleProviderId,input:{baseUrl:string;secret?:string;clearSecret?:boolean}){
  const settings=readSettings(dataRoot),baseUrl=safeUrl(input.baseUrl,provider==="deepseek"?"DeepSeek base URL":"Ollama base URL"),secret=input.secret?.trim();
  if(secret&&(/[\u0000-\u001f\u007f]/.test(secret)||secret.length>4096))throw new Error("Provider secret is invalid.");
  if(provider==="deepseek")settings.deepseek={baseUrl,apiKey:input.clearSecret?null:secret||settings.deepseek.apiKey};
  else settings.ollama={baseUrl,apiKey:input.clearSecret?null:secret||settings.ollama.apiKey};
  const file=settingsFile(dataRoot),directory=path.dirname(file),temporary=`${file}.${process.pid}.tmp`;
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  fs.writeFileSync(temporary,`${JSON.stringify(settings,null,2)}\n`,{encoding:"utf8",mode:0o600,flag:"wx"});
  try{fs.chmodSync(temporary,0o600);fs.renameSync(temporary,file);fs.chmodSync(file,0o600);}catch(error){try{fs.unlinkSync(temporary);}catch{}throw error;}
  return compatibleProviderPublicSettings(provider,dataRoot);
}

export function ollamaTagsUrl(baseUrl:string){return`${baseUrl.replace(/\/$/,"")}/api/tags`;}
export function deepseekModelsUrl(baseUrl:string){const url=new URL(baseUrl),parts=url.pathname.replace(/\/$/,"").split("/");if(parts.at(-1)==="anthropic")parts.pop();url.pathname=`${parts.join("/")}/models`.replace(/\/+/g,"/");url.search="";url.hash="";return url.toString();}
/** Undocumented but live: returns the account's session (5h) and weekly limit utilization. */
export function ollamaUsageUrl(baseUrl:string){return`${baseUrl.replace(/\/$/,"")}/api/usage`;}
/** POST-only account endpoint. It answers with the profile, of which only the plan name is read. */
export function ollamaAccountUrl(baseUrl:string){return`${baseUrl.replace(/\/$/,"")}/api/me`;}
/** DeepSeek meters prepaid credit rather than a quota window, and publishes the remaining balance off the API origin. */
export function deepseekBalanceUrl(baseUrl:string){return`${new URL(baseUrl).origin}/user/balance`;}
