// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Claudex Workhouse.

import crypto from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { DeckDatabase } from "./db/client.js";
import type { DeckTask } from "./types.js";
import { sanitizeSensitiveText } from "./sensitive-data.js";

// Execution authorizes the primary workspace, independently of file mounts.
// Old grants default to null and cannot start or inspect provider work.
export const executionGrantSchema=z.object({
  provider:z.enum(["codex","claude"]),
  automationLevel:z.enum(["auto","read"]).default("auto"),
  maxActiveTasks:z.number().int().min(1).max(4).default(1)
}).strict();
export type ExecutionGrant=z.infer<typeof executionGrantSchema>;
type TaskGrant={id:string;workspaceId:string;execution:ExecutionGrant|null};
export type ExternalParticipantExecutor={
  create(input:{workspaceId:string;prompt:string;title?:string;nativeId:string;execution:ExecutionGrant}):Promise<DeckTask>;
  refresh(task:DeckTask):Promise<DeckTask>;
  resume(task:DeckTask,prompt:string):Promise<DeckTask>;
};
const error=(message:string,statusCode:number,code:string)=>Object.assign(new Error(message),{statusCode,code});
const terminal=(task:DeckTask)=>["completed","failed","stopped"].includes(task.status);
const taskIdSchema=z.string().min(3).max(200).regex(/^[a-zA-Z0-9:._-]+$/);
const promptSchema=z.string().trim().min(1).max(50_000);
const createSchema=z.object({prompt:promptSchema,title:z.string().trim().min(1).max(100).optional(),idempotencyKey:z.string().uuid()}).strict();
const resumeSchema=z.object({prompt:promptSchema,idempotencyKey:z.string().uuid()}).strict();
const safeText=(value:string|null)=>value===null?null:sanitizeSensitiveText(value).slice(0,60_000);
const snapshot=(task:DeckTask)=>({
  taskId:task.id,threadId:task.providerSessionId??task.threadId,provider:task.provider,
  workspaceId:task.workspaceId,status:task.status,title:task.title,
  model:task.effectiveModel??task.requestedModel??null,
  createdAt:task.createdAt,updatedAt:task.updatedAt,
  result:safeText(task.result),error:safeText(task.error),
  terminal:terminal(task),resultTruncated:Boolean(task.result&&task.result.length>60_000)
});

