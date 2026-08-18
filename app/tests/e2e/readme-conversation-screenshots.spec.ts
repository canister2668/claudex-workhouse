import{expect,test}from"@playwright/test";

const captureLocale=(process.env.CLAUDEX_CAPTURE_LOCALE??"ko") as "en"|"ko"|"ja";
const copies={
  en:{primaryNav:"Primary views",conversation:"Conversation",title:"Multi-provider mobile UI review",prompt:"Review the responsive conversation layout together.",codex:"I checked the information hierarchy and the compact controls.",claude:"The reading flow remains clear on both tablets and phones.",deepseek:"The four-provider grid keeps every response equally visible.",ollama:"On phones, the cards stack into a single readable column."},
  ko:{primaryNav:"주요 화면",conversation:"대화",title:"멀티 Provider 모바일 UI 검토",prompt:"반응형 대화 레이아웃을 함께 검토해 주세요.",codex:"정보 위계와 축약된 조작 영역을 확인했습니다.",claude:"태블릿과 휴대폰 모두 읽기 흐름이 명확하게 유지됩니다.",deepseek:"4인 격자에서도 각 응답이 같은 비중으로 보입니다.",ollama:"휴대폰에서는 카드가 읽기 쉬운 한 열로 쌓입니다."},
  ja:{primaryNav:"メイン画面",conversation:"会話",title:"マルチProvider モバイルUIレビュー",prompt:"レスポンシブな対話レイアウトを一緒に確認してください。",codex:"情報の階層とコンパクトな操作領域を確認しました。",claude:"タブレットとスマートフォンの両方で読みやすさを保っています。",deepseek:"4人グリッドでも各回答が同じ比重で表示されます。",ollama:"スマートフォンではカードが読みやすい1列に並びます。"}
} as const;
const copy=copies[captureLocale];

