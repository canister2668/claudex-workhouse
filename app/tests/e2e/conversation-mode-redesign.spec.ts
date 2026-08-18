import{expect,test}from"@playwright/test";
import{readFileSync}from"node:fs";

test("conversation mode keeps alternating emotion scenes inside the lighter timeline",async({page})=>{
  test.setTimeout(45_000);
  await page.addInitScript(()=>{
    localStorage.setItem("claudex-ui-locale","ko");
    localStorage.setItem("ui.liveWorkRedesign","false");
    localStorage.setItem("deck-global-settings",JSON.stringify({enterToSend:true}));
    class SilentEventSource{onerror:null|(()=>void)=null;constructor(public url:string){}addEventListener(){}close(){}}
    Object.defineProperty(globalThis,"EventSource",{value:SilentEventSource,configurable:true});
  });
  const now=new Date().toISOString(),id="abababab-abab-4bab-8bab-abababababab",managedContent="# 대화 결론\n\n관리 UI 테스트\n",managedPath="docs/conversation-abababab-conclusion.md";
  const session={id,projectId:"project",title:"모바일 UI 공동 리뷰",mode:"debate",status:"waiting-user",outcome:"awaiting-user",primaryParticipantId:null,maxCalls:4,currentCallCount:2,currentStep:"waiting-user",timeoutAt:now,controllerGeneration:1,workChainId:null,sourceTaskId:null,createdAt:now,updatedAt:now,completedAt:null,cancelledAt:null,archivedAt:null,maxTurnsPerParticipant:5,metadata:{topLevel:true,conversationFlow:"guided",conversationKind:"casual",conversationTurnLength:"rich",currentRound:1,waitingForUser:true,enabledProviders:["codex","claude"],participantOrder:["codex","claude"]}};
  const participants=[
    {id:"p-codex",collaborationSessionId:id,provider:"codex",role:"primary",executionHostId:"local",workspaceId:"workspace-long-codex-id",providerSessionId:"codex-session-id",permissionMode:"read",status:"completed",sessionGeneration:1,capabilitySnapshot:{newSession:true},createdAt:now,updatedAt:now,archivedAt:null},
    {id:"p-claude",collaborationSessionId:id,provider:"claude",role:"reviewer",executionHostId:"local",workspaceId:"workspace-long-claude-id",providerSessionId:"claude-session-id",permissionMode:"read",status:"completed",sessionGeneration:1,capabilitySnapshot:{newSession:true},createdAt:now,updatedAt:now,archivedAt:null}
  ];
  const runs=[
    {id:"run-codex",collaborationSessionId:id,participantId:"p-codex",round:1,sequence:1,attempt:1,purpose:"debate-turn",providerTaskId:"task-codex",status:"completed",generation:1,errorCategory:null,completedAt:now},
    {id:"run-claude",collaborationSessionId:id,participantId:"p-claude",round:1,sequence:2,attempt:1,purpose:"debate-turn",providerTaskId:"task-claude",status:"completed",generation:1,errorCategory:null,completedAt:now}
  ];
  const output=(prefix:string,count=3,inlineMarker=false)=>[
    `[[e:embarrassed]]\n${prefix}: 작업 패널과 입력창의 간격부터 확인할게요.`,
    `[[e:pout]]\n${prefix}: 태블릿에서는 헤더와 작업 패널만 접히도록 구성하면 읽기 흐름을 유지할 수 있습니다.`,
    `[[e:wink]]\n${prefix}: 휴대폰에서는 기존 몰입 읽기 동작을 이어받고, 최하단에서 조작 영역을 다시 보여주면 좋겠습니다.`
  ].slice(0,count).map(scene=>inlineMarker?scene.replace("]]\n","]] "):scene).join("\n\n");
  const tasks:Record<string,any>={
    "task-codex":{id:"task-codex",provider:"codex",threadId:"codex-session-id",workspaceId:"workspace-long-codex-id",executionHostId:"local",status:"completed",result:output("Codex"),updatedAt:now,requestedModel:"gpt-test"},
    "task-claude":{id:"task-claude",provider:"claude",threadId:"claude-session-id",workspaceId:"workspace-long-claude-id",executionHostId:"local",status:"completed",result:output("Claude",1,true),updatedAt:now,requestedModel:"claude-test"}
  };
  const usageEvent=(provider:"codex"|"claude",threadId:string,totalTokens:number,inputTokens:number,outputTokens:number)=>({type:"unknown",content:"usage",provider,threadId,metadata:{nativeMethod:provider==="codex"?"thread/tokenUsage/updated":"claude/outputUsage/updated",outputUsage:{totalTokens,inputTokens,cachedInputTokens:provider==="claude"?1200:900,cacheWriteInputTokens:provider==="claude"?80:40,outputTokens,reasoningTokens:provider==="codex"?32:null,updatedAt:now}}});
  const detail={session,participants,runs,messages:[{id:"message-user",messageType:"user-input",contentRef:"태블릿과 휴대폰 레이아웃을 함께 검토해 주세요.",round:1,createdAt:now}],avatarStates:[],runOutputs:{"run-codex":output("Codex"),"run-claude":output("Claude",1,true)},runEvents:{"run-codex":[usageEvent("codex","codex-session-id",2048,1968,80)],"run-claude":[usageEvent("claude","claude-session-id",1536,1488,48)]},tasks,continuation:{available:true,canAddRounds:true,canAutoContinue:true,canSubmitUserInput:true,canRetryFailedTurn:false}};
  const managedEntry={id:"managed-conclusion",name:"conversation-abababab-conclusion.md",type:"file",size:managedContent.length,modifiedAt:now,sensitive:false,relativePath:managedPath};
  let conclusionDeleteBody:any=null,managedDeleteBody:any=null,managedDeleted=false,sentMessageBody:any=null;
  await page.route("**/emoticons/**",route=>route.fulfill({status:200,contentType:"image/webp",body:readFileSync("public/emoticons/Gpt-Sol/angry.webp")}));
  await page.route("**/api/**",async route=>{
    const pathname=new URL(route.request().url()).pathname,json=(value:unknown)=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(value)});
    if(pathname==="/api/collaborations")return json({collaborations:[session]});
    if(pathname==="/api/conversation-documents")return json({documents:managedDeleted?[]:[{collaborationId:id,title:session.title,status:"archived",updatedAt:now,workspaceId:"workspace",relativePath:managedPath,revision:"a".repeat(64)}]});
    if(pathname===`/api/collaborations/${id}/messages`&&route.request().method()==="POST"){sentMessageBody=route.request().postDataJSON();return json(detail);}
    if(pathname===`/api/collaborations/${id}/conclusion-markdown`&&route.request().method()==="DELETE"){const body=route.request().postDataJSON();if(body.relativePath===managedPath){managedDeleteBody=body;managedDeleted=true;}else{conclusionDeleteBody=body;delete (session.metadata as any).conclusionMarkdown;}return json({session,file:{...body,deleted:true}});}
    if(pathname===`/api/collaborations/${id}`)return json(detail);
    if(pathname==="/api/tasks")return json({tasks:[],partial:false,warnings:[]});
    if(pathname==="/api/projects")return json({projects:[{id:"project",name:"Project",enabled:true,error:null}]});
    if(pathname==="/api/hosts")return json({hosts:[{id:"local",displayName:"Local",status:"online"}]});
    if(pathname==="/api/workspaces")return json({workspaces:[{id:"workspace",projectId:"project",hostId:"local",displayName:"Workspace",canonicalPath:"/workspace"}]});
    if(pathname==="/api/workspaces/workspace/files")return json({current:{id:"root",relativePath:"."},entries:[managedEntry]});
    if(pathname==="/api/workspaces/workspace/files/resolve")return json({entry:managedEntry});
    if(pathname==="/api/workspaces/workspace/files/read")return json({relativePath:managedPath,size:managedContent.length,modifiedAt:now,sensitive:false,requiresConfirmation:false,binary:false,content:managedContent,offset:0,nextOffset:null});
    if(pathname==="/api/emotion"){
      const emotions=["embarrassed","pout","wink"],assets=emotions.map(emotion=>({emotion,file:`${emotion}.webp`})),codexAssets=emotions.map(emotion=>({emotion,file:`${emotion}.webp`}));
      return json({state:{outfit:"normal"},codexState:{outfit:"Gpt-Sol"},outfits:["normal","Gpt-Sol"],assets:{normal:assets,"Gpt-Sol":codexAssets},mode:"catch"});
    }
    if(pathname==="/api/providers/codex/models")return json({catalog:{models:[],permissions:[]}});
    if(pathname==="/api/providers/claude/permissions")return json({models:[],permissions:[],efforts:[],catalog:{models:[],stale:false}});
    if(pathname==="/api/provider-connections"||pathname==="/api/provider-connections/attempts")return json({accounts:["codex","claude","grok","antigravity","deepseek","ollama"].map(provider=>({provider,state:"connected",accountType:null,planType:null,emailMasked:null,errorCategory:null,checkedAt:new Date().toISOString()})),attempts:[]});
    if(pathname==="/api/quota")return json({claude:{},codex:{},fetchedAt:now});
    if(pathname==="/api/push")return json({preferences:{},publicKey:""});
    if(pathname.startsWith("/api/system-settings/"))return json({settings:null,candidates:{claude:[],codex:[]}});
    return json({});
  });

  await page.setViewportSize({width:640,height:900});
  await page.goto("/");
  const primaryNav=page.getByRole("navigation",{name:"주요 화면"});
  const conversationTab=primaryNav.getByRole("button",{name:"대화",exact:true});
  await conversationTab.click();
  await expect(conversationTab).toHaveClass(/active/);
  await expect(page.getByRole("navigation",{name:"엔진 필터"})).toHaveCount(0);
  await primaryNav.getByRole("button",{name:"세션",exact:true}).click();
  await expect(primaryNav.getByRole("button",{name:"세션",exact:true})).toHaveClass(/active/);
  await expect(page.getByRole("navigation",{name:"엔진 필터"})).toBeVisible();
  await expect(page.getByRole("navigation",{name:"엔진 필터"}).getByRole("button",{name:"대화",exact:true})).toHaveCount(0);
  await conversationTab.click();
  const documentButton=page.getByRole("button",{name:"결론 문서 1개"});
  await expect(documentButton).toBeVisible();
  await documentButton.click();
  const documentManager=page.locator(".conversation-document-manager");
  await expect(documentManager).toContainText("모바일 UI 공동 리뷰");
  await expect(documentManager).toContainText(managedPath);
  await expect(documentManager.getByRole("link",{name:"다운로드"})).toHaveAttribute("href",`/api/workspaces/workspace/files/download?path=${encodeURIComponent(managedPath)}`);
  await documentManager.getByRole("button",{name:"뷰어로 보기"}).click();
  await expect(page.locator(".viewer-dialog .viewer")).toContainText("관리 UI 테스트");
  await page.locator(".viewer-dialog").press("Escape");
  page.once("dialog",dialog=>dialog.accept());
  await documentManager.getByRole("button",{name:"파일 삭제"}).click();
  await expect.poll(()=>managedDeleteBody).toMatchObject({workspaceId:"workspace",relativePath:managedPath,revision:"a".repeat(64),confirmDelete:true});
  await expect(documentManager).toContainText("관리 중인 결론 문서가 없습니다.");
  await page.getByRole("button",{name:/모바일 UI 공동 리뷰/}).click();
  const timeline=page.locator(".collaboration-view");
  await expect(timeline.locator(".collaboration-avatar-notice")).toHaveCount(0);
  // Opening the board card admits its participants to the tray alongside the
  // two independent sessions: provenance classification lets participants own
  // an avatar stream while their card is on screen.
  await expect(page.locator(".agent-status-tray .avatar-panel")).toHaveCount(6);
  const markdownButton=timeline.getByRole("button",{name:"Markdown 생성"});
  await expect(primaryNav).toBeVisible();
  await expect(conversationTab).toHaveClass(/active/);
  const providerTurns=timeline.locator(".conversation-round-outputs>.participant-block");
  await expect(providerTurns).toHaveCount(2);
  await expect(providerTurns.first()).toHaveClass(/conversation-provider-turn/);
  await expect(timeline.locator(".inline-emotion-scene")).toHaveCount(4);
  await expect(providerTurns.nth(1)).toContainText("Claude: 작업 패널과 입력창의 간격부터 확인할게요.");
  await expect(providerTurns.nth(1)).not.toContainText("[[e:");
  await expect(providerTurns.nth(0).locator(".turn-token")).toContainText("1.1k");
  await expect(providerTurns.nth(1).locator(".turn-token")).toContainText("336");
  const usageSummaries=timeline.locator(".conversation-provider-usage");
  await expect(usageSummaries).toHaveCount(2);
  await expect(usageSummaries.nth(0)).toContainText("Codex");
  await expect(usageSummaries.nth(0)).toContainText("1.1k · 총 2k");
  await providerTurns.nth(0).locator(".turn-token summary").click();
  const usagePopover=providerTurns.nth(0).locator(".turn-usage-popover");
  await expect(usagePopover).toContainText("실사용");
  await expect(usagePopover).toContainText("입력 1.1k");
  await expect(usagePopover).toContainText("출력 80");
  await expect(usagePopover).toContainText("추론 32");
  await expect(usagePopover).toContainText("캐시 900 재사용 · 46% 절감");
  await expect(usagePopover).toContainText("캐시 쓰기 40");
  await expect(usagePopover).toContainText("총 처리량 2k");
  const [usagePopoverBox,detailViewportBox]=await Promise.all([usagePopover.boundingBox(),page.locator(".collaboration-detail").boundingBox()]);
  expect(usagePopoverBox!.y).toBeGreaterThanOrEqual(detailViewportBox!.y);
  expect(usagePopoverBox!.y+usagePopoverBox!.height).toBeLessThanOrEqual(detailViewportBox!.y+detailViewportBox!.height);
  const usageCardBox=await providerTurns.nth(0).boundingBox();
  expect(usagePopoverBox!.x).toBeGreaterThanOrEqual(usageCardBox!.x+7);
  expect(usagePopoverBox!.x+usagePopoverBox!.width).toBeLessThanOrEqual(usageCardBox!.x+usageCardBox!.width-7);
  await page.keyboard.press("Escape");
  await expect(usagePopover).toBeHidden();
  await providerTurns.nth(0).locator(".turn-token summary").click();
  await expect(usagePopover).toBeVisible();
  await timeline.click({position:{x:2,y:2}});
  await expect(usagePopover).toBeHidden();
  const first=timeline.locator(".inline-emotion-scene").nth(0),second=timeline.locator(".inline-emotion-scene").nth(1),third=timeline.locator(".inline-emotion-scene").nth(2);
  const [firstImage,firstText,secondImage,secondText,thirdImage,thirdText]=await Promise.all([first.locator("img").boundingBox(),first.locator("figcaption").boundingBox(),second.locator("img").boundingBox(),second.locator("figcaption").boundingBox(),third.locator("img").boundingBox(),third.locator("figcaption").boundingBox()]);
  expect(firstImage!.y).toBeLessThan(firstText!.y);
  expect(secondImage!.y).toBeLessThan(secondText!.y);
  expect(thirdImage!.y).toBeLessThan(thirdText!.y);
  await page.setViewportSize({width:800,height:1000});
  const [firstCard,secondCard,tabletAsset]=await Promise.all([providerTurns.nth(0).boundingBox(),providerTurns.nth(1).boundingBox(),first.locator("img").boundingBox()]);
  expect(Math.abs(firstCard!.y-secondCard!.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(firstCard!.height-secondCard!.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(tabletAsset!.width-142)).toBeLessThanOrEqual(1);
  const roundNode=timeline.locator(".conversation-round-node");
  await expect(timeline.locator(".conversation-round-handoff")).toHaveCount(0);
  await expect(roundNode).toHaveCount(1);
  await expect(roundNode).toBeVisible();
  const nodeBox=(await roundNode.boundingBox())!;
  expect(Math.abs(nodeBox.x+nodeBox.width/2-(firstCard!.x+firstCard!.width+secondCard!.x)/2)).toBeLessThanOrEqual(2);
  expect(nodeBox.y).toBeGreaterThanOrEqual(firstCard!.y);
  await expect(timeline.locator(".conversation-stacked-handoff")).toBeHidden();
  if(process.env.CLAUDEX_CAPTURE_README==="1"){
    await page.addStyleTag({content:".agent-status-tray{display:none!important}"});
    await page.screenshot({path:"../docs/images/conversation-tablet.png",animations:"disabled"});
  }
  await page.setViewportSize({width:360,height:800});
  await first.scrollIntoViewIfNeeded();
  const [narrowImage,narrowText]=await Promise.all([first.locator("img").boundingBox(),first.locator("figcaption").boundingBox()]);
  expect(narrowImage!.x).toBeLessThan(narrowText!.x);
  if(process.env.CLAUDEX_CAPTURE_README==="1"){
    const screenshotStyle=await page.addStyleTag({content:".conversation-control-dock{display:none!important}"});
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:"../docs/images/conversation-mobile.png",animations:"disabled"});
    await screenshotStyle.evaluate(node=>node.remove());
  }
  await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));
  const [mobileDockBox,mobileMarkdownBox]=await Promise.all([timeline.locator(".conversation-control-dock").boundingBox(),markdownButton.boundingBox()]);
  expect(mobileMarkdownBox!.y+mobileMarkdownBox!.height).toBeLessThanOrEqual(mobileDockBox!.y-8);
  await page.setViewportSize({width:600,height:860});
  await second.scrollIntoViewIfNeeded();
  const [thresholdFirstCard,thresholdSecondCard,thresholdImage,thresholdText]=await Promise.all([providerTurns.nth(0).boundingBox(),providerTurns.nth(1).boundingBox(),second.locator("img").boundingBox(),second.locator("figcaption").boundingBox()]);
  expect(Math.abs(thresholdFirstCard!.y-thresholdSecondCard!.y)).toBeLessThanOrEqual(1);
  expect(thresholdImage!.y).toBeLessThan(thresholdText!.y);
  await expect(timeline.locator(".collaboration-user")).toBeVisible();
  await expect(timeline.locator(".conversation-stacked-handoff")).toBeHidden();
  await expect(roundNode).toBeVisible();
  await page.setViewportSize({width:767,height:900});
  await markdownButton.scrollIntoViewIfNeeded();
  const [boundaryDockBox,boundaryMarkdownBox]=await Promise.all([timeline.locator(".conversation-control-dock").boundingBox(),markdownButton.boundingBox()]);
  expect(boundaryMarkdownBox!.y+boundaryMarkdownBox!.height).toBeLessThanOrEqual(boundaryDockBox!.y-8);
  await page.setViewportSize({width:800,height:1000});
  const controlDock=timeline.locator(".conversation-control-dock"),controlActions=controlDock.locator(".conversation-control-actions"),controlInput=controlDock.locator("textarea"),sendButton=controlDock.locator(".conversation-send");
  await expect(controlDock).toBeVisible();
  await expect(controlInput).toBeVisible();
  await expect(controlActions).toBeVisible();
  await expect(timeline.getByRole("button",{name:"직접 개입",exact:true})).toHaveCount(0);
  await expect(controlInput).toHaveAttribute("rows","1");
  await expect(controlInput).toHaveAttribute("placeholder","메시지를 입력하세요…");
  await expect(controlDock.getByRole("button",{name:"뒤로",exact:true})).toHaveCount(0);
  const lastControlButton=controlActions.getByRole("button").last();
  const [actionsBox,lastControlBox,stopIconBox,inputBox,sendBox]=await Promise.all([controlActions.boundingBox(),lastControlButton.boundingBox(),lastControlButton.locator("svg").boundingBox(),controlInput.boundingBox(),sendButton.boundingBox()]);
  expect(inputBox!.x-(lastControlBox!.x+lastControlBox!.width)).toBeGreaterThanOrEqual(24);
  expect(Math.abs(actionsBox!.y+actionsBox!.height/2-(inputBox!.y+inputBox!.height/2))).toBeLessThanOrEqual(1);
  expect(Math.abs(lastControlBox!.height-inputBox!.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(actionsBox!.height-inputBox!.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(stopIconBox!.y+stopIconBox!.height/2-(lastControlBox!.y+lastControlBox!.height/2))).toBeLessThanOrEqual(1);
  expect(sendBox!.x).toBeGreaterThan(inputBox!.x);
  expect(sendBox!.x).toBeGreaterThan(lastControlBox!.x+lastControlBox!.width);
  expect(Math.abs(sendBox!.width-sendBox!.height)).toBeLessThanOrEqual(1);
  expect((await controlDock.boundingBox())!.height).toBeLessThanOrEqual(86);
  await controlInput.fill("엔터 전송 확인");
  await controlInput.press("Enter");
  await expect.poll(()=>sentMessageBody).toMatchObject({prompt:"엔터 전송 확인",generation:1});
  await markdownButton.scrollIntoViewIfNeeded();
  const [dockBox,markdownBox]=await Promise.all([controlDock.boundingBox(),markdownButton.boundingBox()]);
  expect(markdownBox!.y+markdownBox!.height).toBeLessThanOrEqual(dockBox!.y-8);
  await expect(timeline.getByText("workspace-long-codex-id",{exact:true})).toBeHidden();
  await timeline.locator(".turn-details>summary").first().click();
  await expect(timeline.getByText("workspace-long-codex-id",{exact:true})).toBeVisible();
  await expect(timeline.getByRole("button",{name:"실제 세션 열기"}).first()).toBeVisible();
  (session.metadata as any).conclusionMarkdown={workspaceId:"workspace",relativePath:"docs/conclusion.md",revision:"b".repeat(64)};
  await page.reload();
  await page.getByRole("navigation",{name:"주요 화면"}).getByRole("button",{name:"대화",exact:true}).click();
  await page.getByRole("button",{name:/모바일 UI 공동 리뷰/}).click();
  const managedConclusion=page.locator(".conversation-conclusion");
  await expect(managedConclusion.getByRole("button",{name:"뷰어로 보기"})).toBeVisible();
  await expect(managedConclusion.getByRole("link",{name:"다운로드"})).toHaveAttribute("href","/api/workspaces/workspace/files/download?path=docs%2Fconclusion.md");
  page.once("dialog",dialog=>dialog.accept());
  await managedConclusion.getByRole("button",{name:"파일 삭제"}).click();
  await expect.poll(()=>conclusionDeleteBody).toMatchObject({workspaceId:"workspace",relativePath:"docs/conclusion.md",revision:"b".repeat(64),confirmDelete:true});
  await expect(managedConclusion.getByRole("button",{name:"Markdown 생성"})).toBeVisible();
  session.status="running";session.outcome=null;session.currentStep="provider-running";session.metadata.waitingForUser=false;
  Object.assign(detail.continuation,{available:false,canAddRounds:false,canAutoContinue:false,canSubmitUserInput:false,canRetryFailedTurn:false});
  await page.reload();
  await page.getByRole("navigation",{name:"주요 화면"}).getByRole("button",{name:"대화",exact:true}).click();
  await page.getByRole("button",{name:/모바일 UI 공동 리뷰/}).click();
  const runningDock=page.locator(".conversation-control-dock"),runningActions=runningDock.locator(".conversation-control-actions"),lockedInput=runningDock.locator(".conversation-locked");
  await expect(lockedInput).toBeVisible();
  const [runningActionsBox,lockedInputBox]=await Promise.all([runningActions.boundingBox(),lockedInput.boundingBox()]);
  expect(Math.abs(runningActionsBox!.y-lockedInputBox!.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(runningActionsBox!.height-lockedInputBox!.height)).toBeLessThanOrEqual(1);
  session.metadata.enabledProviders=["codex","claude","deepseek"];
  session.metadata.participantOrder=["codex","claude","deepseek"];
  participants.push({id:"p-deepseek",collaborationSessionId:id,provider:"deepseek",role:"reviewer",executionHostId:"local",workspaceId:"workspace",providerSessionId:"deepseek-session-id",permissionMode:"read",status:"completed",sessionGeneration:1,capabilitySnapshot:{newSession:true},createdAt:now,updatedAt:now,archivedAt:null});
  runs.push({id:"run-deepseek",collaborationSessionId:id,participantId:"p-deepseek",round:1,sequence:3,attempt:1,purpose:"debate-turn",providerTaskId:"task-deepseek",status:"completed",generation:1,errorCategory:null,completedAt:now});
  tasks["task-deepseek"]={id:"task-deepseek",provider:"deepseek",threadId:"deepseek-session-id",workspaceId:"workspace",executionHostId:"local",status:"completed",result:"DeepSeek third turn",updatedAt:now,requestedModel:"deepseek-test"};
  detail.runOutputs["run-deepseek"]="DeepSeek third turn";detail.runEvents["run-deepseek"]=[];
  await page.reload();await page.getByRole("navigation",{name:"주요 화면"}).getByRole("button",{name:"대화",exact:true}).click();await page.getByRole("button",{name:/모바일 UI 공동 리뷰/}).click();
  const threeTurns=page.locator(".collaboration-view .conversation-round-outputs>.participant-block");await expect(threeTurns).toHaveCount(3);await page.setViewportSize({width:800,height:1000});
  const[gridFirst,gridSecond,gridThird]=await Promise.all([0,1,2].map(index=>threeTurns.nth(index).evaluate((node:HTMLElement)=>({top:node.offsetTop,left:node.offsetLeft}))));expect(gridFirst.top).toBe(gridSecond.top);expect(gridThird.top).toBeGreaterThan(gridFirst.top);expect(gridThird.left).toBe(gridFirst.left);
  await page.setViewportSize({width:360,height:800});const[phoneFirst,phoneSecond,phoneThird]=await Promise.all([0,1,2].map(index=>threeTurns.nth(index).evaluate((node:HTMLElement)=>({top:node.offsetTop,left:node.offsetLeft}))));expect(phoneFirst.top).toBeLessThan(phoneSecond.top);expect(phoneSecond.top).toBeLessThan(phoneThird.top);expect(phoneFirst.left).toBe(phoneSecond.left);expect(phoneSecond.left).toBe(phoneThird.left);
});
