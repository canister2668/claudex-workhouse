import {describe,expect,it} from "vitest";
import {classifyProviderSession,classifySessionWithThread,type SessionClassificationContext} from "../../src/web/session-classification";
import {projectTaskListItem} from "../../src/server/task-list-projection.js";

const PROVIDERS=["codex","claude","deepseek","ollama","antigravity","grok"] as const;

const context:SessionClassificationContext={collaborations:new Map([
  ["assist-1",{mode:"assist"}],
  ["assist-board",{mode:"assist",workChainId:"chain-board"}],
  ["conversation-1",{mode:"debate"}],
  ["review-1",{mode:"review"}],
  ["parallel-1",{mode:"parallel"}],
  ["board-1",{mode:"review",workChainId:"chain-board"}]
])};

const task=(provider:string,metadata:Record<string,unknown>,extra:Record<string,unknown>={})=>({id:`${provider}:task`,provider,threadId:`${provider}-thread`,metadata,...extra});

describe("provenance-based provider session classification",()=>{
  it("classifies managed provider tasks as independent work for every provider",()=>{
    for(const provider of PROVIDERS){
      const managed=task(provider,{collaborationSessionId:"assist-1",collaborationParticipantId:"participant",collaborationMode:"assist",managedProviderSourceTaskId:"codex:source"});
      expect(classifyProviderSession(managed,context)).toBe("managed-task");
      // A managed task that inherited a chain from its source is still the
      // user's independent work, not a board execution.
      expect(classifyProviderSession({...managed,workChainId:"chain-board"},context)).toBe("managed-task");
    }
  });

  it("classifies an ordinary Assist target as independent work for every provider",()=>{
    for(const provider of PROVIDERS){
      expect(classifyProviderSession(task(provider,{collaborationSessionId:"assist-1",collaborationParticipantId:"participant"}),context)).toBe("assist-task");
      expect(classifyProviderSession(task(provider,{collaborationSessionId:"unlisted",collaborationParticipantId:"participant",collaborationMode:"assist"}),context)).toBe("assist-task");
    }
  });

  it("classifies conversation turns, review work and board executions by provenance",()=>{
    expect(classifyProviderSession(task("codex",{collaborationSessionId:"conversation-1",collaborationParticipantId:"participant"}),context)).toBe("conversation-participant");
    expect(classifyProviderSession(task("codex",{collaborationSessionId:"review-1",collaborationParticipantId:"participant"}),context)).toBe("collaboration-work-participant");
    expect(classifyProviderSession(task("claude",{collaborationSessionId:"parallel-1",collaborationParticipantId:"participant"}),context)).toBe("collaboration-work-participant");
    expect(classifyProviderSession(task("claude",{collaborationSessionId:"board-1",collaborationParticipantId:"participant"},{workChainId:"chain-board"}),context)).toBe("collaboration-work-participant");
    expect(classifyProviderSession(task("claude",{collaborationSessionId:"board-1",collaborationParticipantId:"participant"},{workChainId:"chain-board"}),{...context,boardChainIds:new Set(["chain-board"])})).toBe("board-participant");
    // An Assist created inside a board card belongs to the card.
    expect(classifyProviderSession(task("grok",{collaborationSessionId:"assist-board",collaborationParticipantId:"participant",collaborationMode:"assist"},{workChainId:"chain-board"}),context)).toBe("collaboration-work-participant");
  });

  it("keeps an ordinary task in a work chain visible when it is not a collaboration participant",()=>{
    expect(classifyProviderSession(task("codex",{},{workChainId:"chain-board"}),context)).toBe("regular-task");
    expect(classifyProviderSession(task("codex",{}),context)).toBe("regular-task");
  });


  it("treats an unresolvable collaboration as conversation residue instead of promoting it",()=>{
    expect(classifyProviderSession(task("ollama",{collaborationSessionId:"archived",collaborationParticipantId:"participant"}),context)).toBe("conversation-participant");
    expect(classifyProviderSession(task("ollama",{collaborationParticipantId:"participant"}),context)).toBe("conversation-participant");
  });

  it("gives a native mirror the classification of the Workhouse task owning its thread",()=>{
    const conversation=task("antigravity",{collaborationSessionId:"conversation-1",collaborationParticipantId:"participant"});
    const managed=task("grok",{collaborationSessionId:"assist-1",collaborationParticipantId:"participant",managedProviderSourceTaskId:"codex:source"});
    const nativeConversation={provider:"antigravity",threadId:"antigravity-thread",metadata:{}};
    const nativeManaged={provider:"grok",threadId:"grok-thread",metadata:{}};
    const rows=[conversation,managed];
    expect(classifySessionWithThread(nativeConversation,rows,context)).toBe("conversation-participant");
    expect(classifySessionWithThread(nativeManaged,rows,context)).toBe("regular-task");
    // A shared thread id across providers is a coincidence, never the same session.
    expect(classifySessionWithThread({provider:"codex",threadId:"antigravity-thread",metadata:{}},rows,context)).toBe("regular-task");
  });

  it("classifies a projected list row the same way in a snapshot, a delta and after completion",()=>{
    const stored={id:"claude:managed",provider:"claude",nativeId:"claude:managed",threadId:"managed-thread",projectId:"project",title:"managed",prompt:"p",status:"running",createdAt:"2026-08-14T00:00:00.000Z",updatedAt:"2026-08-14T00:00:00.000Z",result:null,error:null,log:"",owned:true,pid:null,pgid:null,processStart:null,commandMarker:null,parentThreadId:null,workChainId:"chain-board",metadata:{collaborationSessionId:"assist-1",collaborationParticipantId:"participant",collaborationMode:"assist",managedProviderSourceTaskId:"codex:source"}} as any;
    for(const status of ["running","completed"]){
      const projected=projectTaskListItem({...stored,status,result:status==="completed"?"done":null});
      expect(classifyProviderSession(projected as any,context)).toBe("managed-task");
      expect(classifySessionWithThread({provider:"claude",threadId:"managed-thread",metadata:{}},[projected as any],context)).toBe("regular-task");
    }
  });
});
