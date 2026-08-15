import type {AgentEvent} from "./types.js";

export type TaskGitAttribution={
  version:2;
  capturedAt:string;
  observedFiles:string[];
  dirtyFilesAtCapture:string[];
  commitAtCapture:string|null;
};

function normalizedRelativePath(value:unknown){
  if(typeof value!=="string")return null;
  const normalized=value.trim().replace(/\\/g,"/").replace(/^\.\//,"").replace(/\/{2,}/g,"/");
  if(!normalized||normalized.startsWith("/")||normalized===".."||normalized.startsWith("../"))return null;
  return normalized;
}

export function taskGitAttribution(events:AgentEvent[],gitStatus:unknown,capturedAt:string):TaskGitAttribution|null{
  const status=gitStatus&&typeof gitStatus==="object"&&!Array.isArray(gitStatus)?gitStatus as Record<string,unknown>:{};
  const dirty=Array.isArray(status.changedFiles)?status.changedFiles.map(normalizedRelativePath).filter((value):value is string=>Boolean(value)):[];
  const observed=new Set<string>();
  for(const event of events){
    if(event.type!=="file_change_started"&&event.type!=="file_change_completed")continue;
    const pathBase=event.metadata?.pathBase;
    if(pathBase!=="workspace"&&pathBase!=="task-cwd")continue;
    const file=normalizedRelativePath(event.metadata?.path);
    if(file)observed.add(file);
  }
  if(!observed.size)return null;
  return{version:2,capturedAt,observedFiles:[...observed].sort(),dirtyFilesAtCapture:[...new Set(dirty)].sort(),commitAtCapture:typeof status.commit==="string"&&status.commit.trim()?status.commit.trim():null};
}

export function mergeLiveTaskGitAttribution(events:AgentEvent[],stored:unknown,capturedAt:string):TaskGitAttribution|null{
  const live=taskGitAttribution(events,{},capturedAt),record=stored&&typeof stored==="object"&&!Array.isArray(stored)?stored as Record<string,unknown>:{};
  const prior=Array.isArray(record.observedFiles)?record.observedFiles.map(normalizedRelativePath).filter((value):value is string=>Boolean(value)):[];
  const observedFiles=[...new Set([...prior,...(live?.observedFiles??[])])].sort();
  if(!observedFiles.length)return null;
  const dirtyFilesAtCapture=Array.isArray(record.dirtyFilesAtCapture)?record.dirtyFilesAtCapture.map(normalizedRelativePath).filter((value):value is string=>Boolean(value)):[];
  return{version:2,capturedAt:live?.capturedAt??(typeof record.capturedAt==="string"?record.capturedAt:capturedAt),observedFiles,dirtyFilesAtCapture:[...new Set(dirtyFilesAtCapture)].sort(),commitAtCapture:typeof record.commitAtCapture==="string"&&record.commitAtCapture.trim()?record.commitAtCapture.trim():null};
}
