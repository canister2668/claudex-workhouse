import{expect,test}from"@playwright/test";

test("copies each assistant Markdown code block from its own toolbar",async({page,context})=>{
  await context.grantPermissions(["clipboard-read","clipboard-write"]);
  await page.addInitScript(()=>localStorage.setItem("claudex-ui-locale","ko"));
  const now=new Date().toISOString();
  const task={
    id:"markdown-task",provider:"claude",nativeId:"markdown-task",
    threadId:"ffffffff-ffff-4fff-8fff-ffffffffffff",projectId:"project",
    title:"Markdown code copy",prompt:"코드 예시를 줘",status:"completed",
    createdAt:now,updatedAt:now,result:"done",error:null,log:"",
    owned:true,ownership:"claudex-workhouse",source:"claudex-workhouse",
    executionHostId:"local",workspaceId:"workspace",metadata:{},
  };
  const answer="결과입니다.\n\n```ts\nconst answer = 42;\nconsole.log(answer);\n```\n\n인라인 `npm test`\n\n```\nplain block\n```";
  await page.route("**/api/**",async route=>{
    const pathname=new URL(route.request().url()).pathname;
    const json=(value:unknown)=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(value)});
    if(pathname==="/api/tasks")return json({tasks:[task],partial:false,warnings:[]});
    if(pathname==="/api/tasks/claude/markdown-task/events")return json({latestSequence:1,events:[
      {type:"message",content:task.prompt,metadata:{role:"user"}},
      {type:"message_completed",content:answer,itemId:"answer",sequence:1,metadata:{role:"agent",phase:"final_answer"}},
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

  await page.goto("/?task=markdown-task");
  const blocks=page.locator(".markdown-code-block");
  await expect(blocks).toHaveCount(2);
  await expect(blocks.first().locator(".markdown-code-toolbar>span")).toHaveText("ts");
  await expect(page.locator(".markdown-body>p code")).toHaveText("npm test");
  await expect(page.locator("button[data-copy-code]")).toHaveCount(2);

  const firstCopy=blocks.first().locator("button[data-copy-code]");
  await firstCopy.click();
  await expect(firstCopy).toContainText("복사됨");
  await expect.poll(()=>page.evaluate(()=>navigator.clipboard.readText())).toBe("const answer = 42;\nconsole.log(answer);");

  await blocks.nth(1).locator("button[data-copy-code]").click();
  await expect.poll(()=>page.evaluate(()=>navigator.clipboard.readText())).toBe("plain block");
});
