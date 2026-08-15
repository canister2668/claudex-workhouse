import{expect,test}from"@playwright/test";

test("stores previous-conversation visibility per Claude session",async({page})=>{
  await page.addInitScript(()=>{
    if(sessionStorage.getItem("history-preference-fixture")==="ready")return;
    sessionStorage.setItem("history-preference-fixture","ready");
    localStorage.clear();
    localStorage.setItem("claudex-ui-locale","ko");
  });
  const now=new Date().toISOString();
  const task=(id:string,threadId:string,title:string)=>({id,provider:"claude",nativeId:id,threadId,projectId:"project",title,prompt:`${title} 요청`,status:"running",createdAt:now,updatedAt:now,result:null,error:null,log:"",owned:true,ownership:"claudex-workhouse",source:"claudex-workhouse",executionHostId:"local",workspaceId:"workspace",requestedModel:"claude-opus-5",metadata:{}});
  const first=task("history-first","aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","첫 번째 세션");
  const second=task("history-second","bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","두 번째 세션");
  await page.route("**/api/**",async route=>{
    const url=new URL(route.request().url()),pathname=url.pathname,json=(value:unknown)=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(value)});
    if(pathname.endsWith("/events/stream"))return route.fulfill({status:200,contentType:"text/event-stream",body:": ready\n\n"});
    if(pathname==="/api/tasks")return json({tasks:[first,second],partial:false,warnings:[]});
    if(pathname==="/api/tasks/claude/history-first")return json({task:first});
    if(pathname==="/api/tasks/claude/history-second")return json({task:second});
    if(pathname.endsWith("/events"))return json({latestSequence:1,events:[{type:"message_completed",content:"현재 출력",sequence:1,metadata:{role:"agent",phase:"commentary"}}]});
    if(pathname==="/api/projects")return json({projects:[{id:"project",name:"Project",enabled:true,error:null}]});
    if(pathname==="/api/hosts")return json({hosts:[{id:"local",displayName:"Local",status:"online"}]});
    if(pathname==="/api/workspaces")return json({workspaces:[{id:"workspace",projectId:"project",hostId:"local",displayName:"Workspace",canonicalPath:"/workspace"}]});
    if(pathname==="/api/collaborations")return json({collaborations:[]});
    if(pathname==="/api/providers/codex/models")return json({catalog:{models:[],permissions:[]}});
    if(pathname==="/api/providers/claude/permissions")return json({models:[],permissions:[],efforts:[],catalog:{models:[],stale:false}});
    if(pathname==="/api/provider-connections"||pathname==="/api/provider-connections/attempts")return json({accounts:[],attempts:[]});
    if(pathname==="/api/quota")return json({claude:{},codex:{},fetchedAt:now});
    if(pathname==="/api/emotion")return json({state:{},codexState:{},outfits:[],assets:[],mode:"catch"});
    if(pathname==="/api/push")return json({preferences:{},publicKey:""});
    if(pathname.startsWith("/api/system-settings/"))return json({settings:null,candidates:{claude:[],codex:[]}});
    return json({});
  });

  const show=()=>page.getByRole("button",{name:/이전 대화 표시/});
  const hide=()=>page.getByRole("button",{name:/이전 대화 숨기기/});
  await page.goto("/?task=history-first");
  await expect(show()).toBeVisible();
  await show().click();
  await expect(hide()).toBeVisible();

  await page.goto("/?task=history-second");
  await expect(show()).toBeVisible();

  await page.goto("/?task=history-first");
  await expect(hide()).toBeVisible();
});

