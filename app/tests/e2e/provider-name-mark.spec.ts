import {expect,test} from "@playwright/test";

test("global avatar display switches every provider between localized marks and character art",async({page})=>{
  test.setTimeout(60_000);
  await page.addInitScript(()=>{
    localStorage.setItem("claudex-ui-locale","ko");
    class SilentEventSource{onerror:null|(()=>void)=null;constructor(public url:string){}addEventListener(){}close(){}}
    Object.defineProperty(globalThis,"EventSource",{value:SilentEventSource,configurable:true});
  });
  const now=new Date().toISOString();
  const providers=["codex","claude","grok","antigravity","deepseek","ollama"] as const;
  const outfits={codex:"Gpt-Codex",claude:"normal",grok:"Grok",antigravity:"Antigravity",deepseek:"DeepSeek",ollama:"Ollama"};
  const settings={version:1,avatarDisplay:"name-mark",providers:Object.fromEntries(providers.map(provider=>[provider,{nickname:provider,tonePreset:"default",conversationOnly:true,customTone:"",avatarOutfit:outfits[provider],emotionIntensity:"natural"}]))};
  const tasks=providers.map(provider=>({id:`${provider}:mark`,provider,nativeId:"mark",threadId:`${provider}-thread`,projectId:"project",title:`${provider} mark`,prompt:"fixture",status:"completed",createdAt:now,updatedAt:now,result:"done",error:null,log:"",owned:true,ownership:"claudex-workhouse",executionHostId:"local",workspaceId:"workspace",metadata:{}}));
  await page.route("**/api/**",async route=>{
    const url=new URL(route.request().url()),path=url.pathname,json=(value:unknown)=>route.fulfill({contentType:"application/json",body:JSON.stringify(value)});
    if(path==="/api/system-settings/characters")return json({settings});
    if(path==="/api/emotion")return json({state:{emotion:"neutral",outfit:"normal"},codexState:{emotion:"neutral",outfit:"Gpt-Codex"},deepseekState:{emotion:"neutral",outfit:"DeepSeek"},ollamaState:{emotion:"neutral",outfit:"Ollama"},antigravityState:{emotion:"neutral",outfit:"Antigravity"},grokState:{emotion:"neutral",outfit:"Grok"},taskStates:{codex:{},claude:{},antigravity:{},deepseek:{},ollama:{},grok:{}},outfitsByProvider:{codex:["Gpt-Codex","Gpt-Sol"],claude:["normal"],antigravity:["Antigravity"],deepseek:["DeepSeek"],ollama:["Ollama"],grok:["Grok"]},assets:{},mode:"catch"});
    if(path==="/api/tasks"){const provider=url.searchParams.get("provider");return json({tasks:provider?tasks.filter(task=>task.provider===provider):tasks,partial:false,warnings:[]});}
    if(path==="/api/provider-connections")return json({singleUser:true,accounts:providers.map(provider=>({provider,state:"connected",checkedAt:now})),attempts:[]});
    if(path==="/api/provider-connections/attempts")return json({attempts:[]});
    if(path==="/api/projects")return json({projects:[{id:"project",name:"Project",enabled:true}]});
    if(path==="/api/hosts")return json({hosts:[{id:"local",displayName:"Local",status:"online"}]});
    if(path==="/api/workspaces")return json({workspaces:[{id:"workspace",projectId:"project",hostId:"local",displayName:"Project",canonicalPath:"/workspace"}]});
    if(path==="/api/collaborations")return json({collaborations:[]});
    if(path==="/api/conversation-documents")return json({documents:[]});
    if(path==="/api/quota-reservations")return json({reservations:[]});
    if(path==="/api/providers/codex/models")return json({catalog:{models:[],permissions:[]}});
    if(path==="/api/providers/claude/permissions"||path.includes("/models"))return json({permissions:[],models:[],efforts:[],catalog:{models:[]}});
    if(path.startsWith("/api/system-settings/"))return json(path.endsWith("locale")?{locale:"ko",saved:true}:{settings:null});
    if(path==="/api/quota")return json({claude:{},codex:{},fetchedAt:now});
    if(path==="/api/push")return json({preferences:{},publicKey:""});
    if(path==="/api/setup")return json({required:false});
    return json({});
  });

  await page.goto("/",{waitUntil:"domcontentloaded"});
  const marks=page.locator(".agent-avatar-dock .agent-avatar-slot .provider-name-mark");
  await expect(marks).toHaveCount(6);
  await expect(marks).toHaveText(["코","클","그","젬","딥","올"]);
  await expect(page.locator(".agent-avatar-dock .agent-avatar-slot img")).toHaveCount(0);

  await page.getByRole("button",{name:"추가 작업"}).click();
  await page.getByRole("button",{name:"설정 열기"}).click();
  const settingsDialog=page.getByRole("dialog",{name:"설정"});
  await settingsDialog.getByRole("button",{name:"대화·캐릭터"}).click();
  await expect(settingsDialog.getByRole("button",{name:"업무용 이름 마크"})).toHaveClass(/active/);
  await settingsDialog.getByRole("button",{name:"캐릭터 이미지"}).click();
  await expect(page.locator(".agent-avatar-dock .agent-avatar-slot .provider-name-mark")).toHaveCount(0);
  await expect(page.locator(".agent-avatar-dock .agent-avatar-slot img")).toHaveCount(6);
});
