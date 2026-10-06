// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Claudex Workhouse.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { DeckDatabase } from "./db/client.js";
import { HostWorkspaceManager, LOCAL_HOST_ID } from "./host-workspaces.js";
import { MAX_EDITABLE_WORKSPACE_FILE_BYTES } from "./workspace-file-edit.js";
import {participantSecretPresent,readParticipantSecret,storeParticipantSecret} from "./external-participant-secrets.js";
import { executionGrantSchema, registerExternalParticipantTaskRoutes, type ExternalParticipantExecutor } from "./external-participant-tasks.js";

const settingKey="external-participant.grants.v1";
const relativePath=z.string().trim().min(1).max(512).refine(value=>!path.isAbsolute(value)&&!value.includes("\\")&&!value.includes("\0")&&!value.split("/").some(part=>part===".."||part==="."||!part),"Use a normalized relative path.");
const scopePath=relativePath.refine(value=>!value.split("/").some(part=>part.toLowerCase()===".git"),"Git metadata is unavailable.");
const mountScope=z.union([scopePath,z.literal(".")]);
const mountInput=z.object({alias:z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),workspaceId:z.string().min(1).max(100),rootPath:z.union([scopePath,z.literal("")]).default(""),readPaths:z.array(mountScope).min(1).max(30),writePaths:z.array(mountScope).max(10).default([])}).strict();
const grantInput=z.object({workspaceId:z.string().min(1).max(100),readPaths:z.array(scopePath).max(30).default([]),writePaths:z.array(scopePath).max(10).default([]),mounts:z.array(mountInput).max(8).default([]),execution:executionGrantSchema.nullable().default(null),expiresAt:z.string().datetime().nullable().default(null)}).strict();
const storedGrant=grantInput.extend({id:z.string().uuid(),tokenHash:z.string().regex(/^[a-f0-9]{64}$/),createdAt:z.string().datetime(),revokedAt:z.string().datetime().nullable()});
type Grant=z.infer<typeof storedGrant>;
const settingsSchema=z.object({version:z.literal(1),grants:z.array(storedGrant).max(100)});
const error=(message:string,statusCode:number,code:string)=>Object.assign(new Error(message),{statusCode,code});
const digest=(token:string)=>crypto.createHash("sha256").update(token).digest();
const equal=(a:Buffer,b:Buffer)=>a.length===b.length&&crypto.timingSafeEqual(a,b);
const inScope=(relative:string,scopes:string[])=>scopes.some(scope=>scope==="."||relative===scope||relative.startsWith(`${scope}/`));
const directoryInScope=(relative:string,scopes:string[])=>relative===""||inScope(relative,scopes)||scopes.some(scope=>scope.startsWith(`${relative}/`));
const sensitive=(relative:string)=>/(^|\/)(?:\.env(?:\..*)?|credentials?(?:\..*)?|secrets?(?:\..*)?|id_(?:rsa|ed25519)|[^/]+\.(?:pem|key|p12|pfx)|\.npmrc|\.netrc)$/i.test(relative);

