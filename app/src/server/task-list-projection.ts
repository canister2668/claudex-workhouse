import type {DeckTask} from "./types.js";

const PREVIEW_LIMIT=320;
const LIST_METADATA_KEYS=[
  "activity",
  "parallelAgents",
  "collaborationParticipantId",
  "collaborationSessionId",
  "collaborationMode",
  "managedProviderSourceTaskId",
  "gitAttribution"
] as const;

function compactPreview(value:string){
  const compact=value.replace(/\s+/g," ").trim();
  return compact.length>PREVIEW_LIMIT?`${compact.slice(0,PREVIEW_LIMIT-1)}…`:compact;
}

function lastNonEmptyLine(value:string){
  let end=value.length;
  while(end>0){
    const start=value.lastIndexOf("\n",end-1)+1;
    const line=value.slice(start,end).trim();
    if(line)return line;
    if(start===0)return "";
    end=start-1;
  }
  return "";
}

function preview(task:DeckTask){
  if(task.result)return{value:compactPreview(task.result),source:"result" as const};
  if(task.error)return{value:compactPreview(task.error),source:"error" as const};
  const logLine=lastNonEmptyLine(task.log);
  if(logLine)return{value:compactPreview(logLine),source:"log" as const};
  return{value:compactPreview(task.prompt),source:"prompt" as const};
}

function listMetadata(metadata:Record<string,unknown>|undefined){
  if(!metadata)return undefined;
  const entries=LIST_METADATA_KEYS.flatMap(key=>Object.prototype.hasOwnProperty.call(metadata,key)?[[key,metadata[key]] as const]:[]);
  return entries.length?Object.fromEntries(entries):undefined;
}

export function projectTaskListItem(task:DeckTask){
  const summary=preview(task);
  return{
    id:task.id,
    provider:task.provider,
    nativeId:task.nativeId,
    threadId:task.threadId,
    projectId:task.projectId,
    title:task.title,
    status:task.status,
    createdAt:task.createdAt,
    updatedAt:task.updatedAt,
    owned:task.owned,
    ownership:task.ownership,
    source:task.source,
    jobId:task.jobId,
    cwd:task.cwd,
    requestedModel:task.requestedModel,
    effectiveModel:task.effectiveModel,
    requestedReasoningEffort:task.requestedReasoningEffort,
    effectiveReasoningEffort:task.effectiveReasoningEffort,
    requestedServiceTier:task.requestedServiceTier,
    effectiveServiceTier:task.effectiveServiceTier,
    permissionProfile:task.permissionProfile,
    settingsUpdatedAt:task.settingsUpdatedAt,
    executionHostId:task.executionHostId,
    workspaceId:task.workspaceId,
    workChainId:task.workChainId,
    sourceSessionId:task.sourceSessionId,
    metadata:listMetadata(task.metadata),
    preview:summary.value,
    previewSource:summary.source,
    listProjection:true as const
  };
}

export function projectTaskList(tasks:DeckTask[]){return tasks.map(projectTaskListItem);}