export function registerExternalParticipantTaskRoutes(app:FastifyInstance,input:{
  db:DeckDatabase;requireGrant(request:FastifyRequest):Promise<TaskGrant>;executor?:ExternalParticipantExecutor
}){
  const {db,executor}=input,ownerToken=crypto.randomUUID();
  const locks=new Map<string,Promise<unknown>>();
  const authorize=async(request:FastifyRequest)=>{
    const grant=await input.requireGrant(request);
    if(!grant.execution)throw error("This grant does not allow task execution.",403,"EXTERNAL_EXECUTION_DENIED");
    if(!executor)throw error("Task execution is unavailable.",503,"EXTERNAL_EXECUTION_UNAVAILABLE");
    return grant as TaskGrant&{execution:ExecutionGrant};
  };
  const owns=(task:DeckTask,grant:TaskGrant)=>task.owned&&task.ownership==="claudex-workhouse"&&task.source==="claudex-workhouse"&&task.workspaceId===grant.workspaceId&&task.executionHostId==="local"&&task.provider===grant.execution?.provider&&task.metadata?.externalParticipantGrantId===grant.id;
  const ownedTask=async(id:string,grant:TaskGrant)=>{
    const task=await db.getTask(id);
    if(!task||!owns(task,grant))throw error("Task is outside this participant grant.",404,"EXTERNAL_TASK_NOT_FOUND");
    return task;
  };
  const audit=async(grant:TaskGrant,action:string,task:DeckTask)=>{
    await db.appendAudit({createdAt:new Date().toISOString(),actor:`external-participant:${grant.id}`,action,provider:task.provider,taskId:task.id,projectId:task.projectId,workspaceId:grant.workspaceId,outcome:"success",detail:`status=${task.status}`});
  };
  const exclusive=async<T>(grant:TaskGrant,run:()=>Promise<T>)=>{
    const previous=locks.get(grant.id)??Promise.resolve();
    const next=previous.catch(()=>{}).then(run);locks.set(grant.id,next);
    try{return await next;}finally{if(locks.get(grant.id)===next)locks.delete(grant.id);}
  };
  const capacity=async(grant:TaskGrant&{execution:ExecutionGrant})=>{
    let active=0;
    for(const candidate of await db.listTasks())if(owns(candidate,grant)&&!terminal(candidate)){
      const task=await executor!.refresh(candidate);
      if(!owns(task,grant))throw error("Task identity changed.",409,"EXTERNAL_TASK_SCOPE_CHANGED");
      if(!terminal(task))active++;
    }
    if(active>=grant.execution.maxActiveTasks)throw error("Participant active-task limit reached. Check existing tasks before submitting more work.",409,"EXTERNAL_TASK_LIMIT");
  };
  const idempotent=async(grant:TaskGrant,operation:string,key:string,body:unknown,run:()=>Promise<DeckTask>)=>{
    const action=`external-task:${grant.id}:${operation}`,requestHash=crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex"),now=new Date().toISOString();
    // An uncertain dispatch must never be taken over and automatically repeated.
    const claim=await db.claimIdempotency({key,action,requestHash,ownerToken,now,staleBefore:"1970-01-01T00:00:00.000Z",pruneBefore:"1970-01-01T00:00:00.000Z"});
    if(!claim.claimed){
      if(claim.requestHash!==requestHash)throw error("Idempotency key belongs to a different request.",409,"EXTERNAL_TASK_KEY_CONFLICT");
      const recorded=claim.response as {taskId?:string;error?:string;statusCode?:number;code?:string}|null;
      if(claim.state==="completed"&&recorded?.taskId){
        const task=await executor!.refresh(await ownedTask(recorded.taskId,grant));
        if(!owns(task,grant))throw error("Task identity changed.",409,"EXTERNAL_TASK_SCOPE_CHANGED");
        return{task:snapshot(task),replayed:true};
      }
      if(claim.state==="failed")throw error(recorded?.error??"The original task request failed; it was not repeated.",recorded?.statusCode??500,recorded?.code??"EXTERNAL_TASK_FAILED");
      throw error("Task submission is unresolved; inspect list_tasks. Do not submit a replacement.",409,"EXTERNAL_TASK_PENDING");
    }
    let dispatched:DeckTask|undefined;
    try{
      dispatched=await run();
      if(!owns(dispatched,grant))throw error("Task identity changed.",409,"EXTERNAL_TASK_SCOPE_CHANGED");
      const saved=await db.finishIdempotency({key,action,ownerToken,state:"completed",response:{taskId:dispatched.id},now:new Date().toISOString()});
      if(!saved)throw error("Task started but its request receipt is unresolved. Inspect list_tasks before retrying.",503,"EXTERNAL_TASK_PENDING");
      return{task:snapshot(dispatched),replayed:false};
    }catch(caught){
      // Leave dispatch uncertainty pending; never claim a retry is safe.
      if(!dispatched)await db.finishIdempotency({key,action,ownerToken,state:"failed",response:{error:sanitizeSensitiveText(caught instanceof Error?caught.message:String(caught)),statusCode:Number((caught as any)?.statusCode)||500,code:(caught as any)?.code??"EXTERNAL_TASK_FAILED"},now:new Date().toISOString()}).catch(()=>{});
      throw caught;
    }
  };
  app.get("/external-participants/v1/capabilities",async request=>{
    const grant=await input.requireGrant(request);
    return{workspaceId:grant.workspaceId,execution:grant.execution&&executor?grant.execution:null};
  });
  app.get("/external-participants/v1/tasks",{config:{rateLimit:{max:30,timeWindow:"1 minute"}}},async request=>{
    const grant=await authorize(request),tasks=(await db.listTasks()).filter(task=>owns(task,grant)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,50);
    return{tasks:tasks.map(snapshot)};
  });
  app.get("/external-participants/v1/tasks/:taskId",{config:{rateLimit:{max:60,timeWindow:"1 minute"}}},async request=>{
    const grant=await authorize(request),{taskId}=z.object({taskId:taskIdSchema}).parse(request.params),task=await executor!.refresh(await ownedTask(taskId,grant));
    if(!owns(task,grant))throw error("Task identity changed.",409,"EXTERNAL_TASK_SCOPE_CHANGED");
    return{task:snapshot(task)};
  });
  app.post("/external-participants/v1/tasks",{config:{rateLimit:{max:10,timeWindow:"1 minute"}}},async request=>{
    const grant=await authorize(request),body=createSchema.parse(request.body);
    return exclusive(grant,async()=>{await authorize(request);return idempotent(grant,"create",body.idempotencyKey,body,async()=>{
      await capacity(grant);
      const hex=crypto.createHash("sha256").update(`${grant.id}:${body.idempotencyKey}`).digest("hex").slice(0,32);
      const nativeId=`${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20)}`;
      const created=await executor!.create({workspaceId:grant.workspaceId,prompt:body.prompt,title:body.title,nativeId,execution:grant.execution});
      const task=await db.upsertTask({...created,metadata:{...created.metadata,externalParticipantGrantId:grant.id,externalParticipantRequestId:body.idempotencyKey}});
      await audit(grant,"external-participant-task-create",task);return task;
    });});
  });
  app.post("/external-participants/v1/tasks/:taskId/messages",{config:{rateLimit:{max:10,timeWindow:"1 minute"}}},async request=>{
    const grant=await authorize(request),{taskId}=z.object({taskId:taskIdSchema}).parse(request.params),body=resumeSchema.parse(request.body);
    await ownedTask(taskId,grant);
    return exclusive(grant,async()=>{await authorize(request);return idempotent(grant,`resume:${taskId}`,body.idempotencyKey,body,async()=>{
      const source=await executor!.refresh(await ownedTask(taskId,grant));
      if(!owns(source,grant))throw error("Task identity changed.",409,"EXTERNAL_TASK_SCOPE_CHANGED");
      if(!terminal(source)||!source.threadId)throw error("A confirmed terminal task with a provider thread is required for follow-up.",409,"EXTERNAL_TASK_NOT_READY");
      if(source.metadata?.automationLevel!==grant.execution.automationLevel)throw error("Task permission changed; follow-up is disabled.",409,"EXTERNAL_TASK_PERMISSION_CHANGED");
      await capacity(grant);
      const resumed=await executor!.resume(source,body.prompt);
      const task=await db.upsertTask({...resumed,metadata:{...resumed.metadata,externalParticipantGrantId:grant.id,externalParticipantRequestId:body.idempotencyKey}});
      await audit(grant,"external-participant-task-resume",task);return task;
    });});
  });
}
