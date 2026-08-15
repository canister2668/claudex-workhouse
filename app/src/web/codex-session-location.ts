type SessionLocation={
  threadId?:string|null;
  taskId?:string|null;
  ownership?:string|null;
  projectId?:string|null;
  cwd?:string|null;
  executionHostId?:string|null;
  workspaceId?:string|null;
  canMutate?:boolean;
  [key:string]:unknown;
};

type TaskLocation={
  id?:string|null;
  threadId?:string|null;
  projectId?:string|null;
  cwd?:string|null;
  executionHostId?:string|null;
  workspaceId?:string|null;
};

export function recoverCodexSessionLocation<T extends SessionLocation>(session:T,task:TaskLocation|null|undefined):T{
  if(session.canMutate||session.ownership!=="claudex-workhouse"||!session.threadId||!task)return session;
  const sameTask=Boolean(session.taskId&&task.id===session.taskId);
  const sameThread=Boolean(task.threadId&&task.threadId===session.threadId);
  if(!sameTask&&!sameThread)return session;
  const cwd=task.cwd??session.cwd??null,workspaceId=task.workspaceId??session.workspaceId??null;
  if(!cwd&&!workspaceId)return session;
  return{
    ...session,
    projectId:task.projectId??session.projectId??null,
    cwd,
    executionHostId:task.executionHostId??session.executionHostId??"local",
    workspaceId,
    canMutate:true
  };
}
