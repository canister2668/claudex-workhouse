import{expect,test}from"@playwright/test";

const viewports=[
  {name:"phone-360",width:360,height:800,immersive:true},
  {name:"phone-412",width:412,height:915,immersive:true},
  {name:"phone-max-599",width:599,height:900,immersive:true},
  {name:"controls-boundary-600-portrait",width:600,height:900,immersive:false},
  {name:"controls-boundary-600-landscape",width:600,height:375,immersive:true},
  {name:"mobile-nav-max-760",width:760,height:500,immersive:true,rail:false},
  {name:"tablet-min-761",width:761,height:500,immersive:true,rail:false},
  {name:"compact-height-max-720",width:800,height:720,immersive:true},
  {name:"compact-height-over-721",width:800,height:721,immersive:false},
  {name:"tablet-portrait",width:800,height:1280,immersive:false,rail:false},
  {name:"tablet-max-900",width:900,height:1280,immersive:false,rail:false},
  {name:"wide-min-901",width:901,height:1280,immersive:false,rail:true},
  {name:"galaxy-tab-ultra",width:916,height:1356,immersive:false,rail:true},
  {name:"compact-max-1024",width:1024,height:600,immersive:true},
  {name:"compact-over-1025",width:1025,height:600,immersive:false}
] as const;

