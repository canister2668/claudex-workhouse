import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type ApprovalDecision = "accept" | "acceptForSession" | "decline" | "cancel";
export type ApprovalRisk = "low" | "medium" | "high" | "very-high";

export interface PendingApproval {
  id: string;
  providerRequestId: string;
  fingerprint: string;
  taskId: string;
  provider: "codex" | "claude";
  hostId: string;
  workspaceId: string | null;
  threadId: string | null;
  turnId: string | null;
  itemId: string | null;
  method: string;
  kind: "command" | "file-change" | "permissions";
  summary: string;
  command: string | null;
  paths: string[];
  access: Array<"read" | "write" | "execute" | "network">;
  risk: ApprovalRisk;
  availableDecisions: ApprovalDecision[];
  requestedAt: string;
  expiresAt: string;
}

const DECISIONS = new Set<ApprovalDecision>(["accept", "acceptForSession", "decline", "cancel"]);
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const SECRET_PATH = /(?:^|[\\/])(?:\.ssh|\.aws|\.gnupg|\.config[\\/](?:gcloud|gh)|\.claude|\.codex|credentials?|secrets?|id_(?:rsa|ed25519)|\.env(?:\.|$))/i;
const VERY_HIGH_COMMAND = /(?:^|\s)(?:sudo|su|doas|systemctl|service|launchctl|sc\s|reg\s|taskkill|rm\s+-rf|del\s+\/s|format|mkfs|docker\s+(?:run|exec)|kubectl|apt(?:-get)?|dnf|yum|pacman|brew\s+install|npm\s+(?:install|-g)|pnpm\s+(?:add|install)|ssh-keygen)(?:\s|$)/i;
const NETWORK_COMMAND = /(?:curl|wget|Invoke-WebRequest|git\s+(?:clone|fetch|pull|push)|ssh\s|scp\s|rsync\s|nc\s|ncat\s)/i;

