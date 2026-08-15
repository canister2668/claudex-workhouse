import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AppConfig } from "./config.js";
import type { DeckDatabase } from "./db/client.js";
import type { HostWorkspaceManager } from "./host-workspaces.js";
import { ProtonDriveCli } from "./proton-drive-cli.js";
import { normalizeProtonDriveSettings, protonRemotePath, type ProtonDriveSettings } from "./proton-drive-settings.js";

const LOCAL_HOST_ID="local";
const ACTIVE=new Set(["running","verifying"]);
const hashFile=(file:string,algorithm:"sha1"|"sha256"="sha256")=>new Promise<string>((resolve,reject)=>{const hash=crypto.createHash(algorithm),stream=fs.createReadStream(file);stream.on("error",reject);stream.on("data",chunk=>hash.update(chunk));stream.on("end",()=>resolve(hash.digest("hex")));});
const inside=(root:string,target:string)=>{const relative=path.relative(root,target);return relative===""||(!relative.startsWith(`..${path.sep}`)&&relative!==".."&&!path.isAbsolute(relative));};

function safeCode(error:unknown){const code=typeof(error as any)?.code==="string"?(error as any).code:"PROTON_UPLOAD_FAILED";return /^PROTON_[A-Z0-9_]{1,80}$/.test(code)?code:"PROTON_UPLOAD_FAILED";}

export type ProtonUploadOperation={
  id:string;hostId:string;taskId:string;workspaceId:string;sourceRelativePath:string;sourceName:string;sourceSize:number;sourceSha256:string;remotePath:string;
  status:"prepared"|"running"|"verifying"|"completed"|"failed"|"cancelled"|"delivery-uncertain";stage:string;safeErrorCode:string|null;cliVersion:string|null;
  createdAt:string;startedAt:string|null;updatedAt:string;finishedAt:string|null;interrupted:boolean|number;
};

