import fs from "node:fs";
import {importPKCS8,SignJWT} from "jose";
import type {AntigravityExecutionSettings} from "./antigravity-execution-settings.js";

type ServiceAccount={type:"service_account";project_id?:string;private_key_id?:string;private_key:string;client_email:string};
export type VertexFunctionCall={name:string;args:Record<string,unknown>;thoughtSignature?:string};
export type VertexPart={text?:string;functionCall?:Omit<VertexFunctionCall,"thoughtSignature">;functionResponse?:{name:string;response:Record<string,unknown>};thoughtSignature?:string};
export type VertexContent={role:"user"|"model";parts:VertexPart[]};
export type VertexUsage={promptTokenCount:number;candidateTokenCount:number;totalTokenCount:number;cachedTokenCount:number;thoughtTokenCount:number};
export type VertexGrounding={webSearchQueries:string[];sources:Array<{uri:string;title:string}>;renderedContent:string|null};
export type VertexStreamChunk={text:string;functionCalls:VertexFunctionCall[];usage:VertexUsage|null;modelVersion:string|null;grounding:VertexGrounding|null};
export type VertexFunctionDeclaration={name:string;description?:string;parameters:Record<string,unknown>};
export type VertexModel={id:string;displayName:string;source:"runtime"};

export function vertexFunctionCallPart({thoughtSignature,...functionCall}:VertexFunctionCall):VertexPart{
  return{functionCall,...(thoughtSignature?{thoughtSignature}:{})};
}

export const VERTEX_FALLBACK_MODELS:VertexModel[]=[
  {id:"gemini-2.5-pro",displayName:"Gemini 2.5 Pro",source:"runtime" as const},
  {id:"gemini-2.5-flash",displayName:"Gemini 2.5 Flash",source:"runtime" as const},
  {id:"gemini-2.5-flash-lite",displayName:"Gemini 2.5 Flash-Lite",source:"runtime" as const}
];

function credentials(settings:AntigravityExecutionSettings){
  const file=settings.vertex.credentialsPath;
  if(!file)throw new Error("Upload a Google Cloud service-account JSON key for Vertex mode.");
  let value:unknown;try{value=JSON.parse(fs.readFileSync(file,"utf8"));}catch{throw new Error("The configured Vertex service-account JSON cannot be read.");}
  const item=value as Partial<ServiceAccount>;
  if(item?.type!=="service_account"||typeof item.client_email!=="string"||typeof item.private_key!=="string")throw new Error("Vertex direct mode requires a service_account JSON key.");
  return item as ServiceAccount;
}

export function vertexCredentialInfo(settings:AntigravityExecutionSettings){const account=credentials(settings);return{clientEmail:account.client_email,projectId:account.project_id??null};}

export async function vertexAccessToken(settings:AntigravityExecutionSettings){
  const account=credentials(settings),now=Math.floor(Date.now()/1000),key=await importPKCS8(account.private_key,"RS256");
  const assertion=await new SignJWT({scope:"https://www.googleapis.com/auth/cloud-platform"})
    .setProtectedHeader({alg:"RS256",typ:"JWT",...(account.private_key_id?{kid:account.private_key_id}:{})})
    .setIssuer(account.client_email).setAudience("https://oauth2.googleapis.com/token").setIssuedAt(now).setExpirationTime(now+3600).sign(key);
  const body=new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion});
  const response=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body,signal:AbortSignal.timeout(20_000)});
  const value=await response.json().catch(()=>({})) as any;
  if(!response.ok||typeof value.access_token!=="string")throw new Error(`Google service-account authentication failed (${response.status}): ${String(value.error_description??value.error??"unknown error")}`);
  return value.access_token as string;
}

function apiHost(settings:AntigravityExecutionSettings){return settings.vertex.location==="global"?"aiplatform.googleapis.com":`${settings.vertex.location}-aiplatform.googleapis.com`;}

function endpoint(settings:AntigravityExecutionSettings,model:string,method:"countTokens"|"streamGenerateContent"){
  const location=settings.vertex.location,host=location==="global"?"aiplatform.googleapis.com":`${location}-aiplatform.googleapis.com`;
  return`https://${host}/v1/projects/${encodeURIComponent(settings.vertex.projectId)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:${method}${method==="streamGenerateContent"?"?alt=sse":""}`;
}

