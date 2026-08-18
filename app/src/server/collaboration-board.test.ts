import { describe, expect, it } from "vitest";
import { boardAttachSchema, boardCardCreateSchema, boardResumeUsesWorkerHost, CollaborationBoardService, isBoardWorkTask, selectBoardResumeTask } from "./collaboration-board.js";
import type { WorkChain, WorkChainEvent } from "./types.js";
import { LocalTransport } from "./collaboration/provider-transport.js";

function fakeDb(){
  const cards=new Map<string,WorkChain>(),events:WorkChainEvent[]=[];
  const db:any={
    getWorkspace:async(id:string)=>id==="ws"?{id:"ws",projectId:"project",archivedAt:null}:null,getTask:async()=>null,listTasks:async()=>[],listTasksByWorkChainIds:async()=>[],getCollaborationSession:async()=>null,listCollaborationSessions:async()=>[],listCollaborationSessionsByWorkChainIds:async()=>[],
    getWorkChain:async(id:string)=>cards.get(id)??null,listBoardCards:async()=>[...cards.values()].filter(item=>item.boardVisible&&!item.archivedAt),
    createWorkChain:async(card:WorkChain)=>{cards.set(card.id,card);return card;},
    updateBoardCard:async(next:WorkChain,revision:number)=>{const current=cards.get(next.id);if(!current||current.revision!==revision)return{updated:false,current:current??null};cards.set(next.id,next);return{updated:true,current:next};},
    appendWorkChainEvent:async(event:WorkChainEvent)=>{events.push(event);const card=cards.get(event.chainId);if(card)cards.set(card.id,{...card,lastActivityAt:event.createdAt});return{inserted:true,event};},listWorkChainEvents:async(id:string)=>events.filter(item=>item.chainId===id),attachBoardSession:async()=>({attached:false,reason:"not-found",chain:null})
  };return{db,cards,events};
}

