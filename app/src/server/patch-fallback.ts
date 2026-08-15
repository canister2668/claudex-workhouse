import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type PatchFailure="command-not-found"|"sandbox-bootstrap-failed"|"namespace-failed"|"kernel-unsupported"|"patch-format-invalid"|"file-conflict"|"permission-denied"|"workspace-boundary-violation"|"unknown";
export function classifyPatchFailure(error:unknown):PatchFailure{const value=error instanceof Error?`${error.name} ${error.message}`:String(error);if(/apply_patch.*(?:not found|ENOENT)|command not found/i.test(value))return"command-not-found";if(/bwrap|sandbox.*(?:bootstrap|initialize|start)/i.test(value))return"sandbox-bootstrap-failed";if(/kernel does not support user namespaces|uid_map.*No such file/i.test(value))return"kernel-unsupported";if(/user namespace|uid_map|gid_map|namespace.*(?:EPERM|not permitted|denied)/i.test(value))return"namespace-failed";if(/invalid patch|malformed patch|patch format/i.test(value))return"patch-format-invalid";if(/conflict|context.*(?:mismatch|not found)|file changed/i.test(value))return"file-conflict";if(/outside.*workspace|workspace.*boundary|path escape/i.test(value))return"workspace-boundary-violation";if(/EACCES|permission denied/i.test(value))return"permission-denied";return"unknown";}
export function workspacePatchFallbackPlan(failure:PatchFailure){if(failure==="workspace-boundary-violation")return[];if(["patch-format-invalid","file-conflict","command-not-found","sandbox-bootstrap-failed","namespace-failed","kernel-unsupported"].includes(failure))return["exact-replacement","atomic-temp-replace","simple-sed","verify-diff"] as const;return["verify-diff"] as const;}

function inside(root:string,target:string){return target===root||target.startsWith(`${root}${path.sep}`);}
/** Exact replacement fallback for a known workspace file. It uses a private
 * same-directory temporary and atomic rename; no permission expansion or
 * full-access retry occurs. */
export function atomicExactReplacement(workspace:string,file:string,expected:string,replacement:string){
  const root=fs.realpathSync(workspace),requested=path.resolve(root,file);if(!inside(root,requested))throw Object.assign(new Error("Patch target leaves the workspace boundary."),{code:"WORKSPACE_BOUNDARY_VIOLATION"});
  const target=fs.realpathSync(requested);if(!inside(root,target))throw Object.assign(new Error("Patch target symlink leaves the workspace boundary."),{code:"WORKSPACE_BOUNDARY_VIOLATION"});
  const before=fs.readFileSync(target,"utf8"),first=before.indexOf(expected);if(first<0||before.indexOf(expected,first+expected.length)>=0)throw Object.assign(new Error("Exact replacement context is missing or ambiguous."),{code:"FILE_CONFLICT"});
  const after=`${before.slice(0,first)}${replacement}${before.slice(first+expected.length)}`,stat=fs.statSync(target),temporary=path.join(path.dirname(target),`.${path.basename(target)}.claudex-workhouse-${process.pid}-${crypto.randomUUID()}.tmp`);let fd:number|null=null;
  try{fd=fs.openSync(temporary,"wx",stat.mode&0o777);fs.writeFileSync(fd,after,"utf8");fs.fsyncSync(fd);fs.closeSync(fd);fd=null;fs.renameSync(temporary,target);return{changed:true,path:target,beforeHash:crypto.createHash("sha256").update(before).digest("hex"),afterHash:crypto.createHash("sha256").update(after).digest("hex"),strategy:"atomic-exact-replacement" as const};}
  finally{if(fd!==null)try{fs.closeSync(fd);}catch{}fs.rmSync(temporary,{force:true});}
}
