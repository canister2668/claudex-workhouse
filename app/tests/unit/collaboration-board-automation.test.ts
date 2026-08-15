import { describe,expect,it } from "vitest";
import { boardAutomationOutcome } from "../../src/server/collaboration-board-automation.js";
import { CollaborationBoardService } from "../../src/server/collaboration-board.js";

describe("Collaboration Board automation decisions",()=>{
  it("waits for active work and blocks failed stages",()=>{
    expect(boardAutomationOutcome({stage:"work",sessionStatus:"running",automationState:"running",stopAfter:null})).toBe("wait");
    expect(boardAutomationOutcome({stage:"review",sessionStatus:"failed",automationState:"running",stopAfter:null})).toBe("block");
    expect(boardAutomationOutcome({stage:"work",sessionStatus:"waiting-user",automationState:"running",stopAfter:null})).toBe("block");
  });

  it("honors user and configured stop points without killing the session",()=>{
    expect(boardAutomationOutcome({stage:"work",sessionStatus:"completed",automationState:"stopping",stopAfter:null})).toBe("pause");
    expect(boardAutomationOutcome({stage:"review",sessionStatus:"completed",automationState:"running",stopAfter:"review"})).toBe("pause");
  });

  it("advances completed work to review and review to human approval",()=>{
    expect(boardAutomationOutcome({stage:"work",sessionStatus:"completed",automationState:"running",stopAfter:null})).toBe("review");
    expect(boardAutomationOutcome({stage:"revision",sessionStatus:"completed",automationState:"running",stopAfter:null})).toBe("review");
    expect(boardAutomationOutcome({stage:"review",sessionStatus:"completed",automationState:"running",stopAfter:null})).toBe("approval");
  });
});

describe("Collaboration Board polling load",()=>{
  it("loads task and collaboration rows once for a multi-card list",async()=>{
    let taskReads=0,collaborationReads=0;
    const automation={mode:"manual",state:"idle",stage:null,stopAfter:null,round:0,approvedProviders:[],fullAccessAcknowledged:false,pauseReason:null,lastSessionId:null,startedAt:null};
    const cards=Array.from({length:4},(_,index)=>({id:`card-${index}`,projectId:"project",title:`Card ${index}`,boardVisible:true,boardStatus:"queued",priority:"normal",roles:{},automation,createdAt:"now",updatedAt:"now",archivedAt:null}));
    const service=new CollaborationBoardService({listBoardCards:async()=>cards,listTasks:async()=>{taskReads++;return[];},listCollaborationSessions:async()=>{collaborationReads++;return[];}} as any);
    expect(await service.list()).toHaveLength(4);
    expect({taskReads,collaborationReads}).toEqual({taskReads:1,collaborationReads:1});
  });

  it("lists automation cards without loading any task bodies",async()=>{
    let taskReads=0;
    const service=new CollaborationBoardService({listBoardCards:async()=>[{id:"card",automation:{mode:"auto",state:"running"}}],listTasks:async()=>{taskReads++;return[];}} as any);
    expect(await service.listAutomationCards()).toEqual([expect.objectContaining({id:"card",automation:expect.objectContaining({mode:"auto",state:"running"})})]);
    expect(taskReads).toBe(0);
  });
});
