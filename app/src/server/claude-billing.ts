import fs from "node:fs";
import path from "node:path";
import {z} from "zod";

// Claude tasks normally run on the signed-in subscription. In "api" mode the
// worker receives ANTHROPIC_API_KEY, which the Claude CLI prefers over the
// subscription login, so usage is billed to the linked Console organization
// (where the monthly Max/Team API credits are spent).
export type ClaudeBillingMode="subscription"|"api";

type StoredClaudeBilling={version:1;mode:ClaudeBillingMode;apiKey:string|null;adminKey:string|null;monthlyCreditUsd:number;cycleResetDay:number};
const DEFAULTS:StoredClaudeBilling={version:1,mode:"subscription",apiKey:null,adminKey:null,monthlyCreditUsd:100,cycleResetDay:1};

export const claudeBillingUpdateSchema=z.object({
  mode:z.enum(["subscription","api"]),
  apiKey:z.string().trim().max(4096).optional(),
  clearApiKey:z.boolean().optional(),
  adminKey:z.string().trim().max(4096).optional(),
  clearAdminKey:z.boolean().optional(),
  monthlyCreditUsd:z.number().min(0).max(100000).optional(),
  cycleResetDay:z.number().int().min(1).max(31).optional()
}).strict();

function settingsFile(dataRoot:string){return path.join(dataRoot,"config","claude-billing.json");}
export function claudeCreditLedgerFile(dataRoot:string){return path.join(dataRoot,"state","claude-api-credit-ledger.jsonl");}

function readStored(dataRoot:string):StoredClaudeBilling{
  try{
    const file=settingsFile(dataRoot),stat=fs.lstatSync(file);
    if(!stat.isFile()||stat.isSymbolicLink())throw new Error("Claude billing settings path is unsafe.");
    const value=JSON.parse(fs.readFileSync(file,"utf8"));
    const credit=Number(value?.monthlyCreditUsd),day=Number(value?.cycleResetDay);
    return{
      version:1,
      mode:value?.mode==="api"?"api":"subscription",
      apiKey:typeof value?.apiKey==="string"&&value.apiKey?value.apiKey:null,
      adminKey:typeof value?.adminKey==="string"&&value.adminKey?value.adminKey:null,
      monthlyCreditUsd:Number.isFinite(credit)&&credit>=0?credit:DEFAULTS.monthlyCreditUsd,
      cycleResetDay:Number.isInteger(day)&&day>=1&&day<=31?day:DEFAULTS.cycleResetDay
    };
  }catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;return{...DEFAULTS};}
}

/** The key is only returned when API mode is active and a key is stored. */
export function claudeApiKeyForLaunch(dataRoot:string):string|null{
  try{const stored=readStored(dataRoot);return stored.mode==="api"&&stored.apiKey?stored.apiKey:null;}catch{return null;}
}

export function claudeUsesApiCredits(dataRoot:string){return claudeApiKeyForLaunch(dataRoot)!==null;}

/** Start of the billing cycle containing `now`, on the configured day (clamped to short months). */
export function claudeCreditCycleStart(now:Date,resetDay:number){
  const clamp=(year:number,month:number)=>Math.min(resetDay,new Date(year,month+1,0).getDate());
  let year=now.getFullYear(),month=now.getMonth();
  if(now.getDate()<clamp(year,month)){month-=1;if(month<0){month=11;year-=1;}}
  return new Date(year,month,clamp(year,month));
}

type LedgerEntry={at:string;taskId:string|null;costUsd:number};

function readLedger(dataRoot:string):LedgerEntry[]{
  let raw="";
  try{raw=fs.readFileSync(claudeCreditLedgerFile(dataRoot),"utf8");}catch{return[];}
  const entries:LedgerEntry[]=[];
  for(const line of raw.split("\n")){
    if(!line.trim())continue;
    try{const value=JSON.parse(line),cost=Number(value?.costUsd);if(value?.billing==="api"&&typeof value?.at==="string"&&Number.isFinite(cost)&&cost>=0)entries.push({at:value.at,taskId:typeof value.taskId==="string"?value.taskId:null,costUsd:cost});}catch{}
  }
  return entries;
}

/**
 * Called by the worker when an API-billed Claude run ends. Only entries tagged
 * billing:"api" are counted: untagged ones came from workers that inherited the
 * ledger path while running on the subscription.
 */
export function appendClaudeCreditLedger(file:string,entry:LedgerEntry&{calls?:number;cliCostUsd?:number|null;billing?:"api"}){
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  fs.appendFileSync(file,`${JSON.stringify(entry)}\n`,{encoding:"utf8",mode:0o600});
}

export type ClaudeCreditStatus={
  /** "organization": Admin API cost report for the whole Console org; "local": runs Workhouse recorded. */
  source:"organization"|"local";
  cycleStart:string;
  spentUsd:number;
  remainingUsd:number;
  monthlyCreditUsd:number;
  runs:number|null;
  /** Mean cost of one API-mode run this cycle from the Workhouse ledger, for estimates. */
  averageRunUsd:number|null;
  fetchedAt:string;
  error:string|null;
};

function localSpend(dataRoot:string,cycleStart:Date){
  const inCycle=readLedger(dataRoot).filter(entry=>{const at=Date.parse(entry.at);return Number.isFinite(at)&&at>=cycleStart.getTime();});
  return{spentUsd:Math.round(inCycle.reduce((sum,entry)=>sum+entry.costUsd,0)*10000)/10000,runs:inCycle.length};
}

type CostFetch=(url:string,init:{headers:Record<string,string>;signal:AbortSignal})=>Promise<{ok:boolean;status:number;json():Promise<any>}>;

