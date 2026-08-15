import type {DeckDatabase} from "./db/client.js";
import type {DeckTask,ProviderId} from "./types.js";

export async function renameSessionTitle(db:DeckDatabase,provider:ProviderId,sessionId:string,title:string){
  const stored=await db.listProviderTasks(provider);
  let members=stored.filter(task=>task.threadId===sessionId);
  if(!members.length)members=stored.filter(task=>task.id===sessionId);
  const codexThread=provider==="codex"?await db.getCodexThread(sessionId):null;
  if(!members.length&&!codexThread)throw Object.assign(new Error("Session not found."),{statusCode:404});
  const tasks:DeckTask[]=await Promise.all(members.map(task=>db.upsertTask({...task,title,metadata:{...task.metadata,customTitle:title}})));
  const thread=codexThread?await db.upsertCodexThread({...codexThread,title,metadata:{...codexThread.metadata,customTitle:title}}):null;
  return{title,tasks,thread,anchor:tasks.find(task=>task.id===members[0]?.id)??members[0]};
}
