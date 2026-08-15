import fs from"node:fs";import os from"node:os";import path from"node:path";
import{describe,expect,it}from"vitest";
import{createWorkspaceInstructionSnapshot,MAX_WORKSPACE_INSTRUCTION_SNAPSHOT_BYTES,normalizeWorkspaceInstructionProfile,ownerEditedWorkspaceInstructionProfile,promptWithWorkspaceInstructions,repositoryWorkspaceInstructions,workspaceInstructionCompactionMetadata,workspaceInstructionFollowUpMetadata,workspaceInstructionRecoveryMetadata,workspaceInstructionTaskTitle}from"./workspace-instructions.js";

describe("workspace instructions",()=>{
  it("normalizes a versioned disabled profile",()=>{expect(normalizeWorkspaceInstructionProfile(undefined)).toMatchObject({version:1,enabled:false,revision:0});});
  it("defaults legacy stored profiles to owner-only agent editing",()=>{expect(normalizeWorkspaceInstructionProfile({version:1,enabled:true,sourceMode:"managed",markdown:"legacy",revision:2})).toMatchObject({agentEditable:false,lastEditedBy:"owner",lastEditedTaskId:null});});
  it("forces owner provenance when the browser saves an agent-edited profile",()=>{expect(ownerEditedWorkspaceInstructionProfile({enabled:true,markdown:"owner update",agentEditable:true,lastEditedBy:"agent",lastEditedTaskId:"codex:old",revision:8},8,"2026-08-07T01:00:00.000Z")).toMatchObject({revision:9,lastEditedBy:"owner",lastEditedTaskId:null,agentEditable:true});});
  it("creates an immutable prompt snapshot without granting git publication",()=>{
    const profile=normalizeWorkspaceInstructionProfile({enabled:true,sourceMode:"managed",markdown:"After runtime changes, restart the server.",revision:3});
    const snapshot=createWorkspaceInstructionSnapshot({workspaceId:"w1",workspaceName:"demo",profile,capturedAt:"2026-08-07T00:00:00.000Z"});
    expect(snapshot).toMatchObject({revision:3,workspaceId:"w1",sources:[{name:"managed"}]});
    expect(snapshot?.text).toContain("do not authorize commit, push, publish");
    expect(promptWithWorkspaceInstructions("fix it",snapshot)).toContain("[CURRENT USER REQUEST]\nfix it");
  });
  it("rejects obvious credentials",()=>{expect(()=>normalizeWorkspaceInstructionProfile({enabled:true,markdown:"api_key=abcdefghijklmnop"})).toThrow(/credentials/i);});
  it("keeps character guidance outside the user request and uses a short follow-up reference",()=>{
    const profile=normalizeWorkspaceInstructionProfile({enabled:true,sourceMode:"managed",markdown:"Run checks.",revision:1}),snapshot=createWorkspaceInstructionSnapshot({workspaceId:"w1",workspaceName:"demo",profile})!;
    const initial=promptWithWorkspaceInstructions("fix it",snapshot,{characterDirective:"Stay concise."});expect(initial.indexOf("[CHARACTER DIRECTIVE]")).toBeLessThan(initial.indexOf("[CURRENT USER REQUEST]"));
    const followUp=promptWithWorkspaceInstructions("continue",snapshot,{referenceOnly:true});expect(followUp).not.toContain("Run checks.");expect(followUp).toContain(`${snapshot.digest.slice(0,12)} REMAINS IN EFFECT`);
  });
  it("keeps character guidance when workspace instructions are disabled",()=>{const wrapped=promptWithWorkspaceInstructions("reply now",null,{characterDirective:"Keep the configured voice."});expect(wrapped).toContain("[CHARACTER DIRECTIVE]\nKeep the configured voice.");expect(wrapped).toContain("[CURRENT USER REQUEST]\nreply now");});
  it("keeps the validated user prompt budget independent from the bounded snapshot",()=>{const profile=normalizeWorkspaceInstructionProfile({enabled:true,sourceMode:"managed",markdown:"Run checks."}),snapshot=createWorkspaceInstructionSnapshot({workspaceId:"w1",workspaceName:"demo",profile})!;const prompt="x".repeat(20_000),wrapped=promptWithWorkspaceInstructions(prompt,snapshot);expect(wrapped.endsWith(prompt)).toBe(true);expect(Buffer.byteLength(snapshot.text,"utf8")).toBeLessThanOrEqual(MAX_WORKSPACE_INSTRUCTION_SNAPSHOT_BYTES);});
  it("bounds repository sources and refuses symlinks",()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),"workspace-instructions-"));try{fs.writeFileSync(path.join(root,"CLAUDE.md"),"x".repeat(20*1024));fs.symlinkSync(path.join(root,"CLAUDE.md"),path.join(root,"AGENTS.md"));expect(repositoryWorkspaceInstructions(root)).toEqual([]);}finally{fs.rmSync(root,{recursive:true,force:true});}
  });
  it("caps the combined snapshot",()=>{const profile=normalizeWorkspaceInstructionProfile({enabled:true,sourceMode:"combined",markdown:"m".repeat(32_000)}),snapshot=createWorkspaceInstructionSnapshot({workspaceId:"w1",workspaceName:"demo",profile,repositorySources:[{name:"AGENTS.md",text:"a".repeat(16_000)},{name:"CLAUDE.md",text:"c".repeat(16_000)}]})!;expect(Buffer.byteLength(snapshot.text,"utf8")).toBeLessThanOrEqual(MAX_WORKSPACE_INSTRUCTION_SNAPSHOT_BYTES);});
  it("omits repository instruction files containing obvious credentials",()=>{const profile=normalizeWorkspaceInstructionProfile({enabled:true,sourceMode:"repository"}),snapshot=createWorkspaceInstructionSnapshot({workspaceId:"w1",workspaceName:"demo",profile,repositorySources:[{name:"AGENTS.md",text:"access_token=abcdefghijklmnop"}]})!;expect(snapshot.sources).toEqual([]);expect(snapshot.text).not.toContain("abcdefghijklmnop");});
  it("retains a snapshot across recovery and clears one-shot reinjection",()=>{expect(workspaceInstructionFollowUpMetadata({workspaceInstructionSnapshot:{version:1,text:"rules",digest:"abc"},workspaceInstructionPendingInjection:true},{worker:"next"})).toMatchObject({workspaceInstructionSnapshot:{digest:"abc"},workspaceInstructionPendingInjection:false,worker:"next"});});
  it("does not leak a stopped turn's terminal metadata into its follow-up",()=>{
    const metadata=workspaceInstructionFollowUpMetadata({characterSnapshot:{nickname:"짚쨩"},terminationCause:"user-stopped",terminatedAt:"2026-08-10T07:02:23.031Z",activity:"failed",finalMessageId:"old",outputUsage:{totalTokens:10}},{worker:"next"});
    expect(metadata).toMatchObject({characterSnapshot:{nickname:"짚쨩"},worker:"next",workspaceInstructionPendingInjection:false});
    for(const key of ["terminationCause","terminatedAt","activity","finalMessageId","outputUsage"])expect(metadata).not.toHaveProperty(key);
  });
  it("removes stale interruption state after recovery",()=>{const metadata=workspaceInstructionRecoveryMetadata({workspaceInstructionSnapshot:{version:1,text:"rules",digest:"abc"},interruptionCause:"worker-process-lost",interruptionDetectedAt:"now",recoveryState:"awaiting-worker-snapshot"},{worker:"next"});expect(metadata).toMatchObject({workspaceInstructionSnapshot:{digest:"abc"},worker:"next"});expect(metadata).not.toHaveProperty("interruptionCause");expect(metadata).not.toHaveProperty("interruptionDetectedAt");expect(metadata).not.toHaveProperty("recoveryState");});
  it("requests one full reinjection after context compaction",()=>{expect(workspaceInstructionCompactionMetadata({workspaceInstructionSnapshot:{version:1,text:"rules",digest:"abc"}},{operation:"compact"})).toMatchObject({workspaceInstructionPendingInjection:true,operation:"compact"});expect(workspaceInstructionCompactionMetadata({},{operation:"compact"})).toMatchObject({workspaceInstructionPendingInjection:false});});
  it("derives the title from the raw request rather than an injected prompt",()=>{expect(workspaceInstructionTaskTitle("Fix the server",undefined)).toBe("Fix the server");expect(workspaceInstructionTaskTitle("Fix the server","Named")).toBe("Named");});
});
