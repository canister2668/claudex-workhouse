import { expect, test } from "@playwright/test";

test("mobile task list, details, and PWA shell fit the viewport", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(10_000);
  const phoneViewport=(page.viewportSize()?.width??Number.POSITIVE_INFINITY)<=599;
  const wideViewport=(page.viewportSize()?.width??0)>=901;
  const expectDefaultHeading=async(selector:string)=>{
    const heading=page.locator(selector);
    if(phoneViewport)await expect(heading).toHaveClass(/collapsed/);
    else await expect(heading).not.toHaveClass(/collapsed/);
  };
  const expectDefaultHeadingTitle=async(selector:string,title:string)=>{
    const heading=page.locator(selector);
    await expect(phoneViewport?heading.locator(".collapsed-title"):heading.locator("h1")).toHaveText(title);
  };
  page.on("pageerror", (error) => console.error("PAGE_ERROR", error.message));
  await page.addInitScript(() => {
    localStorage.setItem("claudex-ui-locale", "ko");
    localStorage.setItem("deck-conversation-prefs",JSON.stringify({firstProvider:"claude",enabled:{codex:true,claude:true},flow:"guided",kind:"discussion",useGlobalTone:true,tone:"comfortable",maxRounds:5,unlimited:false,timeoutMinutes:30,userNickname:"챗붕",codexModel:"gpt-test",codexEffort:"low",claudeModel:"default",claudeEffort:"medium"}));
    class MockEventSource {
      listeners:Record<string,Array<(event:any)=>void>>={};onerror:((event:any)=>void)|null=null;
      constructor(public url:string){setTimeout(()=>this.emit("open",{}),20);setTimeout(()=>{for(let i=1;i<=350;i++)this.emit("agent-event",{data:JSON.stringify({type:"command_output",content:`line ${i}`,eventId:`fixture:${i}`,sequence:i,itemId:"command"})});this.emit("agent-event",{data:JSON.stringify({type:"message_delta",content:"Live mobile output",eventId:"fixture:351",sequence:351,itemId:"message"})});},40);}
      addEventListener(type:string,listener:(event:any)=>void){(this.listeners[type]??=[]).push(listener);}
      emit(type:string,event:any){for(const listener of this.listeners[type]??[])listener(event);}
      close(){}
    }
    (globalThis as any).EventSource=MockEventSource;
  });
  await page.route("https://assets.example.com/emoticons/**",async route=>route.fulfill({contentType:"image/png",body:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=","base64")}));
  await page.route("**/api/bootstrap/owner-claim/status",async route=>route.fulfill({contentType:"application/json",body:JSON.stringify({required:false})}));
  await page.route("**/api/providers/codex/models", async (route) => route.fulfill({contentType:"application/json",body:JSON.stringify({catalog:{models:[{id:"gpt-test",displayName:"GPT Test",hidden:false,isDefault:true,defaultReasoningEffort:"medium",supportedReasoningEfforts:[{reasoningEffort:"low"},{reasoningEffort:"medium"}],serviceTiers:[{id:"priority",name:"Fast",description:"test"}]}],permissions:[{id:":read-only",allowed:true},{id:":workspace",allowed:true}],fetchedAt:new Date().toISOString(),stale:false}})}));
  await page.route("**/api/providers/claude/permissions",async route=>route.fulfill({contentType:"application/json",body:JSON.stringify({permissions:[{id:":read-only",description:"읽기 전용"},{id:":workspace-write",description:"편집"}],models:[{id:"default",displayName:"기본"}],efforts:[{id:"medium",displayName:"중간"}],runtime:{managed:true}})}));
  await page.route("**/api/providers/deepseek/models",async route=>route.fulfill({contentType:"application/json",body:JSON.stringify({models:[{id:"deepseek-review",displayName:"DeepSeek Review"}],efforts:[{id:"default"},{id:"high"}]})}));
  await page.route("**/api/providers/ollama/models",async route=>route.fulfill({contentType:"application/json",body:JSON.stringify({models:[{id:"qwen-review",displayName:"Qwen Review"}],efforts:[{id:"default"},{id:"high"}]})}));
  await page.route("**/api/providers/antigravity/models",async route=>route.fulfill({contentType:"application/json",body:JSON.stringify({models:[{id:"gemini-review",displayName:"Gemini Review"}],efforts:[{id:"default"},{id:"high"}]})}));
  await page.route(/\/api\/system-settings\/models(?:\?.*)?$/,async route=>route.fulfill({contentType:"application/json",body:JSON.stringify({settings:{version:1,codex:{models:[{id:"gpt-test",displayName:"GPT Test"}]},claude:{models:[{id:"default",displayName:"기본"}]},deepseek:{models:[{id:"deepseek-review",displayName:"DeepSeek Review"}]},ollama:{models:[{id:"qwen-review",displayName:"Qwen Review"}]},antigravity:{models:[{id:"gemini-review",displayName:"Gemini Review"}]}},snapshot:true})}));
  await page.route(/\/api\/runtime-updates(?:\/check)?$/,async route=>route.fulfill({contentType:"application/json",body:JSON.stringify({runtimes:route.request().method()==="POST"?[
    {provider:"codex",name:"Codex CLI",current:"0.144.3",latest:"0.144.5",updateAvailable:true,managed:true,source:"openai-standalone",checkedAt:new Date().toISOString(),canUpdate:true,checksum:null},
    {provider:"claude",name:"Claude Code",current:"2.1.207",latest:"2.1.212",updateAvailable:true,managed:true,source:"anthropic-official",checkedAt:new Date().toISOString(),canUpdate:true,checksum:"a".repeat(64)}
  ]:[
    {provider:"codex",name:"Codex CLI",current:"0.144.3",latest:null,updateAvailable:null,managed:true,source:"openai-standalone",checkedAt:null,canUpdate:true,checksum:null},
    {provider:"claude",name:"Claude Code",current:"2.1.207",latest:null,updateAvailable:null,managed:true,source:"anthropic-official",checkedAt:null,canUpdate:true,checksum:"a".repeat(64)}
  ]})}));
  await page.route(/\/api\/application-updates(?:\/check)?$/,async route=>route.fulfill({contentType:"application/json",body:JSON.stringify({state:"up-to-date",current:{version:"1.0.0",installMethod:"docker-compose"},target:{version:"1.0.0",publishedAt:new Date().toISOString(),manifestSha256:"d".repeat(64),keyId:"release-2026"},updateAvailable:false,reason:null,blockers:[],recentAttempts:[]})}));
  await page.route("**/api/quota",async route=>route.fulfill({contentType:"application/json",body:JSON.stringify({claude:{fiveHour:{pct:41,resetsAt:"2026-07-31T05:00:00.000Z",durationMins:300},sevenDay:null},codex:{fiveHour:null,sevenDay:null}})}));
  await page.route("**/api/system-settings/locale",async route=>{const locale=route.request().method()==="PUT"?(route.request().postDataJSON() as {locale?:string})?.locale??"ko":"ko";await route.fulfill({contentType:"application/json",body:JSON.stringify({locale,saved:true,existingInstallation:true,updatedAt:new Date().toISOString()})});});
  await page.route("**/api/emotion",async route=>route.fulfill({contentType:"application/json",body:JSON.stringify({state:null,codexState:null,outfits:[],mode:"mcp"})}));
  await page.route("**/api/projects",async route=>route.fulfill({contentType:"application/json",body:JSON.stringify({projects:[{id:"risuai",name:"RisuAI",enabled:true,error:null}]})}));
  await page.route("**/api/hosts",async route=>route.fulfill({contentType:"application/json",body:JSON.stringify({hosts:[{id:"local",type:"local",displayName:"NAS",platform:"linux",architecture:"x64",workerVersion:null,status:"online",lastSeenAt:new Date().toISOString(),capabilities:{providers:["codex","claude","deepseek","ollama","antigravity","grok"],providerExecution:["codex","claude","deepseek","ollama","antigravity","grok"].map(provider=>({provider,create:true,resume:true,managedSource:true,reason:null}))}}]})}));
  const githubTokenRequests:Array<{username:string;token:string;protocol:string}>=[];let githubTokenConnected=false;
  await page.route("**/api/hosts/local/git",async route=>route.fulfill({contentType:"application/json",body:JSON.stringify({host:"nas",git:{installed:true,version:"git version 2.45.0"},githubCli:{installed:true,version:"gh version 2.74.0"},github:{connected:true,username:"octocat",name:"Canister",tokenConnected:githubTokenConnected,tokenProtocol:githubTokenConnected?"https":null},credentialHelper:"gh",ssh:{agentAvailable:false,authenticated:false,keyCount:0},commitIdentity:{name:"Canister",email:"canister@example.com"}})}));
  await page.route("**/api/hosts/local/github/token",async route=>{const body=route.request().postDataJSON() as {username:string;token:string;protocol:string};githubTokenRequests.push(body);githubTokenConnected=true;await route.fulfill({contentType:"application/json",body:JSON.stringify({github:{username:body.username,name:"Canister",protocol:body.protocol},tokenStoredBy:"gh"})});});
  await page.route(/\/api\/hosts\/local\/github\/repositories(?:\?.*)?$/,async route=>route.fulfill({contentType:"application/json",body:JSON.stringify({repositories:[]})}));
  await page.route(/\/api\/workspaces(?:\?.*)?$/,async route=>route.fulfill({contentType:"application/json",body:JSON.stringify({workspaces:[{id:"workspace-local",projectId:"risuai",hostId:"local",rootId:"root-local",displayName:"RisuAI",canonicalPath:"/srv/projects/risuai",workspaceType:"existing"}]})}));
  await page.route("**/api/location-options",async route=>route.fulfill({contentType:"application/json",body:JSON.stringify({projects:[{id:"risuai",name:"RisuAI",enabled:true,error:null}],workspaces:[{id:"workspace-local",projectId:"risuai",hostId:"local",rootId:"root-local",displayName:"RisuAI",canonicalPath:"/srv/projects/risuai",workspaceType:"existing"}]})}));
  await page.route(/\/api\/workspace-roots(?:\?.*)?$/,async route=>route.fulfill({contentType:"application/json",body:JSON.stringify({roots:[{id:"root-local",hostId:"local",displayName:"Projects",canonicalPath:"projects",allowCreate:true,allowRegister:true,allowClone:true,allowDelete:false}]})}));
  await page.route("**/api/provider-connections",async route=>route.fulfill({contentType:"application/json",body:JSON.stringify({singleUser:true,accounts:[{provider:"codex",state:"connected",accountType:"chatgpt",planType:"pro",emailMasked:"o***@example.com",errorCategory:null,checkedAt:new Date().toISOString()},{provider:"claude",state:"connected",accountType:"claude.ai",planType:"max",emailMasked:"o***@example.com",errorCategory:null,checkedAt:new Date().toISOString()}]})}));
  await page.route("**/api/system-settings/characters",async route=>route.fulfill({
    contentType:"application/json",
    body:JSON.stringify({settings:{version:1,providers:{
      codex:{nickname:"코덱냥",tonePreset:"playful-school-friend",conversationOnly:true,customTone:"",avatarOutfit:"Gpt-Codex",emotionIntensity:"natural"},
      claude:{nickname:"클냥",tonePreset:"tsundere",conversationOnly:true,customTone:"",avatarOutfit:"normal",emotionIntensity:"natural"}
    }}})
  }));
  let taskFixtures=[
    {id:"codex:external-fixture",provider:"codex",nativeId:"external-fixture",threadId:"11111111-1111-4111-8111-111111111111",projectId:"risuai",title:"External Codex task fixture",prompt:"fixture",status:"completed",createdAt:new Date().toISOString(),updatedAt:new Date(Date.now()+10000).toISOString(),result:"summary",error:null,log:"",owned:false,executionHostId:"local"},
    {id:"codex:all-delete",provider:"codex",nativeId:"all-delete",threadId:"66666666-6666-4666-8666-666666666666",projectId:"risuai",title:"All delete Codex fixture",prompt:"fixture",status:"completed",createdAt:new Date().toISOString(),updatedAt:new Date(Date.now()-3000).toISOString(),result:"done",error:null,log:"",owned:true,ownership:"claudex-workhouse",executionHostId:"local"},
    {id:"claude:all-delete",provider:"claude",nativeId:"all-delete",threadId:"77777777-7777-4777-8777-777777777777",projectId:"risuai",title:"All delete Claude fixture",prompt:"fixture",status:"failed",createdAt:new Date().toISOString(),updatedAt:new Date(Date.now()-4000).toISOString(),result:null,error:"failed",log:"",owned:true,ownership:"claudex-workhouse",executionHostId:"local"},
    {id:"claude:bulk-one",provider:"claude",nativeId:"bulk-one",threadId:"88888888-8888-4888-8888-888888888888",projectId:"risuai",title:"Claude bulk fixture one",prompt:"fixture",status:"completed",createdAt:new Date().toISOString(),updatedAt:new Date(Date.now()-5000).toISOString(),result:"done",error:null,log:"",owned:true,ownership:"claudex-workhouse",executionHostId:"local"},
    {id:"claude:bulk-two",provider:"claude",nativeId:"bulk-two",threadId:"99999999-9999-4999-8999-999999999999",projectId:"risuai",title:"Claude bulk fixture two",prompt:"fixture",status:"stopped",createdAt:new Date().toISOString(),updatedAt:new Date(Date.now()-6000).toISOString(),result:null,error:null,log:"",owned:true,ownership:"claudex-workhouse",executionHostId:"local"},
    {id:"claude:active-assist",provider:"claude",nativeId:"active-assist",threadId:"bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb",projectId:"risuai",title:"Claude active assist fixture",prompt:"Review current Claude progress",status:"running",createdAt:new Date().toISOString(),updatedAt:new Date(Date.now()-6500).toISOString(),result:null,error:null,log:"",owned:true,ownership:"claudex-workhouse",executionHostId:"local",workspaceId:"workspace-local",metadata:{contextUsage:{usedTokens:64000,windowTokens:200000,percent:32,updatedAt:new Date().toISOString()}}},
    {id:"codex:assist-fixture",provider:"codex",nativeId:"assist-fixture",threadId:"aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",projectId:"risuai",title:"Codex assist fixture",prompt:"review me",status:"completed",createdAt:new Date().toISOString(),updatedAt:new Date(Date.now()-7000).toISOString(),result:"Codex final result",error:null,log:"",owned:true,ownership:"claudex-workhouse",executionHostId:"local",workspaceId:"workspace-local"},
    {id:"codex:review-linked",provider:"codex",nativeId:"review-linked",threadId:"16161616-1616-4616-8616-161616161616",projectId:"risuai",title:"Long review provider session",prompt:"review",status:"completed",createdAt:new Date().toISOString(),updatedAt:new Date(Date.now()-7500).toISOString(),result:"review result",error:null,log:"",owned:true,ownership:"claudex-workhouse",executionHostId:"local",workspaceId:"workspace-local",metadata:{collaborationSessionId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",collaborationParticipantId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}},
    {id:"codex:conversation-linked",provider:"codex",nativeId:"conversation-linked",threadId:"12121212-1212-4212-8212-121212121212",projectId:"risuai",title:"Codex linked conversation fixture",prompt:"linked",status:"completed",createdAt:new Date().toISOString(),updatedAt:new Date(Date.now()-8000).toISOString(),result:"linked",error:null,log:"",owned:true,ownership:"claudex-workhouse",executionHostId:"local",workspaceId:"workspace-local",metadata:{collaborationSessionId:"abababab-abab-4bab-8bab-abababababab",collaborationParticipantId:"13131313-1313-4313-8313-131313131313"}},
    {id:"claude:conversation-linked",provider:"claude",nativeId:"conversation-linked",threadId:"14141414-1414-4414-8414-141414141414",projectId:"risuai",title:"Claude linked conversation fixture",prompt:"linked",status:"completed",createdAt:new Date().toISOString(),updatedAt:new Date(Date.now()-9000).toISOString(),result:"linked",error:null,log:"",owned:true,ownership:"claudex-workhouse",executionHostId:"local",workspaceId:"workspace-local",metadata:{collaborationSessionId:"abababab-abab-4bab-8bab-abababababab",collaborationParticipantId:"15151515-1515-4515-8515-151515151515"}},
    {id:"claude:native-conversation-linked",provider:"claude",nativeId:"native-conversation-linked",threadId:"14141414-1414-4414-8414-141414141414",projectId:"risuai",title:"Claude linked conversation fixture",prompt:"native mirror without collaboration metadata",status:"completed",createdAt:new Date().toISOString(),updatedAt:new Date(Date.now()-8500).toISOString(),result:"linked native",error:null,log:"",owned:false,ownership:"external",executionHostId:"local",workspaceId:"workspace-local",metadata:{}}
  ];
  await page.route(/\/api\/tasks(?:\?.*)?$/,async route=>{const provider=new URL(route.request().url()).searchParams.get("provider");await route.fulfill({contentType:"application/json",body:JSON.stringify({tasks:provider?taskFixtures.filter(task=>task.provider===provider):taskFixtures})});});
  const boardCard={id:"20202020-2020-4020-8020-202020202020",projectId:"risuai",title:"협업 게시판 E2E",description:"재시작 후에도 유지되는 작업 카드",boardStatus:"in_progress",priority:"high",boardVisible:true,workspaceId:"workspace-local",targetBranch:"feature/collaboration-board",roles:{implementer:{provider:"codex",permissionProfile:"workspace-write"},reviewer:{provider:"claude",permissionProfile:"read-only"}},lastActivityAt:new Date().toISOString(),completedAt:null,archivedAt:null,revision:1,sessions:[{id:"claude:active-assist",kind:"task",title:"Claude active assist fixture",provider:"claude",role:"implementer",status:"running",executionHostId:"local",permissionProfile:"workspace-write",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),result:null,error:null}],activeSessionCount:1};
  await page.route(/\/api\/collaboration-board\/cards(?:\?.*)?$/,async route=>route.fulfill({contentType:"application/json",body:JSON.stringify({cards:[boardCard]})}));
  await page.route(`**/api/collaboration-board/cards/${boardCard.id}`,async route=>route.fulfill({contentType:"application/json",body:JSON.stringify({card:boardCard})}));
  await page.route(`**/api/collaboration-board/cards/${boardCard.id}/events`,async route=>route.fulfill({contentType:"application/json",body:JSON.stringify({events:[{id:"30303030-3030-4030-8030-303030303030",chainId:boardCard.id,eventType:"card_created",createdAt:new Date().toISOString(),payload:{}}]})}));
  const taskDeleteRequests:string[]=[];
  await page.route(/\/api\/tasks\/(codex|claude)\/[^/]+\/session$/,async route=>{const parts=new URL(route.request().url()).pathname.split("/"),provider=parts[3],taskId=decodeURIComponent(parts[4]);taskDeleteRequests.push(`${provider}:${taskId}`);const target=taskFixtures.find(task=>task.provider===provider&&task.id===taskId);if(target)taskFixtures=taskFixtures.filter(task=>!(task.provider===provider&&task.threadId===target.threadId));await route.fulfill({contentType:"application/json",body:JSON.stringify({deleted:true})});});
  const collaboration={id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",projectId:"risuai",title:"Claude와 Codex 모바일 협업",mode:"review",status:"partial",outcome:"reviewer-failed",primaryParticipantId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",maxCalls:3,currentCallCount:2,currentStep:"reviewer",timeoutAt:new Date(Date.now()+60000).toISOString(),controllerGeneration:1,workChainId:null,sourceTaskId:null,createdAt:new Date().toISOString(),updatedAt:new Date(Date.now()-1000).toISOString(),completedAt:new Date().toISOString(),cancelledAt:null,archivedAt:null,metadata:{topLevel:true}};
  const conversation={id:"abababab-abab-4bab-8bab-abababababab",projectId:"risuai",title:"별도 대화 탭 fixture",mode:"debate",status:"completed",outcome:"turn-limit",primaryParticipantId:null,maxCalls:4,currentCallCount:4,currentStep:"done",timeoutAt:new Date(Date.now()+60000).toISOString(),controllerGeneration:1,workChainId:null,sourceTaskId:null,createdAt:new Date(Date.now()-3000).toISOString(),updatedAt:new Date(Date.now()-2000).toISOString(),completedAt:new Date(Date.now()-2000).toISOString(),cancelledAt:null,archivedAt:null,maxTurnsPerParticipant:2,metadata:{topLevel:true,conversationFlow:"guided",conversationKind:"casual",currentRound:2,enabledProviders:["claude","codex"]}};
  const conversationTwo={...conversation,id:"cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd",title:"두 번째 대화 삭제 fixture",status:"failed",outcome:"provider-failed",updatedAt:new Date(Date.now()-2500).toISOString()};
  const participants=[{id:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",collaborationSessionId:collaboration.id,provider:"codex",role:"primary",executionHostId:"local",workspaceId:"workspace-with-a-very-long-mobile-name",providerSessionId:"11111111-1111-4111-8111-111111111111",sourceTaskId:null,permissionMode:"write",status:"completed",sessionGeneration:1,capabilitySnapshot:{},createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),archivedAt:null},{id:"cccccccc-cccc-4ccc-8ccc-cccccccccccc",collaborationSessionId:collaboration.id,provider:"claude",role:"reviewer",executionHostId:"local",workspaceId:"workspace-with-a-very-long-mobile-name",providerSessionId:"22222222-2222-4222-8222-222222222222",sourceTaskId:null,permissionMode:"read",status:"failed",sessionGeneration:1,capabilitySnapshot:{},createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),archivedAt:null}];
  const runs=[{id:"dddddddd-dddd-4ddd-8ddd-dddddddddddd",collaborationSessionId:collaboration.id,participantId:participants[0].id,round:1,sequence:1,attempt:1,purpose:"primary-initial",providerTaskId:"codex:collaboration-fixture",status:"completed",generation:1,errorCategory:null},{id:"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",collaborationSessionId:collaboration.id,participantId:participants[1].id,round:1,sequence:2,attempt:1,purpose:"review",providerTaskId:"claude:collaboration-fixture",status:"failed",generation:1,errorCategory:"provider-failed"}];
  let collaborationFixtures=[collaboration,conversation,conversationTwo],conversationDeleteRequests:string[]=[];
  await page.route(/\/api\/collaborations(?:\?.*)?$/,async route=>route.fulfill({contentType:"application/json",body:JSON.stringify({collaborations:collaborationFixtures})}));
  await page.route(/\/api\/collaborations\/[0-9a-f-]+$/,async route=>{if(route.request().method()!=="DELETE")return route.fallback();expect(route.request().postDataJSON()).toMatchObject({confirmDelete:true,deleteLinkedProviderSessions:true});const id=route.request().url().split("/").pop()!;conversationDeleteRequests.push(id);collaborationFixtures=collaborationFixtures.filter(item=>item.id!==id);await route.fulfill({contentType:"application/json",body:JSON.stringify({deleted:true,providerSessionsDeleted:true,providerSessionCount:2,filesDeleted:false})});});
  await page.route(`**/api/collaborations/${collaboration.id}`,async route=>route.fulfill({contentType:"application/json",body:JSON.stringify({session:collaboration,participants,runs,messages:[{messageType:"user-input",contentRef:"인증 구조를 함께 검토해 줘."}],avatarStates:[],runOutputs:{[runs[0].id]:"Primary의 실제 긴 결과 본문입니다."},runEvents:{[runs[0].id]:[{type:"message_completed",content:"공개 중간 설명",eventId:"commentary",itemId:"commentary",metadata:{role:"agent",phase:"commentary"}},{type:"tool_progress",content:"비공개 reasoning",eventId:"thinking",itemId:"thinking",metadata:{deltaType:"thinking_delta"}},{type:"tool_completed",content:"검사 결과",eventId:"tool",itemId:"tool",toolName:"inspect"},{type:"message_completed",content:"Primary의 실제 긴 결과 본문입니다.",eventId:"final",itemId:"final",metadata:{role:"agent",phase:"final_answer"}}]},tasks:{"codex:collaboration-fixture":{id:"codex:collaboration-fixture",provider:"codex",threadId:"11111111-1111-4111-8111-111111111111",projectId:"risuai",workspaceId:"workspace-local",executionHostId:"local",title:"Codex mobile fixture",prompt:"fixture",status:"completed",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),result:"Primary의 실제 긴 결과 본문입니다.",error:null,owned:true,ownership:"claudex-workhouse"},"claude:collaboration-fixture":{id:"claude:collaboration-fixture",provider:"claude",threadId:"22222222-2222-4222-8222-222222222222",projectId:"risuai",workspaceId:"workspace-local",executionHostId:"local",title:"Claude collaboration fixture",prompt:"fixture",status:"failed",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),result:null,error:"Reviewer failed",owned:true,ownership:"claudex-workhouse"}}})}));
  let codexSessions=[
    {threadId:"11111111-1111-4111-8111-111111111111",taskId:"codex:deck:fixture",projectId:"risuai",title:"Codex mobile fixture",preview:"Safe preview",source:"claudex-workhouse",nativeSource:"vscode",ownership:"claudex-workhouse",status:"running",archived:false,requestedModel:"gpt-test",requestedReasoningEffort:"medium",requestedServiceTier:null,effectiveModel:null,canMutate:true,canStop:false,executionHostId:"local",workspaceId:"workspace-local",updatedAt:new Date().toISOString()},
    {threadId:"44444444-4444-4444-8444-444444444444",taskId:"codex:deck:bulk-one",projectId:"risuai",title:"Bulk delete fixture one",preview:"Delete one",source:"claudex-workhouse",nativeSource:"vscode",ownership:"claudex-workhouse",status:"completed",archived:false,requestedModel:"gpt-test",requestedReasoningEffort:"medium",requestedServiceTier:null,effectiveModel:null,canMutate:true,canStop:false,updatedAt:new Date(Date.now()-1000).toISOString()},
    {threadId:"55555555-5555-4555-8555-555555555555",taskId:"codex:deck:bulk-two",projectId:"risuai",title:"Bulk delete fixture two",preview:"Delete two",source:"claudex-workhouse",nativeSource:"vscode",ownership:"claudex-workhouse",status:"failed",archived:false,requestedModel:"gpt-test",requestedReasoningEffort:"medium",requestedServiceTier:null,effectiveModel:null,canMutate:true,canStop:false,updatedAt:new Date(Date.now()-2000).toISOString()},
    {threadId:"aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",taskId:"codex:assist-fixture",projectId:"risuai",title:"Codex assist fixture",preview:"Review target",source:"claudex-workhouse",nativeSource:"vscode",ownership:"claudex-workhouse",status:"completed",archived:false,requestedModel:"gpt-test",requestedReasoningEffort:"medium",requestedServiceTier:null,effectiveModel:null,canMutate:true,canStop:false,executionHostId:"local",workspaceId:"workspace-local",updatedAt:new Date(Date.now()-7000).toISOString()},
    {threadId:"12121212-1212-4212-8212-121212121212",taskId:"codex:conversation-linked",projectId:"risuai",title:"Codex linked conversation fixture",preview:"Linked",source:"claudex-workhouse",nativeSource:"vscode",ownership:"claudex-workhouse",status:"completed",archived:false,requestedModel:"gpt-test",requestedReasoningEffort:"medium",requestedServiceTier:null,effectiveModel:null,canMutate:true,canStop:false,executionHostId:"local",workspaceId:"workspace-local",updatedAt:new Date(Date.now()-8000).toISOString()}
  ];
  const bulkDeleteRequests:string[]=[];
  await page.route(/\/api\/codex\/threads\?.*/, async (route) => route.fulfill({contentType:"application/json",body:JSON.stringify({sessions:codexSessions,nextCursor:null,stale:false,syncedAt:new Date().toISOString(),capabilities:{search:true,turns:true,settings:true,delete:true}})}));
  await page.route(/\/api\/codex\/threads\/[^/]+$/,async route=>{if(route.request().method()!=="DELETE")return route.fallback();const threadId=route.request().url().split("/").pop()!;bulkDeleteRequests.push(threadId);codexSessions=codexSessions.filter(item=>item.threadId!==threadId);await route.fulfill({contentType:"application/json",body:JSON.stringify({deleted:true})});});
  await page.route(/\/api\/codex\/threads\/[^/]+\/turns.*/, async (route) => route.fulfill({contentType:"application/json",body:JSON.stringify({turns:[{id:"33333333-3333-4333-8333-333333333333",status:"completed",items:[{type:"agentMessage",text:"Newest turn"}]},{id:"22222222-2222-4222-8222-222222222222",status:"completed",items:[{type:"userMessage",content:[{type:"text",text:"Future event remains readable."}]},{type:"agentMessage",text:'<img src=x onerror="globalThis.mcpExecuted=true">'},{type:"mcpToolCall",server:"emotion",tool:"set_emotion",status:"completed"}]}],nextCursor:null})}));
  await page.route(/\/api\/codex\/threads\/[^/]+\/messages$/,async route=>route.fulfill({contentType:"application/json",body:JSON.stringify({task:{id:"codex:deck:followup",provider:"codex",threadId:"11111111-1111-4111-8111-111111111111",projectId:"risuai",title:"Codex mobile fixture",prompt:"continue",status:"running",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),result:null,error:null,log:"",owned:true,ownership:"claudex-workhouse",source:"claudex-workhouse"}})}));
  await page.route("**/api/tasks/*/*/events", async (route) => {
    const requestUrl=decodeURIComponent(route.request().url());
    const status=requestUrl.includes("codex:deck:fixture")||requestUrl.includes("claude:active-assist")?"running":"completed";
    await route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ taskId:"mock", status, events:[
      { type:"unknown", content:"Future event remains readable." },
      { type:"mcp_tool_call", content:'<img src=x onerror="globalThis.mcpExecuted=true">', serverName:"emotion", toolName:"set_emotion" },
      { type:"mcp_tool_result", content:"Mock MCP result" },
      ...(requestUrl.includes("codex:assist-fixture")?[{type:"file_change_completed",content:"+ mobile editor fixture",metadata:{path:"src/App.ts",pathBase:"task-cwd",additions:1,deletions:0}}]:[])
    ] })
  })});
  let editorContent="export const mobile = false;\n",editorRevision="revision-1";
  const editorEntry={id:"file-src-app",name:"App.ts",type:"file",size:editorContent.length,modifiedAt:new Date().toISOString(),sensitive:false,relativePath:"src/App.ts"};
  await page.route(/\/api\/workspaces\/workspace-local\/files(?:\?.*)?$/,async route=>route.fulfill({contentType:"application/json",body:JSON.stringify({current:{id:"root",name:"RisuAI",type:"directory",relativePath:"."},entries:[editorEntry]})}));
  await page.route("**/api/workspaces/workspace-local/files/resolve",async route=>route.fulfill({contentType:"application/json",body:JSON.stringify({entry:editorEntry})}));
  await page.route("**/api/workspaces/workspace-local/files/read",async route=>route.fulfill({contentType:"application/json",body:JSON.stringify({relativePath:"src/App.ts",size:editorContent.length,modifiedAt:new Date().toISOString(),sensitive:false,requiresConfirmation:false,binary:false,content:editorContent,offset:0,nextOffset:null})}));
  await page.route("**/api/workspaces/workspace-local/files/edit/read",async route=>route.fulfill({contentType:"application/json",body:JSON.stringify({fileId:editorEntry.id,relativePath:"src/App.ts",content:editorContent,revision:editorRevision,lineEnding:"lf",hasUtf8Bom:false,endsWithNewline:true,modifiedAt:new Date().toISOString(),byteLength:editorContent.length})}));
  const editorWrites:Array<{content:string;expectedRevision:string}> = [];
  await page.route("**/api/workspaces/workspace-local/files/write",async route=>{const body=route.request().postDataJSON() as {content:string;expectedRevision:string};editorWrites.push(body);editorContent=body.content;editorRevision="revision-2";await route.fulfill({contentType:"application/json",body:JSON.stringify({relativePath:"src/App.ts",revision:editorRevision,previousRevision:body.expectedRevision,byteLength:editorContent.length,modifiedAt:new Date().toISOString(),status:{changedFiles:["src/App.ts"]}})});});
  const queuedMessages=new Map<string,Array<any>>();
  await page.route("**/api/uploads",async route=>route.fulfill({contentType:"application/json",body:JSON.stringify({files:[{path:"/tmp/clipboard-test.png",name:"clipboard-test.png",size:4}]})}));
  await page.route(/\/api\/tasks\/(codex|claude)\/[^/]+\/message-queue(?:\/[^/]+(?:\/(?:send-now|retry|resolve-sent))?)?$/,async route=>{
    const parts=new URL(route.request().url()).pathname.split("/"),provider=parts[3],taskId=decodeURIComponent(parts[4]),queueId=parts[6],action=parts[7],key=`${provider}:${taskId}`,items=queuedMessages.get(key)??[];
    if(route.request().method()==="GET")return route.fulfill({contentType:"application/json",body:JSON.stringify({items,activeTask:null})});
    if(route.request().method()==="DELETE"){queuedMessages.set(key,items.filter(item=>item.id!==queueId));return route.fulfill({contentType:"application/json",body:JSON.stringify({deleted:true,id:queueId})});}
    if(route.request().method()==="PATCH"){const body=route.request().postDataJSON(),updated=items.map(item=>item.id===queueId?{...item,prompt:body.prompt,updatedAt:new Date().toISOString()}:item);queuedMessages.set(key,updated);return route.fulfill({contentType:"application/json",body:JSON.stringify({item:updated.find(item=>item.id===queueId)})});}
    if(action==="send-now"){queuedMessages.set(key,items.filter(item=>item.id!==queueId));return route.fulfill({contentType:"application/json",body:JSON.stringify({queued:false,task:null})});}
    if(action==="retry"){const updated=items.map(item=>item.id===queueId?{...item,status:"queued",error:null}:item);queuedMessages.set(key,updated);return route.fulfill({contentType:"application/json",body:JSON.stringify({item:updated.find(item=>item.id===queueId)})});}
    if(action==="resolve-sent"){queuedMessages.set(key,items.filter(item=>item.id!==queueId));return route.fulfill({contentType:"application/json",body:JSON.stringify({item:{...items.find(item=>item.id===queueId),status:"sent"}})});}
    const body=route.request().postDataJSON(),item={id:crypto.randomUUID(),provider,threadId:"fixture-thread",sourceTaskId:taskId,prompt:body.prompt,status:"queued",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),dispatchedTaskId:null,error:null};queuedMessages.set(key,[...items,item]);return route.fulfill({contentType:"application/json",body:JSON.stringify({item})});
  });
  const expectSingleDetailScroll=async()=>{
    await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
    const layout=await page.evaluate(()=>{
      const documentScroller=document.scrollingElement!,conversation=document.querySelector<HTMLElement>(".conversation")!,composer=document.querySelector<HTMLElement>(".composer")!;
      const composerRect=composer.getBoundingClientRect();
      return{
        documentOverflow:documentScroller.scrollHeight-documentScroller.clientHeight,
        documentScrollTop:documentScroller.scrollTop,
        conversationOverflow:getComputedStyle(conversation).overflowY,
        composerPosition:getComputedStyle(composer).position,
        composerBottom:composerRect.bottom,
        viewportBottom:window.innerHeight,
      };
    });
    expect(layout.documentOverflow).toBeLessThanOrEqual(1);
    expect(layout.documentScrollTop).toBe(0);
    expect(layout.conversationOverflow).toBe("auto");
    expect(layout.composerPosition).not.toBe("fixed");
    expect(layout.composerBottom).toBeLessThanOrEqual(layout.viewportBottom+1);
  };
  await page.goto("/",{waitUntil:"domcontentloaded"});
  const brand=page.getByRole("banner").locator(".brand");
  await expect(brand).toHaveAttribute("aria-label","Claudex Workhouse");
  await expect(brand.locator("small")).toHaveText("GPT·Claude 노역 관리소");
  await expect(page.getByRole("button", { name: "작업 생성",exact:true })).toBeVisible();
  await expect(page.getByRole("heading",{name:"실행 중인 작업"})).toBeVisible();
  await expect(page.locator(".liveness-task-card").first()).toBeVisible();
  await expect(page.locator(".overview-worker-list")).toContainText("NAS");
  await expect(page.getByRole("heading",{name:"협업 게시판",exact:true})).toBeVisible();
  await expect(page.getByText("협업 게시판 E2E",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"게시판 전체 보기",exact:true}).first().click();
  await expect(page.getByRole("heading",{name:"협업 게시판",exact:true})).toBeVisible();
  await expect(page.getByText("협업 게시판 E2E",{exact:true})).toBeVisible();
  await expect(page.locator(".board-page")).toHaveJSProperty("scrollWidth",await page.locator(".board-page").evaluate(node=>node.clientWidth));
  await page.screenshot({path:`test-results/${testInfo.project.name}-collaboration-board.png`,fullPage:true});
  await page.getByRole("button",{name:"새 작업 카드",exact:true}).first().click();
  const boardEditor=page.getByRole("form",{name:"작업 카드 만들기"});
  await expect(boardEditor.getByLabel("구현자 Provider",{exact:true})).toHaveValue("codex");
  await expect(boardEditor.getByLabel("구현자 모델",{exact:true})).toHaveValue("gpt-test");
  await expect(boardEditor.getByLabel("검토자 Provider",{exact:true})).toHaveValue("");
  await expect(boardEditor.getByLabel("보조 검토자 Provider",{exact:true})).toHaveValue("");
  await expect(boardEditor.getByText("provider.codex",{exact:true})).toHaveCount(0);
  await page.screenshot({path:`test-results/${testInfo.project.name}-collaboration-board-editor.png`,fullPage:true});
  await boardEditor.getByRole("button",{name:"취소",exact:true}).click();
  await page.getByRole("navigation",{name:"주요 화면"}).getByRole("button",{name:"홈",exact:true}).click();
  await page.screenshot({path:`test-results/${testInfo.project.name}-overview.png`,fullPage:true});
  await page.getByRole("navigation",{name:"주요 화면"}).getByRole("button",{name:"세션",exact:true}).click();
  await expect.poll(async () => page.locator(".task-card").count()).toBeGreaterThan(0);
  const floatingAvatarSides=page.locator(".agent-status-tray.flow .tray-item.auto .emotion-side");
  for(let index=0;index<await floatingAvatarSides.count();index++){
    const floatingAvatarSide=floatingAvatarSides.nth(index),floatingAvatar=floatingAvatarSide.locator(".avatar-panel");
    if((await floatingAvatarSide.getAttribute("class"))?.includes("collapsed"))continue;
    await expect(floatingAvatar).toBeVisible();
    await expect(floatingAvatar).toHaveCSS("pointer-events","auto");
    await floatingAvatar.click();
    await expect(floatingAvatarSide).toHaveClass(/collapsed/);
  }
  await expect(page.locator(".task-list > .task-card").first().locator("strong").first()).toHaveText("External Codex task fixture");
  const engineTabs=page.getByRole("navigation",{name:"엔진 필터"});const primaryNav=page.getByRole("navigation",{name:"주요 화면"});await expect(engineTabs.getByRole("button",{name:"대화",exact:true})).toHaveCount(0);await expect(page.getByRole("button",{name:/linked conversation fixture/})).toHaveCount(0);await expect(page.getByRole("button",{name:/Claude와 Codex 모바일 협업/})).toHaveCount(0);await engineTabs.getByRole("button",{name:"협업 작업",exact:true}).click();await expect(page.getByRole("button",{name:/Claude와 Codex 모바일 협업/})).toBeVisible();await expect(page.getByText("Long review provider session",{exact:true})).toHaveCount(0);await engineTabs.getByRole("button",{name:"연결 세션",exact:true}).click();await expect(page.getByRole("button",{name:/Codex linked conversation fixture/})).toBeVisible();await expect(page.getByRole("button",{name:/Claude linked conversation fixture/})).toBeVisible();await expect(page.getByText("Long review provider session",{exact:true})).toHaveCount(0);await expect(page.locator(".task-list > .task-card")).toHaveCount(2);await engineTabs.getByRole("button",{name:"Codex",exact:true}).click();await expect(page.getByText("Codex linked conversation fixture",{exact:true})).toHaveCount(0);await engineTabs.getByRole("button",{name:"Claude",exact:true}).click();await expect(page.getByText("Claude linked conversation fixture",{exact:true})).toHaveCount(0);await primaryNav.getByRole("button",{name:"대화",exact:true}).click();
  await expect(engineTabs).toHaveCount(0);await expect(page.getByRole("button",{name:/별도 대화 탭 fixture/})).toBeVisible();await expect(page.getByRole("button",{name:/두 번째 대화 삭제 fixture/})).toBeVisible();await expect(page.getByRole("button",{name:/Claude와 Codex 모바일 협업/})).toHaveCount(0);await expect(page.locator(".task-list > .task-card:not(.collaboration-card)")).toHaveCount(0);
  await page.getByRole("button",{name:"작업 생성"}).click();const conversationCreate=page.getByRole("dialog",{name:"새 대화"});await expect(conversationCreate.getByRole("button",{name:"대화",exact:true})).toHaveClass(/active/);const toneRow=(provider:string)=>conversationCreate.locator(`.cwho[data-provider="${provider}"] .cpick-field`);const toneSheet=()=>page.getByRole("dialog",{name:"Codex 말투"});await expect(toneRow("codex")).toContainText("장난기 많은 학원물 친구");await expect(toneRow("codex")).toContainText("글로벌");await expect(toneRow("claude")).toContainText("츤데레");await expect(toneRow("claude")).toContainText("글로벌");await toneRow("codex").click();await expect(toneSheet().getByRole("button",{name:/글로벌 설정 그대로/})).toHaveAttribute("aria-pressed","true");await toneSheet().getByRole("button",{name:"츤데레",exact:true}).click();await toneSheet().getByRole("button",{name:"완료",exact:true}).click();/* One participant overriding its tone must not move the others off the global preset. */await expect(toneRow("codex")).toContainText("츤데레");await expect(toneRow("codex")).toContainText("이 세션만");await expect(toneRow("claude")).toContainText("츤데레");await expect(toneRow("claude")).toContainText("글로벌");await toneRow("codex").click();await toneSheet().getByRole("button",{name:/글로벌 설정 그대로/}).click();await toneSheet().getByRole("button",{name:"완료",exact:true}).click();await expect(toneRow("codex")).toContainText("장난기 많은 학원물 친구");await expect(toneRow("codex")).toContainText("글로벌");await conversationCreate.getByRole("button",{name:"닫기"}).click();
  await page.getByRole("button",{name:"여러 개 삭제"}).click();await page.getByRole("button",{name:/별도 대화 탭 fixture/}).click();await page.getByRole("button",{name:/두 번째 대화 삭제 fixture/}).click();await page.getByRole("button",{name:"삭제",exact:true}).click();const conversationDeleteDialog=page.getByRole("alertdialog",{name:/대화 세션 2개 영구 삭제/});await expect(conversationDeleteDialog).toContainText("연결된 Codex·Claude 세션");await conversationDeleteDialog.getByRole("checkbox").check();await conversationDeleteDialog.getByRole("button",{name:"2개 영구 삭제"}).click();await expect.poll(()=>conversationDeleteRequests.length).toBe(2);
  await primaryNav.getByRole("button",{name:"세션",exact:true}).click();
  await engineTabs.getByRole("button",{name:"협업 작업",exact:true}).click();
  await page.getByRole("button",{name:/Claude와 Codex 모바일 협업/}).click();
  await expect(page.getByRole("region",{name:"협업 타임라인"})).toBeVisible();
  await expect(page.locator(".participant-block")).toHaveCount(2);
  await expect(page.locator(".participant-block .turn-token")).toHaveCount(1);
  await expect(page.locator(".participant-block .turn-token").first()).toContainText("답변 약");
  await expect(page.locator(".participant-block").first()).toContainText("Primary의 실제 긴 결과 본문입니다.");
  await page.locator(".participant-block").first().getByRole("button",{name:/진행 과정/}).click();
  await expect(page.locator(".participant-block").first()).toContainText("공개 중간 설명");
  await expect(page.locator(".participant-block").first()).toContainText("검사 결과");
  await expect(page.getByText("비공개 reasoning")).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth)).toBeLessThanOrEqual(0);
  await page.locator(".participant-block").first().getByRole("button",{name:"실제 세션 열기"}).click();
  await expectDefaultHeading(".codex-detail .task-heading");
  await expectDefaultHeadingTitle(".codex-detail .task-heading","Codex mobile fixture");
  await primaryNav.getByRole("button",{name:"세션",exact:true}).click();
  await engineTabs.getByRole("button",{name:"전체",exact:true}).click();
  await page.getByRole("button",{name:"Codex 상태 및 최근 세션"}).click();
  const avatarSessions=page.getByRole("dialog",{name:"Codex 아바타 및 세션"});await avatarSessions.getByRole("button",{name:/External Codex task fixture/}).click();
  await expectDefaultHeading(".codex-detail .task-heading");
  await expectDefaultHeadingTitle(".codex-detail .task-heading","External Codex task fixture");
  await primaryNav.getByRole("button",{name:"세션",exact:true}).click();
  await engineTabs.getByRole("button",{name:"전체",exact:true}).click();
  await page.getByRole("button",{name:"여러 개 삭제"}).click();
  const allDeleteCodex=page.locator(".task-list > .task-card").filter({hasText:"All delete Codex fixture"});
  const allDeleteClaude=page.locator(".task-list > .task-card").filter({hasText:"All delete Claude fixture"});
  await allDeleteCodex.click();await expect(allDeleteCodex).toHaveAttribute("aria-pressed","true");
  await allDeleteClaude.click({position:{x:60,y:30}});await expect(allDeleteClaude).toHaveAttribute("aria-pressed","true");
  await page.getByRole("button",{name:"삭제",exact:true}).click();
  const allDeleteDialog=page.getByRole("alertdialog",{name:/전체 탭 세션 2개 영구 삭제/});await allDeleteDialog.getByRole("checkbox").check();await allDeleteDialog.getByRole("button",{name:"2개 영구 삭제"}).click();
  await expect.poll(()=>taskDeleteRequests.length).toBe(2);
  await page.getByRole("navigation",{name:"엔진 필터"}).getByRole("button",{name:"Claude",exact:true}).click();
  await expect(page.getByRole("button",{name:/Claude bulk fixture one/})).toBeVisible();
  await expect(page.locator(".task-card.active-task").filter({hasText:"Claude active assist fixture"})).toContainText("연결 정상");
  await page.getByRole("button",{name:"작업 생성"}).click();const claudeCreate=page.getByRole("dialog",{name:"새 작업"});await expect(claudeCreate.getByRole("button",{name:"단독 작업",exact:true})).toHaveClass(/active/);await expect(claudeCreate.getByRole("group",{name:"엔진",exact:true}).getByRole("button",{name:"Claude",exact:true})).toHaveClass(/active/);await expect(claudeCreate.getByRole("button",{name:/Opus|Fable|Sonnet|Haiku|기본/}).first()).toBeVisible();await claudeCreate.getByLabel("요청",{exact:true}).evaluate((target)=>{const transfer=new DataTransfer();transfer.items.add(new File([new Uint8Array([137,80,78,71])],"image.png",{type:"image/png"}));target.dispatchEvent(new ClipboardEvent("paste",{bubbles:true,cancelable:true,clipboardData:transfer}));});await expect(claudeCreate.getByText("clipboard-test.png",{exact:true})).toBeVisible();await claudeCreate.getByRole("button",{name:"닫기"}).click();
  await page.getByRole("button",{name:"여러 개 삭제"}).click();
  await page.getByRole("button",{name:/Claude bulk fixture one/}).click();await page.getByRole("button",{name:/Claude bulk fixture two/}).click();await page.getByRole("button",{name:"삭제",exact:true}).click();
  const claudeDeleteDialog=page.getByRole("alertdialog",{name:/Claude 세션 2개 영구 삭제/});await claudeDeleteDialog.getByRole("checkbox").check();await claudeDeleteDialog.getByRole("button",{name:"2개 영구 삭제"}).click();
  await expect.poll(()=>taskDeleteRequests.length).toBe(4);
  await page.getByRole("button",{name:/Claude active assist fixture/}).click();
  const workStatusBadge=page.locator(".work-status-badge");
  await expect(workStatusBadge).toBeVisible();
  await expect(workStatusBadge).toContainText("5시간 할당량 41%");
  if(await page.locator(".work-status-panel").isVisible())await workStatusBadge.click();
  await expect(page.locator(".work-status-panel")).toHaveCount(0);
  await workStatusBadge.click();
  await expect(page.locator(".work-status-panel")).toBeVisible();
  await expect(page.locator(".provider-quota")).toContainText("5시간 할당량");
  await expect(page.locator(".provider-quota")).toContainText("41%");
  await expect(page.locator(".context-window-card")).toHaveCount(0);
  await page.locator(".context-summary").click();
  await expect(page.locator(".context-summary")).toHaveCount(0);
  await expect(page.locator(".context-window-card")).toContainText("사용 64k");
  await expect(page.locator(".context-window-card")).toContainText("전체 200k");
  await expect(page.locator(".context-window-card")).toContainText("남음 136k");
  await expect(page.locator(".work-status-panel")).toContainText("최근 활동 신호");
  await expect(page.locator(".work-event-summary")).toContainText("명령 1");
  await expect(page.locator(".work-event-summary")).toContainText("내부 이벤트");
  await page.screenshot({path:`test-results/${testInfo.project.name}-work-visibility.png`});
  await page.locator(".composer textarea").fill("Claude 실행 중 대기 입력");await page.locator(".composer .send").click();
  const claudeQueue=page.getByRole("region",{name:"대기열"});await expect(claudeQueue.getByText("Claude 실행 중 대기 입력")).toBeVisible();await claudeQueue.getByRole("button",{name:"삭제"}).click();await expect(claudeQueue).toHaveCount(0);
  const claudeActiveAssist=page.getByRole("button",{name:"검토 모델 선택",exact:true});await expect(claudeActiveAssist).toBeVisible();await claudeActiveAssist.click();
  const claudeAssistDialog=page.getByRole("dialog",{name:"보조 검토 모델 선택"});await expect(claudeAssistDialog.getByText(/현재까지의 대화 스냅샷/)).toBeVisible();await expect(claudeAssistDialog.getByLabel("요청")).toHaveValue(/Live mobile output/);await claudeAssistDialog.getByRole("button",{name:"닫기"}).click();
  await page.getByRole("button",{name:"뒤로",exact:true}).click();
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  const brandBeforeDetail=await page.locator(".brand strong").boundingBox();
  await page.getByRole("navigation",{name:"엔진 필터"}).getByRole("button",{name:"Codex",exact:true}).click();
  await page.getByRole("button",{name:"작업 생성"}).click();const codexCreate=page.getByRole("dialog",{name:"새 작업"});await expect(codexCreate.getByRole("button",{name:"단독 작업",exact:true})).toHaveClass(/active/);await expect(codexCreate.getByRole("group",{name:"엔진",exact:true}).getByRole("button",{name:"Codex",exact:true})).toHaveClass(/active/);await expect(codexCreate.getByRole("button",{name:/^GPT(?: |-|$)/}).first()).toBeVisible();await codexCreate.getByRole("button",{name:"닫기"}).click();
  await expect(page.getByRole("navigation",{name:"상태 필터"}).getByRole("button",{name:"실행 중",exact:true})).toBeVisible();
  const codexFilters=page.getByRole("region",{name:"세션 상세 필터"});
  await expect(codexFilters).toBeVisible();
  await codexFilters.getByLabel("프로젝트").selectOption("risuai");
  await expect(codexFilters.getByLabel("프로젝트")).toHaveValue("risuai");
  await expect(page.getByRole("button",{name:/^필터/})).toHaveCount(0);
  await expect.poll(async()=>page.locator(".session-card").count()).toBeGreaterThan(0);

  await page.getByRole("button",{name:"여러 개 삭제"}).click();
  await expect(page.getByRole("button",{name:/Codex mobile fixture/})).toBeDisabled();
  await page.getByRole("button",{name:/Bulk delete fixture one/}).click();
  await page.getByRole("button",{name:/Bulk delete fixture two/}).click();
  await page.getByRole("button",{name:"삭제",exact:true}).click();
  const bulkDeleteDialog=page.getByRole("alertdialog",{name:/Codex 세션 2개 영구 삭제/});
  await expect(bulkDeleteDialog).toBeVisible();
  await bulkDeleteDialog.getByRole("checkbox").check();
  await bulkDeleteDialog.getByRole("button",{name:"2개 영구 삭제"}).click();
  await expect.poll(()=>bulkDeleteRequests.length).toBe(2);
  await expect(page.getByRole("button",{name:/Bulk delete fixture one/})).toHaveCount(0);
  await expect(page.getByRole("button",{name:/Bulk delete fixture two/})).toHaveCount(0);
  await expect(page.getByRole("button",{name:"여러 개 삭제"})).toBeVisible();
  await page.getByRole("button",{name:/Codex mobile fixture/}).click();
  await expectDefaultHeading(".codex-detail .task-heading");
  const codexHistoryControl=page.locator(".codex-detail .running-history-control");
  await expect(codexHistoryControl).toHaveCount(1);await expect(codexHistoryControl).toBeVisible();
  const codexHistoryToggle=codexHistoryControl.getByRole("button");
  await expect(codexHistoryToggle).toHaveAttribute("aria-pressed","false");await codexHistoryToggle.click();await expect(codexHistoryToggle).toHaveAttribute("aria-pressed","true");await codexHistoryToggle.click();await expect(codexHistoryToggle).toHaveAttribute("aria-pressed","false");
  await page.locator(".composer textarea").fill("Codex 실행 중 대기 입력");await page.locator(".composer .send").click();
  const codexQueue=page.getByRole("region",{name:"대기열"});await expect(codexQueue.getByText("Codex 실행 중 대기 입력")).toBeVisible();await codexQueue.getByRole("button",{name:"수정"}).click();await codexQueue.getByLabel("대기 입력 편집").fill("교체한 Codex 대기 입력");await codexQueue.getByRole("button",{name:"저장"}).click();await expect(codexQueue.getByText("교체한 Codex 대기 입력")).toBeVisible();await expect(codexQueue.getByRole("button",{name:"보내기"})).toBeVisible();await codexQueue.getByRole("button",{name:"삭제"}).click();await expect(codexQueue).toHaveCount(0);
  await expectSingleDetailScroll();
  if(phoneViewport){
    const conversation=page.locator(".codex-detail .conversation"),controlsToggle=page.locator(".codex-detail .mobile-controls-toggle"),detailActions=page.locator(".codex-detail .detail-actions");
    await conversation.evaluate(element=>element.scrollTo({top:element.scrollHeight}));
    await expect.poll(()=>conversation.evaluate(element=>element.scrollHeight-element.clientHeight-element.scrollTop)).toBeLessThanOrEqual(60);
    await expect(controlsToggle).toHaveAttribute("aria-expanded","true");
    const bottomScrollTop=await conversation.evaluate(element=>element.scrollTop);
    if(bottomScrollTop>80){
      await conversation.evaluate(element=>element.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true})));
      await page.waitForTimeout(550);
      // The gesture window closes 500ms after the last pointer signal, and a bare
      // scrollTop assignment is indistinguishable from a layout restoration. Send
      // the pointer signal a real finger would still be producing.
      const dragUp=async()=>conversation.evaluate(element=>{
        element.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}));
        element.scrollTop=Math.max(0,element.scrollTop-40);
      });
      await dragUp();
      await page.waitForTimeout(80);
      await dragUp();
      await expect.poll(()=>conversation.evaluate(element=>element.scrollTop)).toBeLessThan(bottomScrollTop-48);
      await expect(controlsToggle).toHaveAttribute("aria-expanded","false");
      await page.waitForTimeout(250);
      expect(await conversation.evaluate(element=>element.scrollTop)).toBeLessThan(bottomScrollTop-48);
    }else await controlsToggle.click();
    await conversation.evaluate(element=>{element.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}));element.scrollTo({top:0});});
    await expect(controlsToggle).toHaveAttribute("aria-expanded","false");
    await expect(detailActions).toBeHidden();
    await controlsToggle.click();
    await expect(controlsToggle).toHaveAttribute("aria-expanded","true");
    await expect(detailActions).toBeVisible();
    await conversation.evaluate(element=>{element.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}));element.scrollTo({top:element.scrollHeight});});
    await expect(controlsToggle).toHaveAttribute("aria-expanded","true");
    await expect(detailActions).toBeVisible();
  }
  const activeAssistButton=page.getByRole("button",{name:"검토 모델 선택",exact:true});await expect(activeAssistButton).toBeVisible();await activeAssistButton.click();
  const activeAssistDialog=page.getByRole("dialog",{name:"보조 검토 모델 선택"});await expect(activeAssistDialog.getByText(/현재까지의 대화 스냅샷/)).toBeVisible();await expect(activeAssistDialog.getByRole("tab",{name:/^DeepSeek/})).toBeVisible();await activeAssistDialog.getByRole("button",{name:"닫기"}).click({timeout:20_000});
  await primaryNav.getByRole("button",{name:"세션",exact:true}).click();
  await page.getByRole("button",{name:/Codex assist fixture/}).click();
  let changedFile=page.getByRole("button",{name:/src\/App\.ts/});
  if(!wideViewport){
    await expect(page.locator(".session-side-rail")).toBeHidden();
    const changedFilesToggle=page.locator(".changed-files-toggle");await expect(changedFilesToggle).toBeVisible();await expect(changedFilesToggle).toHaveAttribute("aria-expanded","false");await expect(changedFile).toBeHidden();await changedFilesToggle.click();await expect(changedFilesToggle).toHaveAttribute("aria-expanded","true");await expect(changedFile).toBeVisible();await changedFilesToggle.click();await expect(changedFile).toBeHidden();await changedFilesToggle.click();await expect(changedFile).toBeVisible();
  }else{changedFile=page.locator(".session-side-rail").getByRole("button",{name:/src\/App\.ts/});await expect(changedFile).toBeVisible();}
  await changedFile.click();
  const workspaceViewer=page.locator(".viewer-dialog .viewer");await expect(workspaceViewer).toBeVisible();const mobileEditor=workspaceViewer.locator("textarea.editor");await expect(mobileEditor).toBeVisible({timeout:15_000});await expect(mobileEditor).toHaveValue("export const mobile = false;\n");await expect(workspaceViewer.getByRole("button",{name:"뷰어",exact:true})).toBeVisible();await expect(workspaceViewer.getByRole("button",{name:"수정기",exact:true})).toHaveAttribute("aria-pressed","true");await expect(workspaceViewer.getByRole("button",{name:"변경 비교",exact:true})).toBeVisible();await expect(mobileEditor).toHaveAttribute("wrap","off");await workspaceViewer.getByRole("button",{name:"자동 줄바꿈",exact:true}).click();await expect(mobileEditor).toHaveAttribute("wrap","soft");await mobileEditor.fill("export const mobile = true;\n");await workspaceViewer.getByRole("button",{name:"변경 비교",exact:true}).click();await expect(workspaceViewer.locator("pre.diff")).toContainText("- export const mobile = false;");await expect(workspaceViewer.locator("pre.diff")).toContainText("+ export const mobile = true;");await expect(workspaceViewer.locator(".diff-shell")).toBeVisible();await expect(workspaceViewer.getByText("− 삭제",{exact:true})).toBeVisible();await expect(workspaceViewer.getByText("+ 추가",{exact:true})).toBeVisible();await workspaceViewer.getByRole("button",{name:"변경 비교",exact:true}).click();await expect(mobileEditor).toHaveValue("export const mobile = true;\n");await workspaceViewer.getByRole("button",{name:"변경 비교",exact:true}).click();await expect(workspaceViewer.locator("pre.diff")).toBeVisible();await workspaceViewer.getByRole("button",{name:"뷰어",exact:true}).click();await expect(workspaceViewer.locator("pre.code")).toContainText("export const mobile = false;");await workspaceViewer.getByRole("button",{name:"수정기",exact:true}).click();await expect(mobileEditor).toHaveValue("export const mobile = true;\n");await workspaceViewer.getByRole("button",{name:"저장",exact:true}).click();await expect(workspaceViewer.locator("pre.code")).toHaveClass(/wrap-lines/);
  await expect.poll(()=>editorWrites.length).toBe(1);expect(editorWrites[0]).toMatchObject({content:"export const mobile = true;\n",expectedRevision:"revision-1"});
  const viewerDialog=page.locator(".viewer-dialog"),appShell=page.locator(".shell"),fileList=workspaceViewer.getByRole("navigation",{name:"파일 목록"});
  await workspaceViewer.getByRole("button",{name:"좌우 반반"}).click();await expect(viewerDialog).toHaveClass(/layout-columns/);await expect(fileList).toBeHidden();
  await expect(page.locator(".session-side-rail")).toBeHidden();
  const splitSessionGeometry=await page.evaluate(()=>{const shell=document.querySelector(".shell")!.getBoundingClientRect(),main=document.querySelector(".detail-main")!.getBoundingClientRect(),composer=document.querySelector(".composer")!.getBoundingClientRect();return{shellWidth:shell.width,mainWidth:main.width,composerLeft:composer.left,composerRight:composer.right,shellLeft:shell.left,shellRight:shell.right};});
  expect(splitSessionGeometry.mainWidth).toBeGreaterThan(splitSessionGeometry.shellWidth*.85);
  expect(splitSessionGeometry.composerLeft).toBeGreaterThanOrEqual(splitSessionGeometry.shellLeft);
  expect(splitSessionGeometry.composerRight).toBeLessThanOrEqual(splitSessionGeometry.shellRight);
  await workspaceViewer.getByRole("button",{name:"파일 목록 펼치기"}).click();await expect(fileList).toBeVisible();
  let splitRects=await page.evaluate(()=>{const viewer=document.querySelector(".viewer-dialog")!.getBoundingClientRect(),shell=document.querySelector(".shell")!.getBoundingClientRect();return{viewerX:viewer.x,viewerY:viewer.y,viewerWidth:viewer.width,viewerHeight:viewer.height,shellX:shell.x,shellY:shell.y,shellWidth:shell.width,shellHeight:shell.height,width:innerWidth,height:innerHeight};});
  expect(splitRects.viewerWidth).toBeCloseTo(splitRects.width/2,0);expect(splitRects.shellWidth).toBeCloseTo(splitRects.width/2,0);expect(splitRects.viewerX).toBeGreaterThan(splitRects.shellX);
  await workspaceViewer.getByRole("button",{name:"세션과 뷰어 좌우 바꾸기"}).click();splitRects=await page.evaluate(()=>{const viewer=document.querySelector(".viewer-dialog")!.getBoundingClientRect(),shell=document.querySelector(".shell")!.getBoundingClientRect();return{viewerX:viewer.x,viewerY:viewer.y,viewerWidth:viewer.width,viewerHeight:viewer.height,shellX:shell.x,shellY:shell.y,shellWidth:shell.width,shellHeight:shell.height,width:innerWidth,height:innerHeight};});expect(splitRects.viewerX).toBeLessThan(splitRects.shellX);
  await workspaceViewer.getByRole("button",{name:"위아래 반반"}).click();await expect(viewerDialog).toHaveClass(/layout-rows/);splitRects=await page.evaluate(()=>{const viewer=document.querySelector(".viewer-dialog")!.getBoundingClientRect(),shell=document.querySelector(".shell")!.getBoundingClientRect();return{viewerX:viewer.x,viewerY:viewer.y,viewerWidth:viewer.width,viewerHeight:viewer.height,shellX:shell.x,shellY:shell.y,shellWidth:shell.width,shellHeight:shell.height,width:innerWidth,height:innerHeight};});expect(splitRects.viewerHeight).toBeCloseTo(splitRects.height/2,0);expect(splitRects.viewerY).toBeGreaterThan(splitRects.shellY);
  await workspaceViewer.getByRole("button",{name:"세션과 뷰어 위아래 바꾸기"}).click();splitRects=await page.evaluate(()=>{const viewer=document.querySelector(".viewer-dialog")!.getBoundingClientRect(),shell=document.querySelector(".shell")!.getBoundingClientRect();return{viewerX:viewer.x,viewerY:viewer.y,viewerWidth:viewer.width,viewerHeight:viewer.height,shellX:shell.x,shellY:shell.y,shellWidth:shell.width,shellHeight:shell.height,width:innerWidth,height:innerHeight};});expect(splitRects.viewerY).toBeLessThan(splitRects.shellY);
  await workspaceViewer.getByRole("button",{name:"전체 화면"}).click();await expect(viewerDialog).toHaveClass(/layout-fullscreen/);await workspaceViewer.getByRole("button",{name:"기본 창"}).click();await expect(viewerDialog).toHaveClass(/layout-window/);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth)).toBeLessThanOrEqual(0);await workspaceViewer.getByRole("button",{name:"대화상자 닫기"}).click();
  const collapsedActions=page.getByRole("button",{name:"작업 메뉴 펼치기",exact:true});if(await collapsedActions.isVisible())await collapsedActions.click();
  const assistButton=page.getByRole("button",{name:"검토 모델 선택",exact:true});await expect(assistButton).toBeVisible();await assistButton.click();
  const assistDialog=page.getByRole("dialog",{name:"보조 검토 모델 선택"});await expect(assistDialog).toBeVisible();await expect(assistDialog.getByLabel("요청")).toHaveValue(/Codex final result/);await assistDialog.getByRole("tab",{name:/^DeepSeek/}).click();await expect(assistDialog.locator(".target-picker select").first()).toHaveValue("deepseek-review");expect(await assistDialog.evaluate(element=>element.scrollWidth-element.clientWidth)).toBeLessThanOrEqual(1);await assistDialog.getByRole("button",{name:"닫기"}).click();await assistButton.click();await expect(page.getByRole("dialog",{name:"보조 검토 모델 선택"}).getByRole("tab",{name:/^DeepSeek/})).toHaveAttribute("aria-selected","true");await page.getByRole("dialog",{name:"보조 검토 모델 선택"}).getByRole("button",{name:"닫기"}).click();
  const handoffButton=page.getByRole("button",{name:"작업 인계",exact:true}).filter({visible:true}).first();await handoffButton.click();const handoffDialog=page.getByRole("dialog",{name:"작업 인계"});await expect(handoffDialog.getByRole("tab",{name:/^Google/})).toBeVisible();await handoffDialog.getByRole("tab",{name:/^Google/}).click();await expect(handoffDialog.locator(".target-picker select").first()).toHaveValue("gemini-review");expect(await handoffDialog.evaluate(element=>element.scrollWidth-element.clientWidth)).toBeLessThanOrEqual(1);await handoffDialog.getByRole("button",{name:"닫기"}).click();
  await primaryNav.getByRole("button",{name:"세션",exact:true}).click();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `test-results/${testInfo.project.name}-list.png`, fullPage: true });

  const moreActions=page.getByRole("button",{name:"추가 작업"});
  if(await moreActions.isVisible())await moreActions.click();
  await page.getByRole("button",{name:"설정 열기"}).click();
  const settings=page.getByRole("dialog",{name:"설정"});
  await expect(settings.getByRole("button",{name:"개요",exact:true})).toHaveCount(0);
  await expect(settings.getByRole("button",{name:"서버 및 Worker",exact:true})).toBeVisible();
  await settings.getByRole("button",{name:"서버 및 Worker",exact:true}).click();
  await expect(settings.getByRole("heading",{name:"서버 및 실행 장치",exact:true})).toBeVisible();
  await settings.getByRole("button",{name:"계정",exact:true}).click();
  await expect(settings.getByText("공급자 연결",{exact:true}).first()).toBeVisible();
  await expect(settings.getByText("Codex",{exact:true})).toBeVisible();
  await expect(settings.getByText("Claude Code",{exact:true})).toBeVisible();
  await expect(settings.getByRole("navigation",{name:"설정"})).toBeVisible();
  const originalViewport=page.viewportSize()!;
  await page.setViewportSize({width:1100,height:900});
  await settings.getByRole("button",{name:"Git",exact:true}).click();
  await expect(settings.getByText("연결됨 · octocat",{exact:true})).toBeVisible();
  await expect(settings.getByText("토큰 발급 순서",{exact:true})).toBeVisible();
  await expect(settings.getByText(/repo.*read:org.*gist/)).toBeVisible();
  const createTokenLink=settings.getByRole("link",{name:"GitHub에서 토큰 만들기",exact:true});
  await expect(createTokenLink).toHaveAttribute("href","https://github.com/settings/tokens/new");
  await expect(createTokenLink).toHaveAttribute("rel","noreferrer");
  expect(await settings.locator(".git-settings").evaluate(element=>element.scrollWidth-element.clientWidth)).toBeLessThanOrEqual(0);
  expect(await settings.locator(".token-connect").evaluate(element=>element.scrollWidth-element.clientWidth)).toBeLessThanOrEqual(0);
  await expect(settings.getByLabel("예상 GitHub 사용자명")).toHaveValue("octocat");
  const githubToken=settings.getByLabel("개인 액세스 토큰");
  const fakeToken=["github","pat","PLAYWRIGHTAAAAAAAAAAAAAAAAAAAA"].join("_");
  await githubToken.fill(fakeToken);
  await settings.getByRole("button",{name:"토큰 갱신",exact:true}).click();
  await expect.poll(()=>githubTokenRequests.length).toBe(1);
  expect(githubTokenRequests[0]).toEqual({username:"octocat",token:fakeToken,protocol:"https"});
  await expect(githubToken).toHaveValue("");
  await expect(settings.getByText("GitHub 계정 octocat을 연결했습니다.",{exact:true})).toBeVisible();
  await expect(settings.getByText("토큰 연결됨",{exact:true})).toBeVisible();
  await expect(settings.getByText("이 토큰으로 조회되는 저장소가 없습니다.")).toBeVisible();
  await expect(settings.getByText("octocat · HTTPS · 이 호스트에서 사용 중",{exact:true})).toBeVisible();
  await page.setViewportSize(originalViewport);
  await settings.getByRole("button",{name:"작업공간",exact:true}).click();
  await expect(settings.getByRole("heading",{name:"프로젝트",exact:true})).toBeVisible();
  await settings.getByRole("button",{name:"시스템",exact:true}).click();
  await expect(settings.getByRole("heading",{name:"Claudex Workhouse 업데이트",exact:true})).toBeVisible();
  await expect(settings.getByText("애플리케이션 업데이트는 Provider 런타임 업데이트와 별도로 적용됩니다.",{exact:true})).toBeVisible();
  const installedVersion=settings.locator(".application-update-current");
  const installedBox=await installedVersion.boundingBox();
  expect(installedBox?.width??0).toBeGreaterThan(120);
  expect(installedBox?.height??Number.POSITIVE_INFINITY).toBeLessThan(80);
  await expect(settings.getByText("Codex CLI 0.144.3",{exact:true})).toBeVisible();
  await expect(settings.getByText("Claude Code 2.1.207",{exact:true})).toBeVisible();
  await settings.getByRole("button",{name:"업데이트 확인",exact:true}).click();
  await expect(settings.getByText("최신 0.144.5",{exact:true})).toBeVisible();
  await expect(settings.getByText("최신 2.1.212",{exact:true})).toBeVisible();
  await expect(settings.getByRole("button",{name:"업데이트",exact:true})).toHaveCount(2);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth)).toBeLessThanOrEqual(0);
  await page.screenshot({path:`test-results/${testInfo.project.name}-provider-settings.png`,fullPage:true});
  await settings.getByRole("button",{name:"대화상자 닫기"}).click();

  await page.getByRole("button", { name: "작업 생성" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const createDialog=page.getByRole("dialog");
  // The dialog reopens on the session type used last, so pick the single-task
  // tab before asserting anything that only exists there.
  await createDialog.locator(".create-kinds").getByRole("button",{name:"단독 작업",exact:true}).click();
  // Work location collapses to a summary row and expands in place.
  await expect(createDialog.locator("#create-workspace .cpick")).toBeVisible();
  await createDialog.locator("#create-workspace .cpick").click();
  await expect(createDialog.locator(".host-choice-grid")).toBeVisible();
  await expect(createDialog.locator(".workspace-choice-grid")).toBeVisible();
  await createDialog.locator("#create-workspace .cpick").click();
  // Work mode and automation are inline selections now: no popover, and the
  // chosen value is the filled one.
  const createMode=createDialog.locator("#create-workmode .sel");
  await expect(createMode.getByRole("button",{name:"바로 실행",exact:true})).toHaveClass(/active/);
  await createMode.getByRole("button",{name:"계획 먼저",exact:true}).click();
  await expect(createMode.getByRole("button",{name:"계획 먼저",exact:true})).toHaveClass(/active/);
  const createAutomation=createDialog.locator("#create-automation .cf").last().locator(".sel");
  // Planning first is a read-only mode, so the automation level follows it.
  await expect(createAutomation.getByRole("button",{name:"읽기 전용",exact:true})).toHaveClass(/active/);
  await createMode.getByRole("button",{name:"바로 실행",exact:true}).click();
  await createAutomation.getByRole("button",{name:"자동 실행",exact:true}).click();
  await expect(createAutomation.getByRole("button",{name:"자동 실행",exact:true})).toHaveClass(/active/);
  await page.getByRole("dialog").getByRole("button",{name:"대화",exact:true}).click();
  await expect(page.getByText("대화 모드 참가자는 항상 읽기 전용입니다. 아래 리뷰 도구를 켜도 파일 수정 권한은 부여되지 않습니다.")).toBeVisible();
  const conversationDialog=page.getByRole("dialog");
  await expect(conversationDialog.locator("#create-flow").getByRole("button",{name:"사용자 참여",exact:true})).toBeVisible();
  await expect(page.getByLabel("사용자 호칭")).toHaveValue("챗붕");
  // Participants are chips, and each selected one owns a settings block keyed by
  // its provider id instead of a nested fieldset.
  const participantPicker=conversationDialog.locator("#create-provider .chips");
  await expect(participantPicker.getByRole("button")).toHaveCount(5);
  for(const [provider,id] of [["Gemini","antigravity"],["DeepSeek","deepseek"],["Ollama","ollama"]]){
    await participantPicker.getByRole("button",{name:provider,exact:true}).click();
    const block=conversationDialog.locator(`.cwho[data-provider="${id}"]`);
    await expect(block,provider).toBeVisible();
    await expect(block.getByRole("button",{name:"캐릭터 톤",exact:true})).toBeVisible();
  }
  const codexConversationSettings=conversationDialog.locator('.cwho[data-provider="codex"]'),claudeConversationSettings=conversationDialog.locator('.cwho[data-provider="claude"]');
  await expect(codexConversationSettings.getByLabel("모델")).not.toHaveValue("");
  await expect(codexConversationSettings.getByLabel("추론 강도")).not.toHaveValue("");
  await expect(claudeConversationSettings.getByLabel("모델")).not.toHaveValue("");
  await expect(claudeConversationSettings.getByLabel("추론 강도")).not.toHaveValue("");
  // The round limit is a stepper whose number can be typed directly, and the
  // unlimited switch is a pressed toggle beside it.
  const turnLimit=conversationDialog.locator("#create-turns input");await expect(turnLimit).toHaveValue("5");
  await conversationDialog.locator("#create-turns").getByRole("button",{name:"무제한",exact:true}).click();
  await expect(turnLimit).toBeDisabled();
  await expect(page.getByText("모델별 100회 안전 상한",{exact:false})).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("checkbox",{name:"위험을 이해했으며 무제한 대화를 시작합니다.",exact:true})).toBeVisible();
  const modalOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(modalOverflow).toBeLessThanOrEqual(0);
  await page.getByRole("button", { name: "닫기" }).click();

  await page.locator(".codex-session-pane:not([hidden]) .task-card").first().click();
  await expectDefaultHeading(".task-heading");
  if(phoneViewport)await page.locator(".task-heading .heading-toggle").click();
  await expect(page.locator(".task-heading h1")).toBeVisible();
  await expect(page.getByRole("button",{name:"작업 인계",exact:true})).toBeVisible();
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  const brandInDetail=await page.locator(".brand strong").boundingBox();
  // The brand wordmark is hidden below 600px, so its position can only be
  // compared on the wider viewports.
  if(!phoneViewport){expect(brandBeforeDetail).not.toBeNull();expect(brandInDetail).not.toBeNull();expect(Math.abs(brandInDetail!.x-brandBeforeDetail!.x)).toBeLessThanOrEqual(1);}
  await expect(page.getByTitle("스레드 ID 복사")).toBeVisible();
  await expect(page.locator(".conversation-content").getByText("Future event remains readable.")).toHaveCount(0);
  await expect(page.locator(".work-status-badge")).toBeVisible();
  await expect(page.getByRole("paragraph").filter({hasText:"Live mobile output"})).toBeVisible();
  await expect(page.locator(".live-badge")).toHaveText("실시간");
  const composerMode=page.locator(".composer").getByRole("group",{name:"작업 방식"});
  await expect(composerMode.getByRole("button",{name:"바로 실행",exact:true})).toBeVisible();
  await expect(composerMode.getByRole("option",{name:/계획 먼저/})).toBeHidden();
  await expect(page.locator(".composer").getByRole("group",{name:"자동화 수준"}).getByRole("button",{name:"자동 실행",exact:true})).toBeVisible();
  await expect.poll(async()=>page.locator(".live-event").count()).toBeLessThanOrEqual(300);
  await expectSingleDetailScroll();
  const composer = page.locator(".composer textarea");
  await composer.fill("입력 글자색 확인");
  await expect(composer).toHaveValue("입력 글자색 확인");
  expect(await composer.evaluate((element) => getComputedStyle(element).color)).not.toBe("rgba(0, 0, 0, 0)");
  await composer.fill("완료 세션 후속 작업");
  await page.locator(".composer .send").click();
  expect(await page.evaluate(() => (globalThis as any).mcpExecuted)).toBeUndefined();
  await page.getByRole("button", { name: "더 보기" }).click();
  await page.getByRole("button", { name: "영구 삭제" }).click();
  const deleteDialog = page.getByRole("alertdialog");
  await expect(deleteDialog).toBeVisible();
  const finalDelete = deleteDialog.getByRole("button", { name: "영구 삭제" });
  await expect(finalDelete).toBeDisabled();
  await deleteDialog.getByRole("checkbox").check();
  await expect(finalDelete).toBeEnabled();
  await deleteDialog.getByRole("button", { name: "취소" }).click();
  const detailOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(detailOverflow).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `test-results/${testInfo.project.name}-detail.png`, fullPage: true });

  const manifest = await page.request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBe(true);
  expect((await manifest.json()).display).toBe("standalone");
  const serviceWorker=await page.request.get("/sw.js");expect(serviceWorker.ok()).toBe(true);expect(await serviceWorker.text()).not.toContain("/api/tasks");
});
