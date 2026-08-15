import{expect,test}from"@playwright/test";

test("shows a Codex image inline and opens the same image in its preview panel",async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem("claudex-ui-locale","ko");
    class SilentEventSource{onerror:null|(()=>void)=null;constructor(public url:string){}addEventListener(){}close(){}}
    Object.defineProperty(globalThis,"EventSource",{value:SilentEventSource,configurable:true});
  });
  const now=new Date().toISOString();
  const task={id:"image-output-task",provider:"codex",nativeId:"image-output-task",threadId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",projectId:"project",title:"이미지 출력",prompt:"이미지를 보여 줘",status:"completed",createdAt:now,updatedAt:now,result:"이미지를 확인했습니다.",error:null,log:"",owned:true,ownership:"claudex-workhouse",source:"claudex-workhouse",executionHostId:"local",workspaceId:"workspace",cwd:"/workspace",metadata:{}};
  const events=[
    {type:"message",content:task.prompt,threadId:task.threadId,turnId:"turn",metadata:{role:"user"}},
    {type:"tool_completed",content:"imageGeneration",threadId:task.threadId,turnId:"turn",itemId:"image-first",metadata:{itemType:"imageGeneration",mediaKind:"image",mediaPath:"managed/generated.png",mediaPathBase:"task-output",sourceTaskId:"image-output-task",mediaWorkspaceId:"workspace"}},
    {type:"tool_completed",content:"imageGeneration",threadId:task.threadId,turnId:"turn",itemId:"image-repeated",metadata:{itemType:"imageGeneration",mediaKind:"image",mediaPath:"managed/generated.png",mediaPathBase:"task-output",sourceTaskId:"image-output-task",mediaWorkspaceId:"workspace"}},
    {type:"message_completed",content:task.result,threadId:task.threadId,turnId:"turn",metadata:{role:"agent",phase:"final_answer"}}
  ];
  await page.route("**/api/**",async route=>{
    const url=new URL(route.request().url()),pathname=url.pathname,json=(value:unknown)=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(value)});
    if(pathname==="/api/task-image-output")return route.fulfill({status:200,contentType:"image/png",body:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=","base64")});
    if(pathname==="/api/tasks")return json({tasks:[task],partial:false,warnings:[]});
    if(pathname==="/api/tasks/codex/image-output-task")return json({task});
    if(pathname==="/api/tasks/codex/image-output-task/events")return json({taskId:task.id,status:"completed",latestSequence:3,events});
    if(pathname==="/api/tasks/codex/image-output-task/message-queue")return json({items:[],activeTask:null});
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

  await page.goto("/?task=image-output-task");
  const card=page.locator(".conversation-image-card");
  await expect(card).toBeVisible();
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("이미지");
  await expect(card).toContainText("generated.png");
  const inline=card.getByRole("img",{name:"managed/generated.png"});
  await expect(inline).toBeVisible();
  await expect(inline).toHaveAttribute("src","/api/task-image-output?taskId=image-output-task&path=managed%2Fgenerated.png");
  await expect(page.locator(".image-preview-panel")).toHaveCount(0);
  await card.click();
  const panel=page.locator(".image-preview-panel");
  await expect(panel).toBeVisible();
  const image=panel.getByRole("img",{name:"managed/generated.png"});
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute("src","/api/task-image-output?taskId=image-output-task&path=managed%2Fgenerated.png");
  await panel.getByRole("button",{name:"닫기"}).click();
  await expect(panel).toHaveCount(0);
  await expect(page.locator(".task-outcome")).toHaveCount(0);
  await expect(page.locator(".outcome-badge")).toHaveCount(0);
});

test("promotes Claude's ordinary result image links inside the answer card",async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem("claudex-ui-locale","ko");
    class SilentEventSource{onerror:null|(()=>void)=null;constructor(public url:string){}addEventListener(){}close(){}}
    Object.defineProperty(globalThis,"EventSource",{value:SilentEventSource,configurable:true});
  });
  const now=new Date().toISOString();
  const task={id:"linked-image-task",provider:"claude",nativeId:"linked-image-task",threadId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",projectId:"project",title:"시안 출력",prompt:"시안을 보여 줘",status:"completed",createdAt:now,updatedAt:now,result:"[라이트 시안](/workspace/docs/mockup-light.png) · [다크 시안](/workspace/docs/mockup-dark.png)",error:null,log:"",owned:true,ownership:"claudex-workhouse",source:"claudex-workhouse",executionHostId:"local",workspaceId:"workspace",cwd:"/workspace",metadata:{}};
  const events=[
    {type:"message",content:task.prompt,provider:"claude",threadId:task.threadId,sequence:1,timestamp:now,metadata:{role:"user"}},
    {type:"message_completed",content:task.result,provider:"claude",threadId:task.threadId,sequence:2,timestamp:now,metadata:{role:"agent",phase:"final_answer"}},
    {type:"task_completed",content:task.result,provider:"claude",threadId:task.threadId,sequence:3,timestamp:now,metadata:{nativeType:"result",subtype:"success"}}
  ];
  await page.route("**/api/**",async route=>{
    const url=new URL(route.request().url()),pathname=url.pathname,json=(value:unknown)=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(value)});
    if(pathname==="/api/workspaces/workspace/files/preview")return route.fulfill({status:200,contentType:"image/png",body:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=","base64")});
    if(pathname==="/api/tasks")return json({tasks:[task],partial:false,warnings:[]});
    if(pathname==="/api/tasks/claude/linked-image-task")return json({task});
    if(pathname==="/api/tasks/claude/linked-image-task/events")return json({taskId:task.id,status:"completed",latestSequence:3,events});
    if(pathname==="/api/tasks/claude/linked-image-task/message-queue")return json({items:[],activeTask:null});
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

  await page.goto("/?task=linked-image-task");
  const answer=page.locator(".bubble.agent").filter({hasText:"라이트 시안"});
  await expect(answer).toBeVisible();
  const images=answer.locator(".markdown-image img");
  await expect(images).toHaveCount(2);
  await expect(images.nth(0)).toHaveAttribute("src","/api/workspaces/workspace/files/preview?path=docs%2Fmockup-light.png&pathBase=workspace");
  await expect(images.nth(1)).toHaveAttribute("src","/api/workspaces/workspace/files/preview?path=docs%2Fmockup-dark.png&pathBase=workspace");
  await expect(answer.locator("figcaption")).toHaveText(["라이트 시안","다크 시안"]);
  await expect(page.locator(".conversation-image-card")).toHaveCount(0);
});