/**
 * Organization spend since `since`, in USD, from the Admin API cost report.
 * The report has daily UTC buckets and amounts in cents as decimal strings.
 * There is no endpoint for the credit balance itself.
 */
export async function fetchOrganizationCostUsd(adminKey:string,since:Date,fetcher:CostFetch=fetch as unknown as CostFetch){
  const day=new Date(Date.UTC(since.getUTCFullYear(),since.getUTCMonth(),since.getUTCDate()));
  let cents=0,page:string|null=null;
  for(let i=0;i<6;i++){
    const url=new URL("https://api.anthropic.com/v1/organizations/cost_report");
    url.searchParams.set("starting_at",day.toISOString());url.searchParams.set("bucket_width","1d");url.searchParams.set("limit","31");
    if(page)url.searchParams.set("page",page);
    const response=await fetcher(url.toString(),{headers:{"x-api-key":adminKey,"anthropic-version":"2023-06-01","user-agent":"ClaudexWorkhouse"},signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new Error(response.status===401||response.status===403?"admin_key_rejected":`cost_report_${response.status}`);
    const body=await response.json();
    for(const bucket of Array.isArray(body?.data)?body.data:[])for(const item of Array.isArray(bucket?.results)?bucket.results:[]){const amount=Number(item?.amount);if(Number.isFinite(amount)&&(item?.currency??"USD")==="USD")cents+=amount;}
    if(!body?.has_more||typeof body?.next_page!=="string")break;
    page=body.next_page;
  }
  return Math.round(cents)/100;
}

const organizationCache=new Map<string,{at:number;spentUsd:number}>();
const ORGANIZATION_CACHE_MS=60_000;

export async function claudeCreditStatus(dataRoot:string,now=new Date(),fetcher?:CostFetch):Promise<ClaudeCreditStatus>{
  const stored=readStored(dataRoot),cycleStart=claudeCreditCycleStart(now,stored.cycleResetDay),local=localSpend(dataRoot,cycleStart);
  const result=(source:ClaudeCreditStatus["source"],spentUsd:number,runs:number|null,error:string|null):ClaudeCreditStatus=>({source,cycleStart:cycleStart.toISOString(),spentUsd,remainingUsd:Math.max(0,Math.round((stored.monthlyCreditUsd-spentUsd)*100)/100),monthlyCreditUsd:stored.monthlyCreditUsd,runs,fetchedAt:now.toISOString(),averageRunUsd:local.runs?Math.round(local.spentUsd/local.runs*100)/100:null,error});
  if(!stored.adminKey)return result("local",local.spentUsd,local.runs,null);
  const cacheKey=`${stored.adminKey.slice(-8)}:${cycleStart.toISOString()}`,cached=organizationCache.get(cacheKey);
  if(cached&&now.getTime()-cached.at<ORGANIZATION_CACHE_MS)return result("organization",cached.spentUsd,null,null);
  try{
    const spentUsd=await fetchOrganizationCostUsd(stored.adminKey,cycleStart,fetcher);
    organizationCache.set(cacheKey,{at:now.getTime(),spentUsd});
    return result("organization",spentUsd,null,null);
  }catch(error){
    return result("local",local.spentUsd,local.runs,error instanceof Error?error.message:"cost_report_failed");
  }
}

export async function claudeBillingPublicSettings(dataRoot:string,now=new Date(),fetcher?:CostFetch){
  const stored=readStored(dataRoot);
  return{
    mode:stored.mode,
    apiKeyConfigured:Boolean(stored.apiKey),
    apiKeyHint:stored.apiKey?`…${stored.apiKey.slice(-4)}`:null,
    adminKeyConfigured:Boolean(stored.adminKey),
    adminKeyHint:stored.adminKey?`…${stored.adminKey.slice(-4)}`:null,
    environmentKeyPresent:Boolean(process.env.ANTHROPIC_API_KEY||process.env.ANTHROPIC_AUTH_TOKEN),
    monthlyCreditUsd:stored.monthlyCreditUsd,
    cycleResetDay:stored.cycleResetDay,
    credit:await claudeCreditStatus(dataRoot,now,fetcher)
  };
}

export async function saveClaudeBillingSettings(dataRoot:string,input:z.infer<typeof claudeBillingUpdateSchema>){
  const stored=readStored(dataRoot),apiKey=input.apiKey?.trim(),adminKey=input.adminKey?.trim();
  if([apiKey,adminKey].some(key=>key&&/[\u0000-\u001f\u007f\s]/.test(key)))throw Object.assign(new Error("The API key is invalid."),{statusCode:400});
  const next:StoredClaudeBilling={
    version:1,
    mode:input.mode,
    apiKey:input.clearApiKey?null:apiKey||stored.apiKey,
    adminKey:input.clearAdminKey?null:adminKey||stored.adminKey,
    monthlyCreditUsd:input.monthlyCreditUsd??stored.monthlyCreditUsd,
    cycleResetDay:input.cycleResetDay??stored.cycleResetDay
  };
  if(next.mode==="api"&&!next.apiKey)throw Object.assign(new Error("Enter an Anthropic API key before switching to API credits."),{statusCode:400,code:"CLAUDE_API_KEY_REQUIRED"});
  const file=settingsFile(dataRoot),temporary=`${file}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  fs.writeFileSync(temporary,`${JSON.stringify(next,null,2)}\n`,{encoding:"utf8",mode:0o600,flag:"wx"});
  try{fs.chmodSync(temporary,0o600);fs.renameSync(temporary,file);fs.chmodSync(file,0o600);}catch(error){try{fs.unlinkSync(temporary);}catch{}throw error;}
  return claudeBillingPublicSettings(dataRoot);
}