test("stores previous-conversation visibility per Codex session",async({page})=>{
  test.setTimeout(60_000);
  await page.addInitScript(()=>{
    if(sessionStorage.getItem("codex-history-preference-fixture")==="ready")return;
    sessionStorage.setItem("codex-history-preference-fixture","ready");
    localStorage.clear();
    localStorage.setItem("claudex-ui-locale","ko");
  });
  const now=new Date().toISOString();
  const task=(id:string,threadId:string,title:string)=>({id,provider:"codex",nativeId:id,threadId,projectId:"project",title,prompt:`${title} 요청`,status:"running",createdAt:now,updatedAt:now,result:null,error:null,log:"",owned:true,ownership:"claudex-workhouse",source:"claudex-workhouse",executionHostId:"local",workspaceId:"workspace",requestedModel:"gpt-5.6-sol",metadata:{}});
  const first=task("codex-history-first","cccccccc-cccc-4ccc-8ccc-cccccccccccc","첫 번째 Codex 세션");
  const second=task("codex-history-second","dddddddd-dddd-4ddd-8ddd-dddddddddddd","두 번째 Codex 세션");
  const session=(item:ReturnType<typeof task>)=>({threadId:item.threadId,taskId:item.id,projectId:item.projectId,title:item.title,preview:item.prompt,source:item.source,ownership:item.ownership,status:item.status,updatedAt:item.updatedAt,canMutate:true,canStop:true,workspaceId:item.workspaceId,executionHostId:item.executionHostId,requestedModel:item.requestedModel,metadata:{}});
  await page.route("**/api/**",async route=>{
    const url=new URL(route.request().url()),pathname=url.pathname,json=(value:unknown)=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(value)});
    if(pathname.endsWith("/events/stream"))return route.fulfill({status:200,contentType:"text/event-stream",body:": ready\n\n"});
    if(pathname==="/api/tasks")return json({tasks:[first,second],partial:false,warnings:[]});
    if(pathname==="/api/tasks/codex/codex-history-first")return json({task:first});
    if(pathname==="/api/tasks/codex/codex-history-second")return json({task:second});
    if(pathname==="/api/codex/threads")return json({sessions:[session(first),session(second)],nextCursor:null,stale:false,syncedAt:now,capabilities:{delete:true}});
    if(pathname.endsWith("/turns"))return json({turns:[],nextCursor:null});
    if(pathname.endsWith("/events"))return json({latestSequence:1,events:[{type:"message_completed",content:"현재 출력",sequence:1,metadata:{role:"agent",phase:"commentary"}}]});
    if(pathname==="/api/projects")return json({projects:[{id:"project",name:"Project",enabled:true,error:null}]});
    if(pathname==="/api/hosts")return json({hosts:[{id:"local",displayName:"Local",status:"online"}]});
    if(pathname==="/api/workspaces")return json({workspaces:[{id:"workspace",projectId:"project",hostId:"local",displayName:"Workspace",canonicalPath:"/workspace"}]});
    if(pathname==="/api/collaborations")return json({collaborations:[]});
    if(pathname==="/api/providers/codex/models")return json({catalog:{models:[],permissions:[]}});
    if(pathname==="/api/providers/claude/permissions")return json({models:[],permissions:[],efforts:[],catalog:{models:[],stale:false}});
    if(pathname==="/api/provider-connections"||pathname==="/api/provider-connections/attempts")return json({accounts:[],attempts:[]});
    if(pathname==="/api/quota")return json({claude:{},codex:{},fetchedAt:now});
    if(pathname==="/api/emotion")return json({state:{},codexState:{},outfits:[],assets:[],mode:"catch"});
    if(pathname==="/api/push")return json({preferences:{},publicKey:""});
    if(pathname.startsWith("/api/system-settings/"))return json({settings:null,candidates:{claude:[],codex:[]}});
    return json({});
  });

  const show=()=>page.getByRole("button",{name:/이전 대화 표시/});
  const hide=()=>page.getByRole("button",{name:/이전 대화 숨기기/});
  await page.goto("/?task=codex-history-first");
  await expect(show()).toBeVisible({timeout:15_000});
  await show().click();
  await expect(hide()).toBeVisible();

  await page.goto("/?task=codex-history-second");
  await expect(show()).toBeVisible({timeout:15_000});

  await page.goto("/?task=codex-history-first");
  await expect(hide()).toBeVisible({timeout:15_000});
});
