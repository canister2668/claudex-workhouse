import type {AgentEvent} from "./types.js";

export const MAX_PERSISTED_IMAGE_OUTPUTS=100;

export type PersistedImageOutput={
  itemId:string|null;
  turnId:string|null;
  threadId:string|null;
  itemType:"imageView"|"imageGeneration";
  mediaPath:string;
  mediaPathBase:"workspace"|"task-cwd"|"task-output";
  sourceTaskId:string|null;
  workspaceId:string|null;
  timestamp:string|null;
};

const stringValue=(value:unknown,max=500)=>typeof value==="string"&&value.trim()?value.trim().slice(0,max):null;
const safeRelativePath=(value:unknown)=>{
  const raw=stringValue(value,2000);
  if(!raw)return null;
  const normalized=raw.replaceAll("\\","/");
  if(normalized.startsWith("/")||/^[A-Za-z]:\//.test(normalized)||normalized.split("/").some(part=>part===".."))return null;
  return normalized;
};

export function normalizePersistedImageOutput(value:unknown):PersistedImageOutput|null{
  if(!value||typeof value!=="object"||Array.isArray(value))return null;
  const item=value as Record<string,unknown>,mediaPath=safeRelativePath(item.mediaPath);
  const mediaPathBase=item.mediaPathBase==="workspace"||item.mediaPathBase==="task-cwd"||item.mediaPathBase==="task-output"?item.mediaPathBase:null;
  const sourceTaskId=stringValue(item.sourceTaskId,200),workspaceId=stringValue(item.workspaceId,200);
  if(!mediaPath||!mediaPathBase||(mediaPathBase==="task-cwd"||mediaPathBase==="task-output")&&!sourceTaskId)return null;
  return{
    itemId:stringValue(item.itemId,200),turnId:stringValue(item.turnId,200),threadId:stringValue(item.threadId,200),
    itemType:item.itemType==="imageGeneration"?"imageGeneration":"imageView",
    mediaPath,mediaPathBase,sourceTaskId,workspaceId,timestamp:stringValue(item.timestamp,80)
  };
}

export function persistedImageOutputKey(output:PersistedImageOutput){
  const scope=output.turnId?`turn:${output.turnId}`:`task:${output.sourceTaskId??""}`;
  return`path:${scope}:${output.mediaPathBase}:${output.mediaPath}`;
}

export function mergePersistedImageOutputs(...values:unknown[]):PersistedImageOutput[]{
  const merged:PersistedImageOutput[]=[];
  for(const value of values)for(const raw of Array.isArray(value)?value:[]){
    const output=normalizePersistedImageOutput(raw);if(!output)continue;
    const pathKey=persistedImageOutputKey(output);
    const match=merged.findIndex(candidate=>persistedImageOutputKey(candidate)===pathKey||Boolean(output.itemId&&candidate.itemId===output.itemId&&candidate.threadId===output.threadId&&candidate.turnId===output.turnId));
    if(match>=0)merged[match]={...merged[match]!,...output};
    else merged.push(output);
  }
  return merged.slice(-MAX_PERSISTED_IMAGE_OUTPUTS);
}

export function persistedImageOutputsFromEvents(events:AgentEvent[],fallback:{sourceTaskId?:string|null;workspaceId?:string|null}={}):PersistedImageOutput[]{
  return mergePersistedImageOutputs(events.flatMap(event=>{
    if(event.metadata?.mediaKind!=="image")return[];
    const source=event as AgentEvent&{itemId?:string|null;turnId?:string|null;threadId?:string|null;taskId?:string|null};
    return[{itemId:source.itemId??event.metadata?.itemId??null,turnId:source.turnId??event.metadata?.turnId??null,threadId:source.threadId??event.metadata?.threadId??null,itemType:event.metadata?.itemType==="imageGeneration"?"imageGeneration":"imageView",mediaPath:event.metadata?.mediaPath,mediaPathBase:event.metadata?.mediaPathBase,sourceTaskId:event.metadata?.sourceTaskId??source.taskId??fallback.sourceTaskId??null,workspaceId:event.metadata?.mediaWorkspaceId??fallback.workspaceId??null,timestamp:event.timestamp??null}];
  }));
}

export function persistedImageOutputEvents(value:unknown,sourceTaskId?:string|null):AgentEvent[]{
  return mergePersistedImageOutputs(value).filter(output=>sourceTaskId===undefined||output.sourceTaskId===sourceTaskId).map(output=>({
    type:"tool_completed",content:output.itemType,provider:"codex",...(output.timestamp?{timestamp:output.timestamp}:{}),
    metadata:{itemType:output.itemType,itemId:output.itemId,turnId:output.turnId,threadId:output.threadId,mediaKind:"image",mediaPath:output.mediaPath,mediaPathBase:output.mediaPathBase,sourceTaskId:output.sourceTaskId,mediaWorkspaceId:output.workspaceId,durableImageOutput:true}
  }));
}
