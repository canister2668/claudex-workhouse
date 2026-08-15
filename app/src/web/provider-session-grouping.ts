type SessionTask = {
  id:string;
  provider:string;
  threadId?:string|null;
  providerSessionId?:string|null;
  owned?:boolean;
  ownership?:string|null;
  createdAt?:string|null;
  updatedAt:string;
};

function compareRecency(left:SessionTask,right:SessionTask){
  const leftOwned=left.owned||left.ownership==="claudex-workhouse",rightOwned=right.owned||right.ownership==="claudex-workhouse";
  if(leftOwned!==rightOwned)return leftOwned?1:-1;
  const created=(left.createdAt??left.updatedAt).localeCompare(right.createdAt??right.updatedAt);
  return created||left.updatedAt.localeCompare(right.updatedAt)||left.id.localeCompare(right.id);
}

export function latestThreadRows<T extends SessionTask>(rows:T[]):T[]{
  const latest=new Map<string,T>();
  for(const row of rows){
    const sessionId=row.provider==="claude"?row.providerSessionId??row.threadId:row.threadId;
    const key=sessionId?`${row.provider}:${sessionId}`:row.id,current=latest.get(key);
    if(!current||compareRecency(current,row)<0)latest.set(key,row);
  }
  return [...latest.values()];
}

export function latestThreadMember<T extends SessionTask>(rows:T[],current:T):T{
  const sessionId=current.provider==="claude"?current.providerSessionId??current.threadId:current.threadId;
  if(!sessionId)return current;
  return latestThreadRows(rows.filter(row=>row.provider===current.provider&&(row.provider==="claude"?row.providerSessionId??row.threadId:row.threadId)===sessionId))[0]??current;
}
