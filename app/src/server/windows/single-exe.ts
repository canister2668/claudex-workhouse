import crypto from"node:crypto";
import fs from"node:fs";
import path from"node:path";
import{validateWindowsPayloadPath,verifyWindowsPayload,type WindowsPayloadManifest}from"./payload.js";

const MAGIC=Buffer.from("CWHSPAYLOADV2\0\0\0","ascii");
const FOOTER_SIZE=112;
const FORMAT_VERSION=2;
const MAX_SINGLE_EXE_BYTES=200*1024*1024;

export type WindowsSingleExeInfo={
  launcherSize:number;
  payloadOffset:number;
  payloadSize:number;
  manifestOffset:number;
  manifestSize:number;
  totalSize:number;
  manifest:WindowsPayloadManifest;
};

function safeNumber(value:bigint,label:string){
  if(value>BigInt(Number.MAX_SAFE_INTEGER))throw new Error(`${label} exceeds the safe integer range.`);
  return Number(value);
}
function digest(value:Buffer|string){
  return crypto.createHash("sha256").update(value).digest();
}
function updateDigestRange(hash:crypto.Hash,fd:number,position:number,length:number){
  const buffer=Buffer.allocUnsafe(1024*1024);let remaining=length;
  while(remaining>0){const chunk=readExactly(fd,Math.min(buffer.length,remaining),position);hash.update(chunk);position+=chunk.length;remaining-=chunk.length;}
}
function peMutableOffsets(fd:number,launcherSize:number){
  if(launcherSize<64)throw new Error("Windows launcher PE header is incomplete.");
  const dos=readExactly(fd,64,0),peOffset=dos.readUInt32LE(60);
  if(peOffset<64||peOffset+24>launcherSize)throw new Error("Windows launcher PE signature is missing.");
  const header=readExactly(fd,24,peOffset);
  if(header.readUInt32LE(0)!==0x00004550)throw new Error("Windows launcher PE signature is invalid.");
  const optionalSize=header.readUInt16LE(20),optionalOffset=peOffset+24;
  if(optionalSize<152||optionalOffset+optionalSize>launcherSize)throw new Error("Windows launcher optional header is invalid.");
  const optional=readExactly(fd,optionalSize,optionalOffset);
  if(optional.readUInt16LE(0)!==0x20b||optional.readUInt32LE(108)<5)throw new Error("Windows launcher must be PE32+ with a security directory.");
  return{checksum:optionalOffset+64,securityDirectory:optionalOffset+144};
}
function canonicalLauncherDigest(fd:number,launcherSize:number){
  const offsets=peMutableOffsets(fd,launcherSize),hash=crypto.createHash("sha256");
  updateDigestRange(hash,fd,0,offsets.checksum);
  updateDigestRange(hash,fd,offsets.checksum+4,offsets.securityDirectory-(offsets.checksum+4));
  updateDigestRange(hash,fd,offsets.securityDirectory+8,launcherSize-(offsets.securityDirectory+8));
  return hash.digest();
}
function readExactly(fd:number,length:number,position:number){
  const value=Buffer.allocUnsafe(length);
  let offset=0;
  while(offset<length){
    const count=fs.readSync(fd,value,offset,length-offset,position+offset);
    if(count===0)throw new Error("Windows single EXE ended unexpectedly.");
    offset+=count;
  }
  return value;
}
function writeAll(fd:number,value:Buffer){
  let offset=0;
  while(offset<value.length)offset+=fs.writeSync(fd,value,offset,value.length-offset);
}
function copyFileBytes(source:string,targetFd:number,expected?:{size:number;sha256:string},tail=Buffer.alloc(0)){
  const sourceFd=fs.openSync(source,"r"),buffer=Buffer.allocUnsafe(1024*1024);
  const hash=crypto.createHash("sha256");let size=0;
  try{for(let count;(count=fs.readSync(sourceFd,buffer,0,buffer.length,null))>0;){const chunk=buffer.subarray(0,count);writeAll(targetFd,chunk);hash.update(chunk);size+=count;}}
  finally{fs.closeSync(sourceFd);}
  if(tail.length){writeAll(targetFd,tail);hash.update(tail);size+=tail.length;}
  const sha256=hash.digest("hex");
  if(expected&&(size!==expected.size||sha256!==expected.sha256))throw new Error(`Windows payload changed while packaging: ${source}`);
  return{size,sha256};
}
function manifestBody(manifest:WindowsPayloadManifest){
  return Buffer.from(`${JSON.stringify(manifest)}\n`,"utf8");
}
function validateManifestShape(value:unknown):WindowsPayloadManifest{
  if(!value||typeof value!=="object")throw new Error("Windows single EXE manifest is invalid.");
  const manifest=value as WindowsPayloadManifest;
  if(manifest.schemaVersion!==1||manifest.product!=="claudex-workhouse-windows-server"||manifest.architecture!=="x64"||typeof manifest.version!=="string"||typeof manifest.createdAt!=="string"||!Array.isArray(manifest.files))throw new Error("Windows single EXE manifest identity is invalid.");
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(manifest.createdAt)||!Number.isFinite(Date.parse(manifest.createdAt)))throw new Error("Windows single EXE manifest timestamp is invalid.");
  const seen=new Set<string>();
  for(const item of manifest.files){
    if(!item||typeof item!=="object"||typeof item.path!=="string"||!Number.isSafeInteger(item.size)||item.size<0||typeof item.sha256!=="string"||!/^[a-f0-9]{64}$/.test(item.sha256))throw new Error("Windows single EXE manifest entry is invalid.");
    const relative=validateWindowsPayloadPath(item.path),key=relative.toLowerCase();
    if(relative!==item.path||seen.has(key))throw new Error("Windows single EXE manifest path is ambiguous.");
    seen.add(key);
  }
  if(!seen.has("node.exe")||!seen.has("app/start.mjs"))throw new Error("Windows single EXE payload entry points are missing.");
  return manifest;
}
function logicalExecutableEnd(fd:number,totalSize:number){
  if(totalSize<64)return totalSize;
  const dos=readExactly(fd,64,0),peOffset=dos.readUInt32LE(60);
  if(peOffset<64||peOffset+24>totalSize)return totalSize;
  const header=readExactly(fd,24,peOffset);
  if(header.readUInt32LE(0)!==0x00004550)return totalSize;
  const optionalSize=header.readUInt16LE(20),optionalOffset=peOffset+24;
  if(optionalSize<152||optionalOffset+optionalSize>totalSize)return totalSize;
  const optional=readExactly(fd,optionalSize,optionalOffset);
  if(optional.readUInt16LE(0)!==0x20b||optional.readUInt32LE(108)<5)return totalSize;
  const certificateOffset=optional.readUInt32LE(144),certificateSize=optional.readUInt32LE(148);
  if(certificateOffset===0&&certificateSize===0)return totalSize;
  if(certificateOffset===0||certificateSize===0||certificateOffset%8!==0||certificateOffset+certificateSize!==totalSize)throw new Error("Windows Authenticode certificate table is invalid.");
  return certificateOffset;
}
export function inspectWindowsSingleExe(file:string):WindowsSingleExeInfo{
  const fd=fs.openSync(file,"r");
  try{
    const totalSize=fs.fstatSync(fd).size;
    if(totalSize<FOOTER_SIZE)throw new Error("Windows single EXE footer is missing.");
    const logicalEnd=logicalExecutableEnd(fd,totalSize);
    if(logicalEnd<FOOTER_SIZE)throw new Error("Windows single EXE footer is missing.");
    const footer=readExactly(fd,FOOTER_SIZE,logicalEnd-FOOTER_SIZE);
    if(!footer.subarray(0,MAGIC.length).equals(MAGIC)||footer.readUInt32LE(16)!==FORMAT_VERSION||footer.readUInt32LE(20)!==FOOTER_SIZE)throw new Error("Windows single EXE footer identity is invalid.");
    const launcherSize=safeNumber(footer.readBigUInt64LE(24),"launcher size"),payloadSize=safeNumber(footer.readBigUInt64LE(32),"payload size"),manifestSize=safeNumber(footer.readBigUInt64LE(40),"manifest size");
    if(launcherSize<2||payloadSize<=0||manifestSize<=0||launcherSize+payloadSize+manifestSize+FOOTER_SIZE!==logicalEnd)throw new Error("Windows single EXE section sizes are invalid.");
    if(!readExactly(fd,2,0).equals(Buffer.from("MZ","ascii")))throw new Error("Windows launcher is not a PE executable.");
    const manifestOffset=launcherSize+payloadSize,body=readExactly(fd,manifestSize,manifestOffset);
    if(!canonicalLauncherDigest(fd,launcherSize).equals(footer.subarray(48,80)))throw new Error("Windows single EXE launcher hash does not match.");
    if(!digest(body).equals(footer.subarray(80,112)))throw new Error("Windows single EXE manifest hash does not match.");
    let parsed:unknown;try{parsed=JSON.parse(body.toString("utf8"));}catch{throw new Error("Windows single EXE manifest JSON is invalid.");}
    const manifest=validateManifestShape(parsed),declared=manifest.files.reduce((sum,item)=>sum+item.size,0);
    if(declared!==payloadSize)throw new Error("Windows single EXE payload size does not match its manifest.");
    return{launcherSize,payloadOffset:launcherSize,payloadSize,manifestOffset,manifestSize,totalSize,manifest};
  }finally{fs.closeSync(fd);}
}
export function buildWindowsSingleExe(input:{launcher:string;payloadRoot:string;manifest:WindowsPayloadManifest;output:string;maximumBytes?:number}){
  verifyWindowsPayload(input.payloadRoot,input.manifest);
  validateManifestShape(input.manifest);
  const launcher=fs.statSync(input.launcher);
  if(!launcher.isFile())throw new Error("Windows launcher is not a file.");
  const launcherFd=fs.openSync(input.launcher,"r");try{if(!readExactly(launcherFd,2,0).equals(Buffer.from("MZ","ascii")))throw new Error("Windows launcher is not a PE executable.");peMutableOffsets(launcherFd,launcher.size);}finally{fs.closeSync(launcherFd);}
  const body=manifestBody(input.manifest),payloadSize=input.manifest.files.reduce((sum,item)=>sum+item.size,0),padding=(8-((launcher.size+payloadSize+body.length+FOOTER_SIZE)%8))%8,launcherSize=launcher.size+padding,totalSize=launcherSize+payloadSize+body.length+FOOTER_SIZE,maximum=input.maximumBytes??MAX_SINGLE_EXE_BYTES;
  if(totalSize>maximum)throw new Error(`Windows single EXE exceeds the ${maximum} byte limit.`);
  fs.mkdirSync(path.dirname(input.output),{recursive:true});
  const temporary=`${input.output}.${process.pid}.${crypto.randomUUID()}.tmp`,fd=fs.openSync(temporary,"wx",0o755);
  try{
    copyFileBytes(input.launcher,fd,undefined,Buffer.alloc(padding));
    fs.fsyncSync(fd);
    const readFd=fs.openSync(temporary,"r");let launcherDigest:string;try{launcherDigest=canonicalLauncherDigest(readFd,launcherSize).toString("hex");}finally{fs.closeSync(readFd);}
    for(const item of input.manifest.files)copyFileBytes(path.join(input.payloadRoot,...item.path.split("/")),fd,item);
    writeAll(fd,body);
    const footer=Buffer.alloc(FOOTER_SIZE);MAGIC.copy(footer);footer.writeUInt32LE(FORMAT_VERSION,16);footer.writeUInt32LE(FOOTER_SIZE,20);footer.writeBigUInt64LE(BigInt(launcherSize),24);footer.writeBigUInt64LE(BigInt(payloadSize),32);footer.writeBigUInt64LE(BigInt(body.length),40);Buffer.from(launcherDigest,"hex").copy(footer,48);digest(body).copy(footer,80);writeAll(fd,footer);fs.fsyncSync(fd);
  }catch(error){fs.closeSync(fd);fs.rmSync(temporary,{force:true});throw error;}
  fs.closeSync(fd);fs.renameSync(temporary,input.output);
  const info=inspectWindowsSingleExe(input.output);
  if(info.manifest.version!==input.manifest.version)throw new Error("Windows single EXE verification returned the wrong version.");
  return info;
}
export function extractWindowsSingleExe(input:{file:string;stagingRoot:string}){
  const info=inspectWindowsSingleExe(input.file);
  fs.mkdirSync(path.dirname(input.stagingRoot),{recursive:true});
  try{fs.mkdirSync(input.stagingRoot);}catch(error){throw new Error("Windows single EXE staging directory already exists.",{cause:error});}
  const fd=fs.openSync(input.file,"r");
  let position=info.payloadOffset;
  try{
    for(const item of info.manifest.files){
      const target=path.join(input.stagingRoot,...item.path.split("/"));
      fs.mkdirSync(path.dirname(target),{recursive:true});
      const output=fs.openSync(target,"wx",0o600),hash=crypto.createHash("sha256");
      try{
        let remaining=item.size;
        while(remaining>0){const chunk=readExactly(fd,Math.min(1024*1024,remaining),position);writeAll(output,chunk);hash.update(chunk);position+=chunk.length;remaining-=chunk.length;}
        fs.fsyncSync(output);
      }finally{fs.closeSync(output);}
      if(hash.digest("hex")!==item.sha256)throw new Error(`Windows single EXE payload hash failed: ${item.path}`);
    }
    if(position!==info.manifestOffset)throw new Error("Windows single EXE extraction ended at the wrong offset.");
    verifyWindowsPayload(input.stagingRoot,info.manifest);
    return info.manifest;
  }catch(error){fs.rmSync(input.stagingRoot,{recursive:true,force:true});throw error;}
  finally{fs.closeSync(fd);}
}
