import { describe,expect,it } from "vitest";
import { boardAutomationOutcome, boardSessionIsLive, boardShouldKeepSession, boardWaitingPauseReason, CollaborationBoardAutomationEngine } from "../../src/server/collaboration-board-automation.js";
import { CollaborationBoardService } from "../../src/server/collaboration-board.js";

describe("Collaboration Board automation decisions",()=>{
  it("waits for active work and blocks failed stages",()=>{
    expect(boardAutomationOutcome({stage:"work",sessionStatus:"running",automationState:"running",stopAfter:null})).toBe("wait");
    expect(boardAutomationOutcome({stage:"review",sessionStatus:"failed",automationState:"running",stopAfter:null})).toBe("block");
    expect(boardAutomationOutcome({stage:"work",sessionStatus:"waiting-user",automationState:"running",stopAfter:null})).toBe("wait");
    expect(boardAutomationOutcome({stage:"review",sessionStatus:"waiting-approval",automationState:"running",stopAfter:null})).toBe("wait");
  });

  it("honors user and configured stop points without killing the session",()=>{
    expect(boardAutomationOutcome({stage:"work",sessionStatus:"completed",automationState:"stopping",stopAfter:null})).toBe("pause");
    expect(boardAutomationOutcome({stage:"review",sessionStatus:"completed",automationState:"running",stopAfter:"review"})).toBe("pause");
  });

  it("settles stopping automation while a session waits for the user, but still waits on live work",()=>{
    expect(boardAutomationOutcome({stage:"work",sessionStatus:"waiting-user",automationState:"stopping",stopAfter:null})).toBe("pause");
    expect(boardAutomationOutcome({stage:"review",sessionStatus:"waiting-approval",automationState:"stopping",stopAfter:null})).toBe("pause");
    expect(boardAutomationOutcome({stage:"work",sessionStatus:"waiting",automationState:"stopping",stopAfter:null})).toBe("pause");
    expect(boardAutomationOutcome({stage:"work",sessionStatus:"running",automationState:"stopping",stopAfter:null})).toBe("wait");
    expect(boardAutomationOutcome({stage:"work",sessionStatus:"starting",automationState:"stopping",stopAfter:null})).toBe("wait");
    expect(boardAutomationOutcome({stage:"review",sessionStatus:"queued",automationState:"stopping",stopAfter:null})).toBe("wait");
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
    let requestedIds:string[]|null=null;
    const service=new CollaborationBoardService({listBoardCards:async()=>cards,listTasksByWorkChainIds:async(ids)=>{taskReads++;requestedIds=ids;return[];},listCollaborationSessionsByWorkChainIds:async()=>{collaborationReads++;return[];}} as any);
    expect(await service.list()).toHaveLength(4);
    expect({taskReads,collaborationReads,requestedIds}).toEqual({taskReads:1,collaborationReads:1,requestedIds:["card-0","card-1","card-2","card-3"]});
  });

  it("lists automation cards without loading any task bodies",async()=>{
    let taskReads=0;
    const service=new CollaborationBoardService({listBoardCards:async()=>[{id:"card",automation:{mode:"auto",state:"running"}}],listTasksByWorkChainIds:async()=>{taskReads++;return[];}} as any);
    expect(await service.listAutomationCards()).toEqual([expect.objectContaining({id:"card",automation:expect.objectContaining({mode:"auto",state:"running"})})]);
    expect(taskReads).toBe(0);
  });

  it("loads a card detail by chain id instead of every task",async()=>{
    let requestedIds:string[]|null=null;
    const card={id:"card-detail",projectId:"project",title:"Card",boardVisible:true,boardStatus:"queued",priority:"normal",roles:{},automation:{mode:"manual",state:"idle",stage:null,stopAfter:null,round:0,approvedProviders:[],fullAccessAcknowledged:false,pauseReason:null,lastSessionId:null,startedAt:null},createdAt:"now",updatedAt:"now",archivedAt:null};
    const service=new CollaborationBoardService({getWorkChain:async()=>card,listTasksByWorkChainIds:async(ids)=>{requestedIds=ids;return[];},listCollaborationSessionsByWorkChainIds:async()=>[]} as any);
    await service.detail("card-detail");
    expect(requestedIds).toEqual(["card-detail"]);
  });
});

describe("Collaboration Board keep-session liveness",()=>{
  const probe={usesWorker:(hostId:string)=>hostId!=="local",isHostOnline:(hostId:string)=>hostId==="online-host"};
  it("treats host-offline metadata or a dead worker host as not live",()=>{
    expect(boardSessionIsLive({status:"waiting-user",executionHostId:"online-host",remoteState:null},probe)).toBe(true);
    expect(boardSessionIsLive({status:"waiting-user",executionHostId:"offline-host",remoteState:null},probe)).toBe(false);
    expect(boardSessionIsLive({status:"waiting-user",executionHostId:"online-host",remoteState:"host-offline"},probe)).toBe(false);
    expect(boardSessionIsLive({status:"waiting-user",executionHostId:"local",remoteState:null},probe)).toBe(true);
  });
  it("keeps only live active sessions and surfaces a waiting reason",()=>{
    expect(boardShouldKeepSession({status:"waiting-user",executionHostId:"offline-host"},session=>boardSessionIsLive(session,probe))).toBe(false);
    expect(boardShouldKeepSession({status:"waiting-approval",executionHostId:"online-host"},session=>boardSessionIsLive(session,probe))).toBe(true);
    expect(boardShouldKeepSession({status:"completed",executionHostId:"online-host"},()=>true)).toBe(false);
    expect(boardWaitingPauseReason("waiting-user")).toBe("session:waiting-user");
    expect(boardWaitingPauseReason("waiting-approval")).toBe("session:waiting-approval");
    expect(boardWaitingPauseReason("running")).toBeNull();
  });
});

