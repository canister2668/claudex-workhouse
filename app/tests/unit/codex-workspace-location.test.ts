import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach,describe,expect,it,vi} from "vitest";
import {CodexProvider,codexThreadPreview,newestActiveCodexTask,newestCodexThreadSettings,resolveCodexThreadLocation} from "../../src/server/providers/codex.js";

const roots:string[]=[];
afterEach(()=>{vi.restoreAllMocks();for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
function temporaryRoot(){const value=fs.mkdtempSync(path.join(os.tmpdir(),"claudex-workhouse-location-"));roots.push(value);return value;}

const validated={model:"gpt-test",reasoningEffort:"medium",serviceTier:null,permissionProfile:":workspace"};

describe("Codex workspace location persistence",()=>{
  it("uses the active task prompt instead of an older native thread preview",()=>{
    expect(codexThreadPreview(
      {prompt:"가장 최근 입력"},
      {preview:"캐시된 이전 입력"},
      {preview:"최초 입력"}
    )).toBe("가장 최근 입력");
    expect(codexThreadPreview(null,{preview:"캐시된 최근 입력"},{preview:"최초 입력"})).toBe("캐시된 최근 입력");
  });

  it("selects the newest active prompt when a thread briefly has overlapping task rows",()=>{
    const task=(id:string,status:string,createdAt:string,prompt:string)=>({id,status,createdAt,prompt} as any);
    expect(newestActiveCodexTask([
      task("old","running","2026-07-25T11:00:00.000Z","이전 입력"),
      task("done","completed","2026-07-25T12:00:00.000Z","완료 입력"),
      task("new","queued","2026-07-25T13:00:00.000Z","최신 입력")
    ])).toMatchObject({id:"new",prompt:"최신 입력"});
  });

  it("keeps a newer saved reasoning effort regardless of linked task order",()=>{
    const current:any={requestedModel:"gpt-5.6-sol",requestedReasoningEffort:"medium",requestedServiceTier:"priority",permissionProfile:":workspace",settingsUpdatedAt:"2026-07-28T02:00:00.000Z",metadata:{automationLevel:"auto",workMode:"default"}};
    const older=(id:string,createdAt:string):any=>({id,provider:"codex",requestedModel:"gpt-5.6-sol",requestedReasoningEffort:"ultra",requestedServiceTier:"priority",permissionProfile:":danger-full-access",settingsUpdatedAt:"2026-07-28T01:00:00.000Z",metadata:{automationLevel:"full",workMode:"default"},createdAt});
    expect(newestCodexThreadSettings(current,[older("one","2026-07-28T01:10:00.000Z"),older("two","2026-07-28T01:20:00.000Z")])).toBe(current);
    expect(newestCodexThreadSettings(current,[older("two","2026-07-28T01:20:00.000Z"),older("one","2026-07-28T01:10:00.000Z")])).toBe(current);
  });

  it("publishes validated thread settings to the list cache before persistence",async()=>{
    const directory=temporaryRoot(),stored:any={threadId:"thread",requestedModel:"gpt-test",requestedReasoningEffort:"ultra",requestedServiceTier:null,permissionProfile:":workspace",settingsUpdatedAt:"2026-07-28T01:00:00.000Z",metadata:{automationLevel:"auto"}};
    const db={getCodexThread:async()=>stored,upsertCodexThread:async(row:any)=>row};
    const provider=new CodexProvider({dataDir:directory,root:directory,projects:[]} as any,db as any);(provider as any).catalog.validate=async()=>({...validated,reasoningEffort:"medium"});
    (provider as any).threadSnapshots.set(false,{threads:new Map([["thread",stored]]),loadedAt:Date.now(),syncedAt:null});(provider as any).pendingThreadCacheRows.set("thread",stored);
    const updated=await provider.updateThreadSettings("thread",{model:"gpt-test",reasoningEffort:"medium"},false);
    expect(updated.requestedReasoningEffort).toBe("medium");
    expect((provider as any).threadSnapshots.get(false).threads.get("thread")).toBe(updated);
    expect((provider as any).pendingThreadCacheRows.has("thread")).toBe(false);
  });

  it("recovers the first thread-list location from its persisted task",()=>{
    expect(resolveCodexThreadLocation(
      {id:"thread",cwd:null},
      null,
      {id:"task",threadId:"thread",projectId:"project",cwd:"/workspace",executionHostId:"local",workspaceId:"workspace"}
    )).toEqual({projectId:"project",cwd:"/workspace",executionHostId:"local",workspaceId:"workspace",canMutate:true});
  });

  it("treats a remote Workspace identity as resumable even without a local cwd",()=>{
    expect(resolveCodexThreadLocation(
      {id:"thread",cwd:null},
      null,
      {id:"task",threadId:"thread",projectId:"project",cwd:null,executionHostId:"worker",workspaceId:"remote-workspace"}
    )).toMatchObject({executionHostId:"worker",workspaceId:"remote-workspace",canMutate:true});
  });

  it("updates both thread identity fields and drops legacy approval metadata",async()=>{
    let written:any=null;const directory=temporaryRoot(),stored:any={threadId:"thread",projectId:"old-project",cwd:"/old",executionHostId:"local",workspaceId:"old-workspace",permissionProfile:":workspace",metadata:{accessContract:{contractVersion:1,canonicalWorkspacePath:"/old",externalPathScopes:[]},primaryWorkspacePath:"/old",workMode:"default"}};
    const db={getCodexThread:async()=>stored,upsertCodexThread:async(row:any)=>(written=row)};
    const provider=new CodexProvider({dataDir:directory,root:directory,projects:[]} as any,db as any);(provider as any).catalog.validate=async()=>validated;
    await provider.updateThreadSettings("thread",{projectId:"new-project",cwd:"/new",executionHostId:"local",workspaceId:"new-workspace",workspaceChangedAt:"2026-07-17T01:00:00.000Z"});
    expect(written).toMatchObject({projectId:"new-project",cwd:"/new",executionHostId:"local",workspaceId:"new-workspace",metadata:{workspaceId:"new-workspace",executionHostId:"local",workspaceChangedAt:"2026-07-17T01:00:00.000Z",workMode:"default"}});
    expect(written.metadata).not.toHaveProperty("accessContract");
    expect(written.metadata).not.toHaveProperty("primaryWorkspacePath");
  });

  it("keeps an active thread on its current Workspace while storing the next location",async()=>{
    let written:any=null;const directory=temporaryRoot(),stored:any={threadId:"thread",projectId:"old-project",cwd:"/old",executionHostId:"local",workspaceId:"old-workspace",permissionProfile:":workspace",metadata:{accessContract:{contractVersion:1,workspaceId:"old-workspace",canonicalWorkspacePath:"/old",externalPathScopes:[],revision:1}}};
    const db={getCodexThread:async()=>stored,upsertCodexThread:async(row:any)=>(written=row)};const provider=new CodexProvider({dataDir:directory,root:directory,projects:[]} as any,db as any);(provider as any).catalog.validate=async()=>validated;
    await provider.updateThreadSettings("thread",{projectId:"new-project",cwd:"/new",executionHostId:"local",workspaceId:"new-workspace",deferWorkspaceChange:true},true);
    expect(written).toMatchObject({projectId:"old-project",cwd:"/old",workspaceId:"old-workspace",metadata:{nextProjectId:"new-project",nextWorkspaceId:"new-workspace",nextCanonicalWorkspacePath:"/new"}});
    expect(written.metadata).not.toHaveProperty("accessContract");
    expect(written.metadata).not.toHaveProperty("nextAccessContract");
  });

  it("does not let an older worker snapshot restore the previous workspace",async()=>{
    let writtenThread:any=null;const directory=temporaryRoot(),changedAt="2026-07-17T01:00:00.000Z",stored:any={threadId:"thread",sessionId:"thread",projectId:"new-project",cwd:"/new",executionHostId:"local",workspaceId:"new-workspace",ownership:"claudex-workhouse",status:"running",metadata:{workspaceChangedAt:changedAt,workspaceId:"new-workspace",executionHostId:"local"}};
    const db={upsertTask:async(task:any)=>task,getCodexThread:async()=>stored,upsertCodexThread:async(row:any)=>(writtenThread=row)};
    const provider=new CodexProvider({dataDir:directory,root:directory,projects:[]} as any,db as any),task:any={id:"codex:deck:location",provider:"codex",threadId:"thread",projectId:"old-project",cwd:"/old",executionHostId:"local",workspaceId:"old-workspace",title:"old task",prompt:"first input",status:"running",createdAt:"2026-07-17T00:00:00.000Z",updatedAt:"2026-07-17T00:00:00.000Z",lastSeenAt:"2026-07-17T00:00:00.000Z",result:null,error:null,log:"",pid:null,pgid:null,processStart:null,requestedModel:"gpt-test",requestedReasoningEffort:"medium",requestedServiceTier:null,permissionProfile:":workspace",settingsUpdatedAt:"2026-07-17T00:00:00.000Z",metadata:{accessContract:{contractVersion:1,canonicalWorkspacePath:"/old",externalPathScopes:[]}},commandMarker:"claudex-workhouse-codex:location"};
    fs.writeFileSync(path.join(directory,"codex-jobs","codex_deck_location.json"),JSON.stringify({threadId:"thread",status:"completed",updatedAt:"2026-07-17T00:30:00.000Z",result:"done",error:null,log:"done",pid:null,pgid:null,processStart:null,imageOutputs:[{itemId:"image",turnId:"turn",threadId:"thread",itemType:"imageView",mediaPath:"docs/preview.png",mediaPathBase:"task-cwd",sourceTaskId:"codex:deck:location",workspaceId:"old-workspace",timestamp:"2026-07-17T00:20:00.000Z"}]}));
    await (provider as any).refreshWorker(task);
    expect(writtenThread).toMatchObject({projectId:"new-project",cwd:"/new",executionHostId:"local",workspaceId:"new-workspace",metadata:{workspaceChangedAt:changedAt,workspaceId:"new-workspace"}});
    expect(writtenThread.metadata.imageOutputs).toEqual([expect.objectContaining({mediaPath:"docs/preview.png",sourceTaskId:"codex:deck:location",workspaceId:"old-workspace"})]);
    expect(writtenThread.metadata).not.toHaveProperty("accessContract");
  });

  it("uses the newest saved full-auto policy for the next request in the same thread",async()=>{
    const directory=temporaryRoot(),project={id:"p",name:"p",path:directory,realPath:directory,enabled:true,error:null},thread={threadId:"thread",projectId:"p",cwd:directory,executionHostId:"local",workspaceId:"w",permissionProfile:":read-only",settingsUpdatedAt:"2026-07-17T00:00:00.000Z",metadata:{automationLevel:"read",workMode:"plan"}},task:any={id:"codex:deck:next",provider:"codex",threadId:"thread",projectId:"p",cwd:directory,executionHostId:"local",workspaceId:"w",title:"task",prompt:"first",status:"completed",createdAt:"2026-07-17T00:00:00.000Z",updatedAt:"2026-07-17T00:01:00.000Z",result:"done",error:null,log:"",permissionProfile:":danger-full-access",settingsUpdatedAt:"2026-07-17T01:00:00.000Z",metadata:{automationLevel:"full",workMode:"default"}},db={getCodexThread:async()=>thread,upsertTask:async(row:any)=>row},provider=new CodexProvider({dataDir:directory,root:directory,projects:[project]} as any,db as any),launch=vi.spyOn(provider as any,"launchWorker").mockResolvedValue(task);
    await provider.sendMessage(task,"pwd and read attachment");
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({prompt:"pwd and read attachment",permissionProfile:":danger-full-access",automationLevel:"full",workMode:"default"}),"thread");
  });
});
