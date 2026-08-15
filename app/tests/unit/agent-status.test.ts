import { describe, expect, it } from "vitest";
import { activeAgentStatus, activeSessions, avatarSessionRows, avatarTaskStreamKey, chooseProviderRecent, collaborationRecentStatuses, prioritizeCollaborationStatus, recentCompletedSessions, taskForRecentSession } from "../../src/web/agent-status.js";
import { createTaskState } from "../../src/web/task-state.js";

describe("recent completed sessions", () => {
  it("resolves an avatar entry to its exact provider task or newest matching thread",()=>{const rows=[{id:"claude-task",provider:"claude" as const,status:"completed",title:"Claude",updatedAt:"2026-07-14T01:00:00Z",threadId:"shared"},{id:"codex-old",provider:"codex" as const,status:"completed",title:"old",updatedAt:"2026-07-14T01:00:00Z",threadId:"thread"},{id:"codex-new",provider:"codex" as const,status:"completed",title:"new",updatedAt:"2026-07-14T02:00:00Z",threadId:"thread"}];expect(taskForRecentSession(rows,{provider:"codex",taskId:"codex-old",threadId:"thread",status:"completed",title:"old",updatedAt:""})?.id).toBe("codex-old");expect(taskForRecentSession(rows,{provider:"codex",taskId:null,threadId:"thread",status:"completed",title:"thread",updatedAt:""})?.id).toBe("codex-new");expect(taskForRecentSession(rows,{provider:"codex",taskId:null,threadId:"shared",status:"completed",title:"wrong provider",updatedAt:""})).toBeNull();});
  it("keeps one latest completed row per thread", () => {
    const rows = [
      {id:"new",provider:"codex" as const,status:"completed",title:"new",updatedAt:"2026-07-14T02:00:00Z",threadId:"b",projectId:"deck"},
      {id:"old-turn",provider:"codex" as const,status:"completed",title:"old",updatedAt:"2026-07-14T01:00:00Z",threadId:"a",projectId:"deck"},
      {id:"active-turn",provider:"codex" as const,status:"running",title:"active",updatedAt:"2026-07-14T03:00:00Z",threadId:"a",projectId:"deck"},
      {id:"claude",provider:"claude" as const,status:"completed",title:"other",updatedAt:"2026-07-14T04:00:00Z",threadId:"c",projectId:"deck"},
    ];
    expect(recentCompletedSessions(rows,"codex")).toEqual([{provider:"codex",taskId:"new",status:"completed",title:"new",updatedAt:"2026-07-14T02:00:00Z",threadId:"b",projectId:"deck"}]);
  });

  it("caps the result", () => {
    const rows = Array.from({length:6},(_,i)=>({id:String(i),provider:"claude" as const,status:"completed",title:String(i),updatedAt:`2026-07-14T0${i}:00:00Z`}));
    expect(recentCompletedSessions(rows,"claude",3)).toHaveLength(3);
  });

  it("lists active sessions separately",()=>{
    const rows=[
      {id:"run",provider:"codex" as const,status:"running",title:"running",updatedAt:"2026-07-14T03:00:00Z",threadId:"a"},
      {id:"done",provider:"codex" as const,status:"completed",title:"done",updatedAt:"2026-07-14T02:00:00Z",threadId:"b"},
      {id:"wait",provider:"codex" as const,status:"waiting",title:"waiting",updatedAt:"2026-07-14T01:00:00Z",threadId:"c"},
    ];
    expect(activeSessions(rows,"codex").map(item=>item.taskId)).toEqual(["run","wait"]);
  });

  it("gives the collaboration timeline sole stream ownership while its detail is open",()=>{const recent={provider:"codex" as const,taskId:"codex:task",status:"running",title:"turn",updatedAt:"now"};expect(avatarTaskStreamKey(recent,false)).toBe("codex:task:running");expect(avatarTaskStreamKey(recent,true)).toBe("");});
  it("never lets an internal collaboration participant become the avatar stream owner",()=>{const rows=[{id:"conversation",provider:"codex" as const,status:"running",title:"turn",updatedAt:"now",metadata:{collaborationParticipantId:"participant"}},{id:"standalone",provider:"codex" as const,status:"running",title:"task",updatedAt:"before",metadata:{}}];expect(avatarSessionRows(rows).map(row=>row.id)).toEqual(["standalone"]);});
  it("lets only participants from a visible collaboration board card own the avatar stream",()=>{const rows=[{id:"board-review",provider:"claude" as const,status:"running",title:"review",updatedAt:"now",workChainId:"visible-board",metadata:{collaborationParticipantId:"participant"}},{id:"hidden-chain",provider:"claude" as const,status:"running",title:"conversation",updatedAt:"before",workChainId:"legacy-chain",metadata:{collaborationParticipantId:"participant"}}];expect(avatarSessionRows(rows,new Set(["visible-board"])).map(row=>row.id)).toEqual(["board-review"]);expect(avatarSessionRows(rows).map(row=>row.id)).toEqual([]);});
  it("lets an ordinary Assist target own its header avatar stream while conversation turns cannot",()=>{const collaborations=new Map([["assist-1",{mode:"assist"}],["conversation-1",{mode:"debate"}]]);const rows=[{id:"assist",provider:"grok" as const,status:"running",title:"assist",updatedAt:"now",metadata:{collaborationSessionId:"assist-1",collaborationParticipantId:"participant"}},{id:"conversation",provider:"grok" as const,status:"running",title:"turn",updatedAt:"before",metadata:{collaborationSessionId:"conversation-1",collaborationParticipantId:"participant"}}];expect(avatarSessionRows(rows,undefined,{collaborations}).map(row=>row.id)).toEqual(["assist"]);});
  it("lets a managed background provider task own its header avatar stream",()=>{const rows=[{id:"managed-review",provider:"claude" as const,status:"running",title:"review",updatedAt:"now",metadata:{collaborationParticipantId:"participant",managedProviderSourceTaskId:"codex-source"}},{id:"conversation",provider:"claude" as const,status:"running",title:"turn",updatedAt:"before",metadata:{collaborationParticipantId:"participant"}}];expect(avatarSessionRows(rows).map(row=>row.id)).toEqual(["managed-review"]);});
  it("projects the collaboration stream owner's live run state into the header avatars",()=>{
    const detail={session:{title:"friends",updatedAt:"2026-07-28T01:00:00Z",metadata:{enabledProviders:["codex","claude"]}},participants:[{id:"c",provider:"codex",providerSessionId:"ct"},{id:"a",provider:"claude",providerSessionId:"at"}],runs:[{id:"old",participantId:"c",providerTaskId:"codex-old",status:"completed",sequence:1,generation:1,updatedAt:"2026-07-28T00:00:00Z"},{id:"new",participantId:"c",providerTaskId:"codex-new",status:"running",sequence:3,generation:1,updatedAt:"2026-07-28T01:00:00Z"},{id:"claude",participantId:"a",providerTaskId:"claude-task",status:"completed",sequence:2,generation:1,updatedAt:"2026-07-28T00:30:00Z"}],tasks:{"codex-new":{status:"pending",title:"Codex turn",updatedAt:"2026-07-28T01:01:00Z",threadId:"ct"},"claude-task":{status:"completed",title:"Claude turn",updatedAt:"2026-07-28T00:31:00Z",threadId:"at"}}};
    expect(collaborationRecentStatuses(detail)).toEqual({codex:{provider:"codex",taskId:"codex-new",status:"pending",title:"Codex turn",updatedAt:"2026-07-28T01:01:00Z",threadId:"ct"},claude:{provider:"claude",taskId:"claude-task",status:"completed",title:"Claude turn",updatedAt:"2026-07-28T00:31:00Z",threadId:"at"}});
    detail.tasks["codex-new"].status="completed";detail.runs[1].status="completed";
    expect(collaborationRecentStatuses(detail).codex?.status).toBe("completed");
  });
  it("projects added conversation providers into their own header avatars",()=>{
    const detail={session:{title:"five models",updatedAt:"now",metadata:{enabledProviders:["antigravity","deepseek","ollama"]}},participants:[{id:"g",provider:"antigravity",providerSessionId:"gt"},{id:"d",provider:"deepseek",providerSessionId:"dt"},{id:"o",provider:"ollama",providerSessionId:"ot"}],runs:[{id:"gr",participantId:"g",providerTaskId:"g-task",status:"running",sequence:1},{id:"dr",participantId:"d",providerTaskId:"d-task",status:"completed",sequence:2},{id:"or",participantId:"o",providerTaskId:"o-task",status:"waiting-user",sequence:3}],tasks:{"g-task":{status:"running",title:"Gemini",updatedAt:"now",threadId:"gt"},"d-task":{status:"completed",title:"DeepSeek",updatedAt:"now",threadId:"dt"},"o-task":{status:"waiting",title:"Ollama",updatedAt:"now",threadId:"ot"}}};
    expect(collaborationRecentStatuses(detail)).toMatchObject({antigravity:{provider:"antigravity",status:"running"},deepseek:{provider:"deepseek",status:"completed"},ollama:{provider:"ollama",status:"waiting"}});
  });
  it("only lets an actively running collaboration override another active task",()=>{
    const task={provider:"codex" as const,taskId:"standalone",status:"running",title:"other task",updatedAt:"2026-07-28T02:00:00Z"};
    const completed={provider:"codex" as const,taskId:"conversation",status:"completed",title:"idle conversation",updatedAt:"2026-07-28T03:00:00Z"};
    const running={...completed,status:"running"};
    expect(prioritizeCollaborationStatus(completed,task)).toBe(task);
    expect(prioritizeCollaborationStatus(running,task)).toBe(running);
    expect(prioritizeCollaborationStatus(completed,null)).toBe(completed);
    expect(activeAgentStatus(completed)).toBe(false);
    expect(activeAgentStatus(running)).toBe(true);
  });

  it("does not list a running thread as completed when an older turn has a later update timestamp",()=>{
    const rows=[
      {id:"old",provider:"claude" as const,status:"completed",title:"old",createdAt:"2026-07-25T10:00:00Z",updatedAt:"2026-07-25T12:00:00Z",threadId:"same"},
      {id:"new",provider:"claude" as const,status:"running",title:"new",createdAt:"2026-07-25T11:00:00Z",updatedAt:"2026-07-25T11:01:00Z",threadId:"same"}
    ];
    expect(activeSessions(rows,"claude")).toEqual([expect.objectContaining({taskId:"new",status:"running"})]);
    expect(recentCompletedSessions(rows,"claude")).toEqual([]);
  });

  it("shows a follow-up snapshot as active without waiting for a list refresh",()=>{
    type Row={id:string;provider:"codex"|"claude";status:string;title:string;updatedAt:string;threadId:string};
    const completed:Row={id:"old",provider:"codex",status:"completed",title:"thread",updatedAt:"2026-07-14T01:00:00Z",threadId:"thread"};
    const started={...completed,id:"new",status:"running",updatedAt:"2026-07-14T02:00:00Z"};
    const state=createTaskState<Row>();let rows:Row[]=[];const unsubscribe=state.subscribe(value=>rows=value);state.replace([completed]);state.upsert(started);
    expect(activeSessions(rows,"codex").map(item=>item.taskId)).toEqual(["new"]);
    state.upsert({...started,status:"waiting"});
    expect(rows.filter(item=>item.id==="new")).toHaveLength(1);
    expect(rows[0].status).toBe("waiting");
    unsubscribe();
  });
  it("applies task and session removals from list deltas",()=>{
    type Row={id:string;provider:"codex"|"claude";status:string;threadId:string};
    const state=createTaskState<Row>();let rows:Row[]=[];const unsubscribe=state.subscribe(value=>rows=value);
    state.replace([{id:"one",provider:"codex",status:"completed",threadId:"same"},{id:"two",provider:"codex",status:"completed",threadId:"same"},{id:"other",provider:"claude",status:"completed",threadId:"same"}]);
    state.remove("one");expect(rows.map(item=>item.id)).toEqual(["two","other"]);
    state.removeSession("codex","same");expect(rows.map(item=>item.id)).toEqual(["other"]);
    unsubscribe();
  });
  it("does not let the preceding turn's stale native status own a newer active task",()=>{
    const next={provider:"codex" as const,taskId:"next",threadId:"thread",status:"running",title:"next",updatedAt:"2026-08-03T11:00:00Z"};
    const stale={provider:"codex" as const,taskId:"previous",threadId:"thread",status:"running",title:"previous",updatedAt:"2026-08-03T11:00:01Z"};
    expect(chooseProviderRecent(next,stale)).toBe(next);
    expect(chooseProviderRecent({...next,status:"completed"},stale)).toBe(stale);
  });
  it("lets an active native turn override the terminal row while its task id is still stale",()=>{
    const completed={provider:"codex" as const,taskId:"previous",threadId:"thread",status:"completed",title:"previous",updatedAt:"2026-08-03T11:00:00Z"};
    const resumed={...completed,status:"running",updatedAt:"2026-08-03T11:00:01Z"};
    expect(chooseProviderRecent(completed,resumed)).toBe(resumed);
  });
});
