import type { AgentEventKind } from "./types.js";
import { DEFAULT_DELEGATION_SETTINGS, delegationDeveloperInstructions, normalizeDelegationSettings } from "./delegation-settings.js";

export const CLAUDEX_WORKHOUSE_NATIVE_COLLABORATION_INSTRUCTIONS = `# Claudex Workhouse native collaboration

Claudex Workhouse targets behavioral parity with the VS Code Codex client.

- Provider identity has priority over generic agent wording. When the user explicitly names Claude Code, Claude, 클로드, or 클코드 as the executor or reviewer, use the requested Claude Code runtime and do not substitute Codex subagents. If that runtime is unavailable, report that limitation instead of silently changing providers.
- Interpret only provider-neutral ordinary requests for "agents", "parallel agents", "병렬", or "에이전트" as native Codex multi-agent collaboration within the current parent thread.
- Phrases such as "Claude Code에게 요청", "클코드에게 검토", or an equivalent named-provider command are not ordinary delegation and must remain provider-specific even if the request also mentions agents or parallel review.
- Use the native collaboration/subagent tools. Do not run /usr/local/bin/cx, cx new, cx resume, or create detached Codex sessions for ordinary delegation.
- Use cx only when the user explicitly requests a separate session, background Codex job, or independently managed thread.
- After spawning native subagents, wait for every requested agent to reach a terminal state, collect their reports, reconcile conflicts, and synthesize one parent-thread result before finishing the turn.
- Before the first blocking wait, send one concise parent-thread commentary update describing the delegated work. Use later commentary only for meaningful milestones; routine heartbeat status belongs to the client UI. Never relay raw subagent output as a parent response.
- Do not finish merely by reporting agent IDs or that agents are still running. The parent owns final verification and integration unless the user explicitly asks for fire-and-forget background work.

# Workspace patch fallback

- A failed apply_patch invocation is not evidence that broader permissions are required. Classify command-not-found, sandbox/bootstrap or namespace failure, invalid patch, file conflict, permission denial, and workspace-boundary violations separately.
- For an exact, verifiable Workspace-local edit, retry without permission expansion by using Python to replace a uniquely matched byte/text sequence through a private same-directory temporary file and os.replace(), then inspect the diff. A simple sed replacement is acceptable only when the match is unambiguous.
- Never retry a failed patch in danger-full-access and never request full access merely to run apply_patch. If the safe fallback fails, preserve the input and report the classified error.`;

export function claudexWorkhouseCollaborationInstructions(value:unknown=DEFAULT_DELEGATION_SETTINGS){
  return `${CLAUDEX_WORKHOUSE_NATIVE_COLLABORATION_INSTRUCTIONS}\n\n${delegationDeveloperInstructions(normalizeDelegationSettings(value),"codex")}`;
}

export function turnLifecycleEvent(rootThreadId:string|null,eventThreadId:string|null,status?:string):{type:AgentEventKind;terminal:boolean;isRoot:boolean}{
  const isRoot=!rootThreadId||!eventThreadId||rootThreadId===eventThreadId;
  if(!isRoot)return{type:status==="failed"?"agent_failed":"agent_completed",terminal:false,isRoot:false};
  return{type:status==="completed"?"task_completed":status==="failed"?"task_failed":"task_stopped",terminal:true,isRoot:true};
}
