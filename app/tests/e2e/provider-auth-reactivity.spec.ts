import {expect,test} from "@playwright/test";

test("provider OAuth code inputs appear without reopening settings",async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem("claudex-ui-locale","ko");
    class SilentEventSource{onerror:null|(()=>void)=null;constructor(public url:string){}addEventListener(){}close(){}}
    Object.defineProperty(globalThis,"EventSource",{value:SilentEventSource,configurable:true});
    Object.defineProperty(window,"open",{configurable:true,value:()=>({
      closed:false,opener:null,document:{title:"",body:{textContent:""}},
      location:{href:"",replace(){}},close(){}
    })});
  });

  const now=new Date().toISOString();
  const accounts=[
    {provider:"codex",state:"connected",accountType:"chatgpt",planType:"pro",emailMasked:null,errorCategory:null,checkedAt:now},
    {provider:"claude",state:"disconnected",accountType:null,planType:null,emailMasked:null,errorCategory:null,checkedAt:now},
    {provider:"antigravity",state:"disconnected",accountType:null,planType:null,emailMasked:null,errorCategory:null,checkedAt:now}
  ];
  const tasks:any[]=[];
  let antigravityOutfit="Antigravity";
  let outfitWrites=0;
  let attempt:any=null;
  await page.route("**/api/**",async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname;
    let body:any={};
    if(path==="/api/system-settings/locale")body={locale:"ko",saved:true,existingInstallation:true,updatedAt:now};
    else if(path==="/api/system-settings/compatible-providers")body={settings:{deepseek:{provider:"deepseek",baseUrl:"https://api.deepseek.com/anthropic",secretConfigured:false,secretSource:null},ollama:{provider:"ollama",baseUrl:"https://ollama.com",secretConfigured:false,secretSource:null}}};
    else if(path==="/api/setup")body={required:false};
    else if(path==="/api/provider-connections")body={singleUser:true,accounts,attempts:attempt?[attempt]:[]};
    else if(path==="/api/provider-connections/attempts")body={attempts:attempt?[attempt]:[]};
    else if(path==="/api/provider-connections/claude/login"){
      attempt={provider:"claude",attemptId:"reactivity-test",method:"subscription",state:"code_required",createdAt:now,expiresAt:new Date(Date.now()+60000).toISOString(),url:"https://claude.com/oauth/authorize",userCode:null,codeRequired:true,errorCategory:null,inputNonce:"nonce"};
      await new Promise(resolve=>setTimeout(resolve,100));
      body={attempt};
    }else if(path==="/api/provider-connections/antigravity/login"){
      attempt={provider:"antigravity",attemptId:"antigravity-reactivity-test",method:"google-oauth",state:"code_required",createdAt:now,expiresAt:new Date(Date.now()+60000).toISOString(),url:"https://accounts.google.com/o/oauth2/auth",userCode:null,codeRequired:true,errorCategory:null,inputNonce:"antigravity-nonce"};
      await new Promise(resolve=>setTimeout(resolve,100));
      body={attempt};
    }else if(path==="/api/providers/codex/models")body={catalog:{models:[],permissions:[],fetchedAt:now,stale:false}};
    else if(path==="/api/emotion"&&request.method()==="GET")body={state:{emotion:"neutral",line:"",statusLine:"",outfit:"normal"},codexState:{emotion:"neutral",line:"",statusLine:"",outfit:"Gpt-Codex"},antigravityState:{emotion:"neutral",line:"",statusLine:"",outfit:antigravityOutfit},deepseekState:{emotion:"neutral",line:"",statusLine:"",outfit:"DeepSeek"},ollamaState:{emotion:"neutral",line:"",statusLine:"",outfit:"Ollama"},outfits:["capy","normal"],outfitsByProvider:{codex:["Gpt-Codex","Gpt-Sol"],claude:["capy","normal"],antigravity:["Antigravity","Gemma-e4b"],deepseek:["DeepSeek","Ollama"],ollama:["Antigravity","DeepSeek","Gemma-e4b","Ollama"]},assets:{},mode:"catch"};
    else if(path==="/api/emotion/outfit"){
      const payload=request.postDataJSON();outfitWrites++;antigravityOutfit=payload.outfit;body={provider:payload.provider,state:{emotion:"neutral",line:"",statusLine:"",outfit:antigravityOutfit}};
    }
    else if(path==="/api/providers/claude/permissions")body={permissions:[],models:[],efforts:[],runtime:{managed:true}};
    else if(path==="/api/providers/antigravity/models")body={permissions:[],models:[],efforts:[],runtime:{managed:true}};
    else if(path==="/api/tasks")body={tasks,partial:false};
    else if(path==="/api/codex/threads")body={sessions:[],nextCursor:null,stale:false};
    else if(path==="/api/collaborations")body={collaborations:[]};
    else if(path==="/api/projects")body={projects:[]};
    else if(path==="/api/hosts")body={hosts:[]};
    else if(path==="/api/workspaces")body={workspaces:[]};
    else if(path==="/api/workspace-roots")body={roots:[]};
    else if(path==="/api/quota")body={claude:{fiveHour:null,sevenDay:null},codex:{fiveHour:null,sevenDay:null},antigravity:{fiveHour:null,sevenDay:{pct:100,resetsAt:"2026-08-10T04:15:27.000Z",durationMins:10080},limitsAvailable:true,usage:{inputTokens:12,outputTokens:8,taskCount:1}},deepseek:{fiveHour:null,sevenDay:null,limitsAvailable:false,balance:{currency:"USD",total:4.99,granted:0,toppedUp:4.99,available:true},usage:{inputTokens:20,outputTokens:10,taskCount:1}},ollama:{fiveHour:{pct:0,resetsAt:null,durationMins:300},sevenDay:{pct:0.20000000000000004,resetsAt:null,durationMins:10080},limitsAvailable:true,usage:{inputTokens:30,outputTokens:15,taskCount:1}}};
    else if(path.includes("/api/tasks/antigravity/")&&path.endsWith("/events"))body={events:[{type:"message_completed",content:"정상 응답",metadata:{role:"agent",outputUsage:{inputTokens:12,outputTokens:8}}}]};
    await route.fulfill({contentType:"application/json",body:JSON.stringify(body)});
  });

  await page.goto("/",{waitUntil:"domcontentloaded"});
  await expect(page.getByRole("button",{name:"Codex 상태 및 최근 세션"})).toBeVisible();
  await expect(page.getByRole("button",{name:"Gemini 상태 및 최근 세션"})).toHaveCount(0);
  await expect(page.getByRole("button",{name:"DeepSeek 상태 및 최근 세션"})).toHaveCount(0);
  await expect(page.getByRole("button",{name:"Ollama 상태 및 최근 세션"})).toHaveCount(0);
  const more=page.getByRole("button",{name:"추가 작업",exact:true});
  if(await more.isVisible())await more.click();
  await page.getByRole("button",{name:"설정 열기"}).click();
  const settings=page.getByRole("dialog",{name:"설정"});
  await settings.getByRole("button",{name:"실행 기본값",exact:true}).click();
  await expect(settings.getByRole("button",{name:"공통",exact:true})).toHaveAttribute("aria-current","page");
  for(const provider of ["Codex","Claude","Gemini","DeepSeek","Ollama"]){
    await settings.getByRole("button",{name:provider,exact:true}).click();
    await expect(settings.getByText(`${provider} 기본값`,{exact:true})).toBeVisible();
  }
  for(const [provider,count] of [["Gemini",4],["DeepSeek",6],["Ollama",6]] as const){
    await settings.getByRole("button",{name:provider,exact:true}).click();
    const effort=settings.getByText(`${provider} 기본값`,{exact:true}).locator("xpath=following-sibling::label[3]/select");
    await expect(effort).toBeVisible();await expect(effort.locator("option")).toHaveCount(count);
  }
  await settings.getByRole("button",{name:"계정",exact:true}).click();
  const deepseekCard=settings.locator(".provider-connection-card").filter({hasText:"DeepSeek"});
  await expect(deepseekCard.getByLabel("DeepSeek API 주소")).toHaveValue("https://api.deepseek.com/anthropic");
  await expect(deepseekCard.getByLabel("DeepSeek API 키")).toHaveAttribute("type","password");
  const ollamaCard=settings.locator(".provider-connection-card").filter({hasText:"Ollama"});
  await expect(ollamaCard.getByLabel("Ollama Cloud API 주소")).toHaveValue("https://ollama.com");
  await expect(ollamaCard.getByLabel("Ollama Cloud API 키")).toHaveAttribute("type","password");
  const claudeCard=settings.locator(".provider-connection-card").filter({hasText:"Claude Code"});
  await claudeCard.getByRole("button",{name:"Claude 구독으로 연결"}).click();
  await expect(settings).toBeVisible();
  await expect(claudeCard.getByLabel("Claude 인증 코드")).toBeVisible();
  await expect(claudeCard.getByRole("button",{name:"로그인 취소"})).toBeVisible();

  const antigravityCard=settings.locator(".provider-connection-card").filter({hasText:"Gemini"});
  await antigravityCard.getByRole("button",{name:"Google로 연결"}).click();
  await expect(settings).toBeVisible();
  await expect(antigravityCard.getByLabel("Google 인증 코드")).toBeVisible();
  await expect(antigravityCard.getByRole("link",{name:"Google 로그인 페이지 열기"})).toHaveAttribute("href",/^https:\/\/accounts\.google\.com\//);

  attempt=null;
  accounts.find(item=>item.provider==="claude")!.state="connected";
  accounts.find(item=>item.provider==="antigravity")!.state="connected";
  accounts.push(
    {provider:"deepseek",state:"connected",accountType:"apiKey",planType:null,emailMasked:null,errorCategory:null,checkedAt:now},
    {provider:"ollama",state:"connected",accountType:"api-key",planType:null,emailMasked:null,errorCategory:null,checkedAt:now}
  );
  tasks.push({id:"antigravity:test-session",provider:"antigravity",threadId:"antigravity-thread",projectId:"claudex-workhouse",status:"completed",title:"Gemini 실제 세션",prompt:"까꿍",result:"정상 응답",error:null,log:"",owned:true,createdAt:now,updatedAt:now,metadata:{}});
  await settings.getByRole("button",{name:"상태 새로고침"}).click();
  await settings.getByRole("button",{name:"대화상자 닫기"}).click();
  await expect(page.getByRole("button",{name:"Gemini 상태 및 최근 세션"})).toBeVisible();
  await expect(page.getByRole("button",{name:"Claude 상태 및 최근 세션"})).toBeVisible();
  await expect(page.getByRole("button",{name:"DeepSeek 상태 및 최근 세션"})).toBeVisible();
  await expect(page.getByRole("button",{name:"Ollama 상태 및 최근 세션"})).toBeVisible();
  await expect(page.locator(".agent-avatar-dock .avatar-pop")).toHaveCount(0);
  await page.getByRole("button",{name:"Claude 상태 및 최근 세션"}).click();
  const claudeDialog=page.getByRole("dialog",{name:"Claude 아바타 및 세션"});
  await claudeDialog.getByRole("button",{name:"아바타 설정"}).click();
  await expect(claudeDialog.locator(".avatar-choice")).toHaveCount(2);
  await expect(claudeDialog.locator(".avatar-choice")).toHaveText(["capy","normal"]);
  await page.getByRole("button",{name:"Claude 상태 및 최근 세션"}).click();
  for(const provider of ["Gemini","DeepSeek","Ollama"]){
    await page.getByRole("button",{name:`${provider} 상태 및 최근 세션`}).click();
    const dialog=page.getByRole("dialog",{name:`${provider} 아바타 및 세션`});
    await expect(dialog.locator("header strong")).toHaveText(`${provider} 세션`);
    const asset=provider==="Gemini"?"Antigravity":provider;
    const emotion=provider==="Gemini"?"happy":"neutral";
    await expect(dialog.locator(".recent-avatar-profile img").first()).toHaveAttribute("src",new RegExp(`/emoticons/${asset}/${emotion}\\.webp$`));
    await dialog.getByRole("button",{name:"아바타 설정"}).click();
    const expectedOutfits=provider==="Gemini"?["Antigravity","Gemma-e4b"]:provider==="DeepSeek"?["DeepSeek","Ollama"]:["Antigravity","DeepSeek","Gemma-e4b","Ollama"];
    await expect(dialog.locator(".avatar-choice")).toHaveText(expectedOutfits);
    if(provider==="Gemini"){
      await dialog.locator(".avatar-choice").filter({hasText:"Gemma-e4b"}).click();
      expect(outfitWrites).toBe(1);
      await expect(dialog.locator(".recent-avatar-profile img").first()).toHaveAttribute("src",/\/emoticons\/Gemma-e4b\/happy\.webp$/);
      await dialog.getByRole("button",{name:"아바타 설정"}).click();
      await dialog.getByRole("button",{name:/플로팅/}).click();
    }else if(provider==="DeepSeek"){
      await dialog.locator(".avatar-choice").filter({hasText:"Ollama"}).click();
      await expect(dialog.locator(".recent-avatar-profile img").first()).toHaveAttribute("src",/\/emoticons\/Ollama\/neutral\.webp$/);
    }else{
      for(const outfit of ["DeepSeek","Antigravity","Gemma-e4b"]){
        await dialog.locator(".avatar-choice").filter({hasText:outfit}).click();
        await expect(dialog.locator(".recent-avatar-profile img").first()).toHaveAttribute("src",new RegExp(`/emoticons/${outfit}/neutral\\.webp$`));
        if(outfit!=="Gemma-e4b")await dialog.getByRole("button",{name:"아바타 설정"}).click();
      }
    }
    if(provider==="Gemini")await expect(dialog.getByRole("button",{name:/Gemini 실제 세션/})).toBeVisible();
    await page.getByRole("button",{name:`${provider} 상태 및 최근 세션`}).click();
    await expect(dialog).toHaveCount(0);
  }
  const usageButton=page.getByRole("button",{name:"사용량",exact:true});
  if(!(await usageButton.isVisible())){await page.getByRole("button",{name:"추가 작업",exact:true}).click();}
  await usageButton.click();
  const usage=page.locator(".quota-pop");
  for(const provider of ["Codex","Claude","Gemini","DeepSeek","Ollama Cloud"])await expect(usage.getByText(provider,{exact:true})).toBeVisible();
  await expect(usage.locator("section").filter({hasText:"Gemini"}).getByText("100%",{exact:true})).toBeVisible();
  await expect(usage.locator("section").filter({hasText:"Ollama Cloud"}).getByText("0.2%",{exact:true})).toBeVisible();
  await expect(usage.locator(".quota-balance")).toContainText("US$4.99");
  await expect(usage.locator(".quota-observed-usage")).toHaveCount(0);
  const providerChipStyles=await usage.locator(".engine.codex,.engine.ollama").evaluateAll(elements=>Object.fromEntries(elements.map(element=>[element.textContent??"",{background:getComputedStyle(element).backgroundColor,shadow:getComputedStyle(element).boxShadow}])));
  expect(providerChipStyles["Ollama Cloud"]?.shadow).not.toBe(providerChipStyles.Codex?.shadow);
  await page.keyboard.press("Escape");
  await expect(usage).toHaveCount(0);
  await page.getByRole("button",{name:"Gemini 상태 및 최근 세션"}).click();
  await page.getByRole("dialog",{name:"Gemini 아바타 및 세션"}).getByRole("button",{name:/Gemini 실제 세션/}).click();
  await expect(page.locator(".task-heading .engine.antigravity")).toHaveText("Gemini");
  await expect(page.locator(".tray-item.pinned.provider-antigravity")).toBeVisible();
  await expect(page.locator(".conversation").getByText("정상 응답",{exact:true})).toBeVisible();
  await expect(page.locator(".setting-summary")).toBeVisible();
});
