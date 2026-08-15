import{expect,test}from"@playwright/test";

test("workspace instructions stay compact until their mobile panel is opened",async({page})=>{
  await page.addInitScript(()=>{localStorage.setItem("claudex-ui-locale","ko");class SilentEventSource{constructor(public url:string){}addEventListener(){}close(){}}Object.defineProperty(globalThis,"EventSource",{value:SilentEventSource,configurable:true});});
  let revision=2,markdown="서버 런타임 변경 후 빌드하고 재시작한다.",savedRequest:any=null;
  await page.route("**/api/**",async route=>{
    const pathname=new URL(route.request().url()).pathname,method=route.request().method(),json=(value:unknown)=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(value)}),workspace={id:"workspace",projectId:"project",hostId:"local",rootId:"root",displayName:"Demo",canonicalPath:"/workspace",workspaceType:"existing"};
    if(pathname==="/api/bootstrap/owner-claim/status")return json({required:false});
    if(pathname==="/api/system-settings/locale")return json({locale:"ko",saved:true,existingInstallation:true});
    if(pathname==="/api/tasks")return json({tasks:[],partial:false,warnings:[]});
    if(pathname==="/api/projects")return json({projects:[{id:"project",name:"Demo Project",enabled:true}]});
    if(pathname==="/api/hosts")return json({hosts:[{id:"local",type:"local",displayName:"NAS",platform:"linux",architecture:"x64",status:"online"}]});
    if(pathname==="/api/workspaces")return json({workspaces:[workspace]});
    if(pathname==="/api/workspace-roots")return json({roots:[{id:"root",displayName:"Root",canonicalPath:"/",allowCreate:true,allowRegister:true,allowClone:true}]});
    if(pathname==="/api/workspaces/workspace/instructions"){
      if(method==="PUT"){const body=route.request().postDataJSON();savedRequest=body;revision++;markdown=body.profile.markdown;}
      return json({profile:{version:1,enabled:true,sourceMode:"combined",markdown,revision,updatedAt:new Date().toISOString(),completionPolicy:{restart:"runtime-change",requireCheck:true,requireTest:true,requireBuild:true,requireDirectVerification:true,execution:"instruct"}},repository:[{name:"AGENTS.md",digest:"abc"}]});
    }
    if(pathname==="/api/collaborations")return json({collaborations:[]});
    if(pathname==="/api/providers/codex/models")return json({catalog:{models:[],permissions:[]}});
    if(pathname==="/api/providers/claude/permissions")return json({models:[],permissions:[],efforts:[],catalog:{models:[],stale:false}});
    if(pathname==="/api/provider-connections"||pathname==="/api/provider-connections/attempts")return json({accounts:[],attempts:[]});
    if(pathname==="/api/quota")return json({claude:{},codex:{},fetchedAt:new Date().toISOString()});
    if(pathname==="/api/emotion")return json({state:{},codexState:{},outfits:[],assets:[],mode:"catch"});
    if(pathname==="/api/push")return json({preferences:{},publicKey:""});
    if(pathname.startsWith("/api/system-settings/"))return json({settings:null,candidates:{claude:[],codex:[]}});
    return json({});
  });
  await page.goto("/");
  const more=page.getByRole("button",{name:"추가 작업",exact:true});if(await more.isVisible())await more.click();
  await page.getByRole("button",{name:"설정 열기",exact:true}).click();
  const settings=page.getByRole("dialog",{name:"설정"});await settings.getByRole("button",{name:"작업공간",exact:true}).click();
  const instructionButton=settings.getByRole("button",{name:"Demo 지침"});await expect(instructionButton).toBeVisible();
  await expect(settings.locator(".instruction-panel")).toHaveCount(0);
  await instructionButton.click();
  const workspaceCard=instructionButton.locator("xpath=ancestor::article"),panel=workspaceCard.locator(":scope > .instruction-panel");await expect(panel).toBeVisible();await expect(panel.getByText("AGENTS.md")).toBeVisible();
  expect(await panel.evaluate(element=>getComputedStyle(element).position)).not.toBe("fixed");
  await expect(panel.getByText("Workhouse가 검사·빌드·재시작을 자동 실행하거나 완료를 증명하지는 않습니다.")).toBeVisible();
  await panel.getByLabel("관리 Markdown").fill("테스트 후 재시작하고 직접 확인한다.");await panel.getByRole("button",{name:"저장"}).click();
  await expect(settings.getByText("Workspace 지침을 저장했습니다. 새 세션부터 이 리비전을 사용합니다.")).toBeVisible();
  expect(savedRequest).toMatchObject({expectedRevision:2,profile:{revision:2,markdown:"테스트 후 재시작하고 직접 확인한다."}});
  expect(await panel.evaluate(element=>element.scrollWidth-element.clientWidth)).toBeLessThanOrEqual(1);
});
