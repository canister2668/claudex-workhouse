import { expect, test } from "@playwright/test";

// Every fixture below exists at once, exactly as a live install can hold them:
// managed provider work, an ordinary Assist target, a plain task, conversation
// turns, a collaboration board execution and the isolated runtime session.
// Only the independent work may appear in the All and provider tabs.
const now=new Date().toISOString();

const task=(id:string,provider:string,title:string,metadata:Record<string,unknown>,extra:Record<string,unknown>={})=>({
  id,provider,nativeId:id,threadId:`${id}-thread`,projectId:"project",title,prompt:"p",status:"completed",createdAt:now,updatedAt:now,
  result:"r",error:null,log:"",owned:true,ownership:"claudex-workhouse",source:"claudex-workhouse",executionHostId:"local",workspaceId:"workspace",
  permissionProfile:":workspace",metadata,...extra
});

const TASKS=[
  task("managed-claude","claude","맡긴 Claude 작업",{collaborationSessionId:"assist-1",collaborationParticipantId:"p-managed-claude",collaborationMode:"assist",managedProviderSourceTaskId:"codex:source"}),
  task("managed-grok","grok","맡긴 Grok 작업",{collaborationSessionId:"assist-1",collaborationParticipantId:"p-managed-grok",collaborationMode:"assist",managedProviderSourceTaskId:"codex:source"}),
  task("assist-ollama","ollama","일반 Assist 작업",{collaborationSessionId:"assist-2",collaborationParticipantId:"p-assist-ollama"}),
  task("regular-claude","claude","일반 Claude 작업",{}),
  task("conversation-antigravity","antigravity","대화 참가 턴",{collaborationSessionId:"conversation-1",collaborationParticipantId:"p-conversation"}),
  task("board-deepseek","deepseek","보드 실행 세션",{collaborationSessionId:"review-1",collaborationParticipantId:"p-board"},{workChainId:"chain-1"}),
];

const COLLABORATIONS=[
  {id:"assist-1",projectId:"project",title:"managed assist",mode:"assist",status:"completed",outcome:null,currentStep:"done",sourceTaskId:"codex:source",workChainId:null,updatedAt:now,metadata:{}},
  {id:"assist-2",projectId:"project",title:"ordinary assist",mode:"assist",status:"completed",outcome:null,currentStep:"done",sourceTaskId:"regular-claude",workChainId:null,updatedAt:now,metadata:{}},
  {id:"conversation-1",projectId:"project",title:"대화",mode:"debate",status:"completed",outcome:null,currentStep:"done",sourceTaskId:null,workChainId:null,updatedAt:now,metadata:{}},
  {id:"review-1",projectId:"project",title:"보드 검토",mode:"review",status:"completed",outcome:null,currentStep:"done",sourceTaskId:null,workChainId:"chain-1",updatedAt:now,metadata:{}}
];

const INDEPENDENT=["맡긴 Claude 작업","맡긴 Grok 작업","일반 Assist 작업","일반 Claude 작업"];
const HIDDEN=["대화 참가 턴","보드 실행 세션","브라우저 세션"];
// The linked-session tab is where the conversation turn and the isolated
// runtime session remain reachable.
const LINKED=["대화 참가 턴",
];

