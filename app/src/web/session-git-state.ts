export type GitWorkspaceRecord={
  id:string;
  displayName?:string|null;
  hostId?:string|null;
  canonicalPath?:string|null;
  lastGitStatus?:Record<string,unknown>|null;
  lastVerifiedAt?:string|null;
};

export type GitSessionRecord={
  provider?:string|null;
  workspaceId?:string|null;
  executionHostId?:string|null;
  cwd?:string|null;
  metadata?:Record<string,unknown>|null;
};

export type SessionGitSummary={
  repository:true;
  dirty:boolean;
  changedCount:number|null;
  ahead:number;
  behind:number;
  branch:string|null;
  commit:string|null;
  workspaceCount:number;
  verifiedAt:string|null;
  scope:"workspace";
};

export type SessionGitAttribution={
  files:string[];
  count:number;
  uncommittedFiles:string[];
  uncommittedCount:number;
  capturedAt:string|null;
  commitAtCapture:string|null;
  confidence:"observed";
};

const finiteCount=(value:unknown)=>Number.isFinite(Number(value))?Math.max(0,Math.trunc(Number(value))):0;
const text=(value:unknown)=>typeof value==="string"&&value.trim()?value.trim():null;

function matchingWorkspace(session:GitSessionRecord,workspaces:GitWorkspaceRecord[]){
  if(session.workspaceId){
    const exact=workspaces.find(item=>item.id===session.workspaceId);
    if(exact)return exact;
  }
  if(!session.cwd)return null;
  const cwd=session.cwd.replace(/[\\/]+$/,"");
  return workspaces.find(item=>(!session.executionHostId||!item.hostId||item.hostId===session.executionHostId)&&item.canonicalPath?.replace(/[\\/]+$/,"")===cwd)??null;
}

