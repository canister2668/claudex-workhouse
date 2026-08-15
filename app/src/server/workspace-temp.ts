import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ProviderId } from "./types.js";

const digest=(value:string)=>crypto.createHash("sha256").update(value).digest("hex").slice(0,24);

export function workspaceTempRoot(tempRoot:string,workspaceId:string){
  return path.join(tempRoot,"workspaces",digest(workspaceId));
}

export function taskTempDirectory(tempRoot:string,workspaceId:string,provider:ProviderId,taskId:string){
  return path.join(workspaceTempRoot(tempRoot,workspaceId),`${provider}-task-${digest(taskId)}`);
}

export function ensureTaskTempDirectory(tempRoot:string,workspaceId:string,provider:ProviderId,taskId:string){
  const target=taskTempDirectory(tempRoot,workspaceId,provider,taskId);
  fs.mkdirSync(target,{recursive:true,mode:0o700});
  const stat=fs.lstatSync(target);
  if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error("Task temporary path is not a regular directory.");
  fs.chmodSync(target,0o700);
  return target;
}
