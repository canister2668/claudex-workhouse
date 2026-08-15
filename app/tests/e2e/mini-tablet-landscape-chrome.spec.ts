import{expect,test}from"@playwright/test";

test("mini-tablet landscape hides bottom chrome completely and restores it at the end",async({page},testInfo)=>{
  // The immersive bottom chrome only turns on for a coarse pointer, so this
  // describes a layout the pointer-fine desktop project never renders.
  test.skip(!(testInfo.project.use.hasTouch??false),"the immersive bottom chrome requires a touch context");

  await page.addInitScript(()=>{
    localStorage.setItem("claudex-ui-locale","ko");
    class SilentEventSource{onerror:null|(()=>void)=null;constructor(public url:string){}addEventListener(){}close(){}}
    Object.defineProperty(globalThis,"EventSource",{value:SilentEventSource,configurable:true});
  });
  await page.setViewportSize({width:600,height:375});
  const now=new Date().toISOString(),task={id:"landscape-task",provider:"claude",nativeId:"landscape-task",threadId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",projectId:"project",title:"Y700 가로 스크롤",prompt:"긴 결과를 확인해 줘",status:"running",createdAt:now,updatedAt:now,result:null,error:null,log:"",owned:true,ownership:"claudex-workhouse",source:"claudex-workhouse",executionHostId:"local",workspaceId:"workspace",metadata:{}};
  const events=[
    {type:"message",content:task.prompt,itemId:"user",sequence:0,metadata:{role:"user"}},
    ...Array.from({length:36},(_,index)=>({type:"message_completed",content:`Y700 가로모드 스크롤 본문 ${index+1} `.repeat(12),provider:"claude",itemId:`message-${index}`,eventId:`message:${index+1}`,sequence:index+1,timestamp:now,metadata:{role:"agent",phase:"commentary"}}))
  ];
  await page.route("**/api/**",async route=>{
    const pathname=new URL(route.request().url()).pathname,json=(value:unknown)=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(value)});
    if(pathname==="/api/tasks")return json({tasks:[task],partial:false,warnings:[]});
    if(pathname==="/api/tasks/claude/landscape-task")return json({task});
    if(pathname==="/api/tasks/claude/landscape-task/events")return json({latestSequence:events.length,events});
    if(pathname==="/api/tasks/claude/landscape-task/message-queue")return json({items:[],activeTask:null});
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

  await page.goto("/?task=landscape-task");
  const shell=page.locator(".shell"),detailMain=page.locator(".detail-main"),conversation=page.locator(".conversation"),drawer=page.locator(".bottom-chrome-drawer"),composer=page.locator(".composer"),nav=page.locator(".primary-nav");
  await expect(shell).toHaveClass(/chrome-drawer-enabled/);
  await expect.poll(()=>conversation.evaluate(element=>element.scrollHeight-element.clientHeight)).toBeGreaterThan(600);
  const [drawerHeight,headingHeight]=await Promise.all([drawer.evaluate(element=>element.getBoundingClientRect().height),page.locator(".task-heading").evaluate(element=>element.getBoundingClientRect().height)]);
  await conversation.evaluate((element,hideDistance)=>{element.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}));element.scrollTop=element.scrollHeight-element.clientHeight-hideDistance;element.dispatchEvent(new Event("scroll"));},drawerHeight+headingHeight+201);
  await page.waitForTimeout(250);
  await expect(drawer).toHaveCSS("opacity","0");
  await conversation.evaluate(element=>{element.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}));element.scrollTop=Math.max(80,element.scrollHeight/2);element.dispatchEvent(new Event("scroll"));});
  await expect(shell).toHaveClass(/chrome-immersive/);
  await expect(drawer).toHaveAttribute("inert","");
  await expect(drawer).toHaveCSS("opacity","0");

  await conversation.evaluate(element=>element.scrollTo({top:element.scrollHeight}));
  await expect(drawer).toHaveCSS("opacity","1");
  const controlsToggle=page.locator(".mobile-controls-toggle");
  await controlsToggle.click();
  await controlsToggle.click();
  await conversation.evaluate(element=>{element.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}));element.scrollTop=Math.max(80,element.scrollHeight/2);element.dispatchEvent(new Event("scroll"));});
  await expect(drawer).toHaveCSS("opacity","0");

  await conversation.evaluate(element=>element.scrollTo({top:element.scrollHeight-element.clientHeight-100}));
  await expect.poll(()=>drawer.evaluate(element=>Number(getComputedStyle(element).opacity))).toBeGreaterThan(0);
  await expect.poll(()=>drawer.evaluate(element=>Number(getComputedStyle(element).opacity))).toBeLessThan(1);

  await conversation.evaluate(element=>element.scrollTo({top:element.scrollHeight}));
  await expect.poll(()=>conversation.evaluate(element=>element.scrollHeight-element.clientHeight-element.scrollTop)).toBeLessThanOrEqual(1);
  await expect(drawer).not.toHaveAttribute("inert");
  await expect(drawer).toHaveCSS("opacity","1");
  // The action row between the detail and the composer was replaced by a
  // popover trigger inside the composer, so the drawer now stacks
  // detail → composer → nav.
  const [detailBox,composerBox,navBox]=await Promise.all([detailMain.boundingBox(),composer.boundingBox(),nav.boundingBox()]);
  expect(composerBox!.y).toBeGreaterThanOrEqual(detailBox!.y-1);
  expect(composerBox!.y+composerBox!.height).toBeLessThanOrEqual(navBox!.y+1);

  for(let attempt=0;attempt<4;attempt++){
    await conversation.evaluate(element=>{element.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}));element.scrollTop=Math.max(80,element.scrollHeight/2);element.dispatchEvent(new Event("scroll"));element.scrollTop=element.scrollHeight;element.dispatchEvent(new Event("scroll"));});
    await expect.poll(()=>conversation.evaluate(element=>element.scrollHeight-element.clientHeight-element.scrollTop)).toBeLessThanOrEqual(1);
    await expect(drawer).toHaveCSS("opacity","1");
    const [raceComposerBox,raceNavBox]=await Promise.all([composer.boundingBox(),nav.boundingBox()]);
    expect(raceComposerBox!.y+raceComposerBox!.height).toBeLessThanOrEqual(raceNavBox!.y+1);
  }
});
