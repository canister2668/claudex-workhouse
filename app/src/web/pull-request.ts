import{taskOutcomeSummary}from"./task-outcome";

const clean=(value:unknown,max:number)=>String(value??"").replace(/\s+/g," ").trim().slice(0,max);

export function pullRequestDraft(task:any,events:any[]){
  const summary=taskOutcomeSummary(task,events),title=clean(task?.title||summary.headline,120)||"Claudex Workhouse changes";
  const files=summary.files.length?summary.files.map(file=>`- \`${file}\``).join("\n"):"- No changed files were detected in the task event stream.";
  const checks=summary.checks.length?summary.checks.map(check=>`- ${check.status==="passed"?"[x]":check.status==="failed"?"[ ]":"[ ]"} \`${check.command}\` (${check.status})`).join("\n"):"- No test commands were detected in the task event stream.";
  return{title,body:`## Summary\n\n${summary.headline}\n\n## Changed files\n\n${files}\n\n## Verification\n\n${checks}\n\n---\nGenerated from Claudex Workhouse task \`${clean(task?.id,200)}\`.`.slice(0,65_536)};
}
