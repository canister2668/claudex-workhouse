import{expect,test}from"@playwright/test";

test("full history search filters stored rows and opens the exact matched output card",async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem("claudex-ui-locale","ko");
    class QuietEventSource{constructor(_url:string){}addEventListener(){}close(){}}
    (globalThis as any).EventSource=QuietEventSource;
  });
  const now="2026-07-29T09:00:00.000Z",workspace={id:"workspace-old",projectId:"project",hostId:"local",displayName:"Old Workspace",canonicalPath:"/workspace"};
  const exact:any={id:"claude:old-result",provider:"claude",nativeId:"old-result",threadId:"thread-old",projectId:"project",title:"오래된 검색 fixture",prompt:"과거 사용자 질문",status:"completed",createdAt:now,updatedAt:now,result:"정확한 최종 출력 문장",error:null,log:"",owned:true,ownership:"claudex-workhouse",source:"claudex-workhouse",executionHostId:"local",workspaceId:workspace.id,metadata:{}};
  let searchUrl:URL|null=null;
  await page.route("**/api/**",async route=>{
    const url=new URL(route.request().url()),pathname=url.pathname,json=(value:unknown)=>route.fulfill({contentType:"application/json",body:JSON.stringify(value)});
    if(pathname==="/api/history/search"){searchUrl=url;return json({results:[{id:"task:claude:old-result",source:"workhouse",provider:"claude",taskId:exact.id,threadId:exact.threadId,projectId:"project",workspaceId:workspace.id,title:exact.title,status:"completed",updatedAt:now,matchField:"result",snippet:exact.result,before:"",match:"정확한 최종 출력",after:" 문장"}],nextCursor:null,strategy:"local-unified-index",serverElapsedMs:42});}
    if(decodeURIComponent(pathname)==="/api/tasks/claude/claude:old-result/snapshot")return json({task:exact,snapshot:true});
    if(decodeURIComponent(pathname)==="/api/tasks/claude/claude:old-result/events")return json({events:[{type:"message",content:exact.result,timestamp:now,sequence:1,terminal:true,metadata:{role:"agent",section:"result"}}],latestSequence:1,status:"completed"});
    if(pathname==="/api/tasks")return json({tasks:[],partial:false,warnings:[]});
    if(pathname==="/api/projects")return json({projects:[{id:"project",name:"Project",enabled:true,error:null}]});
    if(pathname==="/api/workspaces"||pathname==="/api/location-options")return json({projects:[{id:"project",name:"Project",enabled:true,error:null}],workspaces:[workspace]});
    if(pathname==="/api/hosts")return json({hosts:[{id:"local",type:"local",displayName:"Local",platform:"linux",architecture:"x64",status:"online",capabilities:{}}]});
    if(pathname==="/api/providers/codex/models")return json({catalog:{models:[],permissions:[]}});
    if(pathname==="/api/providers/claude/permissions")return json({permissions:[{id:":read-only"}],models:[],efforts:[],catalog:{models:[]}});
    if(pathname==="/api/collaborations")return json({collaborations:[]});
    if(pathname==="/api/quota-reservations")return json({reservations:[]});
    if(pathname==="/api/provider-connections"||pathname==="/api/provider-connections/attempts")return json({singleUser:true,accounts:[],attempts:[]});
    if(pathname==="/api/quota")return json({claude:{},codex:{}});
    if(pathname==="/api/emotion")return json({state:null,codexState:null,outfits:[]});
    if(pathname==="/api/approvals")return json({approvals:[],capabilities:{codex:true,claude:false},checkedAt:now});
    if(pathname==="/api/user-input")return json({requests:[],capabilities:{codex:true,claude:false},checkedAt:now});
    if(pathname.startsWith("/api/system-settings/"))return json({settings:null,candidates:{claude:[],codex:[]}});
    return json({});
  });
  await page.goto("/");
  if((page.viewportSize()?.width??0)<=599)await page.getByRole("button",{name:"추가 작업"}).click();
  await page.getByRole("button",{name:"검색 열기"}).click();
  await page.getByPlaceholder("전체 작업 검색 · 제목·요청·결과·오류").fill("정확한 최종 출력");
  await page.locator(".history-search-filters label").filter({hasText:"Provider"}).locator("select").selectOption("claude");
  await page.locator(".history-search-filters").getByLabel("작업공간").selectOption(workspace.id);
  await expect(page.getByText("오래된 검색 fixture")).toBeVisible();
  await expect(page.locator(".history-search-timing")).toContainText("서버 검색 42ms");
  expect(searchUrl?.searchParams.get("provider")).toBe("claude");
  expect(searchUrl?.searchParams.get("workspaceId")).toBe(workspace.id);
  await page.getByText("오래된 검색 fixture").click();
  const target=page.locator(".bubble.agent.history-search-target");
  await expect(target).toContainText(exact.result);
  await expect(page.locator(".task-heading")).toContainText(exact.title);
});
