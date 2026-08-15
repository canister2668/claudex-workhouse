import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import type {AutomationLevel} from "./automation-level.js";
import type {ProviderId} from "./types.js";

export type SandboxCapabilityStatus="native-supported"|"native-unavailable"|"native-broken"|"container-supported"|"trusted-host-available"|"unknown";
export type SandboxFailureReason="binary-missing"|"platform-unsupported"|"userns-disabled"|"uid-map-missing"|"namespace-creation-denied"|"mount-denied"|"kernel-unsupported"|"policy-denied"|"smoke-test-failed"|"timeout"|"unknown";
export type ExecutionBackend="native-sandbox"|"isolated-worker"|"trusted-host"|"compatibility"|"blocked"|"full-access"|"read-only"|"confirmation"|"provider-native"|"provider-tool-restricted"|"provider-native-no-sandbox";
export type EffectiveSandbox="read-only"|"workspace-write"|"danger-full-access"|"none"|null;
export type EffectiveApprovalPolicy="never"|"on-request"|null;
export type SandboxCapability={status:SandboxCapabilityStatus;reason:SandboxFailureReason|null;checkedAt:string;cacheKey:string;kernel:string;architecture:string;bwrapPath:string|null;bwrapVersion:string|null;codexVersion:string|null;workerVersion:string;uid:number;gid:number;bootId:string|null;detail:string|null};

export type ExecutionPolicyInput={
  provider:ProviderId;
  requestedAutomation:AutomationLevel;
  hostId:string;
  workspaceId:string;
  sandboxCapability:SandboxCapability|null;
  hostFallbackPolicy:{trustedHost:boolean;isolatedWorker:boolean};
  providerCapabilities:{automatic:boolean;confirm:boolean;fullAccess:boolean;readOnly:boolean};
  runtimeVersion:string|null;
};
export type ExecutionPolicy={
  provider:ProviderId;
  requestedAutomation:"automatic"|"confirm"|"full"|"read";
  effectiveSandbox:EffectiveSandbox;
  effectiveApprovalPolicy:EffectiveApprovalPolicy;
  executionBackend:ExecutionBackend;
  allowed:boolean;
  userActionRequired:boolean;
  reason:string|null;
  uiLabel:string;
  /** Exact value sent to Codex. Trusted-host intentionally records `none`
   * above while the provider transport uses its no-sandbox enum here. */
  transportSandbox:"read-only"|"workspace-write"|"danger-full-access"|null;
};

const requestedLabel=(level:AutomationLevel):ExecutionPolicy["requestedAutomation"]=>level==="auto"?"automatic":level;
const blocked=(input:ExecutionPolicyInput,reason:string):ExecutionPolicy=>({provider:input.provider,requestedAutomation:requestedLabel(input.requestedAutomation),effectiveSandbox:null,effectiveApprovalPolicy:null,executionBackend:"blocked",allowed:false,userActionRequired:true,reason,uiLabel:"Execution blocked",transportSandbox:null});

/** Single source of truth for every local/remote launch path. It is pure: all
 * host probing and persisted opt-in lookup happen before this function. */
