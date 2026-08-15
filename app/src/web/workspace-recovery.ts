import {mergeWorkspaceRecords,type IdentifiedRecord} from "./identity-selectors";

export async function resolveViewerWorkspace<T extends IdentifiedRecord>(
  workspaceId:string,
  current:readonly T[],
  reload:()=>Promise<readonly T[]>
){
  const cached=current.find(item=>item.id===workspaceId);
  if(cached)return{workspace:cached,catalog:[...current],reloaded:false};
  const catalog=mergeWorkspaceRecords(await reload());
  return{workspace:catalog.find(item=>item.id===workspaceId)??null,catalog,reloaded:true};
}
