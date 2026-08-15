import crypto from"node:crypto";
import fs from"node:fs";
import path from"node:path";
import{isAbsoluteHostPath}from"../platform.js";

export type WindowsPayloadFile={path:string;size:number;sha256:string};
export type WindowsPayloadManifest={schemaVersion:1;product:"claudex-workhouse-windows-server";version:string;architecture:"x64";createdAt:string;files:WindowsPayloadFile[]};

const RESERVED=/^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9]|lpt[1-9])(?:\.|$)/i;
export function validateWindowsPayloadPath(value:string){
  if(!value||value.length>4096||value.includes("\\")||value.startsWith("/")||value.startsWith("//")||isAbsoluteHostPath(value,"win32"))throw new Error("Payload path must be a relative forward-slash path.");
  const parts=value.split("/");
  if(parts.some(part=>!part||part==="."||part===".."||RESERVED.test(part)||/[ .]$/.test(part)||/[<>:"|?*\u0000-\u001f]/.test(part)))throw new Error("Payload path contains an unsafe Windows segment.");
  return parts.join("/");
}
function digestFile(file:string){const hash=crypto.createHash("sha256"),fd=fs.openSync(file,"r"),buffer=Buffer.allocUnsafe(1024*1024);try{for(let count;(count=fs.readSync(fd,buffer,0,buffer.length,null))>0;)hash.update(buffer.subarray(0,count));return hash.digest("hex");}finally{fs.closeSync(fd);}}
function walk(root:string,current="",files:string[]=[]){
  const directory=path.join(root,...(current?current.split("/"):[]));
  for(const entry of fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,"en"))){
    if(entry.isSymbolicLink())throw new Error(`Payload contains a symbolic link: ${entry.name}`);
    const relative=current?`${current}/${entry.name}`:entry.name,validated=validateWindowsPayloadPath(relative),file=path.join(directory,entry.name);
    if(entry.isDirectory())walk(root,validated,files);
    else if(entry.isFile())files.push(validated);
    else throw new Error(`Payload contains an unsupported file type: ${relative}`);
  }
  return files;
}
export function buildWindowsPayloadManifest(root:string,version:string,createdAt=new Date().toISOString()):WindowsPayloadManifest{
  if(!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version))throw new Error("Payload version is invalid.");
  const seen=new Set<string>(),files=walk(root).map(relative=>{
    const key=relative.toLowerCase();if(seen.has(key))throw new Error(`Payload has a case-insensitive path collision: ${relative}`);seen.add(key);
    const file=path.join(root,...relative.split("/")),stat=fs.statSync(file);
    return{path:relative,size:stat.size,sha256:digestFile(file)};
  });
  return{schemaVersion:1,product:"claudex-workhouse-windows-server",version,architecture:"x64",createdAt,files};
}
export function verifyWindowsPayload(root:string,manifest:WindowsPayloadManifest){
  if(manifest.schemaVersion!==1||manifest.product!=="claudex-workhouse-windows-server"||manifest.architecture!=="x64")throw new Error("Payload manifest identity is invalid.");
  const actual=buildWindowsPayloadManifest(root,manifest.version,manifest.createdAt),expected=new Map<string,WindowsPayloadFile>();
  for(const item of manifest.files){const relative=validateWindowsPayloadPath(item.path),key=relative.toLowerCase();if(expected.has(key))throw new Error(`Payload manifest has a duplicate path: ${relative}`);if(!/^[a-f0-9]{64}$/.test(item.sha256)||!Number.isSafeInteger(item.size)||item.size<0)throw new Error(`Payload manifest metadata is invalid: ${relative}`);expected.set(key,item);}
  if(actual.files.length!==expected.size)throw new Error("Payload file count does not match its manifest.");
  for(const item of actual.files){const wanted=expected.get(item.path.toLowerCase());if(!wanted||wanted.path!==item.path||wanted.size!==item.size||wanted.sha256!==item.sha256)throw new Error(`Payload verification failed: ${item.path}`);}
  return actual;
}
function atomicJson(file:string,value:unknown){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const temporary=`${file}.${process.pid}.${crypto.randomUUID()}.tmp`,body=`${JSON.stringify(value,null,2)}\n`,fd=fs.openSync(temporary,"wx",0o600);
  try{fs.writeFileSync(fd,body);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  fs.renameSync(temporary,file);
}
export function activateWindowsPayload(input:{installRoot:string;stagingRoot:string;manifest:WindowsPayloadManifest}){
  verifyWindowsPayload(input.stagingRoot,input.manifest);
  const versions=path.join(input.installRoot,"versions"),target=path.join(versions,input.manifest.version);
  fs.mkdirSync(versions,{recursive:true});
  if(fs.existsSync(target)){verifyWindowsPayload(target,input.manifest);fs.rmSync(input.stagingRoot,{recursive:true,force:true});}else fs.renameSync(input.stagingRoot,target);
  const currentFile=path.join(input.installRoot,"current.json"),previous=fs.existsSync(currentFile)?JSON.parse(fs.readFileSync(currentFile,"utf8")):null;
  atomicJson(currentFile,{schemaVersion:1,version:input.manifest.version,payloadDirectory:path.relative(input.installRoot,target).split(path.sep).join("/"),previousVersion:typeof previous?.version==="string"?previous.version:null,activatedAt:new Date().toISOString()});
  return{target,current:JSON.parse(fs.readFileSync(currentFile,"utf8")),previous};
}
