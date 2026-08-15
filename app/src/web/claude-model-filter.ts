export type ClaudeCatalogModel={id:string;displayName:string;description?:string;source?:"runtime"|"custom"};
export type ClaudeCatalogMeta={fetchedAt?:string;stale?:boolean;source?:string};

export function isClaudeCatalogFallback(meta:ClaudeCatalogMeta|null|undefined){
  return meta?.stale===true&&String(meta.source??"").startsWith("fallback:");
}

export function claudeSelectionTransitions(before:Record<string,string>,after:Record<string,string>){
  return Object.keys(before).flatMap(scope=>before[scope]&&after[scope]&&before[scope]!==after[scope]
    ?[{scope,from:before[scope],to:after[scope]}]
    :[]);
}
