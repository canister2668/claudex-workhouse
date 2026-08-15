export type NewRequestTarget={provider:"codex"|"claude"|null;hostId:string|null;workspaceId:string|null};

export function parseNewRequestTarget(search:string):NewRequestTarget|null{
  const params=new URLSearchParams(search);
  if(params.get("new")!=="1")return null;
  const provider=params.get("provider"),hostId=params.get("host"),workspaceId=params.get("workspace");
  return{
    provider:provider==="codex"||provider==="claude"?provider:null,
    hostId:hostId&&hostId.length<=100?hostId:null,
    workspaceId:workspaceId&&workspaceId.length<=100?workspaceId:null
  };
}

export function newRequestDeepLink(target:{provider:"codex"|"claude";hostId?:string|null;workspaceId?:string|null}){
  const params=new URLSearchParams({new:"1",provider:target.provider});
  if(target.hostId)params.set("host",target.hostId);
  if(target.workspaceId)params.set("workspace",target.workspaceId);
  return`/?${params.toString()}`;
}
