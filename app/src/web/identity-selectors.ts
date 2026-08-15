export type IdentifiedRecord={id:string;updatedAt?:string|null;lastSeenAt?:string|null;createdAt?:string|null};

function recordTime(value:IdentifiedRecord){
  for(const candidate of [value.updatedAt,value.lastSeenAt,value.createdAt]){
    const timestamp=Date.parse(candidate??"");
    if(Number.isFinite(timestamp))return timestamp;
  }
  return Number.NEGATIVE_INFINITY;
}

// Workspace identity is the registered ID. Paths and display names are
// attributes and must never collapse two independently registered workspaces.
export function mergeWorkspaceRecords<T extends IdentifiedRecord>(...sources:ReadonlyArray<readonly T[]>):T[]{
  const rows=new Map<string,T>();
  for(const source of sources)for(const item of source){
    if(!item?.id)continue;
    const current=rows.get(item.id);
    if(!current||recordTime(item)>=recordTime(current))rows.set(item.id,item);
  }
  return [...rows.values()];
}

export function assertUniqueKeys<T>(label:string,rows:readonly T[],keyFor:(row:T)=>unknown){
  const indexes=new Map<unknown,number>();
  for(let index=0;index<rows.length;index++){
    const key=keyFor(rows[index]);
    const previous=indexes.get(key);
    if(previous!==undefined)throw new Error(`${label}: duplicate key ${String(key)} at indexes ${previous} and ${index}`);
    indexes.set(key,index);
  }
}
