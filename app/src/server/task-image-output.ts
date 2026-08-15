import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {MAX_WORKSPACE_IMAGE_PREVIEW_BYTES,workspaceImageMime} from "./workspace-image-preview.js";

export type TaskImageMetadata={mediaKind:"image";mediaPath:string;mediaPathBase:"task-output"};

const safeSegment=(value:unknown)=>typeof value==="string"&&/^[A-Za-z0-9._-]{1,200}$/.test(value)?value:null;
const taskDirectory=(taskId:string)=>crypto.createHash("sha256").update(taskId).digest("hex");
const outputRoot=(root:string)=>path.join(root,"data","image-outputs");

function verifiedImage(source:string){
  let stat:fs.Stats;try{stat=fs.lstatSync(source);}catch{return null;}
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size<1||stat.size>MAX_WORKSPACE_IMAGE_PREVIEW_BYTES)return null;
  const fd=fs.openSync(source,"r"),signature=Buffer.alloc(Math.min(32,stat.size));
  try{fs.readSync(fd,signature,0,signature.length,0);}finally{fs.closeSync(fd);}
  const mime=workspaceImageMime(signature);return mime?{stat,mime}:null;
}

function conventionalGeneratedImage(threadId:unknown,itemId:unknown){
  const thread=safeSegment(threadId),item=safeSegment(itemId);if(!thread||!item)return null;
  const codexHome=path.resolve(process.env.CODEX_HOME?.trim()||path.join(os.homedir(),".codex"));
  const generatedRoot=path.join(codexHome,"generated_images"),directory=path.join(generatedRoot,thread);
  for(const extension of [".png",".jpg",".jpeg",".gif",".webp",".avif"]){
    const candidate=path.join(directory,`${item}${extension}`),verified=verifiedImage(candidate);if(!verified)continue;
    let real:string,base:string;try{real=fs.realpathSync(candidate);base=fs.realpathSync(generatedRoot);}catch{continue;}
    if(real.startsWith(`${base}${path.sep}`))return{path:real,extension,mime:verified.mime};
  }
  return null;
}

export function captureTaskImageOutput(input:{root:string;taskId:string;threadId:unknown;item:any}):TaskImageMetadata|Record<string,never>{
  if(input.item?.type!=="imageGeneration")return{};
  let source:ReturnType<typeof conventionalGeneratedImage>=null;
  const saved=typeof input.item.savedPath==="string"&&input.item.savedPath.trim()?path.resolve(input.item.savedPath):null;
  if(saved){const verified=verifiedImage(saved);if(verified)source={path:saved,extension:path.extname(saved).toLowerCase(),mime:verified.mime};}
  source??=conventionalGeneratedImage(input.threadId,input.item.id);if(!source)return{};
  const item=safeSegment(input.item.id);if(!item)return{};
  const relative=path.posix.join(taskDirectory(input.taskId),`${crypto.createHash("sha256").update(item).digest("hex")}${source.extension}`);
  const destination=path.join(outputRoot(input.root),...relative.split("/"));
  fs.mkdirSync(path.dirname(destination),{recursive:true,mode:0o700});
  if(!fs.existsSync(destination)){const temporary=`${destination}.${process.pid}.${crypto.randomUUID()}.tmp`;try{fs.copyFileSync(source.path,temporary,fs.constants.COPYFILE_EXCL);fs.chmodSync(temporary,0o600);fs.renameSync(temporary,destination);}catch(error){try{fs.rmSync(temporary,{force:true});}catch{}throw error;}}
  return{mediaKind:"image",mediaPath:relative,mediaPathBase:"task-output"};
}

export function resolveTaskImageOutput(root:string,taskId:string,mediaPath:string){
  const normalized=mediaPath.replaceAll("\\","/"),expected=`${taskDirectory(taskId)}/`;
  if(!normalized.startsWith(expected)||normalized.startsWith("/")||normalized.split("/").some(part=>!part||part===".."))throw Object.assign(new Error("Task image output path is invalid."),{statusCode:400,code:"TASK_IMAGE_OUTPUT_INVALID"});
  const base=path.resolve(outputRoot(root)),target=path.resolve(base,...normalized.split("/"));
  if(!target.startsWith(`${base}${path.sep}`))throw Object.assign(new Error("Task image output path escapes its store."),{statusCode:400,code:"TASK_IMAGE_OUTPUT_INVALID"});
  const verified=verifiedImage(target);if(!verified)throw Object.assign(new Error("Task image output was not found."),{statusCode:404,code:"TASK_IMAGE_OUTPUT_NOT_FOUND"});
  return{real:target,name:path.basename(target),size:verified.stat.size,modifiedAt:verified.stat.mtime.toISOString(),mime:verified.mime};
}
