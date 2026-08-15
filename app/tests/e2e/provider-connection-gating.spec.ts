import {expect,test} from "@playwright/test";

const now=new Date().toISOString();
const codexModel={id:"gpt-gating",model:"gpt-gating",displayName:"GPT Gating",hidden:false,isDefault:true,defaultReasoningEffort:"medium",supportedReasoningEfforts:[{reasoningEffort:"medium"}],serviceTiers:[],defaultServiceTier:null};
const claudeModel={id:"claude-gating",displayName:"Claude Gating",source:"runtime"};
const workspace={id:"workspace-gating",projectId:"gating-project",hostId:"local",displayName:"Gating Project",canonicalPath:"/workspace/gating"};
const claudeTask={id:"claude:legacy",provider:"claude",nativeId:"legacy",threadId:"legacy-thread",projectId:"gating-project",title:"연결 해제 전 Claude 세션",prompt:"fixture",status:"completed",createdAt:now,updatedAt:now,result:"이전 결과",error:null,log:"",owned:true,ownership:"claudex-workhouse",source:"claudex-workhouse",executionHostId:"local",workspaceId:workspace.id,metadata:{}};

async function mount(page:any,accounts:Array<{provider:string;state:string}>){
  const submissions={tasks:0,collaborations:0};
  await page.addInitScript(()=>{
    localStorage.setItem("claudex-ui-locale","ko");
    localStorage.setItem("deck-global-settings",JSON.stringify({defaultProvider:"claude"}));
    class SilentEventSource{onerror:null|(()=>void)=null;constructor(public url:string){}addEventListener(){}close(){}}
    Object.defineProperty(globalThis,"EventSource",{value:SilentEventSource,configurable:true});
  });
  await page.route("**/api/**",async(route:any)=>{
    const url=new URL(route.request().url()),pathname=url.pathname,json=(value:unknown)=>route.fulfill({contentType:"application/json",body:JSON.stringify(value)});
    if(pathname==="/api/tasks"&&route.request().method()==="POST"){submissions.tasks++;return json({task:null});}
    if(pathname==="/api/collaborations"&&route.request().method()==="POST"){submissions.collaborations++;return json({session:null});}
    if(pathname==="/api/quota-reservations"&&route.request().method()==="POST"){submissions.tasks++;return json({reservation:null});}
    if(pathname==="/api/provider-connections")return json({singleUser:true,accounts:accounts.map(item=>({...item,accountType:null,planType:null,emailMasked:null,errorCategory:null,checkedAt:now})),attempts:[]});
    if(pathname==="/api/provider-connections/attempts")return json({attempts:[]});
    if(pathname==="/api/tasks"){const provider=url.searchParams.get("provider");return json({tasks:[claudeTask].filter(item=>!provider||item.provider===provider),partial:false,warnings:[]});}
    if(pathname==="/api/location-options")return json({projects:[{id:"gating-project",name:"Gating Project",enabled:true,error:null}],workspaces:[workspace]});
    if(pathname==="/api/projects")return json({projects:[{id:"gating-project",name:"Gating Project",enabled:true,error:null}]});
    if(pathname==="/api/hosts")return json({hosts:[{id:"local",type:"local",displayName:"Local",platform:"linux",architecture:"x64",status:"online",lastSeenAt:now}]});
    if(pathname==="/api/workspaces")return json({workspaces:[workspace]});
    if(pathname==="/api/workspace-roots")return json({roots:[]});
    if(pathname==="/api/collaborations")return json({collaborations:[]});
    if(pathname==="/api/conversation-documents")return json({documents:[]});
    if(pathname==="/api/quota-reservations")return json({reservations:[]});
    if(pathname==="/api/codex/threads")return json({sessions:[],nextCursor:null,stale:false});
    if(pathname==="/api/providers/codex/models")return json({catalog:{models:[codexModel],permissions:[],fetchedAt:now,stale:false}});
    if(pathname==="/api/providers/claude/permissions")return json({permissions:[],models:[claudeModel],efforts:[{id:"medium",displayName:"중간"}],catalog:{models:[claudeModel]}});
    if(pathname==="/api/system-settings/models")return json({settings:{version:1,codex:{models:[{id:codexModel.id,displayName:codexModel.displayName,source:"runtime",validatedAt:null}]},claude:{models:[{id:claudeModel.id,displayName:claudeModel.displayName,source:"runtime",validatedAt:null}]},deepseek:{models:[]},ollama:{models:[]},antigravity:{models:[]},grok:{models:[]}},candidates:{codex:[],claude:[],deepseek:[],ollama:[],antigravity:[],grok:[]}});
    if(pathname==="/api/system-settings/ui-locale")return json({locale:"ko"});
    if(pathname.startsWith("/api/system-settings/"))return json({settings:null});
    if(pathname==="/api/emotion")return json({state:{},codexState:{},outfitsByProvider:{},assets:{},mode:"catch"});
    if(pathname==="/api/quota")return json({claude:{},codex:{},fetchedAt:now});
    if(pathname==="/api/push")return json({preferences:{},publicKey:""});
    if(pathname==="/api/setup")return json({required:false});
    return json({});
  });
  await page.goto("/",{waitUntil:"domcontentloaded"});
  return submissions;
}