export function approvalDirectory(stateFile: string) { return `${stateFile}.approvals`; }
export function prepareApprovalDirectory(stateFile: string) {
  const directory = approvalDirectory(stateFile);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(directory, 0o700); } catch {}
  return directory;
}
function approvalPath(stateFile: string, approvalId: string, suffix: "pending" | "response" | "resolved") {
  if (!/^[0-9a-f-]{36}$/i.test(approvalId)) throw new Error("Invalid approval ID.");
  return path.join(approvalDirectory(stateFile), `${approvalId}.${suffix}.json`);
}
function writePrivate(file: string, value: unknown) {
  fs.writeFileSync(file, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
}
function cleanText(value: unknown, max = 2000) { return String(value ?? "").replace(CONTROL, "").slice(0, max); }
function cleanPaths(value: unknown): string[] {
  const source = Array.isArray(value) ? value : [];
  return [...new Set(source.flatMap((item: any) => [item?.path, item?.file, item?.filePath]).filter((item) => typeof item === "string").map((item) => cleanText(item, 500)))].slice(0, 50);
}
function pathWithin(root:string,target:string){const relative=path.relative(path.resolve(root),path.resolve(target));return relative===""||relative!==".."&&!relative.startsWith(`..${path.sep}`)&&!path.isAbsolute(relative);}
function classify(command: string, paths: string[], access: PendingApproval["access"], method: string, cwd:string): ApprovalRisk {
  if (paths.some((item) => SECRET_PATH.test(item)) || VERY_HIGH_COMMAND.test(command) || /permissions\/requestApproval/.test(method)) return "very-high";
  if (access.includes("network") || NETWORK_COMMAND.test(command) || paths.some((item) => path.isAbsolute(item) && !pathWithin(cwd,item))) return "high";
  if (access.includes("write") || access.includes("execute")) return "medium";
  return "low";
}

function stableApprovalId(value:string){const hex=crypto.createHash("sha256").update(value).digest("hex");return`${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;}
export function codexApprovalRecord(input: { taskId:string; hostId:string; workspaceId?:string|null; cwd:string; method:string; params:any; providerRequestId?:string|number; ttlMs?:number }): PendingApproval {
  const params = input.params ?? {};
  const command = cleanText(Array.isArray(params.command) ? params.command.join(" ") : params.command ?? "", 4000) || null;
  const pathInputs = [...(Array.isArray(params.changes) ? params.changes : []), ...(typeof params.grantRoot === "string" ? [{ path:params.grantRoot }] : [])];
  const paths = cleanPaths(pathInputs);
  const kind:PendingApproval["kind"] = input.method.includes("commandExecution") || input.method === "execCommandApproval" ? "command" : input.method.includes("permissions") ? "permissions" : "file-change";
  const access:PendingApproval["access"] = kind === "file-change" ? ["write"] : kind === "permissions" ? ["read","write","execute","network"] : ["execute", ...(params.networkApprovalContext ? ["network" as const] : [])];
  const advertised = Array.isArray(params.availableDecisions) ? params.availableDecisions.filter((item:any):item is ApprovalDecision => typeof item === "string" && DECISIONS.has(item as ApprovalDecision)) : [];
  const availableDecisions = [...new Set<ApprovalDecision>(advertised.length ? advertised : ["accept", "decline"])] as ApprovalDecision[];
  const requestedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + Math.min(input.ttlMs ?? 15 * 60_000, 15 * 60_000)).toISOString();
  const summary = cleanText(params.reason ?? (kind === "command" ? command : kind === "file-change" ? "Workspace file changes" : "Additional permissions"), 500);
  const providerRequestId=String(input.providerRequestId??params.requestId??params.id??crypto.randomUUID()),fingerprint=crypto.createHash("sha256").update(JSON.stringify({method:input.method,command,paths,reason:params.reason??null,threadId:params.threadId??null,turnId:params.turnId??null,itemId:params.itemId??null})).digest("hex");
  return { id:stableApprovalId(`${input.taskId}\0${providerRequestId}\0${input.method}`), providerRequestId, fingerprint, taskId:input.taskId, provider:"codex", hostId:input.hostId, workspaceId:input.workspaceId ?? null, threadId:params.threadId ?? null, turnId:params.turnId ?? null, itemId:params.itemId ?? null, method:input.method, kind, summary, command, paths, access, risk:classify(command ?? "", paths, access, input.method,input.cwd), availableDecisions, requestedAt, expiresAt };
}

export function persistPendingApproval(stateFile:string, approval:PendingApproval) {
  prepareApprovalDirectory(stateFile);
  try{const resolved=JSON.parse(fs.readFileSync(approvalPath(stateFile,approval.id,"resolved"),"utf8"));if(DECISIONS.has(resolved.decision))return{created:false,resolvedDecision:resolved.decision as ApprovalDecision};}catch{}
  const pending=approvalPath(stateFile,approval.id,"pending");
  try{writePrivate(pending,approval);return{created:true,resolvedDecision:null};}
  catch(error:any){if(error?.code!=="EEXIST")throw error;try{const existing=JSON.parse(fs.readFileSync(pending,"utf8"));if(existing.providerRequestId===approval.providerRequestId&&existing.fingerprint===approval.fingerprint)return{created:false,resolvedDecision:null};}catch{}throw new Error("Approval ID collision detected.");}
}
export function listPendingApprovals(stateFile:string):PendingApproval[] {
  const directory=approvalDirectory(stateFile);let names:string[]=[];try{names=fs.readdirSync(directory);}catch{return[];}
  const result:PendingApproval[]=[];
  for(const name of names.filter(item=>item.endsWith(".pending.json"))){try{const item=JSON.parse(fs.readFileSync(path.join(directory,name),"utf8"));if(new Date(item.expiresAt).getTime()>Date.now())result.push(item);else fs.rmSync(path.join(directory,name),{force:true});}catch{}}
  return result.sort((a,b)=>a.requestedAt.localeCompare(b.requestedAt));
}
export function submitApprovalDecision(stateFile:string, approvalId:string, decision:ApprovalDecision) {
  if(!DECISIONS.has(decision))throw Object.assign(new Error("Unsupported approval decision."),{statusCode:400,code:"APPROVAL_DECISION_UNSUPPORTED"});
  const pendingFile=approvalPath(stateFile,approvalId,"pending");let pending:PendingApproval;
  try{pending=JSON.parse(fs.readFileSync(pendingFile,"utf8"));}catch{throw Object.assign(new Error("Approval request is no longer pending."),{statusCode:409,code:"APPROVAL_NOT_PENDING"});}
  if(new Date(pending.expiresAt).getTime()<=Date.now())throw Object.assign(new Error("Approval request has expired."),{statusCode:409,code:"APPROVAL_EXPIRED"});
  if(!pending.availableDecisions.includes(decision))throw Object.assign(new Error("Provider does not support that approval scope."),{statusCode:400,code:"APPROVAL_SCOPE_UNSUPPORTED"});
  try{writePrivate(approvalPath(stateFile,approvalId,"response"),{approvalId,decision,createdAt:new Date().toISOString()});}
  catch(error:any){if(error?.code==="EEXIST")throw Object.assign(new Error("Approval request has already been answered."),{statusCode:409,code:"APPROVAL_ALREADY_ANSWERED"});throw error;}
  return pending;
}
export async function waitForApprovalDecision(stateFile:string, approval:PendingApproval, signal?:AbortSignal):Promise<ApprovalDecision>{
  const responseFile=approvalPath(stateFile,approval.id,"response"),pendingFile=approvalPath(stateFile,approval.id,"pending");
  try{
    while(Date.now()<new Date(approval.expiresAt).getTime()){
      if(signal?.aborted)throw new Error("Approval request was cancelled.");
      try{const response=JSON.parse(fs.readFileSync(responseFile,"utf8"));if(DECISIONS.has(response.decision)){try{writePrivate(approvalPath(stateFile,approval.id,"resolved"),{approvalId:approval.id,providerRequestId:approval.providerRequestId,decision:response.decision,createdAt:new Date().toISOString()});}catch(error:any){if(error?.code!=="EEXIST")throw error;}return response.decision;}}catch{}
      await new Promise(resolve=>setTimeout(resolve,200));
    }
    return "decline";
  }finally{fs.rmSync(responseFile,{force:true});fs.rmSync(pendingFile,{force:true});}
}
export function cleanupApprovalFiles(stateFile:string){fs.rmSync(approvalDirectory(stateFile),{recursive:true,force:true});}