export class ProtonDriveUploadService{
  constructor(private config:AppConfig,private db:DeckDatabase,private workspaces:HostWorkspaceManager,private cli:ProtonDriveCli){}
  private async settings(){return normalizeProtonDriveSettings((await this.db.getSystemSetting("proton-drive.v1"))?.value);}
  private stagePath(operation:Pick<ProtonUploadOperation,"id"|"remotePath">){return path.join(this.config.tempDir,"proton-uploads",operation.id,path.basename(operation.remotePath));}
  private async source(taskId:string,workspaceId:string,relativePath:string,settings:ProtonDriveSettings){
    const task=await this.db.getTask(taskId);if(!task)throw Object.assign(new Error("Task not found."),{statusCode:404,code:"PROTON_TASK_NOT_FOUND"});
    if(task.status!=="completed")throw Object.assign(new Error("Only completed tasks can upload artifacts."),{statusCode:409,code:"PROTON_TASK_NOT_COMPLETED"});
    if(task.workspaceId!==workspaceId||(task.executionHostId??LOCAL_HOST_ID)!==LOCAL_HOST_ID)throw Object.assign(new Error("Task and local workspace do not match."),{statusCode:409,code:"PROTON_WORKSPACE_MISMATCH"});
    const workspace=await this.workspaces.requireWorkspace(workspaceId,LOCAL_HOST_ID),requested=relativePath.trim().replace(/\\/g,"/");
    if(!requested||requested.includes("\0")||path.isAbsolute(requested))throw Object.assign(new Error("A relative workspace file path is required."),{statusCode:400,code:"PROTON_PATH_INVALID"});
    const lexical=path.resolve(workspace.canonicalPath,requested);if(!inside(workspace.canonicalPath,lexical))throw Object.assign(new Error("Workspace path escape rejected."),{statusCode:403,code:"PROTON_PATH_ESCAPE"});
    let cursor=workspace.canonicalPath;for(const segment of path.relative(workspace.canonicalPath,lexical).split(path.sep).filter(Boolean)){cursor=path.join(cursor,segment);let item:fs.Stats;try{item=fs.lstatSync(cursor);}catch{throw Object.assign(new Error("Upload file not found."),{statusCode:404,code:"PROTON_FILE_NOT_FOUND"});}if(item.isSymbolicLink())throw Object.assign(new Error("Symbolic links cannot be uploaded."),{statusCode:403,code:"PROTON_SYMLINK_REJECTED"});}
    const real=fs.realpathSync(lexical),stat=fs.statSync(real);if(!inside(workspace.canonicalPath,real)||!stat.isFile())throw Object.assign(new Error("Upload target must be a regular workspace file."),{statusCode:400,code:"PROTON_FILE_REQUIRED"});
    if(stat.size<1||stat.size>settings.maxUploadBytes)throw Object.assign(new Error("Upload file exceeds the configured size limit."),{statusCode:413,code:"PROTON_FILE_TOO_LARGE"});
    fs.accessSync(real,fs.constants.R_OK);return{task,workspace,real,relative:path.relative(workspace.canonicalPath,real),stat};
  }
  async prepare(input:{taskId:string;workspaceId:string;relativePath:string}){
    const settings=await this.settings();if(!settings.enabled)throw Object.assign(new Error("Enable Proton Drive in global settings first."),{statusCode:409,code:"PROTON_DISABLED"});
    const source=await this.source(input.taskId,input.workspaceId,input.relativePath,settings),id=crypto.randomUUID(),temporary=path.join(this.config.tempDir,"proton-uploads",id),placeholderSha="0".repeat(64);
    fs.mkdirSync(temporary,{recursive:true,mode:0o700});
    try{
      const first=fs.statSync(source.real),scratch=path.join(temporary,"artifact.part");fs.copyFileSync(source.real,scratch,fs.constants.COPYFILE_EXCL);const second=fs.statSync(source.real);
      if(first.dev!==second.dev||first.ino!==second.ino||first.size!==second.size||first.mtimeMs!==second.mtimeMs)throw Object.assign(new Error("Upload source changed while it was being prepared."),{statusCode:409,code:"PROTON_SOURCE_CHANGED"});
      const sha256=await hashFile(scratch),remotePath=protonRemotePath(settings,source.workspace.displayName,source.stat.isFile()?path.basename(source.real):"artifact",sha256),staged=path.join(temporary,path.basename(remotePath));fs.renameSync(scratch,staged);fs.chmodSync(staged,0o400);
      const now=new Date().toISOString(),operation:ProtonUploadOperation={id,hostId:LOCAL_HOST_ID,taskId:source.task.id,workspaceId:source.workspace.id,sourceRelativePath:source.relative,sourceName:path.basename(source.real),sourceSize:first.size,sourceSha256:sha256||placeholderSha,remotePath,status:"prepared",stage:"awaiting-confirmation",safeErrorCode:null,cliVersion:null,createdAt:now,startedAt:null,updatedAt:now,finishedAt:null,interrupted:false};
      return await this.db.createProtonUploadOperation(operation) as ProtonUploadOperation;
    }catch(error){fs.rmSync(temporary,{recursive:true,force:true});throw error;}
  }
  async execute(id:string,expectedSha256:string){
    let operation=await this.db.getProtonUploadOperation(id) as ProtonUploadOperation|null;if(!operation)throw Object.assign(new Error("Upload operation not found."),{statusCode:404,code:"PROTON_UPLOAD_NOT_FOUND"});
    if(operation.sourceSha256!==expectedSha256)throw Object.assign(new Error("Prepared upload checksum changed."),{statusCode:409,code:"PROTON_CHECKSUM_MISMATCH"});
    if(operation.status==="completed")return operation;if(operation.status!=="prepared")throw Object.assign(new Error("Upload operation is not ready to execute."),{statusCode:409,code:"PROTON_UPLOAD_STATE"});
    const settings=await this.settings();if(!settings.enabled)throw Object.assign(new Error("Proton Drive is disabled."),{statusCode:409,code:"PROTON_DISABLED"});
    const staged=this.stagePath(operation);if(!fs.existsSync(staged)||await hashFile(staged)!==operation.sourceSha256)throw Object.assign(new Error("Prepared upload file is unavailable or changed."),{statusCode:409,code:"PROTON_STAGING_CHANGED"});
    const status=await this.cli.connection(settings.remoteRoot);if(!status.connected)throw Object.assign(new Error(status.detail||"Proton Drive login is required."),{statusCode:409,code:status.state==="ready"?"PROTON_AUTH_REQUIRED":"PROTON_CLI_UNAVAILABLE"});
    const startedAt=new Date().toISOString();operation=await this.db.updateProtonUploadOperation({...operation,status:"running",stage:"uploading",safeErrorCode:null,cliVersion:status.version,startedAt,updatedAt:startedAt,finishedAt:null,interrupted:false}) as ProtonUploadOperation;
    try{
      await this.cli.upload(staged,path.dirname(operation.remotePath));
      if(settings.verifyAfterUpload){
        const now=new Date().toISOString();operation=await this.db.updateProtonUploadOperation({...operation,status:"verifying",stage:"remote-verification",updatedAt:now}) as ProtonUploadOperation;
        const [remote,sourceSha1]=await Promise.all([this.cli.info(operation.remotePath),hashFile(staged,"sha1")]),revision=(remote.value as any)?.activeRevision,remoteSize=Number(revision?.claimedSize),remoteSha1=revision?.claimedDigests?.sha1;
        if(remoteSize!==operation.sourceSize||remoteSha1!==sourceSha1)throw Object.assign(new Error("Uploaded file metadata did not match the prepared artifact."),{statusCode:502,code:"PROTON_VERIFY_MISMATCH"});
      }
      const finishedAt=new Date().toISOString();operation=await this.db.updateProtonUploadOperation({...operation,status:"completed",stage:"completed",updatedAt:finishedAt,finishedAt,safeErrorCode:null}) as ProtonUploadOperation;
      fs.rmSync(path.dirname(staged),{recursive:true,force:true});return operation;
    }catch(error){const uncertain=safeCode(error)==="PROTON_CLI_TIMEOUT",finishedAt=new Date().toISOString();operation=await this.db.updateProtonUploadOperation({...operation,status:uncertain?"delivery-uncertain":"failed",stage:uncertain?"delivery-uncertain":"failed",safeErrorCode:safeCode(error),updatedAt:finishedAt,finishedAt}) as ProtonUploadOperation;throw Object.assign(error instanceof Error?error:new Error(String(error)),{operation});}
  }
  async cancel(id:string){let operation=await this.db.getProtonUploadOperation(id) as ProtonUploadOperation|null;if(!operation)throw Object.assign(new Error("Upload operation not found."),{statusCode:404});if(ACTIVE.has(operation.status))throw Object.assign(new Error("An active CLI upload cannot be cancelled safely."),{statusCode:409,code:"PROTON_UPLOAD_ACTIVE"});if(operation.status!=="prepared")return operation;const now=new Date().toISOString();operation=await this.db.updateProtonUploadOperation({...operation,status:"cancelled",stage:"cancelled",updatedAt:now,finishedAt:now}) as ProtonUploadOperation;fs.rmSync(path.dirname(this.stagePath(operation)),{recursive:true,force:true});return operation;}
  get(id:string){return this.db.getProtonUploadOperation(id);}
  list(limit=50){return this.db.listProtonUploadOperations(limit);}
  reconcile(){return this.db.reconcileProtonUploadOperations(new Date().toISOString());}
}
