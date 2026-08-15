import path from "node:path";
import {z} from "zod";

/**
 * `consumer` runs the Antigravity CLI on its Google-account session, `vertex`
 * answers directly over the Vertex REST API, and `vertex-agent` runs the
 * official Gemini CLI against the same Vertex project so file, edit, and shell
 * tools are available while the spend stays on Google Cloud billing.
 */
export const antigravityBackendSchema=z.enum(["consumer","vertex","vertex-agent"]);
export type AntigravityBackend=z.infer<typeof antigravityBackendSchema>;

/** Both Vertex backends read the same project, region, and service-account key. */
export function usesVertexCredentials(backend:AntigravityBackend){return backend==="vertex"||backend==="vertex-agent";}

export const antigravityExecutionSettingsSchema=z.object({
  version:z.literal(1),
  backend:antigravityBackendSchema,
  vertex:z.object({
    projectId:z.string().trim().max(128),
    location:z.string().trim().min(1).max(64).regex(/^[a-z0-9-]+$/),
    credentialsPath:z.string().trim().max(2048),
    creditsUrl:z.string().trim().max(2048).default("")
  })
}).superRefine((value,context)=>{
  if(!usesVertexCredentials(value.backend))return;
  if(!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(value.vertex.projectId))context.addIssue({code:z.ZodIssueCode.custom,path:["vertex","projectId"],message:"A valid Google Cloud project ID is required for Vertex."});
  if(value.vertex.credentialsPath&&!path.isAbsolute(value.vertex.credentialsPath))context.addIssue({code:z.ZodIssueCode.custom,path:["vertex","credentialsPath"],message:"The ADC credentials path must be absolute."});
  if(value.vertex.creditsUrl)try{const url=new URL(value.vertex.creditsUrl),allowedParams=new Set(["authuser","organizationId"]);if(url.protocol!=="https:"||url.hostname!=="console.cloud.google.com"||url.username||url.password||url.port||!/^\/billing\/[A-Z0-9-]+\/credits\/all\/?$/.test(url.pathname)||[...url.searchParams.keys()].some(key=>!allowedParams.has(key))||url.searchParams.has("authuser")&&!/^\d+$/.test(url.searchParams.get("authuser")??"")||url.searchParams.has("organizationId")&&!/^\d+$/.test(url.searchParams.get("organizationId")??""))throw new Error();}catch{context.addIssue({code:z.ZodIssueCode.custom,path:["vertex","creditsUrl"],message:"Use a Google Cloud Billing credits page URL."});}
});

export type AntigravityExecutionSettings=z.infer<typeof antigravityExecutionSettingsSchema>;
export const DEFAULT_ANTIGRAVITY_EXECUTION:AntigravityExecutionSettings={version:1,backend:"consumer",vertex:{projectId:"",location:"global",credentialsPath:"",creditsUrl:""}};

export function normalizeAntigravityExecutionSettings(value:unknown):AntigravityExecutionSettings{
  const parsed=antigravityExecutionSettingsSchema.safeParse(value);
  if(parsed.success)return parsed.data;
  if(value&&typeof value==="object"){
    const raw=value as any,backend:AntigravityBackend=raw.backend==="vertex"?"vertex":raw.backend==="vertex-agent"?"vertex-agent":"consumer";
    const candidate={version:1 as const,backend,vertex:{projectId:String(raw.vertex?.projectId??"").trim(),location:String(raw.vertex?.location??"global").trim()||"global",credentialsPath:String(raw.vertex?.credentialsPath??"").trim(),creditsUrl:String(raw.vertex?.creditsUrl??"").trim()}};
    if(backend==="consumer")return candidate;
  }
  return structuredClone(DEFAULT_ANTIGRAVITY_EXECUTION);
}

export function antigravityExecutionKey(value:AntigravityExecutionSettings){return usesVertexCredentials(value.backend)?`${value.backend}:${value.vertex.projectId}:${value.vertex.location}:${value.vertex.credentialsPath}`:"consumer";}

export type GoogleCredentialSummary={type:"service_account"|"external_account"|"authorized_user"|"impersonated_service_account";projectId:string|null;accountLabel:string|null};
export function parseGoogleCredentialJson(value:unknown):GoogleCredentialSummary{
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("The uploaded file is not a Google credentials JSON object.");
  const item=value as Record<string,unknown>,type=String(item.type??"") as GoogleCredentialSummary["type"];
  if(type==="service_account"){
    const email=String(item.client_email??""),privateKey=String(item.private_key??"");
    if(!email.includes("@")||!privateKey.includes("BEGIN PRIVATE KEY"))throw new Error("The service account JSON is missing client_email or private_key.");
    return{type,projectId:typeof item.project_id==="string"?item.project_id:null,accountLabel:email};
  }
  if(type==="external_account"){
    if(typeof item.audience!=="string"||typeof item.subject_token_type!=="string"||typeof item.token_url!=="string"||!item.credential_source||typeof item.credential_source!=="object")throw new Error("The external account JSON is incomplete.");
    return{type,projectId:typeof item.project_id==="string"?item.project_id:null,accountLabel:typeof item.service_account_impersonation_url==="string"?"workload identity":null};
  }
  if(type==="authorized_user"){
    if(typeof item.client_id!=="string"||typeof item.client_secret!=="string"||typeof item.refresh_token!=="string")throw new Error("The authorized user ADC JSON is incomplete.");
    return{type,projectId:typeof item.quota_project_id==="string"?item.quota_project_id:null,accountLabel:"authorized user"};
  }
  if(type==="impersonated_service_account"){
    if(typeof item.service_account_impersonation_url!=="string"||!item.source_credentials||typeof item.source_credentials!=="object")throw new Error("The service account impersonation JSON is incomplete.");
    return{type,projectId:typeof item.quota_project_id==="string"?item.quota_project_id:null,accountLabel:"service account impersonation"};
  }
  throw new Error("Supported Google credential types are service_account, external_account, authorized_user, and impersonated_service_account.");
}