describe("collaboration board service",()=>{
  it("validates provider-aware execution roles and Git branch names",()=>{expect(boardCardCreateSchema.parse({title:"Ship",workspaceId:"ws",roles:{reviewer:{provider:"claude",model:"claude-opus",reasoningEffort:"high",permissionProfile:":read-only",workMode:"plan",automationLevel:"read"}},targetBranch:"feature/board"}).priority).toBe("normal");expect(()=>boardCardCreateSchema.parse({title:"Ship",workspaceId:"ws",roles:{implementer:{provider:"codex",permissionProfile:"workspace-write"}}})).toThrow();expect(()=>boardCardCreateSchema.parse({title:"Ship",workspaceId:"ws",roles:{implementer:{provider:"claude",serviceTier:"priority"}}})).toThrow();expect(()=>boardCardCreateSchema.parse({title:"Ship",workspaceId:"ws",roles:{implementer:{provider:"claude",automationLevel:"confirm"}}})).toThrow();expect(()=>boardCardCreateSchema.parse({title:"Ship",workspaceId:"ws",targetBranch:"bad branch"})).toThrow();expect(()=>boardAttachSchema.parse({revision:1,taskId:"task",collaborationSessionId:crypto.randomUUID()})).toThrow();});
  it("rejects card field lengths the editor also blocks",()=>{expect(boardCardCreateSchema.parse({title:"x".repeat(100),workspaceId:"ws",description:"d".repeat(10_000)}).title).toHaveLength(100);expect(()=>boardCardCreateSchema.parse({title:"x".repeat(101),workspaceId:"ws"})).toThrow();expect(()=>boardCardCreateSchema.parse({title:"Ship",workspaceId:"ws",description:"d".repeat(10_001)})).toThrow();expect(()=>boardCardCreateSchema.parse({title:"Ship",workspaceId:"ws",targetBranch:"b".repeat(201)})).toThrow();});
  it("creates a visible persistent card and structured event",async()=>{const {db,events}=fakeDb(),service=new CollaborationBoardService(db);const card=await service.create(boardCardCreateSchema.parse({title:"Ship",workspaceId:"ws"}),{type:"user",id:"owner"});expect(card).toMatchObject({title:"Ship",projectId:"project",boardVisible:true,boardStatus:"queued",revision:1,rootSessionId:null});expect(events).toHaveLength(1);expect(events[0]).toMatchObject({eventType:"card_created",actorType:"user",actorId:"owner"});});
  it("uses revision compare-and-swap and keeps completion separate from archive",async()=>{const {db}=fakeDb(),service=new CollaborationBoardService(db),created=await service.create(boardCardCreateSchema.parse({title:"Ship",workspaceId:"ws"}),{type:"user",id:null});const completed=await service.patch(created.id,{revision:1,boardStatus:"completed"},{type:"user",id:null});expect(completed.completedAt).toBeTruthy();await expect(service.patch(created.id,{revision:1,title:"stale"},{type:"user",id:null})).rejects.toMatchObject({code:"BOARD_REVISION_CONFLICT"});const archived=await service.archive(created.id,completed.revision,{type:"user",id:null});expect(archived.archivedAt).toBeTruthy();expect(archived.boardStatus).toBe("completed");});
  it("rejects a stale action revision before provider execution",async()=>{const {db}=fakeDb(),service=new CollaborationBoardService(db),created=await service.create(boardCardCreateSchema.parse({title:"Ship",workspaceId:"ws"}),{type:"user",id:null});await service.patch(created.id,{revision:1,title:"Changed"},{type:"user",id:null});await expect(service.verifyRevision(created.id,1)).rejects.toMatchObject({code:"BOARD_REVISION_CONFLICT"});expect((await service.verifyRevision(created.id,2)).title).toBe("Changed");});
  it("persists the board chain on collaboration participant provider tasks",async()=>{let stored:any;const db:any={getSystemSetting:async()=>null,upsertTask:async(value:any)=>(stored=value)},provider:any={createTask:async()=>({id:"task",provider:"codex",threadId:"thread",metadata:{}})},transport=new LocalTransport(db,new Map([["codex",provider]]) as any);await transport.start({participant:{id:"participant",provider:"codex",collaborationSessionId:"collaboration",permissionMode:"read",capabilitySnapshot:{}},workspace:{id:"ws",projectId:"project",displayName:"Workspace",canonicalPath:"/workspace"},projectName:"Project",prompt:"Review",title:"Review",workChainId:"chain",collaborationMode:"review"} as any);expect(stored.workChainId).toBe("chain");expect(stored.metadata.collaborationMode).toBe("review");});
  it("idles automation when the card is marked completed",async()=>{
    const {db}=fakeDb(),service=new CollaborationBoardService(db);
    const created=await service.create(boardCardCreateSchema.parse({title:"Ship",workspaceId:"ws"}),{type:"user",id:null});
    const running=await service.setAutomation(created.id,created.revision,{mode:"auto",state:"blocked",stage:"work",stopAfter:null,round:1,approvedProviders:[],fullAccessAcknowledged:true,pauseReason:"session:waiting-user",lastSessionId:null,startedAt:created.createdAt},"automation_blocked");
    const completed=await service.patch(running.id,{revision:running.revision,boardStatus:"completed"},{type:"user",id:null});
    expect(completed.automation).toMatchObject({mode:"manual",state:"idle",stage:null,pauseReason:null});
    expect(completed.boardStatus).toBe("completed");
  });
});

describe("board resume task selection",()=>{
  it("prefers implementer and revision tasks over review participants",()=>{
    const review={id:"review",updatedAt:"2026-08-17T11:00:00.000Z",metadata:{collaborationMode:"review",boardRole:"review"}};
    const implementer={id:"work",updatedAt:"2026-08-17T10:00:00.000Z",metadata:{boardRole:"implementer"}};
    expect(isBoardWorkTask(review)).toBe(false);
    expect(selectBoardResumeTask([review,implementer])?.id).toBe("work");
  });
  it("returns undefined when only review sessions are linked",()=>{
    expect(selectBoardResumeTask([{id:"review",updatedAt:"now",metadata:{collaborationSessionId:"c"}}])).toBeUndefined();
  });
  it("routes board resume through the worker host when the session is worker-backed",()=>{
    const usesWorker=(hostId:string)=>hostId!=="local";
    expect(boardResumeUsesWorkerHost({executionHostId:"worker-host"},usesWorker)).toBe(true);
    expect(boardResumeUsesWorkerHost({executionHostId:"local"},usesWorker)).toBe(false);
    expect(boardResumeUsesWorkerHost({executionHostId:null},usesWorker)).toBe(false);
    expect(boardResumeUsesWorkerHost({executionHostId:"local"},()=>true)).toBe(true);
  });
});
