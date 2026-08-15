import { expect, test } from "@playwright/test";

test("empty temporary storage does not consume the remaining settings height",async({page},testInfo)=>{
  await page.addInitScript(()=>{
    localStorage.setItem("claudex-ui-locale","ko");
    class SilentEventSource{constructor(public url:string){}addEventListener(){}close(){}}
    Object.defineProperty(globalThis,"EventSource",{value:SilentEventSource,configurable:true});
  });
  await page.route("**/api/**",async route=>{
    const pathname=new URL(route.request().url()).pathname,json=(value:unknown)=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(value)});
    if(pathname==="/api/bootstrap/owner-claim/status")return json({required:false});
    if(pathname==="/api/system-settings/locale")return json({locale:"ko",saved:true,existingInstallation:true});
    if(pathname==="/api/infrastructure/artifacts")return json({generatedAt:new Date().toISOString(),summary:{total:0,present:0,missing:0,changed:0},entries:[]});
    if(pathname==="/api/infrastructure/temp-storage")return json({state:"idle",overview:null,policy:null});
    if(pathname==="/api/tasks")return json({tasks:[],partial:false,warnings:[]});
    if(pathname==="/api/projects")return json({projects:[]});
    if(pathname==="/api/hosts")return json({hosts:[]});
    if(pathname==="/api/workspaces")return json({workspaces:[]});
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
  const more=page.getByRole("button",{name:"추가 작업",exact:true});
  if(await more.isVisible())await more.click();
  await page.getByRole("button",{name:"설정 열기",exact:true}).click();
  const settings=page.locator(".global-settings");
  // Artifact cleanup is a sub-tab of the storage settings tab.
  await settings.getByRole("button",{name:"저장소",exact:true}).click();
  await settings.getByRole("button",{name:"산출물 정리",exact:true}).click();
  const cleanup=settings.locator(".cleanup"),empty=cleanup.getByText("아직 검사하지 않았습니다. 임시 세션 파일을 확인할 때만 검사를 시작하세요.",{exact:true});
  await expect(empty).toBeVisible();
  const box=await cleanup.boundingBox(),emptyBox=await empty.boundingBox(),buttonBox=await cleanup.getByRole("button",{name:"임시 저장소 검사",exact:true}).boundingBox();
  expect(box).not.toBeNull();expect(emptyBox).not.toBeNull();expect(buttonBox).not.toBeNull();
  expect(box!.height).toBeLessThan(240);
  expect(emptyBox!.y-box!.y).toBeLessThan(190);
  expect(buttonBox!.height).toBeLessThan(70);
  await page.screenshot({path:`test-results/${testInfo.project.name}-artifact-empty-layout.png`,fullPage:true});
});
