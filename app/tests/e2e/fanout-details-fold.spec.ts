import{expect,test}from"@playwright/test";

test("parallel-agent details fold with the pinned summary",async({page})=>{
  await page.setViewportSize({width:916,height:1356});
  await page.addInitScript(()=>{
    localStorage.setItem("claudex-ui-locale","ko");
    class SilentEventSource{onerror:null|(()=>void)=null;constructor(public url:string){}addEventListener(){}close(){}}
    Object.defineProperty(globalThis,"EventSource",{value:SilentEventSource,configurable:true});
  });
  const now=new Date().toISOString(),root="root-thread";
  const task={id:"fanout-fold",provider:"claude",nativeId:"fanout-fold",threadId:root,projectId:"project",title:"에이전트 상세 폴딩",prompt:"병렬 작업을 실행해 주세요.",status:"running",createdAt:now,updatedAt:now,result:null,error:null,log:"",owned:true,ownership:"claudex-workhouse",source:"claudex-workhouse",executionHostId:"local",workspaceId:"workspace",metadata:{}};
  const children=["child-a","child-b","child-c"];
  const events:any[]=[
    {type:"message",content:task.prompt,threadId:root,turnId:"turn-1",sequence:1,metadata:{role:"user"}},
    {type:"agent_started",content:"parallel agents started",threadId:root,turnId:"turn-1",sequence:2,metadata:{receiverThreadIds:children}},
    ...children.flatMap((threadId,childIndex)=>Array.from({length:5},(_,index)=>({type:"command_output",content:`${threadId} 상세 작업 ${index+1}`,threadId,turnId:"turn-1",sequence:3+childIndex*5+index,metadata:{command:`check-${childIndex}-${index}`}}))),
    ...Array.from({length:30},(_,index)=>({type:"message_completed",content:`스크롤 검증용 진행 설명 ${index+1} `.repeat(10),threadId:root,turnId:"turn-1",sequence:20+index,metadata:{role:"agent",phase:"commentary"}}))
  ];
  await page.route("**/api/**",async route=>{
    const pathname=new URL(route.request().url()).pathname,json=(value:unknown)=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(value)});
    if(pathname==="/api/tasks")return json({tasks:[task],partial:false,warnings:[]});
    if(pathname==="/api/tasks/claude/fanout-fold")return json({task});
    if(pathname==="/api/tasks/claude/fanout-fold/events")return json({taskId:task.id,status:task.status,latestSequence:events.length,events});
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

  await page.goto("/?task=fanout-fold");
  const conversation=page.locator(".conversation"),sticky=page.locator(".fanout-sticky"),toggle=page.getByRole("button",{name:"에이전트 상세"});
  await expect(sticky).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded","false");
  await toggle.click();
  await expect(page.getByRole("button",{name:"상세 접기"})).toHaveAttribute("aria-expanded","true");
  await expect(page.locator(".fanout-lanes")).toBeVisible();
  await expect(page.locator(".fanout-lane")).toHaveCount(3);
  await conversation.evaluate(element=>{element.scrollTop=Math.min(700,element.scrollHeight-element.clientHeight);element.dispatchEvent(new Event("scroll"));});
  await expect.poll(async()=>{
    const [conversationBox,stickyBox]=await Promise.all([conversation.boundingBox(),sticky.boundingBox()]);
    const paddingTop=await conversation.evaluate(element=>Number.parseFloat(getComputedStyle(element).paddingTop));
    return Math.abs((stickyBox?.y??0)-((conversationBox?.y??0)+paddingTop));
  }).toBeLessThanOrEqual(2);
  await expect(page.locator(".fanout-lanes")).toBeVisible();
  await page.getByRole("button",{name:"상세 접기"}).click();
  await expect(toggle).toHaveAttribute("aria-expanded","false");
  await expect(page.locator(".fanout-lanes")).toHaveCount(0);
});
