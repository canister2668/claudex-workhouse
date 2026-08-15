import{expect,test}from"@playwright/test";

test("long conversation and queued inputs expand only on request",async({page},testInfo)=>{
  await page.addInitScript(()=>{
    localStorage.setItem("claudex-ui-locale","ko");
    class SilentEventSource{onerror:null|(()=>void)=null;constructor(public url:string){}addEventListener(){}close(){}}
    Object.defineProperty(globalThis,"EventSource",{value:SilentEventSource,configurable:true});
  });
  const now=new Date().toISOString();
  const longInput=Array.from({length:8},(_,index)=>`${index+1}번째 줄의 길고 구체적인 사용자 요청입니다.`).join("\n");
  const queuePrompt=Array.from({length:120},(_,index)=>`${index+1}번째 예약 입력은 한 줄 미리보기 뒤 펼친 본문 안에서 스크롤할 수 있어야 합니다.`).join("\n");
  const task={id:"fold-task",provider:"claude",nativeId:"fold-task",threadId:"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",projectId:"project",title:"입력 폴딩 fixture",prompt:longInput,status:"running",createdAt:now,updatedAt:now,result:null,error:null,log:"",owned:true,ownership:"claudex-workhouse",source:"claudex-workhouse",executionHostId:"local",workspaceId:"workspace",metadata:{}};
  const events=[{type:"message",content:longInput,timestamp:now,sequence:1,eventId:"fold:1",metadata:{role:"user"}}];
  await page.route("**/api/**",async route=>{
    const url=new URL(route.request().url()),pathname=url.pathname,json=(value:unknown)=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(value)});
    if(pathname==="/api/tasks")return json({tasks:[task],partial:false,warnings:[]});
    if(pathname==="/api/tasks/claude/fold-task")return json({task});
    if(pathname==="/api/tasks/claude/fold-task/events")return json({taskId:task.id,status:"running",latestSequence:1,events});
    if(pathname==="/api/tasks/claude/fold-task/message-queue")return json({items:[{id:"queue-1",prompt:queuePrompt,status:"queued"}],activeTask:null});
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

  await page.goto("/?task=fold-task");
  const queue=page.getByRole("region",{name:"대기열"});
  const queueCollapse=queue.locator(".queue-collapse-toggle");
  const mobile=(page.viewportSize()?.width??0)<=640;
  if(mobile){
    await expect(queueCollapse).toHaveAttribute("aria-expanded","false");
  }else{
    await expect(queueCollapse).toHaveAttribute("aria-expanded","true");
    await queueCollapse.click();
  }
  await expect(queue.locator(".queue-count-badge")).toHaveText("1");
  await expect(queue.locator("article")).toHaveCount(0);
  if(mobile)await page.screenshot({path:`test-results/${testInfo.project.name}-queue-collapsed.png`,fullPage:true});
  const conversationToggle=page.locator(".input-fold-toggle").first();
  await expect(conversationToggle).toBeVisible();
  await expect(conversationToggle).toHaveAttribute("aria-expanded","false");
  await conversationToggle.click();
  await expect(conversationToggle).toHaveAttribute("aria-expanded","true");

  await queueCollapse.click();
  await expect(queueCollapse).toHaveAttribute("aria-expanded","true");
  const queueToggle=page.locator(".queue-fold-toggle");
  await expect(queueToggle).toBeVisible();
  await expect(page.locator(".message-queue p")).toHaveCSS("white-space","nowrap");
  await queueToggle.click();
  await expect(queueToggle).toHaveAttribute("aria-expanded","true");
  const queueContent=page.locator(".message-queue p");
  await expect(queueContent).toHaveCSS("white-space","pre-wrap");
  await expect(queueContent).toHaveCSS("overflow-y","auto");
  await queueContent.evaluate(node=>{node.scrollTop=node.scrollHeight;});
  await expect(queueToggle).toBeVisible();
  await queueToggle.click();
  await expect(queueToggle).toHaveAttribute("aria-expanded","false");
  const promptRow=await page.locator(".queue-prompt-row").boundingBox();
  const actions=await page.locator(".queue-actions").boundingBox();
  expect(promptRow).not.toBeNull();
  expect(actions).not.toBeNull();
  expect(actions!.y).toBeGreaterThanOrEqual(promptRow!.y+promptRow!.height-1);
  await queueCollapse.click();
  await expect(queueCollapse).toHaveAttribute("aria-expanded","false");
  await expect(queue.locator(".queue-count-badge")).toHaveText("1");
  await expect(queue.locator("article")).toHaveCount(0);
});
