// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Claudex Workhouse.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const token=process.env.CLAUDEX_PARTICIPANT_TOKEN;
const origin=process.env.CLAUDEX_PARTICIPANT_ORIGIN??"http://127.0.0.1:3410";
if(!token||!/^whp_[A-Za-z0-9_-]{43}$/.test(token))throw new Error("A valid CLAUDEX_PARTICIPANT_TOKEN is required.");
const endpoint=new URL(origin);
if(endpoint.protocol!=="http:"||!["127.0.0.1","localhost","[::1]"].includes(endpoint.hostname)||endpoint.username||endpoint.password||endpoint.pathname!=="/")throw new Error("The participant endpoint must be a loopback HTTP origin.");

const server=new McpServer({name:"claudex-workhouse-participant",version:"1.0.0"});
async function call(method:"GET"|"POST"|"PUT",resource:string,body?:unknown){
  const response=await fetch(new URL(`/external-participants/v1/${resource}`,endpoint),{method,headers:{authorization:`Bearer ${token}`,...(body?{"content-type":"application/json"}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30_000)});
  const value=await response.json().catch(()=>({error:"Invalid server response."}));
  if(!response.ok)throw new Error(`Workhouse rejected the request (${response.status}): ${String((value as any)?.message??(value as any)?.error??"unknown error").slice(0,300)}`);
  return value;
}
const result=(value:unknown)=>({content:[{type:"text" as const,text:JSON.stringify(value)}]});
const pathSchema=z.string().min(1).max(512);

server.tool("get_capabilities","Read the participant's workspace and optional provider execution permission. File grants alone never allow provider tasks.",{}, {readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},async()=>result(await call("GET","capabilities")));
server.tool("create_task","Submit user-requested implementation or review to the owner's configured provider in the execution-granted workspace. Reuse the UUID idempotency key on retries. Never replace an unresolved submission with a new key. Provider, model and access are controlled by the owner, not by this call.",{prompt:z.string().trim().min(1).max(50_000),title:z.string().trim().min(1).max(100).optional(),idempotencyKey:z.string().uuid()},{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:true},async input=>result(await call("POST","tasks",input)));
server.tool("list_tasks","List at most 50 recent provider tasks created by this participant grant. Use after uncertain submission; this does not start or poll providers.",{}, {readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},async()=>result(await call("GET","tasks")));
server.tool("get_task","Refresh one participant-owned task and read its status and bounded result. A running task is unfinished; do not create a replacement.",{taskId:z.string().min(3).max(200).regex(/^[a-zA-Z0-9:._-]+$/)},{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},async({taskId})=>result(await call("GET",`tasks/${encodeURIComponent(taskId)}`)));
server.tool("resume_task","Send user-requested follow-up work in a confirmed terminal participant-owned provider thread. Reuse the UUID idempotency key on retries. Cannot control unrelated tasks, change workspace or increase access.",{taskId:z.string().min(3).max(200).regex(/^[a-zA-Z0-9:._-]+$/),prompt:z.string().trim().min(1).max(50_000),idempotencyKey:z.string().uuid()},{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:true},async({taskId,...body})=>result(await call("POST",`tasks/${encodeURIComponent(taskId)}/messages`,body)));

server.tool("list_assignments","List Workhouse collaboration-board assignments in the workspace granted to this participant.",{}, {readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},async()=>result(await call("GET","assignments")));
server.tool("list_files","List up to 100 immediate children of an allowed collaboration folder directory. Start with directory '.' to discover mounted folders. No recursive scan or polling occurs.",{directory:pathSchema},{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},async({directory})=>result(await call("GET",`files?directory=${encodeURIComponent(directory)}`)));
server.tool("read_file","Read a UTF-8 file under an allowed collaboration folder mount. The result includes a revision needed for safe editing.",{path:pathSchema},{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},async({path})=>result(await call("GET",`file?path=${encodeURIComponent(path)}`)));
server.tool("write_file","Replace an existing permitted text file only if its revision still matches the value returned by read_file. Never overwrite a concurrent edit.",{path:pathSchema,content:z.string(),expectedRevision:z.string().regex(/^[a-f0-9]{64}$/)},{readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:false},async input=>result(await call("PUT","file",input)));
server.tool("create_file","Create a new Markdown or HTML file in a permitted directory. Existing files are never overwritten.",{path:pathSchema,content:z.string()},{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false},async input=>result(await call("POST","file",input)));
server.tool("submit_report","Attach a note, review, or handoff to a Workhouse assignment. Reuse the same idempotency key on retries.",{assignmentId:z.string().uuid(),kind:z.enum(["note","review","handoff"]),content:z.string().min(1).max(10_000),idempotencyKey:z.string().uuid()},{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false},async({assignmentId,...body})=>result(await call("POST",`assignments/${assignmentId}/report`,body)));

await server.connect(new StdioServerTransport());
