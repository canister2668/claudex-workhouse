import{expect,test}from"@playwright/test";

const captureLocale=(process.env.CLAUDEX_CAPTURE_LOCALE??"ko") as "en"|"ko"|"ja";
const copies={
  en:{primaryNav:"Primary views",sessions:"Sessions",activeTitle:"Active tasks",settingsOpen:"Open settings",settings:"Settings",display:"Display & notifications",running:"Polish the mobile work view",completed:"Review public README screens",waiting:"Check the release checklist",prompt:"Make the task view easy to read on tablets and phones.",reviewPrompt:"Review the screens prepared for the public documentation.",reviewResult:"Review completed.",first:"I’ll start by checking the layout and mobile scrolling behavior.",command:"Static checks",file:"Refined the responsive behavior of the work panel and heading.",last:"On tablets, only the heading and work panel fold. Phones keep the immersive reading flow, and the input remains immediately available.",waitingInput:"Choose the item you want to verify.",activity:"Checking the screen layout."},
  ko:{primaryNav:"주요 화면",sessions:"세션",activeTitle:"실행 중인 작업",settingsOpen:"설정 열기",settings:"설정",display:"화면·알림",running:"모바일 작업 화면 정리",completed:"README 공개 화면 검토",waiting:"배포 체크리스트 확인",prompt:"태블릿과 휴대폰에서 작업 화면을 읽기 편하게 정리해 주세요.",reviewPrompt:"공개 문서에 사용할 화면을 점검해 주세요.",reviewResult:"검토를 완료했습니다.",first:"화면 구조와 모바일 스크롤 동작을 먼저 확인하겠습니다.",command:"정적 검사",file:"작업 패널과 헤더의 반응형 동작을 정리했습니다.",last:"태블릿에서는 헤더와 작업 패널만 접고, 휴대폰에서는 기존 몰입 읽기 흐름을 유지하도록 반영했습니다. 입력창은 필요한 순간 바로 사용할 수 있습니다.",waitingInput:"확인할 항목을 선택해 주세요.",activity:"화면 구성을 확인하고 있습니다."},
  ja:{primaryNav:"メイン画面",sessions:"セッション",activeTitle:"実行中のタスク",settingsOpen:"設定を開く",settings:"設定",display:"表示・通知",running:"モバイル作業画面の整理",completed:"README公開画面のレビュー",waiting:"リリースチェックリストの確認",prompt:"タブレットとスマートフォンで作業画面を読みやすく整えてください。",reviewPrompt:"公開ドキュメントで使用する画面を確認してください。",reviewResult:"レビューが完了しました。",first:"画面構成とモバイルのスクロール動作から確認します。",command:"静的チェック",file:"作業パネルと見出しのレスポンシブ動作を整理しました。",last:"タブレットでは見出しと作業パネルだけを折りたたみ、スマートフォンでは没入型の閲覧フローを維持しました。入力欄は必要なときにすぐ使用できます。",waitingInput:"確認する項目を選択してください。",activity:"画面構成を確認しています。"}
} as const;
const copy=copies[captureLocale];

