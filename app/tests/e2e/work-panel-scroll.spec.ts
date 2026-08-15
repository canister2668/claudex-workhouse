import{expect,test}from"@playwright/test";

test("work panel follows conversation scrolling while its own scroll stays isolated",async({page},testInfo)=>{
  test.setTimeout(90_000);
  await page.addInitScript(()=>{
    localStorage.setItem("claudex-ui-locale","ko");
    class SilentEventSource{onerror:null|(()=>void)=null;constructor(public url:string){}addEventListener(){}close(){}}
    Object.defineProperty(globalThis,"EventSource",{value:SilentEventSource,configurable:true});
  });
  const now=new Date().toISOString();
  const task={id:"scroll-task",provider:"claude",nativeId:"scroll-task",threadId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",projectId:"project",title:"작업 패널 스크롤",prompt:"많은 작업 기록을 보여줘",status:"running",createdAt:now,updatedAt:now,result:null,error:null,log:"",owned:true,ownership:"claudex-workhouse",source:"claudex-workhouse",executionHostId:"local",workspaceId:"workspace",metadata:{}};
  const events=[
    {type:"message",content:task.prompt,itemId:"user",sequence:0,metadata:{role:"user"}},
    ...Array.from({length:72},(_,index)=>({
      type:index%2===0?"command_started":"command_completed",
      content:index%2===0?`printf command-${index}`:`command-${index} completed with enough output to occupy a visible row`,
      provider:"claude",itemId:`command-${index}`,eventId:`scroll:${index+1}`,sequence:index+1,timestamp:now,
      metadata:{description:`명령 ${index+1}`,durationMs:1200}
    })),
    ...Array.from({length:28},(_,index)=>({
      type:"message_completed",content:`본문 스크롤 검증 출력 ${index+1} — 작업 패널과 별개로 충분히 긴 대화 내용을 유지합니다. `.repeat(4),
      provider:"claude",itemId:`message-${index}`,eventId:`message:${index+1}`,sequence:100+index,timestamp:now,
      metadata:{role:"agent",phase:"commentary"}
    }))
  ];
  await page.route("**/api/**",async route=>{
    const pathname=new URL(route.request().url()).pathname,json=(value:unknown)=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(value)});
    if(pathname==="/api/tasks")return json({tasks:[task],partial:false,warnings:[]});
    if(pathname==="/api/tasks/claude/scroll-task")return json({task});
    if(pathname==="/api/tasks/claude/scroll-task/events")return json({latestSequence:events.length,events});
    if(pathname==="/api/tasks/claude/scroll-task/message-queue")return json({items:[],activeTask:null});
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

  const originalViewport=page.viewportSize()!;
  if(testInfo.project.name==="desktop-1280"){
    for(const boundary of [{width:800,rail:false},{width:901,rail:true},{width:916,rail:true}]){
      await page.setViewportSize({width:boundary.width,height:900});
      await page.goto(`/?task=scroll-task&rail-boundary=${boundary.width}`);
      if(boundary.rail)await expect(page.locator(".session-side-rail")).toBeVisible();
      else await expect(page.locator(".session-side-rail")).toBeHidden();
    }
    await page.setViewportSize(originalViewport);
  }
  await page.goto("/?task=scroll-task");
  const drawer=page.locator(".work-status-drawer"),badge=drawer.locator(".work-status-badge"),panel=drawer.locator(".work-status-panel");
  const viewportWidth=page.viewportSize()?.width??0,phone=viewportWidth<=599,panelDefaultsOpen=viewportWidth>=761;
  if(viewportWidth>=901)await expect(page.locator(".session-side-rail")).toBeVisible();
  else await expect(page.locator(".session-side-rail")).toBeHidden();
  await expect(badge).toHaveAttribute("aria-expanded",panelDefaultsOpen?"true":"false");
  if(!panelDefaultsOpen)await badge.click();
  await expect(drawer.locator(".work-event-details")).toBeVisible();
  await expect(drawer.locator(".work-event-details")).not.toHaveAttribute("open","");
  await drawer.locator(".work-event-details>summary").click();
  await drawer.locator(".event-group>summary").click();
  await expect(panel).toHaveCSS("overflow-y","auto");
  const dimensions=await panel.evaluate(element=>({clientHeight:element.clientHeight,scrollHeight:element.scrollHeight}));
  expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);
  await panel.evaluate(element=>element.scrollTop=element.scrollHeight);
  await expect.poll(()=>panel.evaluate(element=>element.scrollTop)).toBeGreaterThan(0);
  await expect(badge).toHaveAttribute("aria-expanded","true");
  await expect(badge).toBeVisible();
  const [drawerBox,navBox,composerBox]=await Promise.all([
    drawer.boundingBox(),
    page.locator(".primary-nav").boundingBox(),
    page.locator(".composer").boundingBox()
  ]);
  expect(drawerBox!.y+drawerBox!.height).toBeLessThanOrEqual(composerBox!.y);
  if((page.viewportSize()?.width??0)<=760)expect(composerBox!.y+composerBox!.height).toBeLessThanOrEqual(navBox!.y);
  else expect(navBox!.y+navBox!.height).toBeLessThanOrEqual(drawerBox!.y);

  const conversation=page.locator(".conversation"),heading=page.locator(".task-heading"),composer=page.locator(".composer");
  await expect.poll(()=>conversation.evaluate(element=>element.scrollHeight-element.clientHeight)).toBeGreaterThan(300);
  await expect.poll(()=>conversation.evaluate(element=>element.scrollTop)).toBeGreaterThan(300);
  await expect(badge).toHaveAttribute("aria-expanded","true");
  if(!phone)await expect(heading).not.toHaveClass(/collapsed/);
  await page.waitForTimeout(100);
  if(viewportWidth>=761){
    // Tablet regression: the first small upward wheel step folds the panel.
    // Its height change may then produce a synthetic downward scroll event;
    // that event must not re-enable bottom following while input is still up.
    const startingTop=await conversation.evaluate(element=>element.scrollTop);
    await conversation.evaluate(element=>{element.dispatchEvent(new WheelEvent("wheel",{bubbles:true,deltaY:-88}));element.scrollTop=Math.max(0,element.scrollTop-88);element.dispatchEvent(new Event("scroll"));});
    await expect(badge).toHaveAttribute("aria-expanded","false");
    await conversation.evaluate(element=>{element.dispatchEvent(new WheelEvent("wheel",{bubbles:true,deltaY:-48}));element.scrollTop=Math.max(0,element.scrollTop-64);element.dispatchEvent(new Event("scroll"));});
    await page.waitForTimeout(150);
    await expect(badge).toHaveAttribute("aria-expanded","false");
    await expect.poll(()=>conversation.evaluate(element=>element.scrollTop)).toBeLessThan(startingTop-48);
  }else{
    const hideDistance=await page.evaluate(()=>document.querySelector<HTMLElement>(".bottom-chrome-drawer")!.getBoundingClientRect().height+document.querySelector<HTMLElement>(".task-heading")!.getBoundingClientRect().height+201);
    await conversation.evaluate((element,distance)=>{element.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}));element.scrollTop=Math.max(0,element.scrollHeight-element.clientHeight-distance);element.dispatchEvent(new Event("scroll"));},hideDistance);
    await expect(badge).toHaveAttribute("aria-expanded","false");
  }
  if(phone){
    await expect(page.locator(".shell")).toHaveClass(/chrome-immersive/);
    await expect(composer).toHaveAttribute("inert","");
    await expect(composer).toHaveCSS("opacity","0");
  }else{
    await expect(heading).toHaveClass(/collapsed/);
    await expect(composer).toBeVisible();
    await expect(composer).not.toHaveAttribute("inert");
  }

  await conversation.evaluate(element=>{element.dispatchEvent(new WheelEvent("wheel",{bubbles:true,deltaY:400}));element.scrollTo({top:element.scrollHeight});});
  await expect(badge).toHaveAttribute("aria-expanded","true");
  await expect(composer).toBeVisible();
  await expect(composer).not.toHaveAttribute("inert");
  if(phone)await expect(page.locator(".shell")).not.toHaveClass(/chrome-immersive/);
  else await expect(heading).toHaveClass(/collapsed/);
  await expect.poll(()=>conversation.evaluate(element=>element.scrollHeight-element.clientHeight-element.scrollTop)).toBeLessThanOrEqual(1);
  await page.waitForTimeout(300);
  await expect(badge).toHaveAttribute("aria-expanded","true");
  await expect.poll(()=>conversation.evaluate(element=>element.scrollHeight-element.clientHeight-element.scrollTop)).toBeLessThanOrEqual(1);
  if(phone){
    const bottomTapChromeTransitions=await conversation.evaluate(async element=>{
      const shell=document.querySelector<HTMLElement>(".shell");
      if(!shell)throw new Error("shell unavailable");
      let transitions=0;
      const observer=new MutationObserver(()=>{transitions+=1;});
      observer.observe(shell,{attributes:true,attributeFilter:["class"]});
      element.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,pointerType:"touch"}));
      element.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,pointerType:"touch"}));
      await new Promise(resolve=>setTimeout(resolve,120));
      observer.disconnect();
      return transitions;
    });
    expect(bottomTapChromeTransitions).toBe(0);
    await expect(page.locator(".shell")).not.toHaveClass(/chrome-immersive/);
    await expect(badge).toHaveAttribute("aria-expanded","true");
  }
});
