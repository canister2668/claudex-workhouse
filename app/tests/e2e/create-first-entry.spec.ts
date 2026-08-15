import {expect,test} from "@playwright/test";

test("first create entry waits for a selected model and work location",async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem("claudex-ui-locale","ko");
    class SilentEventSource{onerror:null|(()=>void)=null;constructor(public url:string){}addEventListener(){}close(){}}
    Object.defineProperty(globalThis,"EventSource",{value:SilentEventSource,configurable:true});
  });

  const now=new Date().toISOString();
  const codexModel={id:"gpt-first-entry",model:"gpt-first-entry",displayName:"GPT First Entry",hidden:false,isDefault:true,defaultReasoningEffort:"medium",supportedReasoningEfforts:[{reasoningEffort:"medium"}],serviceTiers:[],defaultServiceTier:null};
  const claudeModel={id:"claude-first-entry",displayName:"Claude First Entry",source:"runtime"};
  const workspace={id:"workspace-first-entry",projectId:"ready-project",hostId:"local",displayName:"Ready Project",canonicalPath:"/workspace/ready-project"};
  const projects=[{id:"empty-project",name:"Empty Project",enabled:true,error:null},{id:"ready-project",name:"Ready Project",enabled:true,error:null}];
  const hosts=[{id:"local",type:"local",displayName:"Local",platform:"linux",architecture:"x64",status:"online",lastSeenAt:now}];
  const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
  let createdConversation:any=null;
  let locationRequested=false,releaseLocation!:()=>void;
  const locationGate=new Promise<void>(resolve=>releaseLocation=resolve);

  await page.route("**/api/**",async route=>{
    const url=new URL(route.request().url()),pathname=url.pathname,json=(value:unknown)=>route.fulfill({contentType:"application/json",body:JSON.stringify(value)});
    if(pathname==="/api/tasks"){await delay(800);return json({tasks:[]});}
    if(pathname==="/api/location-options"){locationRequested=true;await locationGate;return json({projects,workspaces:[workspace]});}
    if(pathname==="/api/projects")return json({projects});
    if(pathname==="/api/hosts")return json({hosts});
    if(pathname==="/api/workspaces")return json({workspaces:[workspace]});
    if(pathname==="/api/providers/codex/models"){await delay(200);return json({catalog:{models:[codexModel],permissions:[],fetchedAt:now,stale:false}});}
    if(pathname==="/api/providers/claude/permissions"){await delay(300);return json({permissions:[],models:[claudeModel],efforts:[{id:"medium",displayName:"중간"}],catalog:{models:[claudeModel]}});}
    if(pathname==="/api/system-settings/models"){await delay(350);return json({settings:{version:1,codex:{models:[{id:codexModel.id,displayName:codexModel.displayName,source:"runtime",validatedAt:null}]},claude:{models:[{id:claudeModel.id,displayName:claudeModel.displayName,source:"runtime",validatedAt:null}]},deepseek:{models:[]},ollama:{models:[]},antigravity:{models:[]}},candidates:{codex:[],claude:[],deepseek:[],ollama:[],antigravity:[]}});}
    if(pathname==="/api/collaborations"&&route.request().method()==="POST"){
      createdConversation=route.request().postDataJSON();
      return json({session:{id:"conversation-review-tools",projectId:"ready-project",title:"리뷰 도구 검증",mode:"conversation",status:"starting",outcome:null,currentStep:"queued",sourceTaskId:null,updatedAt:now,metadata:{conversationKind:createdConversation.conversationKind}}});
    }
    if(pathname==="/api/collaborations")return json({collaborations:[]});
    if(pathname==="/api/system-settings/ui-locale")return json({locale:"ko"});
    if(pathname==="/api/system-settings/characters")return json({settings:null});
    if(pathname==="/api/system-settings/path-display")return json({hideLocalPaths:false});
    if(pathname==="/api/provider-connections")return json({accounts:[{provider:"codex",state:"connected",accountType:"chatgpt",planType:null,emailMasked:null,errorCategory:null,checkedAt:new Date().toISOString()},{provider:"claude",state:"connected",accountType:"claude.ai",planType:null,emailMasked:null,errorCategory:null,checkedAt:new Date().toISOString()}],attempts:[]});
    if(pathname==="/api/provider-connections/attempts")return json({attempts:[]});
    if(pathname==="/api/quota")return json({claude:{},codex:{},fetchedAt:now});
    if(pathname==="/api/emotion")return json({state:{},codexState:{},outfits:[],assets:[],mode:"catch"});
    if(pathname==="/api/push")return json({preferences:{},publicKey:""});
    if(pathname==="/api/setup")return json({required:false});
    return json({});
  });

  await page.goto("/",{waitUntil:"domcontentloaded"});
  const createButton=page.locator(".new-button");
  await createButton.click();
  await expect.poll(()=>locationRequested).toBe(true);
  const dialog=page.getByRole("dialog",{name:"새 작업"});
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("작업 위치를 불러오는 중…",{exact:true})).toBeVisible();
  await expect(dialog.locator(".workspace-choice-grid button.active")).toHaveCount(0);
  await expect(dialog.getByRole("button",{name:"지금 시작",exact:true})).toBeDisabled();
  await expect(dialog.getByRole("button",{name:"한도 초기화 후 시작",exact:true})).toBeDisabled();
  await dialog.getByLabel("요청",{exact:true}).fill("위치를 기다리는 동안 먼저 입력");
  await expect(dialog.getByLabel("요청",{exact:true})).toHaveValue("위치를 기다리는 동안 먼저 입력");

  releaseLocation();
  await expect(dialog.getByText("작업 위치를 불러오는 중…",{exact:true})).toHaveCount(0,{timeout:15_000});
  // The location block collapses to its summary row once a workspace resolves.
  await expect(dialog.locator(".cpick[aria-expanded]")).toContainText("/workspace/ready-project");
  await dialog.locator(".cpick[aria-expanded]").click();
  await expect(dialog.locator(".workspace-choice-grid button.active")).toContainText("/workspace/ready-project");
  await expect(dialog.getByRole("button",{name:"GPT First Entry"})).toHaveClass(/active/);

  await dialog.getByRole("button",{name:"대화",exact:true}).click();
  const conversationDialog=page.getByRole("dialog",{name:"새 대화"});
  const reviewTools=conversationDialog.getByRole("checkbox",{name:/코드·파일 리뷰 도구/});
  await expect(reviewTools).not.toBeChecked();
  await reviewTools.check();
  await conversationDialog.getByLabel("요청",{exact:true}).fill("현재 작업공간의 변경사항을 검토해 줘");
  await conversationDialog.getByRole("button",{name:"대화 시작",exact:true}).click();
  await expect.poll(()=>createdConversation).not.toBeNull();
  expect(createdConversation).toMatchObject({mode:"conversation",debateKind:"artifact-review",conversationKind:"artifact-review"});
  expect(createdConversation.participants).toHaveLength(2);
  expect(createdConversation.participants.every((participant:any)=>participant.permissionMode==="read"&&participant.automationLevel==="read")).toBe(true);
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem("deck-conversation-prefs")||"{}").kind)).toBe("artifact-review");
});
