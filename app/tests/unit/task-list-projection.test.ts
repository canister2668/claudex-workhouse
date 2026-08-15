import {describe,expect,it} from "vitest";
import {projectTaskList,projectTaskListItem} from "../../src/server/task-list-projection.js";
import type {DeckTask} from "../../src/server/types.js";

function task(id="task-1"):DeckTask{
  const now="2026-08-07T00:00:00.000Z";
  return{id,provider:"ollama",nativeId:id,threadId:"thread-1",projectId:"project",title:"Large task",prompt:"p".repeat(20_000),status:"completed",createdAt:now,updatedAt:now,result:"r".repeat(20_000),error:null,log:`old\n${"l".repeat(20_000)}`,owned:true,pid:1,pgid:1,processStart:"start",commandMarker:"marker",parentThreadId:null,executionHostId:"local",workspaceId:"workspace",requestedModel:"deepseek-v4-flash:0731",metadata:{activity:"done",collaborationSessionId:"session",gitAttribution:{version:1,capturedAt:now,observedFiles:["app/a.ts"]},secretLargeField:"x".repeat(20_000)
  }};
}

describe("task list projection",()=>{
  it("omits heavy task bodies while retaining bounded list context",()=>{
    const projected=projectTaskListItem(task()) as Record<string,unknown>;
    expect(projected).not.toHaveProperty("prompt");
    expect(projected).not.toHaveProperty("result");
    expect(projected).not.toHaveProperty("log");
    expect(projected).not.toHaveProperty("pid");
    expect(projected.preview).toBeTypeOf("string");
    expect(String(projected.preview).length).toBeLessThanOrEqual(320);
    expect(projected.previewSource).toBe("result");
    expect(projected.metadata).toEqual({activity:"done",collaborationSessionId:"session",gitAttribution:{version:1,capturedAt:"2026-08-07T00:00:00.000Z",observedFiles:["app/a.ts"]}
    });
    expect(projected).toMatchObject({id:"task-1",listProjection:true});
  });

  it("preserves the provenance the session classifier needs",()=>{
    const source=task();
    const projected=projectTaskListItem({...source,workChainId:"chain-1",metadata:{...source.metadata,collaborationParticipantId:"participant",collaborationMode:"assist",managedProviderSourceTaskId:"codex:source"}}) as Record<string,unknown>;
    expect(projected.workChainId).toBe("chain-1");
    expect(projected.metadata).toMatchObject({collaborationSessionId:"session",collaborationParticipantId:"participant",collaborationMode:"assist",managedProviderSourceTaskId:"codex:source"});
  });

  it("keeps a 3,700-row snapshot below four MiB even when stored bodies are large",()=>{
    const payload=JSON.stringify({tasks:projectTaskList(Array.from({length:3700},(_,index)=>task(`task-${index}`)))});
    expect(Buffer.byteLength(payload)).toBeLessThan(4*1024*1024);
  });
});