describe("Collaboration Board automation engine",()=>{
  function fakeEngine(card:any,isSessionLive?:(session:any)=>boolean){
    let current=structuredClone(card);
    const events:string[]=[];
    const service={
      verifyRevision:async()=>current,
      detail:async()=>current,
      setAutomation:async(_id:string,_revision:number,automation:any,eventType:string)=>{current={...current,revision:current.revision+1,automation:{...current.automation,...automation}};events.push(eventType);return current;},
      setStatus:async(_id:string,_revision:number,status:string)=>{current={...current,revision:current.revision+1,boardStatus:status};events.push("status:"+status);return current;},
      automationEvent:async()=>({inserted:true}),
      recordStarted:async()=>current,
      listAutomationCards:async()=>[current]
    } as any;
    return {engine:new CollaborationBoardAutomationEngine(service,async()=>({task:{id:"new-task"}}),isSessionLive),get:()=>current,events};
  }

  it("pauses a stopping card that is only waiting for user input",async()=>{
    const {engine,get}=fakeEngine({
      id:"card",revision:2,boardStatus:"in_progress",
      automation:{mode:"auto",state:"stopping",stage:"work",stopAfter:null,round:1,approvedProviders:[],fullAccessAcknowledged:false,pauseReason:"user",lastSessionId:"sess",startedAt:"now"},
      sessions:[{id:"sess",kind:"task",role:"implementer",status:"waiting-user",provider:"codex",createdAt:"now",updatedAt:"now",result:null,error:null}],
      activeSessionCount:1
    });
    await engine.tickCard("card");
    expect(get().automation).toMatchObject({state:"paused",pauseReason:"user",stage:"work"});
  });

  it("moves a revise decision off the approval board status before starting revision",async()=>{
    const {engine,get,events}=fakeEngine({
      id:"card",revision:4,boardStatus:"approval",
      automation:{mode:"auto",state:"paused",stage:"approval",stopAfter:null,round:1,approvedProviders:[],fullAccessAcknowledged:false,pauseReason:"decision-required",lastSessionId:null,startedAt:"now"},
      sessions:[],activeSessionCount:0
    });
    const next=await engine.decide("card",4,"revise");
    expect(next).toMatchObject({boardStatus:"in_progress",automation:{mode:"auto",state:"running",stage:"revision",round:2}});
    expect(get().boardStatus).toBe("in_progress");
    expect(events).toContain("automation_revision_requested");
    expect(events).toContain("status:in_progress");
  });

  it("rejects decide when the card is no longer awaiting an automation decision",async()=>{
    const {engine}=fakeEngine({
      id:"card",revision:5,boardStatus:"in_progress",
      automation:{mode:"auto",state:"running",stage:"revision",stopAfter:null,round:2,approvedProviders:[],fullAccessAcknowledged:false,pauseReason:null,lastSessionId:null,startedAt:"now"},
      sessions:[],activeSessionCount:0
    });
    await expect(engine.decide("card",5,"revise")).rejects.toMatchObject({code:"BOARD_AUTOMATION_DECISION_UNAVAILABLE",statusCode:409});
  });

  it("keeps a live waiting session and records that it is waiting for input",async()=>{
    const {engine,get}=fakeEngine({
      id:"card",revision:3,boardStatus:"in_progress",
      automation:{mode:"auto",state:"paused",stage:"work",stopAfter:null,round:1,approvedProviders:[],fullAccessAcknowledged:false,pauseReason:"user",lastSessionId:"sess",startedAt:"now"},
      sessions:[{id:"sess",kind:"task",role:"implementer",status:"waiting-user",provider:"codex",executionHostId:"online-host",remoteState:null,createdAt:"now",updatedAt:"now",result:null,error:null}],
      activeSessionCount:1
    },()=>true);
    const next=await engine.resume("card",3);
    expect(next.automation).toMatchObject({state:"running",stage:"work",lastSessionId:"sess",pauseReason:"session:waiting-user"});
    expect(get().automation.pauseReason).toBe("session:waiting-user");
  });

  it("dispatches a new stage when the last waiting session is dead",async()=>{
    const {engine}=fakeEngine({
      id:"card",revision:3,boardStatus:"in_progress",
      automation:{mode:"auto",state:"paused",stage:"work",stopAfter:null,round:1,approvedProviders:[],fullAccessAcknowledged:false,pauseReason:"user",lastSessionId:"sess",startedAt:"2026-08-01T00:00:00.000Z"},
      sessions:[{id:"sess",kind:"task",role:"implementer",status:"waiting-user",provider:"codex",executionHostId:"offline-host",remoteState:"host-offline",createdAt:"2026-08-01T00:00:00.000Z",updatedAt:"2026-08-01T00:00:00.000Z",result:null,error:null}],
      activeSessionCount:1
    },()=>false);
    const next=await engine.resume("card",3);
    expect(next.automation).toMatchObject({state:"running",stage:"work",lastSessionId:null,pauseReason:null});
  });
});
