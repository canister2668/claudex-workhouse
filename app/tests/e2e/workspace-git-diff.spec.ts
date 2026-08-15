import{expect,test}from"@playwright/test";

test("changed session file compares its Git change before local draft edits",async({page})=>{
  await page.setViewportSize({width:916,height:1356});
  await page.addInitScript(()=>{
    localStorage.setItem("claudex-ui-locale","ko");
    class SilentEventSource{onerror:null|(()=>void)=null;constructor(public url:string){}addEventListener(){}close(){}}
    Object.defineProperty(globalThis,"EventSource",{value:SilentEventSource,configurable:true});
  });
  const now=new Date().toISOString(),content="export const visible = true;\n";
  const task={id:"diff-task",provider:"claude",nativeId:"diff-task",threadId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",projectId:"project",title:"변경 비교 검증",prompt:"파일 변경을 확인해 주세요.",status:"completed",createdAt:now,updatedAt:now,result:"완료",error:null,log:"",owned:true,ownership:"claudex-workhouse",source:"claudex-workhouse",executionHostId:"local",workspaceId:"workspace",requestedModel:"claude-opus-5",permissionProfile:":workspace-write",metadata:{}};
  const entry={id:"signed-file-id",name:"visible.ts",type:"file",size:content.length,modifiedAt:now,sensitive:false,relativePath:"src/visible.ts"};
  const events=[{type:"file_change_completed",content:"파일을 수정했습니다.",provider:"claude",sequence:1,timestamp:now,metadata:{path:"src/visible.ts",pathBase:"workspace",additions:1,deletions:1}}];
  let gitDiffReads=0;
  await page.route("**/api/**",async route=>{
    const pathname=new URL(route.request().url()).pathname,json=(value:unknown)=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(value)});
    if(pathname==="/api/tasks")return json({tasks:[task],partial:false,warnings:[]});
    if(pathname==="/api/tasks/claude/diff-task")return json({task});
    if(pathname==="/api/tasks/claude/diff-task/events")return json({taskId:task.id,status:task.status,latestSequence:1,events});
    if(pathname.includes("/message-queue"))return json({items:[],activeTask:null});
    if(pathname==="/api/projects")return json({projects:[{id:"project",name:"Project",enabled:true,error:null}]});
    if(pathname==="/api/hosts")return json({hosts:[{id:"local",displayName:"Local",status:"online"}]});
    if(pathname==="/api/workspaces")return json({workspaces:[{id:"workspace",projectId:"project",hostId:"local",displayName:"Workspace",canonicalPath:"/workspace"}]});
    if(pathname==="/api/workspaces/workspace/files")return json({current:{id:"root",relativePath:"."},entries:[entry]});
    if(pathname==="/api/workspaces/workspace/files/resolve")return json({entry});
    if(pathname==="/api/workspaces/workspace/files/read")return json({relativePath:entry.relativePath,size:content.length,modifiedAt:now,sensitive:false,requiresConfirmation:false,binary:false,content,offset:0,nextOffset:null});
    if(pathname==="/api/workspaces/workspace/files/edit/read")return json({fileId:entry.id,relativePath:entry.relativePath,content,revision:"revision-1",lineEnding:"lf",hasUtf8Bom:false,endsWithNewline:true,modifiedAt:now,byteLength:content.length});
    if(pathname==="/api/workspaces/workspace/git-diff"){gitDiffReads++;return json({diff:"--- a/src/visible.ts\n+++ b/src/visible.ts\n@@ -1 +1 @@\n-export const visible = false;\n+export const visible = true;\n",limited:false});}
    if(pathname==="/api/collaborations")return json({collaborations:[]});
    if(pathname==="/api/providers/codex/models")return json({catalog:{models:[],permissions:[]}});
    if(pathname==="/api/providers/claude/permissions")return json({models:[{id:"claude-opus-5",displayName:"Claude Opus"}],permissions:[],efforts:[],catalog:{models:[],stale:false}});
    if(pathname==="/api/provider-connections"||pathname==="/api/provider-connections/attempts")return json({accounts:[],attempts:[]});
    if(pathname==="/api/quota")return json({claude:{},codex:{},fetchedAt:now});
    if(pathname==="/api/emotion")return json({state:{},codexState:{},outfits:[],assets:[],mode:"catch"});
    if(pathname==="/api/push")return json({preferences:{},publicKey:""});
    if(pathname.startsWith("/api/system-settings/"))return json({settings:null,candidates:{claude:[],codex:[]}});
    return json({});
  });

  await page.goto("/?task=diff-task");
  const changedFile=page.locator(".session-side-rail").getByRole("button",{name:/src\/visible\.ts/});
  await changedFile.click();
  const viewer=page.locator(".viewer-dialog .viewer"),editor=viewer.locator("textarea.editor"),compare=viewer.getByRole("button",{name:"변경 비교",exact:true});
  await expect(editor).toHaveValue(content);
  await compare.click();
  await expect(viewer.locator("pre.diff")).toContainText("-export const visible = false;");
  await expect(viewer.locator("pre.diff")).toContainText("+export const visible = true;");
  await expect.poll(()=>gitDiffReads).toBe(1);
  await compare.click();
  await expect(editor).toHaveValue(content);
  await editor.fill("export const visible = 'draft';\n");
  await compare.click();
  await expect(viewer.locator("pre.diff")).toContainText("- export const visible = true;");
  await expect(viewer.locator("pre.diff")).toContainText("+ export const visible = 'draft';");
  expect(gitDiffReads).toBe(1);
});