async function vertexError(response:Response){
  const value=await response.json().catch(()=>null) as any;
  return String(value?.error?.message??value?.message??`HTTP ${response.status}`).replace(/[\r\n]+/g," ").slice(0,1000);
}

function modelId(value:unknown){const name=typeof value==="string"?value.trim():"",id=name.split("/").at(-1)??"";return/^gemini-[a-z0-9][a-z0-9._-]{1,100}$/i.test(id)?id:"";}
function conversationalModel(id:string){return!/(?:^|[-_.])(image|imagen|embedding|live|audio|tts|robotics)(?:$|[-_.])/i.test(id);}
function modelDisplayName(id:string){return id.split("-").map((part,index)=>index===0?"Gemini":/^\d+(?:\.\d+)*$/.test(part)?part:part[0].toUpperCase()+part.slice(1)).join(" ").replace(/ Flash Lite\b/," Flash-Lite");}

async function listVertexModelsWithToken(settings:AntigravityExecutionSettings,token:string):Promise<VertexModel[]>{
  const models=new Map<string,VertexModel>();let pageToken="";
  for(let page=0;page<10;page++){
    const query=new URLSearchParams({pageSize:"100",listAllVersions:"false",languageCode:"en"});if(pageToken)query.set("pageToken",pageToken);
    const response=await fetch(`https://${apiHost(settings)}/v1beta1/publishers/google/models?${query}`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20_000)});
    if(!response.ok)throw new Error(`Vertex AI model catalog failed (${response.status}): ${await vertexError(response)}`);
    const value=await response.json().catch(()=>({})) as any;
    for(const item of Array.isArray(value.publisherModels)?value.publisherModels:[]){const id=modelId(item?.name);if(id&&conversationalModel(id))models.set(id,{id,displayName:modelDisplayName(id),source:"runtime"});}
    pageToken=typeof value.nextPageToken==="string"?value.nextPageToken:"";if(!pageToken)break;
  }
  const result=[...models.values()].sort((left,right)=>right.id.localeCompare(left.id,"en",{numeric:true,sensitivity:"base"}));
  if(!result.length)throw new Error("Vertex AI returned no conversational Gemini models for this catalog endpoint.");
  return result;
}

export async function listVertexModels(settings:AntigravityExecutionSettings){return listVertexModelsWithToken(settings,await vertexAccessToken(settings));}

export async function testVertexConnection(settings:AntigravityExecutionSettings){
  const token=await vertexAccessToken(settings),models=await listVertexModelsWithToken(settings,token),model=models.find(item=>item.id==="gemini-2.5-flash")?.id??models[0].id;
  const response=await fetch(endpoint(settings,model,"countTokens"),{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({contents:[{role:"user",parts:[{text:"ping"}]}]}),signal:AbortSignal.timeout(20_000)});
  if(!response.ok)throw new Error(`Vertex AI connection failed (${response.status}): ${await vertexError(response)}`);
  return models;
}

function usage(value:any):VertexUsage|null{
  const item=value?.usageMetadata;if(!item||typeof item!=="object")return null;
  const count=(key:string)=>Number.isFinite(Number(item[key]))?Math.max(0,Number(item[key])):0;
  return{promptTokenCount:count("promptTokenCount"),candidateTokenCount:count("candidatesTokenCount"),totalTokenCount:count("totalTokenCount"),cachedTokenCount:count("cachedContentTokenCount"),thoughtTokenCount:count("thoughtsTokenCount")};
}

const VERTEX_SCHEMA_FIELDS=new Set(["type","format","title","description","nullable","default","example","enum","items","properties","propertyOrdering","required","minItems","maxItems","minProperties","maxProperties","minimum","maximum","minLength","maxLength","pattern","anyOf"]);
function vertexSchema(value:unknown):unknown{
  if(Array.isArray(value))return value.map(vertexSchema);
  if(!value||typeof value!=="object")return value;
  const source=value as Record<string,unknown>,result:Record<string,unknown>={};
  for(const[key,item]of Object.entries(source)){
    if(!VERTEX_SCHEMA_FIELDS.has(key))continue;
    if(key==="properties"&&item&&typeof item==="object"&&!Array.isArray(item)){result.properties=Object.fromEntries(Object.entries(item as Record<string,unknown>).map(([name,schema])=>[name,vertexSchema(schema)]));continue;}
    result[key]=key==="items"||key==="anyOf"?vertexSchema(item):item;
  }
  return result;
}