export function resolveExecutionPolicy(input:ExecutionPolicyInput):ExecutionPolicy{
  const requestedAutomation=requestedLabel(input.requestedAutomation);
  const isolated=input.hostFallbackPolicy.isolatedWorker||input.sandboxCapability?.status==="container-supported",native=input.sandboxCapability?.status==="native-supported";
  if(input.requestedAutomation==="read"){
    if(!input.providerCapabilities.readOnly)return blocked(input,"provider-read-only-unsupported");
    return input.provider==="codex"
      ?native||isolated
        ?{provider:"codex",requestedAutomation,effectiveSandbox:"read-only",effectiveApprovalPolicy:"never",executionBackend:isolated?"isolated-worker":"read-only",allowed:true,userActionRequired:false,reason:null,uiLabel:isolated?"Isolated Worker · Read only":"Read only",transportSandbox:"read-only"}
        :{provider:"codex",requestedAutomation,effectiveSandbox:"none",effectiveApprovalPolicy:"never",executionBackend:"compatibility",allowed:true,userActionRequired:false,reason:"sandbox-unavailable-compatibility-fallback",uiLabel:"Compatibility mode · Read-only instruction",transportSandbox:"danger-full-access"}
      :{provider:"claude",requestedAutomation,effectiveSandbox:"read-only",effectiveApprovalPolicy:"never",executionBackend:"provider-native",allowed:true,userActionRequired:false,reason:null,uiLabel:"Read only",transportSandbox:null};
  }
  if(input.requestedAutomation==="full"){
    if(!input.providerCapabilities.fullAccess)return blocked(input,"provider-full-access-unsupported");
    return{provider:input.provider,requestedAutomation,effectiveSandbox:"danger-full-access",effectiveApprovalPolicy:"never",executionBackend:"full-access",allowed:true,userActionRequired:false,reason:null,uiLabel:"Full auto · No sandbox",transportSandbox:input.provider==="codex"?"danger-full-access":null};
  }
  if(input.requestedAutomation==="confirm"){
    if(!input.providerCapabilities.confirm)return blocked(input,"provider-confirmation-unsupported");
    return input.provider==="codex"
      ?native||isolated
        ?{provider:"codex",requestedAutomation,effectiveSandbox:"workspace-write",effectiveApprovalPolicy:"on-request",executionBackend:isolated?"isolated-worker":"confirmation",allowed:true,userActionRequired:false,reason:null,uiLabel:isolated?"Isolated Worker · Confirm before running":"Confirm before running",transportSandbox:"workspace-write"}
        :{provider:"codex",requestedAutomation,effectiveSandbox:"none",effectiveApprovalPolicy:"on-request",executionBackend:"compatibility",allowed:true,userActionRequired:false,reason:"sandbox-unavailable-compatibility-fallback",uiLabel:"Compatibility mode · Confirm",transportSandbox:"danger-full-access"}
      :{provider:"claude",requestedAutomation,effectiveSandbox:"workspace-write",effectiveApprovalPolicy:"on-request",executionBackend:"provider-native",allowed:true,userActionRequired:false,reason:null,uiLabel:"Confirm before running",transportSandbox:null};
  }
  if(!input.providerCapabilities.automatic)return blocked(input,"provider-automatic-unsupported");
  if(input.provider==="claude")return{provider:"claude",requestedAutomation,effectiveSandbox:"workspace-write",effectiveApprovalPolicy:"never",executionBackend:"provider-native",allowed:true,userActionRequired:false,reason:null,uiLabel:"Automatic",transportSandbox:null};
  if(input.sandboxCapability?.status==="native-supported")return{provider:"codex",requestedAutomation,effectiveSandbox:"workspace-write",effectiveApprovalPolicy:"never",executionBackend:"native-sandbox",allowed:true,userActionRequired:false,reason:null,uiLabel:"Workspace sandbox",transportSandbox:"workspace-write"};
  if(isolated)return{provider:"codex",requestedAutomation,effectiveSandbox:"workspace-write",effectiveApprovalPolicy:"never",executionBackend:"isolated-worker",allowed:true,userActionRequired:false,reason:null,uiLabel:"Isolated Worker · Automatic",transportSandbox:"workspace-write"};
  if(input.hostFallbackPolicy.trustedHost)return{provider:"codex",requestedAutomation,effectiveSandbox:"none",effectiveApprovalPolicy:"never",executionBackend:"trusted-host",allowed:true,userActionRequired:false,reason:null,uiLabel:"Trusted host · No sandbox",transportSandbox:"danger-full-access"};
  return{provider:"codex",requestedAutomation,effectiveSandbox:"none",effectiveApprovalPolicy:"never",executionBackend:"compatibility",allowed:true,userActionRequired:false,reason:"sandbox-unavailable-compatibility-fallback",uiLabel:"Compatibility mode · No sandbox",transportSandbox:"danger-full-access"};
}

export function executionPolicyErrorCode(policy:ExecutionPolicy,capability:SandboxCapability|null){
  return policy.executionBackend==="blocked"&&policy.reason?.includes("sandbox")&&capability?.status!=="native-supported"?"SANDBOX_BOOTSTRAP_FAILED":"AUTOMATIC_EXECUTION_BLOCKED";
}

export function sandboxBootstrapErrorCategory(error:unknown){
  const detail=error instanceof Error?error.message:String(error);
  return /\bbwrap\b|bubblewrap|creating new namespace failed|user namespaces?|uid_map|gid_map/i.test(detail)?"SANDBOX_BOOTSTRAP_FAILED":null;
}

export function assertCodexPolicy(policy:ExecutionPolicy){
  if(policy.provider!=="codex"||!policy.allowed||!policy.transportSandbox||!policy.effectiveApprovalPolicy)throw Object.assign(new Error("Codex execution policy is blocked or incomplete."),{code:"AUTOMATIC_EXECUTION_BLOCKED"});
  if(policy.requestedAutomation==="automatic"&&(policy.effectiveApprovalPolicy!=="never"||policy.executionBackend==="full-access"||policy.effectiveSandbox==="danger-full-access"))throw new Error("Automatic Codex policy violated the no-approval/no-full-access contract.");
  if(policy.executionBackend==="full-access"&&policy.requestedAutomation!=="full")throw new Error("Full-access backend requires an explicit full automation request.");
  return{sandbox:policy.transportSandbox,approvalPolicy:policy.effectiveApprovalPolicy};
}

