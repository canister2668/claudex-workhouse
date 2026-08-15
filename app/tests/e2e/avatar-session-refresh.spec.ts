import { expect, test } from "@playwright/test";

test("avatar session panel recovers from an empty cache without reloading the page",async({page})=>{
  const now=new Date().toISOString();
  const task={id:"codex:avatar-refresh",provider:"codex",nativeId:"avatar-refresh",threadId:"33333333-3333-4333-8333-333333333333",projectId:"claudex-workhouse",title:"아바타에서 복구된 세션",prompt:"fixture",status:"completed",createdAt:now,updatedAt:now,result:"done",error:null,log:"",owned:true,ownership:"claudex-workhouse",source:"claudex-workhouse",executionHostId:"local",workspaceId:"workspace-test",metadata:{}};
  let providerReads=0;
  await page.route("**/api/**",async route=>{
    const url=new URL(route.request().url()),pathname=url.pathname,json=(value:unknown,status=200)=>route.fulfill({status,contentType:"application/json",body:JSON.stringify(value)});
    if(pathname==="/api/tasks"){
      if(url.searchParams.get("provider")==="codex"){
        providerReads++;
        if(providerReads===1)return json({tasks:[],partial:true,warnings:[{source:"codex",error:"synchronization_unavailable"}]});
        return json({tasks:[task],partial:false,warnings:[]});
      }
      return json({tasks:[],partial:false,warnings:[]});
    }
    if(pathname==="/api/projects")return json({projects:[{id:"claudex-workhouse",name:"Claudex Workhouse",enabled:true}]});
    if(pathname==="/api/hosts")return json({hosts:[{id:"local",displayName:"Local",status:"online"}]});
    if(pathname==="/api/workspaces")return json({workspaces:[{id:"workspace-test",projectId:"claudex-workhouse",hostId:"local",displayName:"Claudex Workhouse",canonicalPath:"/srv/claudex-workhouse"}]});
    if(pathname==="/api/collaborations")return json({collaborations:[]});
    if(pathname==="/api/providers/codex/models")return json({catalog:{models:[],permissions:[]}});
    if(pathname==="/api/providers/claude/permissions")return json({permissions:[],models:[],efforts:[],catalog:{models:[]}});
    if(pathname==="/api/system-settings/ui-locale")return json({locale:"ko"});
    if(pathname==="/api/system-settings/credit-usage")return json({settings:{version:1,allowPaidCredits:false}});
    if(pathname==="/api/system-settings/models")return json({settings:null,candidates:{claude:[],codex:[]}});
    if(pathname==="/api/system-settings/characters")return json({settings:null});
    if(pathname==="/api/system-settings/path-display")return json({hideLocalPaths:false});
    if(pathname==="/api/provider-connections")return json({accounts:[{provider:"codex",state:"connected",checkedAt:now}],attempts:[]});
    if(pathname==="/api/provider-connections/attempts")return json({attempts:[]});
    if(pathname==="/api/quota")return json({claude:{},codex:{},fetchedAt:now});
    if(pathname==="/api/emotion")return json({state:{},codexState:{},outfits:[],assets:[],mode:"catch"});
    if(pathname==="/api/push")return json({preferences:{},publicKey:""});
    if(pathname==="/api/setup")return json({required:false});
    return json({});
  });

  await page.goto("/");
  await page.locator(".agent-avatar-slot.codex").getByRole("button").first().click();
  const panel=page.locator(".agent-avatar-slot.codex .recent-session-pop");
  await expect(panel.getByRole("alert")).toContainText(/Not available|사용할 수 없음/);
  await panel.getByRole("button",{name:/Retry|다시 시도/}).click();
  await expect.poll(()=>providerReads).toBe(2);
  await expect(panel.getByRole("button",{name:/아바타에서 복구된 세션/})).toBeVisible();

  await page.getByRole("button",{name:/Collaboration Board|협업 게시판/}).click();
  await expect(page.locator(".board-page")).toBeVisible();
  await page.locator(".agent-avatar-slot.codex").getByRole("button").first().click();
  await page.locator(".recent-session-pop").getByRole("button",{name:/아바타에서 복구된 세션/}).click();
  await expect(page.locator(".board-page")).toBeHidden();
});