test("scroll chrome stays stable across responsive boundaries",async({page})=>{
  test.setTimeout(150_000);
  await page.addInitScript(()=>{
    localStorage.setItem("claudex-ui-locale","ko");
    class SilentEventSource{onerror:null|(()=>void)=null;constructor(public url:string){}addEventListener(){}close(){}}
    Object.defineProperty(globalThis,"EventSource",{value:SilentEventSource,configurable:true});
  });
  const now=new Date().toISOString(),task={id:"matrix-task",provider:"claude",nativeId:"matrix-task",threadId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",projectId:"project",title:"해상도 매트릭스",prompt:"스크롤 패널을 검증해 줘",status:"running",createdAt:now,updatedAt:now,result:null,error:null,log:"",owned:true,ownership:"claudex-workhouse",source:"claudex-workhouse",executionHostId:"local",workspaceId:"workspace",metadata:{}};
  const events=[
    {type:"message",content:task.prompt,itemId:"user",sequence:0,metadata:{role:"user"}},
    ...Array.from({length:42},(_,index)=>({type:"message_completed",content:`반응형 스크롤 검증 ${index+1} `.repeat(14),provider:"claude",itemId:`message-${index}`,eventId:`message:${index+1}`,sequence:index+1,timestamp:now,metadata:{role:"agent",phase:"commentary"}}))
  ];
  await page.route("**/api/**",async route=>{
    const pathname=new URL(route.request().url()).pathname,json=(value:unknown)=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(value)});
    if(pathname==="/api/tasks")return json({tasks:[task],partial:false,warnings:[]});
    if(pathname==="/api/tasks/claude/matrix-task")return json({task});
    if(pathname==="/api/tasks/claude/matrix-task/events")return json({latestSequence:events.length,events});
    if(pathname==="/api/tasks/claude/matrix-task/message-queue")return json({items:[],activeTask:null});
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

  for(const viewport of viewports)await test.step(viewport.name,async()=>{
    await page.setViewportSize({width:viewport.width,height:viewport.height});
    await page.goto(`/?task=matrix-task&viewport=${viewport.name}`);
    const shell=page.locator(".shell"),conversation=page.locator(".conversation"),heading=page.locator(".task-heading"),drawer=page.locator(".bottom-chrome-drawer"),actions=page.locator(".mobile-session-actions"),composer=page.locator(".composer"),badge=page.locator(".work-status-badge"),nav=page.locator(".primary-nav"),rail=page.locator(".session-side-rail");
    if("rail" in viewport){
      if(viewport.rail)await expect(rail).toBeVisible();
      else await expect(rail).toBeHidden();
    }
    if(viewport.immersive)await expect(shell).toHaveClass(/chrome-drawer-enabled/);
    else await expect(shell).not.toHaveClass(/chrome-drawer-enabled/);
    await expect.poll(()=>conversation.evaluate(element=>element.scrollHeight-element.clientHeight)).toBeGreaterThan(800);
    if(await badge.getAttribute("aria-expanded")!=="true")await badge.click();
    await expect(badge).toHaveAttribute("aria-expanded","true");

    await conversation.evaluate(element=>{element.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}));element.scrollTop=Math.max(80,element.scrollHeight/2);element.dispatchEvent(new Event("scroll"));});
    await expect(badge).toHaveAttribute("aria-expanded","false");
    if(viewport.immersive){
      await expect(shell).toHaveClass(/chrome-immersive/);
      await expect(drawer).toHaveCSS("opacity","0");
      await page.waitForTimeout(250);
      await expect(drawer).toHaveCSS("opacity","0");
    }else{
      await expect(heading).toHaveClass(/collapsed/);
      await expect(drawer).toHaveCSS("opacity","1");
    }

    await conversation.evaluate(element=>element.scrollTo({top:element.scrollHeight}));
    await expect.poll(()=>conversation.evaluate(element=>element.scrollHeight-element.clientHeight-element.scrollTop)).toBeLessThanOrEqual(1);
    await expect(badge).toHaveAttribute("aria-expanded","true");
    await expect(drawer).toHaveCSS("opacity","1");
    await page.waitForTimeout(250);
    await expect(drawer).toHaveCSS("opacity","1");

    const localAttach=composer.getByRole("button",{name:"첨부 추가"}),protonAttach=composer.getByRole("button",{name:"Proton Drive에서 첨부"});
    await expect(localAttach).toBeVisible();
    await expect(protonAttach).toBeVisible();
    const [localAttachBox,protonAttachBox]=await Promise.all([localAttach.boundingBox(),protonAttach.boundingBox()]);
    expect(localAttachBox!.x+localAttachBox!.width).toBeLessThanOrEqual(protonAttachBox!.x);

    if(viewport.width<=599){
      await expect(shell).not.toHaveClass(/chrome-immersive/);
      await expect(heading).toHaveCSS("opacity","1");
      await expect(drawer).toHaveCSS("opacity","1");
      await expect(composer).not.toHaveAttribute("inert");
      await expect(composer).toHaveCSS("opacity","1");
      await expect(composer.locator("textarea")).toBeEditable();
      for(let tapAttempt=0;tapAttempt<3;tapAttempt++){
        await conversation.evaluate(element=>{element.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,pointerType:"touch"}));element.scrollTop=Math.max(80,element.scrollHeight/2);element.dispatchEvent(new Event("scroll"));});
        await expect(drawer).toHaveCSS("opacity","0");
        await conversation.evaluate(element=>element.scrollTo({top:element.scrollHeight}));
        await expect(drawer).toHaveCSS("opacity","1");
        await expect(shell).not.toHaveClass(/chrome-immersive/);
        await expect(heading).toHaveCSS("opacity","1");
        await expect(drawer).toHaveCSS("opacity","1");
        await expect(composer).not.toHaveAttribute("inert");
        await expect(composer).toHaveCSS("opacity","1");
      }
    }

    if(viewport.width<=600){
      const toggle=page.locator(".mobile-controls-toggle");
      await expect(toggle).toBeVisible();
      await toggle.click();
      await expect(actions).toHaveClass(/mobile-controls-collapsed/);
      await expect(page.locator(".chat-settings-bar")).toHaveClass(/mobile-controls-collapsed/);
      await page.waitForTimeout(300);
      await expect(actions).toHaveClass(/mobile-controls-collapsed/);
      await expect(page.locator(".chat-settings-bar")).toHaveClass(/mobile-controls-collapsed/);
      await toggle.click();
      await expect(actions).not.toHaveClass(/mobile-controls-collapsed/);
      await expect(page.locator(".chat-settings-bar")).not.toHaveClass(/mobile-controls-collapsed/);
      await page.waitForTimeout(300);
    }

    if(viewport.width<=760){
      const [actionsBox,composerBox,navBox]=await Promise.all([actions.boundingBox(),composer.boundingBox(),nav.boundingBox()]);
      expect(actionsBox!.y+actionsBox!.height).toBeLessThanOrEqual(composerBox!.y+1);
      expect(composerBox!.y+composerBox!.height).toBeLessThanOrEqual(navBox!.y+1);
    }else{
      await expect(actions).toBeHidden();
      await expect(composer).toBeVisible();
    }

    if(viewport.width<=599)for(let topAttempt=0;topAttempt<4;topAttempt++){
      await conversation.evaluate(element=>{element.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,pointerType:"touch"}));element.scrollTop=Math.max(80,element.scrollHeight/2);element.dispatchEvent(new Event("scroll"));});
      await expect(shell).toHaveClass(/chrome-immersive/);
      await conversation.evaluate(element=>{element.dispatchEvent(new WheelEvent("wheel",{bubbles:true,deltaY:-400}));element.scrollTo({top:0});});
      await expect.poll(()=>conversation.evaluate(element=>element.scrollTop)).toBeLessThanOrEqual(1);
      await expect(shell).toHaveClass(/chrome-immersive/);
      await expect(heading).toHaveCSS("opacity","0");
      await expect(drawer).toHaveCSS("opacity","0");
      await page.waitForTimeout(250);
      await expect(shell).toHaveClass(/chrome-immersive/);
      await expect.poll(()=>conversation.evaluate(element=>element.scrollTop)).toBeLessThanOrEqual(1);
    }
  });
});
