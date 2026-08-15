import{expect,test}from"@playwright/test";

test("keeps Claude context compacted instead of restoring a legacy cumulative 100 percent",async({page})=>{
  await page.addInitScript(()=>localStorage.setItem("claudex-ui-locale","ko"));
  const now=new Date().toISOString();
  const compacted={usedTokens:null,windowTokens:1_000_000,percent:null,updatedAt:"2026-07-26T05:00:00.000Z",lastCompactedAt:"2026-07-26T05:00:00.000Z",compactionTrigger:"auto"};
  const corrupt={usedTokens:7_831_000,windowTokens:200_000,percent:100,updatedAt:"2026-07-26T05:00:01.000Z"};
  const task={
    id:"context-task",provider:"claude",nativeId:"context-task",
    threadId:"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",projectId:"project",
    title:"Claude context compaction",prompt:"계속 진행해",status:"completed",
    createdAt:now,updatedAt:now,result:"done",error:null,log:"",
    owned:true,ownership:"claudex-workhouse",source:"claudex-workhouse",
    executionHostId:"local",workspaceId:"workspace",requestedModel:"claude-opus-5",
    metadata:{contextUsage:corrupt},
  };
  await page.route("**/api/**",async route=>{
    const url=new URL(route.request().url()),pathname=url.pathname;
    const json=(value:unknown)=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(value)});
    if(pathname==="/api/tasks")return json({tasks:[task],partial:false,warnings:[]});
    if(pathname==="/api/tasks/claude/context-task/events")return json({latestSequence:4,events:[
      {type:"unknown",content:"Claude context usage updated.",sequence:1,metadata:{nativeMethod:"claude/contextUsage/updated",contextUsage:{usedTokens:716_000,windowTokens:200_000,percent:100,updatedAt:"2026-07-26T04:59:00.000Z"}}},
      {type:"context_compaction",content:"Claude context compacted.",sequence:2,metadata:{trigger:"auto",contextUsage:compacted}},
      {type:"unknown",content:"Claude context usage updated.",sequence:3,metadata:{nativeMethod:"claude/contextUsage/updated",contextUsage:corrupt}},
      {type:"task_completed",content:"done",sequence:4,terminal:true,metadata:{nativeType:"result"}},
    ]});
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

  await page.goto("/?task=context-task");
  const meter=page.locator(".context-meter");
  await expect(meter.locator(".context-summary")).toContainText("컨텍스트 정리됨");
  await expect(meter.locator(".context-summary")).not.toContainText("100%");
  await expect(meter.locator(".context-window-card")).toHaveCount(0);
  await meter.locator(".context-summary").click();
  await expect(meter.locator(".context-summary")).toHaveCount(0);
  await expect(meter.locator(".context-window-card")).toContainText("다음 응답 후 사용량 갱신");
  await expect(meter.locator(".context-window-card")).toBeFocused();
  await meter.locator(".context-window-card").click();
  await expect(meter.locator(".context-window-card")).toHaveCount(0);
  await expect(meter.locator(".context-summary")).toBeVisible();
  await expect(meter.locator(".context-summary")).toBeFocused();
});
