import{expect,test}from"@playwright/test";

test("wide outcome stays in the side rail while compact views use the acknowledged badge",async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem("claudex-ui-locale","ko");
    class SilentEventSource{onerror:null|(()=>void)=null;constructor(public url:string){}addEventListener(){}close(){}}
    Object.defineProperty(globalThis,"EventSource",{value:SilentEventSource,configurable:true});
  });
  const now=new Date().toISOString();
  const task={id:"outcome-task",provider:"claude",nativeId:"outcome-task",threadId:"dddddddd-dddd-4ddd-8ddd-dddddddddddd",projectId:"project",title:"완료창 fixture",prompt:"완료 결과를 확인해 줘",status:"completed",createdAt:now,updatedAt:now,result:"완료 결과",error:null,log:"",owned:true,ownership:"claudex-workhouse",source:"claudex-workhouse",executionHostId:"local",workspaceId:"workspace",metadata:{}};
  const events=[
    {type:"message",content:task.prompt,metadata:{role:"user"}},
    {type:"file_change_completed",content:"+ outcome fixture",metadata:{path:"src/outcome.ts",pathBase:"task-cwd",additions:1,deletions:0}},
    {type:"file_change_completed",content:"+ image fixture",metadata:{path:"art/result.png",pathBase:"workspace",additions:1,deletions:0}},
    {type:"command_completed",content:"12 tests passed",metadata:{command:"pnpm test",exitCode:0,ok:true,source:"provider"}},
    {type:"message_completed",content:task.result,metadata:{role:"agent",phase:"final_answer"}},
  ];
  await page.route("**/api/**",async route=>{
    const url=new URL(route.request().url()),pathname=url.pathname,json=(value:unknown)=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(value)});
    if(pathname==="/api/workspaces/workspace/files/preview")return route.fulfill({status:200,contentType:"image/png",body:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=","base64")});
    if(pathname==="/api/tasks")return json({tasks:[task],partial:false,warnings:[]});
    if(pathname==="/api/tasks/claude/outcome-task")return json({task});
    if(pathname==="/api/tasks/claude/outcome-task/events")return json({taskId:task.id,status:"completed",latestSequence:4,events});
    if(pathname==="/api/tasks/claude/outcome-task/message-queue")return json({items:[],activeTask:null});
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

  await page.setViewportSize({width:1200,height:900});
  await page.goto("/?task=outcome-task");
  await page.clock.install();
  const desktopOutcome=page.locator(".session-side-rail .outcome-rail");
  await expect(desktopOutcome).toBeVisible();
  await expect(desktopOutcome).toContainText("변경 파일 2");
  await expect(desktopOutcome).toContainText("검증 결과 1");
  await expect(desktopOutcome.getByRole("button",{name:"전체 결과 보기"})).toBeVisible();
  await expect(desktopOutcome).not.toContainText("src/outcome.ts");
  await desktopOutcome.getByRole("button",{name:"전체 결과 보기"}).click();
  await expect(desktopOutcome).toContainText("src/outcome.ts");
  await expect(desktopOutcome).toContainText("pnpm test");
  await expect(desktopOutcome.getByRole("button",{name:"결과 접기"})).toBeVisible();
  const desktopBadge=page.getByRole("button",{name:"결과 요약 보기"});
  await expect(desktopBadge).toBeHidden();
  await page.clock.fastForward(12_100);
  await expect(desktopOutcome).toBeVisible();
  await expect(desktopBadge).toBeHidden();

  await page.setViewportSize({width:800,height:1100});
  await page.goto("/?task=outcome-task");
  const badge=page.getByRole("button",{name:"결과 요약 보기"});
  await expect(badge).toBeVisible();
  await expect(page.locator(".session-side-rail")).toBeHidden();
  await badge.click();
  const outcome=page.getByRole("dialog",{name:"결과 요약"});
  await expect(outcome).toBeVisible();
  await expect(outcome).toContainText("src/outcome.ts");
  await expect(outcome).toContainText("art/result.png");
  await expect(outcome).toContainText("pnpm test");
  await expect(outcome).toContainText("AI 요약 · 모델 자기보고");
  await expect(outcome).toContainText("확인된 성공");
  await expect(outcome).toHaveCSS("position","fixed");
  const close=outcome.getByRole("button",{name:"결과 요약 숨기기"});
  await expect(close.locator(".outcome-close-gauge .progress")).toHaveCount(1);
  await close.click();
  await expect(outcome).toHaveCount(0);
  await expect(badge).toHaveCount(0);
});

test("a completed session switches to starting feedback as soon as a follow-up is submitted",async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem("claudex-ui-locale","ko");
    class SilentEventSource{onerror:null|(()=>void)=null;constructor(public url:string){}addEventListener(){}close(){}}
    Object.defineProperty(globalThis,"EventSource",{value:SilentEventSource,configurable:true});
  });
  const now=new Date().toISOString(),threadId="eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const task={id:"followup-old",provider:"claude",nativeId:"followup-old",threadId,projectId:"project",title:"후속 입력 fixture",prompt:"첫 입력",status:"completed",createdAt:now,updatedAt:now,result:"첫 결과",error:null,log:"",owned:true,ownership:"claudex-workhouse",source:"claudex-workhouse",executionHostId:"local",workspaceId:"workspace",metadata:{}};
  const next={...task,id:"followup-new",nativeId:"followup-new",prompt:"두 번째 입력",status:"pending",result:null,createdAt:new Date(Date.now()+1000).toISOString(),updatedAt:new Date(Date.now()+1000).toISOString()};
  const events=[
    {type:"message",content:task.prompt,metadata:{role:"user"}},
    {type:"file_change_completed",content:"+ fixture",metadata:{path:"src/followup.ts",pathBase:"task-cwd",additions:1,deletions:0}},
    {type:"message_completed",content:task.result,metadata:{role:"agent",phase:"final_answer"}},
  ];
  await page.route("**/api/**",async route=>{
    const url=new URL(route.request().url()),pathname=url.pathname,json=(value:unknown)=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(value)});
    if(pathname==="/api/tasks/claude/followup-old/messages"){await new Promise(resolve=>setTimeout(resolve,600));return json({task:next});}
    if(pathname==="/api/tasks")return json({tasks:[task],partial:false,warnings:[]});
    if(pathname==="/api/tasks/claude/followup-old/events")return json({taskId:task.id,status:"completed",latestSequence:3,events});
    if(pathname.includes("/message-queue"))return json({items:[],activeTask:null});
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

  await page.setViewportSize({width:1200,height:900});
  await page.goto("/?task=followup-old");
  await expect(page.locator(".session-side-rail .outcome-rail")).toBeVisible();
  await page.locator(".composer textarea").fill("두 번째 입력");
  await page.getByRole("button",{name:"보내기"}).click();
  await expect(page.locator(".task-outcome")).toHaveCount(0);
  await expect(page.locator(".work-status-drawer .process-state.running")).toBeVisible();
  await expect.poll(()=>page.locator(".composer textarea").inputValue()).toBe("");
});
