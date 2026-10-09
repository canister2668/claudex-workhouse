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
  const panel=page.locator(".agent-popover");
  await expect(panel.getByRole("alert")).toContainText(/Not available|사용할 수 없음/);
  await panel.getByRole("button",{name:/Retry|다시 시도/}).click();
  await expect.poll(()=>providerReads).toBe(2);
  await expect(panel.getByRole("button",{name:/아바타에서 복구된 세션/})).toBeVisible();

  // On phones the agent popover is a modal sheet over a backdrop; dismiss it
  // before switching views (the desktop popover is non-modal and stays open).
  if(await page.locator(".agent-pop-backdrop").isVisible()){await panel.press("Escape");await expect(panel).toHaveCount(0);}
  await page.getByRole("button",{name:/Collaboration Board|협업 게시판/}).click();
  await expect(page.locator(".board-page")).toBeVisible();
  await page.locator(".agent-avatar-slot.codex").getByRole("button").first().click();
  await page.locator(".agent-popover").getByRole("button",{name:/아바타에서 복구된 세션/}).click();
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
  await expect(page.locator(".agent-popover")).toContainText("즉시 보이는 Codex 작업",{timeout:1000});
  await expect(page.locator(".agent-popover")).toContainText("동기화된 Codex 작업",{timeout:4000});
  expect(taskRequests).toContain("?snapshot=true");
  expect(taskRequests).toContain("?provider=codex&snapshot=true");

});

test("home recent completed orders every provider by time and shows the model badge",async({page})=>{
  const at=(minutes:number)=>new Date(Date.now()-minutes*60_000).toISOString(),now=at(0);
  const row=(provider:string,index:number,minutes:number,model:string)=>({id:`${provider}:recent-${index}`,provider,nativeId:`recent-${index}`,threadId:`55555555-5555-4555-8555-${String(index).padStart(12,"0")}`,projectId:"claudex-workhouse",title:`${provider} 완료 ${index}`,prompt:"fixture",status:"completed",createdAt:at(minutes),updatedAt:at(minutes),result:"done",error:null,log:"",owned:true,ownership:"claudex-workhouse",source:"claudex-workhouse",executionHostId:"local",workspaceId:"workspace-test",requestedModel:model,requestedReasoningEffort:"high",metadata:{}});
  // The snapshot lists every older Codex row before the newer Claude row,
  // which is the order the client store keeps after a page reload.
  const tasks=[...[1,2,3,4,5].map(index=>row("codex",index,60+index,"gpt-5.5")),row("claude",9,5,"claude-opus-5-5")];
  await page.route("**/api/**",async route=>{
    const url=new URL(route.request().url()),pathname=url.pathname,json=(value:unknown,status=200)=>route.fulfill({status,contentType:"application/json",body:JSON.stringify(value)});
    if(pathname==="/api/tasks"){const provider=url.searchParams.get("provider");return json({tasks:provider?tasks.filter(task=>task.provider===provider):tasks,partial:false,warnings:[],snapshot:url.searchParams.get("snapshot")==="true"});}
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
    if(pathname==="/api/provider-connections")return json({accounts:[{provider:"codex",state:"connected",checkedAt:now},{provider:"claude",state:"connected",checkedAt:now}],attempts:[]});
    if(pathname==="/api/provider-connections/attempts")return json({attempts:[]});
    if(pathname==="/api/quota")return json({claude:{},codex:{},fetchedAt:now});
    if(pathname==="/api/emotion")return json({state:{},codexState:{},outfits:[],assets:[],mode:"catch"});
    if(pathname==="/api/push")return json({preferences:{},publicKey:""});
    if(pathname==="/api/setup")return json({required:false});
    return json({});
  });

  await page.goto("/");
  const recent=page.locator(".overview-recent-list button");
  await expect(recent).toHaveCount(5);
  await expect(recent.first()).toContainText("claude 완료 9");
  await expect(recent.first().locator(".session-model-chip.model")).toBeVisible();
  await expect(recent.nth(1).locator(".session-model-chip.model")).toHaveText("gpt-5.5");
  // Home rows reuse the session-list provider badge rather than a new color treatment.
  await expect(recent.first().locator(".meta .engine.claude")).toBeVisible();
  await expect(recent.nth(1).locator(".meta .engine.codex")).toBeVisible();
  const chipBackground=(index:number)=>recent.nth(index).locator(".session-model-chip.model").evaluate(element=>getComputedStyle(element).backgroundColor);
  expect(await chipBackground(0)).not.toBe(await chipBackground(1));
  await page.locator(".overview-recent").screenshot({path:test.info().outputPath("home-recent.png")});
  await page.locator("nav").getByRole("button",{name:/^(Sessions|세션)$/}).first().click();
  const card=page.locator(".session-card").filter({hasText:"claude 완료 9"});
  await expect(card.locator(".session-model-badges[data-provider=claude] .session-model-chip.model")).toBeVisible();
  await page.locator(".session-card").first().screenshot({path:test.info().outputPath("session-card.png")});
});
