import {expect,test,type Page} from "@playwright/test";
import {DEFAULT_CHARACTERS} from "../../src/web/character-settings";

async function mount(page:Page,theme:"dark"|"light"){
  await page.addInitScript(theme=>{localStorage.setItem("claudex-ui-locale","ko");localStorage.setItem("deck-theme",theme);class SilentEventSource{onerror=null;constructor(public url:string){}addEventListener(){}close(){}}Object.defineProperty(globalThis,"EventSource",{value:SilentEventSource});},theme);
  const now=new Date().toISOString(),writes:any[]=[],settings=structuredClone(DEFAULT_CHARACTERS);
  const task={id:"claude:tone-test",provider:"claude",nativeId:"tone-test",threadId:"33333333-3333-4333-8333-333333333333",projectId:"tone-test",title:"톤 전환 테스트",prompt:"fixture",status:"completed",createdAt:now,updatedAt:now,result:"done",error:null,log:"",owned:true,ownership:"claudex-workhouse",source:"claudex-workhouse",executionHostId:"local",workspaceId:"workspace-test",metadata:{}};
  let state={tonePreset:null as string|null,scope:"once",editable:true,title:task.title};
  await page.route("**/api/**",async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname,json=(v:unknown)=>route.fulfill({contentType:"application/json",body:JSON.stringify(v)});
    if(path==="/api/system-settings/characters")return json({settings});
    if(path.endsWith("/tone-favorites")){const payload=request.postDataJSON();writes.push(payload);settings.providers.claude.toneFavorites=payload.favorites;return json({settings});}
    if(path.endsWith("/tone")){if(request.method()==="PUT"){const payload=request.postDataJSON();writes.push(payload);state={...state,...payload};}return json(state);}
    if(path==="/api/emotion")return json({state:{emotion:"neutral",line:"",statusLine:"",outfit:"normal"},codexState:{emotion:"neutral",line:"",statusLine:"",outfit:"Gpt-Sol"},outfits:["normal","capy"],outfitsByProvider:{claude:["normal","capy"]},assets:{normal:[{emotion:"neutral",file:"neutral.webp"},{emotion:"happy",file:"happy.webp"},{emotion:"pout",file:"pout.webp"},{emotion:"smug",file:"smug.webp"}]},mode:"catch"});
    if(path==="/api/provider-connections")return json({singleUser:true,accounts:[{provider:"claude",state:"connected",checkedAt:now}],attempts:[]});
    if(path==="/api/provider-connections/attempts")return json({attempts:[]});
    if(path==="/api/tasks")return json({tasks:[task],partial:false,warnings:[]});
    if(path.startsWith("/api/tasks/"))return json(path.endsWith("/snapshot")?{task}:{events:[],turns:[],task});
    if(path==="/api/projects")return json({projects:[{id:"tone-test",name:"Tone test",enabled:true}]});
    if(path==="/api/hosts")return json({hosts:[{id:"local",displayName:"Local",status:"online"}]});
    if(path==="/api/workspaces")return json({workspaces:[{id:"workspace-test",projectId:"tone-test",hostId:"local",displayName:"Tone test",canonicalPath:"/test"}]});
    if(path==="/api/collaborations")return json({collaborations:[]});
    if(path==="/api/conversation-documents")return json({documents:[]});
    if(path==="/api/quota-reservations")return json({reservations:[]});
    if(path==="/api/providers/codex/models")return json({catalog:{models:[],permissions:[]}});
    if(path==="/api/providers/claude/permissions")return json({permissions:[],models:[],efforts:[],catalog:{models:[]}});
    if(path.startsWith("/api/system-settings/"))return json(path.endsWith("locale")?{locale:"ko",saved:true,existingInstallation:true,updatedAt:now}:{settings:null});
    if(path==="/api/quota")return json({claude:{},codex:{},fetchedAt:now});
    if(path==="/api/push")return json({preferences:{},publicKey:""});
    if(path==="/api/setup")return json({required:false});
    return json({});
  });
  await page.goto("/",{waitUntil:"domcontentloaded"});
  return{writes,settings};
}
for(const theme of ["dark","light"] as const){
  test(`tone cards and three configurable quick slots (${theme})`,async({page},info)=>{
    test.setTimeout(120000);
    const {writes}=await mount(page,theme);
    await page.locator(".agent-avatar-slot.claude").getByRole("button").first().click();
    let panel=page.locator(".agent-popover");
    await expect(panel.locator(".tone-quick-card")).toHaveCount(3);
    await expect(panel.locator("button.tone-quick-card").first()).toBeDisabled();
    await panel.getByRole("button",{name:/톤 전환 테스트/}).click();
    await page.locator(".agent-avatar-slot.claude").getByRole("button").first().click();
    panel=page.locator(".agent-popover");
    await expect(panel.locator(".session-tone-target").first()).toContainText("톤 전환 테스트");
    await panel.getByRole("radio",{name:"한 번만",exact:true}).click();
    await panel.locator(".tone-quick-card").last().click();
    await expect.poll(()=>writes.at(-1)).toEqual({tonePreset:"tsundere",scope:"once"});
    await panel.getByRole("radio",{name:"이 세션 계속",exact:true}).click();
    await panel.locator(".tone-quick-card").first().click();
    await expect.poll(()=>writes.at(-1)).toEqual({tonePreset:"default",scope:"session"});
    await panel.getByRole("button",{name:"전체 톤 보기"}).click();
    const cards=panel.locator(".tone-card");
    await expect(cards).toHaveCount(14);
    await expect(cards.nth(0).locator("img")).toHaveAttribute("src",/neutral\.webp$/);
    await expect(cards.nth(2).locator("img")).toHaveAttribute("src",/happy\.webp$/);
    await expect(cards.filter({hasText:"비서 모드"}).locator(".tone-card-pin")).toBeDisabled();
    await cards.first().locator(".tone-card-pin").click();
    await expect.poll(()=>writes.at(-1)?.favorites?.length).toBe(2);
    await cards.filter({hasText:"비서 모드"}).locator(".tone-card-pin").click();
    await expect.poll(()=>writes.at(-1)?.favorites).toEqual(["flirty-friend","tsundere","secretary"]);
    await panel.getByRole("button",{name:"전체 톤 접기"}).click();
    await page.screenshot({path:info.outputPath(`tone-quick-${theme}.png`)});
    expect(await panel.evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);
    await panel.getByRole("button",{name:"기본으로 돌리기"}).click();
    await expect.poll(()=>writes.at(-1)?.tonePreset).toBeNull();
    await panel.press("Escape");
    const more=page.getByRole("banner").getByRole("button",{name:"추가 작업",exact:true});if(await more.isVisible())await more.click();
    await page.getByRole("button",{name:"설정 열기",exact:true}).click();
    const settings=page.getByRole("region",{name:"설정",exact:true});
    await settings.getByRole("navigation",{name:"설정",exact:true}).getByRole("button",{name:"에이전트별 설정",exact:true}).click();
    await settings.getByRole("navigation",{name:"에이전트별 설정",exact:true}).getByRole("button",{name:"Claude",exact:true}).click();
    await settings.getByRole("button",{name:"캐릭터",exact:true}).click();
    await expect(settings.locator(".tone-card")).toHaveCount(14);
    await settings.locator(".tone-card").filter({hasText:"비서 모드"}).locator(".tone-card-pick").click();
    await expect(settings.locator(".tone-card.on")).toContainText("비서 모드");
    await settings.locator(".tone-card-picker").scrollIntoViewIfNeeded();
    await page.screenshot({path:info.outputPath(`tone-global-${theme}.png`)});
    expect(await settings.evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);
  });
}

test("an API failure is not a missing session",async({page})=>{
  await mount(page,"dark");
  await page.locator(".agent-avatar-slot.claude").getByRole("button").first().click();
  await page.locator(".agent-popover").getByRole("button",{name:/톤 전환 테스트/}).click();
  await page.route("**/api/tasks/claude/*/tone",route=>route.fulfill({status:200,contentType:"text/html",body:"<!doctype html><html></html>"}));
  await page.locator(".agent-avatar-slot.claude").getByRole("button").first().click();
  const control=page.locator(".session-tone-control");
  await expect(control.getByRole("alert")).toContainText("올바른 응답");
  await expect(control.getByText("톤을 바꿀 세션을 먼저 열어 주세요.",{exact:true})).toHaveCount(0);
  await expect(control.locator("button.tone-quick-card").first()).toBeDisabled();
});
