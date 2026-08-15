// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Claudex Workhouse.

import fs from"node:fs";
import path from"node:path";

export const ORIGINAL_PROJECT="Claudex Workhouse";
export const ORIGINAL_REPOSITORY="https://github.com/canister2668/claudex-workhouse";
export const PROJECT_LICENSE="AGPL-3.0-only";
export const COPYRIGHT_YEAR="2026";
export const COPYRIGHT_HOLDER="Canister";

export type DistributionStatus="Official"|"Modified"|"Unofficial";
export type LegalNoticeMetadata={
  project:string;
  copyrightYear:string;
  copyrightHolder:string;
  license:string;
  distributionStatus:DistributionStatus;
  originalProject:string;
  originalRepository:string;
  distributor:string|null;
  version:string;
  commitSha:string;
  correspondingSource:string;
};

function sourceUrl(value:string,name:string){
  if(value.length>2048)throw new Error(`${name} is too long.`);
  let parsed:URL;
  try{parsed=new URL(value);}catch{throw new Error(`${name} must be an absolute HTTP or HTTPS URL.`);}
  if(!["http:","https:"].includes(parsed.protocol)||parsed.username||parsed.password){
    throw new Error(`${name} must be an HTTP or HTTPS URL without embedded credentials.`);
  }
  return parsed.href;
}

function distributionStatus(value:string|undefined):DistributionStatus{
  const normalized=(value??"official").trim().toLowerCase();
  if(normalized==="official")return"Official";
  if(normalized==="modified")return"Modified";
  if(normalized==="unofficial")return"Unofficial";
  throw new Error("CLAUDEX_WORKHOUSE_DISTRIBUTION_STATUS must be Official, Modified, or Unofficial.");
}

function commitFromGitDirectory(root:string){
  try{
    const dotGit=path.join(root,".git"),stat=fs.statSync(dotGit);
    let gitDir=dotGit;
    if(stat.isFile()){
      const pointer=fs.readFileSync(dotGit,"utf8").trim().match(/^gitdir:\s*(.+)$/i)?.[1];
      if(!pointer)return null;
      gitDir=path.resolve(root,pointer);
    }
    const head=fs.readFileSync(path.join(gitDir,"HEAD"),"utf8").trim();
    if(/^[a-f0-9]{40,64}$/i.test(head))return head.toLowerCase();
    const reference=head.match(/^ref:\s*(.+)$/)?.[1];
    if(!reference||reference.split("/").some(part=>!part||part==="."||part===".."))return null;
    const loose=path.join(gitDir,...reference.split("/"));
    if(fs.existsSync(loose)){
      const value=fs.readFileSync(loose,"utf8").trim();
      if(/^[a-f0-9]{40,64}$/i.test(value))return value.toLowerCase();
    }
    const packed=fs.readFileSync(path.join(gitDir,"packed-refs"),"utf8");
    const line=packed.split(/\r?\n/).find(item=>item.endsWith(` ${reference}`));
    const value=line?.split(" ")[0];
    return value&&/^[a-f0-9]{40,64}$/i.test(value)?value.toLowerCase():null;
  }catch{return null;}
}

export function legalNoticeMetadata(options:{root:string;version:string;environment?:NodeJS.ProcessEnv}):LegalNoticeMetadata{
  const environment=options.environment??process.env;
  const status=distributionStatus(environment.CLAUDEX_WORKHOUSE_DISTRIBUTION_STATUS);
  const configuredCommit=environment.CLAUDEX_WORKHOUSE_COMMIT_SHA?.trim();
  if(configuredCommit&&!/^[a-f0-9]{7,64}$/i.test(configuredCommit)){
    throw new Error("CLAUDEX_WORKHOUSE_COMMIT_SHA must be a 7 to 64 character hexadecimal commit identifier.");
  }
  const commitSha=(configuredCommit?.toLowerCase()||commitFromGitDirectory(options.root)||"unknown");
  const configuredSource=environment.CLAUDEX_WORKHOUSE_SOURCE_URL?.trim();
  const correspondingSource=sourceUrl(
    configuredSource||(commitSha==="unknown"?ORIGINAL_REPOSITORY:`${ORIGINAL_REPOSITORY}/tree/${commitSha}`),
    "CLAUDEX_WORKHOUSE_SOURCE_URL"
  );
  const distributor=environment.CLAUDEX_WORKHOUSE_DISTRIBUTOR?.trim()||null;
  if(status!=="Official"&&!distributor){
    throw new Error("CLAUDEX_WORKHOUSE_DISTRIBUTOR is required for Modified or Unofficial distributions.");
  }
  if(status!=="Official"&&!configuredSource){
    throw new Error("CLAUDEX_WORKHOUSE_SOURCE_URL is required for Modified or Unofficial distributions.");
  }
  return{
    project:ORIGINAL_PROJECT,
    copyrightYear:COPYRIGHT_YEAR,
    copyrightHolder:COPYRIGHT_HOLDER,
    license:PROJECT_LICENSE,
    distributionStatus:status,
    originalProject:ORIGINAL_PROJECT,
    originalRepository:ORIGINAL_REPOSITORY,
    distributor,
    version:options.version,
    commitSha,
    correspondingSource
  };
}