function output(command:string,args:string[],timeout=5000,options:{cwd?:string;env?:NodeJS.ProcessEnv}={}){const result=spawnSync(command,args,{cwd:options.cwd,env:options.env,encoding:"utf8",shell:false,windowsHide:true,timeout,maxBuffer:128*1024});return{status:result.status,error:result.error,stdout:String(result.stdout??""),stderr:String(result.stderr??""),signal:result.signal};}
function executable(name:string){
  const candidates=path.isAbsolute(name)?[name]:(process.env.PATH??"").split(path.delimiter).filter(Boolean).map(directory=>path.join(directory,name));
  for(const candidate of candidates)try{fs.accessSync(candidate,fs.constants.X_OK);return fs.realpathSync(candidate);}catch{}
  return null;
}
function bootId(){try{return fs.readFileSync("/proc/sys/kernel/random/boot_id","utf8").trim();}catch{return null;}}
export function classifySandboxFailure(detail:string,errorName?:string):SandboxFailureReason{
  if(errorName==="ETIMEDOUT"||/timed out|timeout/i.test(detail))return"timeout";
  if(/uid_map.*No such file/i.test(detail))return"uid-map-missing";
  if(/user namespaces? (?:are )?disabled|unprivileged_userns_clone[^\n]*0/i.test(detail))return"userns-disabled";
  if(/kernel does not support user namespaces|not configured with.*user namespace/i.test(detail))return"kernel-unsupported";
  if(/creating new namespace failed|namespace.*(?:EPERM|operation not permitted|permission denied)/i.test(detail))return"namespace-creation-denied";
  if(/mount.*(?:denied|not permitted|operation not permitted)/i.test(detail))return"mount-denied";
  if(/seccomp|apparmor|selinux|policy.*denied/i.test(detail))return"policy-denied";
  return"smoke-test-failed";
}
export function sandboxCacheKey(input:{hostId?:string;platform?:NodeJS.Platform;bwrapPath:string|null;bwrapVersion:string|null;codexVersion:string|null;workerVersion:string;bootId:string|null;kernel?:string;architecture?:string;uid?:number;gid?:number}){
  return crypto.createHash("sha256").update(JSON.stringify({hostId:input.hostId??os.hostname(),platform:input.platform??process.platform,kernel:input.kernel??os.release(),architecture:input.architecture??os.arch(),uid:input.uid??process.getuid?.()??-1,gid:input.gid??process.getgid?.()??-1,bwrapPath:input.bwrapPath,bwrapVersion:input.bwrapVersion,codexVersion:input.codexVersion,workerVersion:input.workerVersion,bootId:input.bootId})).digest("hex");
}
export function sandboxEnvironmentIdentity(codexBinary:string,workerVersion="local",hostId="local",platform:NodeJS.Platform=process.platform){
  const bwrapPath=platform==="linux"?executable("bwrap"):null,bwrapVersion=bwrapPath?output(bwrapPath,["--version"]).stdout.trim()||null:null,codexPath=executable(codexBinary),codexVersion=codexPath?output(codexPath,["--version"]).stdout.trim()||null:null,kernel=os.release(),architecture=os.arch(),uid=process.getuid?.()??-1,gid=process.getgid?.()??-1,currentBootId=platform==="linux"?bootId():null;
  return{hostId,bwrapPath,bwrapVersion,codexPath,codexVersion,workerVersion,bootId:currentBootId,kernel,architecture,uid,gid,cacheKey:sandboxCacheKey({hostId,platform,bwrapPath,bwrapVersion,codexVersion,workerVersion,bootId:currentBootId,kernel,architecture,uid,gid})};
}

/** Runs the provider's own Linux sandbox wrapper with the worker UID/GID,
 * HOME, PATH and cwd. The smoke test proves workspace read/write and denial of
 * an outside-workspace write; it does not expose credentials to a custom shell
 * RPC or mount Docker. */