test(`captures sanitized ${captureLocale} README product screens`,async({page})=>{
  test.skip(process.env.CLAUDEX_CAPTURE_README!=="1","README screenshots are generated only on request");
  await page.setViewportSize({width:1200,height:900});
  await page.addInitScript(({locale,activity,waitingInput})=>{
    localStorage.clear();
    localStorage.setItem("claudex-ui-locale",locale);
    localStorage.setItem("deck-global-settings",JSON.stringify({claudeModel:"claude-opus-5",codexModel:"gpt-5.6-sol"}));
    localStorage.setItem("deck-conversation-prefs",JSON.stringify({claudeModel:"claude-opus-5",codexModel:"gpt-5.6-sol"}));
    class DemoEventSource{
      listeners:Record<string,Array<(event:any)=>void>>={};onerror:null|(()=>void)=null;
      constructor(public url:string){
        setTimeout(()=>this.emit("open",{}),20);
        if(url.includes("demo-running"))setTimeout(()=>this.emit("agent-event",{data:JSON.stringify({type:"message_completed",content:activity,sequence:6,timestamp:new Date().toISOString(),metadata:{role:"agent",phase:"commentary"}})}),50);
        if(url.includes("demo-waiting"))setTimeout(()=>this.emit("agent-event",{data:JSON.stringify({type:"user_input_requested",content:waitingInput,sequence:1,timestamp:new Date().toISOString(),metadata:{role:"agent"}})}),50);
      }
      addEventListener(type:string,listener:(event:any)=>void){(this.listeners[type]??=[]).push(listener);}
      emit(type:string,event:any){for(const listener of this.listeners[type]??[])listener(event);}
      close(){}
    }
    Object.defineProperty(globalThis,"EventSource",{value:DemoEventSource,configurable:true});
  },{locale:captureLocale,activity:copy.activity,waitingInput:copy.waitingInput});

  const base=Date.now(),ago=(minutes:number)=>new Date(base-minutes*60_000).toISOString(),now=new Date(base).toISOString();
  const task=(id:string,provider:"codex"|"claude",title:string,status:string,updatedAt:string)=>({
    id,provider,nativeId:id,threadId:`${provider}-${id}-demo-thread`,projectId:"demo-project",title,
    prompt:title===copy.running?copy.prompt:copy.reviewPrompt,
    status,createdAt:ago(40),updatedAt,result:status==="completed"?copy.reviewResult:null,error:null,log:"",
    owned:true,ownership:"claudex-workhouse",source:"claudex-workhouse",executionHostId:"demo-host",workspaceId:"demo-workspace",
    requestedModel:provider==="codex"?"gpt-5.6-sol":"claude-opus-5",requestedReasoningEffort:"medium",permissionProfile:provider==="codex"?":workspace":":workspace-write",metadata:{}
  });
  const running=task("demo-running","claude",copy.running,"running",now);
  const completed=task("demo-completed","codex",copy.completed,"completed",ago(10));
  const waiting=task("demo-waiting","claude",copy.waiting,"waiting",ago(20));
  const tasks=[running,completed,waiting];
  const events=[
    {type:"message",content:running.prompt,provider:"claude",sequence:1,timestamp:ago(40),metadata:{role:"user"}},
    {type:"message_completed",content:copy.first,provider:"claude",sequence:2,timestamp:ago(38),metadata:{role:"agent",phase:"commentary"}},
    {type:"command_completed",content:"pnpm run check",provider:"claude",sequence:3,timestamp:ago(25),metadata:{description:copy.command,exitCode:0,durationMs:18400}},
    {type:"file_change_completed",content:copy.file,provider:"claude",sequence:4,timestamp:ago(18),metadata:{path:"app/src/web/Conversation.svelte",pathBase:"workspace",additions:18,deletions:5}},
    {type:"message_completed",content:copy.last,provider:"claude",sequence:5,timestamp:now,metadata:{role:"agent",phase:"commentary"}}
  ];

  await page.route("**/api/**",async route=>{
    const url=new URL(route.request().url()),pathname=url.pathname,json=(value:unknown)=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(value)});
    if(pathname==="/api/tasks")return json({tasks,partial:false,warnings:[]});
    if(pathname==="/api/tasks/claude/demo-running")return json({task:running});
    if(pathname==="/api/tasks/claude/demo-running/events")return json({taskId:running.id,status:"running",latestSequence:events.length,events});
    if(pathname.includes("/message-queue"))return json({items:[],activeTask:null});
    if(pathname==="/api/projects")return json({projects:[{id:"demo-project",name:"Demo Project",enabled:true,error:null}]});
    if(pathname==="/api/hosts")return json({hosts:[{id:"demo-host",type:"local",displayName:"Personal NAS",platform:"linux",architecture:"x64",status:"online",lastSeenAt:now,capabilities:{}}]});
    if(pathname.startsWith("/api/workspaces"))return json({workspaces:[{id:"demo-workspace",projectId:"demo-project",hostId:"demo-host",displayName:"Demo Workspace",canonicalPath:"/demo/workspace"}]});
    if(pathname==="/api/collaborations")return json({collaborations:[]});
    if(pathname==="/api/providers/codex/models")return json({catalog:{models:[{id:"gpt-5.6-sol",displayName:"GPT-5.6",hidden:false,isDefault:true,supportedReasoningEfforts:[{reasoningEffort:"medium"}]}],permissions:[{id:":workspace",allowed:true}],stale:false}});
    if(pathname==="/api/providers/claude/permissions")return json({models:[{id:"claude-opus-5",displayName:"Claude Opus"},{id:"claude-opus-4-8",displayName:"Claude Opus 4.8"}],permissions:[{id:":workspace-write",description:"편집"}],efforts:[{id:"medium",displayName:"중간"}],catalog:{models:[{id:"claude-opus-5",displayName:"Claude Opus",hidden:false,isDefault:true},{id:"claude-opus-4-8",displayName:"Claude Opus 4.8",hidden:false,isDefault:false}],stale:false}});
    if(pathname==="/api/provider-connections")return json({singleUser:true,accounts:[{provider:"codex",state:"connected",accountType:"chatgpt",planType:"personal",emailMasked:null},{provider:"claude",state:"connected",accountType:"claude.ai",planType:"personal",emailMasked:null}]});
    if(pathname==="/api/provider-connections/attempts")return json({attempts:[]});
    if(pathname==="/api/quota")return json({claude:{fiveHour:{pct:34,resetsAt:"2026-07-31T18:00:00.000Z",durationMins:300}},codex:{fiveHour:{pct:21,resetsAt:"2026-07-31T18:00:00.000Z",durationMins:300}},fetchedAt:now});
    if(pathname==="/api/emotion")return json({state:{outfit:"normal",emotion:"neutral"},codexState:{outfit:"Gpt-Codex",emotion:"neutral"},outfits:["normal","Gpt-Codex"],assets:{normal:[{emotion:"neutral",file:"neutral.webp"}],"Gpt-Codex":[{emotion:"neutral",file:"neutral.webp"}]},mode:"catch"});
    if(pathname==="/api/push")return json({preferences:{},publicKey:""});
    if(pathname==="/api/runtime-updates")return json({runtimes:[]});
    if(pathname.startsWith("/api/system-settings/"))return json({settings:null,candidates:{claude:[],codex:[]},locale:captureLocale,saved:true,existingInstallation:true});
    return json({});
  });

  await page.goto("/",{waitUntil:"domcontentloaded"});
  await expect(page.getByRole("heading",{name:copy.activeTitle})).toBeVisible();
  await expect(page.locator(".model-filter-notice")).toHaveCount(0);
  await page.addStyleTag({content:".agent-status-tray{display:none!important}"});
  await page.screenshot({path:`../docs/images/home.${captureLocale}.png`,animations:"disabled"});

  const primaryNav=page.getByRole("navigation",{name:copy.primaryNav});
  await primaryNav.getByRole("button",{name:copy.sessions,exact:true}).click();
  await expect(page.getByRole("button",{name:new RegExp(copy.running)})).toBeVisible();
  await page.screenshot({path:`../docs/images/sessions.${captureLocale}.png`,animations:"disabled"});

  await page.getByRole("button",{name:new RegExp(copy.running)}).click();
  await expect(page.locator(".conversation")).toBeVisible();
  const workPanel=page.locator(".work-status-badge");
  if(await workPanel.getAttribute("aria-expanded")==="true")await workPanel.click();
  await expect(workPanel).toHaveAttribute("aria-expanded","false");
  await page.screenshot({path:`../docs/images/task-session.${captureLocale}.png`,animations:"disabled"});

  await page.getByRole("button",{name:copy.settingsOpen}).click();
  const settings=page.getByRole("dialog",{name:copy.settings});
  await expect(settings).toBeVisible();
  const displayTab=settings.getByRole("button",{name:copy.display,exact:true});
  if(await displayTab.count())await displayTab.click();
  await page.screenshot({path:`../docs/images/settings.${captureLocale}.png`,animations:"disabled"});
});
