import type {DeckTask} from "./types.js";

export const TASK_CONTINUATION_INSTRUCTIONS = "Treat a user's correction, objection, constraint, or status question during unfinished work as steering of the existing task. Preserve the original objective, apply the latest correction, and continue the authorized work and verification in the same turn. Acknowledging a mistake, explaining it, or promising to fix it is not task completion while authorized work remains. Answer status questions briefly, then continue. Do not require another 'continue' or 'fix it' message. Explicit cancellation, pause, replacement objectives, permission boundaries, and genuine blockers take precedence; do not infer approval or force continuation against them.";

export function queuedTaskContinuation(task:Pick<DeckTask,"prompt"|"metadata">,input:string){
  if(task.metadata?.runtimeProfile==="conversation")return{prompt:input,metadata:{}};
  const stored=task.metadata?.queuedTaskContinuation;
  const prior=stored&&typeof stored==="object"&&!Array.isArray(stored)?stored as Record<string,unknown>:null;
  // A direct follow-up starts a new objective. Only carry context from a
  // previous queued continuation when its raw input is still this task's prompt.
  const objective=prior?.latestInput===task.prompt&&typeof prior?.objective==="string"?prior.objective:task.prompt;
  if(typeof objective!=="string"||!objective.trim())return{prompt:input,metadata:{}};
  return{
    prompt:["# Workhouse task continuation",TASK_CONTINUATION_INSTRUCTIONS,"The following JSON preserves the prior request and the latest user input verbatim. The latest input takes precedence when it changes or cancels the task. Resume from the existing session history and inspect current state before acting; do not repeat already completed work.",JSON.stringify({originalTask:objective,latestUserInput:input})].join("\n\n"),
    metadata:{queuedTaskContinuation:{objective,latestInput:input}}
  };
}