test(`captures sanitized ${captureLocale} README conversation screens`,async({page})=>{
  test.skip(process.env.CLAUDEX_CAPTURE_README!=="1","README screenshots are generated only on request");
  await page.addInitScript(locale=>{
    localStorage.clear();
    localStorage.setItem("claudex-ui-locale",locale);
    class SilentEventSource{onerror:null|(()=>void)=null;constructor(public url:string){}addEventListener(){}close(){}}
    Object.defineProperty(globalThis,"EventSource",{value:SilentEventSource,configurable:true});
  },captureLocale);
  const now=new Date().toISOString(),id="cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd";
  const providers=["codex","claude","deepseek","ollama"] as const;
  const session={id,projectId:"demo-project",title:copy.title,mode:"debate",status:"waiting-user",outcome:"awaiting-user",primaryParticipantId:null,maxCalls:8,currentCallCount:4,currentStep:"waiting-user",timeoutAt:now,controllerGeneration:1,workChainId:null,sourceTaskId:null,createdAt:now,updatedAt:now,completedAt:null,cancelledAt:null,archivedAt:null,maxTurnsPerParticipant:5,metadata:{topLevel:true,conversationFlow:"guided",conversationKind:"casual",conversationTurnLength:"rich",currentRound:1,waitingForUser:true,enabledProviders:providers,participantOrder:providers}};
  const participants=providers.map((provider,index)=>({id:`p-${provider}`,collaborationSessionId:id,provider,role:index===0?"primary":"reviewer",executionHostId:"demo-host",workspaceId:"demo-workspace",providerSessionId:`${provider}-demo-session`,permissionMode:"read",status:"completed",sessionGeneration:1,capabilitySnapshot:{newSession:true},createdAt:now,updatedAt:now,archivedAt:null}));
  const runs=providers.map((provider,index)=>({id:`run-${provider}`,collaborationSessionId:id,participantId:`p-${provider}`,round:1,sequence:index+1,attempt:1,purpose:"debate-turn",providerTaskId:`task-${provider}`,status:"completed",generation:1,errorCategory:null,completedAt:now}));
  const text:Record<(typeof providers)[number],string>={codex:copy.codex,claude:copy.claude,deepseek:copy.deepseek,ollama:copy.ollama};
  const output=(provider:(typeof providers)[number])=>`[[e:thinking]]\n${text[provider]}\n\n[[e:happy]]\n${provider==="codex"?copy.deepseek:provider==="claude"?copy.ollama:provider==="deepseek"?copy.codex:copy.claude}`;
  const tasks=Object.fromEntries(providers.map(provider=>[`task-${provider}`,{id:`task-${provider}`,provider,threadId:`${provider}-demo-session`,workspaceId:"demo-workspace",executionHostId:"demo-host",status:"completed",result:output(provider),updatedAt:now,requestedModel:`${provider}-demo-model`}])) as Record<string,unknown>;
  const runOutputs=Object.fromEntries(providers.map(provider=>[`run-${provider}`,output(provider)]));
  const detail={session,participants,runs,messages:[{id:"message-user",messageType:"user-input",contentRef:copy.prompt,round:1,createdAt:now}],avatarStates:[],runOutputs,runEvents:{},tasks,continuation:{available:true,canAddRounds:true,canAutoContinue:true,canSubmitUserInput:true,canRetryFailedTurn:false}};

  await page.route("**/api/**",async route=>{
    const pathname=new URL(route.request().url()).pathname,json=(value:unknown)=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(value)});
    if(pathname==="/api/collaborations")return json({collaborations:[session]});
    if(pathname===`/api/collaborations/${id}`)return json(detail);
    if(pathname==="/api/conversation-documents")return json({documents:[]});
    if(pathname==="/api/tasks")return json({tasks:[],partial:false,warnings:[]});
    if(pathname==="/api/projects")return json({projects:[{id:"demo-project",name:"Demo Project",enabled:true,error:null}]});
    if(pathname==="/api/hosts")return json({hosts:[{id:"demo-host",type:"local",displayName:"Personal NAS",platform:"linux",architecture:"x64",status:"online",lastSeenAt:now,capabilities:{}}]});
    if(pathname.startsWith("/api/workspaces"))return json({workspaces:[{id:"demo-workspace",projectId:"demo-project",hostId:"demo-host",displayName:"Demo Workspace",canonicalPath:"/demo/workspace"}]});
    if(pathname==="/api/emotion"){
      const emotions=["thinking","happy"],assets=()=>emotions.map(emotion=>({emotion,file:`${emotion}.webp`}));
      return json({state:{outfit:"normal",emotion:"neutral"},codexState:{outfit:"Gpt-Codex",emotion:"neutral"},outfits:["normal","Gpt-Codex","DeepSeek","Ollama"],assets:{normal:assets(),"Gpt-Codex":assets(),DeepSeek:assets("DeepSeek"),Ollama:assets("Ollama")},mode:"catch"});
    }
    if(pathname==="/api/providers/codex/models")return json({catalog:{models:[],permissions:[]}});
    if(pathname==="/api/providers/claude/permissions")return json({models:[],permissions:[],efforts:[],catalog:{models:[],stale:false}});
    if(pathname==="/api/provider-connections")return json({singleUser:true,accounts:[]});
    if(pathname==="/api/provider-connections/attempts")return json({attempts:[]});
    if(pathname==="/api/quota")return json({fetchedAt:now});
    if(pathname==="/api/push")return json({preferences:{},publicKey:""});
    if(pathname==="/api/runtime-updates")return json({runtimes:[]});
    if(pathname.startsWith("/api/system-settings/"))return json({settings:null,candidates:{claude:[],codex:[]},locale:captureLocale,saved:true,existingInstallation:true});
    return json({});
  });

  await page.setViewportSize({width:800,height:1000});
  await page.goto("/",{waitUntil:"domcontentloaded"});
  const primaryNav=page.getByRole("navigation",{name:copy.primaryNav});
  await primaryNav.getByRole("button",{name:copy.conversation,exact:true}).click();
  await page.getByRole("button",{name:new RegExp(copy.title)}).click();
  const timeline=page.locator(".collaboration-view");
  const providerCards=timeline.locator(".conversation-round-outputs>.participant-block");
  await expect(providerCards).toHaveCount(4);
  await page.addStyleTag({content:".agent-status-tray{display:none!important}"});
  await page.locator(".collaboration-detail").evaluate(element=>element.scrollTop=0);
  await page.screenshot({path:`../docs/images/conversation-tablet.${captureLocale}.png`,animations:"disabled"});
  await page.setViewportSize({width:360,height:800});
  await providerCards.first().scrollIntoViewIfNeeded();
  const screenshotStyle=await page.addStyleTag({content:".conversation-control-dock{display:none!important}"});
  await page.screenshot({path:`../docs/images/conversation-mobile.${captureLocale}.png`,animations:"disabled"});
  await screenshotStyle.evaluate(node=>node.remove());
});
