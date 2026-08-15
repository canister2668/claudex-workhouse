import{describe,expect,it}from"vitest";
import{mergePersistedImageOutputs,persistedImageOutputEvents,persistedImageOutputsFromEvents}from"../../src/server/image-outputs.js";
import type{AgentEvent}from"../../src/server/types.js";

describe("durable image outputs",()=>{
  it("persists only bounded relative image paths with their source task",()=>{
    const events=[
      {type:"tool_completed",content:"imageView",taskId:"codex:one",threadId:"thread",turnId:"turn",itemId:"image",metadata:{itemType:"imageView",mediaKind:"image",mediaPath:"docs/preview.png",mediaPathBase:"task-cwd"}},
      {type:"tool_completed",content:"imageView",taskId:"codex:one",metadata:{mediaKind:"image",mediaPath:"../secret.png",mediaPathBase:"task-cwd"}},
      {type:"tool_completed",content:"imageView",taskId:"codex:one",metadata:{mediaKind:"image",mediaPath:"/private/secret.png",mediaPathBase:"task-cwd"}}
    ] as AgentEvent[];
    expect(persistedImageOutputsFromEvents(events,{workspaceId:"workspace"})).toEqual([expect.objectContaining({itemId:"image",turnId:"turn",threadId:"thread",mediaPath:"docs/preview.png",sourceTaskId:"codex:one",workspaceId:"workspace"})]);
  });

  it("deduplicates id-less images by turn, source task, base and path",()=>{
    const image={itemId:null,turnId:"turn",threadId:"thread",itemType:"imageView",mediaPath:"out/a.png",mediaPathBase:"task-cwd",sourceTaskId:"codex:one",workspaceId:"workspace",timestamp:null};
    expect(mergePersistedImageOutputs([image],[image])).toHaveLength(1);
  });

  it("deduplicates the same visible image when repeated view calls have different item ids",()=>{
    const first={itemId:"view-1",turnId:"turn",threadId:"thread",itemType:"imageView",mediaPath:"out/a.png",mediaPathBase:"task-cwd",sourceTaskId:"codex:one",workspaceId:"workspace",timestamp:"2026-08-12T00:00:00.000Z"};
    const repeated={...first,itemId:"view-2",timestamp:"2026-08-12T00:00:01.000Z"};
    expect(mergePersistedImageOutputs([first,repeated])).toEqual([expect.objectContaining({itemId:"view-2",mediaPath:"out/a.png"})]);
  });

  it("preserves the same path when it is shown again in another turn",()=>{
    const first={itemId:"view-1",turnId:"turn-1",threadId:"thread",itemType:"imageView",mediaPath:"out/a.png",mediaPathBase:"task-cwd",sourceTaskId:"codex:one",workspaceId:"workspace",timestamp:null};
    expect(mergePersistedImageOutputs([first,{...first,itemId:"view-2",turnId:"turn-2"}])).toHaveLength(2);
  });

  it("recreates renderable events after the transient stream is gone",()=>{
    const events=persistedImageOutputEvents([{itemId:"image",turnId:"turn",threadId:"thread",itemType:"imageGeneration",mediaPath:"out/a.jpg",mediaPathBase:"task-cwd",sourceTaskId:"codex:one",workspaceId:"workspace",timestamp:"2026-08-02T00:00:00.000Z"}]);
    expect(events).toEqual([expect.objectContaining({type:"tool_completed",content:"imageGeneration",metadata:expect.objectContaining({mediaKind:"image",mediaPath:"out/a.jpg",sourceTaskId:"codex:one",mediaWorkspaceId:"workspace",durableImageOutput:true})})]);
  });

  it("preserves task-managed generated images",()=>{
    const [event]=persistedImageOutputEvents([{itemId:"generated",turnId:"turn",threadId:"thread",itemType:"imageGeneration",mediaPath:"hash/image.png",mediaPathBase:"task-output",sourceTaskId:"codex:one",workspaceId:"workspace",timestamp:null}]);
    expect(event?.metadata).toMatchObject({mediaKind:"image",mediaPathBase:"task-output",sourceTaskId:"codex:one"});
  });

  it("keeps prior-turn images out of a new task's active stream",()=>{
    const outputs=[
      {itemId:"old",turnId:"turn-old",threadId:"thread",itemType:"imageView",mediaPath:"out/old.png",mediaPathBase:"task-cwd",sourceTaskId:"codex:old",workspaceId:"workspace",timestamp:null},
      {itemId:"new",turnId:"turn-new",threadId:"thread",itemType:"imageView",mediaPath:"out/new.png",mediaPathBase:"task-cwd",sourceTaskId:"codex:new",workspaceId:"workspace",timestamp:null}
    ];
    expect(persistedImageOutputEvents(outputs,"codex:new").map(event=>event.metadata?.mediaPath)).toEqual(["out/new.png"]);
    expect(persistedImageOutputEvents(outputs).map(event=>event.metadata?.mediaPath)).toEqual(["out/old.png","out/new.png"]);
  });
});
