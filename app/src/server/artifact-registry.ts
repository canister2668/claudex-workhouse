import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { DeckDatabase } from "./db/client.js";
import type { DeckTask, Workspace } from "./types.js";
import { taskTempDirectory } from "./workspace-temp.js";

export type ManagedArtifactStatus="present"|"missing-on-disk"|"identity-changed";

type ManagedArtifactRow={
  id:string;hostId:string;workspaceId:string;taskId:string;provider:string;kind:string;path:string;
  deviceId:string|null;inodeId:string|null;sizeBytes:number;status:ManagedArtifactStatus;
  createdAt:string;verifiedAt:string|null;removedAt:string|null;
};

const artifactId=(hostId:string,workspaceId:string,taskId:string,kind:string,target:string)=>crypto.createHash("sha256").update([hostId,workspaceId,taskId,kind,path.resolve(target)].join("\0")).digest("hex");
const allocatedBytes=(stat:fs.Stats)=>Number.isFinite(stat.blocks)?Number(stat.blocks)*512:Number(stat.size);

function identity(target:string){
  try{
    const stat=fs.lstatSync(target);
    if(!stat.isDirectory()||stat.isSymbolicLink())return{status:"identity-changed" as const,deviceId:String(stat.dev),inodeId:String(stat.ino),sizeBytes:allocatedBytes(stat)};
    return{status:"present" as const,deviceId:String(stat.dev),inodeId:String(stat.ino),sizeBytes:allocatedBytes(stat)};
  }catch(error){
    if((error as NodeJS.ErrnoException).code==="ENOENT")return{status:"missing-on-disk" as const,deviceId:null,inodeId:null,sizeBytes:0};
    throw error;
  }
}

export class ArtifactRegistry{
  constructor(private db:DeckDatabase,private tempRoot:string){}

  async reconcile(tasks:DeckTask[],workspaces:Workspace[]){
    const current=await this.db.listManagedArtifacts();
    const existing=new Map(current.map(item=>[item.id,item as ManagedArtifactRow]));
    const seen=new Set<string>();
    const updates:Array<Record<string,unknown>>=[];
    const now=new Date().toISOString();
    for(const task of tasks.slice(0,10_000)){
      if(task.owned===false||(task.ownership&&task.ownership!=="claudex-workhouse"))continue;
      if((task.executionHostId??"local")!=="local")continue;
      const workspaceId=task.workspaceId??task.projectId;
      const target=typeof task.metadata?.tempDirectory==="string"?path.resolve(task.metadata.tempDirectory):"";
      if(!target||target!==path.resolve(taskTempDirectory(this.tempRoot,workspaceId,task.provider,task.id)))continue;
      const id=artifactId("local",workspaceId,task.id,"task-temp",target),previous=existing.get(id),next=identity(target);
      const status:ManagedArtifactStatus=previous?.deviceId&&next.deviceId&&(previous.deviceId!==next.deviceId||previous.inodeId!==next.inodeId)?"identity-changed":next.status;
      updates.push({id,hostId:"local",workspaceId,taskId:task.id,provider:task.provider,kind:"task-temp",path:target,deviceId:next.deviceId,inodeId:next.inodeId,sizeBytes:next.sizeBytes,status,createdAt:previous?.createdAt??task.createdAt,verifiedAt:now,removedAt:null});
      seen.add(id);
    }
    for(const row of current as ManagedArtifactRow[]){
      if(seen.has(row.id)||row.hostId!=="local"||row.removedAt)continue;
      const next=identity(row.path),status:ManagedArtifactStatus=row.deviceId&&next.deviceId&&(row.deviceId!==next.deviceId||row.inodeId!==next.inodeId)?"identity-changed":next.status;
      updates.push({...row,...next,status,verifiedAt:now});
    }
    if(updates.length)await this.db.upsertManagedArtifacts(updates);
    const workspaceNames=new Map(workspaces.map(item=>[item.id,item.displayName]));
    const entries=(await this.db.listManagedArtifacts()).map((row:ManagedArtifactRow)=>({
      id:row.id,hostId:row.hostId,workspaceId:row.workspaceId,workspaceName:workspaceNames.get(row.workspaceId)??row.workspaceId,
      taskId:row.taskId,provider:row.provider,kind:row.kind,name:path.basename(row.path),sizeBytes:row.sizeBytes,status:row.status,
      createdAt:row.createdAt,verifiedAt:row.verifiedAt
    }));
    return{generatedAt:now,summary:{total:entries.length,present:entries.filter(item=>item.status==="present").length,missing:entries.filter(item=>item.status==="missing-on-disk").length,changed:entries.filter(item=>item.status==="identity-changed").length},entries};
  }
}