async function install(page:import("@playwright/test").Page){
  await page.addInitScript(()=>{
    localStorage.setItem("claudex-ui-locale","ko");
    class SilentEventSource{onerror:null|(()=>void)=null;constructor(public url:string){}addEventListener(){}close(){}}
    Object.defineProperty(globalThis,"EventSource",{value:SilentEventSource,configurable:true});
  });
  await page.route("**/api/**",async route=>{
    const pathname=new URL(route.request().url()).pathname,json=(value:unknown)=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(value)});
    if(pathname==="/api/tasks")return json({tasks:TASKS,partial:false,warnings:[]});
    if(pathname==="/api/collaborations")return json({collaborations:COLLABORATIONS});
    if(pathname==="/api/conversation-documents")return json({documents:[]});
    if(pathname==="/api/projects")return json({projects:[{id:"project",name:"Project",enabled:true,error:null}]});
    if(pathname==="/api/hosts")return json({hosts:[{id:"local",displayName:"Local",status:"online"}]});
    if(pathname==="/api/workspaces")return json({workspaces:[{id:"workspace",projectId:"project",hostId:"local",displayName:"Workspace",canonicalPath:"/workspace"}]});
    if(pathname==="/api/codex/threads")return json({sessions:[],syncedAt:now});
    if(pathname==="/api/providers/codex/models")return json({catalog:{models:[],permissions:[]}});
    if(pathname==="/api/providers/claude/permissions")return json({models:[],permissions:[],efforts:[],catalog:{models:[],stale:false}});
    if(pathname==="/api/provider-connections"||pathname==="/api/provider-connections/attempts")return json({accounts:[],attempts:[]});
    if(pathname==="/api/quota")return json({claude:{},codex:{},fetchedAt:now});
    if(pathname==="/api/quota-reservations")return json({reservations:[]});
    if(pathname==="/api/emotion")return json({state:{},codexState:{},outfits:[],assets:[],mode:"catch"});
    if(pathname==="/api/push")return json({preferences:{},publicKey:""});
    if(pathname==="/api/setup")return json({required:false});
    if(pathname.startsWith("/api/tasks/"))return json({task:TASKS.find(item=>pathname.includes(item.id))??null,events:[],items:[],activeTask:null});
    if(pathname.startsWith("/api/system-settings/"))return json(pathname.endsWith("ui-locale")?{locale:"ko"}:{settings:null,candidates:{claude:[],codex:[]}});
    return json({});
  });
  await page.goto("/",{waitUntil:"domcontentloaded"});
  await page.getByRole("button",{name:"세션",exact:true}).click();
}

const titles=(page:import("@playwright/test").Page)=>page.locator(".task-card .task-copy > strong");
// The fixtures share a timestamp, so only membership is meaningful here.
const expectTitles=async(page:import("@playwright/test").Page,expected:string[])=>{
  await expect(titles(page)).toHaveCount(expected.length,{timeout:15_000});
  await expect.poll(async()=>(await titles(page).allInnerTexts()).map(value=>value.trim()).sort(),{timeout:15_000}).toEqual([...expected].sort());
};

test.describe("provenance-based session classification",()=>{
  test("independent work stays visible while conversation, board and runtime sessions do not",async({page})=>{
    await install(page);
    await expectTitles(page,INDEPENDENT);
    for(const hidden of HIDDEN)await expect(page.locator(".task-card",{hasText:hidden})).toHaveCount(0);

    await page.getByRole("button",{name:"Claude",exact:true}).click();
    await expectTitles(page,["맡긴 Claude 작업","일반 Claude 작업"]);

    await page.getByRole("button",{name:"Grok",exact:true}).click();
    await expectTitles(page,["맡긴 Grok 작업"]);

    await page.getByRole("button",{name:"Ollama",exact:true}).click();
    await expectTitles(page,["일반 Assist 작업"]);

    // A conversation participant is reachable only from the linked sessions.
    await page.getByRole("button",{name:"Gemini",exact:true}).click();
    await expect(page.locator(".task-card")).toHaveCount(0);
    await page.getByRole("button",{name:"DeepSeek",exact:true}).click();
    await expect(page.locator(".task-card")).toHaveCount(0);

    await page.getByRole("button",{name:"연결 세션",exact:true}).click();
    await expectTitles(page,LINKED);
    for(const visible of INDEPENDENT)await expect(page.locator(".task-card",{hasText:visible})).toHaveCount(0);
  });

  test("each visible card opens its own provider task detail",async({page})=>{
    await install(page);
    await page.locator(".task-card",{hasText:"맡긴 Grok 작업"}).click();
    await expect(page.locator(".session-detail, .conversation").first()).toBeVisible({timeout:15_000});
    await expect(page.getByText("맡긴 Grok 작업").first()).toBeVisible();
  });

  test("the classification is identical on a 412px phone",async({page})=>{
    await page.setViewportSize({width:412,height:915});
    await install(page);
    await expectTitles(page,INDEPENDENT);
    for(const hidden of HIDDEN)await expect(page.locator(".task-card",{hasText:hidden})).toHaveCount(0);
    await page.getByRole("button",{name:"Claude",exact:true}).click();
    await expectTitles(page,["맡긴 Claude 작업","일반 Claude 작업"]);
  });
});
