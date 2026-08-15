import {expect,test} from "@playwright/test";

test("renames Claude and Codex sessions inline",async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem("claudex-ui-locale","ko");
    class QuietEventSource{onerror:null|(()=>void)=null;constructor(_url:string){setTimeout(()=>this.dispatch("open"),0);}listeners=new Map<string,Array<(event:any)=>void>>();addEventListener(type:string,listener:(event:any)=>void){this.listeners.set(type,[...(this.listeners.get(type)??[]),listener]);}dispatch(type:string){for(const listener of this.listeners.get(type)??[])listener({});}close(){}}
    (globalThis as any).EventSource=QuietEventSource;
  });
  const now=new Date().toISOString(),workspace={id:"workspace",projectId:"project",hostId:"local",displayName:"Workspace",canonicalPath:"/workspace"};
  let claudeTask:any={id:"claude:task",provider:"claude",nativeId:"claude-native",threadId:"22222222-2222-4222-8222-222222222222",projectId:"project",title:"Claude original",prompt:"hello",status:"completed",createdAt:now,updatedAt:now,result:"done",error:null,log:"",owned:true,ownership:"claudex-workhouse",source:"claudex-workhouse",executionHostId:"local",workspaceId:"workspace",metadata:{}};
  let codexTask:any={id:"codex:task",provider:"codex",nativeId:"codex-native",threadId:"11111111-1111-4111-8111-111111111111",projectId:"project",title:"Codex original",prompt:"hello",status:"completed",createdAt:now,updatedAt:now,result:"done",error:null,log:"",owned:true,ownership:"claudex-workhouse",source:"claudex-workhouse",executionHostId:"local",workspaceId:"workspace",metadata:{}};
  let codexSession:any={threadId:codexTask.threadId,taskId:codexTask.id,projectId:"project",title:"Codex original",preview:"hello",source:"claudex-workhouse",ownership:"claudex-workhouse",status:"completed",archived:false,canMutate:true,canStop:false,executionHostId:"local",workspaceId:"workspace",updatedAt:now,metadata:{}};
  const renamed:string[]=[];
  await page.route("**/api/**",async route=>{
    const url=new URL(route.request().url()),pathname=url.pathname,json=(value:any)=>route.fulfill({contentType:"application/json",body:JSON.stringify(value)});
    if(pathname.match(/^\/api\/sessions\/(codex|claude)\/[^/]+\/title$/)){
      const provider=pathname.split("/")[3],title=String(route.request().postDataJSON().title);renamed.push(`${provider}:${title}`);
      if(provider==="claude"){claudeTask={...claudeTask,title,metadata:{customTitle:title}};return json({title,tasks:[claudeTask],thread:null});}
      codexTask={...codexTask,title,metadata:{customTitle:title}};codexSession={...codexSession,title,metadata:{customTitle:title}};return json({title,tasks:[codexTask],thread:codexSession});
    }
    if(pathname==="/api/tasks")return json({tasks:[claudeTask,codexTask]});
    if(pathname==="/api/codex/threads")return json({sessions:[codexSession],nextCursor:null,stale:false,syncedAt:now,capabilities:{search:true,turns:true,settings:true,delete:true}});
    if(pathname.match(/^\/api\/codex\/threads\/[^/]+\/turns$/))return json({turns:[],nextCursor:null});
    if(pathname.match(/^\/api\/tasks\/(codex|claude)\/[^/]+\/events$/))return json({events:[],latestSequence:0,status:"completed"});
    if(pathname==="/api/projects")return json({projects:[{id:"project",name:"Project",enabled:true,error:null}]});
    if(pathname==="/api/workspaces")return json({workspaces:[workspace]});
    if(pathname==="/api/hosts")return json({hosts:[{id:"local",type:"local",displayName:"Local",status:"online",capabilities:{}}]});
    if(pathname==="/api/providers/codex/models")return json({catalog:{models:[{id:"gpt-test",displayName:"GPT Test",isDefault:true,hidden:false,supportedReasoningEfforts:[],serviceTiers:[]}],permissions:[]}});
    if(pathname==="/api/providers/claude/permissions")return json({permissions:[],models:[{id:"default",displayName:"Default"}],efforts:[]});
    if(pathname==="/api/system-settings/locale")return json({locale:"ko",existingInstallation:true});
    if(pathname==="/api/system-settings/characters")return json({settings:{version:1,providers:{codex:{nickname:"Codex"},claude:{nickname:"Claude"}}}});
    if(pathname==="/api/collaborations")return json({collaborations:[]});
    if(pathname==="/api/provider-connections")return json({singleUser:true,accounts:[]});
    if(pathname==="/api/runtime-updates")return json({runtimes:[]});
    if(pathname==="/api/quota")return json({claude:{},codex:{}});
    if(pathname==="/api/emotion")return json({state:null,codexState:null,outfits:[]});
    return json({});
  });
  const openRename=async()=>{
    const expand=page.getByRole("button",{name:"세션 제목 펼치기"});
    if(await expand.isVisible())await expand.click();
    await page.getByRole("button",{name:"세션명 수정"}).click();
  };
  await page.goto("/");
  await page.getByRole("navigation",{name:"주요 화면"}).getByRole("button",{name:"세션",exact:true}).click();
  await page.getByRole("button",{name:/Claude original/}).click();
  await openRename();
  await page.getByLabel("세션명 수정").fill("Claude renamed");
  await page.getByRole("button",{name:"저장",exact:true}).click();
  await expect(page.locator(".detail h1")).toHaveText("Claude renamed");
  await page.getByRole("button",{name:"뒤로",exact:true}).click();
  await page.getByRole("navigation",{name:"엔진 필터"}).getByRole("button",{name:"Codex",exact:true}).click();
  await page.getByRole("button",{name:/Codex original/}).click();
  await openRename();
  await page.getByLabel("세션명 수정").fill("Codex renamed");
  await page.getByRole("button",{name:"저장",exact:true}).click();
  await expect(page.locator(".codex-detail h1")).toHaveText("Codex renamed");
  expect(renamed).toEqual(["claude:Claude renamed","codex:Codex renamed"]);
});