test("a disconnected provider keeps its sessions but leaves every new-session path",async({page})=>{
  const submissions=await mount(page,[{provider:"codex",state:"connected"},{provider:"claude",state:"disconnected"},{provider:"grok",state:"unavailable"}]);

  // The avatar badge follows connection state only: a completed Claude session
  // no longer keeps Claude in the dock.
  await expect(page.getByRole("button",{name:"Codex 상태 및 최근 세션"})).toBeVisible();
  await expect(page.getByRole("button",{name:"Claude 상태 및 최근 세션"})).toHaveCount(0);
  // "unavailable" is not a creatable state either.
  await expect(page.getByRole("button",{name:"Grok 상태 및 최근 세션"})).toHaveCount(0);

  // The home quick-create panel drops the entry point for a disconnected provider.
  const quick=page.locator(".overview-quick-grid");
  await expect(quick.getByRole("button",{name:/새 Codex 작업/})).toBeVisible();
  await expect(quick.getByRole("button",{name:/새 Claude 작업/})).toHaveCount(0);
  // One connected provider cannot form a review.
  await expect(quick.getByRole("button",{name:/협업 시작/})).toHaveCount(0);

  // The existing session stays listed and openable.
  await page.getByRole("navigation",{name:"주요 화면"}).getByRole("button",{name:"세션",exact:true}).click();
  const card=page.locator(".task-card").filter({hasText:"연결 해제 전 Claude 세션"});
  await expect(card).toBeVisible();
  await card.click();
  await expect(page.locator(".task-heading")).toContainText("연결 해제 전 Claude 세션");
  await page.getByRole("button",{name:"뒤로",exact:true}).click();

  await page.locator(".new-button").click();
  const dialog=page.getByRole("dialog",{name:"새 작업"});
  await expect(dialog).toBeVisible();
  const engine=dialog.locator("#create-provider .sel");
  await expect(engine.getByRole("button",{name:"Codex"})).toBeVisible();
  await expect(engine.getByRole("button",{name:"Claude"})).toHaveCount(0);
  await expect(engine.getByRole("button",{name:"Grok"})).toHaveCount(0);
  // The stored default was Claude; it falls back to the connected provider.
  await expect(engine.getByRole("button",{name:"Codex"})).toHaveClass(/active/);

  await dialog.getByRole("button",{name:"대화",exact:true}).click();
  const conversation=page.getByRole("dialog",{name:"새 대화"});
  const participants=conversation.locator("#create-provider .chips");
  await expect(participants.getByRole("button",{name:"Codex"})).toBeVisible();
  await expect(participants.getByRole("button",{name:"Claude"})).toHaveCount(0);
  await conversation.locator(".create-kinds").getByRole("button",{name:"검토",exact:true}).click();
  const review=page.getByRole("dialog",{name:"새 검토"});
  const reviewers=review.locator("#create-provider .chips");
  await expect(reviewers.getByRole("button",{name:"Codex"})).toBeVisible();
  await expect(reviewers.getByRole("button",{name:"Claude"})).toHaveCount(0);
  await expect(review.getByText("교차·병렬 리뷰에는 연결된 프로바이더가 두 개 이상 필요합니다.",{exact:true})).toBeVisible();
  const reviewPrompt=review.getByLabel("검토 대상과 기준",{exact:true});
  await reviewPrompt.fill("한 명의 프로바이더로는 검토를 시작하지 말아야 한다");
  await expect(review.getByRole("button",{name:"검토 시작",exact:true})).toBeDisabled();
  // A keyboard submit must be blocked by the same invariant as the button.
  await reviewPrompt.press("Enter");
  await page.waitForTimeout(300);
  expect(submissions.collaborations).toBe(0);
});

test("no connected provider shows connection guidance and blocks creation",async({page})=>{
  const submissions=await mount(page,[{provider:"codex",state:"disconnected"},{provider:"claude",state:"unavailable"}]);

  await page.locator(".new-button").click();
  const dialog=page.getByRole("dialog",{name:"새 작업"});
  await expect(dialog.getByText("연결된 프로바이더가 없습니다",{exact:true})).toBeVisible();
  await expect(dialog.getByRole("group",{name:"실행 모델",exact:true})).toHaveCount(0);
  await dialog.getByLabel("요청",{exact:true}).fill("연결이 없으면 시작할 수 없어야 한다");
  await expect(dialog.getByRole("button",{name:"지금 시작",exact:true})).toBeDisabled();
  // The Enter key path must honour the same invariant as the disabled button.
  await dialog.getByLabel("요청",{exact:true}).press("Enter");
  await page.waitForTimeout(500);
  expect(submissions.tasks).toBe(0);
  expect(submissions.collaborations).toBe(0);
  await dialog.getByRole("button",{name:"연결 설정 열기",exact:true}).click();
  await expect(page.getByRole("heading",{name:"공급자 연결"})).toBeVisible();
});
