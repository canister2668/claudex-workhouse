export function filterWorkspaceEntries<T extends {name:string;type:string}>(entries:readonly T[],search:string,locale="en"):T[] {
  const query=search.trim().toLocaleLowerCase();
  const filtered=query?entries.filter(entry=>entry.name.toLocaleLowerCase().includes(query)):[...entries];
  const collator=new Intl.Collator(locale,{numeric:true,sensitivity:"base"});
  const rank=(entry:T)=>entry.type==="directory"?0:entry.type==="file"?1:2;
  return [...filtered].sort((left,right)=>rank(left)-rank(right)||collator.compare(left.name,right.name));
}

export function workspaceFileDownloadHref(workspaceId:string,relativePath:string|null|undefined){
  const path=relativePath?.trim();
  if(!workspaceId||!path)return null;
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/files/download?${new URLSearchParams({path})}`;
}

export function workspaceFilePreviewHref(workspaceId:string,path:string,pathBase:"workspace"|"task-cwd",sourceTaskId?:string|null){
  const target=path.trim();
  if(!workspaceId||!target||pathBase==="task-cwd"&&!sourceTaskId)return null;
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/files/preview?${new URLSearchParams({path:target,pathBase,...(sourceTaskId?{sourceTaskId}:{})})}`;
}

export function taskImageOutputHref(taskId:string|null|undefined,mediaPath:string){
  const task=taskId?.trim(),target=mediaPath.trim();if(!task||!target)return null;
  return `/api/task-image-output?${new URLSearchParams({taskId:task,path:target})}`;
}

export type WorkspaceEditorSnapshot={content:string;revision:string;relativePath:string;lineEnding:"lf"|"crlf";hasUtf8Bom:boolean;endsWithNewline:boolean;modifiedAt:string;byteLength:number;fileId:string};
export type WorkspaceEditorDraft={base:WorkspaceEditorSnapshot;content:string};
const drafts=new Map<string,WorkspaceEditorDraft>();
const draftKey=(workspaceId:string,relativePath:string)=>`${workspaceId}:${relativePath}`;

export function rememberWorkspaceDraft(workspaceId:string,draft:WorkspaceEditorDraft){drafts.set(draftKey(workspaceId,draft.base.relativePath),structuredClone(draft));}
export function workspaceDraft(workspaceId:string,relativePath:string){const value=drafts.get(draftKey(workspaceId,relativePath));return value?structuredClone(value):null;}
export function forgetWorkspaceDraft(workspaceId:string,relativePath:string){drafts.delete(draftKey(workspaceId,relativePath));}

export function fileEventCanOpen(metadata:Record<string,unknown>|undefined){return typeof metadata?.path==="string"&&metadata.path.length>0&&(metadata.pathBase==="task-cwd"||metadata.pathBase==="workspace");}
export function fileEventEditTarget(metadata:Record<string,unknown>|undefined,sourceTaskId:string|null|undefined){
  if(!fileEventCanOpen(metadata))return null;
  const path=metadata!.path as string,pathBase=metadata!.pathBase as "workspace"|"task-cwd";
  if(pathBase==="task-cwd"&&!sourceTaskId)return null;
  return{path,pathBase,...(sourceTaskId?{sourceTaskId}:{}),initialEdit:true as const};
}

export function lineChangeCount(left:string,right:string){
  const a=left.split("\n"),b=right.split("\n"),length=Math.max(a.length,b.length);let changed=0;
  for(let index=0;index<length;index++)if(a[index]!==b[index])changed++;
  return changed;
}

export function workspaceLineDiff(left:string,right:string){
  if(left===right)return "";
  const a=left.split("\n"),b=right.split("\n"),rows=a.length,columns=b.length;
  if(rows*columns>250_000)return[...a.map(line=>`- ${line}`),...b.map(line=>`+ ${line}`)].slice(0,600).join("\n");
  const table=Array.from({length:rows+1},()=>new Uint32Array(columns+1));
  for(let row=rows-1;row>=0;row--)for(let column=columns-1;column>=0;column--){
    table[row]![column]=a[row]===b[column]?table[row+1]![column+1]!+1:Math.max(table[row+1]![column]!,table[row]![column+1]!);
  }
  const output:string[]=[];let row=0,column=0;
  while(row<rows&&column<columns){
    if(a[row]===b[column]){output.push(`  ${a[row]}`);row++;column++;}
    else if(table[row+1]![column]!>=table[row]![column+1]!)output.push(`- ${a[row++]}`);
    else output.push(`+ ${b[column++]}`);
  }
  while(row<rows)output.push(`- ${a[row++]}`);
  while(column<columns)output.push(`+ ${b[column++]}`);
  return output.slice(0,600).join("\n");
}
