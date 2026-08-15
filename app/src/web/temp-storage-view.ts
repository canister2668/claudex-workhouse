const count=(value:unknown)=>Number.isFinite(Number(value))?Math.max(0,Number(value)):0;

function contents(value:any,fallbackRoot:string){
  const source=value&&typeof value==="object"?value:{};
  return{
    ...source,
    root:typeof source.root==="string"?source.root:fallbackRoot,
    filesystem:{
      totalBytes:count(source.filesystem?.totalBytes),
      usedBytes:count(source.filesystem?.usedBytes),
      freeBytes:count(source.filesystem?.freeBytes)
    },
    serviceOwnedBytes:count(source.serviceOwnedBytes),
    deletableBytes:count(source.deletableBytes),
    protectedBytes:count(source.protectedBytes),
    entries:Array.isArray(source.entries)?source.entries:[],
    linkage:{
      bestEffort:true as const,
      scannedTaskCount:count(source.linkage?.scannedTaskCount),
      scannedEventBytes:count(source.linkage?.scannedEventBytes)
    }
  };
}

export function normalizeTempStorageOverview(value:unknown,fallbackRoot=""){
  if(!value||typeof value!=="object")return null;
  const source=value as any;
  if(Array.isArray(source.roots)){
    const roots=source.roots.flatMap((item:any,index:number)=>{
      if(!item||typeof item!=="object")return[];
      const root=typeof item.root==="string"?item.root:typeof item.overview?.root==="string"?item.overview.root:"";
      return[{
        ...item,
        id:typeof item.id==="string"?item.id:`runtime-${index}`,
        root,
        source:item.source==="workspace-runtime"?"workspace-runtime":item.source==="workspace-managed"?"workspace-managed":"workhouse",
        managedRoot:item.managedRoot!==false,
        workspaces:Array.isArray(item.workspaces)?item.workspaces:[],
        overview:contents(item.overview,root)
      }];
    });
    return{
      ...source,
      generatedAt:typeof source.generatedAt==="string"?source.generatedAt:new Date(0).toISOString(),
      serviceOwnedBytes:count(source.serviceOwnedBytes),
      deletableBytes:count(source.deletableBytes),
      protectedBytes:count(source.protectedBytes),
      roots
    };
  }
  if(Array.isArray(source.entries)){
    const root=typeof source.root==="string"?source.root:fallbackRoot,overview=contents(source,root);
    return{
      generatedAt:typeof source.generatedAt==="string"?source.generatedAt:new Date(0).toISOString(),
      serviceOwnedBytes:overview.serviceOwnedBytes,
      deletableBytes:overview.deletableBytes,
      protectedBytes:overview.protectedBytes,
      roots:[{id:"legacy-workhouse",root,source:"workhouse" as const,managedRoot:true,workspaces:[],overview}]
    };
  }
  return null;
}
