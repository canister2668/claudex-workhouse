type CollaborationLike={id:string;title:string;status:string;updatedAt:string;metadata?:Record<string,unknown>};

export type ManagedConversationDocument={
  collaborationId:string;
  title:string;
  status:string;
  updatedAt:string;
  workspaceId:string;
  relativePath:string;
  revision:string;
};

export function managedConversationDocuments(sessions:CollaborationLike[]):ManagedConversationDocument[]{
  const documents:ManagedConversationDocument[]=[];
  for(const session of sessions){
    const value=session.metadata?.conclusionMarkdown;
    if(!value||typeof value!=="object")continue;
    const file=value as Record<string,unknown>;
    if(typeof file.workspaceId!=="string"||!file.workspaceId||typeof file.relativePath!=="string"||!file.relativePath||typeof file.revision!=="string"||!/^[a-f0-9]{64}$/.test(file.revision))continue;
    documents.push({collaborationId:session.id,title:session.title,status:session.status,updatedAt:session.updatedAt,workspaceId:file.workspaceId,relativePath:file.relativePath,revision:file.revision});
  }
  return documents.sort((left,right)=>right.updatedAt.localeCompare(left.updatedAt));
}