export function registerExternalParticipantRoutes(app:FastifyInstance,input:{db:DeckDatabase;workspaces:HostWorkspaceManager;dataRoot:string;executor?:ExternalParticipantExecutor}){
  const {db,workspaces,dataRoot}=input;
  const load=async()=>{const stored=await db.getSystemSetting(settingKey),parsed=settingsSchema.safeParse(stored?.value);if(stored&&!parsed.success)throw error("External participant grants are invalid; access is disabled.",503,"EXTERNAL_GRANTS_INVALID");return{value:parsed.success?parsed.data:{version:1 as const,grants:[] as Grant[]},updatedAt:stored?.updatedAt??null};};
  const publicGrant=({tokenHash,...grant}:Grant)=>grant;
  const audit=async(action:string,grant:Grant,detail:string)=>db.appendAudit({createdAt:new Date().toISOString(),actor:`external-participant:${grant.id}`,action,provider:null,taskId:null,projectId:null,workspaceId:grant.workspaceId,outcome:"success",detail});
  const requireGrant=async(request:FastifyRequest)=>{
    const authorization=request.headers.authorization;
    if(typeof authorization!=="string"||!authorization.startsWith("Bearer "))throw error("A participant bearer token is required.",401,"EXTERNAL_TOKEN_REQUIRED");
    const token=authorization.slice(7);
    if(!/^whp_[A-Za-z0-9_-]{43}$/.test(token))throw error("Invalid participant token.",401,"EXTERNAL_TOKEN_INVALID");
    const hash=digest(token),{value}=await load(),grant=value.grants.find(item=>equal(Buffer.from(item.tokenHash,"hex"),hash));
    if(!grant||grant.revokedAt||grant.expiresAt&&Date.parse(grant.expiresAt)<=Date.now())throw error("Participant token is expired or revoked.",401,"EXTERNAL_TOKEN_INVALID");
    const workspace=await workspaces.requireWorkspace(grant.workspaceId,LOCAL_HOST_ID);
    if(workspace.archivedAt)throw error("The granted workspace is archived.",403,"EXTERNAL_WORKSPACE_ARCHIVED");
    return grant;
  };
  const allow=(grant:Grant,relative:string,mode:"read"|"write")=>{
    const file=scopePath.parse(relative);
    if(sensitive(file)||!inScope(file,mode==="read"?grant.readPaths:grant.writePaths))throw error("File is outside the participant grant.",403,"EXTERNAL_FILE_SCOPE");
    return file;
  };
  const resolveFile=async(grant:Grant,virtualPath:string,mode:"read"|"write")=>{
    const logical=scopePath.parse(virtualPath);
    if(!grant.mounts.length)return{logical,workspaceId:grant.workspaceId,relative:allow(grant,logical,mode)};
    const [alias,...parts]=logical.split("/"),mount=grant.mounts.find(item=>item.alias===alias),within=parts.join("/");
    if(!mount||!within||sensitive(path.posix.join(mount.rootPath,within))||!inScope(within,mode==="read"?mount.readPaths:mount.writePaths))throw error("File is outside the participant grant.",403,"EXTERNAL_FILE_SCOPE");
    const workspace=await workspaces.requireWorkspace(mount.workspaceId,LOCAL_HOST_ID);
    if(workspace.archivedAt)throw error("Mounted workspace is archived.",403,"EXTERNAL_WORKSPACE_ARCHIVED");
    return{logical,workspaceId:mount.workspaceId,relative:path.posix.join(mount.rootPath,within)};
  };
  const resolveDirectory=async(grant:Grant,virtualPath:string)=>{
    if(!grant.mounts.length){const directory=allow(grant,virtualPath,"read");return{directory,workspaceId:grant.workspaceId,relative:directory,readPaths:grant.readPaths,prefix:""};}
    const directory=scopePath.parse(virtualPath),[alias,...parts]=directory.split("/"),mount=grant.mounts.find(item=>item.alias===alias),within=parts.join("/");
    if(!mount||sensitive(path.posix.join(mount.rootPath,within))||!directoryInScope(within,mount.readPaths))throw error("Directory is outside the participant grant.",403,"EXTERNAL_FILE_SCOPE");
    const workspace=await workspaces.requireWorkspace(mount.workspaceId,LOCAL_HOST_ID);
    if(workspace.archivedAt)throw error("Mounted workspace is archived.",403,"EXTERNAL_WORKSPACE_ARCHIVED");
    return{directory,workspaceId:mount.workspaceId,relative:path.posix.join(mount.rootPath,within),readPaths:mount.readPaths,prefix:mount.rootPath,within};
  };
  const save=async(grants:Grant[],expected:string|null)=>{const updatedAt=new Date().toISOString(),result=await db.putSystemSettingIfUpdated(settingKey,{version:1,grants},updatedAt,expected);if(!result.updated)throw error("Participant grants changed; reload and retry.",409,"EXTERNAL_GRANT_CONFLICT");};

  app.get("/api/external-participants/grants",async()=>{const {value,updatedAt}=await load();return{grants:value.grants.map(publicGrant),updatedAt};});
  app.post("/api/external-participants/grants",async request=>{
    const body=grantInput.parse(request.body),workspace=await workspaces.requireWorkspace(body.workspaceId,LOCAL_HOST_ID);
    if(workspace.archivedAt)throw error("Workspace is archived.",409,"EXTERNAL_WORKSPACE_ARCHIVED");
    if(body.expiresAt&&Date.parse(body.expiresAt)<=Date.now())throw error("Expiry must be in the future.",400,"EXTERNAL_GRANT_EXPIRY");
    if(!body.mounts.length&&!body.readPaths.length&&!body.execution)throw error("Grant requires readable paths, mounts, or execution permission.",400,"EXTERNAL_GRANT_EMPTY");
    if(body.execution&&!input.executor)throw error("Task execution is unavailable.",503,"EXTERNAL_EXECUTION_UNAVAILABLE");
    if(new Set(body.mounts.map(item=>item.alias)).size!==body.mounts.length)throw error("Mount aliases must be unique.",400,"EXTERNAL_MOUNT_DUPLICATE");
    if(body.writePaths.some(item=>!inScope(item,body.readPaths)))throw error("Writable paths must also be readable.",400,"EXTERNAL_GRANT_WRITE_SCOPE");
    for(const mount of body.mounts){
      if(mount.writePaths.some(item=>!inScope(item,mount.readPaths)))throw error("Writable mount paths must also be readable.",400,"EXTERNAL_GRANT_WRITE_SCOPE");
      if(sensitive(mount.rootPath))throw error("Sensitive directories cannot be mounted.",403,"EXTERNAL_MOUNT_ROOT");
      const targetWorkspace=await workspaces.requireWorkspace(mount.workspaceId,LOCAL_HOST_ID);
      if(targetWorkspace.archivedAt)throw error("Mounted workspace is archived.",409,"EXTERNAL_WORKSPACE_ARCHIVED");
      const target=path.resolve(targetWorkspace.canonicalPath,mount.rootPath||"."),real=fs.realpathSync(target);
      if(target!==real||!real.startsWith(`${targetWorkspace.canonicalPath}${path.sep}`)&&real!==targetWorkspace.canonicalPath||!fs.statSync(real).isDirectory())throw error("Mount root must be a regular directory inside its workspace.",403,"EXTERNAL_MOUNT_ROOT");
    }
    const token=`whp_${crypto.randomBytes(32).toString("base64url")}`,now=new Date().toISOString(),grant:Grant={...body,id:crypto.randomUUID(),tokenHash:digest(token).toString("hex"),createdAt:now,revokedAt:null},{value,updatedAt}=await load();
    await save([...value.grants,grant],updatedAt);
    await audit("external-participant-grant-create",grant,`reads=${grant.readPaths.length};writes=${grant.writePaths.length}`);
    return{grant:publicGrant(grant),token};
  });
  app.post("/api/external-participants/grants/:id/revoke",async request=>{
    const {id}=z.object({id:z.string().uuid()}).parse(request.params),{value,updatedAt}=await load(),grant=value.grants.find(item=>item.id===id);
    if(!grant)throw error("Grant not found.",404,"EXTERNAL_GRANT_NOT_FOUND");
    if(grant.revokedAt)return{grant:publicGrant(grant)};
    const next={...grant,revokedAt:new Date().toISOString()};await save(value.grants.map(item=>item.id===id?next:item),updatedAt);
    await audit("external-participant-grant-revoke",grant,"revoked");return{grant:publicGrant(next)};
  });
  app.get("/api/external-participants/tunnel-status",async()=>{
    const token=readParticipantSecret(dataRoot,"participant.token"),hash=token&&/^whp_[A-Za-z0-9_-]{43}$/.test(token)?digest(token):null,{value}=await load();
    return{runtimeKeyConfigured:participantSecretPresent(dataRoot,"tunnel-runtime.key"),participantTokenConfigured:Boolean(hash&&value.grants.some(item=>equal(Buffer.from(item.tokenHash,"hex"),hash)&&!item.revokedAt&&(!item.expiresAt||Date.parse(item.expiresAt)>Date.now())))};
  });
  app.put("/api/external-participants/tunnel-key",{config:{rateLimit:{max:5,timeWindow:"10 minutes"}}},async request=>{
    const {apiKey}=z.object({apiKey:z.string().min(20).max(4096)}).strict().parse(request.body);
    storeParticipantSecret(dataRoot,"tunnel-runtime.key",apiKey.trim());
    return{runtimeKeyConfigured:true};
  });
  app.put("/api/external-participants/tunnel-token",{config:{rateLimit:{max:5,timeWindow:"10 minutes"}}},async request=>{
    const {participantToken}=z.object({participantToken:z.string().regex(/^whp_[A-Za-z0-9_-]{43}$/)}).strict().parse(request.body),hash=digest(participantToken),{value}=await load();
    if(!value.grants.some(item=>equal(Buffer.from(item.tokenHash,"hex"),hash)&&!item.revokedAt&&(!item.expiresAt||Date.parse(item.expiresAt)>Date.now())))throw error("The participant grant is not active.",403,"EXTERNAL_TOKEN_INVALID");
    storeParticipantSecret(dataRoot,"participant.token",participantToken);
    return{participantTokenConfigured:true};
  });

  app.get("/external-participants/v1/assignments",{config:{rateLimit:{max:30,timeWindow:"1 minute"}}},async request=>{
    const grant=await requireGrant(request),cards=await db.listBoardCards({workspaceId:grant.workspaceId});
    return{assignments:cards.filter(card=>!card.archivedAt).map(card=>({id:card.id,title:card.title,description:card.description,status:card.boardStatus,priority:card.priority,revision:card.revision,updatedAt:card.updatedAt}))};
  });
  app.get("/external-participants/v1/files",{config:{rateLimit:{max:60,timeWindow:"1 minute"}}},async request=>{
    const grant=await requireGrant(request),query=z.object({directory:z.string().min(1).max(512)}).parse(request.query);
    if(grant.mounts.length&&query.directory===".")return{directory:".",entries:grant.mounts.map(mount=>({name:mount.alias,path:mount.alias,type:"directory"}))};
    const resolved=await resolveDirectory(grant,query.directory),{directory}=resolved,workspace=await workspaces.requireWorkspace(resolved.workspaceId,LOCAL_HOST_ID),target=path.resolve(workspace.canonicalPath,resolved.relative),real=fs.realpathSync(target);
    if(real!==target||!fs.statSync(real).isDirectory())throw error("A regular directory is required.",403,"EXTERNAL_DIRECTORY_INVALID");
    return{directory,entries:fs.readdirSync(real,{withFileTypes:true}).filter(item=>!item.isSymbolicLink()&&item.name!==".git").slice(0,100).map(item=>({name:item.name,path:`${directory}/${item.name}`,type:item.isDirectory()?"directory":item.isFile()?"file":"other"})).filter(item=>{
      const within=grant.mounts.length?item.path.split("/").slice(1).join("/"):item.path;
      return!sensitive(within)&&directoryInScope(within,resolved.readPaths);
    })};
  });
  app.get("/external-participants/v1/file",{config:{rateLimit:{max:60,timeWindow:"1 minute"}}},async request=>{
    const grant=await requireGrant(request),query=z.object({path:scopePath}).parse(request.query),filePath=await resolveFile(grant,query.path,"read"),resolved=await workspaces.resolveWorkspaceFile(filePath.workspaceId,{path:filePath.relative,pathBase:"workspace"});
    const file=await workspaces.readEditableWorkspaceFile(filePath.workspaceId,resolved.entry.id);
    await audit("external-participant-file-read",grant,`path=${filePath.logical}`);
    return{path:filePath.logical,content:file.content,revision:file.revision,byteLength:file.byteLength};
  });
  app.put("/external-participants/v1/file",{bodyLimit:768*1024,config:{rateLimit:{max:20,timeWindow:"1 minute"}}},async request=>{
    const grant=await requireGrant(request),body=z.object({path:scopePath,content:z.string(),expectedRevision:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(request.body),filePath=await resolveFile(grant,body.path,"write");
    if(Buffer.byteLength(body.content,"utf8")>MAX_EDITABLE_WORKSPACE_FILE_BYTES)throw error("File exceeds the 256 KiB edit limit.",413,"EXTERNAL_FILE_TOO_LARGE");
    const resolved=await workspaces.resolveWorkspaceFile(filePath.workspaceId,{path:filePath.relative,pathBase:"workspace"}),result=await workspaces.writeWorkspaceFile(filePath.workspaceId,{fileId:resolved.entry.id,content:body.content,expectedRevision:body.expectedRevision});
    await audit("external-participant-file-write",grant,`path=${filePath.logical};before=${result.previousRevision};after=${result.revision}`);
    return{path:filePath.logical,revision:result.revision,changed:result.relativeChanged};
  });
  app.post("/external-participants/v1/file",{bodyLimit:768*1024,config:{rateLimit:{max:20,timeWindow:"1 minute"}}},async request=>{
    const grant=await requireGrant(request),body=z.object({path:scopePath,content:z.string()}).strict().parse(request.body),filePath=await resolveFile(grant,body.path,"write");
    if(!/\.(?:md|html|htm)$/i.test(filePath.relative))throw error("New participant files must be Markdown or HTML.",415,"EXTERNAL_FILE_EXTENSION");
    const bytes=Buffer.from(body.content,"utf8");if(bytes.length>MAX_EDITABLE_WORKSPACE_FILE_BYTES)throw error("File exceeds the 256 KiB edit limit.",413,"EXTERNAL_FILE_TOO_LARGE");
    const workspace=await workspaces.requireWorkspace(filePath.workspaceId,LOCAL_HOST_ID),target=path.resolve(workspace.canonicalPath,filePath.relative),parent=path.dirname(target),parentReal=fs.realpathSync(parent);
    if(parentReal!==parent||!parentReal.startsWith(`${workspace.canonicalPath}${path.sep}`)&&parentReal!==workspace.canonicalPath)throw error("Destination is outside the workspace or traverses a link.",403,"EXTERNAL_FILE_SCOPE");
    try{fs.writeFileSync(target,bytes,{flag:"wx",mode:0o600});}catch(caught){if((caught as NodeJS.ErrnoException).code==="EEXIST")throw error("File already exists; read its revision before editing.",409,"EXTERNAL_FILE_EXISTS");throw caught;}
    const revision=crypto.createHash("sha256").update(bytes).digest("hex");await audit("external-participant-file-create",grant,`path=${filePath.logical};revision=${revision}`);
    return{path:filePath.logical,revision,byteLength:bytes.length};
  });
  app.post("/external-participants/v1/assignments/:id/report",{config:{rateLimit:{max:20,timeWindow:"1 minute"}}},async request=>{
    const grant=await requireGrant(request),{id}=z.object({id:z.string().uuid()}).parse(request.params),body=z.object({kind:z.enum(["note","review","handoff"]),content:z.string().trim().min(1).max(10_000),idempotencyKey:z.string().uuid()}).strict().parse(request.body),card=await db.getWorkChain(id);
    if(!card||!card.boardVisible||card.archivedAt||card.workspaceId!==grant.workspaceId)throw error("Assignment is outside the participant grant.",404,"EXTERNAL_ASSIGNMENT_NOT_FOUND");
    const timestamp=new Date().toISOString(),record=await db.appendWorkChainEvent({id:crypto.randomUUID(),chainId:id,eventType:`external_${body.kind}`,taskId:null,collaborationSessionId:null,actorType:"external-participant",actorId:grant.id,dedupeKey:`external:${grant.id}:${body.idempotencyKey}`,payload:{content:body.content},createdAt:timestamp});
    await audit("external-participant-report",grant,`assignment=${id};kind=${body.kind};inserted=${record.inserted}`);
    return{assignmentId:id,inserted:record.inserted,eventId:record.event.id};
  });
  registerExternalParticipantTaskRoutes(app,{db,requireGrant,executor:input.executor});
}
