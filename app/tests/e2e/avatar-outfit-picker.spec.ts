import {expect,test,type Page} from "@playwright/test";

// The avatar menu shows one picture tile per character, grouped into AI
// Families V5 and classic sets. The first tap switches character; tapping the
// selected tile again opens the costume sheet (chan/kun twin and costumes).
const costumes=(chan:string,kun:string)=>[...["","-dress","-swimsuit","-pajamas","-towel"].map(s=>chan+s),...["","-formal","-swimsuit","-pajamas","-towel"].map(s=>kun+s)];
const CODEX=["Gpt-Codex","Gpt-Sol",...costumes("Gpt-Codex-v5","Gpt-Codex-kun"),...costumes("Gpt-Sol-v5","Gpt-Sol-kun"),...costumes("Astra-code","Astra-code-kun"),...costumes("Chat-code","Chat-code-kun")];
const SHOT={dark:"avatar-outfit-picker-dark.png",light:"avatar-outfit-picker-light.png"} as const;
const avatarButton=(page:Page,provider:string)=>page.getByRole("button",{name:new RegExp(`^${provider}: .+ — 진행 중·최근 작업 보기$`)});

async function mount(page:Page,theme:"dark"|"light"){
  await page.addInitScript((theme)=>{
    localStorage.setItem("claudex-ui-locale","ko");
    localStorage.setItem("deck-theme",theme);
    class SilentEventSource{onerror:null|(()=>void)=null;constructor(public url:string){}addEventListener(){}close(){}}
    Object.defineProperty(globalThis,"EventSource",{value:SilentEventSource,configurable:true});
  },theme);
  const now=new Date().toISOString(),writes:any[]=[];let codexOutfit="Gpt-Sol";
  await page.route("**/api/**",async route=>{
    const request=route.request(),path=new URL(request.url()).pathname,json=(value:unknown)=>route.fulfill({contentType:"application/json",body:JSON.stringify(value)});
    if(path==="/api/emotion/outfit"){const payload=request.postDataJSON();writes.push(payload);codexOutfit=payload.outfit;return json({provider:payload.provider,state:{emotion:"neutral",line:"",statusLine:"",outfit:codexOutfit}});}
    if(path==="/api/emotion")return json({state:{emotion:"neutral",line:"",statusLine:"",outfit:"normal"},codexState:{emotion:"neutral",line:"",statusLine:"",outfit:codexOutfit},taskStates:{codex:{}},outfits:["normal","capy"],outfitsByProvider:{codex:CODEX,claude:["normal","capy","Claude-code","Claude-code-kun","Fable-code","Fable-code-kun"]},assets:{},mode:"catch"});
    if(path==="/api/provider-connections")return json({singleUser:true,accounts:[{provider:"codex",state:"connected",checkedAt:now}],attempts:[]});
    if(path==="/api/provider-connections/attempts")return json({attempts:[]});
    if(path==="/api/tasks")return json({tasks:[],partial:false,warnings:[]});
    if(path==="/api/projects")return json({projects:[]});
    if(path==="/api/hosts")return json({hosts:[]});
    if(path==="/api/workspaces")return json({workspaces:[]});
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
  return writes;
}

async function openPicker(page:Page){
  const dialog=page.getByRole("dialog",{name:"Codex 아바타 및 세션"});
  if(!(await dialog.isVisible()))await avatarButton(page,"Codex").click();
  const section=dialog.locator("details.agent-pop-profile");
  if(!(await section.evaluate(el=>(el as HTMLDetailsElement).open)))await section.locator("summary").click();
  if(!(await dialog.locator(".outfit-picker").isVisible()))await dialog.getByRole("button",{name:"아바타 설정"}).click();
  const picker=dialog.locator(".outfit-picker");
  await expect(picker).toBeVisible();
  return {dialog,picker};
}

for(const theme of ["dark","light"] as const){
  test(`Codex picks a character, then its twin and costume from the sheet (${theme})`,async({page},testInfo)=>{
    const writes=await mount(page,theme);
    let {picker}=await openPicker(page);
    await expect(picker.locator(".outfit-group-title")).toHaveText(["AI Families V5","기본"]);
    await expect(picker.locator(".outfit-tile .outfit-name")).toHaveText(["Codex","Sol","Astra Code","Chat Code","Codex","Sol"]);
    await expect(picker.locator(".outfit-tile.on .outfit-name")).toHaveText("Sol");
    await expect(picker.locator(".outfit-tile").first().locator("img")).toHaveAttribute("src",/\/emoticons\/Gpt-Codex-v5\/neutral\.webp$/);
    await picker.locator(".outfit-tile").filter({hasText:"Astra Code"}).click();
    // The first tap answers in place: the menu stays open, the tile lights up
    // and offers the costume sheet without reopening anything.
    await expect(picker).toBeVisible();
    await expect(picker.locator(".outfit-tile.on .outfit-name")).toHaveText("Astra Code");
    await expect.poll(()=>writes.at(-1)).toEqual({provider:"codex",outfit:"Astra-code"});
    const astra=picker.locator(".outfit-tile.on");
    await expect(astra.locator(".outfit-name")).toHaveText("Astra Code");
    await expect(astra.locator(".outfit-more")).toHaveText("복장");
    await astra.click();
    const sheet=picker.getByRole("dialog",{name:"Astra Code 복장 고르기"});
    await expect(sheet.locator(".outfit-tile .outfit-name")).toHaveText(["기본","드레스","수영복","잠옷","타올"]);
    await sheet.getByRole("button",{name:"군"}).click();
    await expect(sheet.locator(".outfit-tile .outfit-name")).toHaveText(["기본","귀공자","수영복","잠옷","타올"]);
    await sheet.scrollIntoViewIfNeeded();
    await page.screenshot({path:testInfo.outputPath(SHOT[theme]),fullPage:false});
    await sheet.locator(".outfit-tile").filter({hasText:"수영복"}).click();
    await expect.poll(()=>writes.at(-1)).toEqual({provider:"codex",outfit:"Astra-code-kun-swimsuit"});
    await expect(sheet).toHaveCount(0);
    await expect(picker.locator(".outfit-tile.on img")).toHaveAttribute("src",/\/emoticons\/Astra-code-kun-swimsuit\/neutral\.webp$/);
    await expect(picker.locator(".outfit-tile.on .outfit-variant")).toHaveText("군");
  });
}
