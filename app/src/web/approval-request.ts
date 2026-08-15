export type BrowserApprovalDecision="accept"|"acceptForSession"|"decline";

export function approvalDecisionRequest(task:{id:string;provider:"codex"|"claude"|"deepseek"|"ollama"|"antigravity"|"grok"},approvalId:string,decision:BrowserApprovalDecision,idempotencyKey:string){
  return{
    path:`/api/tasks/${task.provider}/${encodeURIComponent(task.id)}/approvals/${encodeURIComponent(approvalId)}`,
    options:{
      method:"POST",
      headers:{"Idempotency-Key":idempotencyKey},
      body:JSON.stringify({decision,confirmDetailView:true})
    } satisfies RequestInit
  };
}
