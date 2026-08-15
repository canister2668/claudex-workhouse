import{expect,test}from"@playwright/test";

test("session list separates task-linked and unattributed dirty files",async({page})=>{
  await page.addInitScript(()=>{localStorage.setItem("claudex-ui-locale","ko");class SilentEventSource{constructor(public url:string){}addEventListener(){}close(){}}Object.defineProperty(globalThis,"EventSource",{value:SilentEventSource,configurable:true});});
  const now=new Date().toISOString(),tasks=[
    {id:"claude:linked",provider:"claude",nativeId:"linked",threadId:"linked-thread",projectId:"project",title:"연관 변경 작업",status:"completed",createdAt:now,updatedAt:now,owned:true,ownership:"claudex-workhouse",source:"claudex-workhouse",executionHostId:"local",workspaceId:"workspace",metadata:{gitAttribution:{version:2,capturedAt:now,observedFiles:["app/linked.ts","app/committed.ts"],dirtyFilesAtCapture:["app/linked.ts"],commitAtCapture:"abcdef1234567890"}}},
    {id:"codex:linked",provider:"codex",nativeId:"codex-linked",threadId:"codex-thread",projectId:"project",title:"Codex 변경 작업",status:"completed",createdAt:now,updatedAt:now,owned:true,ownership:"claudex-workhouse",source:"claudex-workhouse",executionHostId:"local",workspaceId:"workspace",metadata:{gitAttribution:{version:2,capturedAt:now,observedFiles:["app/codex.ts"],dirtyFilesAtCapture:["app/codex.ts"],commitAtCapture:null}}},
    {id:"antigravity:linked",provider:"antigravity",nativeId:"gemini-linked",threadId:"gemini-thread",projectId:"project",title:"Gemini 변경 작업",status:"completed",createdAt:now,updatedAt:now,owned:true,ownership:"claudex-workhouse",source:"claudex-workhouse",executionHostId:"local",workspaceId:"workspace",metadata:{gitAttribution:{version:2,capturedAt:now,observedFiles:["app/gemini.ts"],dirtyFilesAtCapture:["app/gemini.ts"],commitAtCapture:null}}},
    {id:"deepseek:linked",provider:"deepseek",nativeId:"deepseek-linked",threadId:"deepseek-thread",projectId:"project",title:"DeepSeek 변경 작업",status:"completed",createdAt:now,updatedAt:now,owned:true,ownership:"claudex-workhouse",source:"claudex-workhouse",executionHostId:"local",workspaceId:"workspace",metadata:{gitAttribution:{version:2,capturedAt:now,observedFiles:["app/deepseek.ts"],dirtyFilesAtCapture:["app/deepseek.ts"],commitAtCapture:null}}},
    {id:"ollama:linked",provider:"ollama",nativeId:"ollama-linked",threadId:"ollama-thread",projectId:"project",title:"Ollama 변경 작업",status:"completed",createdAt:now,updatedAt:now,owned:true,ownership:"claudex-workhouse",source:"claudex-workhouse",executionHostId:"local",workspaceId:"workspace",metadata:{gitAttribution:{version:2,capturedAt:now,observedFiles:["app/ollama.ts"],dirtyFilesAtCapture:["app/ollama.ts"],commitAtCapture:null}}},
    {id:"claude:other",provider:"claude",nativeId:"other",threadId:"other-thread",projectId:"project",title:"다른 작업",status:"completed",createdAt:now,updatedAt:now,owned:true,ownership:"claudex-workhouse",source:"claudex-workhouse",executionHostId:"local",workspaceId:"workspace",metadata:{}}
  ];
  await page.route("**/api/**",async route=>{
    const url=new URL(route.request().url()),pathname=url.pathname,json=(value:unknown)=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(value)});
    if(pathname==="/api/bootstrap/owner-claim/status")return json({required:false});
    if(pathname==="/api/system-settings/locale")return json({locale:"ko",saved:true,existingInstallation:true});
    if(pathname==="/api/tasks"){const provider=url.searchParams.get("provider");return json({tasks:provider?tasks.filter(task=>task.provider===provider):tasks,partial:false,warnings:[]});}
    if(pathname==="/api/projects")return json({projects:[{id:"project",name:"Project",enabled:true}]});
    if(pathname==="/api/hosts")return json({hosts:[{id:"local",displayName:"NAS",status:"online"}]});
    if(pathname==="/api/workspaces")return json({workspaces:[{id:"workspace",projectId:"project",hostId:"local",displayName:"Workhouse",canonicalPath:"/workspace",lastVerifiedAt:now,lastGitStatus:{repository:true,dirty:true,changedFiles:["app/linked.ts","app/codex.ts","app/gemini.ts","app/deepseek.ts","app/ollama.ts","app/unattributed.ts"],ahead:0,behind:0,branch:"main",commit:"abcdef"}}]});
    if(pathname==="/api/collaborations")return json({collaborations:[]});
    if(pathname==="/api/conversation-documents")return json({documents:[]});
    if(pathname==="/api/quota-reservations")return json({reservations:[]});
    if(pathname==="/api/provider-connections"||pathname==="/api/provider-connections/attempts")return json({accounts:[],attempts:[]});
    if(pathname==="/api/quota")return json({claude:{},codex:{},fetchedAt:now});
    if(pathname==="/api/emotion")return json({state:{},codexState:{},outfits:[],assets:[],mode:"catch"});
    if(pathname==="/api/push")return json({preferences:{},publicKey:""});
    if(pathname.startsWith("/api/providers/")||pathname.startsWith("/api/system-settings/"))return json({models:[],permissions:[],efforts:[],catalog:{models:[]},settings:null});
    return json({});
  });
  await page.goto("/",{waitUntil:"domcontentloaded"});
  await page.getByRole("navigation",{name:"주요 화면"}).getByRole("button",{name:"세션",exact:true}).click();
  const overview=page.locator(".workspace-git-overview");
  await expect(overview).toContainText("전체 미커밋 6");
  for(const provider of ["Codex","Claude","Gemini","DeepSeek","Ollama"])await expect(overview).toContainText(`${provider} 미커밋 1`);
  await expect(page.locator(".session-card").getByText(/작업 파일|이 작업.*미커밋/)).toHaveCount(0);
  await expect(overview).toContainText("출처 미확인 1개");
  await overview.locator(".workspace-git-toggle").click();
  await expect(overview.locator(".workspace-git-details .session-git-badge")).toHaveCount(0);
  await expect(overview.locator(".workspace-git-provider-detail")).toContainText(["app/codex.ts","app/linked.ts","app/gemini.ts","app/deepseek.ts","app/ollama.ts"]);
  await overview.locator(".workspace-git-toggle").click();
  await page.setViewportSize({width:2000,height:900});
  await expect(overview.locator(".workspace-git-details")).toBeHidden();
  const box=await overview.boundingBox();expect(box?.height).toBeLessThan(80);
  const badgeTops=await overview.locator(".workspace-git-compact-badges .session-git-badge").evaluateAll(nodes=>nodes.map(node=>Math.round(node.getBoundingClientRect().top)));
  expect(Math.max(...badgeTops)-Math.min(...badgeTops)).toBeLessThanOrEqual(2);
});
