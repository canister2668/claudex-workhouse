import {expect,test} from "@playwright/test";

test("a confirmed Worker loss exposes one reviewed resume and preserves its session boundary",async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem("claudex-ui-locale","ko");
    class QuietEventSource{constructor(_url:string){}addEventListener(){}close(){}}
    (globalThis as any).EventSource=QuietEventSource;
  });
  const now=new Date().toISOString(),threadId="11111111-1111-4111-8111-111111111111",workspace={id:"workspace",projectId:"project",hostId:"local",displayName:"Recovery Workspace",canonicalPath:"/workspace"};
  const interrupted:any={id:"claude:lost",provider:"claude",nativeId:"lost",threadId,projectId:"project",title:"Interrupted fixture",prompt:"finish the task",status:"stopped",createdAt:now,updatedAt:now,result:null,error:"Worker process is no longer running.",log:"",owned:true,ownership:"claudex-workhouse",source:"claudex-workhouse",executionHostId:"local",workspaceId:"workspace",requestedModel:"claude-opus-4-8",permissionProfile:":workspace-write",commandMarker:"claudex-workhouse:lost",metadata:{automationLevel:"auto",interruptionCause:"worker-process-lost"}};
  const blocked={...interrupted,id:"claude:blocked",nativeId:"blocked",threadId:"22222222-2222-4222-8222-222222222222",title:"Blocked fixture",executionHostId:"offline-worker"};
  let tasks=[interrupted,blocked],resumeCalls=0,resumeBody:any=null;
  await page.route("**/api/**",async route=>{
    const url=new URL(route.request().url()),pathname=url.pathname,method=route.request().method(),json=(value:unknown)=>route.fulfill({contentType:"application/json",body:JSON.stringify(value)});
    if(pathname==="/api/tasks")return json({tasks,partial:false,warnings:[]});
    if(pathname==="/api/tasks/claude/claude%3Alost/recovery"&&method==="GET")return json({recovery:{eligible:true,cause:"worker-process-lost",reason:"eligible",attempt:null,prompt:"중단 사실을 확인하고 마지막 지점부터 이어서 완료하세요.",provider:"claude",threadId,executionHostId:"local",workspaceId:"workspace",workspaceName:"Recovery Workspace",model:"claude-opus-4-8",reasoningEffort:null,serviceTier:null,originalPermission:":workspace-write",effectivePermission:":workspace-write",effectiveAutomationLevel:"auto",permissionDowngraded:false}});
    if(pathname==="/api/tasks/claude/claude%3Ablocked/recovery"&&method==="GET")return json({recovery:{eligible:false,cause:"worker-process-lost",reason:"host-offline",attempt:null,prompt:"",provider:"claude",threadId:blocked.threadId,executionHostId:"offline-worker",workspaceId:"workspace",workspaceName:null,model:"claude-opus-4-8",originalPermission:":workspace-write",effectivePermission:":workspace-write",effectiveAutomationLevel:"auto",permissionDowngraded:false}});
    if(pathname==="/api/tasks/claude/claude%3Alost/recovery"&&method==="POST"){
      resumeCalls++;resumeBody=route.request().postDataJSON();
      const resumed={...interrupted,id:"claude:resumed",nativeId:"resumed",status:"pending",prompt:resumeBody.prompt,updatedAt:new Date().toISOString(),parentThreadId:threadId,metadata:{automationLevel:"auto",recoveredFromTaskId:interrupted.id,recoveryCause:"worker-process-lost"}};
      tasks=[resumed,interrupted,blocked];return json({task:resumed,replayed:false});
    }
    if(/^\/api\/tasks\/claude\/[^/]+\/events$/.test(pathname))return json({events:[],latestSequence:0,status:tasks[0].status});
    if(pathname==="/api/projects")return json({projects:[{id:"project",name:"Project",enabled:true,error:null}]});
    if(pathname==="/api/workspaces"||pathname==="/api/location-options")return json({projects:[{id:"project",name:"Project",enabled:true,error:null}],workspaces:[workspace]});
    if(pathname==="/api/hosts")return json({hosts:[{id:"local",type:"local",displayName:"Local",platform:"linux",architecture:"x64",status:"online",capabilities:{}}]});
    if(pathname==="/api/providers/codex/models")return json({catalog:{models:[],permissions:[]}});
    if(pathname==="/api/providers/claude/permissions")return json({permissions:[{id:":workspace-write"}],models:[{id:"claude-opus-4-8",displayName:"Opus"}],efforts:[],catalog:{models:[]}});
    if(pathname==="/api/collaborations")return json({collaborations:[]});
    if(pathname==="/api/quota-reservations")return json({reservations:[]});
    if(pathname==="/api/provider-connections"||pathname==="/api/provider-connections/attempts")return json({singleUser:true,accounts:[],attempts:[]});
    if(pathname==="/api/quota")return json({claude:{},codex:{}});
    if(pathname==="/api/emotion")return json({state:null,codexState:null,outfits:[]});
    if(pathname==="/api/approvals")return json({approvals:[],capabilities:{codex:true,claude:false},checkedAt:now});
    if(pathname==="/api/user-input")return json({requests:[],capabilities:{codex:true,claude:false},checkedAt:now});
    if(pathname.startsWith("/api/system-settings/"))return json({settings:null,candidates:{claude:[],codex:[]}});
    return json({});
  });

  await page.goto("/");
  await page.getByRole("navigation",{name:"주요 화면"}).getByRole("button",{name:"세션",exact:true}).click();
  await page.getByText("Interrupted fixture").click();
  await expect(page.getByRole("button",{name:"이어서 실행"})).toBeVisible();
  await page.getByRole("button",{name:"이어서 실행"}).click();
  await expect(page.getByRole("dialog")).toContainText(threadId);
  await expect(page.getByRole("dialog")).toContainText("Recovery Workspace");
  await expect(page.getByRole("dialog")).toContainText("claude-opus-4-8");
  await page.getByRole("dialog").getByLabel("재개 요청").fill("저장된 변경을 확인하고 남은 테스트를 완료하세요.");
  await page.getByRole("button",{name:"확인하고 재개"}).click();
  await expect.poll(()=>resumeCalls).toBe(1);
  expect(resumeBody).toEqual({confirm:true,prompt:"저장된 변경을 확인하고 남은 테스트를 완료하세요."});
  await expect(page.locator(".task-heading")).toContainText("Interrupted fixture");
  await page.getByRole("button",{name:"뒤로"}).click();
  await page.getByText("Blocked fixture").click();
  await expect(page.getByText("원래 실행 호스트를 사용할 수 없습니다.")).toBeVisible();
  await expect(page.getByRole("button",{name:"이어서 실행"})).toHaveCount(0);
});
