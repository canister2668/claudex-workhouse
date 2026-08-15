import type {ApprovalDecision,PendingApproval} from "./approval-bridge.js";
import type {DeckTask} from "./types.js";

type RemoteApprovalCommand=(hostId:string,command:"provider.approvals.list"|"provider.approval.respond",payload:Record<string,unknown>)=>Promise<unknown>;

export async function resolveTaskApproval(input:{
  task:DeckTask;
  approvalId:string;
  decision:ApprovalDecision;
  localHostId:string;
  workerBacked?:boolean;
  listLocal:(task:DeckTask)=>PendingApproval[];
  respondLocal:(task:DeckTask,approvalId:string,decision:ApprovalDecision)=>PendingApproval;
  requestRemote:RemoteApprovalCommand;
}){
  const {task,approvalId,decision,localHostId}=input,remote=input.workerBacked??Boolean(task.executionHostId&&task.executionHostId!==localHostId);
  const payload={taskId:task.hostTaskId??task.id,provider:task.provider,workspaceId:task.workspaceId};
  const listed=remote
    ? await input.requestRemote(task.executionHostId!,"provider.approvals.list",payload)
    : {approvals:input.listLocal(task)};
  const preview=(listed as {approvals?:PendingApproval[]})?.approvals?.find(item=>item?.id===approvalId);
  if(!preview)throw Object.assign(new Error("Approval request is no longer pending."),{statusCode:409});
  assertApprovalContext(preview,task,localHostId);
  const pending=remote
    ? (await input.requestRemote(task.executionHostId!,"provider.approval.respond",{...payload,approvalId,decision}) as {approval?:PendingApproval})?.approval
    : input.respondLocal(task,approvalId,decision);
  if(!pending)throw Object.assign(new Error("Worker did not confirm the approval decision."),{statusCode:502,code:"APPROVAL_RESPONSE_INVALID"});
  assertApprovalContext(pending,task,localHostId);
  return pending;
}

function assertApprovalContext(approval:PendingApproval,task:DeckTask,localHostId:string){
  if(approval.taskId!==task.id&&approval.taskId!==(task.hostTaskId??task.id))throw Object.assign(new Error("Approval does not belong to this task."),{statusCode:409});
  if((approval.hostId??localHostId)!==(task.executionHostId??localHostId)||approval.workspaceId!==(task.workspaceId??null))throw Object.assign(new Error("Approval execution context does not match the task."),{statusCode:409});
}
