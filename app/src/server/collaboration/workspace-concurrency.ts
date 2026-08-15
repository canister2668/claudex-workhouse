/**
 * Claudex Workhouse orchestrates several provider sessions over one workspace on
 * purpose. A workspace lease therefore records who is working where; it is not a
 * mutex. Nothing here refuses execution: an already-active writer produces
 * observation metadata and a safety contract for the prompt, and only a real
 * patch/context conflict — detected by the agent at edit time — stops work.
 */
export type ConcurrentLeaseRecord={
  id?:string;
  workspaceId?:string;
  collaborationSessionId?:string;
  participantId?:string;
  ownerRunId?:string;
  mode?:string;
  acquiredAt?:string;
  expiresAt?:string;
};

export type ConcurrentLeaseSummary={leaseId:string;workspaceId:string;collaborationSessionId:string;ownerRunId:string;mode:"read"|"write";acquiredAt:string};

export type WorkspaceConcurrencyAdvisory={
  workspaceId:string;
  selfMode:"read"|"write";
  concurrentTotal:number;
  concurrentWriters:number;
  concurrentReaders:number;
  concurrent:ConcurrentLeaseSummary[];
};

const MAX_REPORTED=8;

function mode(value:unknown):"read"|"write"{return value==="write"?"write":"read";}

/**
 * Advisory only, and deliberately free of prompts, results, paths and file
 * contents: workspace/session/run identity and the start time are enough to tell
 * the user (and the agent) who else is in the workspace.
 */
export function workspaceConcurrencyAdvisory(input:{workspaceId:string;selfMode:string;concurrent:ConcurrentLeaseRecord[]|undefined|null}):WorkspaceConcurrencyAdvisory{
  const records=(Array.isArray(input.concurrent)?input.concurrent:[]).filter(item=>item&&typeof item==="object");
  const concurrent=records.slice(0,MAX_REPORTED).map(item=>({
    leaseId:String(item.id??""),
    workspaceId:String(item.workspaceId??input.workspaceId),
    collaborationSessionId:String(item.collaborationSessionId??""),
    ownerRunId:String(item.ownerRunId??""),
    mode:mode(item.mode),
    acquiredAt:String(item.acquiredAt??""),
  }));
  return{
    workspaceId:input.workspaceId,
    selfMode:mode(input.selfMode),
    concurrentTotal:records.length,
    concurrentWriters:records.filter(item=>mode(item.mode)==="write").length,
    concurrentReaders:records.filter(item=>mode(item.mode)!=="write").length,
    concurrent,
  };
}

export function hasConcurrentWriters(advisory:WorkspaceConcurrencyAdvisory){return advisory.concurrentWriters>0;}

const BASE_CONTRACT=[
  "# Claudex Workhouse shared-workspace write contract",
  "- Other Claudex Workhouse sessions may be editing this workspace at the same time. That is expected and is not a reason to stop.",
  "- Re-check the current files and `git status` before you start, and treat every pre-existing uncommitted change as owned by another session or by the user.",
  "- Re-read a file immediately before you modify it, and edit through uniquely matched patches or equivalent compare-and-set edits rather than whole-file rewrites.",
  "- If the patch context no longer matches, or the region you meant to change has already changed, stop that edit instead of forcing it. Re-read, then re-apply safely if it is still correct.",
  "- Never run `git reset`, `git checkout -- <path>`, `git clean`, `git stash`, or any other command that discards work you did not create, and never overwrite unrelated changes to make your own edit apply.",
  "- Stop and report only on a real conflict in the same region: name the file, the region, and the other task/session involved. Do not stop merely because another writer exists.",
].join("\n");

function participantLine(item:ConcurrentLeaseSummary){
  return `  - ${item.mode} lease ${item.leaseId||"unknown"} (collaboration ${item.collaborationSessionId||"unknown"}, run ${item.ownerRunId||"unknown"}, started ${item.acquiredAt||"unknown"})`;
}

/** Prompt contract for a write-mode participant. The concurrency observation is
 * appended only when other sessions really are active. */
export function parallelWriteContract(advisory:WorkspaceConcurrencyAdvisory){
  if(advisory.selfMode!=="write")return"";
  if(!advisory.concurrentTotal)return BASE_CONTRACT;
  return[BASE_CONTRACT,
    `- Currently active alongside you in workspace ${advisory.workspaceId}: ${advisory.concurrentWriters} writer(s), ${advisory.concurrentReaders} reader(s).`,
    ...advisory.concurrent.map(participantLine)].join("\n");
}

export function concurrencyAuditDetail(advisory:WorkspaceConcurrencyAdvisory){
  return`workspace=${advisory.workspaceId};mode=${advisory.selfMode};concurrentWriters=${advisory.concurrentWriters};concurrentReaders=${advisory.concurrentReaders};leases=${advisory.concurrent.map(item=>`${item.mode}:${item.collaborationSessionId}:${item.ownerRunId}`).join(",")||"none"}`;
}
