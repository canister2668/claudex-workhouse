import fs from "node:fs";
import path from "node:path";
import{describe,expect,it}from"vitest";

const source=(name:string)=>fs.readFileSync(path.join(process.cwd(),"src","web",name),"utf8");

describe("conversation mode redesign UI",()=>{
  it("keeps provider scenes grouped and alternates large assets",()=>{
    const card=source("CollaborationRunCard.svelte"),styles=source("sessions.css");
    expect(card).toContain("inlinePresentation.scenes as scene,index");
    expect(card).toContain("resolveConversationScenePosition(scene,index)");
    expect(card).toContain("class:asset-right");
    expect(card).toContain("class:no-asset");
    expect(styles).toContain("width:176px");
    expect(styles).toContain(".inline-emotion-scene.no-asset");
  });

  it("moves technical metadata behind details while preserving provider-session navigation",()=>{
    const card=source("CollaborationRunCard.svelte");
    expect(card).toContain('class="turn-details"');
    expect(card).toContain('class="session-open"');
    expect(card.indexOf("person.workspaceId")).toBeGreaterThan(card.indexOf('class="turn-details"'));
  });

  it("renders user bubbles, relay lines, and progression controls as separate layers",()=>{
    const timeline=source("CollaborationTimeline.svelte"),user=source("ConversationUserCard.svelte");
    expect(timeline).not.toContain("conversation-round-handoff");
    expect(timeline).toContain('class="conversation-round-node"');
    expect(timeline).toContain('class="relay-arrow conversation-handoff conversation-stacked-handoff"');
    expect(timeline).toContain('class="conversation-round-group"');
    expect(timeline).toContain('class="conversation-round-outputs"');
    expect(timeline).toContain('class="conversation-control-dock"');
    expect(timeline).toContain('rows="1"');
    expect(timeline).toContain('onkeydown={submitConversationKey}');
    expect(timeline).toContain('shouldSubmitOnEnter(event,enterToSend)');
    expect(timeline).toContain('class="conversation-locked"');
    expect(timeline).toContain('class="primary conversation-send"');
    expect(timeline).toContain("{#if conversationInputVisible}");
    expect(timeline).toContain("<ConversationContinuation");
    expect(user).toContain('class="conversation-user-copy"');
  });

  it("inherits the global Enter-to-send preference in every conversation timeline",()=>{
    const app=source("App.svelte"),codex=source("CodexSessions.svelte");
    expect(app.match(/<CollaborationTimeline[^>]*\{enterToSend\}/g)).toHaveLength(2);
    expect(codex).toMatch(/<CollaborationTimeline[^>]*\{enterToSend\}/);
  });

  it("uses the global avatar dock as the only floating collaboration avatar",()=>{
    const timeline=source("CollaborationTimeline.svelte"),app=source("App.svelte"),styles=source("sessions.css");
    expect(app).toContain("<AgentAvatarDock");
    expect(timeline).not.toContain("collaboration-avatar-notice");
    expect(timeline).not.toContain('class="queue-pin"');
    expect(styles).not.toContain(".collaboration-avatar-notice");
    expect(styles).not.toContain(".queue-pin");
    expect(timeline).toContain("{notice}");
  });

  it("manages a generated conclusion through the workspace viewer, download, and guarded deletion",()=>{
    const timeline=source("CollaborationTimeline.svelte"),manager=source("ConversationDocumentManager.svelte"),app=source("App.svelte");
    expect(timeline).toContain('class="conversation-conclusion-actions"');
    expect(timeline).toContain('workspaceFileDownloadHref(conclusionFile.workspaceId,conclusionFile.relativePath)');
    expect(timeline).toContain('onclick={()=>openConclusion(conclusionFile)}');
    expect(timeline).toContain('method:"DELETE"');
    expect(timeline).toContain('revision:file.revision,confirmDelete:true');
    expect(app).toContain("onopenfile={openConversationFile}");
    expect(app).toContain('api("/api/conversation-documents"');
    expect(app).toContain("<ConversationDocumentManager");
    expect(manager).toContain('class="conversation-document-manager"');
    expect(manager).toContain("workspaceFileDownloadHref(document.workspaceId,document.relativePath)");
    expect(app).toContain('revision:document.revision,confirmDelete:true');
  });

  it("shows guided and automatic continuation input immediately",()=>{
    const timeline=source("CollaborationTimeline.svelte"),styles=source("sessions.css");
    expect(timeline).toContain("class:input-open={conversationInputVisible}");
    expect(timeline).toContain("{@render conversationInputForm(true)}");
    expect(timeline).not.toContain('class="conversation-input-back"');
    expect(timeline).not.toContain('continuationMode:"closed"|"user-input"');
    expect(styles).toContain("grid-template-columns:auto minmax(0,1fr);align-items:start");
    expect(styles).toContain(".conversation-control-actions{grid-column:1;grid-row:1;display:flex");
    expect(styles).toContain(".conversation-control-actions button{display:inline-flex;align-items:center;justify-content:center;gap:6px}");
    expect(styles).toContain("padding-right:12px;border-right:1px solid var(--line)");
    expect(styles).toContain(".conversation-control-dock .conversation-locked{grid-column:2;grid-row:1;align-self:start");
    expect(styles).toContain("height:54px;min-height:54px;margin:0;box-sizing:border-box");
  });

  it("pairs casual conversation turns on tablets and aligns their footers without resizing emotion assets",()=>{
    const styles=source("sessions.css");
    expect(styles).toContain("@media(min-width:768px)");
    expect(styles).toContain("grid-template-columns:repeat(2,minmax(0,1fr))");
    expect(styles).toContain("align-items:stretch");
    expect(styles).toContain("height:100%;flex-direction:column");
    expect(styles).toContain(".conversation-turn-footer{display:flex");
    expect(styles).toContain("margin-top:auto");
    expect(styles).toContain("grid-template-columns:176px minmax(0,1fr)");
  });
});