const normalizedGitPath=(value:unknown)=>typeof value==="string"?value.trim().replace(/\\/g,"/").replace(/^\.\//,"").replace(/\/{2,}/g,"/"):"";
const untrackedArtifactPaths=(status:Record<string,unknown>)=>new Set((Array.isArray(status.changes)?status.changes:[]).flatMap(change=>{
  if(!change||typeof change!=="object"||Array.isArray(change)||(change as Record<string,unknown>).untracked!==true)return[];
  const path=normalizedGitPath((change as Record<string,unknown>).path);
  return path.startsWith("artifacts/")?[path]:[];
}));
function currentChangedFiles(workspace:GitWorkspaceRecord|null){
  const status=workspace?.lastGitStatus,changed=status?.changedFiles;
  if(!status||!Array.isArray(changed))return null;
  // Generated previews and release bundles remain visible in the dedicated Git
  // panel, but an untracked artifacts/ file is not a safe default commit target.
  // Keep tracked/staged artifact files visible because those are intentional
  // repository changes rather than incidental session output.
  const hidden=untrackedArtifactPaths(status);
  return new Set(changed.map(normalizedGitPath).filter(path=>path&&!hidden.has(path)));
}

export function sessionGitAttribution(session:GitSessionRecord,workspaces:GitWorkspaceRecord[]):SessionGitAttribution|null{
  const workspace=matchingWorkspace(session,workspaces),dirty=currentChangedFiles(workspace),stored=session.metadata?.gitAttribution;
  if(!stored||typeof stored!=="object"||Array.isArray(stored))return null;
  const record=stored as Record<string,unknown>,observed=Array.isArray(record.observedFiles)?record.observedFiles:[];
  const files=[...new Set(observed.map(normalizedGitPath).filter(Boolean))].sort();
  if(!files.length)return null;
  const uncommittedFiles=dirty?files.filter(file=>dirty.has(file)):[];
  return{files,count:files.length,uncommittedFiles,uncommittedCount:uncommittedFiles.length,capturedAt:text(record.capturedAt),commitAtCapture:text(record.commitAtCapture),confidence:"observed"};
}

export function combinedSessionGitAttribution(sessions:GitSessionRecord[],workspaces:GitWorkspaceRecord[]):SessionGitAttribution|null{
  const attributions=sessions.map(session=>sessionGitAttribution(session,workspaces)).filter((item):item is SessionGitAttribution=>Boolean(item));
  const files=[...new Set(attributions.flatMap(item=>item.files))].sort();
  if(!files.length)return null;
  const uncommittedFiles=[...new Set(attributions.flatMap(item=>item.uncommittedFiles))].sort();
  return{files,count:files.length,uncommittedFiles,uncommittedCount:uncommittedFiles.length,capturedAt:attributions.map(item=>item.capturedAt).filter((value):value is string=>Boolean(value)).sort().at(-1)??null,commitAtCapture:null,confidence:"observed"};
}

export function workspaceGitOverview(sessions:GitSessionRecord[],workspaces:GitWorkspaceRecord[]){
  const matched=[...new Map(sessions.map(session=>matchingWorkspace(session,workspaces)).filter((item):item is GitWorkspaceRecord=>Boolean(item)).map(item=>[item.id,item])).values()];
  return matched.flatMap(workspace=>{
    const summary=summarizeGitWorkspaces([workspace]);
    const current=currentChangedFiles(workspace),linked=sessions.filter(session=>matchingWorkspace(session,workspaces)?.id===workspace.id),attributed=new Set(linked.flatMap(session=>sessionGitAttribution(session,workspaces)?.uncommittedFiles??[])),providerFiles=new Map<string,Set<string>>();
    for(const session of linked){const provider=text(session.provider),files=sessionGitAttribution(session,workspaces)?.uncommittedFiles??[];if(!provider||!files.length)continue;const set=providerFiles.get(provider)??new Set<string>();for(const file of files)set.add(file);providerFiles.set(provider,set);}
    const unattributedFiles=current?[...current].filter(file=>!attributed.has(file)).sort():null;
    const providerAttributions=[...providerFiles].map(([provider,files])=>({provider,files:[...files].sort(),count:files.size}));
    return summary&&(summary.dirty||summary.ahead>0)?[{workspace,summary,providerAttributions,unattributedFiles,unattributedCount:unattributedFiles?.length??null}]:[];
  });
}

export function summarizeGitWorkspaces(workspaces:Array<GitWorkspaceRecord|null|undefined>):SessionGitSummary|null{
  const unique=[...new Map(workspaces.filter((item):item is GitWorkspaceRecord=>Boolean(item)).map(item=>[item.id,item])).values()];
  const repositories=unique.filter(item=>item.lastGitStatus?.repository===true);
  if(!repositories.length)return null;
  let dirty=false,changedCount=0,changedCountKnown=true,ahead=0,behind=0;
  for(const workspace of repositories){
    const status=workspace.lastGitStatus??{},changed=currentChangedFiles(workspace);
    const rawChangedKnown=Array.isArray(status.changedFiles),workspaceDirty=changed?changed.size>0:status.dirty===true;
    dirty=dirty||workspaceDirty;
    if(workspaceDirty&&changed)changedCount+=changed.size;
    else if(workspaceDirty||status.dirty===true&&!rawChangedKnown)changedCountKnown=false;
    ahead+=finiteCount(status.ahead);
    behind+=finiteCount(status.behind);
  }
  const first=repositories[0],status=first.lastGitStatus??{};
  return{
    repository:true,
    dirty,
    changedCount:dirty&&changedCountKnown?changedCount:null,
    ahead,
    behind,
    branch:repositories.length===1?text(status.branch):null,
    commit:repositories.length===1?text(status.commit):null,
    workspaceCount:repositories.length,
    verifiedAt:repositories.map(item=>item.lastVerifiedAt).filter((value):value is string=>Boolean(value)).sort().at(-1)??null,
    scope:"workspace"
  };
}

export function sessionGitSummary(session:GitSessionRecord,workspaces:GitWorkspaceRecord[]){
  return summarizeGitWorkspaces([matchingWorkspace(session,workspaces)]);
}

export function collaborationGitSummary(collaborationId:string,tasks:GitSessionRecord[],workspaces:GitWorkspaceRecord[]){
  const linked=tasks.filter(task=>task.metadata?.collaborationSessionId===collaborationId);
  return summarizeGitWorkspaces(linked.map(task=>matchingWorkspace(task,workspaces)));
}