export function probeNativeSandbox(workspace:string,codexBinary:string,workerVersion="local",timeoutMs=10000,hostId="local",platform:NodeJS.Platform=process.platform):SandboxCapability{
  const checkedAt=new Date().toISOString();
  if(platform!=="linux"){
    const kernel=os.release(),architecture=os.arch(),uid=process.getuid?.()??-1,gid=process.getgid?.()??-1,base={checkedAt,cacheKey:sandboxCacheKey({hostId,platform,bwrapPath:null,bwrapVersion:null,codexVersion:null,workerVersion,bootId:null,kernel,architecture,uid,gid}),kernel,architecture,bwrapPath:null,bwrapVersion:null,codexVersion:null,workerVersion,uid,gid,bootId:null};
    return{...base,status:"native-unavailable",reason:"platform-unsupported",detail:`Native bubblewrap sandbox is unavailable on ${platform}.`};
  }
  const identity=sandboxEnvironmentIdentity(codexBinary,workerVersion,hostId,platform),base={checkedAt,cacheKey:identity.cacheKey,kernel:identity.kernel,architecture:identity.architecture,bwrapPath:identity.bwrapPath,bwrapVersion:identity.bwrapVersion,codexVersion:identity.codexVersion,workerVersion,uid:identity.uid,gid:identity.gid,bootId:identity.bootId};
  if(!identity.codexPath)return{...base,status:"native-broken",reason:"binary-missing",detail:"Codex runtime is not executable"};
  if(!identity.bwrapPath)return{...base,status:"native-unavailable",reason:"binary-missing",detail:"bubblewrap is not installed"};
  if(!fs.existsSync("/proc/self/uid_map")||!fs.existsSync("/proc/self/gid_map"))return{...base,status:"native-unavailable",reason:"kernel-unsupported",detail:"/proc/self/uid_map or /proc/self/gid_map: No such file or directory"};
  let parent:string|null=null,outside:string|null=null;
  try{
    parent=fs.mkdtempSync(path.join(workspace,".claudex-workhouse-sandbox-probe-"));const readable=path.join(parent,"read-test"),writable=path.join(parent,"write-test");fs.writeFileSync(readable,"inside-probe",{mode:0o600});
    try{outside=path.join(path.dirname(path.resolve(workspace)),`.claudex-workhouse-outside-canary-${crypto.randomUUID()}`);fs.writeFileSync(outside,"outside-canary",{mode:0o600,flag:"wx"});}catch{outside=path.join(os.tmpdir(),`.claudex-workhouse-outside-canary-${crypto.randomUUID()}`);fs.writeFileSync(outside,"outside-canary",{mode:0o600,flag:"wx"});}
    const script='set -eu; test -r /proc/self/uid_map; test -r /proc/self/gid_map; test "$(cat "$AD_INSIDE_READ")" = inside-probe; printf workspace-write > "$AD_INSIDE_WRITE"; test "$(cat "$AD_INSIDE_WRITE")" = workspace-write; if printf escape >> "$AD_OUTSIDE" 2>/dev/null; then exit 73; fi; test "${HOME:-}" = "$AD_EXPECTED_HOME"';
    const env={...process.env,AD_INSIDE_READ:readable,AD_INSIDE_WRITE:writable,AD_OUTSIDE:outside,AD_EXPECTED_HOME:process.env.HOME??""};
    const result=output(identity.bwrapPath!,["--die-with-parent","--new-session","--unshare-all","--share-net","--ro-bind","/","/","--proc","/proc","--dev","/dev","--bind",workspace,workspace,"--tmpfs","/tmp","--setenv","HOME",process.env.HOME??"","--setenv","AD_INSIDE_READ",readable,"--setenv","AD_INSIDE_WRITE",writable,"--setenv","AD_OUTSIDE",outside,"--setenv","AD_EXPECTED_HOME",process.env.HOME??"","--chdir",workspace,"/bin/sh","-c",script],timeoutMs,{cwd:workspace,env});
    if(result.status===0)return{...base,status:"native-supported",reason:null,detail:null};
    const detail=`exit=${result.status??"unknown"} signal=${result.signal??"none"} ${result.error?.message??""} ${result.stderr} ${result.stdout}`.trim().slice(0,1000),reason=classifySandboxFailure(detail,(result.error as NodeJS.ErrnoException|undefined)?.code);
    return{...base,status:reason==="smoke-test-failed"||reason==="timeout"?"native-broken":"native-unavailable",reason,detail};
  }catch(error){const detail=error instanceof Error?error.message:String(error),reason=classifySandboxFailure(detail,(error as NodeJS.ErrnoException)?.code);return{...base,status:"native-broken",reason,detail:detail.slice(0,1000)};}
  finally{if(parent)fs.rmSync(parent,{recursive:true,force:true});if(outside)fs.rmSync(outside,{force:true});}
}

export function trustedHostSettingKey(hostId:string,provider:ProviderId="codex"){return`security.trusted-host-auto.${hostId}.${provider}`;}
export function trustedHostOptInValid(value:any,input:{hostId:string;provider:string;osIdentity:string;version:number}){return value?.enabled===true&&value.hostId===input.hostId&&value.provider===input.provider&&value.osIdentity===input.osIdentity&&value.version===input.version;}
export function osExecutionIdentity(){return`${process.platform}:${os.release()}:uid=${process.getuid?.()??-1}:gid=${process.getgid?.()??-1}`;}

export class ApprovalLoopError extends Error{
  code="APPROVAL_LOOP_DETECTED";
  constructor(public reason:string,public approvalId:string){super(`Automatic execution stopped before a Provider approval popup (${reason}).`);this.name="ApprovalLoopError";}
}

export function approvalRequestDisposition(policy:ExecutionPolicy):"show"|"circuit-break"{
  return policy.effectiveApprovalPolicy==="on-request"?"show":"circuit-break";
}
