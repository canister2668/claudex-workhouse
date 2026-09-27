import crypto from "node:crypto";
import path from "node:path";
import { listPendingUserInputs, persistUserInput, userInputRecord, type PendingUserInput, type UserInputAnswers } from "./user-input-bridge.js";
import type { ProviderId } from "./types.js";

type Source={id:string;provider:ProviderId;threadId?:string|null};
const stateFile=(root:string,taskId:string)=>path.join(root,"data","async-user-input",crypto.createHash("sha256").update(taskId).digest("hex"));

export function persistAsyncUserInput(root:string,source:Source,item:{id:string;questions:unknown;turnId?:string;requestedAt?:string}):PendingUserInput{
  const request=userInputRecord(source.id,{questions:item.questions,threadId:source.threadId,turnId:item.turnId,itemId:item.id});
  // Replayed native items and retried MCP calls must refer to the same card.
  const hash=crypto.createHash("sha256").update(`${source.id}:${item.id}`).digest("hex");
  request.id=`${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-8${hash.slice(17,20)}-${hash.slice(20,32)}`;
  request.provider=source.provider;request.delivery="async";
  const timestamp=Date.parse(item.requestedAt??"");
  if(Number.isFinite(timestamp)){request.requestedAt=new Date(timestamp).toISOString();request.expiresAt=new Date(timestamp+15*60_000).toISOString();}
  const target=stateFile(root,source.id);
  try{persistUserInput(target,request);}catch(error:any){if(error?.code!=="EEXIST")throw error;}
  return listPendingUserInputs(target).find(row=>row.id===request.id)??request;
}

export function listAsyncUserInputs(root:string,taskId:string){return listPendingUserInputs(stateFile(root,taskId));}

export function asyncAnswerPrompt(request:PendingUserInput,answers:UserInputAnswers){
  if(Object.keys(answers).length!==request.questions.length||request.questions.some(q=>!Array.isArray(answers[q.id]?.answers)||!answers[q.id].answers.length||answers[q.id].answers.some(a=>typeof a!=="string"||!a.trim())))throw Object.assign(new Error("Every question needs a matching answer."),{statusCode:400});
  return request.questions.map(q=>`${q.question}\n${answers[q.id].answers.join("\n")}`).join("\n\n");
}
