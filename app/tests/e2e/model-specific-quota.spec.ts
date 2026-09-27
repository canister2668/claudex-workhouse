import{expect,test}from"@playwright/test";

test("keeps the Spark five-hour pool out of a Sol task panel",async({page})=>{
  await page.addInitScript(()=>{localStorage.clear();localStorage.setItem("claudex-ui-locale","ko");});
  const now=new Date().toISOString(),threadId="eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const task={id:"task-quota-sol",provider:"codex",nativeId:"task-quota-sol",threadId,projectId:"project",title:"Sol quota fixture",prompt:"할당량 표시 확인",status:"completed",createdAt:now,updatedAt:now,result:"완료",error:null,log:"",owned:true,ownership:"claudex-workhouse",source:"claudex-workhouse",executionHostId:"local",workspaceId:"workspace",requestedModel:"gpt-5.6-sol",metadata:{}};
  const session={threadId,taskId:task.id,projectId:task.projectId,title:task.title,preview:task.prompt,source:task.source,ownership:task.ownership,status:task.status,updatedAt:now,canMutate:true,canStop:false,workspaceId:task.workspaceId,executionHostId:"local",requestedModel:task.requestedModel,metadata:{}};
  await page.route("**/api/**",async route=>{
    const pathname=new URL(route.request().url()).pathname,json=(value:unknown)=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(value)});
    if(pathname==="/api/tasks")return json({tasks:[task],partial:false,warnings:[]});
    if(pathname==="/api/tasks/codex/task-quota-sol")return json({task});
    if(pathname==="/api/tasks/codex/task-quota-sol/events")return json({taskId:task.id,status:"completed",latestSequence:2,events:[{type:"message",content:task.prompt,sequence:1,metadata:{role:"user"}},{type:"command_completed",content:"pnpm test",sequence:2,metadata:{exitCode:0}}]});
    if(pathname==="/api/codex/threads")return json({sessions:[session],nextCursor:null,stale:false,syncedAt:now,capabilities:{delete:true}});
    if(pathname.endsWith("/turns"))return json({turns:[],nextCursor:null});
    if(pathname==="/api/projects")return json({projects:[{id:"project",name:"Project",enabled:true,error:null}]});
    if(pathname==="/api/hosts")return json({hosts:[{id:"local",displayName:"Local",status:"online"}]});
    if(pathname==="/api/workspaces")return json({workspaces:[{id:"workspace",projectId:"project",hostId:"local",displayName:"Workspace",canonicalPath:"/workspace"}]});
    if(pathname==="/api/collaborations")return json({collaborations:[]});
    if(pathname==="/api/providers/codex/models")return json({catalog:{models:[],permissions:[]}});
    if(pathname==="/api/providers/claude/permissions")return json({models:[],permissions:[],efforts:[],catalog:{models:[],stale:false}});
    if(pathname==="/api/provider-connections"||pathname==="/api/provider-connections/attempts")return json({accounts:[],attempts:[]});
    if(pathname==="/api/quota")return json({codex:{fiveHour:null,sevenDay:{pct:78,resetsAt:"2026-08-27T00:00:00.000Z",durationMins:10080},modelPools:[{limitId:"codex_bengalfox",label:"Spark",modelIds:["gpt-5.3-codex-spark"],fiveHour:{pct:82,resetsAt:"2026-08-20T08:00:00.000Z",durationMins:300},sevenDay:{pct:14,resetsAt:"2026-08-27T03:00:00.000Z",durationMins:10080}}]},claude:{},fetchedAt:now});
    if(pathname==="/api/emotion")return json({state:{},codexState:{},outfits:[],assets:[],mode:"catch"});
    if(pathname==="/api/push")return json({preferences:{},publicKey:""});
    if(pathname.startsWith("/api/system-settings/"))return json({settings:null,candidates:{claude:[],codex:[]}});
    return json({});
  });
  await page.goto("/?task=task-quota-sol");
  const badge=page.locator(".work-status-badge");
  await expect(badge).toBeVisible({timeout:15_000});
  await badge.click();
  const quota=page.locator(".work-status-panel .provider-quota");
  await expect(quota).toContainText(/주간 할당량|Weekly Quota/);
  await expect(quota).toContainText("78%");
  await expect(quota).not.toContainText("82%");
  await expect(quota).not.toContainText("Spark");

  const quotaTrigger=page.locator('[data-popup-trigger="quota"]');
  if(!await quotaTrigger.isVisible())await page.locator('[data-popup-trigger="overflow"]').click();
  await quotaTrigger.click();
  const sparkPool=page.locator(".quota-pop .quota-model-pool").filter({hasText:"Spark"});
  const sparkTrack=sparkPool.locator(".qbar").first();
  await expect(sparkTrack).toBeVisible();
  const colors=await sparkTrack.evaluate(element=>({
    track:getComputedStyle(element).backgroundColor,
    pool:getComputedStyle(element.closest(".quota-model-pool")!).backgroundColor,
  }));
  expect(colors.track).not.toBe(colors.pool);
});
