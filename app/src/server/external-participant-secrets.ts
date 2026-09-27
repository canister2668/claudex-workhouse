// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Claudex Workhouse.

import fs from "node:fs";
import path from "node:path";

export type ParticipantSecretName="tunnel-runtime.key"|"participant.token";

function privateDirectory(dataRoot:string){
  const parent=path.join(dataRoot,"secrets"),directory=path.join(parent,"openai-participant");
  for(const candidate of [parent,directory]){
    try{const stat=fs.lstatSync(candidate);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error("Participant secret directory is unsafe.");}
    catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;fs.mkdirSync(candidate,{mode:0o700});}
  }
  fs.chmodSync(directory,0o700);
  return directory;
}

export function participantSecretPath(dataRoot:string,name:ParticipantSecretName){return path.join(privateDirectory(dataRoot),name);}

export function participantSecretPresent(dataRoot:string,name:ParticipantSecretName){
  const file=participantSecretPath(dataRoot,name);
  try{const stat=fs.lstatSync(file);return stat.isFile()&&!stat.isSymbolicLink()&&stat.size>0&&(stat.mode&0o777)===0o600&&stat.uid===process.getuid?.();}
  catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return false;throw error;}
}

export function readParticipantSecret(dataRoot:string,name:ParticipantSecretName){
  if(!participantSecretPresent(dataRoot,name))return null;
  return fs.readFileSync(participantSecretPath(dataRoot,name),"utf8").trim();
}

export function storeParticipantSecret(dataRoot:string,name:ParticipantSecretName,value:string){
  if(name==="participant.token"&&!/^whp_[A-Za-z0-9_-]{43}$/.test(value))throw new Error("Invalid participant token.");
  if(name==="tunnel-runtime.key"&&!/^sk-[A-Za-z0-9_-]{16,4090}$/.test(value))throw new Error("Invalid Platform runtime API key.");
  const directory=privateDirectory(dataRoot),file=path.join(directory,name);
  try{const existing=fs.lstatSync(file);if(!existing.isFile()||existing.isSymbolicLink()||existing.uid!==process.getuid?.())throw new Error("Participant secret file is unsafe.");}
  catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
  const temporary=path.join(directory,`.${name}.${process.pid}.${Date.now()}.tmp`);
  let descriptor:number|null=null;
  try{
    descriptor=fs.openSync(temporary,"wx",0o600);fs.writeFileSync(descriptor,`${value}\n`,"utf8");fs.fsyncSync(descriptor);fs.closeSync(descriptor);descriptor=null;
    fs.chmodSync(temporary,0o600);fs.renameSync(temporary,file);fs.chmodSync(file,0o600);
    const directoryDescriptor=fs.openSync(directory,"r");try{fs.fsyncSync(directoryDescriptor);}finally{fs.closeSync(directoryDescriptor);}
  }catch(error){if(descriptor!==null)try{fs.closeSync(descriptor);}catch{}try{fs.unlinkSync(temporary);}catch{}throw error;}
}
