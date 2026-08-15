import { describe, expect, it } from "vitest";
import { managedConversationDocuments } from "../../src/server/conversation-documents";

describe("managed conversation documents",()=>{
  it("lists valid generated Markdown metadata across active and archived conversations",()=>{
    const documents=managedConversationDocuments([
      {id:"older",title:"Older",status:"completed",updatedAt:"2026-08-01T00:00:00.000Z",metadata:{conclusionMarkdown:{workspaceId:"workspace-1",relativePath:"docs/older.md",revision:"a".repeat(64)}}},
      {id:"archived",title:"Archived",status:"archived",updatedAt:"2026-08-02T00:00:00.000Z",metadata:{conclusionMarkdown:{workspaceId:"workspace-1",relativePath:"docs/archived.md",revision:"b".repeat(64)}}},
      {id:"invalid",title:"Invalid",status:"completed",updatedAt:"2026-08-03T00:00:00.000Z",metadata:{conclusionMarkdown:{workspaceId:"workspace-1",relativePath:"docs/invalid.md",revision:"stale"}}}
    ]);
    expect(documents).toEqual([
      {collaborationId:"archived",title:"Archived",status:"archived",updatedAt:"2026-08-02T00:00:00.000Z",workspaceId:"workspace-1",relativePath:"docs/archived.md",revision:"b".repeat(64)},
      {collaborationId:"older",title:"Older",status:"completed",updatedAt:"2026-08-01T00:00:00.000Z",workspaceId:"workspace-1",relativePath:"docs/older.md",revision:"a".repeat(64)}
    ]);
  });
});
