import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AppConfig } from "./config.js";
import type { DeckDatabase } from "./db/client.js";
import type { Workspace, WorkspaceRoot } from "./types.js";
import { runCommand } from "./process.js";
import { cloneGitRepository, createGithubPullRequest, executeGitOperation, gitBranches, gitDiff as coreGitDiff, githubPullRequestPreview, gitHostStatus, gitLog, gitStatus as coreGitStatus, listGitHubRepositories, setGitIdentity, validateGitRemoteUrl } from "./git-core.js";
import { decodeEditableText, isGitMetadataPath, resolveWorkspaceTextPath, writeEditableTextFile } from "./workspace-file-edit.js";
import{hostPathInside,hostPathKey,localHostDisplayName,sameHostPath,type WorkhousePlatform}from"./platform.js";
import { formatByteLimit, MAX_HTML_PREVIEW_BYTES, MAX_WORKSPACE_DOWNLOAD_BYTES } from "./workspace-limits.js";
// re-exported so existing importers and tests keep a single source of truth
export { MAX_HTML_PREVIEW_BYTES };

const LOCAL_HOST_ID = "local";
const FOLDER = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,79}$/;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

function now() { return new Date().toISOString(); }
function stableId(prefix: string, value: string) { return `${prefix}-${crypto.createHash("sha256").update(value).digest("hex").slice(0, 20)}`; }
export function workspaceStableId(projectId:string,canonicalPath:string,platform:WorkhousePlatform=process.platform as WorkhousePlatform){return stableId("workspace",`${LOCAL_HOST_ID}:${projectId}:${hostPathKey(canonicalPath,platform)}`);}
function inside(root: string, target: string) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}
function linuxMountPoints(){if(process.platform!=="linux")return new Set<string>();try{return new Set(fs.readFileSync("/proc/self/mountinfo","utf8").split("\n").map(line=>line.split(" ")[4]).filter(Boolean).map(value=>path.resolve(value!.replace(/\\040/g," ").replace(/\\011/g,"\t").replace(/\\134/g,"\\"))));}catch{return new Set<string>();}}
function assertWorkspaceNotMounted(target:string){if(linuxMountPoints().has(path.resolve(target)))throw Object.assign(new Error("Mounted workspace deletion is not allowed."),{statusCode:409,code:"WORKSPACE_MOUNTED"});const parent=path.dirname(target),targetStat=fs.statSync(target),parentStat=fs.statSync(parent);if(targetStat.dev!==parentStat.dev)throw Object.assign(new Error("Filesystem mount boundary deletion is not allowed."),{statusCode:409,code:"WORKSPACE_MOUNTED"});}
function assertNoProcessCwd(target:string){if(process.platform!=="linux")return;for(const entry of fs.readdirSync("/proc")){if(!/^\d+$/.test(entry))continue;try{const cwd=fs.realpathSync(`/proc/${entry}/cwd`);if(inside(target,cwd))throw Object.assign(new Error("A running process is using this workspace as its working directory."),{statusCode:409,code:"WORKSPACE_IN_USE"});}catch(error){if((error as any)?.code==="WORKSPACE_IN_USE")throw error;}}}
function validateFolderName(name: string) {
  if (!FOLDER.test(name) || name === "." || name === ".." || WINDOWS_RESERVED.test(name) || /[\\/:*?"<>|\u0000-\u001f]/.test(name)) {
    throw Object.assign(new Error("Invalid workspace folder name."), { statusCode:400 });
  }
  return name;
}

export interface GitStatus extends Record<string, unknown> {
  repository: boolean;
  branch: string | null;
  commit: string | null;
  remote: string | null;
  dirty: boolean;
  changedFiles: string[];
  changes?:Array<{path:string;index:string;worktree:string;staged:boolean;unstaged:boolean;untracked:boolean}>;
  ahead?:number;
  behind?:number;
  worktree?:boolean;
  error?: string;
}

export class HostWorkspaceManager {
  private browseKey = crypto.randomBytes(32);
  constructor(private config: AppConfig, private db: DeckDatabase) {}

  async initializeLocal() {
    const timestamp=now();
    const host = await this.db.upsertHost({ id:LOCAL_HOST_ID, type:"local", name:"local", displayName:localHostDisplayName(), platform:process.platform, architecture:process.arch, operatingSystemVersion:os.release(), workerVersion:null, status:"online", capabilities:{ local:true, providers:["codex","claude","deepseek","ollama","antigravity","grok"], workspace:true, handoff:true,managedSourceProviders:["codex","claude","deepseek","ollama","antigravity","grok"],automationLevelsByProvider:{claude:["full","auto","read"],codex:["full","auto","confirm","read"],deepseek:["full","auto","read"],ollama:["full","auto","read"],antigravity:["full","auto","read"],grok:["full","auto","read"]} }, lastSeenAt:timestamp, createdAt:timestamp, updatedAt:timestamp, disabledAt:null, revokedAt:null });
    const roots = new Map<string,WorkspaceRoot>();
    const existingRoots=await this.db.listWorkspaceRoots(LOCAL_HOST_ID);
    const existingProjects=await this.db.listProjects();
    const existingWorkspaces=await this.db.listWorkspaces({hostId:LOCAL_HOST_ID,includeArchived:true});
    const configuredRoots=this.config.workspaceRoots?.length?this.config.workspaceRoots:[{path:path.join(this.config.dataRoot,"workspaces"),displayName:"Claudex Workhouse Workspaces",allowCreate:true,allowRegister:true,allowClone:true,allowDelete:false}];
    for(const configuredRoot of configuredRoots){try{fs.mkdirSync(configuredRoot.path,{recursive:true,mode:0o700});const canonical=fs.realpathSync(configuredRoot.path);const rootId=existingRoots.find(item=>sameHostPath(item.canonicalPath,canonical))?.id??stableId("root",`${LOCAL_HOST_ID}:${hostPathKey(canonical)}`);roots.set(hostPathKey(canonical),await this.db.upsertWorkspaceRoot({id:rootId,hostId:LOCAL_HOST_ID,displayName:configuredRoot.displayName,canonicalPath:canonical,allowCreate:configuredRoot.allowCreate,allowRegister:configuredRoot.allowRegister,allowClone:configuredRoot.allowClone,allowDelete:configuredRoot.allowDelete,createdAt:timestamp,verifiedAt:timestamp,disabledAt:null}));}catch{/* reported through missing root in the UI */}}
    const mappings: {projectId:string;workspaceId:string}[]=[];
    for (const configured of this.config.projects) {
      const existingProject=existingProjects.find(item=>item.id===configured.id);
      const systemProject=configured.id==="claudex-workhouse";
      const project=await this.db.upsertProject({id:configured.id,name:systemProject?configured.name:existingProject?.name??configured.name,slug:configured.id,description:existingProject?.description??null,defaultProvider:existingProject?.defaultProvider??null,createdAt:existingProject?.createdAt??timestamp,updatedAt:timestamp,archivedAt:systemProject?null:existingProject?.archivedAt??null});
      if(project.archivedAt)continue;
      let root=[...roots.values()].filter(item=>hostPathInside(item.canonicalPath,configured.realPath)).sort((a,b)=>b.canonicalPath.length-a.canonicalPath.length)[0];
      if (!root) {
        const legacyRoot=configured.realPath;
        const rootId=existingRoots.find(item=>sameHostPath(item.canonicalPath,legacyRoot))?.id??stableId("root",`${LOCAL_HOST_ID}:${hostPathKey(legacyRoot)}`);
        root=await this.db.upsertWorkspaceRoot({ id:rootId,hostId:LOCAL_HOST_ID,displayName:`${configured.name} (existing)`,canonicalPath:legacyRoot,allowCreate:false,allowRegister:true,allowClone:false,allowDelete:false,createdAt:timestamp,verifiedAt:configured.enabled?timestamp:null,disabledAt:null });
        roots.set(hostPathKey(legacyRoot),root);
      }
      const reusableWorkspace=existingWorkspaces.find(item=>sameHostPath(item.canonicalPath,configured.realPath)&&(item.projectId===configured.id||Boolean(item.archivedAt)));
      const workspaceId=reusableWorkspace?.id??workspaceStableId(configured.id,configured.realPath);
      const relativePath=path.relative(root.canonicalPath,configured.realPath) || ".";
      await this.db.upsertWorkspace({ id:workspaceId,projectId:configured.id,hostId:LOCAL_HOST_ID,rootId:root.id,relativePath,canonicalPath:configured.realPath,displayName:systemProject?configured.name:reusableWorkspace?.displayName??configured.name,workspaceType:"existing",gitRemote:reusableWorkspace?.gitRemote??null,defaultBranch:reusableWorkspace?.defaultBranch??null,lastKnownCommit:reusableWorkspace?.lastKnownCommit??null,lastGitStatus:reusableWorkspace?.lastGitStatus??null,lastVerifiedAt:configured.enabled?timestamp:null,createdAt:reusableWorkspace?.createdAt??timestamp,updatedAt:timestamp,archivedAt:null });
      mappings.push({projectId:configured.id,workspaceId});
    }
    const backfill=await this.db.backfillLocalAssignments({hostId:LOCAL_HOST_ID,projects:mappings});
    const locationBackfill=await this.importLegacyLocations();
    return { host, roots:[...roots.values()], mappings, backfill:{tasks:backfill.tasks+locationBackfill.tasks,threads:backfill.threads+locationBackfill.threads} };
  }

  private async importLegacyLocations() {
    const locations=(await this.db.listUnassignedLocations()).sort((a,b)=>Number(Boolean(b.cwd?.trim()))-Number(Boolean(a.cwd?.trim())));
    const all=await this.db.listWorkspaces({hostId:LOCAL_HOST_ID,includeArchived:true});
    const active=all.filter(item=>!item.archivedAt);
    const timestamp=now();
    const resolved:Array<{projectId:string|null;cwd:string|null;workspaceId:string}>=[];
    const workspaceByCwd=new Map<string,Workspace[]>();
    for(const item of active){const key=hostPathKey(item.canonicalPath),items=workspaceByCwd.get(key)??[];items.push(item);workspaceByCwd.set(key,items);}
    const workspaceByOriginalProject=new Map<string,Workspace>();
    for(const location of locations){
      const raw=location.cwd?.trim();
      let workspace:Workspace|undefined;
      if(raw&&path.isAbsolute(raw)){
        let canonical=path.normalize(raw);try{if(fs.existsSync(raw))canonical=fs.realpathSync(raw);}catch{}
        const exact=(workspaceByCwd.get(hostPathKey(canonical))??[]).filter(item=>!location.projectId||item.projectId===location.projectId);
        workspace=exact.length===1?exact[0]:undefined;
        if(!workspace&&exact.length===0){
          const projectId=stableId("legacy-project",canonical);
          const rootId=stableId("legacy-root",canonical);
          const workspaceId=stableId("legacy-workspace",canonical);
          await this.db.upsertProject({id:projectId,name:`Previous session · ${path.basename(canonical)||"root"}`,slug:projectId,description:"Migrated external session history",defaultProvider:null,createdAt:timestamp,updatedAt:timestamp,archivedAt:timestamp});
          const verifiedAt=fs.existsSync(canonical)?timestamp:null;
          // The path may already be registered under an id from another scheme,
          // in which case the store keeps that row -- link to the id it returns.
          const storedRoot=await this.db.upsertWorkspaceRoot({id:rootId,hostId:LOCAL_HOST_ID,displayName:"Previous external sessions",canonicalPath:canonical,allowCreate:false,allowRegister:false,allowClone:false,allowDelete:false,createdAt:timestamp,verifiedAt,disabledAt:timestamp});
          workspace=await this.db.upsertWorkspace({id:workspaceId,projectId,hostId:LOCAL_HOST_ID,rootId:storedRoot?.id??rootId,relativePath:".",canonicalPath:canonical,displayName:path.basename(canonical)||canonical,workspaceType:"existing",gitRemote:null,defaultBranch:null,lastKnownCommit:null,lastGitStatus:null,lastVerifiedAt:verifiedAt,createdAt:timestamp,updatedAt:timestamp,archivedAt:timestamp});
          workspaceByCwd.set(hostPathKey(canonical),[workspace]);
        }
      }
      if(!workspace&&location.projectId){const candidates=active.filter(item=>item.projectId===location.projectId);workspace=candidates.length===1?candidates[0]:workspaceByOriginalProject.get(location.projectId);}
      if(workspace){if(location.projectId)workspaceByOriginalProject.set(location.projectId,workspace);resolved.push({projectId:location.projectId,cwd:location.cwd,workspaceId:workspace.id});}
    }
    return this.db.backfillLocalLocations({hostId:LOCAL_HOST_ID,locations:resolved});
  }

  async localWorkspaceForProject(projectId:string) {
    const workspaces=await this.db.listWorkspaces({hostId:LOCAL_HOST_ID,projectId});
    const pipeline=(await this.db.getSystemSetting(`project.workspace-pipeline.${projectId}`))?.value?.workspaceIds;
    if(Array.isArray(pipeline))for(const workspaceId of pipeline){const workspace=workspaces.find(item=>item.id===workspaceId);if(workspace)return workspace;}
    const configured=this.config.projects.find(item=>item.id===projectId);
    return (configured?workspaces.find(item=>item.canonicalPath===configured.realPath):undefined)??workspaces[0]??null;
  }

  async requireWorkspace(id:string, expectedHostId?:string) {
    const workspace=await this.db.getWorkspace(id);
    if(!workspace||workspace.archivedAt)throw Object.assign(new Error("Workspace not found."),{statusCode:404});
    if(expectedHostId&&workspace.hostId!==expectedHostId)throw Object.assign(new Error("Workspace does not belong to the selected host."),{statusCode:409});
    return workspace;
  }

  async updateLocalWorkspace(workspaceId:string,input:{displayName:string;rootId?:string;canonicalPath?:string}) {
    const workspace=await this.requireWorkspace(workspaceId,LOCAL_HOST_ID),displayName=input.displayName.trim(),timestamp=now();
    if(!displayName)throw Object.assign(new Error("Workspace display name is required."),{statusCode:400});
    if(!input.canonicalPath)return{workspace:await this.db.upsertWorkspace({...workspace,displayName,updatedAt:timestamp}),pathChanged:false};
    const roots=await this.db.listWorkspaceRoots(LOCAL_HOST_ID),root=roots.find(item=>item.id===(input.rootId??workspace.rootId)&&item.allowRegister&&!item.disabledAt);
    if(!root)throw Object.assign(new Error("Workspace root does not allow registration."),{statusCode:403});
    const requested=input.canonicalPath.trim();if(!path.isAbsolute(requested))throw Object.assign(new Error("Workspace path must be absolute."),{statusCode:400});
    const lexical=path.resolve(requested);if(!inside(root.canonicalPath,lexical))throw Object.assign(new Error("Workspace path is outside the selected root."),{statusCode:403});
    let link:fs.Stats,canonical:string;try{link=fs.lstatSync(lexical);canonical=fs.realpathSync(lexical);}catch{throw Object.assign(new Error("Workspace path does not exist."),{statusCode:404});}
    if(!link.isDirectory()||link.isSymbolicLink()||canonical!==lexical||!inside(root.canonicalPath,canonical))throw Object.assign(new Error("Workspace path must be an exact real directory without a symlink escape."),{statusCode:409});
    const pathChanged=canonical!==workspace.canonicalPath||root.id!==workspace.rootId;
    if(pathChanged){
      const active=(await this.db.listActiveTasks()).some(task=>task.workspaceId===workspace.id&&["pending","queued","starting","running","waiting","stopping","unknown"].includes(task.status));
      if(active)throw Object.assign(new Error("Workspace path cannot change while a task is active or unconfirmed."),{statusCode:409});
      const duplicate=(await this.db.listWorkspaces({hostId:LOCAL_HOST_ID,includeArchived:true})).find(item=>item.id!==workspace.id&&item.canonicalPath===canonical);
      if(duplicate)throw Object.assign(new Error("Workspace path is already registered."),{statusCode:409});
    }
    const git=pathChanged?await this.gitStatusPath(canonical):workspace.lastGitStatus;
    const updated=await this.db.upsertWorkspace({...workspace,rootId:root.id,relativePath:path.relative(root.canonicalPath,canonical)||".",canonicalPath:canonical,displayName,gitRemote:pathChanged?(git as any)?.remote??null:workspace.gitRemote,defaultBranch:pathChanged?(git as any)?.branch??null:workspace.defaultBranch,lastKnownCommit:pathChanged?(git as any)?.commit??null:workspace.lastKnownCommit,lastGitStatus:pathChanged?git:workspace.lastGitStatus,lastVerifiedAt:timestamp,updatedAt:timestamp});
    return{workspace:updated,pathChanged};
  }

  private signEntry(rootId:string,relativePath:string) {
    const payload=Buffer.from(JSON.stringify({rootId,relativePath}),"utf8").toString("base64url");
    const signature=crypto.createHmac("sha256",this.browseKey).update(payload).digest("base64url");
    return `${payload}.${signature}`;
  }
  private verifyEntry(value:string) {
    const [payload,signature]=value.split(".");
    if(!payload||!signature||payload.length>2048)throw Object.assign(new Error("Invalid directory entry."),{statusCode:400});
    const expected=crypto.createHmac("sha256",this.browseKey).update(payload).digest();
    const supplied=Buffer.from(signature,"base64url");
    if(expected.length!==supplied.length||!crypto.timingSafeEqual(expected,supplied))throw Object.assign(new Error("Invalid directory entry."),{statusCode:400});
    const parsed=JSON.parse(Buffer.from(payload,"base64url").toString("utf8"));
    if(typeof parsed.rootId!=="string"||typeof parsed.relativePath!=="string")throw new Error("Invalid directory entry.");
    return parsed as {rootId:string;relativePath:string};
  }

  async browseLocalRoot(rootId:string,entryId?:string) {
    const root=(await this.db.listWorkspaceRoots(LOCAL_HOST_ID)).find((item)=>item.id===rootId&&!item.disabledAt);
    if(!root)throw Object.assign(new Error("Workspace root not found."),{statusCode:404});
    let relative=".";
    if(entryId){const decoded=this.verifyEntry(entryId);if(decoded.rootId!==rootId)throw Object.assign(new Error("Directory entry belongs to another root."),{statusCode:409});relative=decoded.relativePath;}
    const lexical=path.resolve(root.canonicalPath,relative);
    if(!inside(root.canonicalPath,lexical))throw Object.assign(new Error("Workspace root escape rejected."),{statusCode:403});
    const current=fs.realpathSync(lexical);
    if(!inside(root.canonicalPath,current))throw Object.assign(new Error("Symlink escape rejected."),{statusCode:403});
    const entries=fs.readdirSync(current,{withFileTypes:true}).filter((item)=>item.isDirectory()&&!item.isSymbolicLink()).slice(0,500).map((item)=>{
      const child=path.join(current,item.name);let real:string;try{real=fs.realpathSync(child);}catch{return null;}
      if(!inside(root.canonicalPath,real))return null;
      const childRelative=path.relative(root.canonicalPath,real)||".";
      return {id:this.signEntry(root.id,childRelative),name:item.name,relativePath:childRelative};
    }).filter(Boolean);
    return {root:{id:root.id,displayName:root.displayName},current:{id:this.signEntry(root.id,path.relative(root.canonicalPath,current)||"."),relativePath:path.relative(root.canonicalPath,current)||"."},entries};
  }

  async registerLocal(input:{projectId:string;rootId:string;entryId:string;displayName?:string}) {
    const decoded=this.verifyEntry(input.entryId);
    if(decoded.rootId!==input.rootId)throw Object.assign(new Error("Directory entry belongs to another root."),{statusCode:409});
    const root=(await this.db.listWorkspaceRoots(LOCAL_HOST_ID)).find((item)=>item.id===input.rootId&&item.allowRegister&&!item.disabledAt);
    if(!root)throw Object.assign(new Error("Workspace root does not allow registration."),{statusCode:403});
    const candidate=fs.realpathSync(path.resolve(root.canonicalPath,decoded.relativePath));
    if(!inside(root.canonicalPath,candidate))throw Object.assign(new Error("Workspace root escape rejected."),{statusCode:403});
    return this.saveLocalWorkspace(input.projectId,root,candidate,input.displayName??path.basename(candidate),"existing");
  }

  async createLocal(input:{projectId:string;rootId:string;folderName:string;displayName?:string;mode:"empty"|"git-init";readme?:boolean;defaultBranch?:string}) {
    const root=(await this.db.listWorkspaceRoots(LOCAL_HOST_ID)).find((item)=>item.id===input.rootId&&item.allowCreate&&!item.disabledAt);
    if(!root)throw Object.assign(new Error("Workspace root does not allow creation."),{statusCode:403});
    const folder=validateFolderName(input.folderName);const target=path.resolve(root.canonicalPath,folder);
    if(!inside(root.canonicalPath,target)||fs.existsSync(target))throw Object.assign(new Error("Workspace destination already exists or is invalid."),{statusCode:409});
    fs.mkdirSync(target,{mode:0o700});
    try{
      if(input.readme)fs.writeFileSync(path.join(target,"README.md"),`# ${input.displayName??folder}\n`,{encoding:"utf8",mode:0o600,flag:"wx"});
      if(input.mode==="git-init"){
        const branch=(input.defaultBranch??"main").replace(/[^A-Za-z0-9._/-]/g,"");
        if(!branch)throw new Error("Invalid default branch.");
        const result=await runCommand("git",["init","-b",branch],{cwd:target,timeoutMs:30000,outputLimit:1024*1024});
        if(result.exitCode!==0)throw new Error("Git initialization failed.");
      }
      return await this.saveLocalWorkspace(input.projectId,root,fs.realpathSync(target),input.displayName??folder,input.mode);
    }catch(error){try{if(fs.readdirSync(target).length===0)fs.rmdirSync(target);}catch{}throw error;}
  }

  async cloneLocal(input:{projectId:string;rootId:string;folderName:string;displayName?:string;repository:string;branch?:string;shallow?:boolean}) {
    const root=(await this.db.listWorkspaceRoots(LOCAL_HOST_ID)).find((item)=>item.id===input.rootId&&item.allowClone&&!item.disabledAt);
    if(!root)throw Object.assign(new Error("Workspace root does not allow cloning."),{statusCode:403});
    const repository=validateGitRemoteUrl(input.repository);
    const folder=validateFolderName(input.folderName);const target=path.resolve(root.canonicalPath,folder);
    if(!inside(root.canonicalPath,target)||fs.existsSync(target))throw Object.assign(new Error("Clone destination already exists or is invalid."),{statusCode:409});
    await cloneGitRepository(root.canonicalPath,target,{url:repository,branch:input.branch,shallow:input.shallow});
    return this.saveLocalWorkspace(input.projectId,root,fs.realpathSync(target),input.displayName??folder,"git-clone");
  }

  async createLocalWorktree(sourceWorkspaceId:string,input:{folderName:string;displayName?:string;branch?:string}){
    const source=await this.requireWorkspace(sourceWorkspaceId,LOCAL_HOST_ID),root=(await this.db.listWorkspaceRoots(LOCAL_HOST_ID)).find(item=>item.id===source.rootId&&item.allowCreate&&!item.disabledAt);if(!root)throw Object.assign(new Error("Workspace root does not allow worktree creation."),{statusCode:403});
    const status=await this.gitStatusPath(source.canonicalPath);if(!status.repository||!status.commit)throw Object.assign(new Error("A committed Git workspace is required."),{statusCode:409});const folder=validateFolderName(input.folderName),target=path.resolve(root.canonicalPath,folder);if(!inside(root.canonicalPath,target)||fs.existsSync(target))throw Object.assign(new Error("Worktree destination already exists or is invalid."),{statusCode:409});
    const branch=input.branch?.trim();if(branch&&!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/.test(branch))throw Object.assign(new Error("Invalid worktree branch name."),{statusCode:400});const args=["worktree","add",...(branch?["-b",branch]:["--detach"]),target,status.commit],result=await runCommand("git",args,{cwd:source.canonicalPath,timeoutMs:60_000,outputLimit:1024*1024});if(result.exitCode!==0)throw Object.assign(new Error("Git worktree creation failed."),{statusCode:409});
    try{return await this.saveLocalWorkspace(source.projectId,root,fs.realpathSync(target),input.displayName??folder,"git-worktree");}catch(error){await runCommand("git",["worktree","remove","--force",target],{cwd:source.canonicalPath,timeoutMs:30_000,outputLimit:1024*1024}).catch(()=>{});throw error;}
  }

  private async saveLocalWorkspace(projectId:string,root:WorkspaceRoot,canonicalPath:string,displayName:string,workspaceType:Workspace["workspaceType"]) {
    const projects=await this.db.listProjects();if(!projects.some((item)=>item.id===projectId&&!item.archivedAt))throw Object.assign(new Error("Project not found."),{statusCode:404});
    if(!inside(root.canonicalPath,canonicalPath))throw Object.assign(new Error("Workspace root escape rejected."),{statusCode:403});
    const duplicate=(await this.db.listWorkspaces({hostId:LOCAL_HOST_ID,includeArchived:true})).find((item)=>item.canonicalPath===canonicalPath&&!item.archivedAt);
    if(duplicate)throw Object.assign(new Error("Directory is already registered as a workspace."),{statusCode:409});
    const timestamp=now();const git=await this.gitStatusPath(canonicalPath);
    return this.db.upsertWorkspace({id:crypto.randomUUID(),projectId,hostId:LOCAL_HOST_ID,rootId:root.id,relativePath:path.relative(root.canonicalPath,canonicalPath)||".",canonicalPath,displayName,workspaceType,gitRemote:git.remote,defaultBranch:git.branch,lastKnownCommit:git.commit,lastGitStatus:git,lastVerifiedAt:timestamp,createdAt:timestamp,updatedAt:timestamp,archivedAt:null});
  }

  async gitStatus(workspaceId:string) {
    const workspace=await this.requireWorkspace(workspaceId,LOCAL_HOST_ID);const status=await coreGitStatus(workspace.canonicalPath);const timestamp=now();
    await this.db.upsertWorkspace({...workspace,gitRemote:status.remote,defaultBranch:status.branch,lastKnownCommit:status.commit,lastGitStatus:status,lastVerifiedAt:timestamp,updatedAt:timestamp});return status;
  }
  async githubPullRequestPreview(workspaceId:string){const workspace=await this.requireWorkspace(workspaceId,LOCAL_HOST_ID);return githubPullRequestPreview(workspace.canonicalPath);}
  async createGithubPullRequest(workspaceId:string,input:{title:string;body:string;base:string;draft:boolean}){const workspace=await this.requireWorkspace(workspaceId,LOCAL_HOST_ID);return createGithubPullRequest(workspace.canonicalPath,input);}
  private async localWorkspacePath(workspaceId:string,entryId?:string){
    const workspace=await this.requireWorkspace(workspaceId,LOCAL_HOST_ID);let relative=".";
    if(entryId){const entry=this.verifyEntry(entryId);if(entry.rootId!==`workspace:${workspace.id}`)throw Object.assign(new Error("File entry belongs to another workspace."),{statusCode:409});relative=entry.relativePath;}
    const lexical=path.resolve(workspace.canonicalPath,relative);if(!inside(workspace.canonicalPath,lexical))throw Object.assign(new Error("Workspace path escape rejected."),{statusCode:403});
    const stat=fs.lstatSync(lexical);if(stat.isSymbolicLink())throw Object.assign(new Error("Symbolic links are not exposed by the file viewer."),{statusCode:403});const real=fs.realpathSync(lexical);if(!inside(workspace.canonicalPath,real))throw Object.assign(new Error("Workspace path escape rejected."),{statusCode:403});
    return{workspace,real,relative:path.relative(workspace.canonicalPath,real)||".",stat};
  }
  async browseWorkspace(workspaceId:string,entryId?:string){
    const current=await this.localWorkspacePath(workspaceId,entryId);if(!current.stat.isDirectory())throw Object.assign(new Error("Directory expected."),{statusCode:400});
    const entries=fs.readdirSync(current.real,{withFileTypes:true}).filter(item=>!item.isSymbolicLink()&&item.name!==".git").slice(0,1000).map(item=>{const target=path.join(current.real,item.name),stat=fs.statSync(target),relative=path.relative(current.workspace.canonicalPath,target);return{id:this.signEntry(`workspace:${workspaceId}`,relative),name:item.name,type:item.isDirectory()?"directory":item.isFile()?"file":"other",size:item.isFile()?stat.size:null,modifiedAt:stat.mtime.toISOString(),sensitive:item.isFile()&&this.isSensitiveFile(relative),relativePath:relative};});
    return{current:{id:this.signEntry(`workspace:${workspaceId}`,current.relative),relativePath:current.relative},entries};
  }
  private isSensitiveFile(relative:string){return/(^|[\\/])(?:\.env(?:\..*)?|credentials?(?:\..*)?|secrets?(?:\..*)?|id_(?:rsa|ed25519)|[^/\\]+\.(?:pem|key|p12|pfx)|\.npmrc|\.netrc)$/i.test(relative);}
  async resolveWorkspaceFile(workspaceId:string,input:{path:string;pathBase:"workspace"|"task-cwd";sourceTaskId?:string}){
    const workspace=await this.requireWorkspace(workspaceId,LOCAL_HOST_ID);let base=workspace.canonicalPath;
    if(input.pathBase==="task-cwd"){
      if(!input.sourceTaskId)throw Object.assign(new Error("A source task is required for task-relative paths."),{statusCode:400,code:"SOURCE_TASK_REQUIRED"});
      const task=await this.db.getTask(input.sourceTaskId);
      if(!task||task.workspaceId!==workspace.id||(task.executionHostId??LOCAL_HOST_ID)!==LOCAL_HOST_ID)throw Object.assign(new Error("Source task does not belong to this workspace."),{statusCode:409,code:"SOURCE_TASK_WORKSPACE_MISMATCH"});
      if(!task.cwd||!path.isAbsolute(task.cwd))throw Object.assign(new Error("Source task path cannot be resolved."),{statusCode:409,code:"FILE_PATH_UNRESOLVED"});
      base=task.cwd;
    }
    const target=resolveWorkspaceTextPath(workspace.canonicalPath,base,input.path),entry={id:this.signEntry(`workspace:${workspace.id}`,target.relative),name:path.basename(target.real),type:"file" as const,size:target.stat.size,modifiedAt:target.stat.mtime.toISOString(),sensitive:this.isSensitiveFile(target.relative),relativePath:target.relative};
    return{entry};
  }
  private async editableWorkspaceTarget(workspaceId:string,fileId:string){
    const workspace=await this.requireWorkspace(workspaceId,LOCAL_HOST_ID),entry=this.verifyEntry(fileId);
    if(entry.rootId!==`workspace:${workspace.id}`)throw Object.assign(new Error("File entry belongs to another workspace."),{statusCode:409,code:"WORKSPACE_FILE_ID_MISMATCH"});
    const target=resolveWorkspaceTextPath(workspace.canonicalPath,workspace.canonicalPath,entry.relativePath);
    if(isGitMetadataPath(target.relative))throw Object.assign(new Error("Git metadata files cannot be edited."),{statusCode:403,code:"GIT_METADATA_EDIT_BLOCKED"});
    return{workspace,...target};
  }
  async readEditableWorkspaceFile(workspaceId:string,fileId:string){
    const target=await this.editableWorkspaceTarget(workspaceId,fileId),snapshot=decodeEditableText(fs.readFileSync(target.real));
    return{fileId,relativePath:target.relative,modifiedAt:target.stat.mtime.toISOString(),...snapshot};
  }
  async writeWorkspaceFile(workspaceId:string,input:{fileId:string;content:string;expectedRevision:string;expectedCurrentRevision?:string}){
    const target=await this.editableWorkspaceTarget(workspaceId,input.fileId),result=writeEditableTextFile(target.real,input.content,input.expectedRevision,input.expectedCurrentRevision);
    const status=await this.gitStatus(workspaceId).catch(()=>null);
    return{relativePath:target.relative,...result,status};
  }
  async createWorkspaceMarkdown(workspaceId:string,relativePath:string,content:string){
    const workspace=await this.requireWorkspace(workspaceId,LOCAL_HOST_ID),requested=relativePath.trim().replace(/\\/g,"/");
    if(!requested||requested.includes("\0")||path.isAbsolute(requested)||!requested.toLowerCase().endsWith(".md"))throw Object.assign(new Error("A relative Markdown path is required."),{statusCode:400,code:"MARKDOWN_PATH_REQUIRED"});
    const target=path.resolve(workspace.canonicalPath,requested);
    if(!inside(workspace.canonicalPath,target)||target===workspace.canonicalPath)throw Object.assign(new Error("Markdown path escaped the Workspace."),{statusCode:403,code:"WORKSPACE_PATH_ESCAPE"});
    const parent=path.dirname(target),parentReal=fs.realpathSync(parent);
    if(!inside(workspace.canonicalPath,parentReal)&&parentReal!==workspace.canonicalPath)throw Object.assign(new Error("Markdown parent escaped the Workspace."),{statusCode:403,code:"WORKSPACE_PATH_ESCAPE"});
    if(fs.existsSync(target))throw Object.assign(new Error("The Markdown destination already exists."),{statusCode:409,code:"MARKDOWN_ALREADY_EXISTS"});
    const body=content.endsWith("\n")?content:`${content}\n`;
    if(Buffer.byteLength(body,"utf8")>256*1024)throw Object.assign(new Error("Markdown conclusion exceeds 256 KiB."),{statusCode:413,code:"MARKDOWN_TOO_LARGE"});
    fs.writeFileSync(target,body,{encoding:"utf8",mode:0o600,flag:"wx"});
    return{workspaceId,relativePath:path.relative(workspace.canonicalPath,target).replace(/\\/g,"/"),byteLength:Buffer.byteLength(body,"utf8"),revision:crypto.createHash("sha256").update(body).digest("hex")};
  }
  async deleteWorkspaceMarkdown(workspaceId:string,relativePath:string,expectedRevision:string){
    const workspace=await this.requireWorkspace(workspaceId,LOCAL_HOST_ID),requested=relativePath.trim().replace(/\\/g,"/");
    if(!requested.toLowerCase().endsWith(".md"))throw Object.assign(new Error("A Markdown file is required."),{statusCode:400,code:"MARKDOWN_PATH_REQUIRED"});
    const target=resolveWorkspaceTextPath(workspace.canonicalPath,workspace.canonicalPath,requested),value=fs.readFileSync(target.real),revision=crypto.createHash("sha256").update(value).digest("hex");
    if(revision!==expectedRevision)throw Object.assign(new Error("The Markdown file changed after it was created and was not deleted."),{statusCode:409,code:"CONCLUSION_FILE_CHANGED"});
    const current=fs.lstatSync(target.real);
    if(current.isSymbolicLink()||!current.isFile()||current.dev!==target.stat.dev||current.ino!==target.stat.ino)throw Object.assign(new Error("The Markdown file changed while deletion was being prepared."),{statusCode:409,code:"CONCLUSION_FILE_CHANGED"});
    fs.unlinkSync(target.real);
    return{workspaceId,relativePath:target.relative.replace(/\\/g,"/"),revision,deleted:true as const};
  }
  async readWorkspaceFile(workspaceId:string,fileId:string,offset=0,limit=65536,_confirmSensitive=false){
    const target=await this.localWorkspacePath(workspaceId,fileId);if(!target.stat.isFile())throw Object.assign(new Error("File expected."),{statusCode:400});const sensitive=this.isSensitiveFile(target.relative);
    const boundedOffset=Math.min(Math.max(0,offset),target.stat.size),boundedLimit=Math.min(Math.max(1,limit),128*1024),length=Math.min(boundedLimit,target.stat.size-boundedOffset),buffer=Buffer.alloc(length),fd=fs.openSync(target.real,"r");try{fs.readSync(fd,buffer,0,length,boundedOffset);}finally{fs.closeSync(fd);}const binary=buffer.includes(0);return{relativePath:target.relative,size:target.stat.size,modifiedAt:target.stat.mtime.toISOString(),sensitive,requiresConfirmation:false,binary,content:binary?null:buffer.toString("utf8"),offset:boundedOffset,nextOffset:boundedOffset+length<target.stat.size?boundedOffset+length:null};
  }
  async readHtmlPreview(workspaceId:string,fileId:string,confirmSensitive=false){
    const target=await this.localWorkspacePath(workspaceId,fileId);
    if(!target.stat.isFile())throw Object.assign(new Error("HTML preview requires a regular file."),{statusCode:400,code:"HTML_PREVIEW_FILE_REQUIRED"});
    if(!/\.html?$/i.test(target.relative))throw Object.assign(new Error("HTML preview supports only .html and .htm files."),{statusCode:415,code:"HTML_PREVIEW_EXTENSION_REQUIRED"});
    if(target.stat.size>MAX_HTML_PREVIEW_BYTES)throw Object.assign(new Error(`HTML preview exceeds the ${formatByteLimit(MAX_HTML_PREVIEW_BYTES)} limit.`),{statusCode:413,code:"HTML_PREVIEW_TOO_LARGE",errorParams:{limit:formatByteLimit(MAX_HTML_PREVIEW_BYTES)}});
    if(this.isSensitiveFile(target.relative)&&!confirmSensitive)throw Object.assign(new Error("Sensitive HTML preview requires explicit confirmation."),{statusCode:403,code:"HTML_PREVIEW_SENSITIVE_CONFIRMATION_REQUIRED"});
    const value=fs.readFileSync(target.real);
    let content:string;
    try{content=new TextDecoder("utf-8",{fatal:true}).decode(value.length>=3&&value[0]===0xef&&value[1]===0xbb&&value[2]===0xbf?value.subarray(3):value);}
    catch{throw Object.assign(new Error("HTML preview requires valid UTF-8 text."),{statusCode:415,code:"HTML_PREVIEW_INVALID_UTF8"});}
    if(content.includes("\0"))throw Object.assign(new Error("Binary files cannot be previewed as HTML."),{statusCode:415,code:"HTML_PREVIEW_BINARY"});
    return{fileId,relativePath:target.relative,content,byteLength:value.length,modifiedAt:target.stat.mtime.toISOString(),revision:crypto.createHash("sha256").update(value).digest("hex")};
  }
  async resolveWorkspaceDownload(workspaceId:string,relativePath:string){
    const workspace=await this.requireWorkspace(workspaceId,LOCAL_HOST_ID),requested=relativePath.trim();
    if(!requested||requested.includes("\0")||path.isAbsolute(requested))throw Object.assign(new Error("A relative workspace file path is required."),{statusCode:400});
    const lexical=path.resolve(workspace.canonicalPath,requested);if(!inside(workspace.canonicalPath,lexical))throw Object.assign(new Error("Workspace download path escape rejected."),{statusCode:403});
    let link:fs.Stats,real:string,stat:fs.Stats;try{link=fs.lstatSync(lexical);real=fs.realpathSync(lexical);stat=fs.statSync(real);}catch{throw Object.assign(new Error("Download file not found."),{statusCode:404});}
    if(link.isSymbolicLink()||!inside(workspace.canonicalPath,real))throw Object.assign(new Error("Symbolic link downloads are not allowed."),{statusCode:403});
    if(!stat.isFile())throw Object.assign(new Error("Download target must be a file."),{statusCode:400});
    const relative=path.relative(workspace.canonicalPath,real)||path.basename(real);
    if(stat.size>MAX_WORKSPACE_DOWNLOAD_BYTES)throw Object.assign(new Error(`Download file exceeds the ${formatByteLimit(MAX_WORKSPACE_DOWNLOAD_BYTES)} limit.`),{statusCode:413,code:"WORKSPACE_DOWNLOAD_TOO_LARGE"});
    fs.accessSync(real,fs.constants.R_OK);return{workspace,real,relative,name:path.basename(real),size:stat.size,modifiedAt:stat.mtime.toISOString()};
  }
  async gitDiff(workspaceId:string,fileId?:string){const workspace=await this.requireWorkspace(workspaceId,LOCAL_HOST_ID);let relative:string|undefined;
    if(fileId){const target=await this.localWorkspacePath(workspaceId,fileId);if(!target.stat.isFile())throw Object.assign(new Error("File expected."),{statusCode:400});relative=target.relative;}
    return coreGitDiff(workspace.canonicalPath,{path:relative,head:true});}
  async gitDiffPath(workspaceId:string,input:{path?:string;staged?:boolean}){const workspace=await this.requireWorkspace(workspaceId,LOCAL_HOST_ID);return coreGitDiff(workspace.canonicalPath,input);}
  async gitOperation(workspaceId:string,operation:unknown){const workspace=await this.requireWorkspace(workspaceId,LOCAL_HOST_ID),result=await executeGitOperation(workspace.canonicalPath,operation),status=(result as any).status;const timestamp=now();if(status)await this.db.upsertWorkspace({...workspace,gitRemote:status.remote,defaultBranch:status.branch,lastKnownCommit:status.commit,lastGitStatus:status,lastVerifiedAt:timestamp,updatedAt:timestamp});return result;}
  async gitLog(workspaceId:string,limit=50){const workspace=await this.requireWorkspace(workspaceId,LOCAL_HOST_ID);return gitLog(workspace.canonicalPath,limit);}
  async gitBranches(workspaceId:string){const workspace=await this.requireWorkspace(workspaceId,LOCAL_HOST_ID);return gitBranches(workspace.canonicalPath);}
  gitHostStatus(){return gitHostStatus(this.config.appRoot);}
  setGitIdentity(input:{name:string;email:string}){return setGitIdentity(this.config.appRoot,input);}
  listGitHubRepositories(input:{limit?:number;visibility?:"all"|"public"|"private";owner?:string;search?:string}){return listGitHubRepositories(this.config.appRoot,input);}
  async deleteLocal(workspaceId:string,confirmName:string) {
    const workspace=await this.requireWorkspace(workspaceId,LOCAL_HOST_ID);
    const root=(await this.db.listWorkspaceRoots(LOCAL_HOST_ID)).find(item=>item.id===workspace.rootId&&item.allowDelete&&!item.disabledAt);
    if(!root)throw Object.assign(new Error("Workspace root does not allow disk deletion."),{statusCode:403});
    const lexical=workspace.canonicalPath,initialLink=fs.lstatSync(lexical);if(!initialLink.isDirectory()||initialLink.isSymbolicLink())throw Object.assign(new Error("Only a verified directory workspace can be deleted."),{statusCode:403});
    const current=fs.realpathSync(lexical),initial=fs.statSync(current);
    if(current===root.canonicalPath||!inside(root.canonicalPath,current))throw Object.assign(new Error("Workspace root deletion or escape rejected."),{statusCode:403});
    if(confirmName!==workspace.displayName&&confirmName!==path.basename(current))throw Object.assign(new Error("Workspace deletion confirmation did not match."),{statusCode:409});
    assertWorkspaceNotMounted(current);assertNoProcessCwd(current);
    const finalLink=fs.lstatSync(lexical),finalReal=fs.realpathSync(lexical),final=fs.statSync(finalReal);if(finalLink.isSymbolicLink()||finalReal!==current||final.dev!==initial.dev||final.ino!==initial.ino)throw Object.assign(new Error("Workspace identity changed during deletion verification."),{statusCode:409,code:"WORKSPACE_IDENTITY_CHANGED"});
    fs.rmSync(current,{recursive:true,force:false,maxRetries:2});
    await this.db.archiveWorkspace(workspaceId,now());
    return{deleted:true,filesDeleted:true};
  }
  private gitStatusPath(cwd:string):Promise<GitStatus>{return coreGitStatus(cwd) as unknown as Promise<GitStatus>;}
}

export { LOCAL_HOST_ID };
