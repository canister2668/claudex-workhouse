import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface UserInputOption { label:string; description:string; }
export interface UserInputQuestion { id:string; header:string; question:string; options:UserInputOption[]; isOther:boolean; isSecret:boolean; }
export interface PendingUserInput { id:string; taskId:string; provider:"codex"; threadId:string; turnId:string; itemId:string; questions:UserInputQuestion[]; requestedAt:string; expiresAt:string; }
export type UserInputAnswers=Record<string,{answers:string[]}>;

const CONTROL=/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const clean=(value:unknown,max:number)=>String(value??"").replace(CONTROL,"").slice(0,max);
const directory=(stateFile:string)=>`${stateFile}.user-input`;
const file=(stateFile:string,id:string,suffix:"pending"|"response")=>{if(!/^[0-9a-f-]{36}$/i.test(id))throw new Error("Invalid user input request ID.");return path.join(directory(stateFile),`${id}.${suffix}.json`);};
function writePrivate(target:string,value:unknown){fs.writeFileSync(target,`${JSON.stringify(value)}\n`,{encoding:"utf8",mode:0o600,flag:"wx"});}

export function userInputRecord(taskId:string,params:any):PendingUserInput{
  const questions=(Array.isArray(params?.questions)?params.questions:[]).slice(0,3).map((item:any,index:number)=>({
    id:clean(item?.id||`question_${index+1}`,80),header:clean(item?.header,80),question:clean(item?.question,1000),
    options:(Array.isArray(item?.options)?item.options:[]).slice(0,12).map((option:any)=>({label:clean(option?.label,120),description:clean(option?.description,500)})).filter((option:UserInputOption)=>option.label),
    isOther:Boolean(item?.isOther),isSecret:Boolean(item?.isSecret)
  })).filter((item:UserInputQuestion)=>item.id&&item.question);
  if(!questions.length)throw new Error("Provider user input request has no valid questions.");
  const requestedAt=new Date().toISOString();
  const requestedTimeout=Number(params?.autoResolutionMs);const ttl=Number.isFinite(requestedTimeout)&&requestedTimeout>=60_000?Math.min(requestedTimeout,15*60_000):15*60_000;
  return{id:crypto.randomUUID(),taskId,provider:"codex",threadId:clean(params?.threadId,200),turnId:clean(params?.turnId,200),itemId:clean(params?.itemId,200),questions,requestedAt,expiresAt:new Date(Date.now()+ttl).toISOString()};
}
export function persistUserInput(stateFile:string,item:PendingUserInput){const dir=directory(stateFile);fs.mkdirSync(dir,{recursive:true,mode:0o700});try{fs.chmodSync(dir,0o700);}catch{}writePrivate(file(stateFile,item.id,"pending"),item);}
export function listPendingUserInputs(stateFile:string):PendingUserInput[]{let names:string[]=[];try{names=fs.readdirSync(directory(stateFile));}catch{return[];}const result:PendingUserInput[]=[];for(const name of names.filter(value=>value.endsWith(".pending.json"))){try{const item=JSON.parse(fs.readFileSync(path.join(directory(stateFile),name),"utf8"));if(Date.parse(item.expiresAt)>Date.now())result.push(item);else fs.rmSync(path.join(directory(stateFile),name),{force:true});}catch{}}return result.sort((a,b)=>a.requestedAt.localeCompare(b.requestedAt));}
export function submitUserInput(stateFile:string,id:string,answers:UserInputAnswers){const pendingFile=file(stateFile,id,"pending");let pending:PendingUserInput;try{pending=JSON.parse(fs.readFileSync(pendingFile,"utf8"));}catch{throw Object.assign(new Error("User input request is no longer pending."),{statusCode:409});}if(Date.parse(pending.expiresAt)<=Date.now())throw Object.assign(new Error("User input request has expired."),{statusCode:409});const allowed=new Map(pending.questions.map(question=>[question.id,question]));const cleanAnswers:UserInputAnswers={};for(const [questionId,value] of Object.entries(answers)){const question=allowed.get(questionId);if(!question)throw Object.assign(new Error("Answer does not match this request."),{statusCode:400});const values=(Array.isArray(value?.answers)?value.answers:[]).slice(0,12).map(item=>clean(item,1000)).filter(Boolean);if(!values.length)throw Object.assign(new Error("Every question needs an answer."),{statusCode:400});cleanAnswers[questionId]={answers:values};}if(Object.keys(cleanAnswers).length!==pending.questions.length)throw Object.assign(new Error("Every question needs an answer."),{statusCode:400});try{writePrivate(file(stateFile,id,"response"),{id,answers:cleanAnswers,createdAt:new Date().toISOString()});}catch(error:any){if(error?.code==="EEXIST")throw Object.assign(new Error("User input request has already been answered."),{statusCode:409});throw error;}return pending;}
export async function waitForUserInput(stateFile:string,item:PendingUserInput,signal?:AbortSignal):Promise<UserInputAnswers>{const responseFile=file(stateFile,item.id,"response"),pendingFile=file(stateFile,item.id,"pending");try{while(Date.now()<Date.parse(item.expiresAt)){if(signal?.aborted)throw new Error("User input request was cancelled.");try{const response=JSON.parse(fs.readFileSync(responseFile,"utf8"));if(response?.answers)return response.answers;}catch{}await new Promise(resolve=>setTimeout(resolve,200));}throw Object.assign(new Error("User input request timed out."),{code:"USER_INPUT_TIMEOUT"});}finally{fs.rmSync(responseFile,{force:true});fs.rmSync(pendingFile,{force:true});}}
export function cleanupUserInputFiles(stateFile:string){fs.rmSync(directory(stateFile),{recursive:true,force:true});}
