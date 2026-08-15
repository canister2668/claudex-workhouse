import{expect,test}from"@playwright/test";

test("output-card copy stays sticky inside its card",async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem("claudex-ui-locale","ko");
    (globalThis as any).__copyWrites=[];
    Object.defineProperty(navigator,"clipboard",{value:{writeText:async(text:string)=>{(globalThis as any).__copyWrites.push(text);}},configurable:true});
    class SilentEventSource{onerror:null|(()=>void)=null;constructor(public url:string){}addEventListener(){}close(){}}
    Object.defineProperty(globalThis,"EventSource",{value:SilentEventSource,configurable:true});
  });
  const now=new Date().toISOString();
  const task={id:"sticky-output-task",provider:"codex",nativeId:"sticky-output-task",threadId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",projectId:"project",title:"출력 카드 복사",prompt:"긴 결과를 보여 줘",status:"running",createdAt:now,updatedAt:now,result:null,error:null,log:"",owned:true,ownership:"claudex-workhouse",source:"claudex-workhouse",executionHostId:"local",workspaceId:"workspace",metadata:{}};
  const longOutput=Array.from({length:120},(_,index)=>`출력 카드 줄 ${index+1}: 모바일 복사 버튼 위치를 검증합니다.`).join("\n\n");
  const events=[
    {type:"message",content:task.prompt,itemId:"user",sequence:0,metadata:{role:"user"}},
    {type:"command_completed",content:"준비 작업 완료",provider:"codex",itemId:"command",eventId:"sticky:1",sequence:1,timestamp:now,metadata:{description:"준비 작업"}},
    {type:"message_completed",content:longOutput,provider:"codex",itemId:"output",eventId:"sticky:2",sequence:2,timestamp:now,metadata:{role:"agent",phase:"final_answer"}}
  ];
  await page.route("**/api/**",async route=>{
    const pathname=new URL(route.request().url()).pathname,json=(value:unknown)=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(value)});
    if(pathname==="/api/tasks")return json({tasks:[task],partial:false,warnings:[]});
    if(pathname==="/api/tasks/codex/sticky-output-task")return json({task});
    if(pathname==="/api/tasks/codex/sticky-output-task/events")return json({taskId:task.id,status:"running",latestSequence:2,events});
    if(pathname==="/api/tasks/codex/sticky-output-task/message-queue")return json({items:[],activeTask:null});
    if(pathname==="/api/codex/threads")return json({sessions:[],nextCursor:null,stale:false,syncedAt:now,capabilities:{search:true,turns:true,settings:true,delete:false}});
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

  await page.goto("/?task=sticky-output-task");
  const conversation=page.locator(".conversation"),drawer=page.locator(".work-status-drawer"),card=page.locator('.bubble.agent[data-event-type="message_completed"]').filter({hasText:"출력 카드 줄 1:"}),copyAnchor=card.locator(".bubble-copy-anchor"),copy=copyAnchor.getByRole("button",{name:"내용 복사"});
  await expect(drawer).toBeVisible();
  await expect(conversation).toHaveClass(/has-work-panel/);

  await expect(copyAnchor).toHaveCSS("position","sticky");
  await expect(copy).toBeVisible();
  await copy.click();
  await expect(copy).toHaveClass(/copied/);
  await page.waitForTimeout(250);
  const readGeometry=async()=>{
    const [conversationBox,anchorBox,copyBox,cardBox]=await Promise.all([conversation.boundingBox(),copyAnchor.boundingBox(),copy.boundingBox(),card.boundingBox()]);
    if(!conversationBox||!anchorBox||!copyBox||!cardBox)throw new Error("sticky geometry unavailable");
    return{conversationTop:Math.round(conversationBox.y),conversationPaddingTop:await conversation.evaluate(element=>parseFloat(getComputedStyle(element).paddingTop)),anchorTop:Math.round(anchorBox.y),copyTop:Math.round(copyBox.y),cardTop:Math.round(cardBox.y),cardBottom:Math.round(cardBox.y+cardBox.height),position:await copyAnchor.evaluate(element=>getComputedStyle(element).position),top:await copyAnchor.evaluate(element=>getComputedStyle(element).top),scrollTop:await conversation.evaluate(element=>Math.round(element.scrollTop))};
  };
  const assertStickyGeometry=(geometry:Awaited<ReturnType<typeof readGeometry>>)=>{
    expect(geometry.position).toBe("sticky");
    expect(geometry.top).toBe("10px");
    const safeTop=geometry.conversationTop+geometry.conversationPaddingTop+10;
    expect(geometry.anchorTop).toBeGreaterThanOrEqual(safeTop-1);
    expect(geometry.anchorTop).toBeLessThanOrEqual(safeTop+1);
    expect(geometry.copyTop).toBeGreaterThanOrEqual(geometry.cardTop-4);
    expect(geometry.copyTop+26).toBeLessThanOrEqual(geometry.cardBottom+1);
  };
  const before=await readGeometry();
  assertStickyGeometry(before);
  await conversation.evaluate(element=>{
    element.dispatchEvent(new WheelEvent("wheel",{bubbles:true,deltaY:-120}));
    element.scrollTop=Math.max(0,element.scrollTop-120);
    element.dispatchEvent(new Event("scroll"));
  });
  await page.waitForTimeout(250);
  const after=await readGeometry();
  expect(after.scrollTop).toBeLessThan(before.scrollTop);
  assertStickyGeometry(after);
});