test("home and Codex avatar use the shared startup snapshot before slow synchronization",async({page})=>{
  const now=new Date().toISOString(),task={id:"codex:startup-active",provider:"codex",nativeId:"startup-active",threadId:"44444444-4444-4444-8444-444444444444",projectId:"claudex-workhouse",title:"즉시 보이는 Codex 작업",prompt:"fixture",status:"running",createdAt:now,updatedAt:now,result:null,error:null,log:"working",owned:true,ownership:"claudex-workhouse",source:"claudex-workhouse",executionHostId:"local",workspaceId:"workspace-test",metadata:{}};
  const taskRequests:string[]=[];let synchronized=false;
  await page.route("**/api/**",async route=>{
    const url=new URL(route.request().url()),pathname=url.pathname,json=(value:unknown,status=200)=>route.fulfill({status,contentType:"application/json",body:JSON.stringify(value)});
    if(pathname==="/api/tasks"){
      taskRequests.push(url.search);
      if(!url.searchParams.has("snapshot")){await new Promise(resolve=>setTimeout(resolve,2000));synchronized=true;}
      const provider=url.searchParams.get("provider"),currentTask={...task,title:synchronized?"동기화된 Codex 작업":task.title};return json({tasks:provider&&provider!=="codex"?[]:[currentTask],partial:false,warnings:[],snapshot:url.searchParams.get("snapshot")==="true"});
    }
    if(pathname==="/api/projects")return json({projects:[{id:"claudex-workhouse",name:"Claudex Workhouse",enabled:true}]});
    if(pathname==="/api/hosts")return json({hosts:[{id:"local",displayName:"Local",status:"online"}]});
    if(pathname==="/api/workspaces")return json({workspaces:[{id:"workspace-test",projectId:"claudex-workhouse",hostId:"local",displayName:"Claudex Workhouse",canonicalPath:"/srv/claudex-workhouse"}]});
    if(pathname==="/api/collaborations")return json({collaborations:[]});
    if(pathname==="/api/conversation-documents")return json({documents:[]});
    if(pathname==="/api/quota-reservations")return json({reservations:[]});
    if(pathname==="/api/providers/codex/models")return json({catalog:{models:[],permissions:[]}});
    if(pathname==="/api/providers/claude/permissions")return json({permissions:[],models:[],efforts:[],catalog:{models:[]}});
    if(pathname==="/api/system-settings/ui-locale")return json({locale:"ko"});
    if(pathname==="/api/system-settings/credit-usage")return json({settings:{version:1,allowPaidCredits:false}});
    if(pathname==="/api/system-settings/models")return json({settings:null,candidates:{claude:[],codex:[]}});
    if(pathname==="/api/system-settings/characters")return json({settings:null});
    if(pathname==="/api/system-settings/path-display")return json({hideLocalPaths:false});
    if(pathname==="/api/provider-connections")return json({accounts:[{provider:"codex",state:"connected",checkedAt:now}],attempts:[]});
    if(pathname==="/api/provider-connections/attempts")return json({attempts:[]});
    if(pathname==="/api/quota")return json({claude:{},codex:{},fetchedAt:now});
    if(pathname==="/api/emotion")return json({state:{},codexState:{},outfits:[],assets:[],mode:"catch"});
    if(pathname==="/api/push")return json({preferences:{},publicKey:""});
    if(pathname==="/api/setup")return json({required:false});
    return json({});
  });

  await page.goto("/");
  await expect(page.locator(".overview-active")).toContainText("즉시 보이는 Codex 작업",{timeout:1000});
  await page.locator(".agent-avatar-slot.codex").getByRole("button").first().click();
  await expect(page.locator(".agent-avatar-slot.codex .recent-session-pop")).toContainText("즉시 보이는 Codex 작업",{timeout:1000});
  await expect(page.locator(".agent-avatar-slot.codex .recent-session-pop")).toContainText("동기화된 Codex 작업",{timeout:4000});
  expect(taskRequests).toContain("?snapshot=true");
  expect(taskRequests).toContain("?provider=codex&snapshot=true");

});