function vertexFunctionDeclarations(items:VertexFunctionDeclaration[]){return items.map(item=>({...item,parameters:vertexSchema(item.parameters) as Record<string,unknown>}));}

function grounding(value:any):VertexGrounding|null{
  const raw=value?.candidates?.[0]?.groundingMetadata;if(!raw||typeof raw!=="object")return null;
  const webSearchQueries=(Array.isArray(raw.webSearchQueries)?raw.webSearchQueries:[]).map((item:unknown)=>String(item??"").trim().slice(0,300)).filter(Boolean).slice(0,10);
  const sources=(Array.isArray(raw.groundingChunks)?raw.groundingChunks:[]).map((item:any)=>item?.web).filter((item:any)=>item&&typeof item.uri==="string").map((item:any)=>({uri:String(item.uri).trim().slice(0,2000),title:String(item.title??"").trim().slice(0,300)})).filter((item:{uri:string})=>/^https:\/\//i.test(item.uri)).slice(0,12);
  const rendered=typeof raw.searchEntryPoint?.renderedContent==="string"?raw.searchEntryPoint.renderedContent.trim().slice(0,6000):"";
  return webSearchQueries.length||sources.length||rendered?{webSearchQueries,sources,renderedContent:rendered||null}:null;
}

export async function streamVertexContent(settings:AntigravityExecutionSettings,model:string,contents:VertexContent[],onChunk:(chunk:VertexStreamChunk)=>void,signal?:AbortSignal,functionDeclarations:VertexFunctionDeclaration[]=[],systemInstruction?:string,googleSearch=false){
  if(googleSearch&&functionDeclarations.length)throw new Error("Vertex Google Search cannot be combined with function declarations in one request.");
  const tools=[...(googleSearch?[{googleSearch:{}}]:[]),...(functionDeclarations.length?[{functionDeclarations:vertexFunctionDeclarations(functionDeclarations)}]:[])];
  const token=await vertexAccessToken(settings),response=await fetch(endpoint(settings,model,"streamGenerateContent"),{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({contents,...(systemInstruction?{systemInstruction:{parts:[{text:systemInstruction}]}}:{}),generationConfig:{candidateCount:1},...(tools.length?{tools}:{})}),signal:signal??AbortSignal.timeout(30*60_000)});
  if(!response.ok)throw new Error(`Vertex AI request failed (${response.status}): ${await vertexError(response)}`);
  if(!response.body)throw new Error("Vertex AI returned an empty streaming response.");
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer="";
  const consume=(line:string)=>{if(!line.startsWith("data:"))return;const data=line.slice(5).trim();if(!data||data==="[DONE]")return;let value:any;try{value=JSON.parse(data);}catch{return;}const parts=value?.candidates?.[0]?.content?.parts??[],text=parts.map((part:any)=>typeof part?.text==="string"?part.text:"").join(""),functionCalls=parts.map((part:any)=>({call:part?.functionCall,thoughtSignature:typeof part?.thoughtSignature==="string"?part.thoughtSignature:undefined})).filter((item:any)=>typeof item.call?.name==="string").map((item:any)=>({name:item.call.name,args:item.call.args&&typeof item.call.args==="object"&&!Array.isArray(item.call.args)?item.call.args:{},...(item.thoughtSignature?{thoughtSignature:item.thoughtSignature}:{})}));onChunk({text,functionCalls,usage:usage(value),modelVersion:typeof value?.modelVersion==="string"?value.modelVersion:null,grounding:grounding(value)});};
  for(;;){const{done,value}=await reader.read();buffer+=decoder.decode(value??new Uint8Array(),{stream:!done});let newline;while((newline=buffer.indexOf("\n"))>=0){consume(buffer.slice(0,newline).replace(/\r$/, ""));buffer=buffer.slice(newline+1);}if(done)break;}
  if(buffer.trim())consume(buffer.trim());
}
